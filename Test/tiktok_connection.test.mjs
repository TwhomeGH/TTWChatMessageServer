import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokConnectionManager } from '../ScriptLib/tiktok/connection.mjs';

const silent = { log() {}, info() {}, warn() {}, error() {} };
const tick = () => new Promise(r => setTimeout(r, 0));
const flush = () => new Promise(r => setImmediate(r));

/** 假的 TikTokLiveConnection。 */
function fakeConnection() {
    return {
        state: { roomInfo: { data: { title: '直播間標題', user_count: 42 } } },
        fetchRoomInfo: async () => ({ data: { user_count: 7, start_time: 1700000000 } }),
        connect: async () => ({ roomId: 'r2' })
    };
}

function makeDeps(overrides = {}) {
    const calls = [];
    const state = { tikTokViewer: 0, cacheNum: 0 };
    const deps = {
        getConnection: fakeConnection,
        tiktokName: 'chan',
        isTK: true,
        isTwitch: false,
        getTwitchViewerCount: () => 0,
        setTikTokViewerCount: (n) => { state.tikTokViewer = n; },
        setCacheUserNum: (n) => { state.cacheNum = n; },
        getCacheUserNum: () => state.cacheNum,
        getCacheUserList: () => [],
        updateCombinedViewerCount: () => calls.push(['combined']),
        notify: async (...a) => calls.push(['notify', ...a]),
        sendSystem: (t) => calls.push(['system', t]),
        writeLog: (...a) => calls.push(['log', ...a]),
        reportTraffic: (...a) => calls.push(['traffic', ...a]),
        getAutoClip: () => ({ updatePlatformViewers: (...a) => calls.push(['autoclip', ...a]) }),
        tikTokChatGuard: { beginReconnect: () => calls.push(['guard']) },
        adScheduler: { resume: () => calls.push(['resume']) },
        handleExit: () => calls.push(['exit']),
        isEnd: () => false,
        getStreamEnded: () => false,
        logger: silent,
        ...overrides
    };
    return { deps, calls, state };
}

test('onConnected：設定觀眾數、通知並啟動輪詢', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { deps, calls, state } = makeDeps();
    const mgr = createTikTokConnectionManager(deps);

    mgr.onConnected({ roomId: 'r1' });

    assert.equal(state.tikTokViewer, 42);
    assert.equal(state.cacheNum, 42);
    assert.ok(calls.some(c => c[0] === 'notify' && String(c[1]).includes('連線成功')));
    assert.ok(calls.some(c => c[0] === 'resume'));

    t.mock.timers.tick(30000);
    await tick();

    assert.equal(state.tikTokViewer, 7);
    assert.ok(calls.some(c => c[0] === 'combined'));
    assert.ok(calls.some(c => c[0] === 'traffic'));
});

test('scheduleReconnect：首波延遲 15 秒後重連', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { deps, calls } = makeDeps();
    const mgr = createTikTokConnectionManager(deps);

    mgr.scheduleReconnect();
    assert.ok(calls.some(c => c[0] === 'system' && c[1].includes('15 秒')));

    t.mock.timers.tick(15000);
    await flush();

    assert.ok(calls.some(c => c[0] === 'guard'));
    assert.ok(calls.some(c => c[0] === 'notify' && String(c[1]).includes('連線成功')));
    mgr.stop();
});

test('scheduleReconnect：達最大次數則呼叫 handleExit', () => {
    const { deps, calls } = makeDeps({ retryMax: 0 });
    const mgr = createTikTokConnectionManager(deps);

    mgr.scheduleReconnect();

    assert.ok(calls.some(c => c[0] === 'exit'));
});

test('scheduleReconnect：已結束（isEnd）時不重連', () => {
    const { deps, calls } = makeDeps({ isEnd: () => true });
    const mgr = createTikTokConnectionManager(deps);

    mgr.scheduleReconnect();

    assert.ok(!calls.some(c => c[0] === 'system'));
});

test('stop：停止輪詢後不再抓取觀眾數', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { deps, state } = makeDeps();
    const mgr = createTikTokConnectionManager(deps);

    mgr.onConnected({ roomId: 'r1' });
    mgr.stop();
    t.mock.timers.tick(60000);
    await tick();

    assert.equal(state.tikTokViewer, 42); // 未被輪詢覆蓋
});
