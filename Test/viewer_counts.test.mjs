import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerCounts } from '../ScriptLib/viewers/counts.mjs';

/** 建立可控制時間的 viewerCounts。 */
function makeCounts(overrides = {}) {
    let now = 1000;
    const counts = createViewerCounts({
        now: () => now,
        confirmMs: 60000,
        ...overrides,
    });
    return {
        counts,
        advance(ms) { now += ms; },
        at() { return now; },
    };
}

test('set：無效值直接忽略，保留上次已知人數', () => {
    const { counts } = makeCounts();
    assert.equal(counts.set('TikTok', 100), true);

    for (const invalid of [undefined, null, '', '   ', NaN, -1, Infinity, true, {}]) {
        assert.equal(counts.set('TikTok', invalid), false);
    }
    assert.equal(counts.get('TikTok'), 100);
});

test('set：數字字串會轉成數字', () => {
    const { counts } = makeCounts();
    assert.equal(counts.set('TikTok', '42'), true);
    assert.equal(counts.get('TikTok'), 42);
    assert.equal(counts.combined(), 42);
});

test('set：相同值不算改變', () => {
    const { counts } = makeCounts();
    assert.equal(counts.set('TikTok', 10), true);
    assert.equal(counts.set('TikTok', 10), false);
});

test('0 防呆：短暫 0 先保留原值，持續 confirmMs 後才歸零', () => {
    const { counts, advance } = makeCounts();
    counts.set('TikTok', 100);

    advance(30000);
    assert.equal(counts.set('TikTok', 0), false);
    assert.equal(counts.get('TikTok'), 100);

    // 距離第一次 0 只有 30 秒，仍在確認期內。
    advance(30000);
    assert.equal(counts.set('TikTok', 0), false);
    assert.equal(counts.get('TikTok'), 100);

    // 距離第一次 0 已滿 60 秒，確認歸零。
    advance(30000);
    assert.equal(counts.set('TikTok', 0), true);
    assert.equal(counts.get('TikTok'), 0);
});

test('0 防呆：確認期內回到正值會清除待確認狀態', () => {
    const { counts, advance } = makeCounts();
    counts.set('TikTok', 100);

    advance(30000);
    assert.equal(counts.set('TikTok', 0), false);
    advance(1000);
    assert.equal(counts.set('TikTok', 80), true);
    assert.equal(counts.get('TikTok'), 80);

    // 再次遇到 0 要重新起算確認期，不能沿用先前的 pending。
    advance(10000);
    assert.equal(counts.set('TikTok', 0), false);
    assert.equal(counts.get('TikTok'), 80);
});

test('reset：明確離線立即歸零', () => {
    const { counts } = makeCounts();
    counts.set('Twitch', 50);
    assert.equal(counts.reset('Twitch'), true);
    assert.equal(counts.get('Twitch'), 0);
    assert.equal(counts.reset('Twitch'), false);
});

test('combined：只加總 include 允許的平台', () => {
    const { counts } = makeCounts({ include: platform => platform !== 'Kick' });
    counts.set('TikTok', 10);
    counts.set('Twitch', 5);
    counts.set('Kick', 999);
    assert.equal(counts.combined(), 15);
    assert.equal(counts.get('Kick'), 999);
});

test('snapshot：回傳各平台目前值與更新时间', () => {
    const { counts, at } = makeCounts();
    counts.set('TikTok', 12);
    assert.deepEqual(counts.snapshot(), { TikTok: { value: 12, at: at() } });
});
