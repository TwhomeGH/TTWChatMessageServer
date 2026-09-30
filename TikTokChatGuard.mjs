// Only platform event metadata is used; user.createTime is account creation time.
/**
 * 從訊息原始資料取出可用的訊息 id 與事件時間（ms）；純數字的 id 才採用，
 * 時間需落在合理範圍，否則為 null。
 * @param {Object} data TikTok 訊息原始物件。
 * @returns {{id: string|null, time: number|null}}
 */
export function chatMetadata(data) {
    const rawId = data.common?.msgId ?? data.msgId;
    const id = rawId == null || (typeof rawId === 'number' && !Number.isSafeInteger(rawId))
        ? null : String(rawId);
    const rawTime = data.common?.createTime ?? data.createTime;
    const numeric = rawTime == null || typeof rawTime === 'boolean' ? NaN : Number(String(rawTime));
    const milliseconds = numeric < 1e11 ? numeric * 1000 : numeric;
    return {
        id: id && /^\d+$/.test(id) && /[1-9]/.test(id) ? id : null,
        time: Number.isSafeInteger(milliseconds) && milliseconds >= 946684800000
            && milliseconds <= 4102444800000 ? milliseconds : null
    };
}

/**
 * TikTok 重連去重與時間窗守衛：阻擋重複 id 及重連前的重播事件。
 */
export class TikTokChatGuard {
    /**
     * @param {Object} [options]
     * @param {() => number} [options.now=Date.now] 取時間的函式（方便測試）。
     * @param {number} [options.toleranceMs=3000] 重連可容忍的時間差（ms）。
     * @param {number} [options.ttlMs=1800000] 已見 id 的保留時間（ms）。
     * @param {number} [options.maxIds=10000] 已見 id 上限。
     */
    constructor({ now = Date.now, toleranceMs = 3000, ttlMs = 30 * 60 * 1000,
        maxIds = 10000 } = {}) {
        Object.assign(this, { now, toleranceMs, ttlMs, maxIds });
        this.seen = new Map();
        this.cutoff = null;
    }
    /**
     * 標記進入重連：之後早於 now - toleranceMs 的事件一律拒絕。
     * @returns {void}
     */
    beginReconnect() {
        // Set before connect(): replay events can arrive before its promise resolves.
        this.cutoff = this.now() - this.toleranceMs;
    }
    /**
     * 檢查一則訊息是否接受，並同步保留其 id（在翻譯／通知等 async 動作前先保留）。
     * @param {Object} data TikTok 訊息原始物件。
     * @returns {{accepted: boolean, reason: 'duplicate-id'|'before-reconnect'|null}}
     */
    check(data) {
        const now = this.now();
        for (const [id, at] of this.seen) {
            if (now - at < this.ttlMs) break;
            this.seen.delete(id);
        }
        const { id, time } = chatMetadata(data);
        if (id && this.seen.has(id)) return { accepted: false, reason: 'duplicate-id' };
        if (this.cutoff !== null && time !== null && time < this.cutoff) {
            return { accepted: false, reason: 'before-reconnect' };
        }
        // Reserve synchronously, before translation/notifications can yield.
        if (id) {
            this.seen.set(id, now);
            while (this.seen.size > this.maxIds) this.seen.delete(this.seen.keys().next().value);
        }
        return { accepted: true, reason: null };
    }
}
