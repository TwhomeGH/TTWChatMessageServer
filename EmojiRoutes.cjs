const { store } = require('./EmojiStore.cjs');
const { sendJson } = require('./ScriptLib/emoji/http.cjs');
const { sendPage, getMapping, changeMapping } = require('./ScriptLib/emoji/handlers.cjs');

/**
 * 處理已匹配的路由；authorized 由主伺服器現有登入機制判定。
 * 未登入的頁面顯示登入表單，API 則回傳 401。
 */
async function dispatch(req, res, pathname, authorized) {
    if (!authorized) {
        if (pathname === '/api/emoji') {
            sendJson(res, 401, { success: false, error: '請先登入' });
            return;
        }
        return sendPage(res, false);
    }
    if (pathname === '/emoji' && req.method === 'GET') return sendPage(res, true);
    if (pathname === '/api/emoji' && req.method === 'GET') return getMapping(res, store);
    if (pathname === '/api/emoji' && req.method === 'POST') return changeMapping(req, res, store);
    sendJson(res, 405, { success: false, error: '不支援的請求' });
}

/**
 * 同步回傳是否接管請求，供 Server.js 的路由鏈提早返回。
 * 回應非同步完成；錯誤統一轉成 JSON，避免未捕捉的 Promise rejection。
 * @returns {boolean} 是否為表情管理路由
 */
function serveEmoji(req, res, authorized) {
    const pathname = req.url.split('?')[0];
    if (!['/emoji', '/api/emoji'].includes(pathname)) return false;
    dispatch(req, res, pathname, authorized).catch(error => {
        sendJson(res, error.status || 400, { success: false, error: error.message });
    });
    return true;
}

module.exports = { serveEmoji };
