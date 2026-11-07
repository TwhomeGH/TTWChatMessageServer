/** 監控歷史 API：登入、場次列表、訊息分頁與缺少場次。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { MonitorHistoryStore } = require('../ScriptLib/monitor/store.cjs');
const { createMonitorRoutes } = require('../MonitorRoutes.cjs');

function request(route, path, authorized = true) {
    return new Promise(resolve => {
        const req = Readable.from([]);
        req.url = path;
        req.method = 'GET';
        const res = {
            setHeader() {},
            writeHead(status) { this.status = status; },
            end(body) {
                let data = body;
                try { data = JSON.parse(body); } catch { /* text */ }
                resolve({ status: this.status, data });
            }
        };
        route(req, res, authorized);
    });
}

test('MonitorRoutes 需要登入並回傳場次與分頁訊息', async t => {
    const store = new MonitorHistoryStore({ file: ':memory:', now: () => 1000 });
    t.after(() => store.close());
    const session = store.startSession({ startedAt: 1000 });
    store.append(session, {
        t: 1001, category: 'chat', platform: 'TikTok', user: 'Alice', message: 'hello'
    });
    const route = createMonitorRoutes(store);

    assert.equal((await request(route, '/api/monitor/sessions', false)).status, 401);
    const sessions = await request(route, '/api/monitor/sessions');
    assert.equal(sessions.status, 200);
    assert.equal(sessions.data.sessions.length, 1);
    assert.equal(sessions.data.sessions[0].messageCount, 1);

    const messages = await request(route, `/api/monitor/messages?session=${encodeURIComponent(session)}&page=1`);
    assert.equal(messages.status, 200);
    assert.equal(messages.data.total, 1);
    assert.equal(messages.data.messages[0].message, 'hello');

    assert.equal((await request(route, '/api/monitor/messages')).status, 400);
    assert.equal((await request(route, '/api/monitor/messages?session=missing')).status, 404);
});
