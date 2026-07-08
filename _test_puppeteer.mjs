import puppeteer from 'puppeteer';
import fs from 'fs';

const sdk513 = fs.readFileSync('node_modules/tiktok-signature/javascript/webmssdk_5.1.3.js', 'utf-8');
const sdk485 = fs.readFileSync('node_modules/tiktok-signature/javascript/webmssdk_2.0.0.485.js', 'utf-8');

const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        '--window-size=1920,1080'],
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
await page.setViewport({ width: 1920, height: 1080 });

await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true });
});

// Inject v5.1.3 first (sets byted_acrawler and dwInfl infrastructure)
await page.evaluateOnNewDocument(sdk513);
// Inject v2.0.0 (sets __sdkN skeleton)
await page.evaluateOnNewDocument(sdk485);

await page.goto('about:blank', { waitUntil: 'domcontentloaded' });

// Now simulate loading the SDK AGAIN via addScriptTag (which triggers the table population)
// First check what we have
const before = await page.evaluate(() => ({
    sdkNKeys: Object.keys(window.__sdkN || {}),
    uKeys: window.__sdkN?.u ? Object.keys(window.__sdkN.u).slice(0,10) : [],
    hasU995: !!(window.__sdkN?.u?.[995]),
}));
console.log('Before script injection:', JSON.stringify(before));

// Inject v2.0.0 SDK via script tag (simulates TikTok page requesting /webmssdk/)
await page.addScriptTag({ content: sdk485 });

const after = await page.evaluate(() => ({
    sdkNKeys: Object.keys(window.__sdkN || {}),
    uKeys: window.__sdkN?.u ? Object.keys(window.__sdkN.u).slice(0,10) : [],
    hasU995: !!(window.__sdkN?.u?.[995]),
    u995Type: typeof window.__sdkN?.u?.[995]?.v,
}));
console.log('After script injection:', JSON.stringify(after));

if (after.hasU995) {
    const signResult = await page.evaluate(() => {
        const sdkN = window.__sdkN;
        const u995 = sdkN.u[995].v;
        const acrawler = window.byted_acrawler;
        const qs = 'room_id=12345&cursor=0';
        try {
            const xb = u995.call(acrawler, qs, '');
            return { success: true, xBogus: xb };
        } catch(e) {
            return { success: false, error: e.message };
        }
    });
    console.log('Sign result:', JSON.stringify(signResult));
}

await browser.close();
