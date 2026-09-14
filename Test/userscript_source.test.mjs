import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function contextFor(file, start, end) {
    const source = fs.readFileSync(new URL('../UserScript/' + file, import.meta.url), 'utf8');
    const sent = [];
    const ctx = vm.createContext({ HTTP_HOST: 'localhost', HTTP_PORT: 3332, FailCount: 0, MaxFail: 5,
        sentIds: new Set(), sentNodes: new WeakSet(), console: { log() {}, error() {} },
        GM_xmlhttpRequest: request => sent.push(JSON.parse(request.data)) });
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    vm.runInContext(source.slice(a, b), ctx);
    return { ctx, sent };
}
test('TikTok and Live Center bridges preserve real metadata and identify their pipe', () => {
    for (const [file, end] of [['TikTokChat.user.js', '// 監控 DOM 新增元素'], ['liveCenter.user.js', '    /**********************\n     * 💬']]) {
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
