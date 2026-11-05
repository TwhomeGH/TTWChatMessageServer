/** 表情管理頁與真實 EmojiRoutes／EmojiStore 的整合冒煙檢查。 */
/* global document -- 僅在瀏覽器回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { serveEmoji } = require('../EmojiRoutes.cjs');
const { store } = require('../EmojiStore.cjs');
const { browserPath } = require('./browser_path.cjs');

async function waitForFile(file, predicate) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        try {
            const data = JSON.parse(await fsp.readFile(file, 'utf8'));
            if (predicate(data)) return data;
        } catch { /* 檔案尚未建立或正在替換 */ }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('等待本機覆寫檔逾時：' + file);
}

async function main() {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ttw-emoji-ui-'));
    const defaultsFile = path.join(directory, 'emoji_map.json');
    const localFile = path.join(directory, 'emoji_map_local.json');
    const defaultsText = JSON.stringify({
        '[a]': 'https://example.com/a.png',
        other: 'https://example.com/other.png'
    }, null, 4);
    await fsp.writeFile(defaultsFile, defaultsText);

    const server = http.createServer((req, res) => {
        const pathname = req.url.split('?')[0];
        if (pathname === '/emoji' || pathname === '/api/emoji') {
            serveEmoji(req, res, true);
            return;
        }
        if (pathname === '/assets/emoji.js') {
            res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            res.end(fs.readFileSync(path.join(__dirname, '../assets/emoji.js')));
            return;
        }
        if (pathname === '/assets/app.css') {
            res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
            res.end('');
            return;
        }
        // 圖片預覽不是這項測試的重點，避免測試寫入正式 cache 或連外。
        if (pathname === '/emoji/image') {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    // 暫時把共用 store 指向 temp 雙檔；測試結束後還原。
    const original = {
        file: store.file, localFile: store.localFile, defaults: store.defaults, local: store.local,
        map: store.map, entries: store.entries, loaded: store.loaded, error: store.error,
        pending: store.pending
    };
    Object.assign(store, {
        file: defaultsFile, localFile, defaults: {}, local: { version: 1, emojis: {} },
        map: {}, entries: [], loaded: false, error: null, pending: Promise.resolve()
    });

    let browser;
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        browser = await puppeteer.launch({ executablePath: browserPath(), headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());

        await page.goto(base + '/emoji', { waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('#list article').length === 2);

        // 停用預設：真實 API 應只寫本機覆寫，預設檔不變。
        await page.evaluate(() => {
            const card = [...document.querySelectorAll('#list article')].find(item => item.textContent.includes('other'));
            [...card.querySelectorAll('button')].find(button => button.textContent === '停用').click();
        });
        const disabledLocal = await waitForFile(localFile, data => data.emojis?.other?.enabled === false);
        assert.equal(disabledLocal.version, 1);
        assert.equal(await fsp.readFile(defaultsFile, 'utf8'), defaultsText);
        await page.waitForFunction(() => [...document.querySelectorAll('#list article')]
            .some(item => item.textContent.includes('other') && item.textContent.includes('已停用')));

        const reloaded = new (require('../EmojiStore.cjs').EmojiStore)(defaultsFile, localFile);
        await reloaded.load();
        assert.equal(reloaded.snapshot().map.other, undefined);
        assert.equal(reloaded.snapshot().map['[a]'], 'https://example.com/a.png');

        // 恢復預設：移除本機狀態，預設重新啟用。
        await page.evaluate(() => {
            const card = [...document.querySelectorAll('#list article')].find(item => item.textContent.includes('other'));
            [...card.querySelectorAll('button')].find(button => button.textContent === '恢復預設').click();
        });
        const resetLocal = await waitForFile(localFile, data => data.emojis?.other === undefined);
        assert.equal(resetLocal.emojis.other, undefined);
        await page.waitForFunction(() => [...document.querySelectorAll('#list article')]
            .some(item => item.textContent.includes('other') && !item.textContent.includes('已停用')));

        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('#list article').length === 2);
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('#list article')]
            .find(item => item.textContent.includes('other')).textContent.includes('已停用')), false);
        assert.deepEqual(errors, []);
        console.log('Emoji UI passed: real route/UI disable and reset persist local only, with defaults unchanged.');
    } finally {
        Object.assign(store, original);
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        await fsp.rm(directory, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
