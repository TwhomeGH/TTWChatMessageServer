const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAudienceRoutes } = require('../AudienceRoutes.cjs');

function fixture() {
    const calls = [];
    const tracker = {
        list(value) {
            calls.push(['list', value]);
            return { users: [{ displayName: 'Alice' }], total: 1, page: value.page, pageSize: 50 };
        },
        details(platform, user) {
            calls.push(['details', { platform, user }]);
            return user === 'alice' ? { platform, userKey: user, displayName: 'Alice' } : null;
        }
    };
    return { calls, serve: createAudienceRoutes(tracker) };
}

function request(serve, url, { method = 'GET', authorized = false } = {}) {
    return new Promise(resolve => {
        const req = new EventEmitter();
        Object.assign(req, { url, method, headers: {} });
        const res = {
            setHeader() {},
            writeHead(status) { this.status = status; },
            end(body) { resolve({ status: this.status, body: body ? JSON.parse(body) : null }); }
        };
        serve(req, res, authorized);
    });
}

test('常客 API 需要登入，平台名稱會正規化並轉小寫查詢', async () => {
    const f = fixture();
    assert.equal((await request(f.serve, '/api/audience')).status, 401);
    assert.equal((await request(f.serve, '/api/audience', { method: 'POST', authorized: true })).status, 405);

    const list = await request(f.serve, '/api/audience?platform=tiktok&q=alice&sort=score&page=2', { authorized: true });
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.deepEqual(f.calls[0], ['list', { platform: 'TikTok', q: 'alice', sort: 'score', page: 2 }]);

    const detail = await request(f.serve, '/api/audience/user?platform=twitch&user=Alice', { authorized: true });
    assert.equal(detail.status, 200);
    assert.deepEqual(f.calls[1], ['details', { platform: 'Twitch', user: 'alice' }]);

    assert.equal((await request(f.serve, '/api/audience/user?platform=twitch&user=Bob', { authorized: true })).status, 404);
    assert.equal((await request(f.serve, '/api/audience/user?platform=twitch', { authorized: true })).status, 404);
});
