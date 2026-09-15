/** 啟動選單與 API 共用的非敏感參數白名單。 */
const options = [
    ['isTK', 'TikTok', 'user'], ['isTwitch', 'Twitch', 'twitchUser'],
    ['isKick', 'Kick', 'kickUser'], ['isOdysee', 'Odysee', 'odyseeUser'],
    ['isYouTube', 'YouTube', 'youtubeUser'], ['isSocket', 'Socket'], ['isBark', 'Bark']
].map(([key, label, account]) => ({ key, label, group: account ? 'platforms' : 'transport', ...(account ? { account } : {}), default: false }));
/** 僅接受明確布林旗標與短帳號字串，不接受任意 CLI 或環境變數。 */
function startURL(body) {
    const invalid = () => { throw Object.assign(new Error('啟動參數無效'), { status: 400, code: 'INVALID_START_OPTIONS' }); };
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid();
    const allowed = options.flatMap(o => o.account ? [o.key, o.account] : [o.key]);
    if (Object.keys(body).some(key => !allowed.includes(key))) invalid();
    const url = new URL('http://localhost/open');
    let enabled = false;
    for (const option of options) {
        if (body[option.key] !== undefined && typeof body[option.key] !== 'boolean') invalid();
        if (body[option.key]) { url.searchParams.set(option.key, '1'); enabled = true; }
        if (option.account && body[option.account] !== undefined) {
            const value = body[option.account];
            if (typeof value !== 'string' || value.length > 200 || /[\x00-\x1f\x7f]/.test(value) || value.trim().startsWith('-')) invalid();
            if (body[option.key] && value.trim()) url.searchParams.set(option.account, value.trim());
        }
    }
    if (!enabled) invalid();
    return url;
}
module.exports = { options, startURL };
