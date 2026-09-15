import { randomUUID } from 'node:crypto';
import { normalizeSource } from './MessageSource.mjs';
import { messageTime } from './ScriptLib/messageStats/time.mjs';
import { mergeStatEntries } from './ScriptLib/messageStats/merge.mjs';
import { isDuplicate } from './ScriptLib/messageStats/dedup.mjs';

// 保留公開入口，既有呼叫端不必跟著模組拆分修改路徑。
export { messageTime, mergeStatEntries };

export class MessageStats {
    /** 建立統計與去重狀態；保留既有 Map 欄位以維持相容性。 */
    constructor() {
        this.rows = new Map();
        this.ids = new Map();
        this.crossSource = new Map();
    }

    /** 同時清除統計與去重，讓同一事件可在新的統計週期重新計入。 */
    clear() {
        this.rows.clear();
        this.ids.clear();
        this.crossSource.clear();
    }

    /** 合併歷史快照；不重建或清除即時去重狀態。 */
    merge(rows) {
        this.rows = new Map(mergeStatEntries(this.all(), rows).map(r => [r.message, r]));
    }

    /** 回傳依次數排序的新陣列；其中統計列仍是目前狀態的參照。 */
    all() {
        return [...this.rows.values()].sort((a, b) => b.count - a.count);
    }

    /**
     * 正規化事件並計數；重複事件僅補齊接收管道，不增加次數。
     * @param {string} message 留言內容
     * @param {object} meta 平台、管道、身分與發送／接收時間
     * @returns {object|null} 新計入的事件；空白或重複留言回傳 null
     */
    record(message, meta = {}) {
        if (typeof message !== 'string' || !message.trim()) return null;
        const receivedAt = messageTime(meta.receivedAt) ?? Date.now();
        const sentAt = messageTime(meta.sentAt);
        const source = normalizeSource(meta);
        const { platform, transport } = source;
        const id = meta.id == null ? null : String(meta.id);
        const key = id ? `${source.isTest ? 'test:' : ''}${platform}:${id}` : randomUUID();
        const now = Date.now();
        const duplicate = isDuplicate(this, {
            ...source, id, key, user: meta.user || meta.userId || '', message
        }, now);
        if (duplicate) {
            const row = this.rows.get(message);
            if (row) row.transports = [...new Set([...(row.transports || []), transport])];
            return null;
        }

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
