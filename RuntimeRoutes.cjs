const fs = require('node:fs');
const path = require('node:path');
const { options, startURL } = require('./ScriptLib/runtime/options.cjs');
const { readJson, sendJson } = require('./ScriptLib/emoji/http.cjs');
/** 共用啟停結果與運行狀態頁，頁面不直接插入 query 或日誌。 */
function sendRuntimePage(res) {
    fs.readFile(path.join(__dirname, 'runtime.html'), (error, html) => {
        res.writeHead(error ? 500 : 200, { 'Content-Type': error ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(error ? '無法載入運行狀態頁' : html);
    });
}
function serveRuntime(req, res, runtime, start) {
    const pathname = req.url.split('?')[0];
    if (!['/runtime', '/api/runtime', '/api/runtime/options', '/api/runtime/start'].includes(pathname)) return false;
    if (pathname === '/api/runtime/start') {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
        const origin = (req.socket?.encrypted ? 'https://' : 'http://') + req.headers.host;
        if (req.headers.origin !== origin) { sendJson(res, 403, { code: 'ORIGIN_DENIED', error: '請由主服務管理頁操作' }); return true; }
        void (async () => {
            try { sendJson(res, 202, start(startURL(await readJson(req, 4096)))); }
            catch (error) { sendJson(res, error.status || 400, { code: error.code || 'INVALID_START_OPTIONS', error: error.message }); }
        })();
        return true;
    }
    if (pathname === '/api/runtime/options' && req.method === 'GET') { sendJson(res, 200, { options }); return true; }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return true; }
    if (pathname === '/runtime') sendRuntimePage(res);
    else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(runtime.snapshot()));
    }
    return true;
}
module.exports = { sendRuntimePage, serveRuntime };
