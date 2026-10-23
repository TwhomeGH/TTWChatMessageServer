const { createHandler } = require('./ScriptLib/browser/routes.cjs');
const { createController } = require('./ScriptLib/browser/controller.cjs');
const { sendJson } = require('./ScriptLib/emoji/http.cjs');
let handler;
let controller;

/** 共用同一個瀏覽器控制器，讓 runtime 與 /browser 操作同一組分頁。 */
function browserController() {
    controller ||= createController();
    return controller;
}

/** 同步接管瀏覽器路由；驗證登入由主服務提供，控制器延遲建立。 */
function serveBrowser(req, res, authorized) {
    const pathname = req.url.split('?')[0];
    if (pathname !== '/browser' && !pathname.startsWith('/api/browser/')) return false;
    try {
        handler ||= createHandler(browserController());
        void handler(req, res, authorized);
    } catch (err) {
        console.error('瀏覽器設定錯誤:', err?.message || err);
        sendJson(res, 500, { code: 'BROWSER_CONFIG_INVALID', error: '瀏覽器設定錯誤，請檢查 BROWSER_DEBUG_URL' });
    }
    return true;
}

/** 讓 runtime 在 TikTok browser 模式開啟直播分頁。 */
async function openTikTokLive(handle) {
    return browserController().openTikTokLive(handle);
}

module.exports = { serveBrowser, browserController, openTikTokLive };
