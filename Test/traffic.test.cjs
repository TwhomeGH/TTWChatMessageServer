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
    for(let week=0;week<3;week++) for(let day=0;day<2;day++) {
        const base=startOfWeek+(week*7+day)*86400000;
        for(let minute=0;minute<=20;minute++) {
            now=base+minute*60000;
            store.record({type:'audience',platform:'TikTok',userNum:(day?10:100)*(week+1),streamId:week+'-'+day,startedAt:new Date(base).toISOString()});
        }
    }
    now=startOfWeek+16*86400000;
    store.record({type:'audience',platform:'TikTok',userNum:9999,streamId:'missing-start'});

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

// 活躍發言人數：同一分鐘同一人只算一次，跨分鐘的同一個人也不會重複計。
test('活躍發言人數以不同發言者計（跨分鐘不重複）', () => {
    const db = new TrafficDatabase(':memory:');
    let now = Date.parse('2026-09-01T02:00:00Z');
    const store = new TrafficStore(() => now, db);

    store.record({ eventType: 'chat', platform: 'TikTok', id: 'c1', userId: 'a', message: 'hi' });
    store.record({ eventType: 'chat', platform: 'TikTok', id: 'c2', userId: 'a', message: 'yo' });
    store.record({ eventType: 'chat', platform: 'TikTok', id: 'c3', userId: 'b', message: 'hi' });
    assert.equal(db.activeUsers('TikTok', Date.parse('2026-09-01T02:00:00Z'), now), 2);

    now += 60000;   // 下一分鐘，同一人再發
    store.record({ eventType: 'chat', platform: 'TikTok', id: 'c4', userId: 'a', message: 'again' });
    assert.equal(db.activeUsers('TikTok', Date.parse('2026-09-01T02:00:00Z'), now), 2);

    const series = db.series('TikTok', Date.parse('2026-09-01T02:00:00Z'), 60000, now);
    assert.equal(series[0].activeUsers, 2);
    assert.equal(series[1].activeUsers, 1);

    // 桶寬大於一分鐘時，同一桶內跨分鐘的不同發言者要合併（不是每分鐘各算一次）。
    now += 3 * 60000;
    store.record({ eventType: 'chat', platform: 'TikTok', id: 'c5', userId: 'c', message: 'hi' });
    const wide = db.series('TikTok', Date.parse('2026-09-01T02:00:00Z'), 300000, now);
    assert.equal(wide[0].activeUsers, 3);
    db.close();
});

// 過濾攔截與廣告：filter 事件只進攔截／廣告統計，不算聊天數；廣告帳號仍算發言者。
test('過濾攔截率與廣告帳號比例', () => {
    const db = new TrafficDatabase(':memory:');
    const now = Date.parse('2026-09-01T02:00:00Z');
    const store = new TrafficStore(() => now, db);
    const since = Date.parse('2026-09-01T02:00:00Z');

    store.record({ eventType: 'chat', platform: 'TikTok', id: 'c1', userId: 'a', message: 'hi' });
    store.record({ eventType: 'chat', platform: 'TikTok', id: 'c2', userId: 'b', message: 'yo' });
    store.record({ type: 'filter', platform: 'TikTok', id: 'f1', userId: 'adbot', user: 'adbot', rule: 'user:廣告帳號-加LINE/加瀨', ad: true });
    store.record({ type: 'filter', platform: 'TikTok', id: 'f2', userId: 'spammer', user: 'spammer', rule: 'msg:大量 emoji', ad: false });

    const series = db.series('TikTok', since, 60000, now);
    assert.equal(series[0].chats, 2);         // filter 不算聊天
    assert.equal(series[0].blocked, 2);
    assert.equal(series[0].adBlocked, 1);
    assert.equal(db.activeUsers('TikTok', since, now), 4);   // 廣告帳號也計入發言者
    assert.equal(db.adUsers('TikTok', since, now), 1);
    db.close();
});

// 可選範圍清理：只刪指定範圍內的資料，範圍外保留。
test('清理統計只刪指定範圍，範圍外保留', () => {
    const db = new TrafficDatabase(':memory:');
    let now = Date.parse('2026-09-01T02:00:00Z');
    const store = new TrafficStore(() => now, db);

    store.record({ eventType: 'chat', platform: 'TikTok', id: 'a1', userId: 'u1', message: 'hi' });
    now += 3600000;   // 下一小時再一則
    store.record({ eventType: 'chat', platform: 'TikTok', id: 'a2', userId: 'u2', message: 'yo' });

    const from = Date.parse('2026-09-01T02:00:00Z');
    const to = Date.parse('2026-09-01T03:00:00Z');
    const counts = db.countRange('TikTok', from, to);
    assert.equal(counts.minutes, 1);
    assert.equal(counts.chatUsers, 1);
    assert.equal(counts.events, 1);

    const removed = db.deleteRange('TikTok', from, to);
    assert.equal(removed.minutes, 1);
    assert.equal(removed.chatUsers, 1);
    assert.equal(removed.events, 1);

    // 範圍外（03:00）那一筆還在
    assert.equal(db.series('TikTok', from, 60000, now).reduce((n, bucket) => n + bucket.chats, 0), 1);
    assert.equal(db.activeUsers('TikTok', from, now), 1);
    db.close();
});

// 清理預覽要能說出「刪的是什麼」，不能只給筆數。
test('清理預覽列出每日彙總、場次、帳號與樣本', () => {
    const db = new TrafficDatabase(':memory:');
    const now = Date.parse('2026-09-01T02:00:00Z');
    const store = new TrafficStore(() => now, db);
    store.record({ eventType: 'chat', platform: 'TikTok', id: 'a1', userId: 'u1', user: '甲', message: 'hi' });
    store.record({ type: 'audience', platform: 'TikTok', userNum: 175 });

    const from = Date.parse('2026-09-01T00:00:00Z');
    const to = Date.parse('2026-09-02T00:00:00Z');
    const preview = db.previewRange('TikTok', from, to, 'UTC');
    assert.equal(preview.days.length, 1);
    assert.equal(preview.days[0].chats, 1);
    assert.equal(preview.days[0].averageViewers, 175);
    assert.equal(preview.sessions.length, 1);
    assert.deepEqual(preview.speakers.map(speaker => speaker.userId), ['u1']);
    assert.equal(preview.speakers[0].chats, 1);            // 訊息則數
    assert.equal(preview.speakers[0].activeMinutes, 1);    // 有發言的分鐘數
    assert.equal(preview.samples.length, 2);
    assert.equal(preview.samples[0].user, 'u1');   // 有 userId 時以 userId 為身分
    db.close();
});

// 成效時鐘不佔用觀看時間；遲到取樣不得讓積分重疊。
test('成效、遲到取樣與補登 ID 不破壞觀看積分',()=>{
 const db=new TrafficDatabase(':memory:');
 const add=(time,kind,extra={})=>db.append({time,receivedAt:time,platform:'TikTok',kind,...extra},null,0);
 add(1000000,'viewers',{viewers:100});add(1030000,'metrics',{diamonds:1});
 add(1060000,'viewers',{viewers:100,stream:'a'});
 let row=db.openSession('TikTok');assert.equal(row.spanMs,60000);assert.equal(row.stream,'a');
 add(1040000,'viewers',{viewers:10,stream:'a'});
 add(1120000,'viewers',{viewers:100,stream:'a'});
 assert.equal(db.openSession('TikTok').spanMs,120000);
 add(1500000,'viewers',{viewers:100,stream:'a'});
 assert.equal(db.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
 db.close();
});

// 清理半場必須原子拒絕；完全涵蓋後所有表一起刪除。
test('清理半場不殘留不一致統計，交易失敗會回滾',()=>{
 const db=new TrafficDatabase(':memory:');
 for(const time of [600000,660000,720000]) db.append({time,receivedAt:time,platform:'TikTok',kind:'viewers',viewers:10,stream:'a'},null,0);
 assert.throws(()=>db.deleteRange('TikTok',660000,720000),{status:409});
 assert.equal(db.countRange('TikTok',600000,780000).events,3);
 db.db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'test failure'); END");
 assert.throws(()=>db.deleteRange('TikTok',600000,780000));
 assert.equal(db.countRange('TikTok',600000,780000).minutes,3);
 db.db.exec('DROP TRIGGER fail_delete');
 assert.equal(db.deleteRange('TikTok',600000,780000).sessions,1);db.close();
});

// 中途觀測與未知開播時間不當成完整開場，三場同日也不能達標。
test('排名排除未知開播和覆蓋不足，要求不同日期',()=>{
 const db=new TrafficDatabase(':memory:');const base=Date.parse('2026-09-07T10:00:00Z');
 for(let session=0;session<3;session++) {
  const start=base+session*60000;
  db.db.prepare('INSERT INTO sessions(platform,stream,started,actualStarted,lastSampleAt,earlyArea,earlySpanMs,sampleCount,spanMs) VALUES(?,?,?,?,?,?,?,?,?)').run('TikTok','s'+session,start,start,start+1200000,120000000,1200000,21,1200000);
 }
 db.db.prepare('INSERT INTO minutes(platform,time) VALUES(?,?)').run('TikTok',base);
 let r=db.rankings('TikTok',30,base+86400000,'UTC');assert.equal(r.cells[0].insufficient,true);
 db.db.exec('UPDATE sessions SET actualStarted=NULL');assert.equal(db.rankings('TikTok',30,base+86400000,'UTC').sessionCount,0);
 db.close();
});

test('清理預覽與刪除都要求登入及同來源 JSON',()=>{
 const {clearAccess}=require('../ScriptLib/traffic/clearPolicy.cjs');
 const req={headers:{host:'localhost:3332',origin:'http://localhost:3332','content-type':'application/json'}};
 assert.equal(clearAccess(req,false),401);assert.equal(clearAccess(req,true),0);
 assert.equal(clearAccess({headers:{...req.headers,origin:'https://other.test'}},true),403);
 assert.equal(clearAccess({headers:{...req.headers,'content-type':'text/plain'}},true),403);
});

// 超過五十筆仍可逐頁查完；同時間以事件 ID 排序，不遺漏或重複。
test('清理完整預覽分頁涵蓋全部事件與跨平台帳號',()=>{
 const db=new TrafficDatabase(':memory:');const from=Date.parse('2026-09-01T00:00:00Z'),to=from+60000;
 for(let i=0;i<123;i++)db.append({time:from,receivedAt:from,kind:'chat',platform:i%2?'TikTok':'Twitch',user:'u'+i,userId:'u'+i,message:'長訊息'.repeat(40)},null,0);
 db.append({time:from,receivedAt:from,kind:'viewers',platform:'TikTok',viewers:12},null,0);
 const pages=[1,2,3].map(page=>db.previewRange('all',from,to,'UTC',page));
 assert.deepEqual(pages.map(p=>p.samples.length),[50,50,24]);
 assert.equal(pages[0].pagination.totals.samples,124);
 assert.equal(pages[0].pagination.totals.speakers,123);
 assert.equal(new Set(pages.flatMap(p=>p.samples.map(e=>e.id))).size,124);
 assert.equal(pages.flatMap(p=>p.speakers).length,123);
 assert.equal(pages[0].samples[0].message.length,120);
 assert.equal(pages[2].samples.at(-1).kind,'viewers');
 assert.ok(db.previewRange('TikTok',from,to,'UTC').samples.every(e=>e.platform==='TikTok'));
 assert.equal(db.previewRange('all',to,to+60000,'UTC').pagination.totals.samples,0);
 assert.throws(()=>db.previewRange('all',from,to,'UTC',0));
 assert.throws(()=>db.previewRange('all',from,to,'UTC',1.5));db.close();
});

// 執行真正的路由函數，隔離資料庫與背景計時器，驗證 JSON 頁碼一路傳至查詢。
test('清理預覽路由接受預設與指定頁碼', async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 const {EventEmitter}=require('node:events');const pages=[];
 class FakeDatabase {
  prune(){return 0;}
  countRange(){return {};}
  previewRange(platform,from,to,timezone,page){pages.push(page);return {pagination:{page}};}
 }
 class FakeStore {record(){} heartbeat(){} }
 const context={module:{exports:{}},__dirname:path.resolve(__dirname,'..'),URL,console,
  setInterval:()=>({unref(){}}),require:name=>{
   if(name==='./ScriptLib/traffic/database.cjs')return {TrafficDatabase:FakeDatabase};
   if(name==='./ScriptLib/traffic/store.cjs')return {TrafficStore:FakeStore};
   if(name==='./ScriptLib/traffic/clearPolicy.cjs')return require('../ScriptLib/traffic/clearPolicy.cjs');
   return require(name);
  }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../TrafficRoutes.cjs'),'utf8'),context);
 for(const page of [undefined,2]){
  const result=await new Promise(resolve=>{
   const req=new EventEmitter();Object.assign(req,{url:'/api/traffic/clear',method:'POST',headers:{host:'localhost:3332',origin:'http://localhost:3332','content-type':'application/json'}});
   const res={status:200,setHeader(){},writeHead(status){this.status=status;},end(body){resolve({status:this.status,body:JSON.parse(body)});}};
   context.module.exports.serveTraffic(req,res,true);
   req.emit('data',JSON.stringify({platform:'TikTok',from:60000,to:120000,confirm:false,page}));req.emit('end');
  });
  assert.equal(result.status,200);assert.equal(result.body.preview,true);
  assert.equal(result.body.detail.pagination.page,page??1);
 }
 assert.deepEqual(pages,[1,2]);
});
