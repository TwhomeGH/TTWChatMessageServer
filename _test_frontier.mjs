import puppeteer from 'puppeteer';
import fs from 'fs';

const sdk513 = fs.readFileSync('node_modules/tiktok-signature/javascript/webmssdk_5.1.3.js', 'utf-8');

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

await browser.close();
