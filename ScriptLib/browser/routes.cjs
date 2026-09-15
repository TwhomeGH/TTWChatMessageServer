const fs = require('node:fs/promises');
const path = require('node:path');
const { readJson, sendJson } = require('../emoji/http.cjs');

/** 沿用主服務登入；寫入還須來自相同 Origin，避免跨站啟動瀏覽器。 */
function createHandler(controller) {
    return async (req, res, authorized = false) => {
        const pathname = req.url.split('?')[0];
        try {
            if (!authorized) {
                if (pathname.startsWith('/api/browser/')) {
                    sendJson(res, 401, { error: '請先登入' });
                    return;
                }
                const login = await fs.readFile(path.resolve(__dirname, '../../login.html'), 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(login.replace('</head>', "<script>const REDIRECT_AFTER_LOGIN='/browser';</script></head>"));
                return;
            }
            if (pathname === '/browser' && req.method === 'GET') {
                const html = await fs.readFile(path.resolve(__dirname, '../../OtherTool/browser/index.html'));
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                    'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff'
                });
                res.end(html);
                return;
            }
            if (pathname === '/api/browser/status' && req.method === 'GET') {
                sendJson(res, 200, await controller.status());
                return;
            }
            if (req.method === 'POST' && ['/api/browser/start', '/api/browser/show'].includes(pathname)) {
                const protocol = req.socket?.encrypted ? 'https:' : 'http:';
                const expected = protocol + '//' + req.headers.host;
                if (req.headers.origin !== expected) {
                    sendJson(res, 403, { error: '請由主服務管理頁操作' });
                    return;
                }
                const body = await readJson(req, 2048);
                if (pathname === '/api/browser/start') await controller.start();
                else await controller.show(typeof body?.id === 'string' ? body.id : undefined);
                sendJson(res, 200, { success: true });
                return;
            }
            sendJson(res, 405, { error: '不支援的操作' });
        } catch (error) {
            sendJson(res, error.status || 400, { error: error.message });
        }
    };
}
module.exports = { createHandler };
