const { sendJson } = require('./ScriptLib/emoji/http.cjs');

/**
 * 監控歷史的唯讀 API。歷史含原始聊天，因此需要主服務登入；
 * 即時 SSE 仍維持原本的公開監控行為。
 * @param {import('./ScriptLib/monitor/store.cjs').MonitorHistoryStore} store
 * @returns {Function} 與其他路由相同的請求處理器。
 */
function createMonitorRoutes(store) {
    return function serveMonitorHistory(req, res, authorized = false) {
        const url = new URL(req.url, 'http://localhost');
        if (!['/api/monitor/sessions', '/api/monitor/messages'].includes(url.pathname)) return false;
        res.setHeader('Cache-Control', 'no-store');
        if (!authorized) {
            sendJson(res, 401, { ok: false, code: 'AUTH_REQUIRED', error: '請先登入' });
            return true;
        }
        if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '只支援 GET' });
            return true;
        }
        try {
            if (url.pathname === '/api/monitor/sessions') {
                sendJson(res, 200, { ok: true, sessions: store.listSessions(Number(url.searchParams.get('limit')) || 20) });
                return true;
            }
            const sessionId = (url.searchParams.get('session') || '').trim();
            if (!sessionId) {
                sendJson(res, 400, { ok: false, code: 'SESSION_REQUIRED', error: '缺少場次' });
                return true;
            }
            const categories = (url.searchParams.get('categories') || '')
                .split(',').map(value => value.trim()).filter(Boolean);
            const result = store.listMessages({
                sessionId,
                page: Number(url.searchParams.get('page')) || 1,
                pageSize: Number(url.searchParams.get('pageSize')) || 200,
                q: url.searchParams.get('q') || '',
                categories,
                platform: url.searchParams.get('platform') || ''
            });
            if (!result) {
                sendJson(res, 404, { ok: false, code: 'SESSION_NOT_FOUND', error: '找不到場次' });
                return true;
            }
            sendJson(res, 200, { ok: true, ...result });
            return true;
        } catch (error) {
            sendJson(res, 400, { ok: false, code: 'INVALID_REQUEST', error: error.message });
            return true;
        }
    };
}

module.exports = { createMonitorRoutes };
