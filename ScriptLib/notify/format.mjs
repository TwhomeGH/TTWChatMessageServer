// 推播文字／圖示格式化：Bark 與 ntfy 共用。
// emoji 對照表由呼叫端以 getter 注入，本模組不依賴 EmojiMap.js，方便單元測試。

const IMG_URL_RE = /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?/i;

/** 移除內文裡的圖片網址（emoji 圖或使用者貼的圖）。 */
export function stripEmojiUrls(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/https?:\/\/[^\s]+(?:png|jpg|jpeg|gif|webp)[^\s]*/gi, '').trim();
}

/** 從內文挑一個出現過的 emoji 代碼；回傳 { code, url } 或 null。 */
export function pickEmojiIcon(comment, map = {}) {
    if (!comment || typeof comment !== 'string') return null;
    const matched = Object.entries(map).filter(([code]) => comment.includes(code));
    if (matched.length === 0) return null;
    const [code, url] = matched[Math.floor(Math.random() * matched.length)];
    return { code, url };
}

/** 移除內文裡的 emoji 代碼；keepCode 保留（出現多於一次時摘要為「code xN」）。 */
export function stripEmojiCodes(text, keepCode, map = {}) {
    if (!text || typeof text !== 'string') return text;
    let result = text;
    for (const code of Object.keys(map)) {
        if (code === keepCode) continue;
        result = result.split(code).join('');
    }
    if (keepCode) {
        const escaped = keepCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const count = (result.match(new RegExp(escaped, 'g')) || []).length;
        if (count > 1) {
            result = result.replace(new RegExp(escaped, 'g'), '').trim();
            result = keepCode + ' x' + count + (result ? ' ' + result : '');
        }
    }
    return result.replace(/\s+/g, ' ').trim();
}

/**
 * 一次算好推播要用的圖示與內文；Bark 與 ntfy 共用同一套規則。
 * @param {string} comment 原始訊息
 * @param {string} [fallbackIcon] 找不到 emoji／圖片時沿用的圖示
 * @param {Object} [map] emoji code → 圖片網址
 * @returns {{icon: (string|undefined), body: string}}
 */
export function buildNotification(comment, fallbackIcon, map = {}) {
    const pick = pickEmojiIcon(comment, map);
    let icon = pick ? pick.url : fallbackIcon;
    if (!pick && typeof comment === 'string') {
        const imgMatch = comment.match(IMG_URL_RE);
        if (imgMatch) icon = imgMatch[0];
    }
    const body = stripEmojiCodes(stripEmojiUrls(comment), pick ? pick.code : null, map);
    return { icon, body };
}
