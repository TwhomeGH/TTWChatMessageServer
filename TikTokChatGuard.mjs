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
     * @param {number} [options.initialToleranceMs=5000] 初次連線可容忍的時間差（ms）。
     * @param {number} [options.initialGuardMs=30000] 初次連線的安全冷卻提示期（ms）。
     * @param {number} [options.ttlMs=1800000] 已見 id 的保留時間（ms）。
     * @param {number} [options.maxIds=10000] 已見 id 上限。
     */
    constructor({ now = Date.now, toleranceMs = 3000, initialToleranceMs = 5000,
        initialGuardMs = 30000, ttlMs = 30 * 60 * 1000, maxIds = 10000 } = {}) {
        Object.assign(this, { now, toleranceMs, initialToleranceMs, initialGuardMs, ttlMs, maxIds });
        this.seen = new Map();
        this.cutoff = null;
        this.guardUntil = 0;
        this.mode = null;
        this.rejected = 0;
        this.lastReason = null;
    }
    /**
     * 初次連線：忽略時間戳早於連線前容差的事件，並保留一段可見的安全冷卻期。
     * 這是時間戳過濾，不是封鎖所有聊天；連線後的新訊息仍會通過。
     * @returns {{mode: string, active: boolean, remainingMs: number, cutoff: number|null, rejected: number, lastReason: string|null}}
     */
    beginConnection() {
        const now = this.now();
        this.cutoff = now - this.initialToleranceMs;
        this.guardUntil = now + this.initialGuardMs;
        this.mode = 'initial';
        this.rejected = 0;
        this.lastReason = null;
        return this.status();
    }
    /**
     * 標記進入重連：之後早於 now - toleranceMs 的事件一律拒絕。
     * @returns {void}
     */
    beginReconnect() {
        // Set before connect(): replay events can arrive before its promise resolves.
        this.cutoff = this.now() - this.toleranceMs;
        this.guardUntil = 0;
        this.mode = 'reconnect';
        this.rejected = 0;
        this.lastReason = null;
    }
    /**
     * 目前安全冷卻狀態；重連模式沒有前端倒數。
     * @returns {{mode: string|null, active: boolean, remainingMs: number, cutoff: number|null, rejected: number, lastReason: string|null}}
     */
    status() {
        const now = this.now();
        return {
            mode: this.mode,
            active: now < this.guardUntil,
            remainingMs: Math.max(0, this.guardUntil - now),
            cutoff: this.cutoff,
            rejected: this.rejected,
            lastReason: this.lastReason
        };
    }
    /**
     * 檢查一則訊息是否接受，並同步保留其 id（在翻譯／通知等 async 動作前先保留）。
     * @param {Object} data TikTok 訊息原始物件。
     * @returns {{accepted: boolean, reason: 'duplicate-id'|'before-connect'|'before-reconnect'|null}}
     */
    check(data) {
        const now = this.now();
        for (const [id, at] of this.seen) {
            if (now - at < this.ttlMs) break;
            this.seen.delete(id);
        }
        const { id, time } = chatMetadata(data);
        if (id && this.seen.has(id)) {
            this.rejected++;
            this.lastReason = 'duplicate-id';
            return { accepted: false, reason: 'duplicate-id' };
        }
        if (this.cutoff !== null && time !== null && time < this.cutoff) {
            const reason = this.mode === 'initial' ? 'before-connect' : 'before-reconnect';
            this.rejected++;
            this.lastReason = reason;
            return { accepted: false, reason };
        }
        // Reserve synchronously, before translation/notifications can yield.
        if (id) {
            this.seen.set(id, now);
            while (this.seen.size > this.maxIds) this.seen.delete(this.seen.keys().next().value);
        }
        return { accepted: true, reason: null };
    }
}
