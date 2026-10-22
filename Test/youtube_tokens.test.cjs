const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// invalid_grant 是永久性錯誤；只刷新一次、後續直接使用 API Key，避免每次輪詢都打 token endpoint。
test('YouTube refresh 失敗後會冷卻並只記錄一次', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttw-youtube-token-'));
    const tokenFile = path.join(dir, 'tokens.json');
    fs.writeFileSync(tokenFile, JSON.stringify({
        access_token: 'expired',
        refresh_token: 'revoked',
        expires_in: 1,
        obtainmentTimestamp: 1
    }));

    const previousFile = process.env.YOUTUBE_TOKEN_FILE;
    const previousClient = process.env.YOUTUBE_CLIENT_ID;
    const previousSecret = process.env.YOUTUBE_CLIENT_SECRET;
    process.env.YOUTUBE_TOKEN_FILE = tokenFile;
    process.env.YOUTUBE_CLIENT_ID = 'client';
    process.env.YOUTUBE_CLIENT_SECRET = 'secret';

    const modulePath = require.resolve('../ScriptLib/youtube/tokens.cjs');
    delete require.cache[modulePath];
    const tokens = require(modulePath);

    const originalFetch = global.fetch;
    const originalLog = console.log;
    const originalError = console.error;
    let refreshes = 0;
    const logs = [];
    const errors = [];
    global.fetch = async () => {
        refreshes += 1;
        return { ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' };
    };
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => errors.push(args.join(' '));

    try {
        const first = await tokens.getYoutubeAuthParams('api-key');
        const second = await tokens.getYoutubeAuthParams('api-key');
        assert.equal(refreshes, 1);
        assert.equal(first.mode, 'apiKey');
        assert.equal(second.mode, 'apiKey');
        assert.deepEqual(first.params, { key: 'api-key' });
        assert.equal(logs.filter(line => line.includes('API Key')).length, 1);
        assert.equal(errors.filter(line => line.includes('invalid_grant')).length, 1);
    } finally {
        global.fetch = originalFetch;
        console.log = originalLog;
        console.error = originalError;
        delete require.cache[modulePath];
        if (previousFile === undefined) delete process.env.YOUTUBE_TOKEN_FILE;
        else process.env.YOUTUBE_TOKEN_FILE = previousFile;
        if (previousClient === undefined) delete process.env.YOUTUBE_CLIENT_ID;
        else process.env.YOUTUBE_CLIENT_ID = previousClient;
        if (previousSecret === undefined) delete process.env.YOUTUBE_CLIENT_SECRET;
        else process.env.YOUTUBE_CLIENT_SECRET = previousSecret;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
