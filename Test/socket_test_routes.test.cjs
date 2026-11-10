const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSocketTestRoutes } = require('../SocketTestRoutes.cjs');

function call(route, { url = '/api/socket/test', method = 'POST', body = '', authorized = true } = {}) {
    return new Promise(resolve => {
        const req = new EventEmitter();
        req.url = url;
        req.method = method;
        const res = {
            writeHead(status) { this.status = status; },
            end(value) { resolve({ status: this.status, body: value ? JSON.parse(value) : null }); }
        };
        const served = route(req, res, authorized);
        if (!served) { resolve({ served: false }); return; }
        setImmediate(() => {
            if (body) req.emit('data', Buffer.from(body));
            req.emit('end');
        });
    });
}

const payload = { type: 'StreamMessage', user: 'u', message: 'hello' };

test('SocketTestRoutes 需要登入與 TikTok 子程序', async () => {
    const sent = [];
    const results = [];
    const route = createSocketTestRoutes({
        sendToTikTok: value => sent.push(value),
        pushTestResult: value => results.push(value),
        hasChild: () => false
    });
    assert.equal((await call(route, { authorized: false, body: JSON.stringify({ testId: 't', payload }) })).status, 401);
    const offline = await call(route, { body: JSON.stringify({ testId: 't', payload }) });
    assert.equal(offline.status, 409);
    assert.equal(results[0].status, 'offline');
    assert.equal(results[0].mode, 'raw');
    assert.equal(sent.length, 0);
});

test('SocketTestRoutes 將 raw payload 交給子程序', async () => {
    const sent = [];
    const route = createSocketTestRoutes({
        sendToTikTok: value => sent.push(value),
        pushTestResult: () => {},
        hasChild: () => true
    });
    const response = await call(route, {
        body: JSON.stringify({ testId: 'raw-1', normalize: false, payload })
    });
    assert.equal(response.status, 202);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'RAW_SOCKET_TEST');
    assert.equal(sent[0].normalize, false);
    assert.equal(sent[0].payload.message, 'hello');
});

test('SocketTestRoutes 拒絕非支援的 payload 與非 POST', async () => {
    const route = createSocketTestRoutes({
        sendToTikTok: () => {}, pushTestResult: () => {}, hasChild: () => true
    });
    assert.equal((await call(route, {
        body: JSON.stringify({ testId: 't', payload: { type: 'Other' } })
    })).status, 400);
    assert.equal((await call(route, { method: 'GET' })).status, 405);
});
