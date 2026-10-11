import { buildNotification } from '../format.mjs';

/**
 * Bark 推播通道：POST JSON 到 BARK_API。
 * I/O（axios）與 emoji 表（getEmojiMap）皆注入，方便單元測試與重用。
 */
export class BarkChannel {
    /**
     * @param {Object} options
     * @param {string} options.url BARK_API 網址。
     * @param {() => Object} [options.getEmojiMap] 取得 emoji 對照表的函式。
     * @param {{post: Function}} options.axios
     * @param {Console} [options.logger=console]
     */
    constructor({ url, getEmojiMap = () => ({}), axios, logger = console } = {}) {
        this.name = 'bark';
        this.url = url;
        this.getEmojiMap = getEmojiMap;
        this.axios = axios;
        this.logger = logger;
    }

    /** @returns {boolean} 是否有可用的 BARK_API 設定。 */
    get enabled() {
        return !!this.url && String(this.url).toLowerCase() !== 'none';
    }

    /**
     * @param {Object} notification
     * @param {string} [notification.title]
     * @param {string} notification.comment 訊息內文。
     * @param {string} [notification.icon] 找不到 emoji 時沿用的圖示。
     * @param {string} [notification.link] 點擊後開啟的網址。
     * @returns {Promise<boolean>} 是否送出成功。
     */
    async send({ title = 'Twitch', comment, icon, link } = {}) {
        if (!this.enabled) return false;
        try {
            const { icon: finalIcon, body } = buildNotification(comment, icon, this.getEmojiMap());
            const payload = { title, body, icon: finalIcon };
            if (link) payload.url = link;
            this.logger.info(`📢 發送 Bark 通知: ${title} - ${body}`);
            await this.axios.post(this.url, payload, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
            this.logger.info('✅ Bark 推送成功');
            return true;
        } catch (err) {
            this.logger.error('❌ Bark 推送錯誤:', err.message);
            return false;
        }
    }
}
