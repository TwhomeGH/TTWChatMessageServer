/** /diagnostics 頁面冒煙測試：LogServer 日誌、logio 卡片與無 page error。 */
/* global document, getComputedStyle, window -- 僅在瀏覽器回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { serveWebAsset } = require('../WebAssets.cjs');
const { browserPath } = require('./browser_path.cjs');

async function main() {
    const pageHtml = fs.readFileSync(path.join(__dirname, '../diagnostics.html'));
    const socketPosts = [];
    const diagnosticRequests = [];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/diagnostics') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(pageHtml);
            return;
        }
        if (url.pathname === '/api/diagnostics/socket') {
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    const data = JSON.parse(body);
                    socketPosts.push(data);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        ok: true, enabled: data.enabled, host: '192.168.0.242', port: 9322,
                        state: data.enabled ? 'connecting' : 'off', subscribed: false,
                        defaults: { host: '192.168.0.242', port: 9322, configured: true }
                    }));
                });
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ok: true, enabled: false, host: '', port: 9322, state: 'off', subscribed: false,
                defaults: { host: '192.168.0.242', port: 9322 }
            }));
            return;
        }
        if (url.pathname === '/api/diagnostics') {
            diagnosticRequests.push(url.toString());
            if (url.searchParams.get('q') === 'target' && url.searchParams.get('context') === '1') {
                const targetLogs = [
                    {
                        time: '2026-11-10 20:00:02', title: 'Capture',
                        body: '[Capture] after target', category: 'Capture', severity: 'info',
                        session: 'abc12345', fields: {}, receivedAt: Date.now(), matched: false
                    },
                    {
                        time: '2026-11-10 20:00:01', title: 'Capture',
                        body: '[Capture] target marker', category: 'Capture', severity: 'info',
                        session: 'abc12345', fields: {}, receivedAt: Date.now() - 1000, matched: true
                    },
                    {
                        time: '2026-11-10 20:00:00', title: 'Capture',
                        body: '[Capture] before target', category: 'Capture', severity: 'info',
                        session: 'abc12345', fields: {}, receivedAt: Date.now() - 2000, matched: false
                    }
                ];
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    ok: true,
                    logs: targetLogs,
                    total: 1,
                    matched: 1,
                    context: 2,
                    hasMore: false,
                    summary: {
                        total: 3, range: '2026-11-10 20:00:00 ～ 2026-11-10 20:00:02',
                        categories: [{ name: 'Capture', count: 3 }], sessions: ['abc12345'],
                        warn: 0, error: 0, info: 3
                    },
                    diagnostics: [],
                    recentDiagnostics: [],
                    stats: { bufferedLogs: 3, bufferedDiagnostics: 0 },
                    lastReceived: Date.now()
                }));
                return;
            }
            const logs = [
                {
                    time: '2026-11-10 20:00:01', title: 'ReplyKit',
                    body: '[Capture] capture started session=abc12345 fps=60',
                    category: 'Capture', severity: 'info', session: 'abc12345',
                    fields: { session: 'abc12345', fps: '60' }, receivedAt: Date.now()
                },
                {
                    time: '2026-11-10 20:00:00', title: 'ReplyKit',
                    body: '[Capture] older line failed=0',
                    category: 'Capture', severity: 'info', session: null,
                    fields: { failed: '0' }, receivedAt: Date.now() - 1000
                }
            ];
            if (url.searchParams.get('order') === 'asc') logs.reverse();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ok: true,
                logs,
                total: 2,
                hasMore: false,
                summary: {
                    total: 2, range: '2026-11-10 20:00:00 ～ 2026-11-10 20:00:01',
                    categories: [{ name: 'Capture', count: 2 }], sessions: ['abc12345'],
                    warn: 0, error: 0, info: 2
                },
                diagnostics: [{ subsystem: 'logio', source: 'extension', count: 3, lastError: 'disk full', receivedAt: Date.now() }],
                recentDiagnostics: [{ subsystem: 'logio', source: 'extension', count: 3, lastError: 'disk full', receivedAt: Date.now() }],
                stats: { bufferedLogs: 1, bufferedDiagnostics: 1 },
                lastReceived: Date.now()
            }));
            return;
        }
        if (serveWebAsset(req, res)) return;
        res.writeHead(404);
        res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        browser = await puppeteer.launch({ executablePath: browserPath(), headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/diagnostics`, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => document.querySelectorAll('#diagLogs .log-row').length === 2);
        const result = await page.evaluate(() => ({
            title: document.querySelector('h1').textContent,
            logs: [...document.querySelectorAll('#diagLogs .log-row')].map(node => node.textContent),
            diagnostic: document.querySelector('#diagCards').textContent,
            summary: document.querySelector('#diagSummary').textContent,
            categories: [...document.querySelectorAll('#diagCategories .log-cat')].map(node => node.textContent),
            loginHidden: document.querySelector('#diagCallout').hidden,
            autoScroll: document.querySelector('#diagAutoScroll').checked,
            atTop: document.querySelector('#diagLogScroll').scrollTop < 4,
            fields: document.querySelector('#diagLogs .log-fields summary')?.textContent || ''
        }));
        assert.match(result.title, /應用診斷/);
        assert.match(result.logs[0], /capture started/);
        assert.match(result.logs[1], /older line/);
        assert.match(result.summary, /2/);
        assert.match(result.summary, /Session1/);
        assert.deepEqual(result.categories, ['全部2', 'Capture2']);
        assert.match(result.fields, /欄位/);
        assert.equal(result.autoScroll, true);
        assert.equal(result.atTop, true);
        assert.match(result.diagnostic, /logio/);
        assert.equal(result.loginHidden, true);

        const geometry = await page.evaluate(() => {
            const box = selector => document.querySelector(selector).getBoundingClientRect();
            return {
                topCard: box('.diag-top .log-card').left,
                layout: box('.diag-layout').left,
                sidebar: box('.log-aside').left,
                summary: box('#diagSummary .log-card').left
            };
        });
        assert.ok(Math.abs(geometry.topCard - geometry.layout) <= 1, '分類面板應與上方卡片對齊');
        assert.ok(geometry.summary > geometry.sidebar + 8, '主內容應與分類面板保持間距');
        const controlSize = await page.evaluate(() => {
            const box = selector => {
                const rect = document.querySelector(selector).getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            };
            return {
                checkbox: box('#diagAuto'),
                button: box('#diagRefresh')
            };
        });
        assert.ok(controlSize.checkbox.width <= 24 && controlSize.checkbox.height <= 24, 'checkbox 不應被套成輸入框尺寸');
        assert.ok(controlSize.button.height >= 30, '工具列按鈕應維持可點擊高度');

        await page.setViewport({ width: 640, height: 900 });
        await page.waitForFunction(() => document.querySelectorAll('#diagLogs .log-row').length === 2);
        const narrow = await page.evaluate(() => ({
            rowDisplay: getComputedStyle(document.querySelector('#diagLogs .log-row')).display,
            categoriesDisplay: getComputedStyle(document.querySelector('#diagCategories')).display,
            summaryColumns: getComputedStyle(document.querySelector('#diagSummary')).gridTemplateColumns.split(' ').length,
            messageMaxHeight: getComputedStyle(document.querySelector('#diagLogs .log-message')).maxHeight,
            bodyOverflow: document.body.scrollWidth - window.innerWidth
        }));
        assert.equal(narrow.rowDisplay, 'block', '窄螢幕日誌列應改成卡片式');
        assert.equal(narrow.categoriesDisplay, 'flex', '窄螢幕分類應改成橫向 chips');
        assert.equal(narrow.summaryColumns, 2, '窄螢幕摘要應維持兩欄');
        assert.equal(narrow.messageMaxHeight, '160px', '長內容應限制高度並可捲動');
        assert.ok(narrow.bodyOverflow <= 1, '窄螢幕不應出現水平溢出');

        await page.setViewport({ width: 1024, height: 768 });
        await page.waitForFunction(() => document.querySelectorAll('#diagLogs .log-row').length === 2);
        const tablet = await page.evaluate(() => {
            const wrap = document.querySelector('#diagLogScroll').getBoundingClientRect();
            const row = document.querySelector('#diagLogs .log-row').getBoundingClientRect();
            return {
                bodyOverflowY: getComputedStyle(document.body).overflowY,
                rowDisplay: getComputedStyle(document.querySelector('#diagLogs .log-row')).display,
                categoriesDisplay: getComputedStyle(document.querySelector('#diagCategories')).display,
                wrapHeight: wrap.height,
                rowVisible: row.top < wrap.bottom && row.bottom > wrap.top,
                horizontalOverflow: document.body.scrollWidth - window.innerWidth
            };
        });
        assert.equal(tablet.bodyOverflowY, 'auto', '平板應允許整頁捲動');
        assert.equal(tablet.rowDisplay, 'block', '平板日誌列應改成卡片式');
        assert.equal(tablet.categoriesDisplay, 'flex', '平板分類應改成橫向 chips');
        assert.ok(tablet.wrapHeight > 100, '平板表格應保留可讀高度');
        assert.equal(tablet.rowVisible, true, '平板應能看到日誌列，而不只是表頭');
        assert.ok(tablet.horizontalOverflow <= 1, '平板不應出現水平溢出');

        await page.select('#diagOrder', 'asc');
        await page.waitForFunction(() => document.querySelector('#diagLogs .log-row .log-message')?.textContent.includes('older line'));
        assert.ok(diagnosticRequests.some(url => new URL(url, 'http://x').searchParams.get('order') === 'asc'));
        await page.select('#diagOrder', 'desc');
        await page.waitForFunction(() => document.querySelector('#diagLogs .log-row .log-message')?.textContent.includes('capture started'));

        await page.select('#diagRange', '60');
        await page.waitForFunction(() => {
            const text = document.querySelector('#diagStatus').textContent;
            return text.includes('收到範圍') && !text.includes('全部收到時間');
        });
        assert.ok(diagnosticRequests.some(url => {
            const query = new URL(url, 'http://x').searchParams;
            return query.get('order') === 'desc' && Number(query.get('from')) > 0;
        }));
        await page.select('#diagRange', 'custom');
        assert.equal(await page.$eval('#diagCustomRange', node => node.hidden), false);

        await page.select('#diagRange', 'all');
        await page.waitForFunction(() => document.querySelector('#diagStatus').textContent.includes('全部收到時間'));
        await page.select('#diagContext', '1');
        await page.type('#diagSearch', 'target');
        await page.waitForFunction(() => document.querySelectorAll('#diagLogs .log-row').length === 3);
        const matched = await page.evaluate(() => ({
            highlights: [...document.querySelectorAll('#diagLogs .diag-highlight')].map(node => node.textContent),
            contextRows: document.querySelectorAll('#diagLogs .log-row.is-context').length,
            status: document.querySelector('#diagStatus').textContent
        }));
        assert.deepEqual(matched.highlights, ['target', 'target', 'target']);
        assert.equal(matched.contextRows, 2);
        assert.match(matched.status, /上下文 2 筆/);
        await page.waitForFunction(() => document.querySelector('#diagSocketStatus').textContent.length > 0);
        assert.match(await page.$eval('#diagSocketStatus', node => node.textContent), /未啟用/);
        await page.click('#diagSocketEnabled');
        await new Promise(resolve => setTimeout(resolve, 2300));
        assert.equal(await page.$eval('#diagSocketEnabled', node => node.checked), true);
        await page.click('#diagSocketApply');
        await page.waitForFunction(() => document.querySelector('#diagSocketStatus').textContent.includes('連線中'));
        assert.deepEqual(socketPosts[0], { enabled: true });
        assert.deepEqual(errors, []);
        console.log('Diagnostics UI passed: log stream, logio card, and no page errors.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
