/** 監控頁常客標記冒煙檢查：node Test/monitor_audience_ui.cjs；使用假 SSE。 */
/* global document, getComputedStyle -- 僅在瀏覽器回呼中使用。 */
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
    const testResultClients = new Set();
    let lastTestResult = null;
    let chatCount = 0;
    const emitTestResult = result => {
        lastTestResult = result;
        for (const client of testResultClients) {
            try { client.write(`data: ${JSON.stringify(result)}\n\n`); }
            catch { testResultClients.delete(client); }
        }
    };
    let base = '';
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/api/monitor/sessions') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ok: true,
                sessions: [{
                    id: 'history-1', startedAt: Date.now() - 3600000, endedAt: Date.now() - 1800000,
                    messageCount: 2, joins: 2, likes: 7, chats: 3, platforms: ['TikTok']
                }]
            }));
            return;
        }
        if (url.pathname === '/api/monitor/messages') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ok: true, total: 2, page: 1, pages: 1, pageSize: 200,
                session: { id: 'history-1', startedAt: Date.now() - 3600000, endedAt: Date.now() - 1800000 },
                messages: [
                    { id: 2, t: Date.now() - 1800000, category: 'chat', platform: 'TikTok', user: 'History Two', message: 'older' },
                    { id: 1, t: Date.now() - 1900000, category: 'like', platform: 'TikTok', user: 'History One', message: 'newer' }
                ]
            }));
            return;
        }
        if (req.url === '/api/runtime') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ running: true }));
            return;
        }
        if (req.url === '/status/stream/test-results') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'
            });
            if (lastTestResult) res.write(`data: ${JSON.stringify(lastTestResult)}\n\n`);
            testResultClients.add(res);
            req.on('close', () => testResultClients.delete(res));
            return;
        }
        if (req.url === '/chat' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                const data = JSON.parse(body);
                posts.push({ url: '/chat', data });
                chatCount += 1;
                emitTestResult({
                    testId: data.testId,
                    status: chatCount === 1 ? 'sent' : 'duplicate',
                    remainingMs: chatCount === 1 ? 60000 : 59000,
                    notify: data.testDispatch?.notify
                        ? { status: 'sent', channels: [{ name: 'bark', ok: true }] }
                        : { status: 'skipped', channels: [] }
                });
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
                },
                session: { joins: 2, likes: 7, chats: 3 }
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
        const session = await page.evaluate(() => ({
            hidden: document.querySelector('#monSession').hidden,
            joins: document.querySelector('#monSessionJoins').textContent,
            likes: document.querySelector('#monSessionLikes').textContent,
            chats: document.querySelector('#monSessionChats').textContent
        }));
        assert.deepEqual(session, { hidden: false, joins: '2', likes: '7', chats: '3' });
        const collapsedLayout = await page.evaluate(() => {
            const box = id => document.querySelector(id).getBoundingClientRect().toJSON();
            return { media: box('#monMediaPanel'), raw: box('#monRawPanel'), scroll: box('#monScroll') };
        });
        assert.ok(collapsedLayout.media.height < 80, '折疊的 MediaCache 不應佔用大塊空白');
        assert.ok(collapsedLayout.scroll.height >= 120, '訊息列應保留可讀高度');
        assert.ok(collapsedLayout.scroll.top >= collapsedLayout.raw.bottom, '訊息列應在工具面板之後');

        await page.evaluate(() => { document.querySelector('#monTestPanel').open = true; });
        const targetLayout = await page.evaluate(() => {
            const label = document.querySelector('.mon-test-targets label');
            const box = label.querySelector('input').getBoundingClientRect();
            const text = label.querySelector('span').getBoundingClientRect();
            return {
                direction: getComputedStyle(label).flexDirection,
                boxCenter: box.top + box.height / 2,
                textCenter: text.top + text.height / 2
            };
        });
        assert.equal(targetLayout.direction, 'row');
        assert.ok(Math.abs(targetLayout.boxCenter - targetLayout.textCenter) <= 2);
        const targetLabels = await page.$$eval('.mon-test-targets label', nodes => nodes.map(node => node.textContent.trim()));
        assert.match(targetLabels[0], /Socket／overlay/);
        assert.match(targetLabels[1], /Bark／ntfy/);
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
        await page.click('#monTestNotify');
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
        assert.match(posts[0].data.testId, /\S+/);
        assert.deepEqual(posts[0].data.testDispatch, { socket: true, notify: true });
        assert.equal(posts[0].data.user, 'Preview User');
        assert.equal(posts[0].data.message, 'hi [laughcry]');
        assert.match(posts[0].data.img, /avatar\.png$/);
        assert.match(await page.$eval('#monTestStatus', node => node.textContent), /去重保護/);
        assert.match(await page.$eval('#monTestStatus', node => node.textContent), /通知.*Bark/);

        // 第二次送同文同頭貼：fake 回報 duplicate，頁面應顯示剩餘冷卻。
        await page.click('#monTestSend');
        await page.waitForFunction(() => document.querySelector('#monTestStatus').textContent.includes('重複'));
        assert.equal(posts.length, 2);
        assert.notEqual(posts[1].data.testId, posts[0].data.testId);
        assert.match(await page.$eval('#monTestStatus', node => node.textContent), /去重保護/);

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
            socket: document.querySelector('#monTestSocket').checked,
            notify: document.querySelector('#monTestNotify').checked,
            message: document.querySelector('#monTestMessage').value
        }));
        assert.equal(restored.user, 'Preview User');
        assert.equal(restored.avatar, base + '/avatar.png');
        assert.equal(restored.platform, 'tiktok');
        assert.equal(restored.category, 'chat');
        assert.equal(restored.socket, true);
        assert.equal(restored.notify, true);
        assert.equal(restored.message, '');

        await page.click('#monTestClear');
        const cleared = await page.evaluate(() => ({
            user: document.querySelector('#monTestUser').value,
            avatar: document.querySelector('#monTestAvatar').value,
            platform: document.querySelector('#monTestPlatform').value,
            category: document.querySelector('#monTestCategory').value,
            socket: document.querySelector('#monTestSocket').checked,
            notify: document.querySelector('#monTestNotify').checked,
            previewHidden: document.querySelector('#monTestAvatarPreview').hidden,
            prefs: localStorage.getItem('ttw-monitor-test-prefs')
        }));
        assert.deepEqual(cleared, {
            user: '', avatar: '', platform: 'tiktok', category: 'chat',
            socket: true, notify: false, previewHidden: true, prefs: null
        });

        await page.click('#monModeHistory');
        await page.waitForFunction(() => !document.querySelector('#monHistoryBar').hidden
            && document.querySelectorAll('#monRows .mon-row').length === 2);
        const history = await page.evaluate(() => ({
            options: document.querySelectorAll('#monHistorySession option').length,
            page: document.querySelector('#monHistoryPage').textContent,
            total: document.querySelector('#monHistoryTotal').textContent,
            status: document.querySelector('#monStatus').textContent,
            clearDisabled: document.querySelector('#monClear').disabled
        }));
        assert.equal(history.options, 1);
        assert.match(history.page, /1 \/ 1/);
        assert.match(history.total, /2/);
        assert.match(history.status, /歷史模式/);
        assert.equal(history.clearDisabled, true);
        await page.click('#monModeLive');
        await page.waitForFunction(() => document.querySelector('#monHistoryBar').hidden);
        assert.equal(posts.length, 2);
        assert.deepEqual(errors, []);
        console.log('Monitor UI passed: audience badges, emoji preview, exact results, and history mode.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
