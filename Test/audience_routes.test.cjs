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
        },
        mergePreview(value) {
            calls.push(['mergePreview', value]);
            return { applied: false, platform: value.platform };
        },
        merge(value) {
            calls.push(['merge', value]);
            return { applied: true, platform: value.platform };
        },
        latestMerge(platform) {
            calls.push(['latestMerge', platform]);
            return { id: 'mb_1', platform, undoable: true };
        },
        undoLastMerge(value) {
            calls.push(['undoLastMerge', value]);
            return { applied: true, batchId: value.batchId };
        }
    };
    return { calls, serve: createAudienceRoutes(tracker) };
}

function request(serve, url, { method = 'GET', authorized = false, body = '' } = {}) {
    return new Promise(resolve => {
        const req = new EventEmitter();
        Object.assign(req, { url, method, headers: {} });
        const res = {
            setHeader() {},
            writeHead(status) { this.status = status; },
            end(value) { resolve({ status: this.status, body: value ? JSON.parse(value) : null }); }
        };
        serve(req, res, authorized);
        setImmediate(() => {
            if (body) req.emit('data', Buffer.from(body));
            req.emit('end');
        });
    });
}

test('常客 API 需要登入，平台名稱會正規化並轉小寫查詢', async () => {
    const f = fixture();
    assert.equal((await request(f.serve, '/api/audience')).status, 401);
    assert.equal((await request(f.serve, '/api/audience', { method: 'POST', authorized: true })).status, 405);

    const list = await request(f.serve, '/api/audience?platform=tiktok&q=alice&sort=score&page=2&tenures=newcomer,friend', { authorized: true });
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.deepEqual(f.calls[0], ['list', {
        platform: 'TikTok', q: 'alice', sort: 'score', page: 2, tenures: ['newcomer', 'friend']
    }]);

    const detail = await request(f.serve, '/api/audience/user?platform=twitch&user=Alice', { authorized: true });
    assert.equal(detail.status, 200);
    assert.deepEqual(f.calls[1], ['details', { platform: 'Twitch', user: 'alice' }]);

    assert.equal((await request(f.serve, '/api/audience/user?platform=twitch&user=Bob', { authorized: true })).status, 404);
    assert.equal((await request(f.serve, '/api/audience/user?platform=twitch', { authorized: true })).status, 404);

    assert.equal((await request(f.serve, '/api/audience/merge/preview?platform=tiktok&source=old&target=new')).status, 401);
    const preview = await request(f.serve,
        '/api/audience/merge/preview?platform=tiktok&source=old&target=new', { authorized: true });
    assert.equal(preview.status, 200);
    assert.deepEqual(f.calls.at(-1), ['mergePreview', { platform: 'TikTok', sourceKey: 'old', targetKey: 'new' }]);
    const applied = await request(f.serve, '/api/audience/merge', {
        method: 'POST', authorized: true,
        body: JSON.stringify({ platform: 'tiktok', sourceKey: 'old', targetKey: 'new' })
    });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.applied, true);
    assert.deepEqual(f.calls.at(-1), ['merge', { platform: 'tiktok', sourceKey: 'old', targetKey: 'new' }]);
    assert.equal((await request(f.serve, '/api/audience/merge', { method: 'GET', authorized: true })).status, 405);

    const latest = await request(f.serve, '/api/audience/merge/latest?platform=tiktok', { authorized: true });
    assert.equal(latest.status, 200);
    assert.equal(latest.body.latest.id, 'mb_1');
    assert.deepEqual(f.calls.at(-1), ['latestMerge', 'TikTok']);
    const undo = await request(f.serve, '/api/audience/merge/undo', {
        method: 'POST', authorized: true, body: JSON.stringify({ platform: 'tiktok', batchId: 'mb_1' })
    });
    assert.equal(undo.status, 200);
    assert.equal(undo.body.applied, true);
    assert.deepEqual(f.calls.at(-1), ['undoLastMerge', { platform: 'tiktok', batchId: 'mb_1' }]);
});
