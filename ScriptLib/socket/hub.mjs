import { SocketEndpoint } from './endpoint.mjs';
import { MessageDedup } from './dedup.mjs';

/**
 * 把一則訊息扇出到所有已啟用端點；每個端點可各自帶 category 過濾。
 * 需要傳輸層、去重、emoji 取代與心跳，此處統一組裝，事件點不必知道有幾個端點。
 */
export class SocketHub {
    constructor({ endpoints = [], dedup = new MessageDedup(), replaceEmojis = (value) => value, logger = console } = {}) {
        this.endpoints = endpoints.filter(endpoint => endpoint && endpoint.enabled);
        this.dedup = dedup;
        this.replaceEmojis = replaceEmojis;
        this.logger = logger;
    }

    /** 主要（第一個）端點，供既有診斷讀取連線狀態。 */
    get primary() { return this.endpoints[0] || null; }
    get enabled() { return this.endpoints.length > 0; }

    /** 建立所有端點連線。 */
    connect() { for (const endpoint of this.endpoints) endpoint.connect(); }

    /**
     * 關閉所有端點（受各端點的 timeoutMs 保護）。
     * @param {Object} [finalPayload] 關閉前送出的最後一則訊息。
     * @param {number} [timeoutMs=2000]
     * @returns {Promise<void>}
     */
    async close(finalPayload, timeoutMs = 2000) {
        await Promise.all(this.endpoints.map(endpoint => endpoint.close(finalPayload, timeoutMs)));
    }

    /**
     * 直接送出一則已組好的 payload（依 category 過濾）。
     * @param {Object} payload
     */
    send(payload) {
        for (const endpoint of this.endpoints) {
            if (endpoint.accepts(payload.category)) endpoint.send(payload);
        }
    }

    /**
     * 高階送訊息：去重 → 套用 emoji 取代 → 組 StreamMessage → 扇出。
     * @param {string} user
     * @param {string} message
     * @param {Object} [options]
     * @param {string} [options.img]
     * @param {string} [options.giftImg]
     * @param {boolean} [options.isMain=true]
     * @param {number} [options.userNum]
     * @param {Array} [options.userList]
     * @param {string} [options.category] 訊息分類（供端點過濾）。
     * @param {string} [options.dedupUser] 覆寫去重比對的使用者。
     * @param {string} [options.dedupMessage] 覆寫去重比對的訊息。
     * @returns {boolean} 是否實際送出（false = 被去重擋下）。
     */
    sendMessage(user, message, { img = '', giftImg = '', isMain = true, userNum = 0, userList = [], category, dedupUser, dedupMessage } = {}) {
        const checkUser = String(dedupUser ?? user).trim();
        const checkMsg = String(dedupMessage ?? message).trim();
        if (this.dedup.isDuplicate(checkUser, checkMsg)) {
            this.logger.log?.(`🚫內部 重複訊息跳過: ${user} ${message} (原始: ${checkUser} : ${checkMsg})`);
            return false;
        }
        const payload = {
            type: 'StreamMessage',
            ...(category ? { category } : {}),
            user: String(user),
            message: this.replaceEmojis(String(message)),
            img,
            giftImg,
            isMain: Boolean(isMain),
            userNum: Number(userNum),
            userList
        };
        this.send(payload);
        return true;
    }
}

/**
 * 解析單一端點設定字串：`tcp://host:port` 或 `tcp://host:port?filter=chat,gift`。
 * @param {string} entry
 * @returns {{url: string, filter: (string|undefined)}}
 */
export function parseEndpointSpec(entry) {
    const text = String(entry || '').trim();
    const qIndex = text.indexOf('?');
    if (qIndex === -1) return { url: text, filter: undefined };
    const url = text.slice(0, qIndex);
    const filter = new URLSearchParams(text.slice(qIndex + 1)).get('filter') || undefined;
    return { url, filter };
}

/**
 * 把 SOCKET_APIS 輸入切成端點清單。
 * 分隔：換行或分號一定分隔；逗號只在「該段不含 ?」時才分隔，
 * 避免把 `?filter=chat,gift` 的逗號拆開。
 * @param {(string|string[])} input
 * @returns {string[]}
 */
export function splitApis(input) {
    if (Array.isArray(input)) return input.map(value => String(value).trim()).filter(Boolean);
    const parts = [];
    for (const chunk of String(input || '').split(/[\n;]+/)) {
        const trimmed = chunk.trim();
        if (!trimmed) continue;
        if (trimmed.includes('?')) parts.push(trimmed);
        else for (const sub of trimmed.split(',')) { const s = sub.trim(); if (s) parts.push(s); }
    }
    return parts;
}

/**
 * 依環境設定建立 hub。
 * 端點來源：`socketApi`（單一）＋ `apis`（多筆，見 splitApis 的分隔規則）。
 * 相同網址會合併；未帶 filter 者＝全收，帶 filter 者只收指定 category。
 * @param {Object} [options]
 * @param {string} [options.socketApi] 單一端點網址。
 * @param {(string|string[])} [options.apis] 額外端點（可含 ?filter=）。
 * @param {boolean} [options.enabled=true]
 * @param {() => void} [options.onConnect]
 * @param {(value: string) => string} [options.replaceEmojis]
 * @param {import('./dedup.mjs').MessageDedup} [options.dedup]
 * @param {Console} [options.logger=console]
 * @returns {SocketHub}
 */
export function createHub({ socketApi, apis = [], enabled = true, onConnect, replaceEmojis, dedup, logger = console } = {}) {
    const specs = [];
    if (socketApi) specs.push(socketApi);
    for (const api of splitApis(apis)) specs.push(api);

    // 合併相同網址；收集各自的 filter（null 代表全收）。
    const byUrl = new Map();
    for (const spec of specs) {
        const { url, filter } = parseEndpointSpec(spec);
        if (!url) continue;
        if (!byUrl.has(url)) byUrl.set(url, new Set());
        const filters = byUrl.get(url);
        if (filter === undefined) {
            filters.add(null);
        } else {
            for (const name of String(filter).split(',')) {
                const trimmed = name.trim();
                if (trimmed) filters.add(trimmed);
            }
        }
    }

    const endpoints = [];
    if (enabled) {
        for (const [url, filters] of byUrl) {
            const filter = filters.has(null) ? undefined : [...filters];
            endpoints.push(new SocketEndpoint({ url, enabled, filter, onConnect, logger }));
        }
    }
    return new SocketHub({ endpoints, dedup, replaceEmojis, logger });
}
