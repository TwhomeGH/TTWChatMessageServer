import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onViewer, onError, onStreamOnline, onStreamOffline, onFollow, onCheer, onSubscription } from '../ScriptLib/twitch/events.mjs';

const silent = { log() {}, error() {} };

/** 建立一組記錄呼叫的假 deps。 */
function makeDeps(overrides = {}) {
    const calls = [];
    const sessionStats = { follows: 0, subscriptions: 0, gifts: 0 };
    const autoClip = { resets: 0, viewers: [], reset() { this.resets++; }, updateViewers(v) { this.viewers.push(v); } };
    const deps = {
        getAutoClip: () => autoClip,
        reportTraffic: (d) => calls.push(['traffic', d]),
        writeLog: (...a) => calls.push(['log', ...a]),
        notify: async (...a) => calls.push(['notify', ...a]),
        sendSystem: (t) => calls.push(['system', t]),
        sendNotice: (u, t, i, category = 'system') => calls.push(['notice', u, t, i, category]),
        sessionStats,
        setViewerCount: (n) => { calls.push(['viewers', n]); return n; },
        resetViewerCount: () => calls.push(['resetViewer']),
        updateCombinedViewerCount: () => calls.push(['combined']),
        getUserIcon: async (id) => `icon:${id}`,
        logger: silent,
        ...overrides
    };
    return { deps, calls, autoClip, sessionStats };
}

test('onViewer：stream 為 null 時重置 autoClip 並歸零', () => {
    const { deps, autoClip, calls } = makeDeps();
    onViewer(null, deps);
    assert.equal(autoClip.resets, 1);
    assert.ok(calls.some(c => c[0] === 'resetViewer'));
    assert.ok(calls.some(c => c[0] === 'combined'));
});

test('onViewer：更新觀眾數、回報流量、重算合併', () => {
    const { deps, calls, autoClip } = makeDeps();
    onViewer({ viewers: 42, id: 7, startDate: new Date('2026-01-01T00:00:00Z') }, deps);
    assert.deepEqual(autoClip.viewers, [42]);
    assert.ok(calls.some(c => c[0] === 'viewers' && c[1] === 42));
    assert.ok(calls.some(c => c[0] === 'traffic' && c[1].streamId === '7'));
    assert.ok(calls.some(c => c[0] === 'combined'));
});

test('onViewer：使用收斂後的有效值（短暫 0 被保留）', () => {
    const { deps, calls, autoClip } = makeDeps({ setViewerCount: () => 42 });
    onViewer({ viewers: 0, id: 1 }, deps);
    assert.deepEqual(autoClip.viewers, [42]);
    assert.ok(calls.some(c => c[0] === 'traffic' && c[1].userNum === 42));
});

test('onFollow：取頭像、通知與 follow 分類，並累計本場關注', async () => {
    const { deps, calls, sessionStats } = makeDeps();
    await onFollow({ userId: 'u1', userDisplayName: 'Alice' }, deps);
    assert.ok(calls.some(c => c[0] === 'notify' && c[1] === 'Alice'));
    assert.ok(calls.some(c => c[0] === 'notice' && c[1] === 'Alice' && c[3] === 'icon:u1' && c[4] === 'follow'));
    assert.equal(sessionStats.follows, 1);
});

test('onCheer：帶上小奇點數量、gift 分類與本場送禮', async () => {
    const { deps, calls, sessionStats } = makeDeps();
    await onCheer({ userId: 'u2', userDisplayName: 'Bob', bits: 500 }, deps);
    assert.ok(calls.some(c => c[0] === 'notify' && c[2] === '送出 500 小奇點'));
    assert.ok(calls.some(c => c[0] === 'notice' && c[4] === 'gift'));
    assert.equal(sessionStats.gifts, 1);
});

test('onSubscription：訂閱與贈訂都計入 subscribe 分類', async () => {
    const { deps, calls, sessionStats } = makeDeps();
    await onSubscription({ userId: 'u3', userDisplayName: 'Cara', tier: '1000', isGift: false }, deps);
    await onSubscription({ userId: 'u4', userDisplayName: 'Dan', tier: '2000', isGift: true }, deps);
    assert.ok(calls.some(c => c[0] === 'notice' && c[1] === 'Cara' && c[4] === 'subscribe' && c[2].includes('Tier 1')));
    assert.ok(calls.some(c => c[0] === 'notice' && c[1] === 'Dan' && c[4] === 'subscribe' && c[2].includes('贈訂')));
    assert.equal(sessionStats.subscriptions, 2);
});

test('onError：送出系統訊息並重置 autoClip', () => {
    const { deps, calls, autoClip } = makeDeps();
    onError(new Error('boom'), deps);
    assert.equal(autoClip.resets, 1);
    assert.ok(calls.some(c => c[0] === 'system' && c[1].includes('boom')));
});

test('onStreamOnline／Offline：送出系統訊息', async () => {
    const { deps, calls } = makeDeps();
    await onStreamOnline({ broadcasterName: 'Chan', type: 'live' }, deps);
    await onStreamOffline({ broadcasterName: 'Chan' }, deps);
    assert.ok(calls.some(c => c[0] === 'system' && c[1].includes('直播開始')));
    assert.ok(calls.some(c => c[0] === 'system' && c[1].includes('直播結束')));
});
