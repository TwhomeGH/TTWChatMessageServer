const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudienceTracker, computeScore, levelFor } = require('../ScriptLib/audience/tracker.cjs');

const DAY = 86400000;
const BASE = Date.parse('2026-09-01T10:00:00Z');

function fixture(t) {
    let now = BASE + 10 * DAY;
    const sessions = Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        start: BASE + index * DAY,
        end: BASE + index * DAY + 3600000
    }));
    const tracker = createAudienceTracker({
        file: ':memory:',
        now: () => now,
        timezone: () => 'UTC',
        sessionFor: (platform, time) => sessions.find(session => time >= session.start && time <= session.end)?.id ?? null,
        recentSessions: () => [...sessions].reverse().map(session => session.id)
    });
    t.after(() => tracker.close());
    const entry = (sessionIndex, category, user = 'alice', extra = {}) => ({
        t: sessions[sessionIndex].start + 60000,
        platform: 'tiktok',
        category,
        user,
        ...extra
    });
    return { tracker, sessions, entry, setNow: value => { now = value; } };
}

test('常客分數按出席、連續、廣度、互動與送禮計算', t => {
    const f = fixture(t);
    for (const session of [3, 4, 5]) {
        for (let minute = 0; minute < 3; minute++) {
            f.tracker.observe(f.entry(session, 'chat', 'alice', {
                message: `hello ${minute}`,
                t: f.sessions[session].start + minute * 60000
            }));
        }
    }
    f.tracker.observe(f.entry(4, 'gift', 'alice', { message: 'rose' }));
    f.tracker.observe(f.entry(5, 'gift', 'alice', { message: 'rose' }));

    const details = f.tracker.details('TikTok', 'alice');
    assert.equal(details.activeStreams, 3);
    assert.equal(details.streak, 3);
    assert.equal(details.activeDays, 3);
    assert.equal(details.messages, 9);
    assert.equal(details.gifts, 2);
    assert.equal(details.giftStreams, 2);
    assert.ok(details.labels.includes('alwaysHere'));
    assert.equal(details.labels.includes('giftRegular'), false);
    assert.equal(details.level, 1);
    assert.equal(details.components.attendance, 5.25);
    assert.equal(details.components.consecutive, 9.375);
    assert.equal(details.components.breadth, 3);
    assert.equal(details.components.interaction, 1.35);
    assert.equal(details.components.support, 2);
    assert.equal(details.score, 21);
    assert.equal(details.recent.length, 3);
});

test('分數 65.5 可以拆解成五個分量，等級門檻有額外條件', () => {
    const score = computeScore({ activeStreams: 15, streak: 6, activeDays: 12, messages: 50, gifts: 1 });
    assert.equal(score.attendance, 26.25);
    assert.equal(score.consecutive, 18.75);
    assert.equal(score.breadth, 12);
    assert.equal(score.interaction, 7.5);
    assert.equal(score.support, 1);
    assert.equal(score.total, 65.5);
    assert.equal(levelFor({ score: score.total, activeStreams: 15, streak: 6 }), 3);
    assert.equal(levelFor({ score: 65, activeStreams: 9, streak: 6 }), 2);
    assert.equal(levelFor({ score: 85, activeStreams: 20, streak: 6 }), 4);
});

test('訊息與送禮都有單場、每分鐘上限，指令不計訊息', t => {
    const f = fixture(t);
    const start = f.sessions[0].start;
    for (let index = 0; index < 5; index++) {
        f.tracker.observe(f.entry(0, 'chat', 'alice', { message: `same minute ${index}`, t: start + 1000 }));
    }
    for (let minute = 1; minute <= 20; minute++) {
        f.tracker.observe(f.entry(0, 'chat', 'alice', {
            message: `minute ${minute}`,
            t: start + minute * 60000
        }));
    }
    for (let index = 0; index < 10; index++) {
        f.tracker.observe(f.entry(0, 'gift', 'alice', { message: 'gift' }));
    }
    const details = f.tracker.details('TikTok', 'alice');
    assert.equal(details.messages, 10);
    assert.equal(details.gifts, 5);
    assert.equal(details.activeStreams, 1);

    f.tracker.observe(f.entry(1, 'chat', 'alice', { message: '!command' }));
    const afterCommand = f.tracker.details('TikTok', 'alice');
    assert.equal(afterCommand.messages, 10);
    assert.equal(afterCommand.activeStreams, 2);
});

test('userId 優先於顯示名稱，列表可搜尋與分頁', t => {
    const f = fixture(t);
    f.tracker.observe(f.entry(0, 'chat', 'Alice', { userId: 'u1', message: 'hi' }));
    f.tracker.observe(f.entry(0, 'chat', 'Alice Renamed', { userId: 'u1', message: 'hello' }));
    f.tracker.observe(f.entry(0, 'chat', 'Bob', { message: 'yo' }));

    const all = f.tracker.list();
    assert.equal(all.total, 2);
    assert.equal(all.users.find(user => user.userKey === 'u1').displayName, 'Alice Renamed');
    const filtered = f.tracker.list({ q: 'bob' });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.users[0].displayName, 'Bob');
    assert.equal(f.tracker.details('TikTok', 'u1').messages, 2);
    assert.equal(f.tracker.details('TikTok', 'u2'), null);
});
