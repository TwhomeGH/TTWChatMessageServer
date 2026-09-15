const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { readJson } = require('../ScriptLib/emoji/http.cjs');

/** 用串流模擬請求分段，只測解析契約，不啟動 HTTP 服務。 */
function request(chunks, contentType = 'application/json') {
    const req = Readable.from(chunks);
    req.headers = { 'content-type': contentType };
    return req;
}

test('JSON 解析保留跨位元組分段的中文字元', async () => {
    const data = { code: '[笑哭]', message: '中文表情' };
    const bytes = Buffer.from(JSON.stringify(data));
    // 每個 chunk 只有一個位元組，強制切開所有多位元組中文字元。
    const chunks = [...bytes].map(byte => Buffer.from([byte]));
    assert.deepEqual(await readJson(request(chunks)), data);
});

test('JSON 解析拒絕不支援的格式、超量內容及損壞語法', async () => {
    await assert.rejects(readJson(request([], 'text/plain')), { status: 415 });
    await assert.rejects(readJson(request([Buffer.alloc(32769)])), { status: 413 });
    await assert.rejects(readJson(request([Buffer.from('{')])), SyntaxError);
});

test('AutoClip 新舊入口匯出相同類別', async () => {
    const legacy = await import('../AutoClip.js');
    const current = await import('../AutoClipV2.mjs');
    // 比較類別身分，確保相容入口沒有另建一份實作。
    assert.equal(legacy.AutoClipManager, current.AutoClipManager);
});
