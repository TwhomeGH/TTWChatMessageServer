// Only platform event metadata is used; user.createTime is account creation time.
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

export class TikTokChatGuard {
    constructor({ now = Date.now, toleranceMs = 3000, ttlMs = 30 * 60 * 1000,
        maxIds = 10000 } = {}) {
        Object.assign(this, { now, toleranceMs, ttlMs, maxIds });
        this.seen = new Map();
        this.cutoff = null;
    }
    beginReconnect() {
        // Set before connect(): replay events can arrive before its promise resolves.
        this.cutoff = this.now() - this.toleranceMs;
    }
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
