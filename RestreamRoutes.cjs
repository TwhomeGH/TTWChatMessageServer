const fs = require('node:fs');
const path = require('node:path');
const { readJson, sendJson } = require('./ScriptLib/emoji/http.cjs');
const store = require('./ScriptLib/restream/metrics.cjs');

const PAGE = path.join(__dirname, 'OtherTool/restream/index.html');
const LOGIN = path.join(__dirname, 'login.html');

function sendLogin(res) {
    try {
        const login = fs.readFileSync(LOGIN, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(login.replace('</head>', "<script>const REDIRECT_AFTER_LOGIN='/restream';</script></head>"));
    } catch (error) {
        sendJson(res, 500, { code: 'LOGIN_PAGE_MISSING', error: error.message });
    }
}

async function handle(req, res, authorized) {
    const pathname = req.url.split('?')[0];
    if (pathname === '/restream') {
        if (req.method !== 'GET') {
            sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', error: '只支援 GET' });
            return;
        }
        if (!authorized) { sendLogin(res); return; }
        try {
            const html = fs.readFileSync(PAGE);
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff'
            });
            res.end(html);
        } catch (error) {
            sendJson(res, 500, { code: 'RESTREAM_PAGE_MISSING', error: error.message });
        }
        return;
    }

    if (req.method === 'POST') {
        try {
            const body = await readJson(req, 16384);
            const result = store.record(body);
            if (result.error) {
                sendJson(res, 400, { ok: false, code: result.error, error: 'Restream 指標格式無效' });
                return;
            }
            sendJson(res, 200, {
                ok: true,
                receivedAt: result.entry.receivedAt,
                normalized: result.entry
            });
        } catch (error) {
            sendJson(res, error.status || 400, {
                ok: false, code: error.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
                error: error.message
            });
        }
        return;
    }

    if (req.method === 'GET') {
        if (!authorized) {
            sendJson(res, 401, { ok: false, code: 'AUTH_REQUIRED', error: '請先登入' });
            return;
        }
        const url = new URL(req.url, 'http://localhost');
        const showId = url.searchParams.get('showId');
        if (showId) {
            sendJson(res, 200, { ok: true, ...store.snapshot(showId) });
        } else {
            sendJson(res, 200, { ok: true, shows: store.list() });
        }
        return;
    }

    sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', error: '只支援 GET 或 POST' });
}

/**
 * 同步判斷是否為 Restream 路由；符合時在背景處理並回傳 true。
 * POST /restream/metrics 供 userscript 送入；GET 與頁面沿用主服務登入。
 */
function serveRestream(req, res, authorized = false) {
    const pathname = req.url.split('?')[0];
    if (pathname !== '/restream' && pathname !== '/restream/metrics') return false;
    void handle(req, res, authorized).catch(error => {
        if (!res.headersSent) sendJson(res, 500, { ok: false, code: 'RESTREAM_FAILED', error: error.message });
        else res.end();
    });
    return true;
}

module.exports = { serveRestream };
