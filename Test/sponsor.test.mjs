import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSponsorStore } from '../ScriptLib/sponsor/store.mjs';
import { createAdScheduler } from '../ScriptLib/sponsor/scheduler.mjs';
import { createSentCache } from '../ScriptLib/sponsor/sent-cache.mjs';

const silent = { log() {}, error() {} };

/** 同步檔案系統替身（贊助資料用）。 */
function fakeFsSync(files) {
    return {
        existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
        readFileSync: (p) => {
            if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error('ENOENT');
            return files[p];
        },
        writeFileSync: (p, data) => { files[p] = data; }
    };
}

/** promises 檔案系統替身（已送快取用）。 */
function fakeFsAsync(files) {
    return {
        readFile: async (p) => {
            if (!Object.prototype.hasOwnProperty.call(files, p)) {
                const err = new Error('ENOENT');
                err.code = 'ENOENT';
                throw err;
            }
            return files[p];
        },
        writeFile: async (p, data) => { files[p] = data; }
    };
}

test('SponsorStore：載入新格式並保留 settings/users', () => {
    const file = 'sponsor_ads.json';
    const files = { [file]: JSON.stringify({ settings: { reviewMode: 'auto' }, users: { u1: { userId: 'u1', displayName: 'A', ads: [] } } }) };
    const store = createSponsorStore({ fs: fakeFsSync(files), file, logger: silent });

    store.load();

    assert.equal(store.state.settings.reviewMode, 'auto');
    assert.equal(Object.keys(store.state.users).length, 1);
});

test('SponsorStore：相容舊格式（頂層直接是 users）並改寫為新格式', () => {
    const file = 'sponsor_ads.json';
    const files = { [file]: JSON.stringify({ u1: { userId: 'u1', displayName: 'A', ads: [] } }) };
    const store = createSponsorStore({ fs: fakeFsSync(files), file, logger: silent });

    store.load();

    assert.equal(store.state.settings.reviewMode, 'none');
    assert.ok(store.state.users.u1);
    const rewritten = JSON.parse(files[file]);
    assert.ok(rewritten.settings && rewritten.users);
});

test('SponsorStore：getOrCreate 建立與更新', () => {
    const store = createSponsorStore({ fs: fakeFsSync({}), file: 'sponsor_ads.json', logger: silent });
    const sponsor = store.getOrCreate('u9', 'Nine');
    assert.deepEqual(sponsor, { userId: 'u9', displayName: 'Nine', ads: [] });
    store.getOrCreate('u9', 'Nine2');
    assert.equal(store.state.users.u9.displayName, 'Nine2');
});

test('AdScheduler：間隔低於下限不排程', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const delivered = [];
    const store = { state: { settings: {}, users: {} }, save() {} };
    const sched = createAdScheduler({ deliver: (...a) => delivered.push(a), notify: async () => {}, store, manageUrl: 'x', minIntervalMinutes: 15, logger: silent });

    sched.schedule('a1', 'u1', 10, { overlayUser: 'u', text: 't', iconURL: '', useTTS: false });
    t.mock.timers.tick(60 * 60 * 1000);

    assert.equal(delivered.length, 0);
});

test('AdScheduler：到期送出並更新 lastSentAt', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const delivered = [];
    const notifs = [];
    const saved = [];
    const ad = { id: 'a1', intervalMinutes: 20 };
    const store = { state: { settings: {}, users: { u1: { ads: [ad] } } }, save() { saved.push(1); } };
    const sched = createAdScheduler({ deliver: (...a) => delivered.push(a), notify: async (...a) => notifs.push(a), store, manageUrl: 'x', logger: silent });

    sched.schedule('a1', 'u1', 20, { overlayUser: 'u', text: 't', iconURL: '', useTTS: false });
    t.mock.timers.tick(20 * 60 * 1000);

    assert.equal(delivered.length, 1);
    assert.deepEqual(delivered[0], ['u', 't', '', false]);
    assert.equal(notifs.length, 1);
    assert.ok(ad.lastSentAt);
    assert.ok(saved.length >= 1);
});

test('SentCache：載入歷史、去重與保存本次新增', async () => {
    const file = 'send_messages.json';
    const files = { [file]: JSON.stringify({ k1: new Date().toISOString() }) };
    const cache = createSentCache({ fs: fakeFsAsync(files), file, logger: silent });

    await cache.load();
    assert.equal(cache.alreadySent('k1'), true);
    assert.equal(cache.alreadySent('k2'), false);
    assert.equal(cache.alreadySent('k2'), true);

    await cache.save();
    const savedKeys = Object.keys(JSON.parse(files[file]));
    assert.deepEqual(savedKeys, ['k2']);
});

test('SentCache：過期項目會被清除', async () => {
    const file = 'send_messages.json';
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const files = { [file]: JSON.stringify({ old: old }) };
    const cache = createSentCache({ fs: fakeFsAsync(files), file, ttlMs: 1000, logger: silent });

    await cache.load();
    assert.equal(cache.alreadySent('old'), false);
});
