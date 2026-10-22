import identity from './identity.cjs';

const { normalizeBroadcaster } = identity;

const PLATFORM_IDENTITIES = Object.freeze({
    TikTok: 'tiktokName',
    Twitch: 'twitchUser',
    Kick: 'kickName',
    Odysee: 'odyseeName',
    Youtube: 'youtubeName'
});

/**
 * 依平台取得目前觀測中的主播識別。
 *
 * 缺少設定時回傳 undefined，不以暱稱、留言者 ID 或平台名稱猜測身分；
 * 這讓沒有明確來源的場次維持「未分類」，而不是被錯歸到別人身上。
 *
 * @param {string} platform 平台名稱（TikTok／Twitch／Kick／Odysee／Youtube）。
 * @param {Object} identities 各平台的主播識別。
 * @returns {string|undefined} 正規化後的主播識別；YouTube UC ID 保留大小寫。
 */
export function broadcasterForPlatform(platform, identities = {}) {
    const key = PLATFORM_IDENTITIES[platform];
    const value = key ? identities[key] : '';
    const normalized = typeof value === 'string' ? normalizeBroadcaster(value, platform) : '';
    return normalized || undefined;
}
