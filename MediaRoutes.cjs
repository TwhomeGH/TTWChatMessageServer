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

module.exports = { createMediaRoutes };
