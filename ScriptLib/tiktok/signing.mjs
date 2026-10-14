/**
 * TikTok 連線簽名設定：依環境變數決定使用直連簽名（session cookie）或 EulerStream（signApiKey）。
 */

/**
 * @typedef {Object} SigningResult
 * @property {Object} connOpts 傳給 TikTokLiveConnection 的連線選項。
 * @property {'direct'|'euler'|'direct-fallback'|'none'} mode 實際採用的模式。
 */

/**
 * 依環境變數組出 TikTok 連線選項。
 * - `SIGN_API_KEY`／`SIGN_API` 有值且未強制直連 → EulerStream。
 * - 有 `TIKTOK_COOKIES`／`SESSION_ID`（或 `DIRECT_SIGNER_ENABLED=1`）→ 直連簽名。
 * @param {Object} [env=process.env] 環境變數來源。
 * @param {Console} [logger=console]
 * @returns {SigningResult}
 */
export function buildConnectionOptions(env = process.env, logger = console) {
    const eulerKey = env.SIGN_API_KEY || env.SIGN_API;
    const hasDirectCreds = env.DIRECT_SIGNER_ENABLED === '1' || !!(env.TIKTOK_COOKIES || env.SESSION_ID);
    const useDirect = hasDirectCreds && (!eulerKey || env.DIRECT_SIGNER_PRIORITY === '1');
    const connOpts = {};
    const session = {
        cookie: {
            type: 'cookie',
            value: {
                sessionId: env.SESSION_ID || '',
                ttTargetIdc: env.TT_TARGET_IDC || 'alisg'
            }
        }
    };

    if (useDirect) {
        connOpts.session = session;
        logger.log('[TikTok] Using persistent browser signer');
        return { connOpts, mode: 'direct' };
    }
    if (eulerKey) {
        connOpts.signApiKey = eulerKey;
        logger.log('[TikTok] Using EulerStream signer (SIGN_API_KEY)');
        return { connOpts, mode: 'euler' };
    }
    if (hasDirectCreds) {
        connOpts.session = session;
        logger.warn('[TikTok] Using direct signer (no EulerStream key available)');
        return { connOpts, mode: 'direct-fallback' };
    }
    logger.warn('[TikTok] No TIKTOK_COOKIES/SESSION_ID or SIGN_API_KEY — signing may fail');
    return { connOpts, mode: 'none' };
}
