/** 隔離 UI 冒煙檢查：node Test/traffic_planner_ui.cjs；只使用記憶體資料與假的通知通道。 */
/* global document, innerWidth -- 僅在瀏覽器 evaluate／waitForFunction 回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { TrafficDatabase } = require('../ScriptLib/traffic/database.cjs');
const { TrafficPlanner } = require('../ScriptLib/traffic/planner.cjs');
const { createPlannerRoutes } = require('../ScriptLib/traffic/plannerRoutes.cjs');
const { serveWebAsset } = require('../WebAssets.cjs');

async function main() {
    const { default: puppeteer } = await import('puppeteer-core');
    const database = new TrafficDatabase(':memory:');
    const now = Date.parse('2026-10-19T09:00:00Z');
    const planner = new TrafficPlanner(database, { now: () => now, available: () => ({ ntfy: true, bark: true }) });
    const insert = database.db.prepare(`INSERT INTO sessions(platform,broadcaster,started,actualStarted,lastSampleAt,
        sampleCount,earlySpanMs,earlyArea) VALUES(?,?,?,?,?,21,1200000,?)`);
    for (const name of ['self', 'reference']) for (let week = 1; week <= 3; week++) for (let day = 0; day < 2; day++) {
        const start = now + 3600000 - week * 7 * 86400000 + day * 86400000;
        insert.run('TikTok', name, start, start, start + 1200000, 1200000 * (day ? 30 : 50));
        database.db.prepare('INSERT OR IGNORE INTO minutes(platform,time,viewerSum,viewerCount) VALUES(?,?,?,1)')
            .run('TikTok', start, day ? 30 : 50);
    }
    insert.run('Unknown', null, now - 3600000, null, now - 3600000, 0);
    planner.classifyProfile({ platform: 'TikTok', broadcaster: 'self', purpose: 'own' });
    planner.classifyProfile({ platform: 'TikTok', broadcaster: 'reference', purpose: 'reference' });
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
        browser = await puppeteer.launch({ executablePath: process.env.TRAFFIC_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 1100, height: 950 });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => document.querySelector('#plan-sessions article'));
        await page.waitForFunction(() => document.querySelector('#plan-health article'));
        await page.waitForFunction(() => document.querySelectorAll('#plan-analysis-table tbody tr').length > 0);
        await page.click('#plan-enabled');
        await page.click('#plan-ntfy');
        await page.click('#plan-bark');
        await page.click('#plan-settings button[type=submit]');
        await page.waitForFunction(() => document.querySelector('#plan-status').textContent.includes('已儲存'));
        assert.equal(planner.settings().enabled, true);
        assert.deepEqual(planner.settings().channels, ['ntfy', 'bark']);
        await page.waitForFunction(() => document.querySelector('#plan-jobs article'));
        assert.ok(planner.snapshot().jobs.length > 0);
        await page.click('#plan-classification summary');
        await page.select('#plan-platform', 'Unknown');
        await page.waitForFunction(() => document.querySelectorAll('#plan-sessions article').length === 1);
        await page.click('#plan-tests');
        // 預設只顯示待分類；標記後要到「測試」狀態才看得到。
        await page.select('#plan-status-filter', 'test');
        await page.waitForFunction(() => document.querySelector('#plan-sessions article > p')?.textContent.includes('測試資料'));
        assert.equal(planner.sessions('Unknown', 1, 'test').rows[0].effectivePurpose, 'test');
        assert.equal(planner.sessions('Unknown', 1, 'test').total, 1);
        await page.select('#plan-sessions select', '');
        await page.click('#plan-sessions button');
        await page.select('#plan-status-filter', 'unclassified');
        await page.waitForFunction(() => !document.querySelector('#plan-tests').disabled);
        assert.equal(planner.sessions('Unknown').rows[0].effectivePurpose, 'unknown');

        // 補舊資料分類：這筆 Unknown 場次沒有觀測樣本，取消「只含完整場次」才能納入。
        await page.click('#plan-bf-complete');
        await page.type('#plan-bf-broadcaster', 'self');
        await page.select('#plan-bf-purpose', 'own');
        await page.click('#plan-bf-preview');
        await page.waitForFunction(() => document.querySelector('#plan-bf-preview-data').textContent.includes('符合 1 場'));
        await page.click('#plan-bf-clear');
        assert.equal(await page.$eval('#plan-bf-apply', el => el.disabled), true);
        await page.click('#plan-bf-preview-data thead input[type=checkbox]');
        assert.equal(await page.$eval('#plan-bf-apply', el => el.disabled), false);
        await page.click('#plan-bf-apply');
        await page.waitForFunction(() => document.querySelector('#plan-bf-message').textContent.includes('已套用 1 場'));
        assert.equal(planner.sessions('Unknown', 1, 'own').total, 1);
        await page.click('#plan-bf-undo');
        await page.waitForFunction(() => !document.querySelector('#plan-bf-batch').hidden);
        await page.waitForFunction(() => document.querySelector('#plan-bf-batch').textContent.includes('批次 #'));
        await page.click('#plan-bf-undo-confirm');
        await page.waitForFunction(() => document.querySelector('#plan-bf-message').textContent.includes('已復原 1 場'));
        assert.equal(planner.sessions('Unknown').total, 1);

        fs.mkdirSync(path.join(__dirname, '../output/playwright'), { recursive: true });
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/traffic-planner-desktop.png'), fullPage: true });
        await page.setViewport({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(__dirname, '../output/playwright/traffic-planner-mobile.png'), fullPage: true });
        assert.deepEqual(errors, []);
        console.log('UI passed: settings, both channels, Unknown classification, backfill preview/clear/apply/undo, 390px overflow check; screenshots in output/playwright.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        database.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
