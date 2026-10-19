const fs = require('node:fs');
const path = require('node:path');
const { platformName } = require('./ScriptLib/audience/tracker.cjs');

/** 未登入時回傳登入頁，登入後回到常客分析。 */
function serveLogin(res) {
    fs.readFile(path.join(__dirname, 'login.html'), 'utf8', (error, html) => {
        if (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Error loading login');
            return;
        }
        html = html.replace('</head>', "<script>const REDIRECT_AFTER_LOGIN='/audience';</script></head>");
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    });
}

/**
 * 常客分析頁與唯讀 API；只回傳聚合資料，不包含原始訊息。
 * @param {Object} tracker audience tracker（observe／list／details）。
 * @returns {Function} 與其他路由相同的同步請求處理器。
 */
function createAudienceRoutes(tracker) {
    return function serveAudience(req, res, authorized = false) {
        const url = new URL(req.url, 'http://localhost');
        if (!['/audience', '/api/audience', '/api/audience/user'].includes(url.pathname)) return false;
        res.setHeader('Cache-Control', 'no-store');

        if (url.pathname === '/audience') {
            if (!authorized) { serveLogin(res); return true; }
            fs.readFile(path.join(__dirname, 'audience.html'), 'utf8', (error, html) => {
                res.writeHead(error ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(error ? 'Unable to load page' : html);
            });
            return true;
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (req.method !== 'GET') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'method' }));
            return true;
        }
        if (!authorized) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'auth' }));
            return true;
        }

        try {
            if (url.pathname === '/api/audience') {
                const result = tracker.list({
                    platform: platformName(url.searchParams.get('platform') || ''),
                    q: url.searchParams.get('q') || '',
                    sort: url.searchParams.get('sort') || 'score',
                    page: Number(url.searchParams.get('page') || 1)
                });
                res.writeHead(200);
                res.end(JSON.stringify(result));
                return true;
            }
            const platform = platformName(url.searchParams.get('platform') || '');
            const user = (url.searchParams.get('user') || '').trim().toLowerCase();
            const result = platform && user ? tracker.details(platform, user) : null;
            if (!result) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'notFound' }));
                return true;
            }
            res.writeHead(200);
            res.end(JSON.stringify(result));
            return true;
        } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'request' }));
            return true;
        }
    };
}

module.exports = { createAudienceRoutes };
