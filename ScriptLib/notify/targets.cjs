/**
 * 解析 ntfy 主題名稱或 HTTP(S) 發布網址。單一主題名稱使用 ntfy.sh。
 * @param {string} raw 主題名稱或完整網址（自架可含子路徑／Basic Auth）。
 * @returns {{base:string,topic:string,auth:({username:string,password:string}|undefined)}|null} 無效或停用時回傳 null。
 */
function parseNtfyTarget(raw) {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value || value.toLowerCase() === 'none') return null;
    try {
        const url = /^[a-zA-Z0-9_-]+$/.test(value)
            ? new URL('https://ntfy.sh/' + value) : new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
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

/**
 * 回報通知設定的可用狀態；不將網址、主題或認證資訊傳到前端。
 * @param {Object} env 包含 NTFY_API、BARK_API 的目前設定。
 * @returns {Object} 通道布林狀態與 missing／invalid／ready 原因。
 */
function notificationAvailability(env) {
    const details = {};
    for (const [channel, key] of [['ntfy', 'NTFY_API'], ['bark', 'BARK_API']]) {
        const value = typeof env[key] === 'string' ? env[key].trim() : '';
        let valid = false;
        if (channel === 'ntfy') valid = !!parseNtfyTarget(value);
        else {
            try { valid = ['http:', 'https:'].includes(new URL(value).protocol); } catch { /* 無效網址只回報狀態。 */ }
        }
        details[channel] = {
            state: !value || value.toLowerCase() === 'none' ? 'missing' : valid ? 'ready' : 'invalid',
            mode: channel === 'ntfy' && valid && /^[a-zA-Z0-9_-]+$/.test(value) ? 'topic' : 'url'
        };
    }
    return { ntfy: details.ntfy.state === 'ready', bark: details.bark.state === 'ready', details };
}

module.exports = { parseNtfyTarget, notificationAvailability };
