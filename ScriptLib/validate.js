// CommonJS：供 EmojiStore.cjs 同步載入。
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.status = 400; // 可以加上 HTTP 狀態碼語意
    }
}



/**
 * 驗證 emoji 對應表
 * @param {Object} map - JSON 物件
 * @returns {Object} 驗證後的 map
 * @throws {ValidationError} 當格式不合法時
 */
function validate(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
        throw new ValidationError('對應表必須是 JSON 物件');
    }

    for (const [code, url] of Object.entries(map)) {
        if (!code.trim() || code.length > 200) {
            throw new ValidationError('表情代碼不可空白，最長 200 字元');
        }
        if (typeof url !== 'string' || url.length > 4096) {
            throw new ValidationError('圖片網址格式錯誤');
        }

        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            throw new ValidationError('圖片網址必須是完整 HTTP(S) 網址');
        }

        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
            throw new ValidationError('圖片僅支援不含帳密的 HTTP(S) 網址');
        }
    }

    return Object.fromEntries(Object.entries(map));
}

module.exports = { validate, ValidationError };

