/**
 * 應用診斷的記憶體暫存：HTTP log bridge（LogServer 相容）與帶外 diagnostic。
 * 不寫 log 檔、不進聊天、不進 SQLite；所有資料都有筆數與字串上限。
 */
class DiagnosticsStore {
    constructor({ maxLogs = 2000, maxDiagnostics = 100, maxBody = 8000, now = Date.now } = {}) {
        this.maxLogs = maxLogs;
        this.maxDiagnostics = maxDiagnostics;
        this.maxBody = maxBody;
        this.now = now;
        this.logs = [];
        this.diagnostics = new Map();
        this.recentDiagnostics = [];
        this.stats = { logsReceived: 0, logsDropped: 0, diagnosticsReceived: 0 };
        this.lastReceived = null;
    }

    text(value) {
        return String(value == null ? '' : value).slice(0, this.maxBody);
    }

    normalizeLog(entry) {
        if (!entry || typeof entry !== 'object') return null;
        const title = this.text(entry.title).trim();
        const body = this.text(entry.body ?? entry.message);
        if (!title && !body) return null;
        return {
            time: this.text(entry.time),
            title: title || 'log',
            body,
            receivedAt: this.now()
        };
    }

    /** 接受 LogServer 的 {logs:[...]}、單一 log 物件或陣列。 */
    ingestLogs(payload) {
        let entries;
        if (Array.isArray(payload)) entries = payload;
        else if (Array.isArray(payload?.logs)) entries = payload.logs;
        else entries = [payload];
        let accepted = 0;
        for (const entry of entries.slice(0, this.maxLogs)) {
            const normalized = this.normalizeLog(entry);
            if (!normalized) {
                this.stats.logsDropped += 1;
                continue;
            }
            this.logs.push(normalized);
            accepted += 1;
            this.stats.logsReceived += 1;
        }
        if (this.logs.length > this.maxLogs) {
            const removed = this.logs.length - this.maxLogs;
            this.logs.splice(0, removed);
            this.stats.logsDropped += removed;
        }
        if (accepted) this.lastReceived = this.now();
        return { accepted, total: this.logs.length };
    }

    /** 帶外 logio／diagnostic；只保留每個 subsystem/source 的最新摘要。 */
    ingestDiagnostic(payload) {
        if (!payload || typeof payload !== 'object') return false;
        if (payload.type !== 'diagnostic') return false;
        const subsystem = this.text(payload.subsystem || 'unknown').slice(0, 80);
        const source = this.text(payload.source || 'unknown').slice(0, 40);
        const count = Number.isFinite(Number(payload.count)) ? Math.max(0, Number(payload.count)) : 0;
        const entry = {
            type: 'diagnostic',
            subsystem,
            source,
            count,
            lastError: this.text(payload.lastError),
            receivedAt: this.now()
        };
        this.diagnostics.set(subsystem + ':' + source, entry);
        this.recentDiagnostics.unshift(entry);
        if (this.recentDiagnostics.length > this.maxDiagnostics) this.recentDiagnostics.pop();
        this.stats.diagnosticsReceived += 1;
        this.lastReceived = entry.receivedAt;
        return true;
    }

    snapshot({ limit = 500, q = '' } = {}) {
        const query = String(q || '').trim().toLowerCase();
        const size = Math.min(Math.max(Number(limit) || 500, 1), this.maxLogs);
        const logs = this.logs
            .filter(entry => !query
                || entry.title.toLowerCase().includes(query)
                || entry.body.toLowerCase().includes(query))
            .slice(-size)
            .reverse();
        return {
            logs,
            diagnostics: [...this.diagnostics.values()].sort((a, b) => b.receivedAt - a.receivedAt),
            recentDiagnostics: this.recentDiagnostics,
            stats: {
                ...this.stats,
                bufferedLogs: this.logs.length,
                bufferedDiagnostics: this.recentDiagnostics.length
            },
            lastReceived: this.lastReceived
        };
    }
}

module.exports = { DiagnosticsStore };
