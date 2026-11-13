import { BarkChannel } from './channels/bark.mjs';
import { NtfyChannel, parseNtfyTarget } from './channels/ntfy.mjs';

export { BarkChannel, NtfyChannel, parseNtfyTarget };
export * from './format.mjs';

/** 推播器：把一則通知扇出到所有已啟用通道；通道可執行中個別開關。 */
export class Notifier {
    constructor(channels = []) {
        // 保留已設定的通道；active 才是執行中開關，enabled 仍代表 URL 有效。
        this.channels = channels.filter(channel => channel && channel.enabled);
        for (const channel of this.channels) {
            if (typeof channel.active !== 'boolean') channel.active = true;
        }
    }

    /** 目前實際會發送的通道名稱。 */
    get enabled() {
        return this.channels.filter(channel => channel.active && channel.enabled).map(channel => channel.name);
    }

    /**
     * 執行中開關單一通道；沒有該通道或 URL 無效時仍安全。
     * @param {string} name
     * @param {boolean} enabled
     * @returns {string[]} 套用後實際啟用的通道。
     */
    setEnabled(name, enabled) {
        const channel = this.channels.find(item => item.name === name);
        if (channel) channel.active = Boolean(enabled);
        return this.enabled;
    }

    /** 查詢單一通道是否正在運作（含 URL 有效性）。 */
    isEnabled(name) {
        const channel = this.channels.find(item => item.name === name);
        return Boolean(channel && channel.active && channel.enabled);
    }

    /**
     * 送出通知；缺漏的欄位由各通道自行容忍。永不 reject。
     * @param {string} title
     * @param {string} comment
     * @param {string} [icon]
     * @param {string} [url] 點擊後開啟的網址
     * @returns {Promise<Array<{channel: string, ok: boolean}>>} 各通道結果；未啟用通道不列入。
     */
    async notify(title = 'Twitch', comment, icon, url) {
        const active = this.channels.filter(channel => channel.active && channel.enabled);
        const settled = await Promise.allSettled(active.map(channel => channel.send({ title, comment, icon, link: url })));
        return active.map((channel, index) => ({
            channel: channel.name,
            ok: settled[index].status === 'fulfilled' && settled[index].value === true
        }));
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
    // 即使啟動時關閉，也要保留通道物件，之後才能用 setEnabled 動態開啟。
    const bark = new BarkChannel({ url: barkApi, getEmojiMap, axios, logger });
    const ntfy = new NtfyChannel({ url: ntfyApi, getEmojiMap, axios, logger });
    bark.active = Boolean(isBark);
    ntfy.active = Boolean(isNtfy);
    return new Notifier([bark, ntfy]);
}
