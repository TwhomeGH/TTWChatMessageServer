import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageStats, mergeStatEntries, messageTime } from '../MessageStats.mjs';
test('legacy counts survive, unknown dates remain unknown, metadata survives repeated snapshots', () => {
    const stats = new MessageStats(); stats.merge([{ message: 'hello', count: 12 }]);
    assert.equal(stats.all()[0].firstSeen, null);
    const at = Date.now() - 1000;
    stats.record('hello', { id: '1', platform: 'Twitch', receivedAt: at, userId: 'u' });
    const merged = mergeStatEntries(stats.all(), stats.all(), [{ message: 'hello', count: 10 }]);
    assert.equal(merged[0].count, 13); assert.equal(merged[0].recent.length, 1);
    assert.equal(merged[0].lastSeen, at);
});
test('ID dedup is platform-scoped; same text from separate users counts; recent rows bounded', () => {
    const stats = new MessageStats();
    for (let i = 0; i < 10; i++) stats.record('哈哈', { id: String(i), userId: String(i), platform: 'Twitch' });
    assert.equal(stats.record('哈哈', { id: '1', platform: 'Twitch' }), null);
    stats.record('哈哈', { id: '1', platform: 'TikTok' });
    assert.equal(stats.all()[0].count, 11); assert.equal(stats.all()[0].recent.length, 5);
    stats.clear(); assert.equal(stats.all().length, 0);
});
test('time source is explicit and out-of-order platform times keep correct bounds', () => {
    const stats = new MessageStats(), now = Date.now();
    stats.record('a', { sentAt: now - 1000 }); stats.record('a', { sentAt: now - 2000 });
    assert.equal(stats.all()[0].firstSeen, now - 2000);
    assert.equal(stats.all()[0].lastSeen, now - 1000);
    assert.equal(stats.record('b').timeSource, 'received');
    assert.equal(messageTime('bad'), null); assert.equal(messageTime(0), null);
});
