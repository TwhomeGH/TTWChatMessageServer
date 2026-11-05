const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../ScriptLib/restream/metrics.cjs');

const payload = (extra = {}) => ({
    type: 'restream-health',
    showId: 'show-123',
    capturedAt: Date.parse('2026-11-06T00:00:00Z'),
    sourceUrl: 'https://app.restream.io/shows/show-123?tab=preview',
    values: {
        health: ' Excellent ', resolution: '1920X1080', bitrateKbps: '5744',
        fps: 60, keyframeSec: 1.01
    },
    ...extra
});

test('Restream 指標會正規化並保存最新值', () => {
    store.clear();
    const result = store.record(payload(), 1000);
    assert.equal(result.ok, true);
    assert.equal(result.entry.showId, 'show-123');
    assert.deepEqual(result.entry.values, {
        health: 'Excellent', resolution: '1920x1080', bitrateKbps: 5744, fps: 60, keyframeSec: 1.01
    });
    assert.equal(result.entry.sourceUrl, 'https://app.restream.io/shows/show-123');
    const snapshot = store.snapshot('show-123', 1000);
    assert.equal(snapshot.latest.receivedAt, 1000);
    assert.equal(snapshot.sampleCount, 1);
});

test('缺值與無效值保留 null，不會變成 0', () => {
    store.clear();
    const result = store.record(payload({
        values: { health: '', resolution: '1080p', bitrateKbps: null, fps: '', keyframeSec: 'bad' }
    }), 1000);
    assert.equal(result.ok, true);
    assert.deepEqual(result.entry.values, {
        health: null, resolution: null, bitrateKbps: null, fps: null, keyframeSec: null
    });
});

test('拒絕無效 showId 與非 app.restream.io 來源', () => {
    store.clear();
    assert.equal(store.record(payload({ showId: '' })).error, 'INVALID_SHOW_ID');
    assert.equal(store.record(payload({ showId: 'x'.repeat(65) })).error, 'INVALID_SHOW_ID');
    const result = store.record(payload({ sourceUrl: 'https://evil.example/shows/show-123' }), 1000);
    assert.equal(result.ok, true);
    assert.equal(result.entry.sourceUrl, null);
});

test('每場保留最新 120 筆，列表依收到時間排序', () => {
    store.clear();
    for (let index = 0; index < 130; index += 1) store.record(payload(), 1000 + index);
    const snapshot = store.snapshot('show-123', 2000);
    assert.equal(snapshot.sampleCount, store.MAX_SAMPLES);
    assert.equal(snapshot.latest.receivedAt, 1129);
    store.record(payload({ showId: 'show-456' }), 2000);
    assert.deepEqual(store.list(2000).map(item => item.showId), ['show-456', 'show-123']);
});
