/** AutoClip 歷史頁 UI 冒煙檢查：node Test/autoclip_history_ui.cjs；使用假歷史資料。 */
/* global document -- 僅在瀏覽器 waitForFunction 回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { serveWebAsset } = require('../WebAssets.cjs');
const { browserPath } = require('./browser_path.cjs');

const now = Date.parse('2026-11-05T12:00:00Z');
const started = now - 10000;
const iso = value => new Date(value).toISOString();

const platform = (extra = {}) => ({
    platform: 'TikTok', score: 2.8, windowMsgs: 2, uniqueUsers: 1, messageRatio: 2,
    viewers: 2, baseViewers: 2, msgRate: 4, baseMsgRate: 2, topUserMsgs: 2,
    transports: ['api', 'userscript'], minMessages: 5, minUsers: 1, minMessageRatio: 3,
    scoreThreshold: 2.5, solo: true, distinctRecent: 1, maxPerUser: 5,
    eligible: true, contribution: 2.8, ...extra
});

const EVIDENCE = {
    windowStart: started, windowEnd: now, total: 2, uniqueUsers: 1,
    platforms: [platform()], sourcePlatform: 'TikTok',
    minMessages: 5, minUsers: 1, minMessageRatio: 3, threshold: 2.5,
    solo: true, recentDistinctUsers: 1, messageRatio: 2, maxPerUser: 5,
    truncated: false,
    messages: [{
        t: now, name: 'solo', message: '嗨', platform: 'TikTok',
        transport: 'api', timeSource: 'platform'
    }]
};

const ROWS = [
    {
        t: iso(started), score: 0.2, reason: '暖機收集基準', triggered: false,
        status: 'observing', mode: 'live', viewers: 2, baseViewers: 2,
        msgRate: 0, baseMsgRate: 0, windowMsgs: 0, uniqueUsers: 0,
        platforms: [platform({ score: 0.2, windowMsgs: 0, uniqueUsers: 0, messageRatio: 0, eligible: false, contribution: 0 })]
    },
    {
        t: iso(now), score: 2.8, reason: '觸發剪輯', triggered: true,
        status: 'success', mode: 'live', viewers: 2, baseViewers: 2,
        msgRate: 4, baseMsgRate: 2, windowMsgs: 2, uniqueUsers: 1,
        platforms: [platform()], evidence: EVIDENCE
    }
];

const PLATFORM_SUMMARY = {
    platform: 'TikTok', score: 2.8, at: iso(now), windowMsgs: 2, uniqueUsers: 1,
    messageRatio: 2, viewers: 2, transports: ['api', 'userscript'],
    minMessages: 5, minUsers: 1, minMessageRatio: 3, scoreThreshold: 2.5,
    solo: true, recentDistinctUsers: 1, eligibleCount: 0, eligible: false,
    maxMessages: 2, maxUsers: 1, maxRatio: 2, maxViewers: 2
};

const CONFIG = {
    mode: 'live', rateWindowMin: 0.5, baselineWindowMin: 30, sustainMin: 0.167,
    minUsers: 3, minMessages: 6, minMessageRatio: 1.5, scoreThreshold: 1.8,
    floorViewers: 2, floorMsgPerMin: 2, adaptiveThresholds: true, maxPerUser: 3,
    solo: 'auto', soloMaxViewers: 20, soloMinMessages: 5, soloMinUsers: 1,
    soloMinMessageRatio: 3, soloScoreThreshold: 2.5, soloMaxPerUser: 5
};

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AutoClip history test</title></head>
<body>
<button id="autoclipModeBadge" hidden></button>
<div id="autoclipStatus" hidden></div>
<section id="historyControls" hidden>
  <select id="historySession"></select><button id="historyRefresh"></button><span id="historyMeta"></span>
</section>
<section id="liveOverview"><div id="statusCards"></div></section>
<p id="platformContext"></p><button id="liveBtn"></button><div id="platformCards"></div>
<button id="viewLive"></button><button id="viewHistory"></button>
<div class="chart-tabs">
  <button data-chart="score" aria-pressed="true"></button>
  <button data-chart="viewer" aria-pressed="false"></button>
  <button data-chart="msg" aria-pressed="false"></button>
</div>
<select id="rangeSelect">
  <option value="10">10</option><option value="30" selected>30</option>
  <option value="60">60</option><option value="all">all</option>
</select>
<span id="rangeContext"></span>
<div id="viewerPane"><canvas id="viewerChart"></canvas></div>
<div id="msgPane"><canvas id="msgChart"></canvas></div>
<div id="scorePane"><canvas id="scoreChart"></canvas></div>
<div id="triggerGroup" hidden></div><select id="triggerSelect"></select><div id="triggerDetail"></div>
<div id="configInfo"></div><span id="cfgBaseline"></span>
<button id="refreshBtn"></button><button id="clearBtn"></button>
<script>
class Chart {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.data = config.data;
    this.options = config.options;
    this.plugins = config.plugins;
    this.$groupBoxes = [];
    this.$scoreEventHit = null;
  }
  update() {}
  resize() {}
}
Chart.Interaction = { modes: {} };
window.Chart = Chart;
</script>
<script src="/assets/autoclip.js"></script>
</body></html>`;

const json = (res, value) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
};

async function main() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/autoclip/sessions') {
            return json(res, { success: true, sessions: [{
                id: 's1', startedAt: started, endedAt: now, lastAt: now,
                mode: 'live', sampleCount: 2, triggerCount: 1
            }] });
        }
        if (url.pathname === '/autoclip/history') {
            return json(res, {
                success: true, config: CONFIG, platforms: [PLATFORM_SUMMARY], rows: ROWS,
                meta: { mode: 'live', startedAt: started, endedAt: now, lastAt: now, sampleCount: 2, triggerCount: 1 }
            });
        }
        if (url.pathname === '/autoclip/data') {
            return json(res, {
                success: true, stats: [], config: CONFIG,
                configured: { mode: 'live', enabled: true },
                runtime: { running: false, source: 'snapshot', lastStatsAt: null }
            });
        }
        if (url.pathname === '/' || url.pathname === '/autoclip') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(HTML);
            return;
        }
        if (serveWebAsset(req, res)) return;
        res.writeHead(404);
        res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    let browser;
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        browser = await puppeteer.launch({ executablePath: browserPath(), headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/', { waitUntil: 'load' });

        await page.click('#viewHistory');
        try {
            await page.waitForFunction(() => !document.querySelector('#historyControls').hidden
                && document.querySelector('#historyMeta').textContent.includes('1 觸發'), { timeout: 5000 });
        } catch (error) {
            console.error('page errors:', errors);
            console.error('meta:', await page.$eval('#historyMeta', node => node.textContent));
            console.error('controls hidden:', await page.$eval('#historyControls', node => node.hidden));
            console.error('status:', await page.$eval('#autoclipStatus', node => node.textContent));
            throw error;
        }
        assert.equal(await page.$$eval('#historySession option', nodes => nodes.length), 1);
        assert.match(await page.$eval('#historyMeta', node => node.textContent), /正式/);
        assert.match(await page.$eval('#platformContext', node => node.textContent), /本場最高/);
        const summaryCard = await page.$eval('#platformCards', node => node.textContent);
        assert.match(summaryCard, /本場 0 個窗口達標/);
        assert.match(summaryCard, /2\/5 則/);
        assert.match(summaryCard, /1\/1 人/);
        assert.match(summaryCard, /2\.80 \/ 2\.50/);
        assert.match(await page.$eval('#platformCards button', node => node.title), /單人模式/);

        const triggerValue = await page.$eval('#triggerSelect option:not([value=""])', node => node.value);
        await page.select('#triggerSelect', triggerValue);
        await page.waitForFunction(() => document.querySelector('#triggerDetail').textContent.includes('單人模式'));
        const detail = await page.$eval('#triggerDetail', node => node.textContent);
        assert.match(detail, /最少 5 則 \/ 1 位/);
        assert.match(detail, /每人最多計入 5 則/);
        assert.match(detail, /2 則 \/ 1 位/);
        assert.match(await page.$eval('#platformCards', node => node.textContent), /本次主導（單人）/);

        // 清除觸發選取，回到本場摘要後再切換範圍。
        await page.select('#triggerSelect', '');
        await page.waitForFunction(() => document.querySelector('#platformContext').textContent.includes('本場最高'));
        await page.select('#rangeSelect', '10');
        await page.waitForFunction(() => document.querySelector('#platformContext').textContent.includes('所選範圍最高'));
        const rangedCard = await page.$eval('#platformCards', node => node.textContent);
        assert.match(rangedCard, /2\/5 則/);
        assert.match(rangedCard, /1\/1 人/);
        assert.match(rangedCard, /2\.80 \/ 2\.50/);
        assert.match(await page.$eval('#platformCards button', node => node.title), /單人模式/);

        await page.click('#viewLive');
        await page.waitForFunction(() => document.querySelector('#historyControls').hidden
            && !document.querySelector('#liveOverview').hidden);
        assert.deepEqual(errors, []);
        console.log('AutoClip history UI passed: session summary, solo thresholds, trigger evidence and range summary.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
