/**
 * 建立提醒管理 API；不要求登入，修改驗證同來源 JSON。只接收分類與設定，不接收通知網址。
 * @param {Object} planner TrafficPlanner 實例。
 * @returns {Function} 與 serveTraffic 相同的同步路由介面。
 */
function createPlannerRoutes(planner) {
    return function servePlanner(req, res) {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/api/traffic/planner') return false;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const respond = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
        if (req.method === 'GET') {
            try {
                const status = url.searchParams.get('status') || 'unclassified';
                respond(200, { ...planner.snapshot(), sessions: planner.sessions(
                    url.searchParams.get('platform') || '', Number(url.searchParams.get('page') || 1), status) });
            } catch { respond(400, { error: 'request' }); }
            return true;
        }
        if (req.method !== 'POST') { respond(405, { error: 'method' }); return true; }
        const origin = (req.socket?.encrypted ? 'https://' : 'http://') + req.headers.host;
        if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) {
            respond(403, { error: 'origin' });
            return true;
        }
        let body = '', oversized = false;
        req.on('data', chunk => {
            if (oversized) return;
            body += chunk;
            if (body.length > 16000) { oversized = true; respond(413, { error: 'size' }); }
        });
        req.on('end', () => {
            if (oversized) return;
            try {
                const { action, value } = JSON.parse(body);
                let result;
                switch (action) {
                    case 'settings': planner.saveSettings(value); break;
                    case 'profile': planner.classifyProfile(value); break;
                    case 'session': planner.classifySession(value); break;
                    case 'tests': result = { saved: true, changed: planner.markTests(value) }; break;
                    case 'assign': result = { saved: true, changed: planner.assign(value?.ids, value?.purpose) }; break;
                    case 'backfillPreview': result = planner.previewBackfill(value); break;
                    case 'backfillApply': result = planner.applyBackfill(value); break;
                    case 'backfillBatch': result = planner.batchDetails(value?.id, value?.page); break;
                    case 'backfillUndo': result = planner.undoBackfill(value?.id); break;
                    case 'skip': planner.skip(value); break;
                    default: throw new RangeError('action');
                }
                respond(200, result ?? { saved: true });
            } catch (error) {
                // 僅回傳已知欄位代碼，不把資料庫或設定內容寫入錯誤回應。
                if (error instanceof RangeError && error.message === 'changed') {
                    respond(409, { error: 'changed' });
                    return;
                }
                const fields = ['enabled', 'channels', 'historyDays', 'maxPerWeek', 'weekdays', 'hours', 'timezone',
                    'channelNotConfigured', 'profile', 'session', 'sessions', 'purpose', 'startAt', 'action',
                    'backfill', 'status', 'days', 'completeOnly', 'assignment', 'broadcaster', 'expected', 'tooMany', 'batch'];
                respond(400, { error: 'invalidSettings', field: error instanceof RangeError && fields.includes(error.message) ? error.message : null });
            }
        });
        return true;
    };
}

module.exports = { createPlannerRoutes };
