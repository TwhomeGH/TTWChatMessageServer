import { buildNotification } from '../format.mjs';

/**
 * Bark 推播通道：POST JSON 到 BARK_API。
 * I/O（axios）與 emoji 表（getEmojiMap）皆注入，方便單元測試與重用。
 */
export class BarkChannel {
    constructor({ url, getEmojiMap = () => ({}), axios, logger = console } = {}) {
        this.name = 'bark';
        this.url = url;
        this.getEmojiMap = getEmojiMap;
        this.axios = axios;
        this.logger = logger;
    }

    get enabled() {
        return !!this.url && String(this.url).toLowerCase() !== 'none';
    }

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
