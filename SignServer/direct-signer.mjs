/**
 * X-Bogus signer using TikTok's own SDK with Puppeteer.
 * Uses byted_acrawler.frontierSign() — TikTok SDK's new signing API.
 */
import { BrowserSession } from '../ScriptLib/browser/session.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_DIR = path.resolve(__dirname, './sdk');

const session = new BrowserSession(async options => {
    const { default: puppeteer } = await import('puppeteer-core');
    const response = await fetch(options.browserURL + '/json/version', {
        signal: AbortSignal.timeout(5000), redirect: 'error'
    });
    if (!response.ok) throw new Error('瀏覽器未就緒，請執行 主服務 /browser');
    const endpoint = new URL((await response.json()).webSocketDebuggerUrl);
    if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
        throw new Error('瀏覽器回傳的偵錯位址不是本機');
    }
    const { browserURL, ...connectOptions } = options;
    return puppeteer.connect({ ...connectOptions, browserWSEndpoint: endpoint.href });
});

let initializing = null;
let retryAfter = 0;

let browser = null;
let page = null;
let wsPage = null;
let livePage = null;
let liveWsReady = false;
let ready = false;

/** 連線失敗冷卻 10 秒，避免收訊重試大量建立控制連線。 */
export async function initDirectSigner() {
    if (ready && browser?.connected && page && !page.isClosed()) return true;
    if (initializing) return initializing;
    if (Date.now() < retryAfter) throw new Error('瀏覽器尚未就緒，請在 主服務 /browser 控制台登入後再試');
    initializing = initialize().catch(async error => {
        retryAfter = Date.now() + 10000;
        await closeDirectSigner();
        throw error;
    }).finally(() => { initializing = null; });
    return initializing;
}

/** 初始化自有簽名頁，使用持久化瀏覽器的原生環境。 */
async function initialize() {
    ready = false;

    console.log('[DirectSigner] Loading SDK (v5.1.3)...');
    const sdk513 = fs.readFileSync(path.join(SDK_DIR, 'webmssdk_5.1.3.js'), 'utf-8');

    console.log('[DirectSigner] Connecting to dedicated browser (主服務 /browser)...');
    browser = await session.connect();
    browser.once('disconnected', () => { ready = false; liveWsReady = false; });
    page = await session.newPage();
    await setTikTokCookies(page);

    // Inject v5.1.3 SDK (provides byted_acrawler.frontierSign)
    await page.evaluateOnNewDocument((code) => { try { eval(code); } catch(e) { console.error('[SDK] v5.1.3 error:', e.message); } }, sdk513);

    console.log('[DirectSigner] Navigating to TikTok...');
    try {
        await page.goto('https://www.tiktok.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
    } catch (e) {
        console.log('[DirectSigner] Navigation warning:', e.message);
    }

    await new Promise(r => setTimeout(r, 3000));

    const sdkStatus = await page.evaluate(() => {
        const hasAcrawler = !!window.byted_acrawler;
        const hasFrontierSign = hasAcrawler && typeof window.byted_acrawler.frontierSign === 'function';
        return { hasAcrawler, hasFrontierSign };
    });

    console.log('[DirectSigner] SDK status:', JSON.stringify(sdkStatus));

    if (!sdkStatus.hasFrontierSign) {
        throw new Error('byted_acrawler.frontierSign not available');
    }

    ready = true;
    console.log('[DirectSigner] Ready to sign');
    return true;
}

export async function directSign(url) {
    await initDirectSigner();

    const result = await page.evaluate((fetchUrl) => {
        const u = new URL(fetchUrl);
        u.searchParams.delete('X-Bogus');
        u.searchParams.delete('X-Gnarly');
        u.searchParams.delete('msToken');
        const queryString = u.search.slice(1);

        if (typeof window.byted_acrawler?.frontierSign !== 'function') {
            return { error: 'frontierSign not available' };
        }

        try {
            const signed = window.byted_acrawler.frontierSign(queryString);
            const xb = signed?.['X-Bogus'];
            if (!xb) return { error: 'X-Bogus computation returned empty' };

            u.searchParams.set('X-Bogus', xb);
            return { xBogus: xb, signedUrl: u.toString() };
        } catch (e) {
            return { error: e.message };
        }
    }, url);

    if (result.error) throw new Error(result.error);

    return {
        xBogus: result.xBogus,
        signedUrl: result.signedUrl,
    };
}

/**
 * Sign a WebSocket URL using TikTok SDK's WS-specific method:
 * frontierSign({"X-MS-PAYLOAD": ""}) — different from HTTP signing where query string is passed.
 */
export async function signWsUrl(wsUrl) {
    if (!ready) throw new Error('Signer not initialized');

    const result = await page.evaluate((rawUrl) => {
        const u = new URL(rawUrl);
        u.searchParams.delete('X-Bogus');
        u.searchParams.delete('X-Gnarly');

        if (typeof window.byted_acrawler?.frontierSign !== 'function') {
            return { error: 'frontierSign not available' };
        }

        try {
            // WS signing uses empty X-MS-PAYLOAD object, NOT the query string
            const signed = window.byted_acrawler.frontierSign({ "X-MS-PAYLOAD": "" });
            const xb = signed?.['X-Bogus'];
            if (!xb) return { error: 'X-Bogus computation returned empty' };

            u.searchParams.set('X-Bogus', xb);
            return { xBogus: xb, signedUrl: u.toString() };
        } catch (e) {
            return { error: e.message };
        }
    }, wsUrl);

    if (result.error) throw new Error(result.error);

    return {
        xBogus: result.xBogus,
        signedUrl: result.signedUrl,
    };
}

async function setTikTokCookies(page) {
    if (process.env.DIRECT_SIGNER_IMPORT_COOKIES !== '1') return;
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (cookiesStr) {
        const cookies = cookiesStr.split(';').map(pair => {
            const [name, ...rest] = pair.trim().split('=');
            return { name: name.trim(), value: rest.join('=').trim(), domain: '.tiktok.com' };
        }).filter(c => c.name && c.value);
        await page.browserContext().setCookie(...cookies);
        console.log(`[DirectSigner] Set ${cookies.length} cookies from TIKTOK_COOKIES`);
        return;
    }
    const sessionId = process.env.SESSION_ID;
    const targetIdc = process.env.TT_TARGET_IDC || 'alisg';
    if (sessionId) {
        await page.browserContext().setCookie(
            { name: 'sessionid', value: sessionId, domain: '.tiktok.com' },
            { name: 'sid_tt', value: sessionId, domain: '.tiktok.com' },
            { name: 'sessionid_ss', value: sessionId, domain: '.tiktok.com' },
            { name: 'sid_guard', value: sessionId, domain: '.tiktok.com' },
            { name: 'tt-target-idc', value: targetIdc, domain: '.tiktok.com' },
            { name: 'store-idc', value: targetIdc, domain: '.tiktok.com' },
        );
        console.log(`[DirectSigner] Set fallback session cookies`);
    } else {
        console.warn('[DirectSigner] No TIKTOK_COOKIES or SESSION_ID');
    }
}

export async function signWebSocketForUser(username, timeoutMs = 20000) {
    await initDirectSigner();

    console.log(`[DirectSigner] Navigating to ${username}'s LIVE page for WS URL capture...`);

    if (wsPage && !wsPage.isClosed()) {
        try { await wsPage.close(); } catch (e) {}
    }
    wsPage = await session.newPage();

    await setTikTokCookies(wsPage);

    const sdk513 = fs.readFileSync(path.join(SDK_DIR, 'webmssdk_5.1.3.js'), 'utf-8');
    await wsPage.evaluateOnNewDocument((code) => { try { eval(code); } catch(e) {} }, sdk513);

    await wsPage.evaluateOnNewDocument(() => {
        window.__capturedWsUrls = [];
        const OrigWS = window.WebSocket;
        window.WebSocket = function(url, protocols) {
            const urlStr = typeof url === 'string' ? url : url.toString();
            window.__capturedWsUrls.push({ url: urlStr, time: Date.now() });
            return new OrigWS(url, protocols);
        };
        window.WebSocket.prototype = OrigWS.prototype;
        window.WebSocket.CONNECTING = OrigWS.CONNECTING;
        window.WebSocket.OPEN = OrigWS.OPEN;
        window.WebSocket.CLOSING = OrigWS.CLOSING;
        window.WebSocket.CLOSED = OrigWS.CLOSED;
    });

    const liveUrl = `https://www.tiktok.com/@${username}/live`;
    console.log(`[DirectSigner] Navigating to ${liveUrl}...`);
    try {
        await wsPage.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
        console.log(`[DirectSigner] Navigation warning: ${e.message}`);
    }

    try {
        const pageInfo = await wsPage.evaluate(() => ({
            url: location.href,
            title: document.title,
            bodyLen: document.body?.innerText?.length || 0,
            wsCount: window.__capturedWsUrls?.length || 0,
            hasAkamai: document.body?.innerText?.includes('Reference') || false,
            hasBlock: document.body?.innerText?.includes('blocked') || false,
        }));
        console.log(`[DirectSigner] Page state:`, JSON.stringify(pageInfo));
    } catch (e) {
        console.log(`[DirectSigner] Page diag failed: ${e.message}`);
    }

    const start = Date.now();
    let capturedWsUrl = null;
    while (Date.now() - start < timeoutMs) {
        const urls = await wsPage.evaluate(() => {
            const arr = window.__capturedWsUrls || [];
            const len = arr.length;
            window.__capturedWsUrls = [];
            return len > 0 ? arr.map(x => x.url) : [];
        });
        for (const u of urls) {
            if (u.includes('webcast-ws')) {
                capturedWsUrl = u;
                console.log(`[DirectSigner] Captured webcast-ws URL`);
                break;
            }
        }
        if (!capturedWsUrl && Date.now() - start > timeoutMs - 3000) {
            for (const u of urls) {
                if (u.includes('wss://') && u.includes('room_id')) {
                    capturedWsUrl = u;
                    console.log(`[DirectSigner] Captured wss URL (fallback)`);
                    break;
                }
            }
        }
        if (capturedWsUrl) {
            console.log('[DirectSigner] WS URL captured');
            break;
        }
        await new Promise(r => setTimeout(r, 200));
    }

    if (!capturedWsUrl) {
        console.warn(`[DirectSigner] No WS URL captured within ${timeoutMs/1000}s`);
        return null;
    }

    const parsed = new URL(capturedWsUrl);
    const capturedPushServer = parsed.origin + parsed.pathname;
    const capturedRouteParams = {};
    for (const [key, value] of parsed.searchParams.entries()) {
        capturedRouteParams[key] = value;
    }

    let cookies = {};
    try {
        const pageCookies = await wsPage.browserContext().cookies();
        for (const c of pageCookies) {
            cookies[c.name] = c.value;
        }
    } catch (e) {
        console.warn('[DirectSigner] Cookie capture failed:', e.message);
    }

    console.log(`[DirectSigner] Captured WS URL - pushServer: ${capturedPushServer}`);
    // 不把簽名查詢參數或登入資料寫入日誌。

    try { await wsPage.close(); } catch (e) {}

    return {
        pushServer: capturedPushServer,
        routeParams: capturedRouteParams,
        fullUrl: capturedWsUrl,
        cookies
    };
}

export function isLiveWsReady() {
    return liveWsReady;
}

export async function initLivePage(username, timeoutMs = 20000) {
    if (!browser) throw new Error('Signer not initialized');
    if (livePage && !livePage.isClosed()) {
        try { await livePage.close(); } catch (e) {}
    }
    livePage = null;
    liveWsReady = false;

    const page = await session.newPage();

    await page.evaluateOnNewDocument(() => {
        const captured = [];
        let liveWs = null;
        const OrigWS = window.WebSocket;
        window.WebSocket = function(url, protocols) {
            const ws = new OrigWS(url, protocols);
            const urlStr = typeof url === 'string' ? url : url.toString();
            if (urlStr.includes('webcast-ws')) {
                captured.push({ type: 'created', url: urlStr, time: Date.now() });
                console.log('[LiveWS] intercepted:', urlStr.substring(0, 200));
                liveWs = ws;
                ws.addEventListener('message', (event) => {
                    if (event.data instanceof Blob) {
                        event.data.arrayBuffer().then(buf => {
                            captured.push({ type: 'message', data: Array.from(new Uint8Array(buf)), time: Date.now() });
                        });
                    } else {
                        captured.push({ type: 'message', data: event.data, time: Date.now() });
                    }
                });
                ws.addEventListener('close', (evt) => {
                    captured.push({ type: 'close', code: evt.code ?? 0, reason: evt.reason || '', time: Date.now() });
                    console.log('[LiveWS] close:', evt.code ?? '?', evt.reason || '');
                    liveWs = null;
                });
                ws.addEventListener('error', () => {
                    captured.push({ type: 'error', message: 'WS error', time: Date.now() });
                });
                ws.addEventListener('open', () => {
                    window.__wsReady = true;
                });
            }
            return ws;
        };
        window.WebSocket.prototype = OrigWS.prototype;
        window.__wsMessageQueue = [];
        window.__wsPoll = function() {
            if (liveWs && liveWs.readyState === 1) window.__wsReady = true;
            const q = window.__wsMessageQueue;
            window.__wsMessageQueue = [];
            return q;
        };
        window.__wsSend = function(b64) {
            if (!liveWs || liveWs.readyState !== 1) return false;
            liveWs.send(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
            return true;
        };
        window.__wsDiag = function() {
            return { wsReadyState: liveWs ? liveWs.readyState : -1, queueLen: captured.length };
        };
        setInterval(() => {
            while (captured.length > 0) {
                const evt = captured.shift();
                window.__wsMessageQueue.push(evt);
            }
        }, 10);
    });

    await setTikTokCookies(page);
    const liveUrl = `https://www.tiktok.com/@${username}/live`;
    console.log(`[DirectSigner] Navigating to ${liveUrl}...`);
    try {
        await page.goto(liveUrl, { waitUntil: 'networkidle0', timeout: 45000 });
    } catch (e) {
        console.warn(`[DirectSigner] Nav warning: ${e.message}`);
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const ready = await page.evaluate(() => window.__wsReady === true);
        if (ready) {
            liveWsReady = true;
            livePage = page;
            console.log('[DirectSigner] Live WS ready');
            return true;
        }
        await new Promise(r => setTimeout(r, 200));
    }

    console.warn(`[DirectSigner] Live WS not ready within ${timeoutMs/1000}s`);
    try { await page.close(); } catch(e) {}
    return false;
}

export async function pollLiveMessages() {
    if (!livePage || livePage.isClosed()) return [];
    try {
        return await livePage.evaluate(() => {
            const q = window.__wsMessageQueue || [];
            const len = q.length;
            window.__wsMessageQueue = [];
            return q.map(m => ({
                type: m.type,
                data: m.data instanceof Array ? new Uint8Array(m.data) : m.data,
                time: m.time
            }));
        });
    } catch (e) {
        return [];
    }
}

export async function wsDiagnostic() {
    if (!livePage || livePage.isClosed()) return { error: 'no page' };
    try {
        return await livePage.evaluate(() => {
            if (typeof window.__wsDiag === 'function') return window.__wsDiag();
            return { error: '__wsDiag not available' };
        });
    } catch (e) {
        return { error: e.message };
    }
}

let fetchPage = null;
let fetchPageCreated = 0;
export async function browserFetchSigned(params) {
    if (!browser) throw new Error('Signer not initialized');

    // Refresh fetch page every 5 minutes to prevent staleness
    const now = Date.now();
    if (!fetchPage || fetchPage.isClosed() || (now - fetchPageCreated > 300000)) {
        if (fetchPage && !fetchPage.isClosed()) {
            try { await fetchPage.close(); } catch(e) {}
        }
        fetchPage = await session.newPage();
        await setTikTokCookies(fetchPage);
        await fetchPage.goto('https://www.tiktok.com/', { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
        fetchPageCreated = now;
        console.log('[DirectSigner] Fetch page ready');
    }

    const rawBytes = await fetchPage.evaluate(async ({ roomId, cursor }) => {
        const p = (k, v) => [k, v];
        const params = new URLSearchParams([
            p('version_code', '180800'),
            p('device_platform', 'web'),
            p('cookie_enabled', 'true'),
            p('screen_width', String(screen.width)),
            p('screen_height', String(screen.height)),
            p('browser_language', navigator.language),
            p('browser_platform', navigator.platform),
            p('browser_name', 'Mozilla'),
            p('browser_version', navigator.userAgent),
            p('browser_online', String(navigator.onLine)),
            p('tz_name', Intl.DateTimeFormat().resolvedOptions().timeZone),
            p('ws_direct', '1'),
            p('aid', '1988'),
            p('app_name', 'tiktok_web'),
            p('live_id', '12'),
            p('version_code', '270000'),
            p('app_language', navigator.language),
            p('client_enter', '1'),
            p('room_id', roomId || ''),
            p('identity', 'audience'),
            p('history_comment_count', '6'),
            p('fetch_rule', '1'),
            p('last_rtt', '-1'),
            p('cursor', cursor || '0'),
            p('internal_ext', '0'),
            p('sup_ws_ds_opt', '1'),
            p('resp_content_type', 'protobuf'),
            p('did_rule', '3'),
            p('webcast_language', navigator.language),
        ]);
        const url = 'https://webcast.tiktok.com/webcast/im/fetch/?' + params.toString();
        const resp = await fetch(url, {
            headers: { 'accept': '*/*', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }
        }).catch(() => null);
        if (!resp) return { bytes: [], status: 0, url: '' };
        const buf = await resp.arrayBuffer();
        return { bytes: Array.from(new Uint8Array(buf)), status: resp.status, url: resp.url.substring(0, 150) };
    }, { roomId: params.room_id, cursor: params.cursor });

    if (!rawBytes || rawBytes.status !== 200) {
        console.warn('[DirectSigner] im/fetch/ status:', rawBytes?.status);
        if (rawBytes?.url) {
            try {
                const ru = new URL(rawBytes.url);
                const xd = ru.searchParams.get('X-Dynosaur') || '';
                if (xd) console.log('[DirectSigner] X-Dynosaur:', xd.substring(0, 60));
            } catch(e) {}
        }
        return null;
    }

    console.log(`[DirectSigner] im/fetch/ OK: ${rawBytes.bytes.length} bytes`);
    return rawBytes.bytes;
}

export async function sendLiveMessage(data) {
    if (!livePage || livePage.isClosed()) return false;
    try {
        const b64 = Buffer.from(data).toString('base64');
        return await livePage.evaluate((b) => window.__wsSend(b), b64);
    } catch (e) {
        return false;
    }
}

export async function closeLivePage() {
    liveWsReady = false;
    if (livePage && !livePage.isClosed()) {
        try { await livePage.close(); } catch(e) {}
    }
    livePage = null;
}

export function resetFetchPage() {
    if (fetchPage && !fetchPage.isClosed()) {
        void fetchPage.close().catch(() => {});
    }
    fetchPage = null;
    fetchPageCreated = 0;
    console.log('[DirectSigner] Fetch page reset');
}

/** 關閉本程序的工作分頁並斷開 CDP，保留瀏覽器及登入視窗。 */
export async function closeDirectSigner() {
    ready = false;
    liveWsReady = false;
    await session.disconnect();
    browser = null;
    page = null;
    wsPage = null;
    livePage = null;
    fetchPage = null;
    fetchPageCreated = 0;
}
