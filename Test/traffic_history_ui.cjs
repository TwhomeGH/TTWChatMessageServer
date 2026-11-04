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
<h3 data-i18n="traffic.compare.title">場次開場比較</h3><p data-i18n="traffic.compare.note">以開播後 0–120 分鐘對齊。</p><p id="compare-context"></p><p id="compare-highlight"></p><div id="compare-chart" class="compare-chart" hidden></div><p id="compare-empty" hidden data-i18n="traffic.compare.empty">尚無足夠的場次可比較。</p><p id="compare-note" hidden data-i18n="traffic.compare.onlyOne">只有 1 場。</p><div id="compare-table" class="table-wrap" hidden></div><p data-i18n="traffic.compare.openingNote">開場平均。</p>
<div id="ranking-note" class="ranking-note" role="status"></div><div id="ranking" class="table-wrap"></div>
<h4 id="ranking-provisional-title" data-i18n="traffic.ranking.provisionalTitle" hidden>暫定觀察（樣本不足）</h4><p id="ranking-provisional-note" data-i18n="traffic.ranking.provisionalNote" hidden>2 場／2 日期僅供參考；達標仍需 3 場／3 日期，且至少 2 個時段達標。</p><div id="ranking-provisional" class="table-wrap" hidden></div><h4 id="ranking-progress-title" data-i18n="traffic.ranking.progressTitle" hidden>時段累積進度（尚未達標）</h4><p id="ranking-progress-note" data-i18n="traffic.ranking.progressNote" hidden>列出尚在累積的時段。</p><div id="ranking-progress" class="table-wrap" hidden></div>
</main><script src="/assets/i18n.js"></script><script src="/assets/traffic-history.js"></script></body></html>`;

const comparePoints = (values) => Array.from({ length: 24 }, (_, index) => values[index] ?? null);
const COMPARISON = {
    platform: 'TikTok', days: 30, scope: 'own', windowMinutes: 120, bucketMs: 300000,
    slots: 24, limit: 6, minOpeningMinutes: 10,
    sessions: [
        {
            id: 2, date: '2026-10-02', localTime: '20:00', confidence: 'late', ended: true,
            openingAverage: 5.5, peak: 10, peakMinute: 9, low: 0.5, lowMinute: 12,
            postPeakLow: null, postPeakLowMinute: null, observedMinutes: 24,
            points: comparePoints(Array.from({ length: 10 }, (_, index) => index + 1))
        },
        {
            id: 1, date: '2026-10-01', localTime: '20:30', confidence: 'estimated', ended: true,
            openingAverage: 4, peak: 6, peakMinute: 3, low: 3, lowMinute: 0,
            postPeakLow: 4, postPeakLowMinute: 1, observedMinutes: 18,
            points: comparePoints(Array.from({ length: 6 }, () => 4))
        }
    ],
    median: comparePoints([4, 4, 4, 4, 4, 4, 7, 8, 9, 10])
};

const DATA = {
    platform: 'TikTok',
    cells: [],
    daily: [],
    metrics: { daily: [] },
    comparison: COMPARISON,
    rankings: {
        scope: 'own', platform: 'TikTok', totalSessions: 9, sessionCount: 2, minSessions: 3, minDays: 3,
        earlyMinutes: 30, minObservedMinutes: 20, days: 30,
        excluded: { missingStart: 6, pending: 0, insufficientCoverage: 1 },
        cells: [
            { key: 'Sat 22', n: 1, observedDays: 1, median: 10, mean: 10, shrunk: 10, insufficient: true, confidence: 'exact', startTypes: ['exact'] },
            { key: 'Tue 20', n: 1, observedDays: 1, median: 12, mean: 12, shrunk: 12, insufficient: true, confidence: 'exact', startTypes: ['exact'] }
        ]
    }
};

const PROVISIONAL = {
    platform: 'TikTok',
    cells: [],
    daily: [],
    metrics: { daily: [] },
    rankings: {
        scope: 'own', platform: 'TikTok', totalSessions: 4, sessionCount: 4, minSessions: 3, minDays: 3,
        earlyMinutes: 30, minObservedMinutes: 20, days: 30,
        excluded: { missingStart: 0, pending: 0, insufficientCoverage: 0 },
        cells: [
            { key: 'Sat 22', n: 2, observedDays: 2, median: 18, mean: 18, shrunk: 18, insufficient: true, confidence: 'exact', startTypes: ['exact'] },
            { key: 'Tue 20', n: 2, observedDays: 2, median: 12, mean: 12, shrunk: 12, insufficient: true, confidence: 'exact', startTypes: ['exact'] }
        ]
    }
};

const SCATTERED = {
    platform: 'TikTok',
    cells: [],
    daily: [],
    metrics: { daily: [] },
    rankings: {
        scope: 'own', platform: 'TikTok', totalSessions: 6, sessionCount: 6, minSessions: 3, minDays: 3,
        earlyMinutes: 30, minObservedMinutes: 20, days: 30,
        excluded: { missingStart: 0, pending: 0, insufficientCoverage: 0 },
        cells: ['Mon 08', 'Tue 12', 'Wed 17', 'Thu 21', 'Fri 09', 'Sat 14'].map((key, index) => ({
            key, n: 1, observedDays: 1, median: 10 + index, mean: 10 + index, shrunk: 10 + index,
            insufficient: true, confidence: 'exact', startTypes: ['exact']
        }))
    }
};

const ASSISTED = {
    platform: 'TikTok',
    cells: [],
    daily: [],
    metrics: { daily: [] },
    rankings: {
        scope: 'own', platform: 'TikTok', totalSessions: 5, sessionCount: 5, minSessions: 3, minDays: 3,
        earlyMinutes: 30, minObservedMinutes: 20, days: 30,
        excluded: { missingStart: 0, pending: 0, insufficientCoverage: 0 },
        cells: [
            { key: 'Thu 20', n: 3, observedDays: 3, median: 12, mean: 12, shrunk: 12, insufficient: false, confidence: 'assisted', startTypes: ['late'] },
            { key: 'Sat 22', n: 2, observedDays: 2, median: 10, mean: 10, shrunk: 10, insufficient: true, confidence: 'assisted', startTypes: ['estimated'] }
        ]
    }
};

const ASSISTED_READY = {
    platform: 'TikTok',
    cells: [],
    daily: [],
    metrics: { daily: [] },
    rankings: {
        scope: 'own', platform: 'TikTok', totalSessions: 6, sessionCount: 6, minSessions: 3, minDays: 3,
        earlyMinutes: 30, minObservedMinutes: 20, days: 30,
        excluded: { missingStart: 0, pending: 0, insufficientCoverage: 0 },
        cells: [
            { key: 'Thu 20', n: 3, observedDays: 3, median: 12, mean: 12, shrunk: 12, insufficient: false, confidence: 'assisted', startTypes: ['late'] },
            { key: 'Sat 22', n: 3, observedDays: 3, median: 10, mean: 10, shrunk: 10, insufficient: false, confidence: 'assisted', startTypes: ['estimated'] }
        ]
    }
};

async function main() {
    const { default: puppeteer } = await import('puppeteer-core');
    let current = DATA;
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/api/traffic/history')) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(current));
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
        const hints = await page.$$eval('.ranking-next-hint', nodes => nodes.map(node => node.textContent));
        assert.ok(hints.some(text => text.includes('約 2 週')));
        assert.ok(hints.some(text => text.includes('不會推進')));
        const tips = await page.$$eval('.ranking-next-tips li', nodes => nodes.map(node => node.textContent));
        assert.equal(tips.length, 2);
        assert.ok(tips.some(text => text.includes('開播後')));
        assert.ok(!tips.some(text => text.includes('開台前先啟動')));
        assert.equal(await page.$eval('.ranking-why', node => node.open), false);
        await page.click('.ranking-why > summary');
        assert.equal(await page.$eval('.ranking-why', node => node.open), true);
        assert.equal(await page.$$eval('.ranking-why .ranking-criteria li', nodes => nodes.length), 2);
        assert.match(await page.$eval('.ranking-slot-boundary', node => node.textContent), /19:45/);

        await page.waitForFunction(() => !document.querySelector('#compare-chart').hidden);
        assert.equal(await page.$$eval('#compare-table tbody tr', rows => rows.length), 2);
        assert.match(await page.$eval('#compare-context', node => node.textContent), /只計自己的場次/);
        assert.match(await page.$eval('#compare-table tbody tr:first-child', node => node.textContent), /連線較晚/);
        assert.match(await page.$eval('#compare-table tbody tr:last-child', node => node.textContent), /以連線時刻起算/);
        assert.ok(await page.$$eval('#compare-chart svg path', nodes => nodes.length >= 2));
        assert.ok(await page.$$eval('#compare-chart svg circle', nodes => nodes.length >= 2));
        assert.match(await page.$eval('#compare-highlight', node => node.textContent), /圖上最高/);
        assert.match(await page.$eval('#compare-table thead', node => node.textContent), /峰值後低點/);
        assert.match(await page.$eval('#compare-table tbody tr:last-child', node => node.textContent), /4.0（開播後 1 分）/);
        assert.match(await page.$eval('#compare-chart svg', node => node.textContent), /開播後（分）/);
        assert.equal(await page.$eval('#compare-note', node => node.hidden), true);
        await page.$eval('#compare-chart', node => node.scrollIntoView({ block: 'center' }));
        const svg = await page.$('#compare-chart svg');
        const svgBox = await svg.boundingBox();
        await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2);
        await page.waitForFunction(() => !document.querySelector('.compare-tip').hidden);
        const tipText = await page.$eval('.compare-tip', node => node.textContent);
        assert.match(tipText, /2026-10-02/);
        assert.match(tipText, /開播後/);

        fs.mkdirSync(path.join(__dirname, '../output/playwright'), { recursive: true });
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/traffic-ranking-next.png'), fullPage: true });

        current = SCATTERED;
        await page.reload();
        await page.waitForFunction(() => document.querySelector('.ranking-next'));
        const scatteredHeadline = await page.$eval('.ranking-next-head strong', node => node.textContent);
        assert.match(scatteredHeadline, /分散/);
        assert.equal(await page.$$eval('.ranking-slot', nodes => nodes.length), 0);
        assert.match(await page.$eval('.ranking-next-action', node => node.textContent), /6 個時段/);
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/traffic-ranking-scattered.png'), fullPage: true });

        current = PROVISIONAL;
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('#ranking-provisional').hidden);
        const provisionalHeadline = await page.$eval('.ranking-next-head strong', node => node.textContent);
        assert.match(provisionalHeadline, /再開 2 場/);
        assert.equal(await page.$$eval('#ranking-provisional tbody tr', rows => rows.length), 2);
        assert.match(await page.$eval('#ranking-provisional-note', node => node.textContent), /僅供參考/);
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/traffic-ranking-provisional.png'), fullPage: true });

        current = ASSISTED;
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('#ranking').hidden);
        assert.equal(await page.$$eval('#ranking tbody tr', rows => rows.length), 1);
        assert.match(await page.$eval('#ranking tbody tr td:nth-child(3)', node => node.textContent), /連線較晚/);
        assert.equal(await page.$$eval('#ranking-provisional tbody tr', rows => rows.length), 1);
        assert.match(await page.$eval('#ranking-provisional tbody tr td:nth-child(2)', node => node.textContent), /以連線時刻起算/);
        assert.equal(await page.$eval('#ranking-progress', node => node.hidden), true);
        assert.match(await page.$eval('.ranking-next-head', node => node.textContent), /再開 1 場/);
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/traffic-ranking-assisted.png'), fullPage: true });

        current = ASSISTED_READY;
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('#ranking').hidden
            && document.querySelectorAll('#ranking tbody tr').length === 2);
        assert.equal(await page.$$eval('#ranking tbody tr', rows => rows.length), 2);
        assert.match(await page.$eval('#ranking-note > strong', node => node.textContent), /已有可比較時段/);
        assert.match(await page.$eval('#ranking tbody tr:first-child td:nth-child(3)', node => node.textContent), /連線較晚|以連線時刻起算/);
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/traffic-ranking-assisted-ready.png'), fullPage: true });

        assert.deepEqual(errors, []);
        console.log('Traffic ranking next-step UI passed: clear next step, scattered-schedule warning, slot progress, tips and expandable rules.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
