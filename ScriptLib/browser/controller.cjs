const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { browserConfig } = require('./config.cjs');

/** 尋找本機安裝的 Chrome/Edge；不下載瀏覽器、不使用日常 profile。 */
function findBrowser(config, env = process.env, platform = process.platform) {
    const candidates = [config.executable];
    if (platform === 'win32') {
        for (const root of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
            candidates.push(path.join(root, 'Google/Chrome/Application/chrome.exe'));
            candidates.push(path.join(root, 'Microsoft/Edge/Application/msedge.exe'));
        }
    } else if (platform === 'darwin') {
        candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    } else {
        candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
    }
    const executable = candidates.find(candidate => candidate && fs.existsSync(candidate));
    if (!executable) throw Object.assign(new Error('找不到 Chrome/Edge，請設定 BROWSER_EXECUTABLE 完整路徑'), { code: 'BROWSER_NOT_FOUND' });
    return executable;
}

/** 專用 profile 與可見視窗啟動參數，保留 Chrome 預設 sandbox。 */
function launchArgs(config) {
    return [
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=' + config.port,
        '--user-data-dir=' + config.profile,
        '--no-first-run', '--no-default-browser-check',
        '--new-window', 'https://www.tiktok.com/'
    ];
}

/** 對本機 CDP 的每個操作都有期限；錯誤不包含 Cookie 或完整頁面 URL。 */
function createController(config = browserConfig(), deps = {}) {
    const request = deps.fetch || fetch;
    const spawnBrowser = deps.spawn || spawn;
    let launching = null;
    async function cdp(route, method = 'GET') {
        const response = await request(config.browserURL + route, {
            method, signal: AbortSignal.timeout(3000), redirect: 'error'
        });
        if (!response.ok) throw new Error('瀏覽器回應失敗：' + response.status);
        return response;
    }
    async function tabs() {
        return (await (await cdp('/json/list')).json()).filter(tab => tab.type === 'page');
    }
    async function status() {
        try {
            const pages = await tabs();
            return { connected: true, profile: config.profile, pages: pages.map(tab => {
                let url = '';
                try { const parsed = new URL(tab.url); url = parsed.origin + parsed.pathname; } catch {}
                return { id: tab.id, title: tab.title, url };
            }) };
        } catch {
            return { connected: false, profile: config.profile, pages: [] };
        }
    }
    async function start() {
        if ((await status()).connected) return;
        if (launching) return launching;
        launching = (async () => {
            const executable = (deps.findBrowser || findBrowser)(config);
            fs.mkdirSync(config.profile, { recursive: true });
            const child = spawnBrowser(executable, launchArgs(config), {
                detached: true, stdio: 'ignore', windowsHide: false
            });
            let failure;
            child.once('error', error => { failure = error; });
            child.unref();
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline) {
                if (failure) throw failure;
                if ((await status()).connected) return;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            throw Object.assign(new Error('瀏覽器未就緒，請確認 profile 未被其他程序鎖定及偵錯埠設定'), { code: 'BROWSER_START_TIMEOUT' });
        })().finally(() => { launching = null; });
        return launching;
    }
    async function show(id) {
        const pages = await tabs();
        const tab = id ? pages.find(page => page.id === id) : pages.find(page => page.url.startsWith('https://www.tiktok.com/'));
        if (id && !tab) throw Object.assign(new Error('分頁已關閉，請重新整理'), { code: 'TAB_CLOSED' });
        if (tab) {
            // 先啟用分頁，再還原最小化視窗；顯示操作由使用者按鈕明確觸發。
            await cdp('/json/activate/' + encodeURIComponent(tab.id));
            const connect = deps.connect || (async options => {
                const { default: puppeteer } = await import('puppeteer-core');
                return puppeteer.connect(options);
            });
            const client = await connect({ browserURL: config.browserURL, defaultViewport: null, protocolTimeout: 5000 });
            try {
                const session = await client.target().createCDPSession();
                const { windowId } = await session.send('Browser.getWindowForTarget', { targetId: tab.id });
                await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
                await session.detach();
            } finally { await client.disconnect(); }
        }
        else await cdp('/json/new?' + encodeURIComponent('https://www.tiktok.com/'), 'PUT');
    }
    return { status, start, show };
}
module.exports = { createController, launchArgs, findBrowser };
