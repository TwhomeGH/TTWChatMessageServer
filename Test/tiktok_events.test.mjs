// ScriptLib/tiktok/events.mjs 的單元測試：以假 connection 捕捉處理器並以記錄型 deps 驗證。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ControlAction, WebcastEvent } from 'tiktok-live-connector';
import { registerTikTokEvents, getTikTokProfilePic } from '../ScriptLib/tiktok/events.mjs';

/**
 * 建立假的 connection（捕捉 event → handler）與記錄型 deps。
 * @param {object} [overrides] 覆寫特定 deps。
 * @returns {{conn: object, deps: object, calls: Array}}
 */
function makeHarness(overrides = {}) {
    const calls = [];
    const conn = { handlers: {}, state: { roomInfo: { data: { user_count: 42 } } }, on(evt, fn) { this.handlers[evt] = fn; } };
    const deps = {
        tiktokName: 'coffeelatte0709', isTK: false,
        notify: (...a) => calls.push(['notify', ...a]),
        sendSocketMessage: (...a) => calls.push(['socket', ...a]),
        logRawEvent: () => {},
        writeLog: (...a) => calls.push(['log', ...a]),
        writeFileSync: () => {},
        dedup: { isDuplicate: () => false, add: () => {} },
        sentCache: { alreadySent: () => false },
        processFilter: () => ({ blocked: false }),
        reportFiltered: () => {},
        reportTraffic: () => {},
        replaceEmojis: (x) => x,
        recordChatHeat: () => true,
        chatMetadata: (d) => ({ id: d.msgId, time: d.createTime || 0 }),
        translate: async (x) => x,
        tikTokChatGuard: { check: () => ({ accepted: true }) },
        giftNames: { ensureGiftNameTranslation: async (n) => n },
        getGiftMapReady: () => Promise.resolve(),
        getCacheUserNum: () => 0, getCacheUserList: () => [],
        setCacheUserNum: () => {}, setCacheUserList: () => {},
        getAutoClip: () => null, sendAudienceUpdate: () => {},
        isEnd: () => false, getStreamEnded: () => false,
        setStreamEnded: () => calls.push(['streamEnded']),
        cancelReconnect: () => calls.push(['cancelReconnect']),
        logger: { log: () => {}, error: () => {} },
        ...overrides,
    };
    registerTikTokEvents(conn, deps);
    return { conn, deps, calls };
}

const user = (nickname, sessions = {}) => ({ nickname, id: 'id-' + nickname, displayId: 'disp-' + nickname, ...sessions });

test('getTikTokProfilePic：優先挑 100x100 的 webp', () => {
    const u = { avatarLarge: { urlList: ['https://x/b.jpeg', 'https://x/a_100x100.webp'] } };
    assert.equal(getTikTokProfilePic(u), 'https://x/a_100x100.webp');
    assert.equal(getTikTokProfilePic(null), '');
});

test('CHAT：觸發 notify 與 sendSocketMessage', async () => {
    const { conn, calls } = makeHarness();
    conn.handlers.chat({ user: user('Bob'), content: 'hello', msgId: 'm1', common: {}, createTime: 1 });
    await new Promise(r => setTimeout(r, 0));
    assert.ok(calls.some(c => c[0] === 'notify' && c[1] === 'Bob' && c[2] === 'hello'));
    assert.ok(calls.some(c => c[0] === 'socket' && c[1] === 'Bob'));
});

test('MEMBER：跨路徑重複時直接跳過', () => {
    const { conn, calls } = makeHarness({ dedup: { isDuplicate: () => true, add: () => {} } });
    conn.handlers.member({ user: user('Eve'), common: {} });
    assert.equal(calls.some(c => c[0] === 'socket'), false);
});

test('FOLLOW：送出關注訊息', () => {
    const { conn, calls } = makeHarness();
    conn.handlers.follow({ user: user('Alice') });
    assert.ok(calls.some(c => c[0] === 'notify' && c[2] === '關注了主播'));
});

test('LIKE：累加點讚並送出', () => {
    const { conn, calls } = makeHarness();
    conn.handlers.like({ user: user('Cara'), count: 3 });
    assert.ok(calls.some(c => c[0] === 'socket' && String(c[2]).includes('喜歡你 3 次')));
});

test('GIFT：連擊進行中只送連擊進度', () => {
    const { conn, calls } = makeHarness();
    conn.handlers.gift({ user: user('Dave'), gift: { name: 'Rose', type: 1 }, repeatEnd: false, repeatCount: 2 });
    return new Promise(resolve => setImmediate(() => {
        assert.ok(calls.some(c => c[0] === 'notify' && String(c[2]).includes('連擊了 Rose 2 個')));
        resolve();
    }));
});

test('STREAM_END：設定 streamEnded 並取消重連', () => {
    const { conn, calls } = makeHarness();
    conn.handlers[WebcastEvent.STREAM_END]({ action: ControlAction.CONTROL_ACTION_STREAM_ENDED });
    assert.ok(calls.some(c => c[0] === 'streamEnded'));
    assert.ok(calls.some(c => c[0] === 'cancelReconnect'));
});
