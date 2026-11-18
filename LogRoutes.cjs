const { sendJson } = require('./ScriptLib/emoji/http.cjs');

const MAX_QUERY = 200;
const MAX_LIMIT = 500;

function numberParam(url, name) {
    const raw = url.searchParams.get(name);
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * 持久化系統日誌的唯讀查詢 API。
 * 日誌可能含敏感主機資訊，因此 API 需要主服務登入；頁面由 Server 單獨保護。
 * @param {import('./ScriptLib/logs/store.cjs').LogStore} store
 * @returns {Function}
 */
function createLogRoutes(store) {
    return function serveLogs(req, res, authorized = false) {
        const url = new URL(req.url, 'http://localhost');
        if (!['/api/logs', '/api/logs/summary'].includes(url.pathname)) return false;
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
            const from = numberParam(url, 'from');
            const to = numberParam(url, 'to');
            if (url.pathname === '/api/logs/summary') {
                sendJson(res, 200, { ok: true, ...store.summary({ from, to }) });
                return true;
            }
            const q = (url.searchParams.get('q') || '').slice(0, MAX_QUERY);
            const limit = Math.min(numberParam(url, 'limit') || 100, MAX_LIMIT);
            const beforeId = numberParam(url, 'beforeId');
            sendJson(res, 200, {
                ok: true,
                ...store.list({
                    q,
                    category: (url.searchParams.get('category') || '').trim(),
                    level: (url.searchParams.get('level') || '').trim(),
                    session: (url.searchParams.get('session') || '').trim(),
                    from,
                    to,
                    beforeId,
                    limit
                })
            });
            return true;
        } catch (error) {
            sendJson(res, 500, { ok: false, code: 'LOG_QUERY_FAILED', error: error.message });
            return true;
        }
    };
}

module.exports = { createLogRoutes };
