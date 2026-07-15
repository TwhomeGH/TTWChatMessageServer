/**
 * X-Bogus signer using TikTok's own SDK with Puppeteer.
 * Uses byted_acrawler.frontierSign() — TikTok SDK's new signing API.
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_DIR = path.resolve(__dirname, '../node_modules/tiktok-signature/javascript');

puppeteer.use(StealthPlugin());

const BROWSER_URL = process.env.BROWSER_DEBUG_URL || 'http://127.0.0.1:9222';

let browser = null;
let page = null;
let wsPage = null;
let livePage = null;
let liveWsReady = false;
let ready = false;

export async function initDirectSigner() {
    if (ready) return true;

    console.log('[DirectSigner] Loading SDK (v5.1.3)...');
    const sdk513 = fs.readFileSync(path.join(SDK_DIR, 'webmssdk_5.1.3.js'), 'utf-8');

    const isHeaded = process.env.PUPPETEER_HEADED === 'true' || process.env.PUPPETEER_HEADED === '1';
    console.log('[DirectSigner] Launching ' + (isHeaded ? 'headed' : 'headless') + ' browser...');
    browser = await puppeteer.launch({
        headless: isHeaded ? false : 'new',
        args: [
            ...(process.env.DISABLE_SANDBOX === '1' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1920,1080',
        ],
    });

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true });
    });

    // Inject v5.1.3 SDK (provides byted_acrawler.frontierSign)
    await page.evaluateOnNewDocument((code) => { try { eval(code); } catch(e) { console.error('[SDK] v5.1.3 error:', e.message); } }, sdk513);

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url();
        const type = req.resourceType();
        if (url.includes('/webmssdk/')) {
            req.respond({ status: 200, contentType: 'application/javascript; charset=utf-8', body: sdk513 });
            return;
        }
        if (url.includes('slardar') || url.includes('acrawler') || url.includes('analytics')) {
            req.abort();
            return;
        }
        if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
            req.abort();
            return;
        }
        req.continue();
    });

    console.log('[DirectSigner] Navigating to TikTok...');
    try {
        await page.goto('https://www.tiktok.com/@zara', {
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
    if (!ready) throw new Error('Signer not initialized');

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
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (cookiesStr) {
        const cookies = cookiesStr.split(';').map(pair => {
            const [name, ...rest] = pair.trim().split('=');
            return { name: name.trim(), value: rest.join('=').trim(), domain: '.tiktok.com' };
        }).filter(c => c.name && c.value);
        await page.setCookie(...cookies);
        console.log(`[DirectSigner] Set ${cookies.length} cookies from TIKTOK_COOKIES`);
        return;
    }
    const sessionId = process.env.SESSION_ID;
    const targetIdc = process.env.TT_TARGET_IDC || 'alisg';
    if (sessionId) {
        await page.setCookie(
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
    if (!browser) throw new Error('Signer not initialized');

    console.log(`[DirectSigner] Navigating to ${username}'s LIVE page for WS URL capture...`);

    if (wsPage && !wsPage.isClosed()) {
        try { await wsPage.close(); } catch (e) {}
    }
    wsPage = await browser.newPage();
    await wsPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0');
    await wsPage.setViewport({ width: 1920, height: 1080 });
    await wsPage.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' });
    await wsPage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });
        Object.defineProperty(navigator, 'language', { get: () => 'zh-TW', configurable: true });
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-TW', 'zh', 'en'], configurable: true });
    });

    await setTikTokCookies(wsPage);

    await wsPage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true });
    });
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
            console.log(`[DirectSigner] WS URL: ...${capturedWsUrl.substring(capturedWsUrl.length - 120)}`);
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
        const pageCookies = await wsPage.cookies();
        for (const c of pageCookies) {
            cookies[c.name] = c.value;
        }
    } catch (e) {
        console.warn('[DirectSigner] Cookie capture failed:', e.message);
    }

    console.log(`[DirectSigner] Captured WS URL - pushServer: ${capturedPushServer}`);
    console.log(`[DirectSigner] Params: ${JSON.stringify(capturedRouteParams)}`);

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

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' });

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
        fetchPage = await browser.newPage();
        await fetchPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0');
        await fetchPage.setViewport({ width: 1920, height: 1080 });
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
        try { fetchPage.close(); } catch(e) {}
    }
    fetchPage = null;
    fetchPageCreated = 0;
    console.log('[DirectSigner] Fetch page reset');
}

export async function closeDirectSigner() {
    if (livePage && !livePage.isClosed()) {
        try { await livePage.close(); } catch(e) {}
    }
    livePage = null;
    if (fetchPage && !fetchPage.isClosed()) {
        try { await fetchPage.close(); } catch(e) {}
    }
    fetchPage = null;
    if (page && !page.isClosed()) {
        try { await page.close(); } catch(e) {}
    }
    page = null;
    wsPage = null;
    if (browser) {
        try { await browser.close(); } catch(e) {}
        browser = null;
    }
    ready = false;
}
