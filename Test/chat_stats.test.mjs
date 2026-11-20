import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatStats } from '../ScriptLib/runtime/chat-stats.mjs';

test('聊天收發計數分開 received／sent／dropped，並保留最後時間', () => {
    let now = 1000;
    const stats = createChatStats({ platforms: ['tiktok', 'twitch'], recentLimit: 3, now: () => now });
    stats.received('tiktok', { id: 'm1', user: 'Alice', at: 900 });
    now = 1100;
    stats.dropped('tiktok', 'filtered', { id: 'm1', user: 'Alice' });
    now = 1200;
    stats.sent('tiktok', { id: 'm2', user: 'Bob' });

    const snapshot = stats.snapshot();
    const tiktok = snapshot.platforms.tiktok;
    assert.equal(tiktok.received, 1);
    assert.equal(tiktok.sent, 1);
    assert.equal(tiktok.dropped, 1);
    assert.equal(tiktok.dropReasons.filtered, 1);
    assert.equal(tiktok.lastReceivedAt, 900);
    assert.equal(tiktok.lastSentAt, 1200);
    assert.equal(tiktok.lastReceivedAgeMs, 300);
    assert.deepEqual(tiktok.recent.map(row => row.stage), ['received', 'dropped', 'sent']);
    assert.equal(snapshot.platforms.twitch.received, 0);
});

test('最近事件有上限，failed 與 dropped 分開計數', () => {
    let now = 1;
    const stats = createChatStats({ platforms: ['twitch'], recentLimit: 2, now: () => now++ });
    stats.received('twitch', { id: '1', user: 'A' });
    stats.received('twitch', { id: '2', user: 'B' });
    stats.failed('twitch', 'handler', { id: '2', user: 'B' });
    const twitch = stats.snapshot().platforms.twitch;
    assert.equal(twitch.received, 2);
    assert.equal(twitch.failed, 1);
    assert.equal(twitch.dropped, 0);
    assert.equal(twitch.recent.length, 2);
    assert.equal(twitch.recent.at(-1).stage, 'failed');
});
