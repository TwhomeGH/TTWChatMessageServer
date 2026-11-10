/** 常客頁以外的監控歷史 SQLite：場次、分頁、篩選、保留與測試訊息排除。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MonitorHistoryStore } = require('../ScriptLib/monitor/store.cjs');
const { MediaCache } = require('../ScriptLib/media/cache.cjs');

function entry(t, overrides = {}) {
    return {
        t, category: 'chat', platform: 'TikTok', user: 'Alice', message: `hello ${t}`,
        img: 'https://example.com/a.png', session: { joins: 1, likes: 2, chats: 1 },
        ...overrides
    };
}

test('場次摘要、分頁、搜尋與分類篩選', t => {
    const store = new MonitorHistoryStore({ file: ':memory:', maxSessions: 5, now: () => 1000 });
    t.after(() => store.close());
    const session = store.startSession({ startedAt: 1000 });
    assert.equal(store.append(session, entry(1001)), true);
    assert.equal(store.append(session, entry(1002, {
        user: 'Bob', message: 'second', category: 'like', platform: 'Twitch',
        session: { joins: 2, likes: 5, chats: 3 }
    })), true);
    assert.equal(store.append(session, entry(1003, { isTest: true })), false);
    store.endSession(session, 2000);

    const sessions = store.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].messageCount, 2);
    assert.deepEqual(sessions[0].platforms.sort(), ['TikTok', 'Twitch'].sort());
    assert.equal(sessions[0].endedAt, 2000);
    assert.equal(sessions[0].joins, 2);
    assert.equal(sessions[0].likes, 5);
    assert.equal(sessions[0].chats, 3);

    const page = store.listMessages({ sessionId: session, page: 1, pageSize: 1 });
    assert.equal(page.total, 2);
    assert.equal(page.pages, 2);
    assert.equal(page.messages[0].message, 'second'); // 歷史預設最新在前
    assert.equal(page.messages[0].category, 'like');
    assert.equal(store.listMessages({ sessionId: session, page: 2, pageSize: 1 }).messages[0].message, 'hello 1001');

    assert.equal(store.listMessages({ sessionId: session, q: 'second' }).total, 1);
    assert.equal(store.listMessages({ sessionId: session, categories: ['like'] }).total, 1);
    assert.equal(store.listMessages({ sessionId: session, platform: 'TikTok' }).total, 1);
    assert.equal(store.listMessages({ sessionId: 'missing' }), null);
});

test('保留最近場次、天數與每場訊息上限', t => {
    let now = 1000;
    const store = new MonitorHistoryStore({ file: ':memory:', maxSessions: 2, retentionDays: 1, now: () => now });
    t.after(() => store.close());
    const a = store.startSession({ startedAt: 1000 });
    store.append(a, entry(1001));
    const b = store.startSession({ startedAt: 2000 });
    store.append(b, entry(2001));
    const c = store.startSession({ startedAt: 3000 });
    store.append(c, entry(3001));

    assert.equal(store.listSessions().length, 2);
    assert.ok(!store.getSession(a));
    assert.ok(store.getSession(b));
    assert.ok(store.getSession(c));

    // 超過天數的場次在 prune 時移除。
    now = 1000 + 3 * 86400000;
    store.prune();
    assert.equal(store.listSessions().length, 0);
});

test('每場只保留最新訊息且同步 message_count', t => {
    const store = new MonitorHistoryStore({ file: ':memory:', maxMessagesPerSession: 2, now: () => 1000 });
    t.after(() => store.close());
    const session = store.startSession({ startedAt: 1000 });
    store.append(session, entry(1));
    store.append(session, entry(2));
    store.append(session, entry(3));
    const result = store.listMessages({ sessionId: session, page: 1, pageSize: 10 });
    assert.equal(result.total, 2);
    assert.deepEqual(result.messages.map(item => item.message), ['hello 3', 'hello 2']);
    assert.equal(store.getSession(session).messageCount, 2);
});

test('歷史把 data URI materialize 成 /media，不把 base64 寫進 SQLite', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttw-monitor-media-'));
    let now = 1000;
    const cache = new MediaCache({
        dbFile: path.join(dir, 'media.sqlite'), imageDir: path.join(dir, 'images'),
        baseUrl: 'http://media.test', now: () => now
    });
    const store = new MonitorHistoryStore({
        file: path.join(dir, 'monitor.sqlite'), retentionDays: 1, now: () => now, mediaCache: cache
    });
    t.after(() => {
        store.close();
        cache.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const session = store.startSession({ startedAt: now });
    store.append(session, entry(1001, { message: `look ${png}`, img: png, giftImg: png }));
    const page = store.listMessages({ sessionId: session, page: 1, pageSize: 10 });
    assert.equal(page.messages[0].message.includes('data:image'), false);
    assert.match(page.messages[0].message, /http:\/\/media\.test\/media\/[a-f0-9]{64}/);
    assert.match(page.messages[0].img, /http:\/\/media\.test\/media\//);
    assert.equal(cache.list({ type: 'image/png' }).items[0].source, 'inline');
    assert.equal(fs.readdirSync(path.join(dir, 'images')).length, 1);

    now += 2 * 86400000;
    store.prune();
    assert.equal(fs.readdirSync(path.join(dir, 'images')).length, 0);
});
