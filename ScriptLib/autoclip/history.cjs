const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DAY = 86400000;

/** 解析統計列時間；沿用 AutoClip 的 ISO 字串，也接受 epoch 毫秒。 */
function rowTime(row) {
    const value = row?.t;
    if (Number.isSafeInteger(value)) return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/** 等距降採樣；觸發列一定保留，讓歷史頁仍能選到事件。 */
function downsample(rows, maxPoints) {
    if (rows.length <= maxPoints) return { rows, truncated: false };
    const keep = new Set([0, rows.length - 1]);
    const stride = Math.ceil(rows.length / maxPoints);
    for (let index = 0; index < rows.length; index += stride) keep.add(index);
    for (let index = 0; index < rows.length; index += 1) {
        if (rows[index].triggered) keep.add(index);
    }
    return {
        rows: [...keep].sort((a, b) => a - b).map(index => rows[index]),
        truncated: true
    };
}

/**
 * 自動剪輯的跨場次歷史。
 *
 * `samples` 保存每一次 5 秒評估的完整 payload；`sessions` 保存場次摘要。
 * 即時頁仍使用 Server 記憶體中的最近快照，歷史頁只查這個儲存。
 */
class AutoClipHistory {
    /** @param {string} filename SQLite 路徑或 :memory:。 */
    constructor(filename = ':memory:') {
        if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
        this.db = new DatabaseSync(filename);
        this.db.exec(`
            PRAGMA journal_mode=WAL;
            PRAGMA busy_timeout=3000;
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                startedAt INTEGER NOT NULL,
                endedAt INTEGER,
                lastAt INTEGER NOT NULL,
                mode TEXT,
                platform TEXT,
                clipPlatform TEXT,
                config TEXT,
                sampleCount INTEGER DEFAULT 0,
                triggerCount INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS samples (
                session TEXT NOT NULL,
                t INTEGER NOT NULL,
                data TEXT NOT NULL,
                triggered INTEGER DEFAULT 0,
                PRIMARY KEY(session, t)
            );
            CREATE INDEX IF NOT EXISTS samples_session_time ON samples(session, t);
            CREATE INDEX IF NOT EXISTS samples_time ON samples(t);
        `);
    }

    /**
     * 追加或更新一個場次的統計列。
     * 同一個 session/t 已存在時只更新（觸發列後續會補上剪輯結果）；
     * 新列才新增，避免每 5 秒把整份 2000 筆重複寫入。
     * @param {string} sessionId 場次識別。
     * @param {Object} config AutoClip 設定。
     * @param {Object[]} stats 目前快照。
     * @returns {{inserted:number, updated:number, samples:number}}
     */
    append(sessionId, config = {}, stats = []) {
        if (typeof sessionId !== 'string' || !sessionId || !Array.isArray(stats) || !stats.length) {
            return { inserted: 0, updated: 0, samples: 0 };
        }
        const rows = stats.map(row => ({ row, t: rowTime(row), triggered: row?.triggered ? 1 : 0 }))
            .filter(item => item.t !== null);
        if (!rows.length) return { inserted: 0, updated: 0, samples: 0 };
        rows.sort((a, b) => a.t - b.t);
        const existing = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
        const lastT = this.db.prepare('SELECT MAX(t) AS t FROM samples WHERE session=?').get(sessionId)?.t ?? -Infinity;
        const insert = this.db.prepare(`INSERT INTO samples(session,t,data,triggered) VALUES(?,?,?,?)
            ON CONFLICT(session,t) DO UPDATE SET data=excluded.data,triggered=excluded.triggered`);
        let inserted = 0;
        let updated = 0;
        let samples;

        this.db.exec('BEGIN IMMEDIATE');
        try {
            for (const item of rows) {
                if (item.t > lastT) {
                    insert.run(sessionId, item.t, JSON.stringify(item.row), item.triggered);
                    inserted += 1;
                } else if (item.triggered) {
                    insert.run(sessionId, item.t, JSON.stringify(item.row), item.triggered);
                    updated += 1;
                }
            }
            const meta = this.db.prepare(`SELECT MIN(t) AS startedAt, MAX(t) AS lastAt,
                COUNT(*) AS sampleCount, COALESCE(SUM(triggered),0) AS triggerCount
                FROM samples WHERE session=?`).get(sessionId);
            const startedAt = existing ? Math.min(existing.startedAt, meta.startedAt) : meta.startedAt;
            const lastAt = existing ? Math.max(existing.lastAt, meta.lastAt) : meta.lastAt;
            this.db.prepare(`INSERT INTO sessions(id,startedAt,endedAt,lastAt,mode,platform,clipPlatform,config,sampleCount,triggerCount)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    startedAt=excluded.startedAt, lastAt=excluded.lastAt,
                    mode=excluded.mode, platform=excluded.platform, clipPlatform=excluded.clipPlatform,
                    config=excluded.config, sampleCount=excluded.sampleCount, triggerCount=excluded.triggerCount`)
                .run(sessionId, startedAt, existing?.endedAt ?? null, lastAt,
                    config.mode ?? null, config.platform ?? null, config.clipPlatform ?? null,
                    JSON.stringify(config), meta.sampleCount, meta.triggerCount);
            samples = meta.sampleCount;
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        return { inserted, updated, samples };
    }

    /** 標記場次結束時間。 @param {string} sessionId @returns {void} */
    finish(sessionId) {
        this.db.prepare('UPDATE sessions SET endedAt=lastAt WHERE id=?').run(sessionId);
    }

    /** 列出歷史場次，新到舊。 @returns {Object[]} */
    listSessions() {
        return this.db.prepare(`SELECT id,startedAt,endedAt,lastAt,mode,platform,clipPlatform,
            sampleCount,triggerCount FROM sessions ORDER BY lastAt DESC`).all();
    }

    /**
     * 查詢一個場次的歷史資料。
     * @param {Object} value session、可選 from／to／maxPoints。
     * @returns {{session:string|null,config:Object,rows:Object[],truncated:boolean,meta:Object|null}}
     */
    query({ session = null, from = null, to = null, maxPoints = 4000 } = {}) {
        let id = typeof session === 'string' && session ? session : null;
        if (!id) {
            id = this.db.prepare('SELECT id FROM sessions ORDER BY lastAt DESC LIMIT 1').get()?.id ?? null;
        }
        if (!id) return { session: null, config: {}, rows: [], truncated: false, meta: null };
        const meta = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
        if (!meta) return { session: null, config: {}, rows: [], truncated: false, meta: null };
        const lower = Number.isSafeInteger(from) ? from : 0;
        const upper = Number.isSafeInteger(to) ? to : Number.MAX_SAFE_INTEGER;
        const rows = this.db.prepare(`SELECT t,data,triggered FROM samples
            WHERE session=? AND t>=? AND t<=? ORDER BY t`).all(id, lower, upper)
            .map(row => {
                const data = JSON.parse(row.data);
                return { ...data, t: data.t ?? row.t, triggered: Boolean(row.triggered) };
            });
        const sampled = downsample(rows, Math.max(100, Math.min(10000, maxPoints)));
        let config;
        try { config = JSON.parse(meta.config || '{}'); } catch { config = {}; }
        return {
            session: id,
            config,
            rows: sampled.rows,
            truncated: sampled.truncated,
            meta: {
                ...meta,
                config: undefined
            }
        };
    }

    /** 清空所有歷史。 @returns {void} */
    clear() {
        this.db.exec('DELETE FROM samples; DELETE FROM sessions;');
    }

    /** 刪除超過保留期限的樣本與空場次。 @param {number} days @param {number} now @returns {void} */
    prune(days = 30, now = Date.now()) {
        const cutoff = now - days * DAY;
        this.db.prepare('DELETE FROM samples WHERE t < ?').run(cutoff);
        this.db.prepare('DELETE FROM sessions WHERE lastAt < ? OR id NOT IN (SELECT DISTINCT session FROM samples)').run(cutoff);
    }

    /** 首次啟動時把舊的 autoclip_stats.json 匯入為 legacy 場次；已有資料就跳過。 */
    importLegacy(filename) {
        if (!filename || !fs.existsSync(filename)) return 0;
        if (this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n > 0) return 0;
        try {
            const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
            const stats = Array.isArray(data) ? data : data.stats;
            if (!Array.isArray(stats) || !stats.length) return 0;
            const last = stats[stats.length - 1];
            const lastAt = rowTime(last) ?? Date.now();
            const sessionId = `legacy-${lastAt}`;
            this.append(sessionId, (Array.isArray(data) ? {} : data.config) || {}, stats);
            this.finish(sessionId);
            return stats.length;
        } catch {
            return 0;
        }
    }

    /** 關閉底層資料庫。 @returns {void} */
    close() {
        this.db.close();
    }
}

module.exports = { AutoClipHistory, downsample };
