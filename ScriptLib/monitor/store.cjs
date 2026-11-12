const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const inlineMedia = require('../media/inline.cjs');

const DAY = 86400000;
const INLINE_IMAGE_RE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}/gi;

/**
 * 直播訊息歷史：每個子程序啟動是一場，訊息以 SQLite 保存，供重啟後回顧。
 * 原始聊天只保存在本機；測試訊息不寫入。
 */
class MonitorHistoryStore {
    /**
     * @param {Object} [options]
     * @param {string} [options.file] SQLite 檔案；測試可用 ':memory:'。
     * @param {number} [options.retentionDays=14]
     * @param {number} [options.maxSessions=10]
     * @param {number} [options.maxMessagesPerSession=20000]
     * @param {() => number} [options.now]
     * @param {Object} [options.mediaCache] MediaCache；提供時把 data URI materialize 成 /media。
     */
    constructor({ file = path.join(__dirname, '../../data/monitor.sqlite'), retentionDays = 14,
        maxSessions = 10, maxMessagesPerSession = 20000, now = Date.now, mediaCache = null } = {}) {
        this.file = file;
        this.retentionDays = Math.max(1, retentionDays);
        this.maxSessions = Math.max(1, maxSessions);
        this.maxMessagesPerSession = Math.max(1, maxMessagesPerSession);
        this.now = now;
        this.mediaCache = mediaCache;
        this.appended = 0;
        if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
        this.db = new DatabaseSync(file);
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                last_message_at INTEGER,
                message_count INTEGER NOT NULL DEFAULT 0,
                joins INTEGER NOT NULL DEFAULT 0,
                likes INTEGER NOT NULL DEFAULT 0,
                chats INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                t INTEGER NOT NULL,
                category TEXT,
                platform TEXT,
                user TEXT,
                message TEXT NOT NULL,
                img TEXT,
                gift_img TEXT,
                audience TEXT
            );
            CREATE INDEX IF NOT EXISTS messages_session_t ON messages(session_id, t, id);
            CREATE INDEX IF NOT EXISTS messages_t ON messages(t);
            CREATE TABLE IF NOT EXISTS message_media (
                message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                hash TEXT NOT NULL,
                PRIMARY KEY(message_id, hash)
            );
            CREATE INDEX IF NOT EXISTS message_media_hash ON message_media(hash);
        `);
        // 主服務重啟時，上一個子程序已不在；把殘留的開放場次收尾。
        this.db.prepare('UPDATE sessions SET ended_at=COALESCE(last_message_at,started_at) WHERE ended_at IS NULL').run();
        this.prune();
        this.syncInlineReferences();
    }

    startSession({ startedAt = this.now() } = {}) {
        const id = 'm_' + crypto.randomUUID();
        this.db.prepare('INSERT INTO sessions(id, started_at) VALUES(?, ?)').run(id, Number(startedAt));
        this.prune();
        return id;
    }

    endSession(id, endedAt = this.now()) {
        if (!id) return;
        this.db.prepare('UPDATE sessions SET ended_at=? WHERE id=? AND ended_at IS NULL').run(Number(endedAt), id);
    }

    collectLocalHashes(value, hashes) {
        if (typeof value !== 'string') return;
        for (const match of value.matchAll(/\/media\/([a-f0-9]{64})/g)) hashes.add(match[1]);
    }

    storeInline(value, hashes) {
        if (!this.mediaCache || typeof value !== 'string' || !inlineMedia.isInlineImage(value)) return value;
        try {
            const local = this.mediaCache.storeInlineDataUri(value);
            const hash = /\/media\/([a-f0-9]{64})(?:\.[a-z0-9]+)?$/.exec(local || '')?.[1];
            if (hash) {
                hashes.add(hash);
                return local;
            }
        } catch { /* fall through */ }
        return '';
    }

    materializeMessage(message, hashes) {
        const dataUris = inlineMedia.extractDataImages(message);
        if (!dataUris.length) return message;
        if (!this.mediaCache) return inlineMedia.stripInlineImages(message) || '[inline image]';
        if (!inlineMedia.validateInlineImages({ message }).ok) {
            return message.replace(INLINE_IMAGE_RE, '[inline image]');
        }
        let result = message;
        for (const dataUri of dataUris) {
            const local = this.storeInline(dataUri, hashes);
            result = result.replace(dataUri, local || '[inline image]');
        }
        return result;
    }

    /** 只影響寫入歷史的副本；live socket/SSE 仍保留原始 data URI。 */
    prepareEntry(entry) {
        const hashes = new Set();
        const validation = inlineMedia.validateInlineImages({
            img: entry.img, giftImg: entry.giftImg, message: entry.message
        });
        if (!validation.ok) {
            return {
                message: String(entry.message).replace(INLINE_IMAGE_RE, '[inline image]'),
                img: inlineMedia.isInlineImage(entry.img) ? '' : entry.img,
                giftImg: inlineMedia.isInlineImage(entry.giftImg) ? '' : entry.giftImg,
                hashes
            };
        }
        return {
            message: this.materializeMessage(String(entry.message), hashes),
            img: this.storeInline(entry.img, hashes),
            giftImg: this.storeInline(entry.giftImg, hashes),
            hashes
        };
    }

    /** 清掉 monitor 已不再引用的 inline media；由場次／訊息修剪後呼叫。 */
    syncInlineReferences() {
        if (!this.mediaCache || typeof this.mediaCache.releaseInlineExcept !== 'function') return;
        const referenced = new Set(
            this.db.prepare('SELECT DISTINCT hash FROM message_media').all().map(row => row.hash)
        );
        this.mediaCache.releaseInlineExcept(referenced);
        if (typeof this.mediaCache.unpinExcept === 'function') this.mediaCache.unpinExcept(referenced);
    }

    /**
     * @param {string} sessionId
     * @param {Object} entry 監控 payload。
     * @returns {boolean} 是否寫入。
     */
    append(sessionId, entry) {
        if (!sessionId || !entry || typeof entry !== 'object' || entry.isTest === true) return false;
        if (typeof entry.message !== 'string') return false;
        const t = Number(entry.t);
        if (!Number.isFinite(t)) return false;
        const stats = entry.session && typeof entry.session === 'object' ? entry.session : {};
        const audience = entry.audience && typeof entry.audience === 'object'
            ? JSON.stringify(entry.audience) : null;
        const prepared = this.prepareEntry(entry);
        // 已是 /media/<hash> 的 HTTP 圖片也要 pin，避免 LRU 刪掉歷史還在用的檔。
        for (const value of [prepared.message, prepared.img, prepared.giftImg]) {
            this.collectLocalHashes(value, prepared.hashes);
        }
        if (this.mediaCache && typeof this.mediaCache.pin === 'function') {
            for (const hash of prepared.hashes) this.mediaCache.pin(hash);
        }
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.db.prepare(`INSERT INTO messages(session_id,t,category,platform,user,message,img,gift_img,audience)
                VALUES(?,?,?,?,?,?,?,?,?)`).run(
                sessionId, t,
                entry.category ?? null, entry.platform ?? null, entry.user ?? null, prepared.message,
                prepared.img ?? null, prepared.giftImg ?? null, audience
            );
            const messageId = Number(this.db.prepare('SELECT last_insert_rowid() AS id').get().id);
            const insertMedia = this.db.prepare('INSERT OR IGNORE INTO message_media(message_id,hash) VALUES(?,?)');
            for (const hash of prepared.hashes) insertMedia.run(messageId, hash);
            this.db.prepare(`UPDATE sessions SET
                last_message_at=?, message_count=message_count+1,
                joins=MAX(joins, ?), likes=MAX(likes, ?), chats=MAX(chats, ?)
                WHERE id=?`).run(t, Number(stats.joins) || 0, Number(stats.likes) || 0, Number(stats.chats) || 0, sessionId);
            this.db.exec('COMMIT');
        } catch (error) {
            try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
            this.syncInlineReferences();
            throw error;
        }
        this.appended += 1;
        if (this.appended % 50 === 0) this.prune();
        this.trimSession(sessionId);
        return true;
    }

    /** 每場只保留最新 maxMessagesPerSession 則。 */
    trimSession(sessionId) {
        const count = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id=?').get(sessionId).n;
        if (count <= this.maxMessagesPerSession) return;
        const removed = count - this.maxMessagesPerSession;
        this.db.prepare(`DELETE FROM messages WHERE id IN (
            SELECT id FROM messages WHERE session_id=? ORDER BY t ASC, id ASC LIMIT ?
        )`).run(sessionId, removed);
        this.db.prepare('UPDATE sessions SET message_count=MAX(0, message_count-?) WHERE id=?').run(removed, sessionId);
        this.syncInlineReferences();
    }

    /** 刪除超過天數或場次上限的歷史。 */
    prune() {
        const cutoff = this.now() - this.retentionDays * DAY;
        this.db.prepare('DELETE FROM sessions WHERE started_at < ?').run(cutoff);
        this.db.prepare(`DELETE FROM sessions WHERE id NOT IN (
            SELECT id FROM sessions ORDER BY started_at DESC LIMIT ?
        )`).run(this.maxSessions);
        this.syncInlineReferences();
    }

    getSession(id) {
        const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
        return row ? this.mapSession(row) : null;
    }

    mapSession(row) {
        const platforms = this.db.prepare(`SELECT DISTINCT platform FROM messages
            WHERE session_id=? AND platform IS NOT NULL AND platform<>''`).all(row.id).map(item => item.platform);
        return {
            id: row.id,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            lastMessageAt: row.last_message_at,
            messageCount: row.message_count,
            joins: row.joins,
            likes: row.likes,
            chats: row.chats,
            platforms
        };
    }

    listSessions(limit = 20) {
        const rows = this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?')
            .all(Math.max(1, Math.min(50, Number(limit) || 20)));
        return rows.map(row => this.mapSession(row));
    }

    /**
     * @param {Object} options
     * @param {string} options.sessionId
     * @param {number} [options.page=1]
     * @param {number} [options.pageSize=200]
     * @param {string} [options.q]
     * @param {string[]} [options.categories]
     * @param {string} [options.platform]
     */
    listMessages({ sessionId, page = 1, pageSize = 200, q = '', categories = [], platform = '' } = {}) {
        const session = this.getSession(sessionId);
        if (!session) return null;
        const size = Math.max(1, Math.min(500, Number(pageSize) || 200));
        const where = ['session_id=?'];
        const params = [sessionId];
        const text = String(q || '').trim();
        if (text) {
            const escaped = text.replace(/[\\%_]/g, '\\$&');
            where.push("(user LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')");
            params.push(`%${escaped}%`, `%${escaped}%`);
        }
        const selectedCategories = (Array.isArray(categories) ? categories : [categories])
            .map(value => String(value || '').trim()).filter(Boolean);
        if (selectedCategories.length) {
            where.push(`category IN (${selectedCategories.map(() => '?').join(',')})`);
            params.push(...selectedCategories);
        }
        if (platform) {
            where.push('platform=?');
            params.push(String(platform));
        }
        const clause = where.join(' AND ');
        const total = this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE ${clause}`).get(...params).n;
        const pages = Math.max(1, Math.ceil(total / size));
        const current = Math.max(1, Math.min(pages, Number(page) || 1));
        const rows = this.db.prepare(`SELECT * FROM messages WHERE ${clause}
            ORDER BY t DESC, id DESC LIMIT ? OFFSET ?`).all(...params, size, (current - 1) * size);
        return {
            session, total, page: current, pageSize: size, pages,
            messages: rows.map(row => ({
                id: row.id, t: row.t, category: row.category, platform: row.platform,
                user: row.user, message: row.message, img: row.img, giftImg: row.gift_img,
                audience: row.audience ? JSON.parse(row.audience) : undefined
            }))
        };
    }

    close() {
        try { this.db.close(); } catch { /* ignore */ }
    }
}

function createMonitorHistoryStore(options) {
    return new MonitorHistoryStore(options);
}

module.exports = { MonitorHistoryStore, createMonitorHistoryStore };
