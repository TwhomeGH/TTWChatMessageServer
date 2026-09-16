const test = require('node:test');
const assert = require('node:assert/strict');
const { serveWebAsset, createWebAssetHandler } = require('../WebAssets.cjs');

function request(url, method='GET', handler=serveWebAsset) {
    return new Promise(resolve => {
        const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){resolve({...this,body});}};
        if(!handler({url,method},response))resolve(null);
    });
}
test('CSS asset is available with proper type and contains built utilities', async()=>{
    const res=await request('/assets/app.css?v=test');
    assert.equal(res.status,200);
    assert.match(res.headers['Content-Type'],/^text\/css/);
    assert.ok(res.body.toString().includes('.hidden'));
    assert.ok(res.body.toString().includes('.config-page'));
    assert.equal((await request('/assets/app.css','HEAD')).body,undefined);
});
test('only the explicit stylesheet is exposed',async()=>{
    assert.equal(await request('/assets/../.env'),null);
    assert.equal(await request('/assets/other.css'),null);
    assert.equal((await request('/assets/app.css','POST')).status,405);
});

// 語系只開放白名單檔案，不能用 locale 路徑讀取其他設定。
test('locale dictionaries and helper support GET/HEAD without exposing other files', async () => {
    for (const locale of ['zh-TW', 'en']) {
        const res = await request('/lang/' + locale + '.json');
        assert.equal(res.status, 200);
        assert.match(res.headers['Content-Type'], /application\/json/);
        assert.equal(typeof JSON.parse(res.body)['common.language'], 'string');
        assert.equal((await request('/lang/' + locale + '.json', 'HEAD')).body, undefined);
    }
    assert.match((await request('/assets/i18n.js')).headers['Content-Type'], /javascript/);
    assert.match((await request('/assets/autoclip.js')).headers['Content-Type'], /javascript/);
    assert.match((await request('/assets/emoji.js')).headers['Content-Type'], /javascript/);
    assert.equal(await request('/lang/../package.json'), null);
    assert.equal((await request('/lang/fr.json')).status, 404);
    assert.equal((await request('/lang/en.json', 'POST')).status, 405);
});

// 使用隔離目錄新增語言，不修改正式語系；同一 handler 應立刻讀到新版清單。
test('registering a JSON locale exposes it without a restart, and removing it hides it', async t => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ttw-i18n-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'lang'));
    const index = path.join(root, 'lang/index.json');
    const handler = createWebAssetHandler(root);
    fs.writeFileSync(path.join(root, 'lang/ja.json'), '{"common.language":"言語"}');
    assert.equal((await request('/lang/ja.json', 'GET', handler)).status, 404);
    fs.writeFileSync(index, JSON.stringify({ default: 'ja', languages: [{ code: 'ja', label: '日本語' }] }));
    const manifest = JSON.parse((await request('/lang/index.json', 'GET', handler)).body);
    assert.equal(manifest.default, 'ja');
    assert.equal((await request('/lang/ja.json', 'GET', handler)).status, 200);
    assert.equal((await request('/lang/ja.json', 'HEAD', handler)).body, undefined);
    fs.writeFileSync(index, '{broken');
    assert.equal((await request('/lang/ja.json', 'GET', handler)).status, 404);
    assert.equal(JSON.parse((await request('/lang/index.json', 'GET', handler)).body).default, 'zh-TW');
    assert.equal(await request('/lang/../package.json', 'GET', handler), null);
});
