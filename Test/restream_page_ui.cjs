/** Restream 指標頁 layouts／入口冒煙檢查：node Test/restream_page_ui.cjs。 */
/* global document -- 僅在瀏覽器回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { browserPath } = require('./browser_path.cjs');

async function main() {
    const pageHtml = fs.readFileSync(path.join(__dirname, '../OtherTool/restream/index.html'), 'utf8');
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/restream') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(pageHtml);
            return;
        }
        if (url.pathname === '/restream/metrics') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ok: true,
                shows: [{
                    showId: 'bbd011f7-7d15-4bb4-825e-411e2f0c4d70',
                    sampleCount: 2,
                    latest: {
                        capturedAt: Date.now(),
                        receivedAt: Date.now(),
                        values: {
                            health: 'Fair', resolution: '1920x1080', bitrateKbps: 6225,
                            fps: 59, keyframeSec: 2
                        }
                    }
                }]
            }));
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    let browser;
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        browser = await puppeteer.launch({ executablePath: browserPath(), headless: true });
        const page = await browser.newPage();
        await page.setViewport({ width: 1100, height: 800 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/restream`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 1);

        const data = await page.evaluate(() => {
            const row = document.querySelector('#rows tr');
            const wrap = document.querySelector('.table-wrap');
            const table = document.querySelector('table');
            return {
                title: document.querySelector('h1')?.textContent,
                nav: [...document.querySelectorAll('.top-nav a')].map(link => link.getAttribute('href')),
                showId: row.querySelector('.show-id')?.textContent,
                health: row.querySelector('.badge')?.textContent,
                bitrate: row.querySelectorAll('td')[3]?.textContent,
                samples: row.querySelectorAll('td')[8]?.textContent,
                overflow: table.scrollWidth - wrap.clientWidth
            };
        });
        assert.equal(data.title, 'Restream 指標');
        assert.ok(data.nav.includes('/runtime'));
        assert.equal(data.showId, 'bbd011f7-7d15-4bb4-825e-411e2f0c4d70');
        assert.equal(data.health, 'Fair');
        assert.equal(data.bitrate, '6.2 Mbps');
        assert.equal(data.samples, '2');
        assert.ok(data.overflow <= 1, `table overflows by ${data.overflow}px`);
        assert.deepEqual(errors, []);
        console.log('Restream page passed: nav entry, fixed table, health badge and human-readable bitrate.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
