const test = require('node:test');
const assert = require('node:assert/strict');
const { LogStore } = require('../ScriptLib/logs/store.cjs');
const { createLogRoutes } = require('../LogRoutes.cjs');

function call(route, pathname, { authorized = true, method = 'GET' } = {}) {
    return new Promise(resolve => {
        const req = { url: pathname, method };
        const res = {
            setHeader() {},
            writeHead(status) { this.status = status; },
            end(data) { resolve({ status: this.status, body: data ? JSON.parse(data) : null }); }
        };
        route(req, res, authorized);
    });
}

test('日誌 API 需要登入，summary 與 list 回傳篩選結果', async () => {
    const store = new LogStore({ file: ':memory:' });
    store.append({ t: 1000, text: '[SYSTEM] 啟動', session: 's1' });
    store.append({ t: 2000, text: '[ERR] Socket failed', session: 's1' });
    const route = createLogRoutes(store);

    const denied = await call(route, '/api/logs/summary', { authorized: false });
    assert.equal(denied.status, 401);

    const summary = await call(route, '/api/logs/summary');
    assert.equal(summary.status, 200);
    assert.equal(summary.body.total, 2);
    assert.equal(summary.body.categories.find(item => item.name === 'socket').count, 1);

    const list = await call(route, '/api/logs?level=error&session=s1&limit=10');
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.rows[0].message, '[ERR] Socket failed');
    assert.equal(list.body.rows[0].session, 's1');
});

test('日誌 API 拒絕非 GET 並限制非法查詢不會拋錯', async () => {
    const route = createLogRoutes(new LogStore({ file: ':memory:' }));
    const post = await call(route, '/api/logs', { method: 'POST' });
    assert.equal(post.status, 405);
    const invalid = await call(route, '/api/logs?beforeId=nope&limit=9999');
    assert.equal(invalid.status, 200);
    assert.equal(invalid.body.ok, true);
});
