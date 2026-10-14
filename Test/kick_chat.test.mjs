import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startKickChat } from '../ScriptLib/kick/chat.mjs';

const silent = { log() {}, info() {}, warn() {}, error() {} };
const tick = () => new Promise(r => setTimeout(r, 0));

/** 假的 KickWebSocket：記錄事件處理器並可手動觸發。 */
function fakeSocket() {
    const handlers = {};
    return {
        handlers,
        on(ev, cb) { handlers[ev] = cb; return this; },
        connect() { return Promise.resolve(); }
    };
}

/** 建立記錄呼叫的假 deps（channelName 用已知頻道，避免呼叫 API）。 */
function makeDeps(socket, overrides = {}) {
    const calls = [];
    const deps = {
        channelName: 'nuclear0709',
        writeLog: (...a) => calls.push(['log', ...a]),
        notify: async (...a) => calls.push(['notify', ...a]),
        sendSystem: (t) => calls.push(['system', t]),
        sendChat: (u, m, a) => calls.push(['chat', u, m, a]),
        sendNotice: (u, m, a) => calls.push(['notice', u, m, a]),
        reportTraffic: (...a) => calls.push(['traffic', ...a]),
        reportFiltered: (...a) => calls.push(['filtered', ...a]),
        filter: () => ({ blocked: false }),
        recordHeat: () => true,
        replaceEmojis: (t) => t,
        translate: async (t) => t,
        axios: { get: async () => ({ data: { data: [] } }) },
        createSocket: () => socket,
        logger: silent,
        ...overrides
    };
    return { deps, calls };
}

test('未指定頻道時不建立 socket', async () => {
    const socket = fakeSocket();
    const { deps, calls } = makeDeps(socket, { channelName: '' });
    const ws = await startKickChat(deps);
    assert.equal(ws, undefined);
    assert.ok(calls.some(c => c[0] === 'log'));
});

test('ready 事件：推播連線通知與系統訊息', async () => {
    const socket = fakeSocket();
    const { deps, calls } = makeDeps(socket);
    await startKickChat(deps);

    socket.handlers.ready();

    assert.ok(calls.some(c => c[0] === 'notify' && c[1] === 'Kick 連線'));
    assert.ok(calls.some(c => c[0] === 'system'));
});

test('ChatMessage：推播並送出聊天（頭像由 sender 提供，不查 API）', async () => {
    const socket = fakeSocket();
    const { deps, calls } = makeDeps(socket);
    await startKickChat(deps);

    await socket.handlers.ChatMessage({ id: '1', content: 'hi', created_at: 't', sender: { username: 'Alice', id: 5, profile_picture: 'pic' } });
    await tick();

    assert.ok(calls.some(c => c[0] === 'notify' && c[1] === 'Alice'));
    assert.ok(calls.some(c => c[0] === 'chat' && c[1] === 'Alice'));
});

test('ChatMessage：被過濾器阻擋時回報但不送出', async () => {
    const socket = fakeSocket();
    const { deps, calls } = makeDeps(socket, { filter: () => ({ blocked: true, reason: 'spam' }) });
    await startKickChat(deps);

    await socket.handlers.ChatMessage({ id: '1', content: 'x', created_at: 't', sender: { username: 'Bob', id: 6, profile_picture: 'pic' } });

    assert.ok(calls.some(c => c[0] === 'filtered'));
    assert.ok(!calls.some(c => c[0] === 'chat'));
});

test('connect 失敗：推播連線失敗', async () => {
    const socket = fakeSocket();
    socket.connect = () => Promise.reject(new Error('boom'));
    const { deps, calls } = makeDeps(socket);
    await startKickChat(deps);
    await tick();

    assert.ok(calls.some(c => c[0] === 'notify' && c[1] === 'Kick 連線失敗'));
});
