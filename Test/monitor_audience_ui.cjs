/** 監控頁常客標記冒煙檢查：node Test/monitor_audience_ui.cjs；使用假 SSE。 */
/* global document -- 僅在瀏覽器 waitForFunction 回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { serveWebAsset } = require('../WebAssets.cjs');
const { browserPath } = require('./browser_path.cjs');

async function main() {
    const { default: puppeteer } = await import('puppeteer-core');
    const server = http.createServer((req, res) => {
        if (req.url === '/status/stream/messages') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
            });
            res.write('data: ' + JSON.stringify({
                t: Date.now(), category: 'chat', platform: 'tiktok', user: 'Alice', message: 'hello',
                audience: {
                    level: 3, score: 70, labels: ['alwaysHere', 'giftRegular'],
                    sessions: 12, streak: 6, messages: 40, gifts: 4, tenureDays: 60
                }
            }) + '\n\n');
            return;
        }
        if (req.url === '/api/message-categories') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ categories: ['chat', 'gift'] }));
            return;
        }
        if (req.url === '/monitor') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(path.join(__dirname, '../monitor.html'), 'utf8'));
            return;
        }
        if (serveWebAsset(req, res)) return;
        res.writeHead(404);
        res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: browserPath(), headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/monitor`);
        await page.waitForFunction(() => document.querySelectorAll('.mon-tag').length === 2);
        const tags = await page.$$eval('.mon-tag', nodes => nodes.map(node => node.textContent));
        assert.deepEqual(tags, ['每次都來', '送禮常客']);
        assert.equal(await page.$eval('.mon-tags', node => node.title.includes('12')), true);
        assert.deepEqual(errors, []);
        console.log('Monitor audience badges passed: labels and tooltip rendered from SSE payload.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
