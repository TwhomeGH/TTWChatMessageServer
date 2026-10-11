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
     * @returns {boolean} 是否已在緩衝中（比對第一行原始文字）。
     */
    isDuplicate(username, message) {
        const originalPart = String(message).split('\n')[0].trim();
        return this.buffer.some(item => item.username === username && item.message === originalPart);
    }

    /**
     * 加入一筆訊息並清理過期／超出上限者。
     * @param {string} username
     * @param {string} message
     */
    add(username, message) {
        this.buffer.push({ username, message, timestamp: Date.now() });
        const now = Date.now();
        this.buffer = this.buffer.filter(item => now - item.timestamp <= this.ttlMs);
        if (this.buffer.length > this.max) this.buffer.shift();
    }

    /** @returns {number} 目前緩衝筆數。 */
    get size() { return this.buffer.length; }
}
