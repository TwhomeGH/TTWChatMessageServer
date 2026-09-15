const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { EmojiStore } = require('../EmojiStore.cjs');

/** 建立獨立映射檔，測試完成後清除；不改動正式 emoji_map.json。 */
async function createFixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ttw-emoji-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));

    const file = path.join(directory, 'emoji.json');
    await fs.writeFile(file, JSON.stringify({
        '[laughcry]': 'https://example.com/a.png'
    }));
    const store = new EmojiStore(file);
    await store.load();
    return { store, file };
}

/** 模擬路由請求與 JSON 回應，無須啟動 HTTP 服務或使用真實登入資訊。 */
function requestMapping(method, authorized, body) {
    const { serveEmoji } = require('../EmojiRoutes.cjs');
    return new Promise((resolve, reject) => {
        const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
        const req = Readable.from(chunks);
        req.url = '/api/emoji';
        req.method = method;
        req.headers = { 'content-type': 'application/json' };

        const res = {
            writeHead(status) {
                this.status = status;
            },
            end(responseBody) {
                try {
                    resolve({ status: this.status, data: JSON.parse(responseBody) });
                } catch (error) {
                    reject(error);
                }
            }
        };
        serveEmoji(req, res, authorized);
    });
}

test('新增、改名與刪除會持久化，拒絕舊版本及名稱衝突', async t => {
    const { store, file } = await createFixture(t);
    const originalRevision = store.snapshot().revision;

    await store.change({
        operation: 'save', code: 'new',
        url: 'https://example.com/new.png', revision: originalRevision
    });

    // 模擬另一個尚未更新的分頁，以及改名時覆蓋既有代碼。
    await assert.rejects(store.change({
        operation: 'delete', code: 'new', revision: originalRevision
    }), /重新載入/);
    await assert.rejects(store.change({
        operation: 'save', originalCode: '[laughcry]', code: 'new',
        url: 'https://example.com/a.png', revision: store.snapshot().revision
    }), /已存在/);

    await store.change({
        operation: 'save', originalCode: 'new', code: 'renamed',
        url: 'https://example.com/r.png', revision: store.snapshot().revision
    });
    await store.change({
        operation: 'delete', code: '[laughcry]', revision: store.snapshot().revision
    });

    // 檢查實際檔案，避免只驗證記憶體更新就誤判儲存成功。
    assert.deepEqual(JSON.parse(await fs.readFile(file)), {
        renamed: 'https://example.com/r.png'
    });
});

test('損壞檔案保留最後有效映射，修正後恢復並持續驗證網址', async t => {
    const { store, file } = await createFixture(t);

    await fs.writeFile(file, '{');
    await assert.rejects(store.load());
    assert.ok(store.snapshot().map['[laughcry]']);

    // 先失敗再恢復，確認操作佇列不會因上一次拒絕而永久卡住。
    await fs.writeFile(file, JSON.stringify({ fixed: 'https://example.com/f.png' }));
    await store.load();
    assert.equal(store.snapshot().error, null);
    assert.ok(store.snapshot().map.fixed);

    await assert.rejects(store.change({
        operation: 'save', code: 'x', url: 'javascript:alert(1)',
        revision: store.snapshot().revision
    }), /HTTP/);
});

test('監看會套用外部修改，不需要重新啟動 store', async t => {
    const { store, file } = await createFixture(t);
    const stopWatching = store.watch();
    t.after(stopWatching);

    await fs.writeFile(file, JSON.stringify({ hot: 'https://example.com/hot.png' }));

    // 以有期限的輪詢等待每秒監看，容許排程延遲，避免固定睡眠造成偶發失敗。
    const deadline = Date.now() + 4000;
    while (!store.snapshot().map.hot && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(store.snapshot().map.hot);
});

test('方括號按字面匹配，插入網址中的代碼與替換符號不會再次展開', async t => {
    const { file } = await createFixture(t);
    // long 同時出現在插入網址和代碼表；$& 用來偵測字串替換的特殊展開。
    await fs.writeFile(file, JSON.stringify({
        '[x]': 'https://example.com/$&/long.png',
        long: 'https://example.com/other.png'
    }));
    const emojiMap = await import('../EmojiMap.js');
    await emojiMap.loadEmojiMap(file);

    assert.equal(emojiMap.replaceEmojis('[x]'), 'https://example.com/$&/long.png');
});

test('管理 API 檢查登入、持久化修改，並回報版本衝突', async t => {
    const { file } = await createFixture(t);
    const { store } = require('../EmojiStore.cjs');
    // 路由使用共用 store，暫時指向隔離檔案，結束時還原原本狀態。
    const original = {
        file: store.file, map: store.map, loaded: store.loaded, error: store.error
    };
    store.file = file;
    t.after(() => Object.assign(store, original));

    assert.equal((await requestMapping('GET', false)).status, 401);
    const current = await requestMapping('GET', true);
    assert.equal(current.status, 200);

    const saved = await requestMapping('POST', true, {
        operation: 'save', code: '[api]', url: 'https://example.com/api.png',
        revision: current.data.revision
    });
    assert.equal(saved.status, 200);

    const stale = await requestMapping('POST', true, {
        operation: 'delete', code: '[api]', revision: current.data.revision
    });
    assert.equal(stale.status, 409);
    assert.ok(JSON.parse(await fs.readFile(file))['[api]']);
});
