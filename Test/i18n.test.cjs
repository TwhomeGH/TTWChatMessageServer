const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { translate, normalizeManifest } = require('../assets/i18n.js');
const zh = require('../lang/zh-TW.json');
const en = require('../lang/en.json');
const manifest = require('../lang/index.json');

// 空白或遺漏英文都應顯示中文，缺少中文才使用頁面原文。
test('translation falls back through Chinese, default text and key', () => {
    for (const value of [undefined, '', '  ', null, 12]) {
        assert.equal(translate({ greeting: value }, { greeting: '你好' }, 'greeting'), '你好');
    }
    assert.equal(translate({ greeting: 'Hello' }, { greeting: '你好' }, 'greeting'), 'Hello');
    assert.equal(translate({}, {}, 'missing', {}, '原文'), '原文');
    assert.equal(translate({}, {}, 'missing'), 'missing');
    assert.equal(translate({}, {}, 'toString'), 'toString');
});

// 插值只替換已提供參數，不把參數內容當 HTML 或二次樣板。
test('interpolation preserves raw parameters and missing placeholders', () => {
    assert.equal(translate({ x: '{name}: {seconds} {missing}' }, {}, 'x',
        { name: '<img> $& {seconds}', seconds: 0 }), '<img> $& {seconds}: 0 {missing}');
});

// 英文允許分階段補齊，但已提供的翻譯必須使用相同參數。
test('locale tables use supported keys and compatible placeholders', () => {
    assert.deepEqual(normalizeManifest(manifest), manifest);
    const tokens = text => [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]).sort();
    for (const [key, value] of Object.entries(zh)) assert.ok(typeof value === 'string' && value.trim(), key);
    for (const { code } of manifest.languages) for (const [key, value] of Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, '../lang', code + '.json'))))) {
        assert.ok(Object.hasOwn(zh, key), key);
        if (typeof value === 'string' && value.trim()) assert.deepEqual(tokens(value), tokens(zh[key]), key);
    }
    for (const file of ['runtime.html', 'OtherTool/browser/index.html', 'log.html']) {
        const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(Object.hasOwn(zh, match[1]), match[1]);
        for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], { filename: file });
    }
});

// 模擬載入失敗、禁止儲存及快速切換，確認最後一次選擇勝出且文字安全更新。
test('browser language switching handles storage errors, races and failed dictionaries', async () => {
    const element = { dataset: { i18n: 'common.language' }, textContent: '語言' };
    const select = { value: '', addEventListener() {}, replaceChildren(...options) { this.options = options; } };
    const pending = [];
    let fail = false;
    const document = {
        documentElement: {},
        createElement: () => ({}),
        querySelectorAll: selector => selector === '[data-i18n]' ? [element] : [select],
        dispatchEvent() {}
    };
    const context = vm.createContext({ document, AbortSignal, CustomEvent: class {},
        localStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } },
        fetch: url => url.endsWith('/index.json') ? Promise.resolve({ ok: true, json: async () => ({ ...manifest, languages: [...manifest.languages, { code: 'ja', label: '日本語' }] }) }) : new Promise(resolve => pending.push(() => resolve({ ok: !fail, json: async () => url.includes('zh-TW') ? zh : url.includes('/ja.') ? { 'common.language': '言語' } : en }))),
        window: { addEventListener() {} } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/i18n.js'), 'utf8'), context);
    const api = context.window.TTWI18n;
    await new Promise(resolve => setImmediate(resolve));
    pending.splice(0).forEach(resolve => resolve()); await api.ready;
    assert.equal(select.options.map(option => option.value).join(), "zh-TW,en,ja");
    assert.equal(element.textContent, '語言');
    const english = api.setLanguage('en');
    const chinese = api.setLanguage('zh-TW');
    pending.splice(0).reverse().forEach(resolve => resolve());
    await Promise.all([english, chinese]);
    assert.equal(api.language, 'zh-TW');
    const switched = api.setLanguage('en');
    pending.splice(0).forEach(resolve => resolve()); await switched;
    assert.equal(element.textContent, 'Language');
    assert.equal(document.documentElement.lang, 'en');
    const japanese = api.setLanguage('ja');
    pending.splice(0).forEach(resolve => resolve()); await japanese;
    assert.equal(element.textContent, '言語');
    assert.equal(api.t('runtime.title'), zh['runtime.title']);
    fail = true;
    const failed = api.setLanguage('en');
    pending.splice(0).forEach(resolve => resolve()); await failed;
    assert.equal(element.textContent, '語言');
    const unsupported = api.setLanguage('../../secret');
    pending.splice(0).forEach(resolve => resolve()); await unsupported;
    assert.equal(api.language, 'zh-TW');
});

// 無效或重複代碼不能成為檔案路徑；未登記的預設語言回退中文。
test('manifest rejects invalid paths, duplicate locales and blank labels', () => {
    const result = normalizeManifest({ default: 'fr', languages: [
        { code: '../en', label: 'bad' }, { code: 'index', label: 'bad' },
        { code: 'en', label: 'English' }, { code: 'EN', label: 'duplicate' },
        { code: 'fr', label: ' ' }, { code: 'ja', label: '日本語' }
    ] });
    assert.deepEqual(result.languages.map(entry => entry.code), ['zh-TW', 'en', 'ja']);
    assert.equal(result.default, 'zh-TW');
    assert.equal(normalizeManifest({ default: 'en', languages: [{ code: 'en', label: 'English' }] }).default, 'en');
    assert.deepEqual(normalizeManifest(null).languages, [{ code: 'zh-TW', label: '繁體中文' }]);
});
