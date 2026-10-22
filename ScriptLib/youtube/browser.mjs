import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserPath } from '../browser/path.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_PROFILE = path.join(ROOT, 'data', 'youtube-browser-profile');

let active = null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function log(...args) {
    console.log('[Youtube Browser]', ...args);
}

/** 無 OAuth 時的瀏覽器 fallback 是否啟用；預設啟用，設 0 可關閉。 */
export function youtubeBrowserEnabled() {
    return process.env.YOUTUBE_BROWSER_FALLBACK !== '0';
}

function watchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** 從 watch／live 網址取得 videoId。 */
function videoIdFromUrl(value) {
    try {
        const url = new URL(value, 'https://www.youtube.com');
        const query = url.searchParams.get('v');
        if (query) return query;
        const match = url.pathname.match(/^\/(?:live|watch)\/([A-Za-z0-9_-]{6,})/);
        return match ? match[1] : '';
    } catch {
        return '';
    }
}

/** 把 @handle、UC ID 或頻道 URL 轉成該頻道的 /live 頁。 */
function channelLiveUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('缺少 YouTube 頻道');
    if (/^UC[\w-]{20,}$/.test(raw)) return `https://www.youtube.com/channel/${raw}/live`;

    if (/^(https?:)?\/\//i.test(raw) || /^(www\.)?youtube\.com\//i.test(raw)) {
        const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        if (url.hostname === 'youtu.be') {
            const id = url.pathname.replace(/^\/+/, '').split('/')[0];
            return id ? watchUrl(id) : raw;
        }
        if (url.searchParams.get('v')) return url.toString();
        if (/\/live(?:\/[^/]+)?\/?$/.test(url.pathname)) return url.toString();
        url.pathname = url.pathname.replace(/\/+$/, '') + '/live';
        return url.toString();
    }

    if (/^(c|user|channel)\//i.test(raw)) return `https://www.youtube.com/${raw.replace(/\/+$/, '')}/live`;
    return `https://www.youtube.com/@${encodeURIComponent(raw.replace(/^@/, ''))}/live`;
}

/** 等待 /live 頁轉址或播放器提供目前影片 ID。 */
async function waitForVideoId(page, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const direct = videoIdFromUrl(page.url());
        if (direct) return direct;
        const candidates = await page.evaluate(() => {
            const canonical = globalThis.document?.querySelector('link[rel="canonical"]')?.href || '';
            const details = globalThis.ytInitialPlayerResponse?.videoDetails?.videoId || '';
            return [globalThis.location?.href || '', canonical, details].filter(Boolean);
        }).catch(() => []);
        for (const value of candidates) {
            if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
            const id = videoIdFromUrl(value);
            if (id) return id;
        }
        await delay(500);
    }
    return '';
}

/** 從實際觀看頁取得頻道 ID；不要用 ytcfg，避免拿到已登入觀眾自己的頻道。 */
async function detectPageChannelId(page) {
    return page.evaluate(() => {
        const details = globalThis.ytInitialPlayerResponse?.videoDetails;
        const meta = globalThis.document?.querySelector('meta[itemprop="channelId"]')?.content;
        return details?.channelId || meta || '';
    }).catch(() => '');
}

function profileDir() {
    const configured = process.env.YOUTUBE_BROWSER_PROFILE || DEFAULT_PROFILE;
    const resolved = path.isAbsolute(configured) ? configured : path.resolve(ROOT, configured);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
}

/** 在實際觀看頁的聊天 iframe 或主頁面中尋找並回傳可注入的 frame。 */
async function waitForChatFrame(page, videoId, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const frame = page.frames().find(candidate => {
            const url = candidate.url();
            if (!url.includes('/live_chat')) return false;
            const match = /[?&]v=([^&]+)/.exec(url);
            return !match || decodeURIComponent(match[1]) === videoId;
        });
        if (frame) return frame;
        await delay(500);
    }
    return page.mainFrame();
}

const RELAY_SCRIPT = String.raw`
(() => {
    if (window.__ttwYoutubeRelayInstalled) return;
    window.__ttwYoutubeRelayInstalled = true;
    const seen = new WeakSet();
    const videoId = new URLSearchParams(location.search).get('v') || '';
    const selector = [
        'yt-live-chat-text-message-renderer',
        'yt-live-chat-paid-message-renderer',
        'yt-live-chat-legacy-paid-message-renderer'
    ].join(',');

    function send(el) {
        if (!el || seen.has(el)) return;
        const user = el.querySelector('#author-name')?.textContent?.trim() || '';
        const message = el.querySelector('#message, #message-content')?.textContent?.trim() || '';
        if (!user || !message) return;
        seen.add(el);
        try {
            window.__ttwYoutubeRelay({
                id: el.id || el.getAttribute('data-message-id') || '',
                user,
                message,
                sentAt: el.querySelector('time[datetime]')?.getAttribute('datetime') || null,
                img: el.querySelector('img#author-photo, img[slot="photo"], img[src*="yt3"]')?.src || '',
                videoId
            });
        } catch { /* 頁面正在卸載時忽略 */ }
    }

    const observer = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches?.(selector)) send(node);
                node.querySelectorAll?.(selector).forEach(send);
            }
        }
    });

    function start() {
        if (!document.body) {
            setTimeout(start, 500);
            return;
        }
        observer.observe(document.body, { childList: true, subtree: true });
        document.querySelectorAll(selector).forEach(send);
    }
    start();
})();
`;

async function injectFrame(frame) {
    try {
        await frame.evaluate(RELAY_SCRIPT);
        log('聊天室 relay 已注入:', frame.url() || 'main');
        return true;
    } catch (error) {
        log('聊天室 relay 注入失敗:', error.message);
        return false;
    }
}

/**
 * 用實際觀看頁取得 YouTube 聊天，不需要 OAuth。
 * 專用 profile 只存放登入／同意狀態，不寫入程式碼或日誌。
 */
export async function startYoutubeBrowser({ videoId, channelName, deps = {}, url }) {
    if (!videoId && !channelName && !url) throw new Error('缺少 YouTube 頻道或 videoId');
    if (active) await stopYoutubeBrowser();

    const executablePath = browserPath();
    const userDataDir = profileDir();
    const headless = process.env.YOUTUBE_BROWSER_HEADLESS !== '0';
    let targetVideoId = videoId || '';
    const target = targetVideoId
        ? (url || watchUrl(targetVideoId))
        : (url || channelLiveUrl(channelName));
    const puppeteer = (await import('puppeteer-core')).default;
    let browser;

    try {
        browser = await puppeteer.launch({
            executablePath,
            headless,
            userDataDir,
            args: [
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-notifications',
                '--mute-audio',
                '--lang=zh-TW'
            ]
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        page.setDefaultTimeout(15000);

        const seen = new Set();
        await page.exposeFunction('__ttwYoutubeRelay', payload => {
            try {
                if (!payload || typeof payload !== 'object') return;
                if (payload.videoId && String(payload.videoId) !== String(targetVideoId)) return;
                const key = payload.id || `${payload.user}\u0000${payload.message}\u0000${payload.sentAt}`;
                if (seen.has(key)) return;
                seen.add(key);
                if (seen.size > 5000) seen.delete(seen.values().next().value);
                deps.onText?.(payload);
            } catch (error) {
                log('訊息處理失敗:', error.message);
            }
        });

        page.on('framenavigated', frame => {
            if (targetVideoId && /\/live_chat/.test(frame.url())) injectFrame(frame);
        });
        page.on('error', error => log('頁面錯誤:', error.message));
        browser.on('disconnected', () => {
            if (active?.browser === browser) {
                active = null;
                log('瀏覽器已關閉，停止瀏覽器 fallback');
            }
        });

        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (!targetVideoId) {
            targetVideoId = await waitForVideoId(page, 45000);
            if (!targetVideoId) {
                throw new Error('找不到目前直播的影片 ID；頻道可能未開播，或頁面需要登入／同意。');
            }
            const detectedChannelId = await detectPageChannelId(page);
            if (detectedChannelId) deps.onChannelIdentity?.(detectedChannelId);
            log(`discovery 找到直播：${targetVideoId}` + (detectedChannelId ? `（${detectedChannelId}）` : ''));
        }

        const frame = await waitForChatFrame(page, targetVideoId);
        if (!frame) {
            log('找不到聊天室 iframe，改在目前頁面尋找');
        }
        const injected = await injectFrame(frame);
        if (!injected) {
            throw new Error('無法注入 YouTube 聊天室 relay');
        }
        const hasChat = await frame.evaluate(() => Boolean(globalThis.document?.querySelector(
            'yt-live-chat-app, yt-live-chat-text-message-renderer, #chat-container'
        ))).catch(() => false);
        if (!hasChat) {
            log('尚未找到聊天室元素；若一直沒有訊息，請確認登入／同意狀態，或改用 YOUTUBE_BROWSER_HEADLESS=0 手動開啟。');
        }

        active = { browser, page };
        log(`已開啟實際觀看頁：${target}` + (channelName ? `（${channelName}）` : ''));
        log(`模式：${headless ? 'headless' : 'headed'} · profile：${userDataDir}`);
        deps.writeLog?.('Default', `YouTube 瀏覽器 fallback 已啟動：${target}`, 'Youtube');
        return { browser, page, videoId: targetVideoId };
    } catch (error) {
        if (browser) {
            try { await browser.close(); } catch { /* ignore */ }
        }
        throw error;
    }
}

/** 關閉專用瀏覽器；可重複呼叫。 */
export async function stopYoutubeBrowser() {
    const current = active;
    active = null;
    if (!current) return;
    try {
        await Promise.race([current.browser.close(), delay(5000)]);
    } catch { /* ignore */ }
    try {
        if (current.browser.connected) current.browser.process()?.kill();
    } catch { /* ignore */ }
    log('瀏覽器 fallback 已關閉');
}
