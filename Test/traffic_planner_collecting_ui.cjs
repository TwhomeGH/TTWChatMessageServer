/** 資料累積建議／可選提醒 UI 冒煙檢查：node Test/traffic_planner_collecting_ui.cjs。 */
/* global document -- 僅在瀏覽器 waitForFunction 回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { TrafficDatabase } = require('../ScriptLib/traffic/database.cjs');
const { TrafficStore } = require('../ScriptLib/traffic/store.cjs');
const { TrafficPlanner } = require('../ScriptLib/traffic/planner.cjs');
const { createPlannerRoutes } = require('../ScriptLib/traffic/plannerRoutes.cjs');
const { serveWebAsset } = require('../WebAssets.cjs');
const { browserPath } = require('./browser_path.cjs');

async function main() {
    const { default: puppeteer } = await import('puppeteer-core');
    const database = new TrafficDatabase(':memory:');
    let now = Date.parse('2026-09-07T20:00:00Z'); // 週一 20:00 UTC
    const planner = new TrafficPlanner(database, {
        now: () => now,
        available: () => ({ ntfy: true, bark: true }),
        send: async () => true
    });
    const store = new TrafficStore(() => now, database);
    const seed = (start, platform = 'TikTok') => {
        for (let minute = 0; minute <= 20; minute++) {
            now = start + minute * 60000;
            store.record({
                type: 'audience', platform, broadcasterId: 'self',
                streamId: `partial-${platform}-${start}`, startedAt: new Date(start).toISOString(), userNum: 20
            });
        }
    };
    seed(Date.parse('2026-09-07T20:00:00Z'), 'TikTok');
    seed(Date.parse('2026-09-08T20:00:00Z'), 'TikTok');
    seed(Date.parse('2026-09-08T20:00:00Z'), 'Twitch');
    planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    planner.classifyProfile({ platform: 'Twitch', broadcaster: 'self', purpose: 'own' });
    now = Date.parse('2026-09-10T00:00:00Z');
    planner.saveSettings({
        ...planner.settings(), enabled: true, channels: ['ntfy', 'bark'],
        timezone: 'UTC', hours: [20]
    });

    const route = createPlannerRoutes(planner);
    const source = fs.readFileSync(path.join(__dirname, '../traffic.html'), 'utf8');
    const section = source.match(/<section class="panel" id="stream-planner">[\s\S]*?<\/section>/)[0];
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/traffic.css"></head>
        <body class="bg-gray-900 text-gray-200"><main class="mx-auto max-w-6xl p-4">${section}</main>
        <script src="/assets/i18n.js"></script><script src="/assets/traffic-planner.js"></script></body></html>`;
    const server = http.createServer((req, res) => {
        if (route(req, res, true) || serveWebAsset(req, res)) return;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
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
        await page.waitForFunction(() => document.querySelectorAll('.plan-hour-table tbody tr').length === 2);
        assert.match(await page.$eval('.plan-collecting > strong', node => node.textContent), /資料累積建議/);
        const cardText = await page.$eval('.plan-collecting', node => node.textContent);
        assert.match(cardText, /週二/);
        assert.match(cardText, /Twitch/);
        assert.match(cardText, /TikTok/);
        assert.match(cardText, /1\/3/);

        const clickRowAction = (weekday, label) => page.evaluate((weekday, label) => {
            const row = [...document.querySelectorAll('.plan-hour-table tbody tr')]
                .find(item => item.textContent.includes(weekday));
            const button = [...row.querySelectorAll('.plan-hour-actions button')]
                .find(item => item.textContent.includes(label));
            button?.click();
        }, weekday, label);

        await clickRowAction('週二', '加入提醒');
        await page.waitForFunction(() => {
            const row = [...document.querySelectorAll('.plan-hour-table tbody tr')]
                .find(item => item.textContent.includes('週二'));
            return row?.textContent.includes('移除') && document.querySelector('.plan-hour-head')?.textContent.includes('1 天已加入');
        });
        const jobs = await page.$eval('#plan-jobs', node => node.textContent);
        assert.match(jobs, /資料累積/);
        assert.match(jobs, /Twitch/);
        assert.match(jobs, /TikTok/);

        await clickRowAction('週二', '移除');
        await page.waitForFunction(() => {
            const row = [...document.querySelectorAll('.plan-hour-table tbody tr')]
                .find(item => item.textContent.includes('週二'));
            return row?.textContent.includes('加入提醒');
        });

        await page.click('.plan-hour .plan-series > summary');
        await page.evaluate(() => {
            const inputs = [...document.querySelectorAll('.plan-hour .plan-series-days input')];
            for (const input of inputs) input.checked = ['0', '2', '4'].includes(input.value);
        });
        await page.click('.plan-hour .plan-series button');
        await page.waitForFunction(() => {
            const rows = document.querySelectorAll('.plan-hour-table tbody tr');
            return rows.length === 4 && document.querySelector('.plan-hour-head')?.textContent.includes('3 天已加入');
        });
        const rows = await page.$$eval('.plan-hour-table tbody tr', nodes => nodes.map(node => node.textContent));
        assert.ok(rows.some(text => text.includes('週三') && text.includes('0/3') && text.includes('尚無資料')));
        assert.ok(rows.some(text => text.includes('週一') && text.includes('4 天後')));

        fs.mkdirSync(path.join(__dirname, '../output/playwright'), { recursive: true });
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/traffic-collecting.png'), fullPage: true });
        assert.deepEqual(errors, []);
        console.log('Planner collecting UI passed: suggestions, add-reminder, scheduled job, remove.');
    } finally {
        await browser?.close();
        database.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
