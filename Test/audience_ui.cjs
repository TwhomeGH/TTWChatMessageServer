/** 隔離常客頁 UI 冒煙檢查：node Test/audience_ui.cjs；只用記憶體追蹤器。 */
/* global document, innerWidth -- 僅在瀏覽器 evaluate／waitForFunction 回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createAudienceTracker } = require('../ScriptLib/audience/tracker.cjs');
const { createAudienceRoutes } = require('../AudienceRoutes.cjs');
const { serveWebAsset } = require('../WebAssets.cjs');

const DAY = 86400000;
const BASE = Date.parse('2026-09-01T10:00:00Z');

async function main() {
    const { default: puppeteer } = await import('puppeteer-core');
    let now = BASE + 10 * DAY;
    const sessions = Array.from({ length: 6 }, (_, index) => ({
        id: index + 1, start: BASE + index * DAY, end: BASE + index * DAY + 3600000
    }));
    const tracker = createAudienceTracker({
        file: ':memory:',
        now: () => now,
        timezone: () => 'UTC',
        sessionFor: (platform, time) => sessions.find(session => time >= session.start && time <= session.end)?.id ?? null,
        recentSessions: () => [...sessions].reverse().map(session => session.id)
    });
    for (const session of [2, 3, 4]) {
        for (let minute = 0; minute < 3; minute++) {
            tracker.observe({
                t: sessions[session].start + minute * 60000, platform: 'tiktok', category: 'chat',
                user: 'Alice', message: `hello ${minute}`
            });
        }
    }
    tracker.observe({ t: sessions[4].start + 60000, platform: 'tiktok', category: 'gift', user: 'Alice', message: 'rose' });
    tracker.observe({ t: sessions[4].start + 60000, platform: 'tiktok', category: 'chat', user: 'Bob', message: 'yo' });

    const route = createAudienceRoutes(tracker);
    const server = http.createServer((req, res) => {
        if (route(req, res, true) || serveWebAsset(req, res)) return;
        res.writeHead(404);
        res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.TRAFFIC_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            headless: true
        });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 1100, height: 950 });
        await page.goto(`http://127.0.0.1:${server.address().port}/audience`);
        await page.waitForFunction(() => document.querySelectorAll('#audience-rows tr').length >= 2);
        assert.equal(await page.$eval('#audience-count', el => el.textContent.includes('2')), true);
        await page.click('#audience-rows tr');
        await page.waitForFunction(() => !document.querySelector('#audience-detail').hidden);
        assert.equal(await page.$eval('#audience-detail-name', el => el.textContent), 'Alice');
        assert.equal(await page.$eval('#audience-detail-level', el => el.textContent.includes('常客')), true);
        assert.equal(await page.$$eval('#audience-breakdown tr', rows => rows.length), 5);
        assert.equal(await page.$$eval('#audience-levels tr', rows => rows.length >= 4), true);
        assert.equal(await page.$$eval('#audience-recent tr', rows => rows.length), 3);

        fs.mkdirSync(path.join(__dirname, '../output/playwright'), { recursive: true });
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/audience-desktop.png'), fullPage: true });
        await page.setViewport({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/audience-mobile.png'), fullPage: true });
        assert.deepEqual(errors, []);
        console.log('Audience UI passed: list, detail breakdown, levels, recent sessions, 390px overflow check; screenshots in output/playwright.');
    } finally {
        await browser?.close();
        tracker.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
