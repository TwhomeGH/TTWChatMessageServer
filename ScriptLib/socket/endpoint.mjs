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
    constructor({ url, enabled = true, filter, onConnect, logger = console, transportOptions = {} } = {}) {
        this.filter = normalizeFilter(filter);
        const { host, port } = parseSocketUrl(url);
        this.transport = new SocketTransport({ host, port, enabled, onConnect, logger, ...transportOptions });
    }

    get enabled() { return this.transport.enabled; }
    get connected() { return this.transport.connected; }

    /** @returns {boolean} 此端點是否接收這個 category。 */
    accepts(category) { return !this.filter || this.filter.has(category); }

    send(payload) { return this.transport.send(payload); }
    connect() { this.transport.connect(); }
    close(finalPayload, timeoutMs) { return this.transport.close(finalPayload, timeoutMs); }
}

function normalizeFilter(filter) {
    if (!filter) return null;
    const list = Array.isArray(filter) ? filter : String(filter).split(',');
    const set = new Set(list.map(value => String(value).trim()).filter(Boolean));
    return set.size ? set : null;
}
