import test from 'node:test';
import assert from 'node:assert/strict';
import { messageTime, mergeStatEntries, MessageStats } from '../MessageStats.mjs';
import { messageTime as parseTime } from '../ScriptLib/messageStats/time.mjs';
import { mergeStatEntries as mergeSnapshots } from '../ScriptLib/messageStats/merge.mjs';
import { isDuplicate } from '../ScriptLib/messageStats/dedup.mjs';

/** 每個案例使用獨立快取與明確時鐘，不等待真實的去重期限。 */
function cache() {
    return { ids: new Map(), crossSource: new Map() };
}

/** 建立同一平台使用者的事件；個別案例覆寫管道或 ID。 */
function event(overrides = {}) {
    return {
        platform: 'Twitch', transport: 'api', isTest: false,
        user: 'user', message: '留言', id: null, key: 'local', ...overrides
    };
}

test('舊入口持續轉出相同時間與合併函數', () => {
    assert.equal(messageTime, parseTime);
    assert.equal(mergeStatEntries, mergeSnapshots);
});

test('時間解析保留秒、毫秒、日期與有效範圍的邊界', t => {
    const now = 1800000000000;
    t.mock.method(Date, 'now', () => now);
    for (const value of [now, now / 1000, String(now / 1000), new Date(now), new Date(now).toISOString()]) {
        assert.equal(messageTime(value), now);
    }
    assert.equal(messageTime(946684800000), 946684800000);
    assert.equal(messageTime(946684799999), null);
    assert.equal(messageTime(now + 60000), now + 60000);
    assert.equal(messageTime(now + 60001), null);
    for (const value of [null, undefined, '', false, true, 'bad', NaN, Infinity, 0]) {
        assert.equal(messageTime(value), null);
    }
});

test('跨管道窗口含第 3000 毫秒，重複抵達不延長窗口', () => {
    const state = cache();
    assert.equal(isDuplicate(state, event(), 0), false);
    assert.equal(isDuplicate(state, event({ transport: 'userscript' }), 3000), true);
    assert.equal(isDuplicate(state, event({ transport: 'userscript' }), 3001), false);
});

test('ID 重複會刷新期限，到達刷新後 30 分鐘即過期', () => {
    const state = cache();
    const message = event({ id: '1', key: 'Twitch:1' });
    assert.equal(isDuplicate(state, message, 0), false);
    assert.equal(isDuplicate(state, message, 1799999), true);
    assert.equal(isDuplicate(state, message, 3599999), false);
});

test('去重快取最多 10000 筆，淘汰後的舊事件可重新計入', () => {
    const state = cache();
    for (let i = 0; i <= 10000; i++) {
        isDuplicate(state, event({ id: String(i), key: 'Twitch:' + i, message: String(i) }), i);
    }
    assert.equal(state.ids.size, 10000);
    assert.equal(state.crossSource.size, 10000);
    assert.equal(isDuplicate(state, event({ id: '0', key: 'Twitch:0', message: '0' }), 10001), false);
});

test('clear 清除去重狀態，原 ID 能在新週期重新計數', () => {
    const stats = new MessageStats();
    const meta = { platform: 'Twitch', id: '1' };
    assert.ok(stats.record('留言', meta));
    assert.equal(stats.record('留言', meta), null);
    stats.clear();
    assert.ok(stats.record('留言', meta));
    assert.equal(stats.all()[0].count, 1);
});
