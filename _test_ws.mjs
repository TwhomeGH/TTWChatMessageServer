// Test creating a raw WebSocket connection to webcast-ws.tiktok.com
// with captured X-Bogus from live page navigation
import puppeteer from 'puppeteer';
import fs from 'fs';
import { appendFile } from 'fs/promises';

const sdk513 = fs.readFileSync('node_modules/tiktok-signature/javascript/webmssdk_5.1.3.js', 'utf-8');
const sdk485 = fs.readFileSync('node_modules/tiktok-signature/javascript/webmssdk_2.0.0.485.js', 'utf-8');
const sdk368 = fs.readFileSync('node_modules/tiktok-signature/javascript/webmssdk_1.0.0.368.js', 'utf-8');

const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        '--window-size=1920,1080'],
});

const livePage = await browser.newPage();
await livePage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
await livePage.setViewport({ width: 1920, height: 1080 });

// Inject SDKs
await livePage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true });
});
await livePage.evaluateOnNewDocument(sdk513);
await livePage.evaluateOnNewDocument(sdk485);

// Intercept WebSocket connections and regular requests
const capturedWsUrls = [];
await livePage.setRequestInterception(true);
livePage.on('request', (req) => {
    const url = req.url();
    const type = req.resourceType();

    // Capture WebSocket URLs
    if (url.startsWith('ws') && url.includes('webcast-ws')) {
        capturedWsUrls.push({ url, time: Date.now() });
        console.log('WS URL captured:', url.substring(150));
    }

    // Block junk
    if (['image','media','font','stylesheet'].includes(type)) { req.abort(); return; }
    if (url.includes('slardar') || url.includes('acrawler')) { req.abort(); return; }
    if (url.includes('/webmssdk/')) {
        let body = null;
        if (url.includes('2.0.0.485') && sdk485) body = sdk485;
        else if (url.includes('1.0.0.368') && sdk368) body = sdk368;
        else if (sdk485) body = sdk485;
        if (body) { req.respond({ status: 200, contentType: 'application/javascript; charset=utf-8', body }); return; }
    }
    req.continue();
});

console.log('Navigating to LIVE page...');
try {
    await livePage.goto('https://www.tiktok.com/@eatpoopbro/live', { waitUntil: 'domcontentloaded', timeout: 30000 });
} catch(e) {
    console.log('Nav warning:', e.message);
}

// Wait for WS connections
console.log('Waiting for WS connections...');
for (let i = 0; i < 60; i++) {
    if (capturedWsUrls.length > 0) break;
    await new Promise(r => setTimeout(r, 500));
}

console.log(`Captured ${capturedWsUrls.length} WS URLs`);
for (const w of capturedWsUrls) {
    const urlObj = new URL(w.url);
    console.log('  X-Bogus:', urlObj.searchParams.get('X-Bogus'));
    console.log('  X-Gnarly:', urlObj.searchParams.get('X-Gnarly')?.substring(0, 50) + '...');
    console.log('  Full (first 200):', w.url.substring(0, 200) + '...');
}

await browser.close();
