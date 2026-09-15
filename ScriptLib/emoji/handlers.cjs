const fs = require('node:fs/promises');
const path = require('node:path');
const { sendJson, readJson, httpError } = require('./http.cjs');
const ROOT = path.resolve(__dirname, '../..');

/** 載入管理頁或登入頁；先讀檔成功再送出回應標頭。 */
async function sendPage(res, authorized) {
    const file = authorized ? 'emoji.html' : 'login.html';
    let html = await fs.readFile(path.join(ROOT, file), 'utf8');
    if (!authorized) {
        html = html.replace('</head>', "<script>const REDIRECT_AFTER_LOGIN='/emoji';</script></head>");
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}

/** 重新讀取映射；檔案無效時仍回傳最後有效內容及錯誤提示。 */
async function getMapping(res, store) {
    await store.load().catch(() => {});
    sendJson(res, 200, { success: true, ...store.snapshot() });
}

/** 解析單筆修改；資料驗證、版本衝突與原子寫入由 store 負責。 */
async function changeMapping(req, res, store) {
    const action = await readJson(req);
    if (!action || typeof action.code !== 'string' || !action.code.trim()) {
        throw httpError(400, '請填寫代碼');
    }
    sendJson(res, 200, { success: true, ...await store.change(action) });
}

module.exports = { sendPage, getMapping, changeMapping };
