import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoClipManager } from '../AutoClip.js';
function setup(options = {}) {
    let now = Date.now() - 600000, serial = 0;
    const manager = new AutoClipManager({ now: () => now, log() {}, ...options });
    const advance = ms => { now += ms; manager.updateViewers(10, now); return manager.evaluate(now); };
    const chat = (user = 'u', extra = {}) => manager.onChatMessage({ platform: 'Twitch', id: String(++serial), userId: user, receivedAt: now, ...extra }, now);
    const warm = () => { for (let i = 0; i < 40; i++) advance(5000); };
    const burst = () => { for (let i = 0; i < 6; i++) chat('user' + i); };
    return { manager, advance, chat, warm, burst, now: () => now };
}
test('warmup, shadow burst timing and cooldown without API requests', () => {
    let calls = 0; const f = setup({ onCreateClip: () => { calls++; } });
    f.burst(); assert.equal(f.advance(5000).triggered, false);
    f.warm(); f.burst(); assert.equal(f.advance(5000).triggered, false);
    f.advance(5000); const result = f.advance(10000);
    assert.equal(result.triggered, true); assert.equal(result.stats.status, 'shadow');
    assert.ok(result.stats.peakAt <= result.stats.triggeredAt);
    assert.equal(calls, 0); assert.equal(f.manager.totalClips, 0);
    assert.equal(f.advance(5000).triggered, false);
});
test('single-user spam, cross-platform, old and repeated messages do not inflate heat', () => {
    const f = setup({ solo: 'off' }); f.warm();
    for (let i = 0; i < 100; i++) f.chat('one');
    assert.equal(f.manager.getStats(f.now()).windowMsgs, 3);
    assert.equal(f.chat('two', { platform: 'TikTok' }), true);
    assert.equal(f.chat('two', { sentAt: f.now() - 60000 }), false);
    assert.equal(f.chat('two', { id: 'repeat' }), true);
    assert.equal(f.chat('two', { id: 'repeat' }), false);
    assert.equal(f.advance(5000).triggered, false);
});
test('same words from distinct users count and out-of-order timestamps are supported', () => {
    const f = setup(); f.warm();
    f.chat('a', { message: '哈哈', receivedAt: f.now() - 500 });
    f.chat('b', { message: '哈哈', receivedAt: f.now() - 1000 });
    assert.equal(f.manager.getStats(f.now()).uniqueUsers, 2);
});
test('stale viewer sample resets warmup and sustained threshold timer', () => {
    const f = setup(); f.warm(); f.burst(); f.advance(5000);
    assert.notEqual(f.manager.aboveSince, null);
    assert.match(f.manager.evaluate(f.now() + 100000).reason, /過期/);
    assert.equal(f.manager.aboveSince, null); assert.equal(f.manager.samples.length, 0);
});
test('live pending lock and success counted only after resolved result', async () => {
    let resolve; let calls = 0;
    const f = setup({ shadow: false, onCreateClip: () => { calls++; return new Promise(r => { resolve = r; }); } });
    f.warm(); f.burst(); f.advance(5000); f.advance(15000);
    await Promise.resolve();
    assert.equal(f.manager.pending, true); assert.equal(f.manager.totalClips, 0);
    f.advance(5000); assert.equal(calls, 1);
    resolve({ id: 'clip1' }); await new Promise(r => setImmediate(r));
    assert.equal(f.manager.totalClips, 1); assert.equal(f.manager.pending, false);
});
test('failed clip is separate from successes and does not retry in a loop', async () => {
    const f = setup({ shadow: false, onCreateClip: async () => { throw new Error('API error'); } });
    f.warm(); f.burst(); f.advance(5000); f.advance(15000);
    await new Promise(r => setImmediate(r));
    assert.equal(f.manager.failedClips, 1); assert.equal(f.manager.totalClips, 0);
    assert.equal(f.manager.history.find(r => r.triggered).status, 'failed');
    assert.equal(f.advance(5000).triggered, false);
});
test('trigger freezes the counted messages; later traffic cannot alter evidence', () => {
    const f = setup(); f.warm();
    for (let i = 0; i < 6; i++) f.chat('user' + i, { message: '精彩 ' + i });
    f.advance(5000); const { stats } = f.advance(15000);
    assert.equal(stats.evidence.total, 6);
    assert.equal(stats.evidence.uniqueUsers, 6);
    assert.equal(stats.evidence.messages[0].message, '精彩 0');
    assert.equal(stats.evidence.messages[0].timeSource, 'received');
    f.chat('new', { message: '後來的留言' });
    assert.equal(stats.evidence.messages.length, 6);
    assert.equal(stats.evidence.messages.some(m => m.message === '後來的留言'), false);
});
test('hung creation times out without repeated requests', async () => {
    const f = setup({ shadow: false, requestTimeoutMs: 5, onCreateClip: () => new Promise(() => {}) });
    f.warm(); f.burst(); f.advance(5000); f.advance(15000);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(f.manager.pending, false); assert.equal(f.manager.failedClips, 1);
    assert.equal(f.advance(5000).triggered, false);
});

for (const platform of ['TikTok', 'Kick', 'Odysee', 'Youtube', 'Unknown']) {
    test(`${platform} reaction can trigger a Twitch clip without Twitch chat`, () => {
        const f = setup(); f.warm();
        for (let i = 0; i < 6; i++) f.chat(String(i), { platform, message: '精彩' });
        f.advance(5000); const result = f.advance(15000);
        assert.equal(result.triggered, true);
        assert.equal(result.stats.evidence.sourcePlatform, platform);
        assert.equal(result.stats.evidence.messages[0].platform, platform);
        assert.equal(f.manager.getConfig().clipPlatform, 'Twitch');
    });
}
test('same user IDs on different platforms do not share spam limits or dedup keys', () => {
    const f = setup({ solo: 'off' }); f.warm();
    for (let i = 0; i < 3; i++) {
        assert.equal(f.chat('same', { id: 'shared' + i, platform: 'Twitch' }), true);
        assert.equal(f.chat('same', { id: 'shared' + i, platform: 'TikTok' }), true);
    }
    const stats = f.manager.getStats(f.now());
    assert.equal(stats.uniqueUsers, 2); assert.equal(stats.windowMsgs, 6);
    assert.equal(f.advance(5000).triggered, false);
});
test('large quiet platform does not dilute small-platform burst; contributions sum to final score', () => {
    const f = setup(); f.warm();
    f.manager.updatePlatformViewers('Youtube', 100000, f.now());
    for (let i = 0; i < 6; i++) f.chat(String(i), { platform: 'TikTok' });
    f.advance(5000); const r = f.advance(15000);
    assert.equal(r.triggered, true); assert.equal(r.stats.sourcePlatform, 'TikTok');
    assert.equal(r.stats.platforms.reduce((n,p) => n+p.contribution,0), r.stats.score);
    assert.equal(r.stats.platforms.find(p=>p.platform==='Youtube').contribution, 0);
});
test('configured platform delay adjusts evidence time and rejects reactions now too old', () => {
    const f = setup({ delayOffsetsMs: { TikTok: 5000, Youtube: 60000 } }); f.warm();
    assert.equal(f.chat('one', { platform: 'TikTok' }), true);
    assert.equal(f.manager.messages[0].t, f.now()-5000);
    assert.equal(f.manager.messages[0].originalTime, f.now());
    assert.equal(f.chat('one', { platform: 'Youtube' }), false);
});

// 集中度：分辨「很多人各一則」與「一個人洗頻」。
test('topUserMsgs 反映集中度（單人洗頻 vs 多人各一則）', () => {
    const f = setup({ solo: 'off' }); f.warm();
    for (let i = 0; i < 5; i++) f.chat('spammer');   // maxPerUser=3，只計 3 則
    for (const user of ['a', 'b', 'c']) f.chat(user);
    const stats = f.manager.getStats(f.now());
    assert.equal(stats.windowMsgs, 6);
    assert.equal(stats.uniqueUsers, 4);
    assert.equal(stats.topUserMsgs, 3);
    assert.equal(stats.platforms[0].topUserMsgs, 3);
    assert.equal(stats.platforms[0].uniqueUsers, 4);
});

test('自適應門檻：小台 2 人／4 則可觸發，固定 6／3 不會', () => {
    const small = () => {
        const f = setup({ adaptiveThresholds: true, minMessages: 6, minUsers: 3 }); f.warm();
        for (let i = 0; i < 2; i++) { f.chat('a'); f.chat('b'); }
        return f;
    };
    const adaptive = small();
    const stats = adaptive.manager.getStats(adaptive.now());
    const twitch = stats.platforms.find(p => p.platform === 'Twitch');
    assert.equal(twitch.recentMaxUsers, 0);
    assert.equal(twitch.minMessages, 4);
    assert.equal(twitch.minUsers, 2);
    adaptive.advance(5000);
    assert.equal(adaptive.advance(15000).triggered, true);

    const fixed = setup({ adaptiveThresholds: false, minMessages: 6, minUsers: 3 }); fixed.warm();
    for (let i = 0; i < 2; i++) { fixed.chat('a'); fixed.chat('b'); }
    fixed.advance(5000);
    assert.equal(fixed.advance(15000).triggered, false);
});

test('單人模式：3 則不足，5 則不同訊息可觸發', () => {
    const f = setup({ adaptiveThresholds: true }); f.warm();
    for (let i = 0; i < 3; i++) f.chat('solo', { message: 'm' + i });
    const twitch = f.manager.getStats(f.now()).platforms.find(p => p.platform === 'Twitch');
    assert.equal(twitch.solo, true);
    assert.equal(twitch.minUsers, 1);
    assert.equal(twitch.minMessages, 5);
    f.advance(5000);
    assert.equal(f.advance(5000).triggered, false);

    f.chat('solo', { message: 'm3' });
    f.chat('solo', { message: 'm4' });
    f.advance(5000);
    const result = f.advance(15000);
    assert.equal(result.triggered, true);
    assert.equal(result.stats.evidence.solo, true);
    assert.equal(result.stats.evidence.maxPerUser, 5);
});

test('單人模式：重複相同文字不算不同訊息', () => {
    const f = setup({ adaptiveThresholds: true }); f.warm();
    for (let i = 0; i < 5; i++) f.chat('solo', { message: '一樣' });
    const twitch = f.manager.getStats(f.now()).platforms.find(p => p.platform === 'Twitch');
    assert.equal(twitch.solo, true);
    assert.equal(twitch.windowMsgs, 1);
    f.advance(5000);
    assert.equal(f.advance(15000).triggered, false);
});

test('單人模式 auto 受觀眾上限保護，on 可忽略上限', () => {
    const auto = setup({ solo: 'auto', soloMaxViewers: 5 }); auto.warm();
    for (let i = 0; i < 5; i++) auto.chat('solo', { message: 'a' + i });
    const autoTwitch = auto.manager.getStats(auto.now()).platforms.find(p => p.platform === 'Twitch');
    assert.equal(autoTwitch.solo, false);
    auto.advance(5000);
    assert.equal(auto.advance(15000).triggered, false);

    const forced = setup({ solo: 'on', soloMaxViewers: 5 }); forced.warm();
    for (let i = 0; i < 5; i++) forced.chat('solo', { message: 'b' + i });
    const forcedTwitch = forced.manager.getStats(forced.now()).platforms.find(p => p.platform === 'Twitch');
    assert.equal(forcedTwitch.solo, true);
    forced.advance(5000);
    assert.equal(forced.advance(15000).triggered, true);
});

test('自適應門檻：活躍聊天會把門檻維持在設定的 6／3', () => {
    const f = setup({ adaptiveThresholds: true, minMessages: 6, minUsers: 3 });
    for (let i = 0; i < 40; i++) {
        for (const user of ['a', 'b', 'c']) f.chat(user);
        f.advance(5000);
    }
    const twitch = f.manager.getStats(f.now()).platforms.find(p => p.platform === 'Twitch');
    assert.equal(twitch.minUsers, 3);
    assert.equal(twitch.minMessages, 6);
});
