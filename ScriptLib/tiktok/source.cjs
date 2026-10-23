const MODES = new Set(['auto', 'native', 'browser']);

/**
 * 決定 TikTok 聊天來源。
 *
 * auto：有 EulerStream／Cookie／Direct Signer 就用原生，否則用專用瀏覽器＋userscript。
 * native：強制原生；browser：強制專用瀏覽器，不啟動原生 TikTok 連線。
 *
 * @param {Object} [env=process.env] 環境變數。
 * @returns {'native'|'browser'} 實際聊天來源。
 */
function tiktokChatSource(env = process.env) {
    const configured = String(env.TIKTOK_CHAT_SOURCE || 'auto').toLowerCase();
    if (MODES.has(configured) && configured !== 'auto') return configured;
    const canNative = Boolean(
        env.SIGN_API_KEY || env.SIGN_API ||
        env.TIKTOK_COOKIES || env.SESSION_ID ||
        env.DIRECT_SIGNER_ENABLED === '1'
    );
    return canNative ? 'native' : 'browser';
}

module.exports = { tiktokChatSource };
