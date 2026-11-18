/** 日誌搜尋頁 UI 冒煙檢查：node Test/log_explorer_ui.cjs；使用假 API。 */
/* global document, window -- 僅在瀏覽器回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { serveWebAsset } = require('../WebAssets.cjs');
const { browserPath } = require('./browser_path.cjs');

const rows = [
    { id: 4, at: 4000, level: 'info', category: 'system', source: 'main', session: 's1', message: '啟動完成', fields: null },
    { id: 3, at: 3000, level: 'error', category: 'socket', source: 'main', session: 's1', message: '[ERR] Socket failed', fields: { endpoint: 'tcp://127.0.0.1:9322' } },
    { id: 2, at: 2000, level: 'debug', category: 'autoclip', source: 'child', session: 's2', message: '[OUT] [AutoClip] 觸發剪輯', fields: null },
    { id: 1, at: 1000, level: 'debug', category: 'autoclip', source: 'child', session: 's2', message: '[OUT] [AutoClip] 影子觸發', fields: null }
];
const summary = {
    total: rows.length,
    range: { from: 1000, to: 4000 },
    categories: [
        { name: 'autoclip', count: 2 }, { name: 'socket', count: 1 }, { name: 'system', count: 1 }
    ],
    levels: [
        { name: 'debug', count: 2 }, { name: 'info', count: 1 }, { name: 'error', count: 1 }
    ],
    sessions: ['s1', 's2']
};

function filterRows(url) {
    const category = url.searchParams.get('category') || '';
    const level = url.searchParams.get('level') || '';
    const query = (url.searchParams.get('q') || '').toLowerCase();
    return rows.filter(row =>
        (!category || row.category === category)
        && (!level || row.level === level)
        && (!query || `${row.message} ${row.category} ${row.source}`.toLowerCase().includes(query))
    );
}

async function main() {
    const { default: puppeteer } = await import('puppeteer-core');
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/logs') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(path.join(__dirname, '../log-explorer.html'), 'utf8'));
            return;
        }
        if (url.pathname === '/api/logs/summary') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, ...summary }));
            return;
        }
        if (url.pathname === '/api/logs') {
            const matched = filterRows(url);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, total: matched.length, rows: matched, hasMore: false, nextBeforeId: null }));
            return;
        }
        if (serveWebAsset(req, res)) return;
        res.writeHead(404); res.end('not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: browserPath(), headless: true });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/logs`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelectorAll('#logRows tr').length === 4);
        assert.match(await page.$eval('#logMeta', el => el.textContent), /共 4 筆/);
        assert.equal(await page.$$eval('.log-cat', nodes => nodes.length), 4);
        assert.match(await page.$eval('#logRows', el => el.textContent), /Socket failed/);

        await page.evaluate(() => {
            [...document.querySelectorAll('.log-cat')].find(node => node.textContent.startsWith('autoclip')).click();
        });
        await page.waitForFunction(() => document.querySelectorAll('#logRows tr').length === 2);
        assert.match(await page.$eval('#logStatus', el => el.textContent), /分類 autoclip/);

        await page.select('#logLevel', 'error');
        await page.evaluate(() => {
            [...document.querySelectorAll('.log-cat')].find(node => node.textContent.startsWith('全部')).click();
        });
        await page.waitForFunction(() => document.querySelectorAll('#logRows tr').length === 1);
        assert.match(await page.$eval('#logRows', el => el.textContent), /Socket failed/);
        assert.equal(await page.$eval('.log-fields', details => details.open), false);

        // 超長日誌只能在表格區內捲動；分類與工具列不可以被推出畫面。
        await page.evaluate(() => {
            const row = document.querySelector('#logRows tr');
            const clone = row.cloneNode(true);
            clone.querySelector('.log-message').append(document.createTextNode(' ' + 'x'.repeat(5000)));
            document.querySelector('#logRows').prepend(clone);
        });
        const layout = await page.evaluate(() => {
            const wrap = document.querySelector('.log-table-wrap').getBoundingClientRect();
            const aside = document.querySelector('.log-aside').getBoundingClientRect();
            const toolbar = document.querySelector('.log-toolbar').getBoundingClientRect();
            const scroll = document.querySelector('.log-table-wrap');
            return {
                wrapBottom: wrap.bottom,
                asideTop: aside.top,
                asideBottom: aside.bottom,
                toolbarTop: toolbar.top,
                viewport: window.innerHeight,
                innerScroll: scroll.scrollHeight > scroll.clientHeight
            };
        });
        assert.ok(layout.innerScroll, '長日誌應在表格區內捲動');
        assert.ok(layout.asideTop >= 0 && layout.asideBottom <= layout.viewport + 1, '分類不可被推出畫面');
        assert.ok(layout.toolbarTop >= 0, '查詢工具列不可被推出畫面');
        assert.ok(layout.wrapBottom <= layout.viewport + 1, '表格區不可超出視窗');
        assert.deepEqual(errors, []);
        console.log('Log explorer UI passed: summary cards, category/severity filters and fields.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exit(1); });
