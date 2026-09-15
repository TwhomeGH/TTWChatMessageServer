const fs = require('node:fs');
const path = require('node:path');
/** 共用啟停結果與運行狀態頁，頁面不直接插入 query 或日誌。 */
function sendRuntimePage(res) {
    fs.readFile(path.join(__dirname, 'runtime.html'), (error, html) => {
        res.writeHead(error ? 500 : 200, { 'Content-Type': error ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(error ? '無法載入運行狀態頁' : html);
    });
}
function serveRuntime(req, res, runtime) {
    const pathname = req.url.split('?')[0];
    if (!['/runtime', '/api/runtime'].includes(pathname)) return false;
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return true; }
    if (pathname === '/runtime') sendRuntimePage(res);
    else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(runtime.snapshot()));
    }
    return true;
}
module.exports = { sendRuntimePage, serveRuntime };
