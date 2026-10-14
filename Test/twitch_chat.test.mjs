import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onChat } from '../ScriptLib/twitch/chat.mjs';

const silent = { log() {}, error() {}, warn() {} };
const tick = () => new Promise(r => setTimeout(r, 0));

/** 建立記錄呼叫的假 deps。 */
function makeDeps(overrides = {}) {
    const calls = [];
    const state = { settings: { reviewMode: 'none' }, users: {} };
    const deps = {
        getApiClient: () => ({
            subscriptions: { checkUserSubscription: async () => ({ isSubscribed: false }) },
            channels: { getChannelFollowers: async () => ({ data: [] }) }
        }),
        getTuser: () => 'chan',
        getUserIcon: async (id) => `icon:${id}`,
        notify: async (...a) => calls.push(['notify', ...a]),
        sendChat: (...a) => calls.push(['sendChat', ...a]),
        sendAd: (...a) => calls.push(['sendAd', ...a]),
        writeLog: (...a) => calls.push(['log', ...a]),
        reportTraffic: (...a) => calls.push(['traffic', ...a]),
        reportFiltered: (...a) => calls.push(['filtered', ...a]),
        processFilter: () => ({ blocked: false }),
        recordChatHeat: () => true,
        replaceEmojis: (t) => t,
        translate: async (t) => t,
        sponsorStore: {
            state,
            getOrCreate(userId, name) {
                if (!state.users[userId]) state.users[userId] = { userId, displayName: name, ads: [] };
                return state.users[userId];
            },
            save() { calls.push(['save']); }
        },
        adScheduler: { clear: (...a) => calls.push(['clear', ...a]), schedule: (...a) => calls.push(['schedule', ...a]) },
        manageUrl: 'url',
        clipService: { createClip: (...a) => calls.push(['clip', ...a]) },
        logRawEvent: (...a) => calls.push(['raw', ...a]),
        logger: silent,
        ...overrides
    };
    return { deps, calls, state };
}

const ev = (over) => ({ chatterId: 'u1', chatterDisplayName: 'Alice', messageText: 'hello', messageId: 'm1', ...over });

test('一般聊天：過濾未擋、推播並送出翻譯後訊息', async () => {
    const { deps, calls } = makeDeps();
    await onChat(ev(), deps);
    await tick();

    assert.ok(calls.some(c => c[0] === 'traffic'));
    assert.ok(calls.some(c => c[0] === 'notify' && c[1] === 'Alice'));
    assert.ok(calls.some(c => c[0] === 'sendChat' && c[1] === 'Alice'));
});

test('一般聊天：被過濾器阻擋時回報但不送出', async () => {
    const { deps, calls } = makeDeps({ processFilter: () => ({ blocked: true, reason: 'spam' }) });
    await onChat(ev(), deps);
    await tick();

    assert.ok(calls.some(c => c[0] === 'filtered'));
    assert.ok(!calls.some(c => c[0] === 'sendChat'));
});

test('G#Ad：主播本人可新增廣告', async () => {
    const { deps, calls, state } = makeDeps();
    await onChat(ev({ chatterId: 'chan', chatterDisplayName: 'Owner', messageText: 'G#Ad hello world' }), deps);

    assert.equal(state.users['chan'].ads.length, 1);
    assert.ok(calls.some(c => c[0] === 'sendAd'));
    assert.ok(calls.some(c => c[0] === 'save'));
});

test('G#Ad：非訂閱者不能新增廣告', async () => {
    const { deps, state } = makeDeps();
    await onChat(ev({ chatterId: 'u2', chatterDisplayName: 'Bob', messageText: 'G#Ad hi' }), deps);

    assert.equal(state.users['u2'], undefined);
});

test('G#clip：主播本人可建立剪輯', async () => {
    const { deps, calls } = makeDeps();
    await onChat(ev({ chatterId: 'chan', chatterDisplayName: 'Owner', messageText: 'G#clip my title' }), deps);

    assert.ok(calls.some(c => c[0] === 'clip' && c[1] === 'my title'));
});

test('G#clip：未授權者不建立剪輯', async () => {
    const { deps, calls } = makeDeps();
    await onChat(ev({ chatterId: 'u3', chatterDisplayName: 'Cara', messageText: 'G#clip x' }), deps);

    assert.ok(!calls.some(c => c[0] === 'clip'));
});
