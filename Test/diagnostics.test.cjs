const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { DiagnosticsStore } = require('../ScriptLib/diagnostics/store.cjs');
const { parseDiagnosticLog, summarizeDiagnostics } = require('../ScriptLib/diagnostics/parse.cjs');
const { DiagnosticsSocketClient } = require('../ScriptLib/diagnostics/socket-client.cjs');
const { createDiagnosticsRoutes } = require('../DiagnosticsRoutes.cjs');
const { resolveDiagnosticsTarget } = require('../ScriptLib/diagnostics/target.cjs');

function request(route, { url = '/post', method = 'POST', body = '', headers = {}, socket = null } = {}) {
    return new Promise(resolve => {
        const req = new EventEmitter();
        req.url = url;
        req.method = method;
        req.headers = headers;
        if (socket) req.socket = socket;
        const res = {
            writeHead(status) { this.status = status; },
            end(value) { resolve({ status: this.status, body: value ? JSON.parse(value) : null }); }
        };
        route(req, res);
        setImmediate(() => {
            if (body) req.emit('data', Buffer.from(body));
            req.emit('end');
        });
    });
}

test('診斷日誌解析分類、嚴重度、session 與 key=value 欄位', () => {
    const info = parseDiagnosticLog({
        time: '2026/11/25 10:00:00',
        title: 'ReplyKit',
        body: '[Capture] failed=0 lastError=none session=abc12345 dropped=1'
    });
    assert.equal(info.category, 'Capture');
    assert.equal(info.severity, 'info');
    assert.equal(info.session, 'abc12345');
    assert.deepEqual(info.fields, { failed: '0', lastError: 'none', session: 'abc12345', dropped: '1' });

    const failed = parseDiagnosticLog({ title: 'ReplyKit', body: '[Capture] failed=1' });
    assert.equal(failed.severity, 'error');
    const warned = parseDiagnosticLog({ title: 'ReplyKit', body: '[Capture] warning: queue incomplete' });
    assert.equal(warned.severity, 'warn');

    const structured = parseDiagnosticLog({
        title: 'ReplyKit', body: 'plain body', category: 'Custom', severity: 'warn',
        session: 'session-1', fields: { fps: '60', empty: '' }
    });
    assert.equal(structured.category, 'Custom');
    assert.equal(structured.severity, 'warn');
    assert.equal(structured.session, 'session-1');
    assert.deepEqual(structured.fields, { fps: '60' });

    const summary = summarizeDiagnostics([info, failed, warned]);
    assert.equal(summary.total, 3);
    assert.equal(summary.error, 1);
    assert.equal(summary.warn, 1);
    assert.deepEqual(summary.categories, [{ name: 'Capture', count: 3 }]);
});

test('DiagnosticsStore 接收 LogServer logs 與帶外 diagnostic', () => {
    const store = new DiagnosticsStore({ maxLogs: 3 });
    store.ingestLogs({ logs: [
        { time: 'a', title: 'one', body: 'first' },
        { time: 'b', title: 'two', body: 'second' }
    ] });
    store.ingestLogs({ time: 'c', title: 'three', body: 'third' });
    store.ingestLogs({ time: 'd', title: 'four', body: 'fourth' });
    const snapshot = store.snapshot({ q: 'four' });
    assert.equal(snapshot.logs.length, 1);
    assert.equal(snapshot.logs[0].title, 'four');
    assert.equal(snapshot.stats.bufferedLogs, 3);

    const filtered = store.snapshot({ category: 'three', severity: 'info' });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.logs[0].title, 'three');
    assert.equal(store.snapshot().summary.total, 3);

    assert.equal(store.ingestDiagnostic({
        type: 'diagnostic', subsystem: 'logio', source: 'extension', count: 4, lastError: 'disk full'
    }), true);
    assert.equal(store.ingestDiagnostic({ type: 'other' }), false);
    const diag = store.snapshot().diagnostics[0];
    assert.deepEqual({ subsystem: diag.subsystem, source: diag.source, count: diag.count, lastError: diag.lastError },
        { subsystem: 'logio', source: 'extension', count: 4, lastError: 'disk full' });
});

test('診斷搜尋可帶入匹配前後上下文並標記 matched', () => {
    const store = new DiagnosticsStore();
    store.ingestLogs([
        { time: '1', title: 'Capture', body: 'before' },
        { time: '2', title: 'Capture', body: 'target' },
        { time: '3', title: 'Capture', body: 'after' }
    ]);
    const only = store.snapshot({ q: 'target' });
    assert.deepEqual(only.logs.map(line => line.body), ['target']);
    assert.equal(only.logs[0].matched, true);
    assert.equal(only.matched, 1);
    assert.equal(only.context, 0);

    const around = store.snapshot({ q: 'target', context: 1 });
    assert.deepEqual(around.logs.map(line => line.body), ['after', 'target', 'before']);
    assert.deepEqual(around.logs.map(line => line.matched), [false, true, false]);
    assert.equal(around.total, 1);
    assert.equal(around.matched, 1);
    assert.equal(around.context, 2);
    assert.equal(around.hasMore, false);
});

test('診斷 API 可用 DIAGNOSTICS_TOKEN 遠端讀取，未設定或錯誤 token 仍需登入', async () => {
    const store = new DiagnosticsStore();
    store.ingestLogs({ time: '1', title: 'Capture', body: 'remote target' });
    const routes = createDiagnosticsRoutes(store, { token: 'secret' });

    assert.equal((await request(routes.serveApi, {
        url: '/api/diagnostics', method: 'GET'
    })).status, 401);
    assert.equal((await request(routes.serveApi, {
        url: '/api/diagnostics', method: 'GET', headers: { 'x-diagnostics-token': 'wrong' }
    })).status, 401);

    const header = await request(routes.serveApi, {
        url: '/api/diagnostics', method: 'GET', headers: { 'x-diagnostics-token': 'secret' }
    });
    assert.equal(header.status, 200);
    assert.equal(header.body.logs[0].body, 'remote target');

    const query = await request(routes.serveApi, {
        url: '/api/diagnostics?token=secret', method: 'GET'
    });
    assert.equal(query.status, 200);

    const bearer = await request(routes.serveApi, {
        url: '/api/diagnostics', method: 'GET', headers: { authorization: 'Bearer secret' }
    });
    assert.equal(bearer.status, 200);
});

test('診斷 API 本機來源免登入；遠端、代理或關閉本機允許仍需登入', async () => {
    const store = new DiagnosticsStore();
    store.ingestLogs({ time: '1', title: 'Capture', body: 'local target' });
    const routes = createDiagnosticsRoutes(store);

    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
        const local = await request(routes.serveApi, {
            url: '/api/diagnostics', method: 'GET', socket: { remoteAddress }
        });
        assert.equal(local.status, 200, remoteAddress);
        assert.equal(local.body.logs[0].body, 'local target');
    }

    assert.equal((await request(routes.serveApi, {
        url: '/api/diagnostics', method: 'GET', socket: { remoteAddress: '192.168.0.50' }
    })).status, 401);

    // 反向代理會讓遠端看起來像本機；有 forwarding header 時不可套用本機允許。
    assert.equal((await request(routes.serveApi, {
        url: '/api/diagnostics',
        method: 'GET',
        headers: { 'x-forwarded-for': '203.0.113.9' },
        socket: { remoteAddress: '127.0.0.1' }
    })).status, 401);

    // 用本機區網 IP 開頁面時，來源位址會是本機介面位址，仍應視為本機。
    const localIp = Object.values(os.networkInterfaces()).flat()
        .find(entry => entry?.family === 'IPv4' && !entry.internal)?.address;
    if (localIp) {
        assert.equal((await request(routes.serveApi, {
            url: '/api/diagnostics', method: 'GET', socket: { remoteAddress: localIp }
        })).status, 200);
    }

    const disabled = createDiagnosticsRoutes(store, { allowLocal: false });
    assert.equal((await request(disabled.serveApi, {
        url: '/api/diagnostics', method: 'GET', socket: { remoteAddress: '127.0.0.1' }
    })).status, 401);
});

test('診斷入口接受 LogServer /post、diagnostic 與可選 token', async () => {
    const store = new DiagnosticsStore();
    const routes = createDiagnosticsRoutes(store, { token: 'secret' });
    assert.equal((await request(routes.serveIntake, {
        body: JSON.stringify({ logs: [{ title: 'x', body: 'y' }] })
    })).status, 401);
    const accepted = await request(routes.serveIntake, {
        headers: { 'x-diagnostics-token': 'secret' },
        body: JSON.stringify({ logs: [{ title: 'x', body: 'y' }] })
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.received.logs, 1);
    const diagnostic = await request(routes.serveIntake, {
        url: '/api/diagnostics/report',
        headers: { authorization: 'Bearer secret' },
        body: JSON.stringify({ type: 'diagnostic', subsystem: 'logio', source: 'mainapp', count: 2, lastError: 'nope' })
    });
    assert.equal(diagnostic.status, 200);
    assert.equal(diagnostic.body.received.diagnostics, 1);
    assert.equal(store.snapshot().diagnostics[0].source, 'mainapp');
});

test('診斷 API 需要登入並回傳 snapshot', async () => {
    const store = new DiagnosticsStore();
    store.ingestDiagnostic({ type: 'diagnostic', subsystem: 'logio', source: 'extension', count: 1, lastError: '' });
    store.ingestLogs([
        { time: '1', title: 'Capture', body: 'before' },
        { time: '2', title: 'Capture', body: 'target' },
        { time: '3', title: 'Capture', body: 'after' }
    ]);
    const routes = createDiagnosticsRoutes(store);
    const denied = await new Promise(resolve => {
        const req = new EventEmitter();
        req.url = '/api/diagnostics';
        req.method = 'GET';
        req.headers = {};
        const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } };
        routes.serveApi(req, res, false);
    });
    assert.equal(denied.status, 401);
    const allowed = await new Promise(resolve => {
        const req = new EventEmitter();
        req.url = '/api/diagnostics?q=target&context=1';
        req.method = 'GET';
        req.headers = {};
        const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } };
        routes.serveApi(req, res, true);
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.diagnostics.length, 1);
    assert.deepEqual(allowed.body.logs.map(line => line.body), ['after', 'target', 'before']);
    assert.deepEqual(allowed.body.logs.map(line => line.matched), [false, true, false]);
});

test('Socket client 訂閱 externalLogs 並接收 batch／diagnostic', async () => {
    const store = new DiagnosticsStore();
    const received = [];
    const server = net.createServer(socket => {
        socket.on('error', () => {});
        socket.setEncoding('utf8');
        let buffer = '';
        socket.on('data', chunk => {
            buffer += chunk;
            let index;
            while ((index = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                if (!line) continue;
                received.push(JSON.parse(line));
                if (JSON.parse(line).type === 'subscribeExternalLogs' && !socket.destroyed) {
                    try {
                        socket.write(JSON.stringify({ type: 'externalLogSubscription', enabled: true }) + '\n');
                        socket.write(JSON.stringify({
                            type: 'externalLogBatch', source: 'mainapp',
                            entries: [{ time: 'now', title: 'ReplyKit', body: 'socket log' }]
                        }) + '\n');
                        socket.write(JSON.stringify({
                            type: 'diagnostic', subsystem: 'logio', source: 'mainapp', count: 2, lastError: 'disk'
                        }) + '\n');
                    } catch { /* client 已關閉 */ }
                }
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new DiagnosticsSocketClient({ store, reconnectMs: 50, logger: { log() {}, error() {} } });
    try {
        assert.equal(client.start('127.0.0.1', server.address().port), true);
        await new Promise(resolve => {
            const timer = setInterval(() => {
                const snap = store.snapshot();
                if (snap.logs.length && snap.diagnostics.length) {
                    clearInterval(timer);
                    resolve();
                }
            }, 10);
        });
        assert.deepEqual(received[0], { type: 'subscribeExternalLogs', enabled: true });
        assert.equal(client.snapshot().subscribed, true);
        assert.equal(store.snapshot().logs[0].body, 'socket log');
        assert.equal(store.snapshot().diagnostics[0].count, 2);
    } finally {
        client.stop();
        await new Promise(resolve => server.close(resolve));
    }
});

test('診斷 Socket 目標沿用 SOCKET_API，其次 SOCKET_APIS', () => {
    assert.deepEqual(resolveDiagnosticsTarget({ SOCKET_API: 'http://192.168.0.159:9322' }), {
        host: '192.168.0.159', port: 9322, source: 'SOCKET_API', configured: true
    });
    assert.deepEqual(resolveDiagnosticsTarget({
        SOCKET_APIS: 'tcp://10.0.0.5:9322?filter=chat;tcp://10.0.0.6:9322'
    }), {
        host: '10.0.0.5', port: 9322, source: 'SOCKET_APIS', configured: true
    });
    assert.deepEqual(resolveDiagnosticsTarget({}), {
        host: '', port: 9322, source: '', configured: false
    });
});

test('Socket 訂閱 API 需登入，GET 狀態與 POST 開關', async () => {
    const calls = [];
    const fake = {
        snapshot: () => ({ enabled: true, host: 'h', port: 9322, state: 'subscribed', subscribed: true }),
        start: (host, port) => { calls.push(['start', host, port]); return true; },
        unsubscribe: () => calls.push(['unsubscribe'])
    };
    const routes = createDiagnosticsRoutes(new DiagnosticsStore(), {
        socketClient: fake,
        resolveTarget: () => ({ host: 'default', port: 9322, source: 'SOCKET_API', configured: true })
    });
    const call = (method, body, authorized = true) => new Promise(resolve => {
        const req = new EventEmitter();
        req.url = '/api/diagnostics/socket';
        req.method = method;
        req.headers = {};
        const res = { writeHead(status) { this.status = status; }, end(value) { resolve({ status: this.status, body: JSON.parse(value) }); } };
        const served = routes.serveSocket(req, res, authorized);
        if (!served) { resolve({ served: false }); return; }
        setImmediate(() => {
            if (body) req.emit('data', Buffer.from(JSON.stringify(body)));
            req.emit('end');
        });
    });
    assert.equal((await call('GET', null, false)).status, 401);
    const status = await call('GET');
    assert.equal(status.body.subscribed, true);
    assert.equal(status.body.defaults.source, 'SOCKET_API');
    const enabled = await call('POST', { enabled: true });
    assert.equal(enabled.status, 200);
    assert.deepEqual(calls[0], ['start', 'default', 9322]);
    await call('POST', { enabled: false });
    assert.deepEqual(calls[1], ['unsubscribe']);
});
