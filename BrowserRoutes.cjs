const { createHandler } = require('./ScriptLib/browser/routes.cjs');
const { createController } = require('./ScriptLib/browser/controller.cjs');
const { sendJson } = require('./ScriptLib/emoji/http.cjs');
let handler;

/** 同步接管瀏覽器路由；驗證登入由主服務提供，控制器延遲建立。 */
function serveBrowser(req, res, authorized) {
    const pathname = req.url.split('?')[0];
    if (pathname !== '/browser' && !pathname.startsWith('/api/browser/')) return false;
    try {
        handler ||= createHandler(createController());
        void handler(req, res, authorized);
    } catch (error) {
        sendJson(res, 500, { code: 'BROWSER_CONFIG_INVALID', error: '瀏覽器設定錯誤，請檢查 BROWSER_DEBUG_URL' });
    }
    return true;
}
module.exports = { serveBrowser };
