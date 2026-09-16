// 表情圖片的伺服器端磁碟快取。
// 依映射代碼取得來源網址，首次抓取後存檔，之後直接由本機供應並附長效快取標頭，
// 避免每次開管理頁都重新抓取外部圖片。只接受映射表中既有的代碼，不接受任意網址（避免 SSRF）。
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { httpError } = require('./http.cjs');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CACHE_DIR = path.join(ROOT, 'cache', 'emoji-images');
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const hash = url => crypto.createHash('sha256').update(url).digest('hex');

/** 建立一組圖片快取；測試可傳入獨立目錄，正式流程使用預設目錄。 */
function createImageCache(cacheDir = DEFAULT_CACHE_DIR) {
    const binPath = url => path.join(cacheDir, hash(url) + '.bin');
    const metaPath = url => path.join(cacheDir, hash(url) + '.json');

    async function readCache(url) {
        try {
            const [body, meta] = await Promise.all([
                fs.readFile(binPath(url)), fs.readFile(metaPath(url), 'utf8')
            ]);
            const contentType = JSON.parse(meta).contentType;
            return typeof contentType === 'string' && contentType ? { body, contentType } : null;
        } catch { return null; }
    }

    async function fetchImage(url) {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!response.ok) throw httpError(502, '來源圖片回應 ' + response.status);
        const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!contentType.startsWith('image/')) throw httpError(502, '來源不是圖片');
        const body = Buffer.from(await response.arrayBuffer());
        if (!body.length) throw httpError(502, '來源圖片為空');
        if (body.length > MAX_BYTES) throw httpError(502, '來源圖片過大');
        return { body, contentType };
    }

    async function writeCache(url, image) {
        await fs.mkdir(cacheDir, { recursive: true });
        const temporary = binPath(url) + '.' + process.pid + '.tmp';
        await fs.writeFile(temporary, image.body);
        await fs.rename(temporary, binPath(url));
        await fs.writeFile(metaPath(url), JSON.stringify({ contentType: image.contentType, url }));
    }

    /** 依代碼供應映射圖片；命中快取直接回傳，否則抓取一次後寫入快取。 */
    async function serve(req, res, code, store) {
        if (!['GET', 'HEAD'].includes(req.method)) throw httpError(405, '不支援的請求');
        const url = store.snapshot().map[code];
        if (typeof url !== 'string' || !url) throw httpError(404, '找不到此表情');

        let image = await readCache(url);
        if (!image) {
            image = await fetchImage(url);
            await writeCache(url, image).catch(() => {});
        }

        const etag = '"' + hash(url) + '"';
        if (req.headers['if-none-match'] === etag) {
            res.writeHead(304, { 'Cache-Control': CACHE_CONTROL, ETag: etag });
            res.end();
            return;
        }
        res.writeHead(200, {
            'Content-Type': image.contentType,
            'Content-Length': image.body.length,
            'Cache-Control': CACHE_CONTROL,
            'ETag': etag,
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(req.method === 'HEAD' ? undefined : image.body);
    }

    return { serve, cacheDir };
}

const defaultCache = createImageCache();

module.exports = { createImageCache, serveEmojiImage: defaultCache.serve, DEFAULT_CACHE_DIR };
