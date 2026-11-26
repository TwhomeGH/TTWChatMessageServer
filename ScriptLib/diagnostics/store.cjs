const { parseDiagnosticLog, summarizeDiagnostics } = require('./parse.cjs');

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
        return parseDiagnosticLog({
            time: this.text(entry.time),
            title: title || 'log',
            body,
            receivedAt: this.now(),
            category: this.text(entry.category),
            severity: this.text(entry.severity),
            session: this.text(entry.session),
            fields: entry.fields
        });
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

    snapshot({ limit = 500, q = '', category = '', severity = '', session = '', order = 'desc', from = 0, to = 0, context = 0 } = {}) {
        const query = String(q || '').trim().toLowerCase();
        const selectedCategory = String(category || '').trim();
        const selectedSeverity = String(severity || '').trim();
        const selectedSession = String(session || '').trim();
        const ascending = String(order).toLowerCase() === 'asc';
        const fromMs = Number(from) || 0;
        const toMs = Number(to) || 0;
        const contextSize = Math.min(Math.max(Number(context) || 0, 0), 20);
        const size = Math.min(Math.max(Number(limit) || 500, 1), this.maxLogs);
        const matches = [];
        this.logs.forEach((entry, index) => {
            if (selectedCategory && entry.category !== selectedCategory) return;
            if (selectedSeverity && entry.severity !== selectedSeverity) return;
            if (selectedSession && entry.session !== selectedSession) return;
            if (fromMs && entry.receivedAt < fromMs) return;
            if (toMs && entry.receivedAt > toMs) return;
            if (query) {
                const haystack = [
                    entry.title, entry.body, entry.category, entry.session || '',
                    ...Object.entries(entry.fields || {}).map(([key, value]) => `${key}=${value}`)
                ].join(' ').toLowerCase();
                if (!haystack.includes(query)) return;
            }
            matches.push(index);
        });

        const matchedIndexes = new Set(matches);
        let selected;
        let hasMore;
        if (contextSize === 0) {
            selected = ascending ? matches.slice(0, size) : matches.slice(-size).reverse();
            hasMore = matches.length > selected.length;
        } else {
            const indexes = new Set();
            let processed = 0;
            const start = ascending ? 0 : matches.length - 1;
            const end = ascending ? matches.length : -1;
            const step = ascending ? 1 : -1;
            for (let m = start; m !== end; m += step) {
                const index = matches[m];
                const contextFrom = Math.max(0, index - contextSize);
                const contextTo = Math.min(this.logs.length - 1, index + contextSize);
                for (let i = contextFrom; i <= contextTo; i++) indexes.add(i);
                processed += 1;
                if (indexes.size >= size) break;
            }
            selected = [...indexes].sort((a, b) => ascending ? a - b : b - a).slice(0, size);
            hasMore = processed < matches.length || indexes.size > selected.length;
        }

        // order 決定回傳方向；matched=false 代表是匹配項的上下文。
        const logs = selected.map(index => ({
            ...this.logs[index],
            matched: matchedIndexes.has(index)
        }));
        return {
            logs,
            total: matches.length,
            matched: logs.filter(entry => entry.matched).length,
            context: logs.filter(entry => !entry.matched).length,
            hasMore,
            summary: summarizeDiagnostics(this.logs),
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
