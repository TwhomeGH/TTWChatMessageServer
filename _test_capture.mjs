import puppeteer from 'puppeteer';
import fs from 'fs';

const sdk513 = fs.readFileSync('node_modules/tiktok-signature/javascript/webmssdk_5.1.3.js', 'utf8');
const sdk485 = fs.readFileSync('node_modules/tiktok-signature/javascript/webmssdk_2.0.0.485.js', 'utf8');

const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
await page.setViewport({ width: 1920, height: 1080 });

await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true });
});
await page.evaluateOnNewDocument(sdk513);
await page.evaluateOnNewDocument(sdk485);

// Override WebSocket constructor
await page.evaluateOnNewDocument(() => {
    window.__capturedWsUrls = [];
    const OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        window.__capturedWsUrls.push({ url: typeof url === 'string' ? url : url.toString(), ts: Date.now() });
        return new OrigWS(url, protocols);
    };
    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN = OrigWS.OPEN;
    window.WebSocket.CLOSING = OrigWS.CLOSING;
    window.WebSocket.CLOSED = OrigWS.CLOSED;
});

console.log('Navigating to LIVE page...');
try {
    await page.goto('https://www.tiktok.com/@eatpoopbro/live', { waitUntil: 'domcontentloaded', timeout: 30000 });
} catch(e) {
    console.log('Nav warning:', e.message);
}

// Wait for WS
for (let i = 0; i < 120; i++) {
    const urls = await page.evaluate(() => window.__capturedWsUrls || []);
    if (urls.length > 0) {
        for (const w of urls) {
            console.log('\nCAPTURED WS URL:');
            try {
                const parsed = new URL(w.url);
                console.log('  pushServer:', parsed.origin + parsed.pathname);
                console.log('  All params:');
                for (const [k, v] of parsed.searchParams.entries()) {
                    if (k === 'X-Bogus') console.log(`    ${k}: ${v}`);
                    else console.log(`    ${k}: ${v.substring(0, 60)}`);
                }
            } catch(e) {
                console.log('  URL:', w.url.substring(0, 300));
            }
        }
        break;
    }
    if (i % 20 === 0) console.log('Waiting...', i / 2, 's');
    await new Promise(r => setTimeout(r, 500));
}

// Also extract SDK info
const sdkInfo = await page.evaluate(() => ({
    acrawlerKeys: Object.keys(window.byted_acrawler || {}),
    sdkNKeys: Object.keys(window.__sdkN || {}),
    uKeys: Object.keys(window.__sdkN?.u || {}).slice(0, 30),
    oKeys: Object.keys(window.__sdkN?.o || {}).slice(0, 30),
    hasAccessKey: document.cookie.includes('access_key') || document.body?.innerText.includes('access_key'),
}));
console.log('\nSDK Info:', JSON.stringify(sdkInfo, null, 2));

await browser.close();
