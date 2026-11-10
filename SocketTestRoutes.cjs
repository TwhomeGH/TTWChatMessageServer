const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Raw Socket 測試入口：需登入，payload 由子程序直接送進 socketHub，
 * 不經過 /chat 的 filter、去重、traffic 或 AutoClip。
 * @param {Object} deps
 * @param {(payload: Object) => void} deps.sendToTikTok
 * @param {(payload: Object) => void} deps.pushTestResult
 * @param {() => boolean} deps.hasChild
 * @returns {Function}
 */
function createSocketTestRoutes({ sendToTikTok, pushTestResult, hasChild }) {
    return function serveSocketTest(req, res, authorized = false) {
        if (req.url.split('?')[0] !== '/api/socket/test') return false;
        const send = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(body));
        };
        if (!authorized) {
            send(401, { ok: false, error: '請先登入' });
            return true;
        }
        if (req.method !== 'POST') {
            send(405, { ok: false, error: '只支援 POST' });
            return true;
        }
        let body = '';
        let tooLarge = false;
        req.on('data', chunk => {
            body += chunk;
            if (Buffer.byteLength(body) > MAX_BODY_BYTES) tooLarge = true;
        });
        req.on('end', () => {
            if (tooLarge) {
                send(413, { ok: false, error: 'payload 過大' });
                return;
            }
            try {
                const data = JSON.parse(body);
                const testId = typeof data.testId === 'string' ? data.testId.trim() : '';
                if (!testId) {
                    send(400, { ok: false, error: '缺少 testId' });
                    return;
                }
                if (!data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload)) {
                    send(400, { ok: false, error: 'payload 必須是物件' });
                    return;
                }
                if (!['StreamMessage', 'AdOverlay'].includes(data.payload.type)) {
                    send(400, { ok: false, error: '只支援 StreamMessage 或 AdOverlay' });
                    return;
                }
                if (!hasChild()) {
                    pushTestResult({ testId, status: 'offline', mode: 'raw', endpoints: 0 });
                    send(409, { ok: false, error: 'TikTok 子程序未運行' });
                    return;
                }
                sendToTikTok({
                    type: 'RAW_SOCKET_TEST',
                    testId,
                    normalize: data.normalize !== false,
                    payload: data.payload
                });
                send(202, { ok: true });
            } catch (error) {
                send(400, { ok: false, error: 'JSON 解析失敗：' + error.message });
            }
        });
        return true;
    };
}

module.exports = { createSocketTestRoutes };
