import test from 'node:test';
import assert from 'node:assert/strict';
import {
    Notifier, createNotifier, BarkChannel, NtfyChannel, parseNtfyTarget,
    stripEmojiUrls, pickEmojiIcon, stripEmojiCodes, buildNotification
} from '../ScriptLib/notify/index.mjs';

const logger = { info() {}, error() {}, warn() {}, log() {} };

function fakeAxios() {
    const calls = [];
    return {
        calls,
        post: async (url, payload, config) => { calls.push({ url, payload, config }); return { status: 200 }; }
    };
}

test('parseNtfyTarget 拆出 server 根與 topic，並支援自架子路徑與 Basic Auth', () => {
    assert.deepEqual(parseNtfyTarget('https://ntfy.sh/mytopic'), { base: 'https://ntfy.sh/', topic: 'mytopic', auth: undefined });
    assert.deepEqual(
        parseNtfyTarget('https://host/ntfy/mytopic'),
        { base: 'https://host/ntfy/', topic: 'mytopic', auth: undefined });
    assert.deepEqual(
        parseNtfyTarget('https://user:pass@ntfy.sh/topic'),
        { base: 'https://ntfy.sh/', topic: 'topic', auth: { username: 'user', password: 'pass' } });
    assert.equal(parseNtfyTarget('https://ntfy.sh/'), null);
    assert.equal(parseNtfyTarget('not a url'), null);
});

test('格式化：emoji 圖示、移除代碼與圖片網址、圖片網址當圖示', () => {
    assert.equal(stripEmojiUrls('hi https://x/a.png there'), 'hi  there');
    const map = { fire: 'https://x/fire.png' };
    assert.deepEqual(pickEmojiIcon('hello fire', map), { code: 'fire', url: 'https://x/fire.png' });
    assert.equal(pickEmojiIcon('nothing', map), null);
    assert.equal(stripEmojiCodes('hello fire world', 'fire', map), 'hello fire world');
    assert.equal(stripEmojiCodes('fire fire', 'fire', map), 'fire x2');

    const withEmoji = buildNotification('hello fire', 'fallback', map);
    assert.equal(withEmoji.icon, 'https://x/fire.png');
    assert.equal(withEmoji.body, 'hello fire');

    const withImage = buildNotification('look https://x/pic.png done', 'fallback', {});
    assert.equal(withImage.icon, 'https://x/pic.png');
    assert.equal(withImage.body, 'look done');

    const fallback = buildNotification('plain text', 'fallback', {});
    assert.equal(fallback.icon, 'fallback');
    assert.equal(fallback.body, 'plain text');
});

test('BarkChannel 依開關與設定啟用，POST 正確 payload', async () => {
    assert.equal(new BarkChannel({ url: 'none', axios: fakeAxios() }).enabled, false);
    assert.equal(new BarkChannel({ url: '', axios: fakeAxios() }).enabled, false);

    const axios = fakeAxios();
    const channel = new BarkChannel({ url: 'https://api.day.app/key', axios, logger });
    assert.equal(channel.enabled, true);
    assert.equal(await channel.send({ title: 'T', comment: 'hi', icon: 'ico', link: 'https://go' }), true);
    assert.equal(axios.calls.length, 1);
    assert.equal(axios.calls[0].url, 'https://api.day.app/key');
    assert.deepEqual(axios.calls[0].payload, { title: 'T', body: 'hi', icon: 'ico', url: 'https://go' });
});

test('NtfyChannel POST JSON publish 到 server 根，icon 僅 JPEG/PNG，url 對應 click', async () => {
    const axios = fakeAxios();
    const channel = new NtfyChannel({ url: 'https://ntfy.sh/mytopic', axios, logger });
    assert.equal(await channel.send({ title: '標題', comment: '內容', icon: 'https://x/a.webp', link: 'https://go' }), true);
    assert.equal(axios.calls[0].url, 'https://ntfy.sh/');
    assert.deepEqual(axios.calls[0].payload, { topic: 'mytopic', title: '標題', message: '內容', click: 'https://go' });

    const axios2 = fakeAxios();
    const channel2 = new NtfyChannel({ url: 'https://ntfy.sh/mytopic', axios: axios2, logger });
    await channel2.send({ title: 'T', comment: 'c', icon: 'https://x/a.png' });
    assert.equal(axios2.calls[0].payload.icon, 'https://x/a.png');
});

test('Notifier 扇出到所有已啟用通道；單一通道失敗不影響其他', async () => {
    const barkAxios = fakeAxios();
    const boom = { post: async () => { throw new Error('net down'); } };
    const notifier = new Notifier([
        new BarkChannel({ url: 'https://api.day.app/key', axios: barkAxios, logger }),
        new NtfyChannel({ url: 'https://ntfy.sh/topic', axios: boom, logger })
    ]);
    assert.deepEqual(notifier.enabled, ['bark', 'ntfy']);
    await notifier.notify('T', 'hello');
    assert.equal(barkAxios.calls.length, 1);
});

test('createNotifier 依旗標與設定建立，未設定 URL 或關閉的通道不加入', async () => {
    const axios = fakeAxios();
    assert.deepEqual(createNotifier({ isBark: false, isNtfy: false, axios }).enabled, []);
    assert.deepEqual(createNotifier({ isBark: true, barkApi: 'https://b', axios }).enabled, ['bark']);
    assert.deepEqual(createNotifier({ isBark: true, barkApi: 'none', axios }).enabled, []);
    assert.deepEqual(createNotifier({ isNtfy: true, ntfyApi: 'https://ntfy.sh/t', axios }).enabled, ['ntfy']);
    assert.deepEqual(createNotifier({ isBark: true, isNtfy: true, barkApi: 'https://b', ntfyApi: 'https://ntfy.sh/t', axios }).enabled, ['bark', 'ntfy']);
});
