import test from 'node:test';
import assert from 'node:assert/strict';
import { createGiftNameStore } from '../ScriptLib/gift/names.mjs';

const logger = { log() {}, error() {} };

function fakeFs(initial = {}) {
    const files = { ...initial };
    const writes = [];
    return {
        files,
        writes,
        async readFile(path) {
            if (!(path in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            return files[path];
        },
        async writeFile(path, data) {
            files[path] = data;
            writes.push({ path, data });
        }
    };
}

function fakeAxios(map = {}) {
    return {
        async get(url, { params }) {
            const q = params.q;
            const translated = map[q] ?? `譯_${q}`;
            return { data: { responseData: { translatedText: translated } } };
        }
    };
}

function makeStore({ fs = fakeFs(), axios = fakeAxios(), prefillLimit = 10 } = {}) {
    return {
        fs, axios,
        store: createGiftNameStore({
            fs, axios,
            translateApiUrl: 'https://translate.test',
            sourceLang: 'en', targetLang: 'zh-TW',
            prefillLimit,
            giftMapFile: 'gift_map.json',
            giftMapExampleFile: 'gift_map.example.json',
            giftListFile: 'gift_list.json',
            logger
        })
    };
}

test('載入既有 gift_map.json，已知禮物直接回傳翻譯', async () => {
    const { store } = makeStore({ fs: fakeFs({ 'gift_map.json': JSON.stringify({ Rose: '玫瑰' }) }) });
    await store.ready;
    assert.equal(store.getTranslatedGiftNameFromMap('Rose'), '玫瑰');
});

test('gift_map.json 不存在時由 example 初始化並存檔', async () => {
    const { fs, store } = makeStore({ fs: fakeFs({ 'gift_map.example.json': JSON.stringify({ Rose: '玫瑰' }) }) });
    await store.ready;
    assert.equal(store.getTranslatedGiftNameFromMap('Rose'), '玫瑰');
    assert.ok(fs.writes.some(w => w.path === 'gift_map.json'));
});

test('未知禮物先登記為空並存檔，ensure 會呼叫 API 翻譯後寫回', async () => {
    const { fs, store } = makeStore({ fs: fakeFs({ 'gift_map.json': JSON.stringify({}) }), axios: fakeAxios({ Lion: '獅子' }) });
    await store.ready;
    assert.equal(store.getTranslatedGiftNameFromMap('Lion'), '');
    assert.ok(fs.writes.some(w => w.path === 'gift_map.json'));

    const translated = await store.ensureGiftNameTranslation('Lion');
    assert.equal(translated, '獅子');
    assert.equal(store.getTranslatedGiftNameFromMap('Lion'), '獅子');
});

test('syncGiftMapFromGiftList 加入新名稱；backfill 受 prefillLimit 限制', async () => {
    const { store } = makeStore({ fs: fakeFs({ 'gift_map.json': JSON.stringify({}) }), prefillLimit: 2 });
    await store.ready;

    await store.syncGiftMapFromGiftList([{ name: 'A' }, { name: 'B' }, { name: 'A' }]);
    assert.equal(store.getTranslatedGiftNameFromMap('A'), '');

    await store.backfillGiftTranslationsFromGiftList([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
    assert.equal(store.getTranslatedGiftNameFromMap('A'), '譯_A');
    assert.equal(store.getTranslatedGiftNameFromMap('B'), '譯_B');
    // C 被 prefillLimit 擋下，仍未翻譯
    assert.equal(store.getTranslatedGiftNameFromMap('C'), '');
});

test('saveGiftCatalog 以目前對照表補上 translatedName', async () => {
    const { fs, store } = makeStore({ fs: fakeFs({ 'gift_map.json': JSON.stringify({ Rose: '玫瑰' }) }) });
    await store.ready;
    await store.saveGiftCatalog([{ id: 1, name: 'Rose', diamond_count: 5 }]);
    const written = JSON.parse(fs.files['gift_list.json']);
    assert.deepEqual(written, [{ id: 1, name: 'Rose', diamond_count: 5, translatedName: '玫瑰' }]);
});
