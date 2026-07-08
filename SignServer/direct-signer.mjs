/**
 * X-Bogus signer using TikTok's own SDK with Puppeteer.
 * Follows the exact initialization flow from tiktok-signature/server.mjs:
 * 1. Inject local SDKs via evaluateOnNewDocument
 * 2. Navigate to TikTok profile page to populate SDK tables
 * 3. Reload to stabilize session
 * 4. Use populated tables for signing
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_DIR = path.resolve(__dirname, '../node_modules/tiktok-signature/javascript');

let browser = null;
let page = null;
let ready = false;

export async function initDirectSigner() {
    if (ready) return true;

    console.log('[DirectSigner] Reading SDK files...');
    const sdk513 = fs.readFileSync(path.join(SDK_DIR, 'webmssdk_5.1.3.js'), 'utf-8');
    const sdk485 = fs.readFileSync(path.join(SDK_DIR, 'webmssdk_2.0.0.485.js'), 'utf-8');
    const sdk368 = fs.readFileSync(path.join(SDK_DIR, 'webmssdk_1.0.0.368.js'), 'utf-8');

    console.log('[DirectSigner] Launching headless browser...');
    browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1920,1080',
        ],
    });

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Platform override
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true });
    });

    // Inject local SDKs via evaluateOnNewDocument (runs before ANY page scripts)
    await page.evaluateOnNewDocument((code) => { try { eval(code); } catch(e) { console.error('[SDK] v5.1.3 error:', e.message); } }, sdk513);
    await page.evaluateOnNewDocument((code) => { try { eval(code); } catch(e) { console.error('[SDK] v2.0.0 error:', e.message); } }, sdk485);

    // Set up request interception to serve local SDK files
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url();
        const type = req.resourceType();

        // Serve local SDK files for webmssdk requests
        if (url.includes('/webmssdk/')) {
            let body = null;
            if (url.includes('2.0.0.485') && sdk485) body = sdk485;
            else if (url.includes('1.0.0.368') && sdk368) body = sdk368;
            else if (sdk485) body = sdk485;
            if (body) {
                req.respond({ status: 200, contentType: 'application/javascript; charset=utf-8', body });
                return;
            }
        }

        // Block other security/telemetry SDK files
        if (url.includes('slardar') || url.includes('acrawler')) {
            req.abort();
            return;
        }

        // Block heavy resources
        if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
            req.abort();
            return;
        }

        req.continue();
    });

    console.log('[DirectSigner] Navigating to TikTok profile page...');
    try {
        await page.goto('https://www.tiktok.com/@zara', {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
    } catch (e) {
        console.log('[DirectSigner] Navigation warning:', e.message);
    }

    // Wait for page to settle
    console.log('[DirectSigner] Waiting for SDK initialization...');
    await new Promise(r => setTimeout(r, 3000));

    // Warm up
    await page.evaluate(() => window.scrollBy(0, 500));
    await new Promise(r => setTimeout(r, 2000));

    // Reload to stabilize session
    console.log('[DirectSigner] Reloading page...');
    try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
        console.log('[DirectSigner] Reload warning:', e.message);
    }
    await new Promise(r => setTimeout(r, 3000));

    // Check SDK status
    const sdkStatus = await page.evaluate(() => {
        const hasAcrawler = !!window.byted_acrawler;
        const hasFrontierSign = hasAcrawler && typeof window.byted_acrawler.frontierSign === 'function';
        const hasSdkN = !!(window.__sdkN?.u?.[995]?.v);
        const hasSdkN_BO = !!(window.__sdkN?.B?.o?.[995]?.v);
        const hasSdkN_O = !!(window.__sdkN?.o?.[995]?.v);
        return { hasAcrawler, hasFrontierSign, hasSdkN, hasSdkN_BO, hasSdkN_O };
    });

    console.log('[DirectSigner] SDK status:', JSON.stringify(sdkStatus));

    if (!sdkStatus.hasSdkN && !sdkStatus.hasSdkN_BO && !sdkStatus.hasSdkN_O) {
        throw new Error('SDK tables not populated after initialization');
    }

    ready = true;
    console.log('[DirectSigner] Ready to sign');
    return true;
}

export async function directSign(url) {
    if (!ready) throw new Error('Signer not initialized');

    return await page.evaluate((fetchUrl) => {
        const u = new URL(fetchUrl);
        u.searchParams.delete('X-Bogus');
        u.searchParams.delete('X-Gnarly');
        const queryString = u.search.slice(1);

        const sdkN = window.__sdkN;
        let table = null;
        if (sdkN.u?.[995]?.v) table = sdkN.u;
        else if (sdkN.B?.o?.[995]?.v) table = sdkN.B.o;
        else if (sdkN.o?.[995]?.v) table = sdkN.o;
        if (!table) return { error: 'SDK not ready' };

        const u995 = table[995].v;
        const acrawler = window.byted_acrawler;
        try {
            const xb = u995.call(acrawler, queryString, '');
            if (!xb) return { error: 'X-Bogus computation returned empty' };
            u.searchParams.set('X-Bogus', xb);
            return { xBogus: xb, signedUrl: u.toString() };
        } catch (e) {
            return { error: e.message };
        }
    }, url);
}

export async function closeDirectSigner() {
    if (browser) {
        await browser.close();
        browser = null;
        page = null;
        ready = false;
    }
}
