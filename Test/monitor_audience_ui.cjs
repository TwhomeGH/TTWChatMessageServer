/** 監控頁常客標記冒煙檢查：node Test/monitor_audience_ui.cjs；使用假 SSE。 */
/* global document -- 僅在瀏覽器 waitForFunction 回呼中使用。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { serveWebAsset } = require('../WebAssets.cjs');
const { browserPath } = require('./browser_path.cjs');

async function main() {
    const { default: puppeteer } = await import('puppeteer-core');
    const png = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
        '0000000a49444154789c6360000002000154a24f8f0000000049454e44ae426082', 'hex');
    const posts = [];
    let base = '';
    const server = http.createServer((req, res) => {
        if (req.url === '/api/runtime') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ running: true }));
            return;
        }
        if (req.url === '/chat' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                posts.push({ url: '/chat', data: JSON.parse(body) });
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('OK');
            });
            return;
        }
        if (req.url === '/emoji.png' || req.url === '/avatar.png') {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(png);
            return;
        }
        if (req.url === '/api/emoji/preview') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, map: { '[laughcry]': base + '/emoji.png' } }));
            return;
        }
        if (req.url === '/status/stream/messages') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
            });
            res.write('data: ' + JSON.stringify({
                t: Date.now(), category: 'chat', platform: 'tiktok', user: 'Alice', message: 'hello',
                audience: {
                    level: 3, score: 70, labels: ['alwaysHere', 'giftRegular'],
                    sessions: 12, streak: 6, messages: 40, gifts: 4, tenureDays: 60
                }
            }) + '\n\n');
            return;
        }
        if (req.url === '/api/message-categories') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ categories: ['chat', 'gift'] }));
            return;
        }
        if (req.url === '/monitor') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(path.join(__dirname, '../monitor.html'), 'utf8'));
            return;
        }
        if (serveWebAsset(req, res)) return;
        res.writeHead(404);
        res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: browserPath(), headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.goto(`http://127.0.0.1:${server.address().port}/monitor`);
        await page.waitForFunction(() => document.querySelectorAll('.mon-tag').length === 2);
        const tags = await page.$$eval('.mon-tag', nodes => nodes.map(node => node.textContent));
        assert.deepEqual(tags, ['每次都來', '送禮常客']);
        assert.equal(await page.$eval('.mon-tags', node => node.title.includes('12')), true);

        await page.evaluate(() => { document.querySelector('#monTestPanel').open = true; });
        await page.waitForFunction(() => document.querySelectorAll('#monTestAvatarPick option').length === 2);
        await page.select('#monTestAvatarPick', base + '/emoji.png');
        assert.equal(await page.$eval('#monTestAvatar', node => node.value), base + '/emoji.png');
        await page.waitForFunction(() => {
            const image = document.querySelector('#monTestAvatarPreview');
            return image && !image.hidden && image.src.endsWith('/emoji.png');
        });

        await page.evaluate(avatar => {
            const user = document.querySelector('#monTestUser');
            user.value = 'Preview User';
            user.dispatchEvent(new Event('input', { bubbles: true }));
            const image = document.querySelector('#monTestAvatar');
            image.value = avatar;
            image.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('#monTestMessage').value = 'hi [laughcry]';
        }, base + '/avatar.png');
        await page.click('#monTestAdd');
        await page.waitForFunction(() => document.querySelectorAll('.mon-test').length === 1);
        await page.waitForFunction(() => Boolean(document.querySelector('.mon-test .mon-emoji')));
        const preview = await page.evaluate(() => {
            const row = document.querySelector('.mon-test');
            return {
                badge: row.querySelector('.mon-test-badge')?.textContent,
                avatar: row.querySelector('.mon-avatar')?.src,
                emoji: row.querySelector('.mon-emoji')?.src,
                title: row.querySelector('.mon-emoji')?.title,
                user: row.querySelector('.mon-user')?.textContent
            };
        });
        assert.equal(preview.badge, '測試');
        assert.match(preview.avatar, /avatar\.png$/);
        assert.match(preview.emoji, /emoji\.png$/);
        assert.match(preview.title, /\[laughcry\]/);
        assert.equal(preview.user, 'Preview User ');
        const align = await page.evaluate(() => {
            const row = document.querySelector('.mon-test');
            const badge = row.querySelector('.mon-test-badge').getBoundingClientRect();
            const chip = row.querySelector('.mon-cat').getBoundingClientRect();
            return { badgeTop: badge.top, chipTop: chip.top, badgeHeight: badge.height, chipHeight: chip.height };
        });
        assert.ok(Math.abs(align.badgeTop - align.chipTop) <= 1);
        assert.ok(Math.abs(align.badgeHeight - align.chipHeight) <= 1);
        assert.equal(posts.length, 0);

        await page.click('#monTestSend');
        await page.waitForFunction(() => document.querySelector('#monTestStatus').textContent.includes('已送出'));
        assert.equal(posts.length, 1);
        assert.equal(posts[0].url, '/chat');
        assert.equal(posts[0].data.type, 'StreamMessage');
        assert.equal(posts[0].data.isTest, true);
        assert.equal(posts[0].data.user, 'Preview User');
        assert.equal(posts[0].data.message, 'hi [laughcry]');
        assert.match(posts[0].data.img, /avatar\.png$/);

        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('#monTestCategory option').length >= 2);
        await page.evaluate(() => { document.querySelector('#monTestPanel').open = true; });
        await page.waitForFunction(() => {
            const image = document.querySelector('#monTestAvatarPreview');
            return image && !image.hidden && image.src.endsWith('/avatar.png');
        });
        const restored = await page.evaluate(() => ({
            user: document.querySelector('#monTestUser').value,
            avatar: document.querySelector('#monTestAvatar').value,
            platform: document.querySelector('#monTestPlatform').value,
            category: document.querySelector('#monTestCategory').value,
            message: document.querySelector('#monTestMessage').value
        }));
        assert.equal(restored.user, 'Preview User');
        assert.equal(restored.avatar, base + '/avatar.png');
        assert.equal(restored.platform, 'tiktok');
        assert.equal(restored.category, 'chat');
        assert.equal(restored.message, '');

        await page.click('#monTestClear');
        const cleared = await page.evaluate(() => ({
            user: document.querySelector('#monTestUser').value,
            avatar: document.querySelector('#monTestAvatar').value,
            platform: document.querySelector('#monTestPlatform').value,
            category: document.querySelector('#monTestCategory').value,
            previewHidden: document.querySelector('#monTestAvatarPreview').hidden,
            prefs: localStorage.getItem('ttw-monitor-test-prefs')
        }));
        assert.deepEqual(cleared, {
            user: '', avatar: '', platform: 'tiktok', category: 'chat', previewHidden: true, prefs: null
        });
        assert.equal(posts.length, 1);
        assert.deepEqual(errors, []);
        console.log('Monitor UI passed: audience badges, emoji preview, local prefs, and explicit socket test POST.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
