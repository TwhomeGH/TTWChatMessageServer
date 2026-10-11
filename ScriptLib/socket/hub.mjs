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

    connect() { for (const endpoint of this.endpoints) endpoint.connect(); }

    async close(finalPayload, timeoutMs = 2000) {
        await Promise.all(this.endpoints.map(endpoint => endpoint.close(finalPayload, timeoutMs)));
    }

    /** 直接送出一則已組好的 payload（依 category 過濾）。 */
    send(payload) {
        for (const endpoint of this.endpoints) {
            if (endpoint.accepts(payload.category)) endpoint.send(payload);
        }
    }

    /**
     * 高階送訊息：去重 → 套用 emoji 取代 → 組 StreamMessage → 扇出。
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
 * 依環境設定建立 hub。目前接受單一 SOCKET_API；多端點（SOCKET_APIS）於後續擴充。
 * @returns {SocketHub}
 */
export function createHub({ socketApi = 'tcp://localhost:9322', enabled = true, onConnect, replaceEmojis, dedup, logger = console } = {}) {
    const endpoints = [];
    if (enabled) endpoints.push(new SocketEndpoint({ url: socketApi, enabled, onConnect, logger }));
    return new SocketHub({ endpoints, dedup, replaceEmojis, logger });
}
