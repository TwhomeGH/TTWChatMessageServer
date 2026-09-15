import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { BrowserSession } from '../ScriptLib/browser/session.mjs';
import configModule from '../ScriptLib/browser/config.cjs';
import controllerModule from '../ScriptLib/browser/controller.cjs';
import routes from '../ScriptLib/browser/routes.cjs';

/** 模擬瀏覽器分頁；關閉事件可驗證管理器只清理自己的資源。 */
class Page extends EventEmitter {
    closed = false;
    async close() { this.closed = true; this.emit('close'); }
}
class Browser extends EventEmitter {
    connected = true;
    userPage = new Page();
    async newPage() { return new Page(); }
    async disconnect() { this.connected = false; this.emit('disconnected'); }
    async close() { throw Error('不可關閉使用者瀏覽器'); }
}

test('連線合併並使用原生 viewport，停止只關閉自有分頁', async () => {
    const browser = new Browser();
    let calls = 0;
    const session = new BrowserSession(async options => {
        calls++;
        assert.equal(options.defaultViewport, null);
        return browser;
    }, { browserURL: 'http://127.0.0.1:9222' });
    await Promise.all([session.connect(), session.connect()]);
    assert.equal(calls, 1);
    const owned = await session.newPage();
    await session.disconnect();
    assert.equal(owned.closed, true);
    assert.equal(browser.userPage.closed, false);
});

test('初次失敗與外部斷線後，下一次可以重新連線', async () => {
    let calls = 0;
    const session = new BrowserSession(async () => {
        if (++calls === 1) throw Error('not running');
        return new Browser();
    }, { browserURL: 'http://127.0.0.1:9222' });
    await assert.rejects(session.connect(), /not running/);
    const first = await session.connect();
    await first.disconnect();
    assert.notEqual(await session.connect(), first);
    assert.equal(calls, 3);
    await session.disconnect();
});

test('只允許本機偵錯端點，專用 profile 與啟動參數不關閉 sandbox', () => {
    for (const value of ['http://192.168.1.2:9222', 'https://127.0.0.1:9222', 'http://user:pass@localhost', 'http://localhost/a']) {
        assert.throws(() => configModule.browserConfig({ BROWSER_DEBUG_URL: value }), /本機/);
    }
    const config = configModule.browserConfig({ LOCALAPPDATA: '/temporary-test-root' });
    assert.ok(config.profile.endsWith('browser-profile'));
    const args = controllerModule.launchArgs(config);
    assert.ok(args.includes('--user-data-dir=' + config.profile));
    assert.equal(args.some(arg => arg.includes('headless') || arg.includes('no-sandbox')), false);
});

test('控制台只回傳頁面摘要，不包含簽名 query 或 Cookie', async () => {
    const controller = controllerModule.createController({ browserURL: 'http://127.0.0.1:9222', profile: '/profile' }, {
        fetch: async () => ({ ok: true, json: async () => [
            { type: 'page', id: '1', title: 'TikTok', url: 'https://www.tiktok.com/@user?token=secret#fragment', webSocketDebuggerUrl: 'secret' },
            { type: 'service_worker', id: '2', url: 'secret' }
        ] })
    });
    assert.deepEqual((await controller.status()).pages, [
        { id: '1', title: 'TikTok', url: 'https://www.tiktok.com/@user' }
    ]);
    await assert.rejects(controller.show('unknown'), /已關閉/);
});

/** 模擬瀏覽器發出的 HTTP 請求，不啟動真實 Chrome 或讀取登入資料。 */
function request(handler, method, url, headers, body = {}) {
    return new Promise((resolve, reject) => {
        const req = Readable.from([Buffer.from(JSON.stringify(body))]);
        Object.assign(req, { method, url, headers });
        const res = {
            writeHead(status) { this.status = status; },
            end(data) { resolve({ status: this.status, data: JSON.parse(data) }); }
        };
        handler(req, res, true).catch(reject);
    });
}

test('控制動作拒絕跨站 Origin 與 DNS rebinding Host，允許本機操作', async () => {
    const origin = 'http://127.0.0.1:3332';
    let starts = 0;
    const handler = routes.createHandler({ start: async () => { starts++; } }, origin);
    const headers = { host: '127.0.0.1:3332', origin, 'content-type': 'application/json' };
    assert.equal((await request(handler, 'POST', '/api/browser/start', { ...headers, origin: 'https://evil.example' })).status, 403);
    assert.equal((await request(handler, 'POST', '/api/browser/start', { ...headers, host: 'evil.example' })).status, 403);
    assert.equal(starts, 0);
    assert.equal((await request(handler, 'POST', '/api/browser/start', headers)).status, 200);
    assert.equal(starts, 1);
});

test('關閉期間完成的延遲連線會斷開，不遺留控制連線', async () => {
    let resolve;
    const browser = new Browser();
    const session = new BrowserSession(() => new Promise(done => { resolve = done; }), {});
    const pending = session.connect();
    await Promise.resolve();
    await session.disconnect();
    resolve(browser);
    await assert.rejects(pending, /取消/);
    assert.equal(browser.connected, false);
    assert.equal(session.browser, null);
});

test('顯示分頁會還原視窗，完成後只斷開暫時控制連線', async () => {
    const commands = [];
    let disconnected = false;
    const controller = controllerModule.createController({ browserURL: 'http://127.0.0.1:9222' }, {
        fetch: async () => ({ ok: true, json: async () => [{ type: 'page', id: '1', url: 'https://www.tiktok.com/' }] }),
        connect: async () => ({
            target: () => ({ createCDPSession: async () => ({
                send: async (method, params) => { commands.push([method, params]); return { windowId: 2 }; },
                detach: async () => {}
            }) }),
            disconnect: async () => { disconnected = true; }
        })
    });
    await controller.show('1');
    assert.deepEqual(commands[1], ['Browser.setWindowBounds', { windowId: 2, bounds: { windowState: 'normal' } }]);
    assert.equal(disconnected, true);
});

test('主服務登入保護涵蓋頁面、狀態與控制 API', async () => {
    let calls = 0;
    const handler = routes.createHandler({
        status: async () => { calls++; return { connected: false, pages: [] }; },
        start: async () => { calls++; }
    });
    async function invoke(url, authorized, method = 'GET') {
        const req = Readable.from([]);
        Object.assign(req, { url, method, headers: { host: 'localhost:3332' } });
        let status, body;
        const res = { writeHead(code) { status = code; }, end(value) { body = String(value); } };
        await handler(req, res, authorized);
        return { status, body };
    }
    const login = await invoke('/browser', false);
    assert.equal(login.status, 200);
    assert.ok(login.body.includes("REDIRECT_AFTER_LOGIN='/browser'"));
    assert.equal((await invoke('/api/browser/status', false)).status, 401);
    assert.equal((await invoke('/api/browser/start', false, 'POST')).status, 401);
    assert.equal(calls, 0);
    const state = await invoke('/api/browser/status', true);
    assert.equal(state.status, 200);
    assert.equal(JSON.parse(state.body).connected, false);
    assert.equal(calls, 1);
    const page = await invoke('/browser', true);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('/api/browser/status'));
});
