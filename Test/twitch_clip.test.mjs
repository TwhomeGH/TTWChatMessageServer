import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClipService } from '../ScriptLib/twitch/clip.mjs';

const silent = { log() {}, error() {} };

/** 建立剪輯服務與記錄呼叫的 deps。 */
function makeService({ apiClient, files = {}, tuser = 'chan' } = {}) {
    const calls = [];
    const fs = {
        existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
        readFileSync: (p) => files[p],
        writeFileSync: (p, d) => { files[p] = d; }
    };
    const svc = createClipService({
        getApiClient: () => apiClient,
        getTuser: () => tuser,
        fs,
        file: 'clip_history.json',
        writeLog: (...a) => calls.push(['log', ...a]),
        notify: async (...a) => calls.push(['notify', ...a]),
        sendSocketMessage: (...a) => calls.push(['socket', ...a]),
        logger: silent
    });
    return { svc, calls, files };
}

test('createClip（manual）：成功時通知、記錄歷史並回傳資訊', async () => {
    const apiClient = {
        clips: { createClip: async () => 'abc', getClipById: async () => ({ title: 'x' }) },
        streams: {}, videos: {}
    };
    const { svc, calls, files } = makeService({ apiClient });

    const res = await svc.createClip('My Title', 'icon', 'manual', null);

    assert.equal(res.id, 'abc');
    assert.equal(res.url, 'https://clips.twitch.tv/abc');
    assert.ok(calls.some(c => c[0] === 'notify' && c[1] === '剪輯建立'));
    assert.ok(calls.some(c => c[0] === 'socket' && c[1] === '剪輯建立'));
    assert.ok(Array.isArray(JSON.parse(files['clip_history.json'])));
});

test('createClip（manual）：失敗時通知失敗且不拋錯', async () => {
    const apiClient = {
        clips: { createClip: async () => { throw Object.assign(new Error('boom'), { response: { status: 400 } }); } }
    };
    const { svc, calls } = makeService({ apiClient });

    const res = await svc.createClip(null, 'icon', 'manual', null);

    assert.equal(res, undefined);
    assert.ok(calls.some(c => c[0] === 'notify' && c[1] === '剪輯建立失敗'));
});

test('createClip（auto）：未確認可用時失敗（catch 後重拋）', async () => {
    const apiClient = {
        clips: { createClip: async () => 'abc', getClipById: async () => null }
    };
    const { svc } = makeService({ apiClient });

    await assert.rejects(() => svc.createClip(null, 'icon', 'auto', null), /尚未確認可用/);
});

test('loadHistory：相容純陣列與 {clips}', () => {
    const files = { 'clip_history.json': JSON.stringify({ clips: [{ id: '1' }] }) };
    const { svc } = makeService({ apiClient: {}, files });
    assert.deepEqual(svc.loadHistory(), [{ id: '1' }]);

    files['clip_history.json'] = JSON.stringify([{ id: '2' }]);
    assert.deepEqual(svc.loadHistory(), [{ id: '2' }]);
});

test('recordHistory：最新在前並保留上限', () => {
    const files = {};
    const { svc } = makeService({ apiClient: {}, files });
    svc.recordHistory({ id: 'a', url: 'u1' });
    svc.recordHistory({ id: 'b', url: 'u2' });

    const saved = JSON.parse(files['clip_history.json']);
    assert.equal(saved[0].id, 'b');
    assert.equal(saved[1].id, 'a');
});
