const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TrafficStore } = require('../ScriptLib/traffic/store.cjs');
const { TrafficDatabase } = require('../ScriptLib/traffic/database.cjs');

// 一般聊天字詞不代表進房；明確事件也必須排除測試、舊訊息及重播。
test('明確進房、時間與來源去重', () => {
    let now = 1700000000000;
    const store = new TrafficStore(() => now);

    assert.equal(store.record({ message: '朋友來了' }), false);
    assert.equal(store.record({ eventType: 'join', isTest: true }), false);
    assert.equal(store.record({ eventType: 'join', sentAt: now - 130000 }), false);

    const join = { eventType: 'join', platform: 'TikTok', userId: '1', id: 'a', sentAt: now };
    assert.equal(store.record(join), true);
    assert.equal(store.record({ ...join, transport: 'userscript' }), false);
    assert.equal(store.snapshot('TikTok').events.length, 1);

    store.record({ eventType: 'join', platform: 'Unknown', user: 'anon' });
    assert.ok(store.snapshot().platforms.includes('Unknown'));
});

// 觀看數有缺值、零值與過期之分，不跨平台或跨斷線算斜率。
test('觀看數斜率、零值、缺漏與平台隔離', () => {
    let now = 1700000000000;
    const store = new TrafficStore(() => now);

    store.record({ type: 'audience', platform: 'TikTok', userNum: 0 });
    now += 60000;
    store.record({ type: 'audience', platform: 'TikTok', userNum: 10 });
    assert.equal(store.snapshot('TikTok').growth, 10);
    assert.equal(store.snapshot('TikTok').growingMs, 60000);

    store.record({ type: 'audience', platform: 'Twitch', userNum: 500 });
    assert.equal(store.snapshot('TikTok').currentViewers, 10);

    now += 91000;
    assert.equal(store.snapshot('TikTok').currentViewers, null);
    assert.equal(store.snapshot('TikTok').growth, null);
    assert.equal(store.record({ type: 'audience', userNum: '12' }), false);
});

// 真正關閉並重開資料庫，確認歷史與去重不依賴程序記憶體。
test('SQLite 重啟保留事件與週月彙總並隔離平台', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-db-'));
    const file = path.join(dir, 'history.sqlite');
    let db = new TrafficDatabase(file);
    t.after(() => {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    let now = Date.parse('2026-09-01T02:00:00Z');
    let store = new TrafficStore(() => now, db);
    assert.equal(store.record({ eventType: 'join', platform: 'TikTok', id: 'one' }), true);
    store.record({ type: 'audience', platform: 'TikTok', userNum: 10 });
    store.record({ type: 'audience', platform: 'TikTok', userNum: 30 });

    db.close();
    db = new TrafficDatabase(file);
    store = new TrafficStore(() => now, db);
    assert.equal(store.record({ eventType: 'join', platform: 'TikTok', id: 'one' }), false);
    assert.equal(store.snapshot('TikTok').events.length, 1);

    now = Date.parse('2026-09-15T02:00:00Z');
    store.record({ type: 'audience', platform: 'TikTok', userNum: 40 });
    store.record({ type: 'audience', platform: 'Twitch', userNum: 999 });
    now += 60000;

    const month = db.distribution('TikTok', 30, now, 'Asia/Taipei');
    assert.equal(month.daily.length, 2);
    assert.equal(month.observedSegments, 2);
    const cell = month.cells.find(c => c.key === 'Tue 10');
    assert.equal(cell.averageViewers, 30);
    assert.equal(cell.observedMinutes, 2);
    assert.equal(cell.observedDays, 2);
    assert.equal(db.distribution('TikTok', 7, now, 'Asia/Taipei').daily.length, 1);
    assert.throws(() => db.distribution('TikTok', 30, now, 'bad-zone'));
});

// 有串流 ID 時，中斷（即使超過容忍值）仍視為同一場；未觀測空檔不計入時間加權。
test('同串流 ID 即使中斷也續接，未觀測空檔不計入平均', () => {
    let now = Date.parse('2026-09-01T02:00:00Z');
    const db = new TrafficDatabase(':memory:');
    const store = new TrafficStore(() => now, db);
    const audience = (viewers, streamId) => ({ type: 'audience', platform: 'TikTok', userNum: viewers, streamId });

    store.record(audience(10, 'room-a'));
    now += 60000;
    store.record(audience(30, 'room-a'));
    now += 60000;
    store.record(audience(20, 'room-a'));
    now += 300000; // 中斷 5 分鐘，但 roomId 相同 → 仍同一場
    store.record(audience(50, 'room-a'));
    now += 60000; // 換串流 ID → 新場次
    store.record(audience(80, 'room-b'));

    const sessions = db.db.prepare('SELECT * FROM sessions ORDER BY id').all();
    assert.equal(sessions.length, 2);

    assert.equal(sessions[0].sampleCount, 4);
    assert.equal(sessions[0].spanMs, 120000); // 未觀測的 5 分鐘不計入
    assert.equal(sessions[0].peak, 50);
    // 時間加權平均：((10+30)/2·60s + (30+20)/2·60s) / 120s = 22.5
    assert.equal(sessions[0].area / sessions[0].spanMs, 22.5);

    assert.equal(sessions[1].stream, 'room-b');
    assert.equal(sessions[1].sampleCount, 1);
    db.close();
});

// 沒有串流 ID 時只能靠間隔：超過容忍值就切新場次。
test('無串流 ID 時以取樣間隔切分場次', () => {
    let now = Date.parse('2026-09-01T02:00:00Z');
    const db = new TrafficDatabase(':memory:');
    const store = new TrafficStore(() => now, db);
    const audience = viewers => ({ type: 'audience', platform: 'Kick', userNum: viewers });

    store.record(audience(10));
    now += 60000;
    store.record(audience(20));
    now += 300000; // 中斷超過 120 秒 → 新場次
    store.record(audience(30));

    const sessions = db.db.prepare('SELECT * FROM sessions ORDER BY id').all();
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].spanMs, 60000);
    assert.equal(sessions[1].sampleCount, 1);
    db.close();
});

// 場次收尾時依中斷期間有無心跳，分辨「斷流」與「程式離線」。
test('場次中斷依心跳分辨斷流與程式離線', () => {
    let now = Date.parse('2026-09-01T02:00:00Z');
    const db = new TrafficDatabase(':memory:');
    const store = new TrafficStore(() => now, db);
    // 刻意不帶串流 ID，才會走「間隔切分」這條路，才驗得到中斷原因。
    const audience = viewers => ({ type: 'audience', platform: 'Kick', userNum: viewers });

    store.heartbeat();
    store.record(audience(10));
    now += 60000;
    store.heartbeat();
    now += 300000;
    store.heartbeat();
    store.record(audience(20)); // 期間有心跳 → 前一個場次記為斷流
    assert.equal(db.db.prepare('SELECT * FROM sessions ORDER BY id LIMIT 1').get().closedBy, 'gap');

    now += 600000; // 這 10 分鐘沒有心跳
    store.record(audience(30)); // 前一個場次記為程式離線
    assert.equal(db.db.prepare('SELECT * FROM sessions ORDER BY id LIMIT 1 OFFSET 1').get().closedBy, 'offline');
    db.close();
});

// 排名以場次為單位、取開場平均，並用收縮估計與樣本門檻避免小樣本奪冠。
test('時段排名取開場平均並做收縮與樣本門檻', () => {
    const startOfWeek = Date.parse('2026-09-07T10:00:00Z'); // 週一 18:00 台北
    let now = startOfWeek;
    const db = new TrafficDatabase(':memory:');
    const store = new TrafficStore(() => now, db);
    const audience = (viewers, streamId) => ({ type: 'audience', platform: 'TikTok', userNum: viewers, streamId });

    // 週一 18:00 三場（開場平均 100 / 200 / 300）
    for (let week = 0; week < 3; week++) {
        const base = startOfWeek + week * 7 * 86400000;
        now = base;
        store.record(audience(100 + week * 100, 'mon' + week));
        now = base + 60000;
        store.record(audience(100 + week * 100, 'mon' + week));
    }
    // 週二 18:00 三場（開場平均 10 / 20 / 30）
    for (let week = 0; week < 3; week++) {
        const base = startOfWeek + 86400000 + week * 7 * 86400000;
        now = base;
        store.record(audience(10 + week * 10, 'tue' + week));
        now = base + 60000;
        store.record(audience(10 + week * 10, 'tue' + week));
    }
    // 只有單一樣本的場次不納入（樣本門檻）
    now = startOfWeek + 2 * 86400000;
    store.record(audience(9999, 'wed'));

    const rankNow = startOfWeek + 20 * 86400000;
    const rankings = db.rankings('TikTok', 30, rankNow, 'Asia/Taipei');

    assert.equal(rankings.sessionCount, 6);
    assert.equal(rankings.globalMean, 110);
    assert.deepEqual(rankings.cells.map(c => c.key), ['Mon 18', 'Tue 18']);

    const monday = rankings.cells[0];
    assert.equal(monday.n, 3);
    assert.equal(monday.mean, 200);
    assert.equal(monday.median, 200);
    assert.equal(monday.insufficient, false);
    assert.equal(monday.shrunk, 155); // (3·200 + 3·110) / 6

    assert.equal(rankings.cells[1].shrunk, 65); // (3·20 + 3·110) / 6
    db.close();
});

// userscript 轉接用 type:'StreamMessage'（沒有 eventType）也要算聊天；備用觀看樣本在原生死後才接手。
test('userscript 轉接訊息分類與備用觀看樣本', () => {
    let now = 1700000000000;
    const db = new TrafficDatabase(':memory:');
    const store = new TrafficStore(() => now, db);

    assert.equal(store.record({ type: 'StreamMessage', platform: 'Youtube', user: 'a', message: 'hi' }), true);
    assert.equal(store.record({ type: 'StreamMessage', platform: 'Youtube', user: 'b', message: 'yo', msgId: 'm1' }), true);

    // 原生 TikTok 觀看樣本。
    assert.equal(store.record({ type: 'audience', platform: 'TikTok', userNum: 100, transport: 'native' }), true);
    // 原生剛回報過 → 備用樣本（頭號觀眾數）不計入。
    now += 10000;
    assert.equal(store.record({ type: 'audience', platform: 'TikTok', userNum: 5, audienceKind: 'top-fans' }), false);
    // 原生靜默超過 90 秒 → 備用接手。
    now += 90000;
    assert.equal(store.record({ type: 'audience', platform: 'TikTok', userNum: 6, audienceKind: 'top-fans' }), true);

    const kinds = db.db.prepare('SELECT kind, COUNT(*) AS n FROM events GROUP BY kind ORDER BY kind').all()
        .map(row => ({ kind: row.kind, n: row.n }));
    assert.deepEqual(kinds, [{ kind: 'chat', n: 2 }, { kind: 'viewers', n: 2 }]);
    db.close();
});

// 成效事件可開場次並記錄累計成果；累計值只前進不退。
test('成效事件開場次並以累計最大值記錄', () => {
    let now = Date.parse('2026-09-01T02:00:00Z');
    const db = new TrafficDatabase(':memory:');
    const store = new TrafficStore(() => now, db);

    assert.equal(store.record({ type: 'metrics', platform: 'TikTok', streamId: 'r', diamonds: 10, gifters: 1, newFollowers: 2, likes: 5, uniqueViewers: 20 }), true);
    now += 30000;
    assert.equal(store.record({ type: 'metrics', platform: 'TikTok', streamId: 'r', diamonds: 30, gifters: 3, newFollowers: 4, likes: 9, uniqueViewers: 25 }), true);
    now += 30000;
    // 重送較舊的累計值不應讓成果倒退。
    assert.equal(store.record({ type: 'metrics', platform: 'TikTok', streamId: 'r', diamonds: 15, gifters: 2, newFollowers: 3, likes: 6, uniqueViewers: 22 }), true);
    // 完全沒有數值不算有效事件。
    assert.equal(store.record({ type: 'metrics', platform: 'TikTok' }), false);

    const session = db.db.prepare('SELECT * FROM sessions ORDER BY id LIMIT 1').get();
    assert.equal(session.sampleCount, 0); // 沒有觀看樣本，排名時會被樣本門檻濾掉
    assert.equal(session.diamonds, 30);
    assert.equal(session.gifters, 3);
    assert.equal(session.newFollowers, 4);
    assert.equal(session.likes, 9);
    assert.equal(session.uniqueViewers, 25);

    const daily = db.metrics('TikTok', 30, now + 1000, 'Asia/Taipei');
    assert.equal(daily.daily.length, 1);
    assert.equal(daily.daily[0].diamonds, 30);
    db.close();
});

// 圖表序列：從 minutes 取範圍資料，依桶寬彙總，缺資料處 viewers 為 null（折線才斷得開）。
test('圖表序列依桶寬彙總並保留缺資料', () => {
    const db = new TrafficDatabase(':memory:');
    let now = Date.parse('2026-09-01T02:00:00Z');
    const store = new TrafficStore(() => now, db);

    store.record({ eventType: 'join', platform: 'TikTok', id: 'a' });
    store.record({ type: 'audience', platform: 'TikTok', userNum: 10 });
    now += 60000;
    store.record({ eventType: 'join', platform: 'TikTok', id: 'b' });
    store.record({ type: 'audience', platform: 'TikTok', userNum: 30 });

    assert.equal(db.earliest('TikTok'), Date.parse('2026-09-01T02:00:00Z'));

    const series = db.series('TikTok', Date.parse('2026-09-01T02:00:00Z'), 300000, now);
    assert.equal(series.length, 1);       // 兩分鐘落在同一個 5 分鐘桶
    assert.equal(series[0].joins, 2);
    assert.equal(series[0].viewers, 20);  // (10 + 30) / 2

    const empty = db.series('TikTok', Date.parse('2026-09-01T02:05:00Z'), 300000, Date.parse('2026-09-01T02:10:00Z'));
    assert.equal(empty[0].viewers, null);
    assert.equal(empty[0].joins, 0);
    db.close();
});
