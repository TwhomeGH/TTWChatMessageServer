const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { classifyCategory, classifyLevel, classifySource } = require('./classify.cjs');

const DAY = 86400000;

/**
 * 結構化系統日誌 SQLite store。
 *
 * 只保存可查詢的欄位；原始 log 檔仍由 writeLog() 保有完整文字。
 * 寫入失敗不可影響主服務，因此呼叫端應自行忽略例外。
 */
class LogStore {
    /**
     * @param {Object} [options]
     * @param {string} [options.file] SQLite 檔案；測試可用 ':memory:'。
     * @param {number} [options.retentionDays=14]
     * @param {number} [options.maxRows=200000]
     * @param {() => number} [options.now=Date.now]
     */
    constructor({ file = path.join(__dirname, '../../data/logs.sqlite'), retentionDays = 14,
        maxRows = 200000, now = Date.now } = {}) {
        this.file = file;
        this.retentionDays = Math.max(1, Number(retentionDays) || 14);
        this.maxRows = Math.max(1000, Number(maxRows) || 200000);
        this.now = now;
        this.appended = 0;
        if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
        this.db = new DatabaseSync(file);
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at INTEGER NOT NULL,
                level TEXT NOT NULL,
                category TEXT NOT NULL,
                source TEXT NOT NULL,
                session_id TEXT,
                message TEXT NOT NULL,
                fields TEXT
            );
            CREATE INDEX IF NOT EXISTS logs_at ON logs(at, id);
            CREATE INDEX IF NOT EXISTS logs_category_at ON logs(category, at);
            CREATE INDEX IF NOT EXISTS logs_level_at ON logs(level, at);
            CREATE INDEX IF NOT EXISTS logs_session_at ON logs(session_id, at);
        `);
        this.insert = this.db.prepare(`INSERT INTO logs(at,level,category,source,session_id,message,fields)
            VALUES(?,?,?,?,?,?,?)`);
        this.prune();
    }

    /**
     * 寫入一筆日誌；沒有 text 或 message 時回傳 false。
     * @param {{t?: number, text?: string, message?: string, level?: string, category?: string,
     *          source?: string, session?: string, fields?: Object}} entry
     * @returns {boolean}
     */
    append(entry = {}) {
        const message = String(entry.message ?? entry.text ?? '');
        if (!message) return false;
        const at = Number(entry.t);
        const t = Number.isFinite(at) && at > 0 ? at : this.now();
        const level = ['error', 'warn', 'info', 'debug'].includes(entry.level)
            ? entry.level : classifyLevel(message);
        const category = entry.category || classifyCategory(message);
        const source = entry.source || classifySource(message);
        let fields = null;
        if (entry.fields && typeof entry.fields === 'object') {
            try { fields = JSON.stringify(entry.fields); } catch { fields = null; }
        }
        try {
            this.insert.run(t, level, String(category), String(source),
                entry.session ? String(entry.session) : null, message.slice(0, 20000), fields);
            this.appended++;
            if (this.appended % 100 === 0) this.prune();
            return true;
        } catch {
            return false;
        }
    }

    /** 刪除過期與超過上限的資料；保留最新資料。 */
    prune() {
        const cutoff = this.now() - this.retentionDays * DAY;
        try {
            this.db.prepare('DELETE FROM logs WHERE at < ?').run(cutoff);
            const edge = this.db.prepare('SELECT id FROM logs ORDER BY id DESC LIMIT 1 OFFSET ?')
                .get(this.maxRows);
            if (edge?.id) this.db.prepare('DELETE FROM logs WHERE id <= ?').run(edge.id);
        } catch { /* 清理失敗不影響寫入 */ }
    }

    /**
     * 摘要：總數、時間範圍、分類／等級／session 分佈。
     * @param {{from?: number, to?: number}} [range]
     */
    summary({ from = null, to = null } = {}) {
        const where = [];
        const params = [];
        if (Number.isFinite(from)) { where.push('at >= ?'); params.push(from); }
        if (Number.isFinite(to)) { where.push('at <= ?'); params.push(to); }
        const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
        const total = this.db.prepare(`SELECT COUNT(*) AS n FROM logs${clause}`).get(...params).n;
        const range = this.db.prepare(`SELECT MIN(at) AS fromAt, MAX(at) AS toAt FROM logs${clause}`).get(...params);
        const categories = this.db.prepare(`SELECT category AS name, COUNT(*) AS count FROM logs${clause}
            GROUP BY category ORDER BY count DESC, name ASC`).all(...params);
        const levels = this.db.prepare(`SELECT level AS name, COUNT(*) AS count FROM logs${clause}
            GROUP BY level ORDER BY count DESC, name ASC`).all(...params);
        const sessions = this.db.prepare(`SELECT DISTINCT session_id AS id FROM logs${clause}
            ${clause ? 'AND' : 'WHERE'} session_id IS NOT NULL ORDER BY at DESC LIMIT 100`).all(...params)
            .map(row => row.id);
        return {
            total,
            range: { from: range.fromAt ?? null, to: range.toAt ?? null },
            categories,
            levels,
            sessions
        };
    }

    /**
     * 查詢日誌；以 id 反向 keyset 分頁，避免深 offset。
     * @param {{q?: string, category?: string, level?: string, session?: string,
     *          from?: number, to?: number, beforeId?: number, limit?: number}} [options]
     */
    list({ q = '', category = '', level = '', session = '', from = null, to = null,
        beforeId = null, limit = 100 } = {}) {
        const filters = [];
        const params = [];
        if (category) { filters.push('category = ?'); params.push(String(category)); }
        if (level) { filters.push('level = ?'); params.push(String(level)); }
        if (session) { filters.push('session_id = ?'); params.push(String(session)); }
        if (Number.isFinite(from)) { filters.push('at >= ?'); params.push(from); }
        if (Number.isFinite(to)) { filters.push('at <= ?'); params.push(to); }
        const query = String(q || '').trim().slice(0, 200);
        if (query) {
            filters.push('(message LIKE ? OR category LIKE ? OR source LIKE ?)');
            const like = `%${query}%`;
            params.push(like, like, like);
        }
        const base = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
        const total = this.db.prepare(`SELECT COUNT(*) AS n FROM logs${base}`).get(...params).n;
        const pageSize = Math.min(Math.max(Number(limit) || 100, 1), 500);
        const pageFilters = [...filters];
        const pageParams = [...params];
        if (Number.isFinite(beforeId)) {
            pageFilters.push('id < ?');
            pageParams.push(beforeId);
        }
        const where = pageFilters.length ? ` WHERE ${pageFilters.join(' AND ')}` : '';
        const rows = this.db.prepare(`SELECT id,at,level,category,source,session_id,message,fields
            FROM logs${where} ORDER BY id DESC LIMIT ?`).all(...pageParams, pageSize + 1);
        const hasMore = rows.length > pageSize;
        const page = rows.slice(0, pageSize).map(row => ({
            id: row.id,
            at: row.at,
            level: row.level,
            category: row.category,
            source: row.source,
            session: row.session_id,
            message: row.message,
            fields: parseFields(row.fields)
        }));
        return {
            total,
            rows: page,
            hasMore,
            nextBeforeId: hasMore ? page[page.length - 1]?.id ?? null : null
        };
    }

    close() {
        try { this.db.close(); } catch { /* ignore */ }
    }
}

function parseFields(value) {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch { return null; }
}

module.exports = { LogStore };
