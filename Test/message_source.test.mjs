import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSource, normalizePlatform } from '../MessageSource.mjs';
import { MessageStats, mergeStatEntries } from '../MessageStats.mjs';
import { AutoClipManager } from '../AutoClipV2.mjs';
test('platform whitelist is separate from transport; unknown remains eligible', () => {
    assert.equal(normalizePlatform(' youtube '), 'Youtube');
    assert.equal(normalizePlatform('Userscript'), 'Unknown');
    assert.equal(normalizePlatform('arbitrary-platform'), 'Unknown');
    assert.deepEqual(normalizeSource({ platform: 'TikTok', transport: 'api' }, 'userscript'),
        { platform: 'TikTok', transport: 'userscript', isTest: false, heatEligible: true });
    assert.equal(normalizeSource({}).heatEligible, true);
    assert.equal(normalizeSource({ platform: 'TikTok', isTest: true }).heatEligible, false);
});
test('same platform event is counted once across transports in either order', () => {
    for (const order of [['api', 'userscript'], ['userscript', 'api']]) {
        const stats = new MessageStats();
        for (const transport of order) stats.record('same', { platform: 'youtube', id: 'msg1', user: 'user', transport });
        const row = mergeStatEntries(stats.all())[0];
        assert.equal(row.count, 1);
        assert.deepEqual(row.transports.sort(), ['api', 'userscript']);
    }
});
test('ID-less cross-transport fallback is scoped to platform, user and content', () => {
    const stats = new MessageStats();
    stats.record('same', { platform: 'TikTok', user: 'one', transport: 'userscript' });
    assert.equal(stats.record('same', { platform: 'TikTok', user: 'one', id: 'id', transport: 'api' }), null);
    assert.ok(stats.record('same', { platform: 'Twitch', user: 'one', transport: 'api' }));
    assert.ok(stats.record('same', { platform: 'TikTok', user: 'two', transport: 'api' }));
    assert.ok(stats.record('same', { platform: 'TikTok', user: 'one', transport: 'userscript' }));
});
test('different real IDs do not collapse; test IDs cannot consume real-message IDs', () => {
    const stats = new MessageStats();
    stats.record('same', { platform: 'Twitch', id: '1', user: 'one', transport: 'api' });
    assert.ok(stats.record('same', { platform: 'Twitch', id: '2', user: 'one', transport: 'userscript' }));
    stats.record('test', { platform: 'Twitch', id: '3', isTest: true });
    assert.ok(stats.record('real', { platform: 'Twitch', id: '3' }));
});
test('unknown userscript heat triggers while test messages cannot affect heat or users', () => {
    let now = Date.now() - 600000;
    const m = new AutoClipManager({ now: () => now, log() {} });
    for (let i = 0; i < 40; i++) { now += 5000; m.updateViewers(10, now); m.evaluate(now); }
    for (let i = 0; i < 6; i++) {
        assert.equal(m.onChatMessage({ platform: 'TikTok', userId: String(i), id: 'test'+i, isTest: true, receivedAt: now }), false);
        assert.equal(m.onChatMessage({ transport: 'userscript', userId: String(i), id: String(i), receivedAt: now, message: '熱點' }), true);
    }
    m.evaluate(now); now += 15000; m.updateViewers(10, now);
    const r = m.evaluate(now);
    assert.equal(r.triggered, true);
    assert.equal(r.stats.sourcePlatform, 'Unknown');
    assert.deepEqual(r.stats.platforms.find(p => p.platform === 'Unknown').transports, ['userscript']);
});
