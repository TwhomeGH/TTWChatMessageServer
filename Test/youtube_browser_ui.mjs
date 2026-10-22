import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { browserPath } = require('./browser_path.cjs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixtureServer() {
    const chat = `<!doctype html><html><body>
        <div id="chat">
            <yt-live-chat-text-message-renderer id="msg-1">
                <img id="author-photo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
                <span id="author-name">Alice</span>
                <span id="message">hello</span>
                <time datetime="2026-10-23T00:00:00Z"></time>
            </yt-live-chat-text-message-renderer>
        </div>
        <script>
            setTimeout(() => {
                const el = document.createElement('yt-live-chat-text-message-renderer');
                el.id = 'msg-2';
                el.innerHTML = '<img id="author-photo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><span id="author-name">Bob</span><span id="message">second</span><time datetime="2026-10-23T00:00:01Z"></time>';
                document.getElementById('chat').appendChild(el);
            }, 400);
        </script>
    </body></html>`;
    const watch = `<!doctype html><html><body>
        <iframe id="chatframe" src="/live_chat?v=testVideo" style="width:480px;height:320px"></iframe>
    </body></html>`;
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        if (pathname === '/watch') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(watch);
            return;
        }
        if (pathname === '/live_chat') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(chat);
            return;
        }
        res.statusCode = 404;
        res.end('not found');
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('YouTube 瀏覽器 fallback 會從實際觀看頁的聊天 iframe 收到訊息', async t => {
    let executable;
    try {
        executable = browserPath();
    } catch {
        t.skip('找不到 Chrome/Edge，略過瀏覽器 fallback 測試');
        return;
    }

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ttw-youtube-browser-'));
    const previous = {
        path: process.env.YOUTUBE_BROWSER_PATH,
        profile: process.env.YOUTUBE_BROWSER_PROFILE,
        headless: process.env.YOUTUBE_BROWSER_HEADLESS
    };
    process.env.YOUTUBE_BROWSER_PATH = executable;
    process.env.YOUTUBE_BROWSER_PROFILE = profile;
    process.env.YOUTUBE_BROWSER_HEADLESS = '1';

    const server = await fixtureServer();
    const address = server.address();
    const received = [];
    const { startYoutubeBrowser, stopYoutubeBrowser } = await import('../ScriptLib/youtube/browser.mjs');

    try {
        await startYoutubeBrowser({
            videoId: 'testVideo',
            url: `http://127.0.0.1:${address.port}/watch`,
            deps: {
                onText: payload => received.push(payload),
                writeLog: () => {}
            }
        });
        const deadline = Date.now() + 10000;
        while (received.length < 2 && Date.now() < deadline) await delay(100);
        assert.equal(received.length, 2);
        assert.deepEqual(received.map(item => [item.user, item.message]), [['Alice', 'hello'], ['Bob', 'second']]);
    } finally {
        await stopYoutubeBrowser();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(profile, { recursive: true, force: true });
        if (previous.path === undefined) delete process.env.YOUTUBE_BROWSER_PATH;
        else process.env.YOUTUBE_BROWSER_PATH = previous.path;
        if (previous.profile === undefined) delete process.env.YOUTUBE_BROWSER_PROFILE;
        else process.env.YOUTUBE_BROWSER_PROFILE = previous.profile;
        if (previous.headless === undefined) delete process.env.YOUTUBE_BROWSER_HEADLESS;
        else process.env.YOUTUBE_BROWSER_HEADLESS = previous.headless;
    }
});
