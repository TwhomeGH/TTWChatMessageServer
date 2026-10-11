import { buildNotification } from '../format.mjs';

// ntfy 的 icon 只支援 JPEG/PNG，其他格式略過。
const NTFY_ICON_RE = /\.(?:png|jpe?g)(?:\?|$)/i;

/**
 * 解析 ntfy 目標：NTFY_API 形如 https://ntfy.sh/<topic>（自架可含子路徑）。
 * 用 JSON publish（POST 到 server 根、topic 放 body）避免中文標題進 HTTP header 出錯。
 * @returns {{base: string, topic: string, auth: ({username: string, password: string}|undefined)}|null}
 */
export function parseNtfyTarget(raw) {
    try {
        const url = new URL(raw);
        const segments = url.pathname.split('/').filter(Boolean);
        const topic = segments.pop();
        if (!topic) return null;
        const base = url.origin + (segments.length ? '/' + segments.join('/') : '') + '/';
        const auth = (url.username || url.password)
            ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
            : undefined;
        return { base, topic, auth };
    } catch { return null; }
}

/** ntfy 推播通道（JSON publish）。與 Bark 平行、可獨立開關。 */
export class NtfyChannel {
    constructor({ url, getEmojiMap = () => ({}), axios, logger = console } = {}) {
        this.name = 'ntfy';
        this.url = url;
        this.getEmojiMap = getEmojiMap;
        this.axios = axios;
        this.logger = logger;
    }

    get enabled() {
        return !!this.url && String(this.url).toLowerCase() !== 'none';
    }

    async send({ title, comment, icon, link } = {}) {
        if (!this.enabled) return false;
        const target = parseNtfyTarget(this.url);
        if (!target) { this.logger.error('❌ ntfy 推送錯誤: NTFY_API 無效'); return false; }
        try {
            const { icon: finalIcon, body } = buildNotification(comment, icon, this.getEmojiMap());
            const payload = { topic: target.topic, title, message: body };
            if (finalIcon && NTFY_ICON_RE.test(finalIcon)) payload.icon = finalIcon;
            if (link) payload.click = link;
            this.logger.info(`📢 發送 ntfy 通知: ${title} - ${body}`);
            await this.axios.post(target.base, payload, {
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                ...(target.auth ? { auth: target.auth } : {})
            });
            this.logger.info('✅ ntfy 推送成功');
            return true;
        } catch (err) {
            this.logger.error('❌ ntfy 推送錯誤:', err.message);
            return false;
        }
    }
}
