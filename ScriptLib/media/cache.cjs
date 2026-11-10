const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const inlineMedia = require('./inline.cjs');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_DB = path.join(ROOT, 'data/media.sqlite');
const DEFAULT_DIR = path.join(ROOT, 'cache/media');
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ALLOWED_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'
]);

const hashUrl = value => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Media URL 給其他機器使用，預設挑目前區網私有 IPv4，而不是 localhost。
 * MEDIA_BASE_URL 可明確覆寫（例如反向代理或固定 hostname）。
 */
function detectMediaBaseUrl({ interfaces = os.networkInterfaces(), port = 3332, env = process.env } = {}) {
    const explicit = String(env.MEDIA_BASE_URL || '').trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const candidates = [];
    for (const addresses of Object.values(interfaces || {})) {
        for (const item of addresses || []) {
            if (![4, 'IPv4'].includes(item.family) || item.internal || !isPrivateAddress(item.address)) continue;
            candidates.push(item.address);
        }
    }
    const rank = address => address.startsWith('192.168.') ? 0
        : address.startsWith('10.') ? 1 : 2;
    candidates.sort((a, b) => rank(a) - rank(b));
    return `http://${candidates[0] || '127.0.0.1'}:${Number(port) || 3332}`;
}

/** URL 只接受一般 HTTP(S)，避免 data/blob/file 或帳密進入快取。 */
function normalizeImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 4096) return '';
    let url;
    try { url = new URL(raw); } catch { return ''; }
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (!url.hostname || url.username || url.password) return '';
    return url.href;
}

function isPrivateAddress(address) {
    if (net.isIPv4(address)) {
        const parts = address.split('.').map(Number);
        return parts[0] === 0 || parts[0] === 10 || parts[0] === 127
            || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
            || (parts[0] === 169 && parts[1] === 254)
            || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
            || (parts[0] === 192 && parts[1] === 168)
            || (parts[0] === 192 && parts[1] === 0 && parts[2] === 0)
            || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
            || parts[0] >= 224;
    }
    if (net.isIPv6(address)) {
        const normalized = address.toLowerCase();
        return normalized === '::' || normalized === '::1'
            || normalized.startsWith('fc') || normalized.startsWith('fd')
            || normalized.startsWith('fe8') || normalized.startsWith('fe9')
            || normalized.startsWith('fea') || normalized.startsWith('feb')
            || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.')
            || normalized.startsWith('::ffff:192.168.');
    }
    return true;
}

/**
 * 通用圖片快取：把外部圖片 URL 換成本機 /media/<sha256>，首次請求時抓取並持久化。
 * 只存圖片位元組與來源 metadata，不存 HTML。
 */
class MediaCache {
    constructor({ dbFile = DEFAULT_DB, imageDir = DEFAULT_DIR, baseUrl = detectMediaBaseUrl(),
        fetchImpl = fetch, allowPrivateHosts = false, now = Date.now,
        maxBytes = (Number(process.env.MEDIA_CACHE_MAX_MB) || 1024) * 1024 * 1024,
        maxAgeMs = (Number(process.env.MEDIA_CACHE_DAYS) || 90) * 86400000 } = {}) {
        this.dbFile = dbFile;
        this.imageDir = imageDir;
        this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
        this.fetchImpl = fetchImpl;
        this.allowPrivateHosts = allowPrivateHosts;
        this.now = now;
        this.maxBytes = Math.max(0, Number(maxBytes) || 0);
        this.maxAgeMs = Math.max(0, Number(maxAgeMs) || 0);
        this.inflight = new Map();
        fs.mkdirSync(path.dirname(dbFile), { recursive: true });
        fs.mkdirSync(imageDir, { recursive: true });
        this.db = new DatabaseSync(dbFile);
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
            CREATE TABLE IF NOT EXISTS media (
                hash TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                content_type TEXT,
                byte_size INTEGER,
                etag TEXT,
                fetched_at INTEGER,
                last_access INTEGER,
                fail_count INTEGER NOT NULL DEFAULT 0,
                last_fail_at INTEGER,
                source TEXT NOT NULL DEFAULT 'http',
                pinned INTEGER NOT NULL DEFAULT 0
            );
        `);
        const columns = new Set(this.db.prepare('PRAGMA table_info(media)').all().map(row => row.name));
        if (!columns.has('source')) this.db.exec("ALTER TABLE media ADD COLUMN source TEXT NOT NULL DEFAULT 'http'");
        if (!columns.has('pinned')) this.db.exec('ALTER TABLE media ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    }

    filePath(hash) {
        return path.join(this.imageDir, hash + '.bin');
    }

    /** 同步取得（或建立）本地 URL；預抓失敗不影響原訊息。 */
    localUrl(value) {
        const url = normalizeImageUrl(value);
        if (!url) return value;
        if (url.startsWith(this.baseUrl + '/media/')) return url;
        const hash = hashUrl(url);
        try {
            this.db.prepare(`INSERT INTO media(hash,url,last_access,source,pinned) VALUES(?,?,?,?,?)
                ON CONFLICT(hash) DO UPDATE SET url=excluded.url`).run(hash, url, this.now(), 'http', 0);
            this.warm(hash, url);
        } catch {
            return value;
        }
        return `${this.baseUrl}/media/${hash}`;
    }

    /** 背景預抓 HTTP 圖片；失敗不影響原訊息。 */
    warm(hash, url) {
        if (this.inflight.has(hash) || fs.existsSync(this.filePath(hash))) return;
        this.ensure(hash, url).catch(() => {});
    }

    /**
     * 把已驗證的 data URI 解碼為 content-addressed 檔案；只供歷史持久化使用。
     * 回傳本地 URL，不把 base64 寫進 SQLite。
     */
    storeInlineDataUri(value) {
        const decoded = inlineMedia.decodeDataImage(value);
        if (!decoded.ok) return null;
        const file = this.filePath(decoded.hash);
        if (!fs.existsSync(file)) {
            fs.mkdirSync(this.imageDir, { recursive: true });
            const temporary = file + '.' + process.pid + '.tmp';
            fs.writeFileSync(temporary, decoded.body);
            fs.renameSync(temporary, file);
        }
        this.db.prepare(`INSERT INTO media(hash,url,content_type,byte_size,etag,fetched_at,last_access,source,pinned)
            VALUES(?,?,?,?,?,?,?,'inline',1)
            ON CONFLICT(hash) DO UPDATE SET content_type=excluded.content_type,byte_size=excluded.byte_size,
                source='inline',pinned=1,last_access=excluded.last_access`).run(
            decoded.hash, 'inline:' + decoded.hash, decoded.mime, decoded.body.length,
            decoded.hash, this.now(), this.now()
        );
        return `${this.baseUrl}/media/${decoded.hash}`;
    }

    /** 讓 monitor 歷史引用的 HTTP 快取不被 LRU 清掉。 */
    pin(hash) {
        if (!/^[a-f0-9]{64}$/.test(String(hash || ''))) return;
        this.db.prepare('UPDATE media SET pinned=1 WHERE hash=?').run(hash);
    }

    /** 歷史不再引用時解除 HTTP pin；inline 由 releaseInlineExcept 處理。 */
    unpinExcept(referenced = new Set()) {
        const rows = this.db.prepare("SELECT hash FROM media WHERE pinned=1 AND source='http'").all();
        for (const row of rows) {
            if (!referenced.has(row.hash)) this.db.prepare('UPDATE media SET pinned=0 WHERE hash=?').run(row.hash);
        }
    }

    /** 釋放不再被 monitor 歷史引用的 inline 檔。 */
    releaseInlineExcept(referenced = new Set()) {
        const rows = this.db.prepare("SELECT hash FROM media WHERE source='inline'").all();
        for (const row of rows) {
            if (referenced.has(row.hash)) continue;
            try { fs.unlinkSync(this.filePath(row.hash)); } catch { /* ignore */ }
            this.db.prepare('DELETE FROM media WHERE hash=?').run(row.hash);
        }
    }

    /** 清除過期或超出容量的非 pinned HTTP 快取；inline 由引用方管理。 */
    prune() {
        const rows = this.db.prepare(`SELECT hash,byte_size,last_access FROM media
            WHERE pinned=0 ORDER BY last_access ASC, hash ASC`).all();
        let total = rows.reduce((sum, row) => sum + (Number(row.byte_size) || 0), 0);
        const cutoff = this.now() - this.maxAgeMs;
        for (const row of rows) {
            const expired = this.maxAgeMs > 0 && Number(row.last_access || 0) < cutoff;
            if (!expired && total <= this.maxBytes) continue;
            try { fs.unlinkSync(this.filePath(row.hash)); } catch { /* ignore */ }
            this.db.prepare('DELETE FROM media WHERE hash=?').run(row.hash);
            total -= Number(row.byte_size) || 0;
        }
        return { remainingBytes: total };
    }

    async assertPublicUrl(url) {
        if (this.allowPrivateHosts) return;
        const host = new URL(url).hostname;
        if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('不允許本機位址');
        if (net.isIP(host)) {
            if (isPrivateAddress(host)) throw new Error('不允許私有位址');
            return;
        }
        const addresses = await dns.lookup(host, { all: true, verbatim: true });
        if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
            throw new Error('不允許私有網路位址');
        }
    }

    async fetchImage(sourceUrl) {
        let current = sourceUrl;
        for (let redirect = 0; redirect <= 3; redirect++) {
            await this.assertPublicUrl(current);
            const response = await this.fetchImpl(current, {
                redirect: 'manual',
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                headers: { 'User-Agent': 'Mozilla/5.0 TTWChatMediaCache' }
            });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('location');
                if (!location || redirect === 3) throw new Error('圖片重新導向過多');
                current = new URL(location, current).href;
                continue;
            }
            if (!response.ok) throw new Error('來源圖片回應 ' + response.status);
            const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
            if (!ALLOWED_TYPES.has(contentType)) throw new Error('不支援的圖片類型: ' + (contentType || '未知'));
            const declared = Number(response.headers.get('content-length'));
            if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('來源圖片過大');
            const body = Buffer.from(await response.arrayBuffer());
            if (!body.length) throw new Error('來源圖片為空');
            if (body.length > MAX_BYTES) throw new Error('來源圖片過大');
            return { body, contentType, etag: response.headers.get('etag') || hashUrl(current) };
        }
        throw new Error('圖片重新導向過多');
    }

    async ensure(hash, url) {
        if (fs.existsSync(this.filePath(hash))) {
            const row = this.db.prepare('SELECT content_type FROM media WHERE hash=?').get(hash);
            if (row?.content_type) return row.content_type;
        }
        if (this.inflight.has(hash)) return this.inflight.get(hash);
        const task = (async () => {
            try {
                const image = await this.fetchImage(url);
                const temporary = this.filePath(hash) + '.' + process.pid + '.tmp';
                await fsp.writeFile(temporary, image.body);
                await fsp.rename(temporary, this.filePath(hash));
                this.db.prepare(`UPDATE media SET content_type=?,byte_size=?,etag=?,fetched_at=?,
                    fail_count=0,last_fail_at=NULL,last_access=? WHERE hash=?`)
                    .run(image.contentType, image.body.length, image.etag, this.now(), this.now(), hash);
                return image.contentType;
            } catch (error) {
                this.db.prepare(`UPDATE media SET fail_count=fail_count+1,last_fail_at=? WHERE hash=?`)
                    .run(this.now(), hash);
                throw error;
            } finally {
                this.inflight.delete(hash);
            }
        })();
        this.inflight.set(hash, task);
        return task;
    }

    async serve(req, res, hash) {
        if (!['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Method Not Allowed');
            return;
        }
        if (!/^[a-f0-9]{64}$/.test(String(hash || ''))) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
        }
        const row = this.db.prepare('SELECT * FROM media WHERE hash=?').get(hash);
        if (!row) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
        }
        try {
            let contentType = row.content_type;
            if (!contentType || !fs.existsSync(this.filePath(hash))) {
                contentType = await this.ensure(hash, row.url);
            }
            const body = await fsp.readFile(this.filePath(hash));
            this.db.prepare('UPDATE media SET last_access=? WHERE hash=?').run(this.now(), hash);
            const etag = '"' + hash + '"';
            if (req.headers['if-none-match'] === etag) {
                res.writeHead(304, { 'Cache-Control': CACHE_CONTROL, ETag: etag });
                res.end();
                return;
            }
            res.writeHead(200, {
                'Content-Type': contentType || 'application/octet-stream',
                'Content-Length': body.length,
                'Cache-Control': CACHE_CONTROL,
                'ETag': etag,
                'X-Content-Type-Options': 'nosniff'
            });
            res.end(req.method === 'HEAD' ? undefined : body);
        } catch {
            // 不在公開路由導向原始 URL，避免把私有位址帶給客戶端；失敗就回 404。
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end('Image unavailable');
        }
    }

    statusOf(row) {
        if (!row.content_type || !fs.existsSync(this.filePath(row.hash))) return 'missing';
        if (row.fail_count > 0) return 'failed';
        return 'cached';
    }

    mapRow(row) {
        let host = '';
        try { host = new URL(row.url).hostname; } catch { /* ignore */ }
        return {
            hash: row.hash,
            localUrl: `${this.baseUrl}/media/${row.hash}`,
            host,
            contentType: row.content_type || '',
            byteSize: Number(row.byte_size) || 0,
            fetchedAt: row.fetched_at || null,
            lastAccess: row.last_access || null,
            failCount: row.fail_count || 0,
            source: row.source || 'http',
            pinned: row.pinned === 1,
            status: this.statusOf(row)
        };
    }

    stats() {
        const rows = this.db.prepare('SELECT hash,url,content_type,byte_size,fail_count FROM media').all();
        const result = { total: rows.length, bytes: 0, cached: 0, failed: 0, missing: 0, byType: {} };
        for (const row of rows) {
            result.bytes += Number(row.byte_size) || 0;
            result[this.statusOf(row)] += 1;
            if (row.content_type) result.byType[row.content_type] = (result.byType[row.content_type] || 0) + 1;
        }
        return result;
    }

    list({ page = 1, pageSize = 50, q = '', type = '', status = '' } = {}) {
        const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
        const query = String(q || '').trim().toLowerCase();
        const rows = this.db.prepare('SELECT * FROM media ORDER BY last_access DESC, hash DESC').all()
            .map(row => this.mapRow(row))
            .filter(row => {
                if (type && row.contentType !== type) return false;
                if (status && row.status !== status) return false;
                if (!query) return true;
                return row.hash.includes(query) || row.host.toLowerCase().includes(query);
            });
        const pages = Math.max(1, Math.ceil(rows.length / size));
        const current = Math.max(1, Math.min(pages, Number(page) || 1));
        return {
            items: rows.slice((current - 1) * size, current * size),
            total: rows.length, page: current, pageSize: size, pages,
            stats: this.stats()
        };
    }

    close() {
        try { this.db.close(); } catch { /* ignore */ }
    }
}

const defaultMediaCache = new MediaCache();

module.exports = { MediaCache, defaultMediaCache, hashUrl, normalizeImageUrl, isPrivateAddress, detectMediaBaseUrl };
