/**
 * 訊息去重緩衝：避免同一則訊息在重連補發或跨路徑（原生／userscript）時重複送出。
 * 只比對第一行原始文字（翻譯會附加在 \n 之後）；預設保留 60 秒、上限 500 筆。
 */
export class MessageDedup {
    /**
     * @param {Object} [options]
     * @param {number} [options.ttlMs=60000] 保留時間（毫秒）。
     * @param {number} [options.max=500] 最大筆數；超過時丟棄最舊。
     */
    constructor({ ttlMs = 60000, max = 500 } = {}) {
        this.ttlMs = ttlMs;
        this.max = max;
        this.buffer = [];
    }

    /**
     * @param {string} username
     * @param {string} message
     * @param {string} [variant] 額外辨識（例如測試訊息的頭貼）；空字串維持原本行為。
     * @returns {boolean} 是否已在緩衝中（比對第一行原始文字）。
     */
    isDuplicate(username, message, variant = '') {
        const originalPart = String(message).split('\n')[0].trim();
        const key = String(variant || '');
        return this.buffer.some(item => item.username === username && item.message === originalPart && (item.variant || '') === key);
    }

    /**
     * 查詢相符項目剩餘的保護時間；沒有相符項目回 0。
     * @param {string} username
     * @param {string} message
     * @param {string} [variant]
     * @returns {number} 毫秒。
     */
    remaining(username, message, variant = '') {
        const originalPart = String(message).split('\n')[0].trim();
        const key = String(variant || '');
        const now = Date.now();
        let remaining = 0;
        for (const item of this.buffer) {
            if (item.username !== username || item.message !== originalPart || (item.variant || '') !== key) continue;
            remaining = Math.max(remaining, this.ttlMs - (now - item.timestamp));
        }
        return Math.max(0, remaining);
    }

    /**
     * 加入一筆訊息並清理過期／超出上限者。
     * @param {string} username
     * @param {string} message
     * @param {string} [variant] 額外辨識（例如測試訊息的頭貼）。
     */
    add(username, message, variant = '') {
        this.buffer.push({ username, message, variant: String(variant || ''), timestamp: Date.now() });
        const now = Date.now();
        this.buffer = this.buffer.filter(item => now - item.timestamp <= this.ttlMs);
        if (this.buffer.length > this.max) this.buffer.shift();
    }

    /** @returns {number} 目前緩衝筆數。 */
    get size() { return this.buffer.length; }
}
