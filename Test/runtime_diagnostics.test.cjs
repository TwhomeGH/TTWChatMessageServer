const test = require('node:test');
const assert = require('node:assert/strict');
const { DIAGNOSTIC_COMMANDS, runDiagnostic } = require('../ScriptLib/runtime/diagnostics.cjs');

const state = {
    process: { pid: 123, uptimeSec: 9 },
    platforms: ['tiktok', 'twitch'],
    transports: { socket: true, bark: false, ntfy: true },
    viewers: { TikTok: { value: 3, at: 1 } },
    combinedViewers: 3,
    session: { joins: 1, likes: 2, chats: 3 },
    socket: { connected: true, queued: 0 },
    autoClip: { config: { mode: 'live' }, count: 2, recent: [] },
    twitch: { userId: '42', apiReady: true },
    clips: [{ id: 'abc', confirmed: false }],
    chat: { at: 10, platforms: { tiktok: { received: 2, sent: 1 }, twitch: { received: 1, sent: 1 } } },
    filter: { evaluated: 3, blocked: 1, byReason: { spam: 1 } }
};

test('runtime diagnostics 只接受白名單命令並回傳對應區塊', () => {
    assert.ok(DIAGNOSTIC_COMMANDS.includes('snapshot'));
    const snapshot = runDiagnostic('snapshot', state);
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.data.process.pid, 123);
    assert.equal(snapshot.data.transports.ntfy, true);

    const ping = runDiagnostic('ping', state);
    assert.deepEqual(ping.data.process, state.process);

    const platforms = runDiagnostic('PLATFORMS', state);
    assert.deepEqual(platforms.data, ['tiktok', 'twitch']);

    const autoclip = runDiagnostic('autoclip', state);
    assert.equal(autoclip.data.config.mode, 'live');
    assert.equal(autoclip.data.count, 2);

    const chat = runDiagnostic('chat', state);
    assert.equal(chat.data.platforms.tiktok.received, 2);
    assert.ok(DIAGNOSTIC_COMMANDS.includes('chat'));

    const filter = runDiagnostic('filter', state);
    assert.equal(filter.data.blocked, 1);
    assert.ok(DIAGNOSTIC_COMMANDS.includes('filter'));
});

test('runtime diagnostics 未知命令不執行任何動作', () => {
    const result = runDiagnostic('eval', state);
    assert.equal(result.ok, false);
    assert.match(result.error, /不支援/);
    assert.ok(result.commands.includes('snapshot'));
});
