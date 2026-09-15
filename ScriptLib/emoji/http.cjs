/** 回傳不快取的 JSON；管理資料與錯誤使用一致格式。 */
function sendJson(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(data));
}

/** 建立可由路由轉成 HTTP 回應的錯誤。 */
function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

/**
 * 讀取有大小上限的 JSON 請求。
 * 先合併位元組再解碼，避免中文 UTF-8 字元跨 chunk 時毀損。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit 最大位元組數
 * @returns {Promise<object>} 解析後的請求內容
 */
async function readJson(req, limit = 32768) {
    if (!req.headers['content-type']?.startsWith('application/json')) {
        throw httpError(415, '請使用 JSON');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > limit) throw httpError(413, '資料過大');
        chunks.push(bytes);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

module.exports = { sendJson, httpError, readJson };
