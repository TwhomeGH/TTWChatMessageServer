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
    clips: [{ id: 'abc', confirmed: false }]
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
});

test('runtime diagnostics 未知命令不執行任何動作', () => {
    const result = runDiagnostic('eval', state);
    assert.equal(result.ok, false);
    assert.match(result.error, /不支援/);
    assert.ok(result.commands.includes('snapshot'));
});
