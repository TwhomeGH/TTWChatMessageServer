const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { DiagnosticsStore } = require('../ScriptLib/diagnostics/store.cjs');
const { DiagnosticsSocketClient } = require('../ScriptLib/diagnostics/socket-client.cjs');
const { createDiagnosticsRoutes } = require('../DiagnosticsRoutes.cjs');
const { resolveDiagnosticsTarget } = require('../ScriptLib/diagnostics/target.cjs');

function request(route, { url = '/post', method = 'POST', body = '', headers = {} } = {}) {
    return new Promise(resolve => {
        const req = new EventEmitter();
        req.url = url;
        req.method = method;
        req.headers = headers;
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

    assert.equal(store.ingestDiagnostic({
        type: 'diagnostic', subsystem: 'logio', source: 'extension', count: 4, lastError: 'disk full'
    }), true);
    assert.equal(store.ingestDiagnostic({ type: 'other' }), false);
    const diag = store.snapshot().diagnostics[0];
    assert.deepEqual({ subsystem: diag.subsystem, source: diag.source, count: diag.count, lastError: diag.lastError },
        { subsystem: 'logio', source: 'extension', count: 4, lastError: 'disk full' });
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
        req.url = '/api/diagnostics';
        req.method = 'GET';
        req.headers = {};
        const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } };
        routes.serveApi(req, res, true);
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.diagnostics.length, 1);
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
