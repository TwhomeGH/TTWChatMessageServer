const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

/** 從 Server.js 取出 GET /login 區塊，避免真的啟動主服務。 */
function loginRoute(url) {
    const source = fs.readFileSync(require.resolve('../Server.js'), 'utf8');
    const start = source.indexOf('    // GET /login');
    const end = source.indexOf('\n\n    // 保護的 config API', start);
    assert.ok(start >= 0 && end > start, '找不到 GET /login 路由');

    let status;
    let headers;
    let body;
    const context = {
        URL,
        __dirname: 'ROOT',
        path: { join: (...parts) => parts.join('/') },
        fs: {
            readFile(file, encoding, callback) {
                callback(null, '<html><head><title>登入</title></head><body></body></html>');
            }
        },
        req: { url, method: 'GET', headers: {} },
        res: {
            writeHead(code, values) { status = code; headers = values; },
            end(value) { body = value; }
        }
    };
    vm.runInNewContext(`if (false) {}\n${source.slice(start, end)}`, context);
    return { status, headers, body };
}

test('GET /login 會回傳登入頁，不再 404，也不再預設 /config', () => {
    const result = loginRoute('/login');
    assert.equal(result.status, 200);
    assert.match(result.body, /系統登入|登入/);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.doesNotMatch(result.body, /REDIRECT_AFTER_LOGIN/);
});

test('登入後可回到原始頁面；外部導向不注入 redirect', () => {
    const diagnostics = loginRoute('/login?redirect=%2Fdiagnostics');
    assert.match(diagnostics.body, /REDIRECT_AFTER_LOGIN = "\/diagnostics"/);

    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', '/bad\nlocation']) {
        const result = loginRoute('/login?redirect=' + encodeURIComponent(bad));
        assert.doesNotMatch(result.body, /REDIRECT_AFTER_LOGIN/, bad);
    }
});

test('登入頁沒有明確目標時提供返回上一頁的確認畫面', () => {
    const html = fs.readFileSync(require.resolve('../login.html'), 'utf8');
    assert.match(html, /function safeReturnPath\(/);
    assert.match(html, /function intendedReturn\(/);
    assert.match(html, /document\.referrer/);
    assert.match(html, /id="loginSuccess"/);
    assert.match(html, /history\.back\(\)/);
    assert.match(html, /前往全域設定/);
});
