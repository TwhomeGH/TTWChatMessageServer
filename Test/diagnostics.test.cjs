const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DiagnosticsStore } = require('../ScriptLib/diagnostics/store.cjs');
const { createDiagnosticsRoutes } = require('../DiagnosticsRoutes.cjs');

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
