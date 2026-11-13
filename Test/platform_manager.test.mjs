import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformManager } from '../ScriptLib/runtime/platform-manager.mjs';

test('同一平台只啟動一次，並回報 starting／running', async () => {
    const reports = [];
    let calls = 0;
    const manager = createPlatformManager({
        starts: { tiktok: () => { calls++; return 'connecting'; } },
        report: (platform, state, error) => reports.push([platform, state, error])
    });
    const first = await manager.add('TikTok');
    assert.deepEqual(first, { ok: true, state: 'connecting' });
    const second = await manager.add('tiktok');
    assert.deepEqual(second, { ok: false, state: 'running', reason: 'already-running' });
    assert.equal(calls, 1);
    assert.deepEqual(reports, [
        ['tiktok', 'starting', undefined],
        ['tiktok', 'connecting', undefined],
        ['tiktok', 'running', undefined]
    ]);
});

test('失敗會清除啟動狀態並可重試，未知平台回報 failed', async () => {
    const reports = [];
    let attempts = 0;
    const manager = createPlatformManager({
        starts: {
            twitch: () => {
                attempts++;
                if (attempts === 1) throw new Error('token invalid');
                return 'running';
            }
        },
        report: (platform, state, error) => reports.push([platform, state, error])
    });
    await assert.rejects(() => manager.add('twitch'), /token invalid/);
    assert.equal(manager.has('twitch'), false);
    assert.ok(reports.some(([, state, error]) => state === 'failed' && error === 'token invalid'));
    assert.equal((await manager.add('twitch')).ok, true);
    const unsupported = await manager.add('unknown');
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.reason, 'unsupported');
    assert.equal(manager.has('unknown'), false);
});
