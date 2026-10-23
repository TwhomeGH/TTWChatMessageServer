/** 運行狀態頁 UI 冒煙檢查：node Test/runtime_ui.cjs；使用本機 mock API，不啟動聊天服務。 */
/* global document, innerWidth, window -- 僅在瀏覽器 evaluate 回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { browserPath } = require('./browser_path.cjs');
const { options } = require('../ScriptLib/runtime/options.cjs');

const root = path.resolve(__dirname, '..');
const state = {
    state: 'running',
    pid: 4242,
    startedAt: Date.now() - 125000,
    stoppedAt: null,
    stopRequestedAt: null,
    exitCode: null,
    signal: null,
    error: null,
    platforms: ['tiktok', 'twitch'],
    features: { isSocket: true, isBark: false, isNtfy: true },
    resources: { cpuPercent: 3.2, rssBytes: 220 * 1024 * 1024, sampledAt: Date.now() },
    uptimeMs: 125000,
    stopDelayed: false,
    sources: {
        tiktok: { configured: 'auto', effective: 'browser' },
        youtube: { configured: 'manual', effective: 'manual', browserFallback: true }
    }
};

function serveFile(res, file, type) {
    if (!fs.existsSync(file)) {
        res.writeHead(404);
        res.end('not found');
        return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
}

function previewServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/runtime') {
            serveFile(res, path.join(root, 'runtime.html'), 'text/html; charset=utf-8');
            return;
        }
        if (url.pathname === '/api/runtime') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(state));
            return;
        }
        if (url.pathname === '/api/runtime/options') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ options }));
            return;
        }
        if (req.method === 'POST' && url.pathname === '/close') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        if (url.pathname.startsWith('/assets/')) {
            const file = path.join(root, url.pathname.slice(1));
            const ext = path.extname(file);
            const type = ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'application/javascript; charset=utf-8' : 'application/octet-stream';
            serveFile(res, file, type);
            return;
        }
        if (url.pathname.startsWith('/lang/')) {
            serveFile(res, path.join(root, url.pathname.slice(1)), 'application/json; charset=utf-8');
            return;
        }
        if (url.pathname === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
        }
        res.writeHead(404);
        res.end('not found');
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
    const { default: puppeteer } = await import('puppeteer-core');
    const server = await previewServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    let browser;

    try {
        browser = await puppeteer.launch({ executablePath: browserPath(), headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(`${base}/runtime`, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => document.getElementById('mode-tiktok').textContent !== '—');

        assert.equal(await page.$eval('#state', el => el.textContent), '程序執行中');
        assert.equal(await page.$eval('#stateDot', el => el.dataset.state), 'running');
        assert.match(await page.$eval('#mode-tiktok', el => el.textContent), /程式瀏覽器/);
        assert.match(await page.$eval('#mode-tiktok-detail', el => el.textContent), /專用瀏覽器/);
        assert.match(await page.$eval('#mode-youtube', el => el.textContent), /手動 userscript/);
        assert.equal(await page.$eval('#mode-youtube-badge', el => el.dataset.mode), 'manual');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

        fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
        await page.screenshot({ path: path.join(root, 'output/playwright/runtime-desktop.png'), fullPage: true });

        await page.evaluate(() => window.runtimeRefresh(true));
        await page.waitForFunction(() => document.getElementById('toast-region').textContent.includes('狀態已更新'));
        await page.click('#stop');
        await page.waitForFunction(() => document.getElementById('toast-region').textContent.includes('已送出停止要求'));

        await page.setViewport({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(root, 'output/playwright/runtime-mobile.png'), fullPage: true });

        assert.deepEqual(errors, []);
        console.log('Runtime UI passed: state, sources, refresh/stop toasts, 390px overflow; screenshots in output/playwright.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
