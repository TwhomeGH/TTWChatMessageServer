import { SocketTransport } from './transport.mjs';

/**
 * 把 SOCKET_API（tcp://host:port 或 http://host:port）解析成 host/port。
 * @param {string} raw
 * @param {number} [fallbackPort=9322]
 * @returns {{host: string, port: number}}
 */
export function parseSocketUrl(raw, fallbackPort = 9322) {
    const url = new URL(raw);
    return {
        host: url.hostname.replace(/^\[|\]$/g, ''),
        port: Number(url.port || fallbackPort)
    };
}

/**
 * 單一 socket 目的地：包住一個 SocketTransport，並依 category 決定是否接收。
 * filter 為空 = 全部接收（fan-out）；有值 = 只接收列出的 category。
 */
export class SocketEndpoint {
    /**
     * @param {Object} options
     * @param {string} options.url 端點網址（tcp://host:port 或 http://host:port）。
     * @param {boolean} [options.enabled=true] 是否啟用。
     * @param {(string|string[])} [options.filter] 允許的 category；空＝全部。
     * @param {() => void} [options.onConnect] 連線建立時的回呼。
     * @param {Console} [options.logger=console]
     * @param {Object} [options.transportOptions] 覆寫 SocketTransport 的選項（測試用）。
     */
    constructor({ url, enabled = true, filter, onConnect, logger = console, transportOptions = {} } = {}) {
        this.filter = normalizeFilter(filter);
        const { host, port } = parseSocketUrl(url);
        this.transport = new SocketTransport({ host, port, enabled, onConnect, logger, ...transportOptions });
    }

    /** @returns {boolean} 傳輸層是否啟用。 */
    get enabled() { return this.transport.enabled; }
    /** @returns {boolean} 目前是否已連線。 */
    get connected() { return this.transport.connected; }

    /**
     * @param {string} category
     * @returns {boolean} 此端點是否接收這個 category。
     */
    accepts(category) { return !this.filter || this.filter.has(category); }

    /**
     * @param {Object} payload
     * @returns {boolean} 是否已排入傳輸佇列。
     */
    send(payload) { return this.transport.send(payload); }

    /** 建立連線。 */
    connect() { this.transport.connect(); }

    /**
     * @param {Object} [finalPayload] 關閉前送出的最後一則訊息。
     * @param {number} [timeoutMs]
     * @returns {Promise<void>}
     */
    close(finalPayload, timeoutMs) { return this.transport.close(finalPayload, timeoutMs); }
}

/**
 * 把 filter（字串或陣列）正規化為 Set；空值回傳 null 代表全部接收。
 * @param {(string|string[])} filter
 * @returns {Set<string>|null}
 */
function normalizeFilter(filter) {
    if (!filter) return null;
    const list = Array.isArray(filter) ? filter : String(filter).split(',');
    const set = new Set(list.map(value => String(value).trim()).filter(Boolean));
    return set.size ? set : null;
}
