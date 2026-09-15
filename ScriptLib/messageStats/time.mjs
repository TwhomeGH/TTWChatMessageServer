/**
 * 將 Date、日期字串或秒／毫秒時間戳轉成毫秒。
 * 僅接受 2000 年起至現在後 60 秒；缺值、布林與無效時間回傳 null。
 * @param {*} value 外部訊息提供的時間
 * @returns {number|null} 有效的毫秒時間戳
 */
export function messageTime(value) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    let n = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(n) && typeof value === 'string') n = Date.parse(value);
    if (n > 0 && n < 1e11) n *= 1000;
    return Number.isFinite(n) && n >= 946684800000 && n <= Date.now() + 60000 ? n : null;
}

