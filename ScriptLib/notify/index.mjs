import { BarkChannel } from './channels/bark.mjs';
import { NtfyChannel, parseNtfyTarget } from './channels/ntfy.mjs';

export { BarkChannel, NtfyChannel, parseNtfyTarget };
export * from './format.mjs';

/** 推播器：把一則通知扇出到所有已啟用通道。 */
export class Notifier {
    constructor(channels = []) {
        this.channels = channels.filter(channel => channel && channel.enabled);
    }

    /** 目前實際會發送的通道名稱。 */
    get enabled() {
        return this.channels.map(channel => channel.name);
    }

    /**
     * 送出通知；缺漏的欄位由各通道自行容忍。永不 reject。
     * @param {string} title
     * @param {string} comment
     * @param {string} [icon]
     * @param {string} [url] 點擊後開啟的網址
     */
    async notify(title = 'Twitch', comment, icon, url) {
        await Promise.allSettled(this.channels.map(channel => channel.send({ title, comment, icon, link: url })));
    }
}

/**
 * 依啟動旗標與設定建出推播器；未啟用或未設定 URL 的通道不會加入。
 * @param {{isBark?: boolean, isNtfy?: boolean, barkApi?: string, ntfyApi?: string,
 *          getEmojiMap?: () => Object, axios: Object, logger?: Console}} options
 * @returns {Notifier}
 */
export function createNotifier({ isBark = false, isNtfy = false, barkApi, ntfyApi,
    getEmojiMap = () => ({}), axios, logger = console } = {}) {
    const channels = [];
    if (isBark) channels.push(new BarkChannel({ url: barkApi, getEmojiMap, axios, logger }));
    if (isNtfy) channels.push(new NtfyChannel({ url: ntfyApi, getEmojiMap, axios, logger }));
    return new Notifier(channels);
}
