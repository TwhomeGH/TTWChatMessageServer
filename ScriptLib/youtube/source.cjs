const MODES = new Set(['auto', 'native', 'browser', 'manual']);

/**
 * 決定 YouTube 聊天來源。
 *
 * auto：有 OAuth 用原生，否則用程式專用瀏覽器。
 * native：只用原生；browser：只用程式專用瀏覽器；manual：不啟動程式來源，只收外部 userscript。
 *
 * @param {Object} [env=process.env] 環境變數。
 * @returns {'auto'|'native'|'browser'|'manual'} 設定的來源模式。
 */
function youtubeChatSource(env = process.env) {
    const configured = String(env.YOUTUBE_CHAT_SOURCE || 'auto').toLowerCase();
    return MODES.has(configured) ? configured : 'auto';
}

module.exports = { youtubeChatSource };
