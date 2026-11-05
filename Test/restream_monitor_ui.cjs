/** Restream 助手自動暫停預覽的 UI 冒煙檢查：node Test/restream_monitor_ui.cjs */
/* global document, window -- 僅在瀏覽器 waitForFunction 回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { browserPath } = require('./browser_path.cjs');

const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="player">
  <video id="preview"></video>
  <div><button id="toggle">Pause Preview</button></div>
</div>
<script>
const store = {};
const params = new URLSearchParams(location.search);
window.__clicks = 0;
window.__pauses = 0;
const video = document.getElementById('preview');
Object.defineProperty(video, 'paused', { value: false, configurable: true });
video.pause = () => { window.__pauses += 1; };
document.getElementById('toggle').addEventListener('click', () => {
  window.__clicks += 1;
  Object.defineProperty(video, 'paused', { value: true, configurable: true });
});
window.GM_getValue = (key, fallback) => key === 'ttw-restream-monitor-pause-preview'
    ? params.get('pause') !== '0'
    : (key in store ? store[key] : fallback);
window.GM_setValue = (key, value) => { store[key] = value; };
window.GM_openInTab = () => ({ closed: false });
</script>
<script src="/userscript.js"></script>
</body></html>`;

async function main() {
    const userscript = fs.readFileSync(path.join(__dirname, '../UserScript/restream-monitor.user.js'));
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/shows/test') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(HTML);
            return;
        }
        if (url.pathname === '/userscript.js') {
            res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            res.end(userscript);
            return;
        }
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

        await page.goto(base + '/shows/test', { waitUntil: 'load' });
        await page.waitForFunction(() => Boolean(document.querySelector('#ttw-restream-monitor')?.shadowRoot
            ?.querySelector('.preview')));
        await page.waitForFunction(() => document.getElementById('toggle') && window.__clicks === 1);
        assert.equal(await page.evaluate(() => window.__clicks), 1);
        const status = await page.evaluate(() => document.querySelector('#ttw-restream-monitor')
            .shadowRoot.querySelector('.preview').textContent);
        assert.equal(status, '預覽已自動暫停');
        await new Promise(resolve => setTimeout(resolve, 1200));
        assert.equal(await page.evaluate(() => document.querySelector('#ttw-restream-monitor')
            .shadowRoot.querySelector('.preview').textContent), '預覽已自動暫停');
        assert.deepEqual(errors, []);

        await page.goto(base + '/shows/test?pause=0', { waitUntil: 'load' });
        await page.waitForFunction(() => Boolean(document.querySelector('#ttw-restream-monitor')?.shadowRoot
            ?.querySelector('.preview')));
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(await page.evaluate(() => window.__clicks), 0);
        assert.equal(await page.evaluate(() => document.querySelector('#ttw-restream-monitor')
            .shadowRoot.querySelector('.preview').textContent), '');
        assert.deepEqual(errors, []);
        console.log('Restream preview UI passed: auto pause once, and opt-out leaves it playing.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
