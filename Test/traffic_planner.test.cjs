const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TrafficDatabase } = require('../ScriptLib/traffic/database.cjs');
const { TrafficStore } = require('../ScriptLib/traffic/store.cjs');
const { TrafficPlanner, calendar, validateSettings } = require('../ScriptLib/traffic/planner.cjs');
const { createPlannerRoutes } = require('../ScriptLib/traffic/plannerRoutes.cjs');

const DAY = 86400000;
const MONDAY = Date.parse('2026-09-07T10:00:00Z');

function fixture(t) {
    const database = new TrafficDatabase(':memory:');
    t.after(() => database.close());
    let now = MONDAY;
    const sent = [];
    const options = {
        now: () => now, available: () => ({ ntfy: true, bark: true }),
        send: async (...args) => { sent.push(args); return true; }
    };
    const planner = new TrafficPlanner(database, options);
    const store = new TrafficStore(() => now, database);
    const seed = (broadcaster, platform = 'TikTok', value = 20) => {
        for (let week = 0; week < 3; week++) for (let day = 0; day < 2; day++) {
            const start = MONDAY + (week * 7 + day) * DAY;
            for (let minute = 0; minute <= 20; minute++) {
                now = start + minute * 60000;
                store.record({ type: 'audience', platform, broadcasterId: broadcaster,
                    streamId: `${broadcaster}-${start}`, startedAt: new Date(start).toISOString(), userNum: value * (day ? 1 : 2) });
            }
        }
    };
    const seedPartial = (broadcaster, start, platform = 'TikTok', value = 20) => {
        for (let minute = 0; minute <= 20; minute++) {
            now = start + minute * 60000;
            store.record({ type: 'audience', platform, broadcasterId: broadcaster,
                streamId: `partial-${broadcaster}-${start}`, startedAt: new Date(start).toISOString(), userNum: value });
        }
    };
    const enable = extra => planner.saveSettings({
        ...planner.settings(), enabled: true, channels: ['ntfy', 'bark'], timezone: 'UTC',
        hours: [10], ...extra
    });
    return { database, planner, store, sent, options, seed, seedPartial, enable, setNow: value => { now = value; } };
}

test('同平台不同主播的場次及原生優先權隔離，未知來源不接到已知主播', t => {
    const f = fixture(t);
    f.store.record({ type: 'audience', platform: 'TikTok', broadcasterId: 'self', userNum: 20, transport: 'native' });
    assert.equal(f.store.record({ type: 'audience', platform: 'TikTok', broadcasterId: 'guest', userNum: 50, transport: 'userscript' }), true);
    assert.equal(f.store.record({ type: 'audience', platform: 'TikTok', broadcasterId: 'self', userNum: 999, transport: 'userscript' }), false);
    f.store.record({ type: 'audience', platform: 'TikTok', userNum: 5 });
    const rows = f.database.db.prepare('SELECT * FROM sessions ORDER BY id').all();
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => row.broadcaster), ['self', 'guest', null]);
    assert.deepEqual(rows.map(row => row.lastViewers), [20, 50, 5]);
});

test('分類可還原且排除測試場，參考主播不影響自己的平均與建議', t => {
    const f = fixture(t);
    f.seed('self');
    f.seed('other', 'TikTok', 10000);
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'other', purpose: 'reference' });
    f.setNow(MONDAY + 21 * DAY - 3600000);
    const analysis = f.planner.analyses().find(row => row.purpose === 'own');
    assert.equal(analysis.rankings.sessionCount, 6);
    assert.equal(analysis.rankings.globalMean, 30);
    const id = f.database.db.prepare("SELECT id FROM sessions WHERE broadcaster='self' ORDER BY id LIMIT 1").get().id;
    f.planner.classifySession({ id, broadcaster: 'self', purpose: 'test' });
    assert.equal(f.planner.analyses().find(row => row.purpose === 'own').rankings.sessionCount, 5);
    assert.equal(f.database.rankings('TikTok', 90, f.options.now(), 'UTC').sessionCount, 11);
    f.planner.classifySession({ id, broadcaster: 'self', purpose: null });
    assert.equal(f.planner.analyses().find(row => row.purpose === 'own').rankings.sessionCount, 6);
    f.enable();
    const jobs = f.planner.snapshot().jobs;
    assert.ok(jobs.length > 0);
    assert.ok(jobs.every(job => job.broadcaster === 'self'));
    assert.equal(f.database.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 12);
});

test('資料不足時提供可開播時段的累積建議，依缺口與最近開播放序', t => {
    const f = fixture(t);
    f.setNow(MONDAY);
    f.seedPartial('self', MONDAY);
    f.seedPartial('self', MONDAY + DAY);
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    f.setNow(MONDAY + 3 * DAY);
    f.enable();
    const snapshot = f.planner.snapshot();
    assert.deepEqual(snapshot.collecting.map(row => row.slot), ['Tue 10', 'Mon 10']);
    assert.ok(snapshot.collecting.every(row => row.need === 2 && row.minimum === 3));
    assert.equal(snapshot.jobs.length, 0);
    assert.throws(() => f.planner.addCollecting({ platform: 'TikTok', broadcaster: 'self', slot: 'Wed 10' }),
        { message: 'collecting' });
    f.enable({ hours: [18] });
    assert.equal(f.planner.snapshot().collecting.length, 0);
});

test('累積目標建立每週提醒，移除後取消', t => {
    const f = fixture(t);
    f.setNow(MONDAY);
    f.seedPartial('self', MONDAY);
    f.seedPartial('self', MONDAY + DAY);
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    f.setNow(MONDAY + 3 * DAY);
    f.enable();
    const target = f.planner.addCollecting({ platform: 'TikTok', broadcaster: 'self', slot: 'Mon 10' });
    assert.equal(target.active, 1);
    const snapshot = f.planner.snapshot();
    assert.equal(snapshot.collectingTargets.length, 1);
    assert.ok(snapshot.collectingTargets[0].nextAt > f.options.now());
    const jobs = snapshot.jobs.filter(job => job.kind === 'collecting');
    assert.ok(jobs.length >= 2);
    assert.ok(jobs.every(job => job.slot === 'Mon 10'));
    f.planner.removeCollecting({ id: target.id });
    const after = f.planner.snapshot();
    assert.equal(after.collectingTargets.length, 0);
    assert.equal(after.jobs.filter(job => job.kind === 'collecting').length, 0);
});

test('累積時段達標後自動停用目標並取消提醒', t => {
    const f = fixture(t);
    f.setNow(MONDAY);
    f.seedPartial('self', MONDAY);
    f.seedPartial('self', MONDAY + DAY);
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    f.setNow(MONDAY + 3 * DAY);
    f.enable();
    const target = f.planner.addCollecting({ platform: 'TikTok', broadcaster: 'self', slot: 'Mon 10' });
    f.seedPartial('self', MONDAY + 7 * DAY);
    f.seedPartial('self', MONDAY + 14 * DAY);
    f.setNow(MONDAY + 16 * DAY);
    const snapshot = f.planner.snapshot();
    assert.equal(snapshot.collectingTargets.length, 0);
    assert.equal(snapshot.jobs.filter(job => job.kind === 'collecting').length, 0);
    assert.equal(f.database.db.prepare('SELECT active FROM traffic_collecting_targets WHERE id=?').get(target.id).active, 0);
});

test('累積提醒送出時使用獨立標題與進度內容', async t => {
    const f = fixture(t);
    f.setNow(MONDAY);
    f.seedPartial('self', MONDAY);
    f.seedPartial('self', MONDAY + DAY);
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    f.setNow(MONDAY + 3 * DAY);
    f.enable();
    f.planner.addCollecting({ platform: 'TikTok', broadcaster: 'self', slot: 'Mon 10' });
    const nextAt = f.planner.snapshot().collectingTargets[0].nextAt;
    f.setNow(nextAt - 30 * 60000);
    await f.planner.tick();
    assert.ok(f.sent.length > 0);
    assert.match(f.sent[0][1], /資料累積提醒/);
    assert.match(f.sent[0][2], /Mon 10|週一/);
    assert.match(f.sent[0][2], /1\/3/);
});

test('待分類是狀態而非可寫入用途，批次指定可清除', t => {
    const f = fixture(t);
    f.seed('self');
    const id = f.database.db.prepare("SELECT id FROM sessions WHERE broadcaster='self' ORDER BY id LIMIT 1").get().id;
    assert.throws(() => f.planner.classifySession({ id, broadcaster: 'self', purpose: 'unknown' }), { message: 'session' });
    assert.throws(() => f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'unknown' }), { message: 'profile' });
    assert.throws(() => f.planner.assign([id], 'unknown'), { message: 'purpose' });

    // 初始 6 場待分類；帳號預設不是另一種「未分類」儲存方式。
    assert.equal(f.planner.sessions('TikTok').total, 6);
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    assert.equal(f.planner.sessions('TikTok').total, 0);
    assert.deepEqual(f.planner.sessions('TikTok', 1, 'all').counts,
        { all: 6, unclassified: 0, own: 6, reference: 0, test: 0 });

    f.planner.classifySession({ id, broadcaster: 'self', purpose: 'reference' });
    assert.deepEqual(f.planner.sessions('TikTok', 1, 'all').counts,
        { all: 6, unclassified: 0, own: 5, reference: 1, test: 0 });

    // 清除帳號預設後，沒有單場設定的 5 場回到待分類。
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: null });
    assert.deepEqual(f.planner.sessions('TikTok', 1, 'all').counts,
        { all: 6, unclassified: 5, own: 0, reference: 1, test: 0 });
    assert.equal(f.planner.assign([id], null), 1);
    assert.equal(f.planner.sessions('TikTok').total, 6);
});

test('舊版字面 unknown 會轉成 NULL，不留下第二種待分類表示', t => {
    const f = fixture(t);
    f.store.record({ type: 'audience', platform: 'TikTok', broadcasterId: 'self', userNum: 1 });
    f.database.db.prepare("UPDATE sessions SET purpose='unknown'").run();
    f.database.db.prepare("INSERT OR REPLACE INTO traffic_profiles VALUES('TikTok','self','unknown')").run();
    const planner = new TrafficPlanner(f.database, f.options);
    assert.equal(f.database.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE purpose IS NOT NULL').get().n, 0);
    assert.equal(f.database.db.prepare('SELECT COUNT(*) AS n FROM traffic_profiles').get().n, 0);
    assert.equal(planner.sessions('TikTok').total, 1);
});

test('批次補分類可補回缺少主播的完整場次，且不動觀測數據', t => {
    const f = fixture(t);
    f.seed(null);
    // 多一筆只有一個取樣的場次，用來驗證「只含完整場次」的排除數。
    // 時間往後跳，避免被併進上一場。
    f.setNow(MONDAY + 30 * DAY);
    f.store.record({ type: 'audience', platform: 'TikTok', userNum: 5 });
    const snapshot = () => f.database.db.prepare(
        'SELECT id,area,earlyArea,joins,chats,sampleCount FROM sessions ORDER BY id').all().map(row => ({ ...row }));

    const before = snapshot();
    const preview = f.planner.previewBackfill({ platform: 'TikTok', status: 'unclassified', days: null, completeOnly: true });
    assert.equal(preview.matched, 6);
    assert.equal(preview.excludedIncomplete, 1);
    assert.equal(preview.byPlatform.length, 1);
    assert.equal(preview.byPlatform[0].platform, 'TikTok');
    assert.equal(preview.byPlatform[0].n, 6);

    const applied = f.planner.applyBackfill({
        platform: 'TikTok', status: 'unclassified', days: null, completeOnly: true,
        from: preview.from, broadcaster: 'Self', purpose: 'own', expected: preview.matched
    });
    assert.equal(applied.changed, 6);
    assert.deepEqual(snapshot(), before);
    assert.equal(f.planner.sessions('TikTok', 1, 'own').total, 6);
    assert.equal(f.planner.sessions('TikTok').total, 1); // 只有 1 樣本那筆仍是待分類

    const undone = f.planner.undoBackfill(applied.batch);
    assert.equal(undone.restored, 6);
    assert.equal(f.planner.sessions('TikTok').total, 7);
    assert.ok(f.database.db.prepare('SELECT broadcaster FROM sessions').all().every(row => row.broadcaster === null));
});

test('批次只補主播時保留既有用途，只補用途時保留主播', t => {
    const f = fixture(t);
    f.seed(null);
    const ids = f.database.db.prepare('SELECT id FROM sessions ORDER BY id').all().map(row => row.id);
    f.planner.classifySession({ id: ids[0], broadcaster: '', purpose: 'reference' });
    f.planner.classifySession({ id: ids[1], broadcaster: '', purpose: 'test' });
    const all = { platform: 'TikTok', status: 'all', days: null, completeOnly: true, from: null };
    const preview = f.planner.previewBackfill(all);
    assert.equal(preview.matched, 6);
    const applied = f.planner.applyBackfill({ ...all, broadcaster: 'self', expected: preview.matched });
    assert.equal(applied.changed, 6);
    const rows = f.database.db.prepare('SELECT broadcaster,purpose FROM sessions ORDER BY id').all();
    assert.equal(rows[0].broadcaster, 'self'); assert.equal(rows[0].purpose, 'reference');
    assert.equal(rows[1].broadcaster, 'self'); assert.equal(rows[1].purpose, 'test');
    assert.equal(rows[2].broadcaster, 'self'); assert.equal(rows[2].purpose, null);

    f.planner.undoBackfill(applied.batch);
    const restored = f.database.db.prepare('SELECT broadcaster,purpose FROM sessions ORDER BY id').all();
    assert.equal(restored[0].broadcaster, null); assert.equal(restored[0].purpose, 'reference');
    assert.equal(restored[1].broadcaster, null); assert.equal(restored[1].purpose, 'test');

    // 只補用途：主播保持原值。
    f.setNow(MONDAY);
    f.store.record({ type: 'audience', platform: 'Twitch', broadcasterId: 'anchor', userNum: 10 });
    f.setNow(MONDAY + 60000);
    f.store.record({ type: 'audience', platform: 'Twitch', broadcasterId: 'anchor', userNum: 11 });
    const purposeOnly = f.planner.previewBackfill({ platform: 'Twitch', status: 'unclassified', days: null, completeOnly: true });
    assert.equal(purposeOnly.matched, 1);
    const appliedPurpose = f.planner.applyBackfill({
        platform: 'Twitch', status: 'unclassified', days: null, completeOnly: true,
        from: purposeOnly.from, purpose: 'own', expected: purposeOnly.matched
    });
    const twitch = f.database.db.prepare("SELECT broadcaster,purpose FROM sessions WHERE platform='Twitch'").get();
    assert.equal(twitch.broadcaster, 'anchor');
    assert.equal(twitch.purpose, 'own');
    f.planner.undoBackfill(appliedPurpose.batch);
    const twitchRestored = f.database.db.prepare("SELECT broadcaster,purpose FROM sessions WHERE platform='Twitch'").get();
    assert.equal(twitchRestored.broadcaster, 'anchor');
    assert.equal(twitchRestored.purpose, null);
});

test('主播識別會去掉開頭 @ 並統一大小寫', t => {
    const f = fixture(t);
    f.seed(null);
    const id = f.database.db.prepare('SELECT id FROM sessions ORDER BY id LIMIT 1').get().id;
    f.planner.classifySession({ id, broadcaster: '@Self', purpose: 'own' });
    assert.equal(f.database.db.prepare('SELECT broadcaster FROM sessions WHERE id=?').get(id).broadcaster, 'self');
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: '@Self', purpose: 'own' });
    assert.equal(f.planner.profiles().find(profile => profile.broadcaster === 'self').purpose, 'own');
    assert.equal(f.planner.profiles().filter(profile => profile.broadcaster === '@self').length, 0);
});

test('管理快照優先使用原生偵測值，其次 .env 並正規化', t => {
    const f = fixture(t);
    const keys = ['TIKTOK_NAME', 'TWITCH_USER_NAME', 'TWITCH_USER_ID', 'KICK_USER_NAME', 'ODYSEE_CHANNEL_NAME', 'YOUTUBE_CHANNEL_ID'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
        process.env.TIKTOK_NAME = '@Self';
        process.env.TWITCH_USER_NAME = 'TwitchName';
        delete process.env.TWITCH_USER_ID;
        delete process.env.KICK_USER_NAME;
        let snapshot = f.planner.snapshot();
        assert.equal(snapshot.identities.TikTok, 'self');
        assert.equal(snapshot.identities.Twitch, 'twitchname');
        assert.equal(snapshot.identities.Kick, '');

        // 原生事件偵測到的數字 UserID 優先於 .env 的頻道名稱。
        f.database.db.prepare("INSERT OR REPLACE INTO traffic_identities VALUES('Twitch','12345','native',?)")
            .run(f.options.now());
        process.env.TWITCH_USER_ID = '99999';
        snapshot = f.planner.snapshot();
        assert.equal(snapshot.identities.Twitch, '12345');

        // 沒有偵測值時，TWITCH_USER_ID 優先於 TWITCH_USER_NAME。
        f.database.db.prepare("DELETE FROM traffic_identities WHERE platform='Twitch'").run();
        assert.equal(f.planner.snapshot().identities.Twitch, '99999');
        delete process.env.TWITCH_USER_ID;
        assert.equal(f.planner.snapshot().identities.Twitch, 'twitchname');
    } finally {
        for (const key of keys) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    }
});

test('快照提供完整分類計數', t => {
    const f = fixture(t);
    f.seed('self');
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    f.database.db.prepare("UPDATE sessions SET purpose='test' WHERE id%2=0").run();
    assert.deepEqual(f.planner.snapshot().statusCounts,
        { all: 6, own: 3, reference: 0, test: 3, unclassified: 0 });
});

test('補分類可只套用勾選的場次，並保留其他場次', t => {
    const f = fixture(t);
    f.seed(null);
    const filter = { platform: 'TikTok', status: 'unclassified', days: null, completeOnly: true };
    const preview = f.planner.previewBackfill(filter);
    assert.equal(preview.rows.length, 6);
    assert.equal(preview.truncated, false);
    assert.ok(preview.rows[0].spanMs > 0);
    assert.ok(preview.rows[0].averageViewers > 0);
    const ids = preview.rows.slice(0, 3).map(row => row.id);
    const applied = f.planner.applyBackfill({
        ...filter, from: preview.from, broadcaster: 'self', purpose: 'own',
        ids, expected: ids.length
    });
    assert.equal(applied.changed, 3);
    const changed = f.database.db.prepare('SELECT id,broadcaster,purpose FROM sessions WHERE broadcaster IS NOT NULL ORDER BY id').all();
    assert.deepEqual(changed.map(row => row.id), [...ids].sort((a, b) => a - b));
    assert.ok(changed.every(row => row.broadcaster === 'self' && row.purpose === 'own'));
    assert.equal(f.database.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE broadcaster IS NULL').get().n, 3);
    assert.equal(f.planner.undoBackfill(applied.batch).restored, 3);
});

test('復原前可讀取批次明細與復原後值', t => {
    const f = fixture(t);
    f.seed(null);
    const filter = { platform: 'TikTok', status: 'unclassified', days: null, completeOnly: true };
    const preview = f.planner.previewBackfill(filter);
    const ids = preview.rows.slice(0, 2).map(row => row.id);
    const applied = f.planner.applyBackfill({
        ...filter, from: preview.from, broadcaster: 'self', purpose: 'own',
        ids, expected: ids.length
    });
    const detail = f.planner.batchDetails(applied.batch);
    assert.equal(detail.batch.id, applied.batch);
    assert.equal(detail.total, 2);
    assert.equal(detail.rows.length, 2);
    assert.ok(detail.rows.every(row => row.currentBroadcaster === 'self' && row.currentPurpose === 'own'));
    assert.ok(detail.rows.every(row => row.previousBroadcaster === null && row.previousPurpose === null));

    f.planner.undoBackfill(applied.batch);
    const after = f.planner.batchDetails(applied.batch);
    assert.ok(after.rows.every(row => row.currentBroadcaster === null && row.currentPurpose === null));
});

test('勾選模式拒絕不存在的場次與過期數量', t => {
    const f = fixture(t);
    f.seed(null);
    const base = { platform: 'TikTok', status: 'unclassified', days: null, completeOnly: true, from: null };
    const preview = f.planner.previewBackfill(base);
    const ids = preview.rows.slice(0, 2).map(row => row.id);
    assert.throws(() => f.planner.applyBackfill({ ...base, broadcaster: 'self', ids, expected: 1 }), { message: 'changed' });
    assert.throws(() => f.planner.applyBackfill({
        ...base, broadcaster: 'self', ids: [...ids, 999999], expected: 3
    }), { message: 'changed' });
    assert.throws(() => f.planner.applyBackfill({ ...base, broadcaster: 'self', ids: [], expected: 0 }), { message: 'sessions' });
    assert.throws(() => f.planner.applyBackfill({ ...base, broadcaster: 'self', ids: [1.5], expected: 1 }), { message: 'sessions' });
});

test('批次補分類拒絕空指派、未知用途與舊的預覽數量', t => {
    const f = fixture(t);
    f.seed(null);
    const base = { platform: 'TikTok', status: 'unclassified', days: null, completeOnly: false, from: null };
    assert.throws(() => f.planner.applyBackfill({ ...base, expected: 1 }), { message: 'assignment' });
    assert.throws(() => f.planner.applyBackfill({ ...base, expected: 1, purpose: 'unknown' }), { message: 'purpose' });
    assert.throws(() => f.planner.applyBackfill({ ...base, expected: 1, broadcaster: '   ' }), { message: 'broadcaster' });
    assert.throws(() => f.planner.applyBackfill({ ...base, expected: 0, broadcaster: 'self' }), { message: 'sessions' });
    const preview = f.planner.previewBackfill(base);
    f.setNow(MONDAY + 30 * DAY);
    f.store.record({ type: 'audience', platform: 'TikTok', userNum: 7 });
    assert.throws(() => f.planner.applyBackfill({ ...base, expected: preview.matched, broadcaster: 'self' }), { message: 'changed' });
});

test('只允許復原最近一次批次', t => {
    const f = fixture(t);
    f.seed(null);
    const base = { platform: 'TikTok', status: 'unclassified', days: null, completeOnly: true, from: null };
    const first = f.planner.previewBackfill(base);
    const a = f.planner.applyBackfill({ ...base, broadcaster: 'one', purpose: 'own', expected: first.matched });
    const all = { ...base, status: 'all' };
    const second = f.planner.previewBackfill(all);
    const b = f.planner.applyBackfill({ ...all, broadcaster: 'two', expected: second.matched });
    assert.throws(() => f.planner.undoBackfill(a.batch), { message: 'batch' });
    assert.equal(f.planner.undoBackfill(b.batch).restored, 6);
});

test('未知平台與只有一個達標時段不推薦，單場指定自己也能分析', t => {
    const f = fixture(t);
    f.seed('self', 'Unknown');
    f.seed('only');
    f.database.db.prepare("UPDATE sessions SET purpose='test' WHERE broadcaster='only' AND id%2=0").run();
    f.planner.classifyProfile({ platform: 'Unknown', broadcaster: 'self', purpose: 'own' });
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'only', purpose: 'own' });
    f.setNow(MONDAY + 21 * DAY - 3600000);
    f.enable();
    assert.equal(f.planner.snapshot().jobs.length, 0);
    const id = f.database.db.prepare("SELECT id FROM sessions WHERE broadcaster='only' LIMIT 1").get().id;
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'only', purpose: null });
    f.planner.classifySession({ id, broadcaster: 'only', purpose: 'own' });
    assert.equal(f.planner.analyses().find(row => row.platform === 'TikTok').rankings.sessionCount, 1);
});

test('提前30分鐘合併平台通知，兩個管道各發一次，重建排程器不重送', async t => {
    const f = fixture(t);
    for (const platform of ['TikTok', 'Twitch']) {
        f.seed('self', platform);
        f.planner.classifyProfile({ platform, broadcaster: 'self', purpose: 'own' });
    }
    const start = MONDAY + 21 * DAY;
    f.setNow(start - 3600000);
    f.enable();
    await f.planner.tick();
    assert.equal(f.sent.length, 0);
    f.setNow(start - 30 * 60000);
    await f.planner.tick();
    assert.equal(f.sent.length, 2);
    assert.deepEqual(f.sent.map(call => call[0]), ['ntfy', 'bark']);
    assert.match(f.sent[0][2], /TikTok/);
    assert.match(f.sent[0][2], /Twitch/);
    const restarted = new TrafficPlanner(f.database, f.options);
    await restarted.tick();
    assert.equal(f.sent.length, 2);
    assert.ok(restarted.snapshot().deliveries.every(row => row.status === 'sent'));
});

test('失敗通道不影響其他通道且不重送，略過與離線過期不補發', async t => {
    const f = fixture(t);
    f.seed('self');
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    const start = MONDAY + 21 * DAY;
    f.setNow(start - 3600000);
    f.enable();
    f.planner.snapshot();
    f.planner.skip(start);
    f.setNow(start - 30 * 60000);
    await f.planner.tick();
    assert.equal(f.sent.length, 0);
    f.setNow(start + 7 * DAY - 24 * 60000);
    await f.planner.tick();
    assert.equal(f.sent.length, 0);
    f.planner.send = async channel => { f.sent.push(channel); return channel === 'bark'; };
    f.setNow(start + 14 * DAY - 30 * 60000);
    await f.planner.tick();
    assert.equal(f.sent.length, 2);
    assert.deepEqual(f.planner.snapshot().deliveries.map(row => row.status).sort(), ['failed', 'sent']);
    await f.planner.tick();
    assert.equal(f.sent.length, 2);
});

test('重新分類取消尚未發送的建議，停用不發通知', async t => {
    const f = fixture(t);
    f.seed('self');
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    f.setNow(MONDAY + 21 * DAY - 3600000);
    f.enable();
    assert.ok(f.planner.snapshot().jobs.length);
    f.planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'test' });
    assert.equal(f.planner.snapshot().jobs.length, 0);
    f.planner.saveSettings({ ...f.planner.settings(), enabled: false });
    f.setNow(MONDAY + 21 * DAY - 30 * 60000);
    await f.planner.tick();
    assert.equal(f.sent.length, 0);
});

test('同一主播已在線則略過，其他平台仍正常提醒；過期樣本不誤判在線', async t => {
    const f = fixture(t);
    for (const platform of ['TikTok', 'Twitch']) {
        f.seed('self', platform);
        f.planner.classifyProfile({ platform, broadcaster: 'self', purpose: 'own' });
    }
    const start = MONDAY + 21 * DAY;
    f.setNow(start - 3600000);
    f.enable();
    f.planner.snapshot();
    f.store.record({ type: 'audience', platform: 'Twitch', broadcasterId: 'self',
        startedAt: new Date(start - 3600000).toISOString(), streamId: 'old-sample', userNum: 10 });
    f.setNow(start - 30 * 60000);
    f.store.record({ type: 'audience', platform: 'TikTok', broadcasterId: 'self',
        startedAt: new Date(start - 3600000).toISOString(), streamId: 'live-now', userNum: 10 });
    await f.planner.tick();
    assert.equal(f.sent.length, 2);
    assert.match(f.sent[0][2], /Twitch/);
    assert.doesNotMatch(f.sent[0][2], /TikTok/);
    assert.equal(f.planner.snapshot().jobs.find(job => job.platform === 'TikTok' && job.startAt === start).status, 'alreadyLive');
});

test('設定驗證與時區不依主機；夏令時間和45分鐘時區保留當地整點', () => {
    assert.throws(() => validateSettings({ enabled: true, channels: [] }), RangeError);
    assert.equal(calendar(Date.parse('2026-10-18T03:15:00Z'), 'Asia/Kathmandu').hour, 9);
    assert.equal(calendar(Date.parse('2026-10-18T03:15:00Z'), 'Asia/Kathmandu').minute, 0);
    const before = calendar(Date.parse('2026-11-01T05:00:00Z'), 'America/New_York');
    const after = calendar(Date.parse('2026-11-01T06:00:00Z'), 'America/New_York');
    assert.equal(before.key, after.key);
    assert.equal(before.date, after.date);
});

test('管理API不要求登入，但修改要求同來源，批次測試標記保留場次並可還原', async t => {
    const f = fixture(t);
    f.store.record({ type: 'audience', platform: 'Unknown', userNum: 1 });
    const route = createPlannerRoutes(f.planner);
    const request = (method, origin, body) => new Promise(resolve => {
        const req = new EventEmitter();
        Object.assign(req, { url: '/api/traffic/planner', method,
            headers: { host: 'localhost', origin, 'content-type': 'application/json' } });
        const res = { setHeader() {}, writeHead(status) { this.status = status; }, end(text) { resolve({ status: this.status, data: JSON.parse(text) }); } };
        route(req, res);
        if (method === 'POST') { req.emit('data', JSON.stringify(body)); req.emit('end'); }
    });
    assert.equal((await request('GET')).status, 200);
    assert.equal((await request('POST', 'https://other', {})).status, 403);
    const id = f.planner.sessions().rows[0].id;
    assert.equal((await request('POST', 'http://localhost', { action: 'tests', value: [id] })).status, 200);
    assert.equal(f.planner.sessions().total, 0);
    assert.equal(f.planner.sessions('', 1, 'test').rows[0].effectivePurpose, 'test');
    assert.equal(f.planner.sessions('', 1, 'test').total, 1);
    assert.equal((await request('POST', 'http://localhost', { action: 'assign', value: { ids: [id], purpose: 'reference' } })).status, 200);
    assert.equal(f.planner.sessions('', 1, 'reference').rows[0].effectivePurpose, 'reference');
    f.planner.classifySession({ id, broadcaster: '', purpose: null });
    assert.equal(f.planner.sessions().rows[0].effectivePurpose, 'unknown');
    const filter = { platform: '', status: 'unclassified', days: null, completeOnly: false };
    const preview = await request('POST', 'http://localhost', { action: 'backfillPreview', value: filter });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.matched, 1);
    assert.equal((await request('POST', 'http://localhost', {
        action: 'backfillApply', value: { ...filter, from: preview.data.from, broadcaster: 'self', expected: 2 }
    })).status, 409);
    const applied = await request('POST', 'http://localhost', {
        action: 'backfillApply',
        value: { ...filter, from: preview.data.from, broadcaster: 'self', purpose: 'own', expected: 1 }
    });
    assert.equal(applied.status, 200);
    assert.equal(applied.data.changed, 1);
    assert.equal(f.planner.sessions().total, 0);
    const detail = await request('POST', 'http://localhost', { action: 'backfillBatch', value: { id: applied.data.batch } });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.total, 1);
    assert.equal(detail.data.rows[0].currentBroadcaster, 'self');
    const undone = await request('POST', 'http://localhost', { action: 'backfillUndo', value: { id: applied.data.batch } });
    assert.equal(undone.status, 200);
    assert.equal(undone.data.restored, 1);
    assert.equal(f.planner.sessions().total, 1);
    assert.equal((await request('GET')).status, 200);
});
