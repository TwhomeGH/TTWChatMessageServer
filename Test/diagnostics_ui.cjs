/** /diagnostics 頁面冒煙測試：LogServer 日誌、logio 卡片與無 page error。 */
/* global document -- 僅在瀏覽器回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { serveWebAsset } = require('../WebAssets.cjs');
const { browserPath } = require('./browser_path.cjs');

async function main() {
    const pageHtml = fs.readFileSync(path.join(__dirname, '../diagnostics.html'));
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/diagnostics') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(pageHtml);
            return;
        }
        if (url.pathname === '/api/diagnostics') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ok: true,
                logs: [
                    { time: '2026-11-10 20:00:01', title: 'ReplyKit', body: 'capture started', receivedAt: Date.now() },
                    { time: '2026-11-10 20:00:00', title: 'ReplyKit', body: 'older line', receivedAt: Date.now() - 1000 }
                ],
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
        await page.waitForFunction(() => document.querySelectorAll('#diagLogs .diag-log').length === 2);
        const result = await page.evaluate(() => ({
            title: document.querySelector('h1').textContent,
            logs: [...document.querySelectorAll('#diagLogs .diag-log')].map(node => node.textContent),
            diagnostic: document.querySelector('#diagCards').textContent,
            loginHidden: document.querySelector('#diagCallout').hidden,
            autoScroll: document.querySelector('#diagAutoScroll').checked,
            atBottom: Math.abs(document.querySelector('#diagLogs').scrollHeight - document.querySelector('#diagLogs').clientHeight - document.querySelector('#diagLogs').scrollTop) < 4
        }));
        assert.match(result.title, /應用診斷/);
        assert.match(result.logs[0], /older line/);
        assert.match(result.logs[1], /capture started/);
        assert.equal(result.autoScroll, true);
        assert.equal(result.atBottom, true);
        assert.match(result.diagnostic, /logio/);
        assert.equal(result.loginHidden, true);
        assert.deepEqual(errors, []);
        console.log('Diagnostics UI passed: log stream, logio card, and no page errors.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
