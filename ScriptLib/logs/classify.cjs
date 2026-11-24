/**
 * 將 console 文字整理成可查詢的日誌分類與嚴重度。
 *
 * `level` 是錯誤嚴重度，`category` 是排查主題（TikTok、Socket、AutoClip…）；
 * 兩者分開，避免「[OUT] 內含 AutoClip」只能落在 out 而無法用主題查詢。
 */

const CATEGORY_RULES = [
    ['raw', /^\[RAW\]/i],
    ['member', /\[MEMBER\]/i],
    ['autoclip', /\[AutoClip\]|AutoClip|剪輯/i],
    ['tiktok', /\[TikTok\]|TikTok|Webcast|signer/i],
    ['twitch', /\[Twitch\]|Twitch|G#clip|G#Ad/i],
    ['kick', /\[Kick\]|Kick/i],
    ['youtube', /\[YouTube\]|\[Youtube\]|YouTube|Youtube/i],
    ['odysee', /\[Odysee\]|Odysee/i],
    ['socket', /\[Socket\]|Socket|TCP|endpoint/i],
    ['monitor', /\[Monitor|monitor|監控/i],
    ['traffic', /\[Traffic\]|traffic|人流/i],
    ['audience', /\[Audience\]|audience|常客/i],
    ['media', /\[Media|MediaCache|media cache/i],
    ['browser', /\[Browser\]|\[BROWSER\]|browser|瀏覽器/i],
    ['platform', /\[Platform\]|\[PLATFORM\]|平台/i],
    ['transport', /\[Transport\]|\[TRANSPORT\]|收發/i],
    ['sponsor', /\[Sponsor\]|sponsor|贊助/i],
    ['gift', /\[Gift\]|gift|禮物/i],
    ['runtime', /\[Runtime\]|\[RUNTIME\]|運行狀態/i],
    ['diagnostics', /\[Diagnostics\]|\[Diagnostic\]|診斷/i],
    ['chat', /^Chat:|聊天|過濾器|Filter|過濾/i],
    ['system', /^\[SYSTEM\]|系統/i],
    ['metrics', /\[METRICS\]|metrics/i],
    ['error', /^\[ERR\]|錯誤|Error/i],
    ['out', /^\[OUT\]/i]
];

/**
 * @param {string} text
 * @returns {string} 主題分類；無法判斷時為 other。
 */
function classifyCategory(text = '') {
    const value = String(text);
    for (const [category, pattern] of CATEGORY_RULES) {
        if (pattern.test(value)) return category;
    }
    return 'other';
}

/**
 * @param {string} text
 * @returns {'error'|'warn'|'info'|'debug'} 適合日誌檢視器的嚴重度。
 */
function classifyLevel(text = '') {
    const value = String(text);
    if (/^\[ERR\]|❌|\b(?:Error|error|Exception|exception|失敗)\b/.test(value)) return 'error';
    if (/⚠️|警告|warn/i.test(value)) return 'warn';
    if (/^\[RAW\]|^\[OUT\]|^\[DEBUG\]|debug/i.test(value)) return 'debug';
    return 'info';
}

/**
 * @param {string} text
 * @returns {'main'|'child'|'signer'|'userscript'} 日誌來源。
 */
function classifySource(text = '') {
    const value = String(text);
    if (/^\[OUT\]|^\[ERR\]|^\[RAW\]/.test(value)) return 'child';
    if (/signer|SignServer|签名|簽名/i.test(value)) return 'signer';
    if (/userscript|Tampermonkey/i.test(value)) return 'userscript';
    return 'main';
}

module.exports = { classifyCategory, classifyLevel, classifySource };
