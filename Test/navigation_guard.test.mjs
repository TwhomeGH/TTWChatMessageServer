import test from 'node:test';
import assert from 'node:assert/strict';
import { TikTokNavigationGuard } from '../ScriptLib/tiktok/navigation-guard.mjs';

const quiet = { log() {}, warn() {} };

test('導航間隔會排隊，403 後進入冷卻', async () => {
    let now = 0;
    const sleeps = [];
    const guard = new TikTokNavigationGuard({
        minIntervalMs: 1000,
        wafCooldownMs: 60000,
        now: () => now,
        sleep: async ms => { sleeps.push(ms); now += ms; },
        logger: quiet
    });

    await guard.acquire('first');
    await guard.acquire('second');
    assert.deepEqual(sleeps, [1000]);
    assert.equal(guard.state().count, 2);

    guard.record(403, 'live');
    await assert.rejects(guard.acquire('third'), error => {
        assert.equal(error.code, 'TIKTOK_WAF_COOLDOWN');
        assert.ok(error.retryAfterMs > 0);
        return true;
    });

    now += 60000;
    await guard.acquire('after-cooldown');
    assert.equal(guard.state().count, 3);
});

test('非 WAF 狀態不啟動冷卻，冷卻不因新導航被清除', async () => {
    let now = 0;
    const guard = new TikTokNavigationGuard({
        minIntervalMs: 0,
        wafCooldownMs: 1000,
        now: () => now,
        sleep: async ms => { now += ms; },
        logger: quiet
    });
    guard.record(200, 'ok');
    assert.equal(guard.state().cooldownRemainingMs, 0);
    guard.record(429, 'rate');
    assert.ok(guard.state().cooldownRemainingMs > 0);
    guard.record(200, 'ignored-while-cooling');
    assert.ok(guard.state().cooldownRemainingMs > 0);
});
