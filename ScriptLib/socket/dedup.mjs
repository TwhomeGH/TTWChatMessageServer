/**
 * 訊息去重緩衝：避免同一則訊息在重連補發或跨路徑（原生／userscript）時重複送出。
 * 只比對第一行原始文字（翻譯會附加在 \n 之後）；預設保留 60 秒、上限 500 筆。
 */
export class MessageDedup {
    constructor({ ttlMs = 60000, max = 500 } = {}) {
        this.ttlMs = ttlMs;
        this.max = max;
        this.buffer = [];
    }

    /** @returns {boolean} 是否已在緩衝中（比對第一行原始文字）。 */
    isDuplicate(username, message) {
        const originalPart = String(message).split('\n')[0].trim();
        return this.buffer.some(item => item.username === username && item.message === originalPart);
    }

    add(username, message) {
        this.buffer.push({ username, message, timestamp: Date.now() });
        const now = Date.now();
        this.buffer = this.buffer.filter(item => now - item.timestamp <= this.ttlMs);
        if (this.buffer.length > this.max) this.buffer.shift();
    }

    get size() { return this.buffer.length; }
}
