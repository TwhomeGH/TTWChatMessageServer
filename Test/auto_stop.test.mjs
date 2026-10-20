import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoStop } from '../ScriptLib/lifecycle/autoStop.mjs';

/** 可手動觸發的計時器，避免測試真的等待。 */
function clock() {
    let next = 1;
    const timers = new Map();
    return {
        setTimeout(fn, ms) { const id = next++; timers.set(id, { fn, ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        ids() { return [...timers.keys()]; },
        run(id) { const timer = timers.get(id); timers.delete(id); timer.fn(); },
        pending() { return timers.size; }
    };
}

test('所有支援平台都結束後才排程，寬限期內恢復會取消', () => {
    const timers = clock();
    let stopped = 0;
    const logs = [];
    const auto = createAutoStop({
        enabled: true, platforms: ['TikTok', 'Twitch'], graceMs: 60000,
        onStop: () => { stopped++; }, log: message => logs.push(message),
        setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout
    });

    auto.markLive('TikTok');
    auto.markLive('Twitch');
    auto.markEnded('TikTok');
    assert.equal(timers.pending(), 0);
    auto.markEnded('Twitch');
    assert.equal(timers.pending(), 1);
    assert.equal(stopped, 0);

    auto.markLive('Twitch');
    assert.equal(timers.pending(), 0);
    assert.equal(stopped, 0);
    assert.ok(logs.some(message => message.includes('取消')));
});

test('倒數結束且平台仍全部結束才停止一次', () => {
    const timers = clock();
    let stopped = 0;
    const auto = createAutoStop({
        enabled: true, platforms: ['TikTok', 'Twitch'], graceMs: 60000,
        onStop: () => { stopped++; },
        setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout
    });
    auto.markLive('TikTok');
    auto.markLive('Twitch');
    auto.markEnded('TikTok');
    auto.markEnded('Twitch');
    const [id] = timers.ids();
    timers.run(id);
    assert.equal(stopped, 1);
    assert.equal(timers.pending(), 0);
    auto.markEnded('TikTok');
    assert.equal(timers.pending(), 0);
    assert.equal(stopped, 1);
});

test('停用、單一平台與有未知結束訊號的平台', () => {
    const disabledTimers = clock();
    const disabled = createAutoStop({
        enabled: false, platforms: ['TikTok'], onStop: () => { throw new Error('should not stop'); },
        setTimeout: disabledTimers.setTimeout, clearTimeout: disabledTimers.clearTimeout
    });
    disabled.markEnded('TikTok');
    assert.equal(disabledTimers.pending(), 0);

    const singleTimers = clock();
    let stopped = 0;
    const single = createAutoStop({
        enabled: true, platforms: ['TikTok'], graceMs: 1000,
        onStop: () => { stopped++; },
        setTimeout: singleTimers.setTimeout, clearTimeout: singleTimers.clearTimeout
    });
    single.markLive('TikTok');
    single.markEnded('TikTok');
    assert.equal(singleTimers.pending(), 1);
    singleTimers.run(singleTimers.ids()[0]);
    assert.equal(stopped, 1);

    const blockedTimers = clock();
    const logs = [];
    const blocked = createAutoStop({
        enabled: true, platforms: ['TikTok', 'Twitch'], blocked: ['Kick'],
        onStop: () => { throw new Error('should not stop'); },
        log: message => logs.push(message),
        setTimeout: blockedTimers.setTimeout, clearTimeout: blockedTimers.clearTimeout
    });
    blocked.markLive('TikTok');
    blocked.markLive('Twitch');
    blocked.markEnded('TikTok');
    blocked.markEnded('Twitch');
    assert.equal(blockedTimers.pending(), 0);
    assert.ok(logs.some(message => message.includes('Kick')));
});

test('啟動時還沒觀測到直播，不會因為離線訊號而停止', () => {
    const timers = clock();
    const auto = createAutoStop({
        enabled: true, platforms: ['TikTok', 'Twitch'],
        onStop: () => { throw new Error('should not stop'); },
        setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout
    });
    auto.markEnded('TikTok');
    auto.markEnded('Twitch');
    assert.equal(timers.pending(), 0);
});

test('dispose 會取消倒數且不再停止', () => {
    const timers = clock();
    let stopped = 0;
    const auto = createAutoStop({
        enabled: true, platforms: ['TikTok'], graceMs: 1000,
        onStop: () => { stopped++; },
        setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout
    });
    auto.markLive('TikTok');
    auto.markEnded('TikTok');
    assert.equal(timers.pending(), 1);
    auto.dispose();
    assert.equal(timers.pending(), 0);
    assert.equal(stopped, 0);
});
