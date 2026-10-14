/**
 * TikTok 原始事件摘要日誌：只輸出精選欄位，避免整包事件資料洗版。
 */

/**
 * 記錄一則 TikTok 原始事件的精選摘要。
 * @param {string} eventName 事件名稱。
 * @param {Object} data 原始事件資料。
 * @param {Console} [logger=console]
 * @returns {void}
 */
export function logRawEvent(eventName, data, logger = console) {
    if (!data) { logger.log(`[RAW] ${eventName}: (no data)`); return; }
    const keys = Object.keys(data).filter(k => {
        const v = data[k];
        if (v === null || v === undefined) return false;
        if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
        return true;
    });
    const info = { event: eventName, keys };
    if (data.user && typeof data.user === 'object') {
        const u = data.user;
        info.user = {};
        if (u.displayId !== undefined) info.user.displayId = u.displayId;
        if (u.nickname !== undefined) info.user.nickname = u.nickname;
        if (u.id !== undefined) info.user.id = u.id;
        if (u.uniqueId !== undefined) info.user.uniqueId = u.uniqueId;
        if (u.role !== undefined) info.user.role = u.role;
        if (u.level !== undefined) info.user.level = u.level;
        if (u.badge !== undefined) info.user.badge = u.badge;
        if (u.isModerator !== undefined) info.user.isModer = u.isModerator;
        if (u.isSubscriber !== undefined) info.user.isSub = u.isSubscriber;
        if (u.isNewGifter !== undefined) info.user.isNewGifter = u.isNewGifter;
        if (Object.keys(info.user).length === 0) delete info.user;
    }
    if (data.gift && typeof data.gift === 'object') {
        const g = data.gift;
        info.gift = {};
        if (g.name !== undefined) info.gift.name = g.name;
        if (g.id !== undefined) info.gift.id = g.id;
        if (g.diamondCount !== undefined) info.gift.cost = g.diamondCount;
        if (g.repeatCount !== undefined) info.gift.repeat = g.repeatCount;
        if (g.repeatEnd !== undefined) info.gift.repeatEnd = g.repeatEnd;
        if (g.type !== undefined) info.gift.type = g.type;
        if (g.streakable !== undefined) info.gift.streakable = g.streakable;
        if (g.giftType !== undefined) info.gift.giftType = g.giftType;
        if (Object.keys(info.gift).length === 0) delete info.gift;
    }
    // Common fields
    if (data.content !== undefined) info.content = typeof data.content === 'string' ? data.content.substring(0, 120) : '[non-string]';
    if (data.action !== undefined) info.action = data.action;
    if (data.shareType !== undefined) info.shareType = data.shareType;
    if (data.shareTarget !== undefined) info.shareTarget = data.shareTarget;
    if (data.likeCount !== undefined) info.likeCount = data.likeCount;
    if (data.total !== undefined) info.total = data.total;
    if (data.count !== undefined) info.count = data.count;
    if (data.describe !== undefined) info.describe = data.describe;
    if (data.msgId !== undefined) info.msgId = data.msgId;
    if (data.createTime !== undefined) info.createTime = data.createTime;
    if (data.emoteId !== undefined) info.emoteId = data.emoteId;
    if (data.followRole !== undefined) info.followRole = data.followRole;
    if (data.memberCount !== undefined) info.memberCount = data.memberCount;
    if (data.viewersCount !== undefined) info.viewersCount = data.viewersCount;
    if (data.topViewers !== undefined) info.topViewers = data.topViewers;
    if (data.roomId !== undefined) info.roomId = data.roomId;
    if (data.subscribeType !== undefined) info.subscribeType = data.subscribeType;
    if (data.timestampMs !== undefined) info.timestampMs = data.timestampMs;
    if (data.currency !== undefined) info.currency = data.currency;
    if (data.amount !== undefined) info.amount = data.amount;
    if (data.multibuy !== undefined) info.multibuy = data.multibuy;
    logger.log(`[RAW] ${JSON.stringify(info)}`);
}
