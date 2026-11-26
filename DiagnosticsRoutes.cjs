const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_BODY = 4 * 1024 * 1024;

function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
}

/**
 * 診斷入口：HTTP LogServer 相容 /post、帶外 diagnostic、以及唯讀診斷頁。
 * 資料只存在記憶體，不寫 log 檔或聊天歷史。
 * @param {import('./ScriptLib/diagnostics/store.cjs').DiagnosticsStore} store
 * @param {{token?: string, socketClient?: Object, resolveTarget?: () => {host: string, port: number, source: string, configured: boolean}, allowLocal?: boolean}} [options]
 */
function createDiagnosticsRoutes(store, { token = '', socketClient = null, resolveTarget = null, allowLocal = true } = {}) {
    function target() {
        if (typeof resolveTarget === 'function') return resolveTarget();
        return { host: '', port: 0, source: '', configured: false };
    }
    function matchesToken(req) {
        if (!token) return false;
        const header = req.headers['x-diagnostics-token'];
        if (header === token) return true;
        const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (bearer === token) return true;
        const url = new URL(req.url, 'http://localhost');
        return url.searchParams.get('token') === token;
    }

    function authorizedIntake(req) {
        // 送入日誌預設開放；有設定 token 時才要求 token。
        return !token || matchesToken(req);
    }

    function authorizedRead(req) {
        // 讀取診斷可能包含敏感內容，預設只允許登入；token 是可選的遠端讀取通道。
        return Boolean(token) && matchesToken(req);
    }

    const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip'];
    // 用介面位址判斷「從自己的機器連進來」，包含用區網 IP 開本機頁面的情況。
    const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
    for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries || []) {
            if (entry?.address) localAddresses.add(entry.address.toLowerCase());
        }
    }

    function authorizedLocal(req) {
        if (!allowLocal) return false;
        // 經過反向代理時來源位址會變成代理本身；有 forwarding header 就不算本機。
        const headers = req.headers || {};
        if (PROXY_HEADERS.some(name => headers[name])) return false;
        const address = String(req.socket?.remoteAddress || '').toLowerCase();
        const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
        return localAddresses.has(address) || localAddresses.has(normalized);
    }

    function servePage(req, res) {
        if (req.url.split('?')[0] !== '/diagnostics') return false;
        if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Method Not Allowed');
            return true;
        }
        fs.readFile(path.join(__dirname, 'diagnostics.html'), 'utf8', (error, html) => {
            if (error) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Error loading diagnostics.html');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(html);
        });
        return true;
    }

    function serveApi(req, res, authorized = false) {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/api/diagnostics') return false;
        if (!authorized && !authorizedRead(req) && !authorizedLocal(req)) {
            json(res, 401, { ok: false, code: 'AUTH_REQUIRED', error: '請先登入，或提供 DIAGNOSTICS_TOKEN' });
            return true;
        }
        if (req.method !== 'GET') {
            json(res, 405, { ok: false, error: '只支援 GET' });
            return true;
        }
        json(res, 200, {
            ok: true,
            ...store.snapshot({
                limit: Number(url.searchParams.get('limit')) || 500,
                q: url.searchParams.get('q') || '',
                category: url.searchParams.get('category') || '',
                severity: url.searchParams.get('severity') || '',
                session: url.searchParams.get('session') || '',
                context: Number(url.searchParams.get('context')) || 0
            })
        });
        return true;
    }

    function serveIntake(req, res) {
        const url = new URL(req.url, 'http://localhost');
        if (!['/post', '/api/diagnostics/report'].includes(url.pathname)) return false;
        if (req.method !== 'POST') {
            json(res, 405, { status: 'error', message: '只支援 POST' });
            return true;
        }
        if (!authorizedIntake(req)) {
            json(res, 401, { status: 'error', message: 'Unauthorized' });
            return true;
        }
        let body = '';
        let tooLarge = false;
        req.on('data', chunk => {
            body += chunk;
            if (Buffer.byteLength(body) > MAX_BODY) tooLarge = true;
        });
        req.on('end', () => {
            if (tooLarge) {
                json(res, 413, { status: 'error', message: 'body too large' });
                return;
            }
            try {
                const data = JSON.parse(body);
                if (data && typeof data === 'object' && data.type === 'diagnostic') {
                    const accepted = store.ingestDiagnostic(data);
                    json(res, 200, { status: accepted ? 'ok' : 'ignored', received: { diagnostics: accepted ? 1 : 0 } });
                    return;
                }
                const result = store.ingestLogs(data);
                json(res, 200, { status: 'ok', received: { logs: result.accepted } });
            } catch {
                json(res, 400, { status: 'error', message: 'Invalid JSON' });
            }
        });
        return true;
    }

    function serveSocket(req, res, authorized = false) {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/api/diagnostics/socket') return false;
        if (!authorized) {
            json(res, 401, { ok: false, code: 'AUTH_REQUIRED', error: '請先登入' });
            return true;
        }
        if (!socketClient) {
            json(res, 501, { ok: false, error: 'Socket 訂閱未啟用' });
            return true;
        }
        if (req.method === 'GET') {
            json(res, 200, {
                ok: true,
                ...socketClient.snapshot(),
                defaults: target()
            });
            return true;
        }
        if (req.method !== 'POST') {
            json(res, 405, { ok: false, error: '只支援 GET 或 POST' });
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
                json(res, 413, { ok: false, error: 'body too large' });
                return;
            }
            try {
                const data = JSON.parse(body);
                if (data.enabled === true) {
                    const { host, port } = target();
                    if (!socketClient.start(host, port)) {
                        json(res, 400, {
                            ok: false,
                            error: '未設定 Socket 目標：請設定 SOCKET_API（或 SOCKET_APIS 第一個端點），儲存後重啟主服務。'
                        });
                        return;
                    }
                } else {
                    socketClient.unsubscribe();
                }
                json(res, 200, { ok: true, ...socketClient.snapshot() });
            } catch (error) {
                json(res, 400, { ok: false, error: 'JSON 解析失敗：' + error.message });
            }
        });
        return true;
    }

    return { servePage, serveApi, serveIntake, serveSocket };
}

module.exports = { createDiagnosticsRoutes };
