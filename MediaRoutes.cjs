const { defaultMediaCache } = require('./ScriptLib/media/cache.cjs');

/**
 * 公開的圖片快取路由：只接受 /media/<sha256>，不提供任意 URL 抓取。
 * @param {import('./ScriptLib/media/cache.cjs').MediaCache} [cache]
 * @returns {Function} 與其他路由相同的同步請求處理器。
 */
function createMediaRoutes(cache = defaultMediaCache) {
    return function serveMedia(req, res) {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith('/media/')) return false;
        const hash = url.pathname.slice('/media/'.length);
        cache.serve(req, res, hash).catch(error => {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Media cache error');
            }
            console.error('[MediaCache] 服務失敗:', error.message);
        });
        return true;
    };
}

/**
 * MediaCache 管理／檢視 API；需要主服務登入。
 * @param {import('./ScriptLib/media/cache.cjs').MediaCache} [cache]
 * @returns {Function}
 */
function createMediaAdminRoutes(cache = defaultMediaCache) {
    const sendJson = (res, status, value) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(value));
    };
    return function serveMediaAdmin(req, res, authorized = false) {
        const url = new URL(req.url, 'http://localhost');
        if (!['/api/media', '/api/media/stats'].includes(url.pathname)) return false;
        if (!authorized) {
            sendJson(res, 401, { ok: false, error: '請先登入' });
            return true;
        }
        if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: '只支援 GET' });
            return true;
        }
        try {
            if (url.pathname === '/api/media/stats') {
                sendJson(res, 200, { ok: true, stats: cache.stats() });
                return true;
            }
            const result = cache.list({
                page: Number(url.searchParams.get('page')) || 1,
                pageSize: Number(url.searchParams.get('pageSize')) || 50,
                q: url.searchParams.get('q') || '',
                type: url.searchParams.get('type') || '',
                status: url.searchParams.get('status') || ''
            });
            sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
            sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
    };
}

module.exports = { createMediaRoutes, createMediaAdminRoutes };
