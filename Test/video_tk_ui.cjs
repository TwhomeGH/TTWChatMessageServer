/** videoTK 劇院模式與可拖動按鈕的隔離 UI 測試。 */
/* global document -- 僅在瀏覽器回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { browserPath } = require('./browser_path.cjs');

const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>live</title></head>
<body>
  <div class="tiktok-1w5o2is" id="extra" style="display:block">extra</div>
  <div data-e2e="live-room-content" id="live" style="position:relative">
    <video id="video"></video>
  </div>
  <div id="chat-parent" style="display:flex">
    <div data-e2e="live-chat-container" id="chat">chat</div>
  </div>
  <div data-e2e="live-content-container" id="content" style="width:calc(100% - 327px)">content</div>
  <div data-e2e="live-header-container" id="header" style="display:block">header</div>
  <div data-e2e="gift-container" id="gift" style="display:block">gift</div>
</body></html>`;

async function main() {
    const server = http.createServer((req, res) => {
        if (req.url.split('?')[0] === '/@demo/live') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fixture);
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
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/@demo/live`, { waitUntil: 'load' });
        const script = fs.readFileSync(path.join(__dirname, '../UserScript/videoTK.user.js'), 'utf8');
        await page.addScriptTag({ content: script });
        await page.waitForSelector('#ttw-videotk-toggle');

        await page.click('#ttw-videotk-toggle');
        await page.waitForFunction(() => document.querySelector('#ttw-videotk-toggle').getAttribute('aria-pressed') === 'true');
        const enabled = await page.evaluate(() => ({
            chat: document.querySelector('#chat-parent').style.display,
            header: document.querySelector('#header').style.display,
            gift: document.querySelector('#gift').style.display,
            extra: document.querySelector('#extra').style.display,
            width: document.querySelector('#content').style.width
        }));
        assert.deepEqual(enabled, { chat: 'none', header: 'none', gift: 'none', extra: 'none', width: '100%' });

        await page.click('#ttw-videotk-toggle');
        await page.waitForFunction(() => document.querySelector('#ttw-videotk-toggle').getAttribute('aria-pressed') === 'false');
        const restored = await page.evaluate(() => ({
            chat: document.querySelector('#chat-parent').style.display,
            header: document.querySelector('#header').style.display,
            gift: document.querySelector('#gift').style.display,
            extra: document.querySelector('#extra').style.display,
            width: document.querySelector('#content').style.width
        }));
        assert.deepEqual(restored, {
            chat: 'flex', header: 'block', gift: 'block', extra: 'block', width: 'calc(100% - 327px)'
        });

        const before = await page.$eval('#ttw-videotk-toggle', el => el.getBoundingClientRect().toJSON());
        await page.mouse.move(before.x + 10, before.y + 10);
        await page.mouse.down();
        await page.mouse.move(before.x + 90, before.y - 20, { steps: 5 });
        await page.mouse.up();
        const after = await page.$eval('#ttw-videotk-toggle', el => ({
            left: el.getBoundingClientRect().left,
            top: el.getBoundingClientRect().top,
            pressed: el.getAttribute('aria-pressed'),
            saved: localStorage.getItem('ttw-videotk-button-pos')
        }));
        assert.notEqual(after.left, before.x);
        assert.notEqual(after.top, before.y);
        assert.equal(after.pressed, 'false');
        assert.ok(after.saved);
        assert.deepEqual(errors, []);
        console.log('videoTK passed: theater styles restore exactly, button drags and does not toggle.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
