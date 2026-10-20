/** 時段累積提示的 UI 冒煙檢查：node Test/traffic_history_ui.cjs；使用假歷史資料。 */
/* global document -- 僅在瀏覽器 waitForFunction 回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { serveWebAsset } = require('../WebAssets.cjs');
const { browserPath } = require('./browser_path.cjs');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/traffic.css"></head>
<body class="bg-gray-900 text-gray-200"><main class="mx-auto max-w-6xl p-4">
<select id="platform"><option>TikTok</option></select>
<select id="history-days"><option>30</option></select>
<select id="timezone"><option>UTC</option></select>
<p id="history-status"></p><div id="heatmap"></div><div id="daily"></div><div id="metrics"></div>
<div id="ranking-note" class="ranking-note" role="status"></div><div id="ranking" class="table-wrap"></div>
</main><script src="/assets/i18n.js"></script><script src="/assets/traffic-history.js"></script></body></html>`;

const DATA = {
    platform: 'TikTok',
    cells: [],
    daily: [],
    metrics: { daily: [] },
    rankings: {
        scope: 'own', totalSessions: 9, sessionCount: 2, minSessions: 3, minDays: 3,
        earlyMinutes: 30, minObservedMinutes: 20, days: 30,
        excluded: { missingStart: 6, pending: 0, insufficientCoverage: 1 },
        cells: [
            { key: 'Sat 22', n: 1, observedDays: 1, median: 10, mean: 10, shrunk: 10, insufficient: true },
            { key: 'Tue 20', n: 1, observedDays: 1, median: 12, mean: 12, shrunk: 12, insufficient: true }
        ]
    }
};

async function main() {
    const { default: puppeteer } = await import('puppeteer-core');
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/api/traffic/history')) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(DATA));
            return;
        }
        if (req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(HTML);
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
        await page.setViewport({ width: 1100, height: 950 });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => document.querySelector('.ranking-next'));
        const headline = await page.$eval('.ranking-next-head strong', node => node.textContent);
        assert.match(headline, /再開 4 場/);
        assert.equal(await page.$$eval('.ranking-slot', nodes => nodes.length), 2);
        assert.equal(await page.$$eval('.ranking-next-tips li', nodes => nodes.length), 2);
        assert.equal(await page.$eval('.ranking-why', node => node.open), false);
        await page.click('.ranking-why > summary');
        assert.equal(await page.$eval('.ranking-why', node => node.open), true);
        assert.equal(await page.$$eval('.ranking-why .ranking-criteria li', nodes => nodes.length), 2);

        fs.mkdirSync(path.join(__dirname, '../output/playwright'), { recursive: true });
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/traffic-ranking-next.png'), fullPage: true });
        assert.deepEqual(errors, []);
        console.log('Traffic ranking next-step UI passed: 4-session guidance, slot progress, tips and expandable rules.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
