import { randomUUID } from 'node:crypto';
import { normalizeSource } from './MessageSource.mjs';

export function messageTime(value) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    let n = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(n) && typeof value === 'string') n = Date.parse(value);
    if (n > 0 && n < 1e11) n *= 1000;
    return Number.isFinite(n) && n >= 946684800000 && n <= Date.now() + 60000 ? n : null;
}

export function mergeStatEntries(...snapshots) {
    const map = new Map();
    for (const entries of snapshots) for (const row of entries || []) {
        if (!row || typeof row.message !== 'string' || !Number.isFinite(row.count) || row.count < 0) continue;
        const old = map.get(row.message) || { count: 0, recent: [], platforms: [] };
        const recent = [...new Map([...old.recent, ...(Array.isArray(row.recent) ? row.recent : [])]
            .filter(e => e && e.key && messageTime(e.receivedAt))
            .map(e => [e.key, e])).values()].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 5);
        const first = [old.firstSeen, row.firstSeen].map(messageTime).filter(x => x !== null);
        const last = [old.lastSeen, row.lastSeen].map(messageTime).filter(x => x !== null);
        map.set(row.message, { message: row.message, count: Math.max(old.count, row.count),
            firstSeen: first.length ? Math.min(...first) : null,
            lastSeen: last.length ? Math.max(...last) : null,
            platforms: [...new Set([...old.platforms, ...(Array.isArray(row.platforms) ? row.platforms : [])])], recent });
        map.get(row.message).transports = [...new Set([...(old.transports || []), ...(Array.isArray(row.transports) ? row.transports : [])])];
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
}

export class MessageStats {
    constructor() { this.rows = new Map(); this.ids = new Map(); this.crossSource = new Map(); }
    clear() { this.rows.clear(); this.ids.clear(); this.crossSource.clear(); }
    merge(rows) { this.rows = new Map(mergeStatEntries(this.all(), rows).map(r => [r.message, r])); }
    all() { return [...this.rows.values()].sort((a, b) => b.count - a.count); }
    record(message, meta = {}) {
        if (typeof message !== 'string' || !message.trim()) return null;
        const receivedAt = messageTime(meta.receivedAt) ?? Date.now();
        const sentAt = messageTime(meta.sentAt);
        const source = normalizeSource(meta);
        const { platform, transport } = source;
        const id = meta.id == null ? null : String(meta.id);
        const key = id ? `${source.isTest ? 'test:' : ''}${platform}:${id}` : randomUUID();
        const now = Date.now();
        for (const [k, at] of this.ids) { if (now - at < 1800000) break; this.ids.delete(k); }
        const fingerprint = JSON.stringify([platform, source.isTest, meta.user || meta.userId || '', message]);
        const previous = this.crossSource.get(fingerprint);
        const crossDuplicate = previous && previous.transport !== transport &&
            now - previous.at <= 3000 && (!id || !previous.id || id === previous.id);
        if ((id && this.ids.has(key)) || crossDuplicate) {
            const row = this.rows.get(message);
            if (row) row.transports = [...new Set([...(row.transports || []), transport])];
            if (id) { this.ids.delete(key); this.ids.set(key, now); }
            while (this.ids.size > 10000) this.ids.delete(this.ids.keys().next().value);
            return null;
        }
        this.crossSource.delete(fingerprint);
        this.crossSource.set(fingerprint, { transport, id, at: now });
        while (this.crossSource.size > 10000) this.crossSource.delete(this.crossSource.keys().next().value);
        if (id) this.ids.set(key, now);
        while (this.ids.size > 10000) this.ids.delete(this.ids.keys().next().value);
        const event = { key, id, ...source, userId: String(meta.userId || ''), user: meta.user || '',
            sentAt, receivedAt, timeSource: sentAt === null ? 'received' : 'platform', message };
        const old = this.rows.get(message) || { message, count: 0, platforms: [], recent: [] };
        const time = sentAt ?? receivedAt;
        this.rows.set(message, { ...old, count: old.count + 1,
            firstSeen: old.firstSeen == null ? time : Math.min(old.firstSeen, time),
            lastSeen: Math.max(old.lastSeen || 0, time),
            platforms: [...new Set([...old.platforms, platform])],
            transports: [...new Set([...(old.transports || []), transport])],
            recent: [event, ...old.recent].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 5) });
        return event;
    }
}
