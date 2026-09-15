import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageStats, mergeStatEntries, messageTime } from '../MessageStats.mjs';

test('舊紀錄保留計數與未知日期，重複合併快照不累加相同資料', () => {
    const stats = new MessageStats();
    stats.merge([{ message: 'hello', count: 12 }]);
    assert.equal(stats.all()[0].firstSeen, null);

    const receivedAt = Date.now() - 1000;
    stats.record('hello', {
        id: '1', platform: 'Twitch', receivedAt, userId: 'u'
    });

    // 同一快照載入兩次並混入較舊計數，總數仍應為 12 + 1。
    const merged = mergeStatEntries(
        stats.all(), stats.all(), [{ message: 'hello', count: 10 }]
    );
    assert.equal(merged[0].count, 13);
    assert.equal(merged[0].recent.length, 1);
    assert.equal(merged[0].lastSeen, receivedAt);
});

test('ID 去重以平台區隔，不同使用者同文計數且明細最多保留 5 則', () => {
    const stats = new MessageStats();
    for (let i = 0; i < 10; i++) {
        stats.record('哈哈', {
            id: String(i), userId: String(i), platform: 'Twitch'
        });
    }

    // 同平台的舊 ID 不重算；另一平台即使使用相同 ID 仍是獨立事件。
    assert.equal(stats.record('哈哈', { id: '1', platform: 'Twitch' }), null);
    stats.record('哈哈', { id: '1', platform: 'TikTok' });
    assert.equal(stats.all()[0].count, 11);
    assert.equal(stats.all()[0].recent.length, 5);

    stats.clear();
    assert.equal(stats.all().length, 0);
});

test('亂序到達仍保留正確時間邊界，缺少發送時間時標記接收時間', () => {
    const stats = new MessageStats();
    const now = Date.now();

    // 較早發送的訊息後到，firstSeen 應往前更新，lastSeen 不應倒退。
    stats.record('a', { sentAt: now - 1000 });
    stats.record('a', { sentAt: now - 2000 });
    assert.equal(stats.all()[0].firstSeen, now - 2000);
    assert.equal(stats.all()[0].lastSeen, now - 1000);
    assert.equal(stats.record('b').timeSource, 'received');

    assert.equal(messageTime('bad'), null);
    assert.equal(messageTime(0), null);
});

test('合併具等冪性：與自身或空集合併的結果不變，讓無變動時可略過寫檔', () => {
    const rows = [
        { message: 'a', count: 3, firstSeen: null, lastSeen: null, platforms: ['Twitch'], transports: ['api'],
          recent: [{ key: 'Twitch:1', receivedAt: Date.now(), message: 'a' }] },
        { message: 'b', count: 1, firstSeen: null, lastSeen: null, platforms: [], transports: [], recent: [] }
    ];
    assert.deepStrictEqual(mergeStatEntries(rows, rows), rows);
    assert.deepStrictEqual(mergeStatEntries(rows, []), rows);
    assert.notDeepStrictEqual(mergeStatEntries(rows, [...rows, { message: 'c', count: 1, firstSeen: null, lastSeen: null, platforms: [], transports: [], recent: [] }]), rows);
});
