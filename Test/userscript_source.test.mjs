import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/** 擷取兩個函數邊界間的程式；可注入不同換行來源來驗證跨平台行為。 */
function contextFor(file, start, end, source = fs.readFileSync(new URL('../UserScript/' + file, import.meta.url), 'utf8')) {
    const sent = [];
    const ctx = vm.createContext({ HTTP_HOST: 'localhost', HTTP_PORT: 3332, FailCount: 0, MaxFail: 5,
        sentIds: new Set(), sentNodes: new WeakSet(), console: { log() {}, error() {} },
        // 目標直播間鎖定與轉送提示是 sendSocketMessage 的外掛依賴，這裡 stub 掉以驗證 payload 本身。
        canSend: () => true, logBlocked() {}, flashSent() {}, sentKind: () => '聊天',
        GM_xmlhttpRequest: request => sent.push(JSON.parse(request.data)) });
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0, file + ': 找不到起始標記 ' + start);
    assert.ok(b > a, file + ': 找不到結束標記 ' + end);
    vm.runInContext(source.slice(a, b), ctx);
    return { ctx, sent };
}
test('TikTok and Live Center bridges preserve real metadata and identify their pipe', () => {
    for (const [file, end] of [['TikTokChat.user.js', '// 監控 DOM 新增元素'], ['liveCenter.user.js', 'function handleChatMessage(']]) {
        const { ctx, sent } = contextFor(file, 'function sendSocketMessage(', end);
        ctx.sendSocketMessage('user', 'hello', '', '', true, 10, [], { msgId: '123', sentAt: null });
        assert.equal(sent[0].platform, 'TikTok'); assert.equal(sent[0].transport, 'userscript');
        assert.equal(sent[0].msgId, '123'); assert.equal(sent[0].sentAt, null);
        if (file === 'liveCenter.user.js') assert.equal(sent[0].audienceKind, 'top-fans');
    }
});
test('YouTube bridge preserves DOM ID without fabricating a platform timestamp', () => {
    const { ctx } = contextFor('youtube-chat-userscript.user.js', 'function extractMsg(', 'function send(');
    const el = { getAttribute: name => name === 'id' ? 'youtube-id' : null,
        querySelector: selector => selector.startsWith('#message') ? { textContent: 'hello' } :
            selector.startsWith('#author') ? { textContent: 'user' } : null };
    const event = ctx.extractMsg(el);
    assert.equal(event.platform, 'Youtube'); assert.equal(event.transport, 'userscript');
    assert.equal(event.msgId, 'youtube-id'); assert.equal(event.sentAt, null);
    assert.equal(ctx.extractMsg(el), null);
});
test('manual test button explicitly marks synthetic traffic', () => {
    const { ctx, sent } = contextFor('TestCenter.user.js', 'function sendTestMessage()', 'function createTestButton()');
    ctx.sendTestMessage();
    assert.equal(sent[0].isTest, true); assert.equal(sent[0].transport, 'userscript');
});

test('TikTok 轉接只在目標直播間發送（安全預設：沒填目標就不送）', () => {
    const source = fs.readFileSync(new URL('../UserScript/TikTokChat.user.js', import.meta.url), 'utf8');
    const a = source.indexOf('const TARGET_KEY');
    const b = source.indexOf('// 被擋下時只印一次');
    assert.ok(a >= 0 && b > a, '找不到目標直播間鎖定的程式區塊');

    /** 用指定的設定與網址跑一次鎖定邏輯（const 宣告不能重複，所以每次都要新 context）。 */
    const canSend = (saved, pathname) => {
        const ctx = vm.createContext({
            localStorage: { getItem: () => JSON.stringify(saved), setItem() {} },
            location: { pathname },
            console: { log() {}, error() {} }
        });
        vm.runInContext(source.slice(a, b), ctx);
        return ctx.canSend();
    };

    assert.equal(canSend({ enabled: true, handle: 'a0936931' }, '/@a0936931/live'), true);
    assert.equal(canSend({ enabled: true, handle: 'a0936931' }, '/@someoneelse/live'), false);
    assert.equal(canSend({ enabled: true, handle: 'a0936931' }, '/foryou'), false);
    assert.equal(canSend({ enabled: true, handle: '' }, '/@a0936931/live'), false);
    assert.equal(canSend({ enabled: false, handle: 'a0936931' }, '/@a0936931/live'), false);
    // 大小寫不敏感、且 @ 可省略
    assert.equal(canSend({ enabled: true, handle: '@A0936931' }, '/@a0936931/live'), true);
});

test('轉送種類判斷：有禮物圖＝送禮、isMain=false＝加入、其餘聊天', () => {
    const source = fs.readFileSync(new URL('../UserScript/TikTokChat.user.js', import.meta.url), 'utf8');
    const a = source.indexOf('function sentKind(');
    const b = source.indexOf('function flashSent(');
    assert.ok(a >= 0 && b > a, '找不到 sentKind');
    const ctx = vm.createContext({});
    vm.runInContext(source.slice(a, b), ctx);
    assert.equal(ctx.sentKind(true, null), '聊天');
    assert.equal(ctx.sentKind(false, null), '加入');
    assert.equal(ctx.sentKind(true, 'blob:gift'), '送禮');
});

// Windows checkout 可能轉成 CRLF；定位函數不應依賴多行註解或換行格式。
for (const [label, newline] of [['LF', '\n'], ['CRLF', '\r\n']]) {
    test('Live Center 在 ' + label + ' 來源下仍能擷取並轉送訊息', () => {
        const file = 'liveCenter.user.js';
        const original = fs.readFileSync(new URL('../UserScript/' + file, import.meta.url), 'utf8');
        const source = original.replace(/\r?\n/g, newline);
        const { ctx, sent } = contextFor(
            file, 'function sendSocketMessage(', 'function handleChatMessage(', source
        );

        ctx.sendSocketMessage('user', 'hello', '', '', true, 10, [], {
            msgId: '123', sentAt: null
        });
        assert.equal(sent.length, 1);
        assert.equal(sent[0].platform, 'TikTok');
        assert.equal(sent[0].transport, 'userscript');
        assert.equal(sent[0].msgId, '123');
        assert.equal(sent[0].sentAt, null);
        assert.equal(sent[0].audienceKind, 'top-fans');
    });
}
