const YOUTUBE_CHANNEL_ID = /^UC[\w-]{20,}$/;

/**
 * 正規化主播識別。
 *
 * YouTube 的頻道 ID（UC...）大小寫敏感，必須保留原樣；@handle 只作為 fallback，
 * 仍轉小寫以維持舊資料的比對。其他平台沿用原本的去 @、去空白、轉小寫規則。
 *
 * @param {string} value 原始主播識別。
 * @param {string|null} platform 平台名稱（可省略）。
 * @returns {string} 正規化後的主播識別；空白回傳空字串。
 */
function normalizeBroadcaster(value, platform = null) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim().replace(/^@/, '').trim();
    if (!trimmed) return '';
    const youtube = platform === 'Youtube' || platform === 'YouTube';
    if (YOUTUBE_CHANNEL_ID.test(trimmed) && (youtube || platform == null)) return trimmed;
    return trimmed.toLowerCase();
}

module.exports = { normalizeBroadcaster, YOUTUBE_CHANNEL_ID };
