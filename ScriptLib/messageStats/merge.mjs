import { messageTime } from './time.mjs';

/**
 * 依留言內容合併持久化快照；計數取最大值，避免重複載入造成累加。
 * 保留時間邊界、平台與管道聯集，最近明細按 key 去重後最多留 5 則。
 * @param {...Array<object>} snapshots 歷史統計列
 * @returns {Array<object>} 依計數遞減排序的新統計列
 */
export function mergeStatEntries(...snapshots) {
    const map = new Map();
    for (const entries of snapshots) {
        for (const row of entries || []) {
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
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
}

