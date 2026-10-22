const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AutoClipHistory } = require('../ScriptLib/autoclip/history.cjs');

const row = (minute, score, triggered = false) => ({
    t: new Date(Date.UTC(2026, 9, 22, 12, minute)).toISOString(),
    viewers: 2,
    score,
    triggered,
    reason: triggered ? '觸發' : '觀察',
    platforms: [{ platform: 'Twitch', score }]
});

test('AutoClip 歷史以 session/t 去重並保留觸發更新', () => {
    const history = new AutoClipHistory(':memory:');
    const config = { mode: 'shadow', platform: 'all', clipPlatform: 'Twitch' };
    const first = [row(0, 0.2), row(1, 1.9, true), row(2, 0.3)];
    assert.deepEqual(history.append('s1', config, first), { inserted: 3, updated: 0, samples: 3 });
    assert.deepEqual(history.append('s1', config, [
        { ...row(1, 1.9, true), reason: '影子觸發已記錄' },
        row(3, 2.2, true)
    ]), { inserted: 1, updated: 1, samples: 4 });
    history.finish('s1');

    const sessions = history.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 's1');
    assert.equal(sessions[0].sampleCount, 4);
    assert.equal(sessions[0].triggerCount, 2);
    assert.equal(sessions[0].mode, 'shadow');

    const result = history.query({ session: 's1' });
    assert.equal(result.rows.length, 4);
    assert.equal(result.rows.find(item => item.t === first[1].t).reason, '影子觸發已記錄');
    assert.equal(result.config.clipPlatform, 'Twitch');
    const subset = history.query({
        session: 's1',
        from: Date.parse(first[1].t),
        to: Date.parse(first[2].t)
    });
    assert.deepEqual(subset.rows.map(item => item.t), [first[1].t, first[2].t]);
    history.close();
});

test('AutoClip 歷史查詢會降採樣但保留觸發列與端點', () => {
    const history = new AutoClipHistory(':memory:');
    const rows = Array.from({ length: 200 }, (_, index) => row(index, index / 10, index === 99));
    history.append('s2', {}, rows);
    const result = history.query({ session: 's2', maxPoints: 100 });
    assert.equal(result.truncated, true);
    assert.ok(result.rows.length <= 102);
    assert.ok(result.rows.some(item => item.triggered));
    assert.equal(result.rows[0].t, rows[0].t);
    assert.equal(result.rows.at(-1).t, rows.at(-1).t);
    history.close();
});

test('AutoClip 歷史可匯入舊 stats 並清理過期場次', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclip-history-'));
    const file = path.join(dir, 'autoclip_stats.json');
    fs.writeFileSync(file, JSON.stringify({ config: { mode: 'shadow' }, stats: [row(0, 0.1), row(1, 1.2, true)] }));
    const history = new AutoClipHistory(':memory:');
    assert.equal(history.importLegacy(file), 2);
    assert.equal(history.listSessions().length, 1);
    assert.equal(history.listSessions()[0].triggerCount, 1);
    history.prune(1, Date.UTC(2026, 9, 25, 12, 0));
    assert.equal(history.listSessions().length, 0);
    history.close();
    fs.rmSync(dir, { recursive: true, force: true });
});
