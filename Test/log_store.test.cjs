const test = require('node:test');
const assert = require('node:assert/strict');
const { LogStore } = require('../ScriptLib/logs/store.cjs');
const { classifyCategory, classifyLevel, classifySource } = require('../ScriptLib/logs/classify.cjs');

test('日誌分類：主題與等級分開，[OUT] 內含 AutoClip 仍歸 AutoClip', () => {
    assert.equal(classifyCategory('[OUT] [AutoClip] 剪輯建立成功'), 'autoclip');
    assert.equal(classifyCategory('[ERR] Socket reconnect failed'), 'socket');
    assert.equal(classifyLevel('[ERR] Socket reconnect failed'), 'error');
    assert.equal(classifyLevel('⚠️ TikTok 尚未確認'), 'warn');
    assert.equal(classifySource('[OUT] [AutoClip] 剪輯建立成功'), 'child');
    assert.equal(classifySource('[SYSTEM] Starting TikTok.js'), 'main');
});

test('RAW 與 MEMBER socket payload 各自分類，不再混進 [OUT]', () => {
    assert.equal(classifyCategory('[RAW] {"event":"MEMBER"}'), 'raw');
    assert.equal(classifySource('[RAW] {"event":"MEMBER"}'), 'child');
    assert.equal(classifyLevel('[RAW] {"event":"MEMBER"}'), 'debug');
    assert.equal(classifyCategory('[OUT] [MEMBER] socket payload endpoints=1 {}'), 'member');
    assert.equal(classifySource('[OUT] [MEMBER] socket payload endpoints=1 {}'), 'child');
});

test('LogStore 寫入、摘要、篩選與 keyset 分頁', () => {
    const store = new LogStore({ file: ':memory:' });
    store.append({ t: 1000, text: '[SYSTEM] 啟動', session: 's1' });
    store.append({ t: 2000, text: '[OUT] [AutoClip] 觸發', session: 's1' });
    store.append({ t: 3000, text: '[ERR] [Socket] 連線失敗', session: 's2' });
    store.append({ t: 4000, text: '[OUT] 普通輸出', session: 's2' });

    const summary = store.summary();
    assert.equal(summary.total, 4);
    assert.deepEqual(summary.categories.map(item => item.name).sort(), ['autoclip', 'out', 'socket', 'system']);
    assert.equal(summary.levels.find(item => item.name === 'error').count, 1);
    assert.deepEqual(summary.sessions.sort(), ['s1', 's2']);

    const filtered = store.list({ category: 'autoclip' });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.rows[0].category, 'autoclip');
    assert.equal(filtered.rows[0].session, 's1');

    const first = store.list({ limit: 2 });
    assert.equal(first.rows.length, 2);
    assert.equal(first.hasMore, true);
    const second = store.list({ limit: 2, beforeId: first.nextBeforeId });
    assert.equal(second.rows.length, 2);
    assert.equal(second.hasMore, false);
    assert.ok(second.rows[0].id < first.rows[1].id);
});

test('LogStore 可用關鍵字搜尋訊息與來源', () => {
    const store = new LogStore({ file: ':memory:' });
    store.append({ t: 1000, text: '[OUT] [TikTok] 測試訊息' });
    store.append({ t: 2000, text: '[ERR] Socket failed' });
    assert.equal(store.list({ q: 'TikTok' }).total, 1);
    assert.equal(store.list({ q: 'child' }).total, 2);
    assert.equal(store.list({ level: 'error' }).total, 1);
});
