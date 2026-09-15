import puppeteer from 'puppeteer-core';
import fs from 'fs';

const sdk513 = fs.readFileSync('SignServer/sdk/webmssdk_5.1.3.js', 'utf-8');

const browser = await puppeteer.connect({ browserURL: process.env.BROWSER_DEBUG_URL || 'http://127.0.0.1:9222', defaultViewport: null });

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
await page.setViewport({ width: 1920, height: 1080 });
await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true });
});
await page.evaluateOnNewDocument(sdk513);
await page.goto('about:blank', { waitUntil: 'domcontentloaded' });

// Check frontierSign
const s = await page.evaluate(() => ({
    hasAcrawler: !!window.byted_acrawler,
    frontierSignType: typeof window.byted_acrawler?.frontierSign,
    acrawlerKeys: Object.keys(window.byted_acrawler || {}).slice(0, 20),
}));
console.log('Status:', JSON.stringify(s, null, 2));

// Try frontierSign
if (s.frontierSignType === 'function') {
    const r = await page.evaluate(() => {
        try {
            const result = window.byted_acrawler.frontierSign(
                'room_id=12345&cursor=0',
                ''
            );
            return { success: true, result: String(result).substring(0, 200) };
        } catch(e) {
            return { success: false, error: e.message };
        }
    });
    console.log('frontierSign result:', JSON.stringify(r));
}

await browser.disconnect();
