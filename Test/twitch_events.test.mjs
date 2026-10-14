import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onViewer, onError, onStreamOnline, onStreamOffline, onFollow, onCheer } from '../ScriptLib/twitch/events.mjs';

const silent = { log() {}, error() {} };

/** 建立一組記錄呼叫的假 deps。 */
function makeDeps(overrides = {}) {
    const calls = [];
    const autoClip = { resets: 0, viewers: [], reset() { this.resets++; }, updateViewers(v) { this.viewers.push(v); } };
    const deps = {
        getAutoClip: () => autoClip,
        reportTraffic: (d) => calls.push(['traffic', d]),
        writeLog: (...a) => calls.push(['log', ...a]),
        notify: async (...a) => calls.push(['notify', ...a]),
        sendSystem: (t) => calls.push(['system', t]),
        sendNotice: (u, t, i) => calls.push(['notice', u, t, i]),
        setViewerCount: (n) => calls.push(['viewers', n]),
        updateCombinedViewerCount: () => calls.push(['combined']),
        getUserIcon: async (id) => `icon:${id}`,
        logger: silent,
        ...overrides
    };
    return { deps, calls, autoClip };
}

test('onViewer：stream 為 null 時重置 autoClip', () => {
    const { deps, autoClip } = makeDeps();
    onViewer(null, deps);
    assert.equal(autoClip.resets, 1);
});

test('onViewer：更新觀眾數、回報流量、重算合併', () => {
    const { deps, calls, autoClip } = makeDeps();
    onViewer({ viewers: 42, id: 7, startDate: new Date('2026-01-01T00:00:00Z') }, deps);
    assert.deepEqual(autoClip.viewers, [42]);
    assert.ok(calls.some(c => c[0] === 'viewers' && c[1] === 42));
    assert.ok(calls.some(c => c[0] === 'traffic' && c[1].streamId === '7'));
    assert.ok(calls.some(c => c[0] === 'combined'));
});

test('onFollow：取頭像、通知與系統訊息', async () => {
    const { deps, calls } = makeDeps();
    await onFollow({ userId: 'u1', userDisplayName: 'Alice' }, deps);
    assert.ok(calls.some(c => c[0] === 'notify' && c[1] === 'Alice'));
    assert.ok(calls.some(c => c[0] === 'notice' && c[1] === 'Alice' && c[3] === 'icon:u1'));
});

test('onCheer：帶上小奇點數量', async () => {
    const { deps, calls } = makeDeps();
    await onCheer({ userId: 'u2', userDisplayName: 'Bob', bits: 500 }, deps);
    assert.ok(calls.some(c => c[0] === 'notify' && c[2] === '送出 500 小奇點'));
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
