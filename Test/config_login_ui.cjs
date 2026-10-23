/** 設定／登入頁 UI 冒煙檢查：node Test/config_login_ui.cjs；使用本機靜態預覽，不啟動聊天服務。 */
/* global document, getComputedStyle, innerWidth -- 僅在瀏覽器 evaluate／waitForFunction 回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { browserPath } = require('./browser_path.cjs');

const root = path.resolve(__dirname, '..');
const values = {
    BARK_API: 'https://api.day.app/example-key',
    SOCKET_API: 'tcp://127.0.0.1:9322',
    SOCKET_APIS: 'tcp://127.0.0.1:9323?filter=chat,gift',
    NTFY_API: 'ttw-live-topic',
    BING_TRANSLATE_API_KEY: '',
    KICK_CLIENT_ID: 'kick-client-id',
    KICK_CLIENT_SECRET: 'kick-client-secret',
    KICK_USER_NAME: 'your_channel',
    AUTO_CLIP_ENABLED: '1',
    AUTO_CLIP_MODE: 'shadow',
    AUTO_CLIP_W_VIEWERS: '0.2',
    AUTO_CLIP_W_MSG: '0.8',
    AUTO_CLIP_SCORE_THRESHOLD: '1.8',
    AUTO_CLIP_COOLDOWN_MIN: '15',
    AUTO_CLIP_BASELINE_WINDOW_MIN: '30',
    AUTO_CLIP_RATE_WINDOW_MIN: '0.5',
    AUTO_CLIP_FLOOR_VIEWERS: '2',
    AUTO_CLIP_FLOOR_MSG_PER_MIN: '2',
    AUTO_CLIP_SUSTAIN_MIN: '0.167',
    AUTO_CLIP_TITLE_PREFIX: '人氣高峰',
    TIKTOK_CHAT_SOURCE: 'auto',
    YOUTUBE_CHAT_SOURCE: 'auto',
    AUTO_STOP_ENABLED: '1',
    AUTO_STOP_GRACE_SEC: '60'
};
const fieldIds = Object.keys(values);

function render(file) {
    return fs.readFileSync(path.join(root, file), 'utf8')
        .replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => values[key] ?? '');
}

function previewServer() {
    const configHtml = render('config.html');
    const loginHtml = render('login.html');
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (req.method === 'POST' && url.pathname === '/login') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                let password = '';
                try { password = JSON.parse(body).password || ''; } catch { /* ignore */ }
                const ok = password === 'correct';
                res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(ok ? { success: true } : { error: 'Invalid password' }));
            });
            return;
        }
        if (url.pathname === '/config') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(configHtml);
            return;
        }
        if (url.pathname === '/login') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(loginHtml);
            return;
        }
        if (url.pathname === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (url.pathname.startsWith('/assets/')) {
            const file = path.join(root, url.pathname.replace(/^\//, ''));
            if (fs.existsSync(file)) {
                const ext = path.extname(file);
                const type = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'application/octet-stream';
                res.writeHead(200, { 'Content-Type': type });
                fs.createReadStream(file).pipe(res);
                return;
            }
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
        page.on('dialog', dialog => dialog.accept());
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(`${base}/config`, { waitUntil: 'networkidle0' });

        assert.equal(await page.$eval('#safetyOverlay', el => getComputedStyle(el).display !== 'none'), true);
        assert.equal(await page.$eval('#configContent', el => el.classList.contains('hidden')), true);
        await page.click('#safetyOverlay button');
        assert.equal(await page.$eval('#configContent', el => !el.classList.contains('hidden')), true);

        const bodyBg = await page.$eval('body', el => getComputedStyle(el).backgroundColor);
        assert.equal(bodyBg, 'rgb(7, 11, 18)');
        assert.equal(await page.$eval('.config-sidebar', el => getComputedStyle(el).display !== 'none'), true);
        assert.equal(await page.$eval('.config-mobile-nav', el => getComputedStyle(el).display === 'none'), true);
        assert.equal(await page.$$eval('.config-nav a', links => links.length), 7);
        assert.equal(await page.evaluate(ids => ids.every(id => Boolean(document.getElementById(id))), fieldIds), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

        fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
        await page.screenshot({ path: path.join(root, 'output/playwright/config-desktop.png'), fullPage: true });

        await page.type('#BARK_API', '-edited');
        assert.equal(await page.$eval('#saveState', el => el.textContent), '有未儲存變更');
        assert.equal(await page.$eval('#saveState', el => el.classList.contains('is-dirty')), true);

        await page.setViewport({ width: 390, height: 844 });
        assert.equal(await page.$eval('.config-sidebar', el => getComputedStyle(el).display === 'none'), true);
        assert.equal(await page.$eval('.config-mobile-nav', el => getComputedStyle(el).display !== 'none'), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const saveBarHeight = await page.$eval('.config-save-bar', el => el.getBoundingClientRect().height);
        assert.ok(saveBarHeight <= 80, `mobile save bar should stay compact (${saveBarHeight}px)`);
        await page.screenshot({ path: path.join(root, 'output/playwright/config-mobile.png'), fullPage: true });

        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
        const loginTheme = await page.$eval('body', el => ({
            image: getComputedStyle(el).backgroundImage,
            scheme: getComputedStyle(el).colorScheme
        }));
        assert.match(loginTheme.image, /radial-gradient/);
        assert.equal(loginTheme.scheme, 'dark');
        assert.equal(await page.$eval('.login-card', el => getComputedStyle(el).backgroundColor), 'rgb(15, 23, 42)');
        await page.screenshot({ path: path.join(root, 'output/playwright/login-desktop.png'), fullPage: true });

        await page.type('#password', 'wrong');
        await page.click('#loginForm button[type="submit"]');
        await page.waitForFunction(() => document.getElementById('error').textContent.includes('登入失敗'));

        await page.$eval('#password', el => { el.value = ''; });
        await page.type('#password', 'correct');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('#loginForm button[type="submit"]')
        ]);
        assert.equal(new URL(page.url()).pathname, '/config');
        assert.equal(await page.$eval('#safetyOverlay', el => getComputedStyle(el).display !== 'none'), true);

        assert.deepEqual(errors, []);
        console.log('Config/Login UI passed: dark theme, safety gate, 24 fields, sidebar/mobile nav, no 390px overflow, dirty state, login error/success; screenshots in output/playwright.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
