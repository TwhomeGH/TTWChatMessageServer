/** 表情管理頁 UI 冒煙檢查：node Test/emoji_ui.cjs；使用假 API。 */
/* global document -- 僅在瀏覽器回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { browserPath } = require('./browser_path.cjs');

const defaultEntry = { code: 'default', url: 'https://example.com/default.png', enabled: true, source: 'default', isDefault: true, overridden: false };
const disabledDefault = { code: 'disabled', url: 'https://example.com/disabled.png', enabled: false, source: 'default', isDefault: true, overridden: true };
const custom = { code: 'custom', url: 'https://example.com/custom.png', enabled: true, source: 'local', isDefault: false, overridden: true };
let entries = [defaultEntry, disabledDefault, custom];
let revision = 'rev1';
const requests = [];

function api() {
    return {
        success: true,
        map: Object.fromEntries(entries.filter(entry => entry.enabled).map(entry => [entry.code, entry.url])),
        entries, revision, error: null
    };
}

async function main() {
    const html = fs.readFileSync(path.join(__dirname, '../emoji.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '../assets/emoji.js'), 'utf8');
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/emoji') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }
        if (url.pathname === '/assets/emoji.js') {
            res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            res.end(js);
            return;
        }
        if (url.pathname === '/assets/app.css') {
            res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
            res.end('');
            return;
        }
        if (url.pathname === '/api/emoji') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                if (req.method === 'POST') {
                    const action = JSON.parse(body);
                    requests.push(action);
                    if (action.operation === 'set-enabled') {
                        entries = entries.map(entry => entry.code === action.code ? { ...entry, enabled: action.enabled } : entry);
                        revision = 'rev2';
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(api()));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(api()));
            });
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
        await page.goto(base + '/emoji', { waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('#list article').length === 3);
        const cardText = await page.$eval('#list', node => node.textContent);
        assert.match(cardText, /已停用/);
        assert.match(cardText, /恢復預設/);
        assert.match(cardText, /自訂/);
        assert.match(cardText, /刪除/);

        await page.evaluate(() => [...document.querySelectorAll('#list button')].find(button => button.textContent === '啟用').click());
        await page.waitForFunction(() => document.querySelector('#count').textContent.includes('啟用 3'));
        assert.deepEqual(requests[0], {
            operation: 'set-enabled', code: 'disabled', enabled: true, revision: 'rev1'
        });
        assert.deepEqual(errors, []);
        console.log('Emoji UI passed: disabled default is visible, can be enabled, and POST carries revision.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
