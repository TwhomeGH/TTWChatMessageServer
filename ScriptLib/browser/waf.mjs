/**
 * 在指定分頁清除 WAF token；只動 cookie，不導航、不影響登入。
 * @param {import('puppeteer-core').Page} page
 */
export async function deleteTikTokWafCookie(page) {
    const session = await page.createCDPSession();
    try {
        await session.send('Network.enable').catch(() => {});
        for (const domain of ['.tiktok.com', 'www.tiktok.com']) {
            await session.send('Network.deleteCookies', {
                name: '_waftokenid', domain, path: '/'
            }).catch(() => {});
        }
    } finally {
        await session.detach().catch(() => {});
    }
}

/**
 * 清除 TikTok 的 WAF token（_waftokenid）。這是本機 cookie 操作，不會發送
 * TikTok 請求；登入用 cookie（sessionid、sid_tt 等）不受影響。
 */
export async function clearTikTokWafToken(browserURL, connect) {
    const client = await connect({ browserURL, defaultViewport: null, protocolTimeout: 5000 });
    let owned = false;
    let page = null;
    try {
        const pages = await client.pages();
        page = pages.find(item => item.url().startsWith('https://www.tiktok.com/')) || null;
        if (!page) {
            page = await client.newPage();
            owned = true;
        }
        await deleteTikTokWafCookie(page);
        return true;
    } finally {
        if (owned && page) await page.close().catch(() => {});
        await client.disconnect().catch(() => {});
    }
}
