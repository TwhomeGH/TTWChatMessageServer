/** 通用圖片快取：本地 URL、下載、內容型別、304 與私有位址拒絕。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { MediaCache, hashUrl, normalizeImageUrl } = require('../ScriptLib/media/cache.cjs');
const { createMediaRoutes, createMediaAdminRoutes } = require('../MediaRoutes.cjs');
const { SocketHub } = require('../ScriptLib/socket/hub.mjs');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function fakeServe(cache, hash, method = 'GET', headers = {}) {
    return new Promise(resolve => {
        const req = { method, headers };
        const res = {
            headersSent: false,
            writeHead(status, values = {}) { this.status = status; this.headers = values; this.headersSent = true; },
            end(body) { resolve({ status: this.status, headers: this.headers || {}, body }); }
        };
        cache.serve(req, res, hash).catch(error => resolve({ status: 500, error }));
    });
}

test('MediaCache 把外部 URL 換成本地 hash，下載後可再從快取供應', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttw-media-'));
    const server = http.createServer((req, res) => {
        if (req.url === '/img.png') {
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
            res.end(PNG);
            return;
        }
        if (req.url === '/bad.svg') {
            res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
            res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
            return;
        }
        res.writeHead(404); res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const cache = new MediaCache({
        dbFile: path.join(dir, 'media.sqlite'), imageDir: path.join(dir, 'images'),
        baseUrl: 'http://127.0.0.1:3332', allowPrivateHosts: true
    });
    t.after(async () => {
        cache.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const inline = 'data:image/png;base64,iVBORw0KGgo=';
    assert.equal(cache.localUrl(inline), inline);

    const source = `http://127.0.0.1:${server.address().port}/img.png`;
    const local = cache.localUrl(source);
    const hash = hashUrl(source);
    assert.equal(local, `http://127.0.0.1:3332/media/${hash}`);
    assert.equal(cache.localUrl(source), local);

    const first = await fakeServe(cache, hash);
    assert.equal(first.status, 200);
    assert.equal(first.headers['Content-Type'], 'image/png');
    assert.deepEqual(Buffer.from(first.body), PNG);
    assert.equal(fs.existsSync(cache.filePath(hash)), true);
    const list = cache.list({ q: '127.0.0.1', status: 'cached' });
    assert.equal(list.total, 1);
    assert.equal(list.items[0].hash, hash);
    assert.equal(list.items[0].host, '127.0.0.1');
    assert.equal(list.stats.total, 1);
    assert.ok(list.stats.bytes > 0);

    const second = await fakeServe(cache, hash);
    assert.equal(second.status, 200);
    assert.equal(second.headers.ETag, '"' + hash + '"');
    const notModified = await fakeServe(cache, hash, 'GET', { 'if-none-match': second.headers.ETag });
    assert.equal(notModified.status, 304);

    const svgSource = `http://127.0.0.1:${server.address().port}/bad.svg`;
    const svgHash = hashUrl(svgSource);
    cache.localUrl(svgSource);
    assert.equal((await fakeServe(cache, svgHash)).status, 404);
});

test('MediaCache 拒絕私有位址、SVG 與非 HTTP URL', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttw-media-deny-'));
    const cache = new MediaCache({
        dbFile: path.join(dir, 'media.sqlite'), imageDir: path.join(dir, 'images'),
        baseUrl: 'http://127.0.0.1:3332'
    });
    t.after(() => {
        cache.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    await assert.rejects(cache.ensure('a'.repeat(64), 'http://127.0.0.1:1234/private.png'));
    assert.equal(normalizeImageUrl('data:image/png;base64,abc'), '');
    assert.equal(normalizeImageUrl('file:///etc/passwd'), '');
});

test('MediaAdmin 需要登入並回傳統計與列表', async () => {
    const cache = {
        stats: () => ({ total: 1, bytes: 10, cached: 1, failed: 0, missing: 0 }),
        list: value => ({ items: [{ hash: 'a'.repeat(64) }], total: 1, page: value.page, pages: 1, stats: {} })
    };
    const route = createMediaAdminRoutes(cache);
    const call = (url, authorized) => new Promise(resolve => {
        const req = { url, method: 'GET', headers: {} };
        const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } };
        route(req, res, authorized);
    });
    assert.equal((await call('/api/media', false)).status, 401);
    assert.equal((await call('/api/media/stats', true)).body.stats.total, 1);
    const list = await call('/api/media?page=1', true);
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    assert.equal(route({ url: '/other', method: 'GET' }, {}, true), false);
});

test('MediaRoutes 只接管 /media/<hash> 並呼叫快取', async () => {
    const calls = [];
    const route = createMediaRoutes({
        serve(req, res, hash) { calls.push(hash); res.writeHead(200); res.end(); return Promise.resolve(); }
    });
    const response = await new Promise(resolve => {
        const req = { url: '/media/' + 'a'.repeat(64), method: 'GET', headers: {} };
        const res = {
            writeHead() {}, end() { resolve(true); }
        };
        assert.equal(route(req, res), true);
    });
    assert.equal(response, true);
    assert.deepEqual(calls, ['a'.repeat(64)]);
    assert.equal(route({ url: '/other', method: 'GET', headers: {} }, {}), false);
});

test('SocketHub 送出前改寫 img 與 giftImg', () => {
    const sent = [];
    const hub = new SocketHub({
        mediaCache: { localUrl: value => 'http://media.test/media/' + hashUrl(value) },
        endpoints: [{ enabled: true, accepts: () => true, send: payload => sent.push(payload) }]
    });
    assert.equal(hub.sendMessage('Alice', 'hello', {
        img: 'https://cdn.example/avatar.png', giftImg: 'https://cdn.example/gift.png', category: 'chat'
    }), true);
    assert.match(sent[0].img, /^http:\/\/media\.test\/media\//);
    assert.match(sent[0].giftImg, /^http:\/\/media\.test\/media\//);
});
