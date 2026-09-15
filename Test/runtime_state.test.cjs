const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { RuntimeState } = require('../ScriptLib/runtime/state.cjs');
const { serveRuntime, sendRuntimePage } = require('../RuntimeRoutes.cjs');

/** 假程序只記錄 stdin，不啟動直播或發送通知。 */
function child() {
    const proc = new EventEmitter();
    proc.pid = 123;
    proc.writes = [];
    proc.stdin = { write(data, callback) { proc.writes.push(data); callback(); } };
    return proc;
}

test('啟動、運行與優雅停止依實際程序事件更新', () => {
    let now = 1000;
    const state = new RuntimeState(() => now);
    assert.equal(state.snapshot().state, 'stopped');
    const proc = child();
    state.attach(proc, ['twitch']);
    assert.equal(state.snapshot().state, 'starting');
    proc.emit('spawn');
    now += 3000;
    assert.equal(state.snapshot().state, 'running');
    assert.equal(state.snapshot().uptimeMs, 3000);
    state.stop(proc);
    state.stop(proc);
    assert.deepEqual(proc.writes, ['EXIT\n']);
    now += 15000;
    assert.equal(state.snapshot().stopDelayed, true);
    proc.emit('exit', 0, null);
    assert.equal(state.snapshot().state, 'stopped');
    assert.equal(state.snapshot().pid, null);
});

test('啟動失敗、异常退出及舊程序遲到事件不混淆', () => {
    const state = new RuntimeState();
    const first = child();
    state.attach(first);
    first.emit('error', { code: 'ENOENT' });
    assert.equal(state.snapshot().state, 'failed');
    const next = child();
    state.attach(next);
    next.emit('spawn');
    first.emit('exit', 1, null);
    assert.equal(state.snapshot().state, 'running');
    next.emit('exit', 1, null);
    assert.equal(state.snapshot().state, 'failed');
    assert.equal(state.snapshot().exitCode, 1);
});

test('停止寫入失敗不永久停在停止中；重複 close 已停止程序安全', () => {
    const state = new RuntimeState();
    state.stop(null);
    assert.equal(state.snapshot().state, 'stopped');
    const proc = child();
    proc.stdin.write = (data, callback) => callback({ code: 'EPIPE' });
    state.attach(proc);
    proc.emit('spawn');
    state.stop(proc);
    assert.equal(state.snapshot().state, 'running');
    assert.equal(state.snapshot().error, 'EPIPE');
});

test('共用頁不含倒數跳轉，API 回傳程序狀態且不接管舊 status 路由', async () => {
    const state = new RuntimeState();
    let status, body;
    const res = { writeHead(code) { status = code; }, end(data) { body = data; } };
    assert.equal(serveRuntime({ url: '/status', method: 'GET' }, res, state), false);
    assert.equal(serveRuntime({ url: '/api/runtime', method: 'GET' }, res, state), true);
    assert.equal(status, 200);
    assert.equal(JSON.parse(body).state, 'stopped');
    await new Promise(resolve => sendRuntimePage({
        writeHead(code) { status = code; }, end(html) { body = String(html); resolve(); }
    }));
    assert.equal(status, 200);
    assert.ok(body.includes("history.replaceState(null, '', '/runtime')"));
    assert.equal(body.includes('countdown'), false);
});

// 白名單驗證不能把任意 query、CLI 或錯誤型別傳入子程序。
test('視覺化啟動參數只接受白名單並忽略未啟用平台帳號', () => {
    const { startURL } = require('../ScriptLib/runtime/options.cjs');
    const url = startURL({ isTwitch: true, isSocket: true, twitchUser: ' tester ', user: 'unused' });
    assert.equal(url.searchParams.get('isTwitch'), '1');
    assert.equal(url.searchParams.get('twitchUser'), 'tester');
    assert.equal(url.searchParams.has('user'), false);
    for (const body of [null, [], {}, { isTK: '1' }, { isTK: true, user: '--socket' }, { isTK: true, token: 'secret' }]) {
        assert.throws(() => startURL(body), { code: 'INVALID_START_OPTIONS' });
    }
});

// 使用假啟動函數，不建立實際平台連線或通知。
test('JSON 啟動入口驗證方法、來源與重複啟動，回報即時狀態', async () => {
    const { Readable } = require('node:stream');
    const state = new RuntimeState();
    let calls = 0;
    const start = url => {
        if (calls) throw Object.assign(new Error('busy'), { status: 409, code: 'RUNTIME_BUSY' });
        calls++;
        assert.equal(url.searchParams.get('isSocket'), '1');
        state.attach(child(), ['twitch']); return state.snapshot();
    };
    function request(method, origin, body) {
        return new Promise(resolve => {
            const req = Readable.from([JSON.stringify(body)]);
            Object.assign(req, { url: '/api/runtime/start', method, headers: { host: 'localhost:3332', origin, 'content-type': 'application/json' } });
            serveRuntime(req, { writeHead(status) { this.status = status; }, end(data) { resolve({ status: this.status, data: data && JSON.parse(data) }); } }, state, start);
        });
    }
    assert.equal((await request('GET', 'http://localhost:3332', {})).status, 405);
    assert.equal((await request('POST', 'https://other.test', {})).status, 403);
    assert.equal((await request('POST', 'http://localhost:3332', {})).status, 400);
    const result = await request('POST', 'http://localhost:3332', { isTwitch: true, isSocket: true });
    assert.equal(result.status, 202); assert.equal(result.data.state, 'starting');
    assert.equal((await request('POST', 'http://localhost:3332', { isSocket: true })).status, 409);
    assert.equal(calls, 1);
});
