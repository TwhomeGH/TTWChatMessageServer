import test from 'node:test';
import assert from 'node:assert/strict';
import { TikTokChatGuard, chatMetadata } from '../TikTokChatGuard.mjs';

const epoch = 1800000000000;
test('original metadata accepts seconds/milliseconds and preserves large IDs', () => {
    assert.deepEqual(chatMetadata({ common: { msgId: '9876543210987654321', createTime: '1800000000' } }),
        { id: '9876543210987654321', time: epoch });
    assert.equal(chatMetadata({ createTime: epoch }).time, epoch);
    assert.equal(chatMetadata({ user: { createTime: epoch } }).time, null);
    for (const createTime of [undefined, '', 0, 'bad', -1, true, '1800000000000000']) {
        assert.equal(chatMetadata({ createTime }).time, null);
    }
});
test('first connection allows history, reconnect discards old chat including unseen IDs', () => {
    const guard = new TikTokChatGuard({ now: () => epoch });
    assert.equal(guard.check({ msgId: '1', createTime: epoch - 60000 }).accepted, true);
    guard.beginReconnect();
    assert.equal(guard.check({ msgId: '1' }).reason, 'duplicate-id');
    assert.equal(guard.check({ msgId: '2', createTime: epoch - 60000 }).reason, 'before-reconnect');
    assert.equal(guard.check({ msgId: '3', createTime: epoch - 3000 }).accepted, true);
    assert.equal(guard.check({ msgId: '4', createTime: epoch }).accepted, true);
});
test('same timestamp distinct IDs pass; duplicate is reserved before async work', () => {
    const guard = new TikTokChatGuard({ now: () => epoch });
    guard.beginReconnect();
    const first = { common: { msgId: '123', createTime: epoch } };
    assert.equal(guard.check(first).accepted, true);
    assert.equal(guard.check({ common: { msgId: '124', createTime: epoch } }).accepted, true);
    assert.equal(guard.check(first).reason, 'duplicate-id');
});
test('missing or invalid time uses ID only; missing all metadata passes', () => {
    const guard = new TikTokChatGuard({ now: () => epoch });
    guard.beginReconnect();
    assert.equal(guard.check({ msgId: '123', createTime: 'invalid' }).accepted, true);
    assert.equal(guard.check({ msgId: '123' }).accepted, false);
    assert.equal(guard.check({}).accepted, true);
    assert.equal(guard.check({ msgId: '0' }).accepted, true);
    assert.equal(guard.check({ msgId: '0' }).accepted, true);
});
test('each retry advances cutoff while retaining previous message IDs', () => {
    let now = epoch;
    const guard = new TikTokChatGuard({ now: () => now });
    guard.beginReconnect();
    guard.check({ msgId: '1', createTime: now });
    now += 30000;
    guard.beginReconnect();
    assert.equal(guard.check({ msgId: '1' }).reason, 'duplicate-id');
    assert.equal(guard.check({ msgId: '2', createTime: epoch + 10000 }).reason, 'before-reconnect');
    assert.equal(guard.check({ msgId: '3', createTime: now }).accepted, true);
});
test('ID cache has bounded size and TTL', () => {
    let now = epoch;
    const guard = new TikTokChatGuard({ now: () => now, maxIds: 2, ttlMs: 100 });
    for (const msgId of ['1', '2', '3']) guard.check({ msgId });
    assert.equal(guard.seen.size, 2);
    assert.equal(guard.seen.has('1'), false);
    now += 100;
    assert.equal(guard.check({ msgId: '3' }).accepted, true);
    assert.equal(guard.seen.size, 1);
});
