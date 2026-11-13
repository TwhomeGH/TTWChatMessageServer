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
        const paths = ['/audience', '/api/audience', '/api/audience/user',
            '/api/audience/merge/preview', '/api/audience/merge',
            '/api/audience/merge/latest', '/api/audience/merge/undo'];
        if (!paths.includes(url.pathname)) return false;
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
        if (!authorized) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'auth' }));
            return true;
        }

        if (url.pathname === '/api/audience/merge/latest') {
            if (req.method !== 'GET') {
                res.writeHead(405);
                res.end(JSON.stringify({ error: 'method' }));
                return true;
            }
            try {
                res.writeHead(200);
                res.end(JSON.stringify({
                    ok: true,
                    latest: tracker.latestMerge(platformName(url.searchParams.get('platform') || ''))
                }));
            } catch (error) {
                res.writeHead(Number(error.status) || 400);
                res.end(JSON.stringify({ error: error.message }));
            }
            return true;
        }

        if (url.pathname === '/api/audience/merge/preview' || url.pathname === '/api/audience/merge'
            || url.pathname === '/api/audience/merge/undo') {
            const preview = url.pathname.endsWith('/preview');
            const undo = url.pathname.endsWith('/undo');
            if ((preview && req.method !== 'GET') || (!preview && req.method !== 'POST')) {
                res.writeHead(405);
                res.end(JSON.stringify({ error: 'method' }));
                return true;
            }
            const run = payload => {
                try {
                    const result = preview ? tracker.mergePreview(payload)
                        : undo ? tracker.undoLastMerge(payload) : tracker.merge(payload);
                    res.writeHead(200);
                    res.end(JSON.stringify(result));
                } catch (error) {
                    const status = Number(error.status) || 400;
                    res.writeHead(status);
                    res.end(JSON.stringify({ error: error.message }));
                }
            };
            if (preview) {
                run({
                    platform: platformName(url.searchParams.get('platform') || ''),
                    sourceKey: url.searchParams.get('source') || '',
                    targetKey: url.searchParams.get('target') || ''
                });
                return true;
            }
            let body = '';
            let tooLarge = false;
            req.on('data', chunk => {
                body += chunk;
                if (Buffer.byteLength(body) > 64 * 1024) tooLarge = true;
            });
            req.on('end', () => {
                if (tooLarge) {
                    res.writeHead(413);
                    res.end(JSON.stringify({ error: 'body too large' }));
                    return;
                }
                try {
                    run(JSON.parse(body));
                } catch {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'JSON 解析失敗' }));
                }
            });
            return true;
        }

        if (req.method !== 'GET') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'method' }));
            return true;
        }

        try {
            if (url.pathname === '/api/audience') {
                const result = tracker.list({
                    platform: platformName(url.searchParams.get('platform') || ''),
                    q: url.searchParams.get('q') || '',
                    sort: url.searchParams.get('sort') || 'score',
                    page: Number(url.searchParams.get('page') || 1),
                    tenures: (url.searchParams.get('tenures') || '').split(',').map(value => value.trim()).filter(Boolean)
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
