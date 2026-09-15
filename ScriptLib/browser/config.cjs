const path = require('node:path');
const os = require('node:os');

/** 僅允許本機 CDP；不可將可控制登入環境的介面暴露到區網。 */
function browserConfig(env = process.env) {
    const url = new URL(env.BROWSER_DEBUG_URL || 'http://127.0.0.1:9222');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('BROWSER_DEBUG_URL 必須是本機 HTTP 位址，例如 http://127.0.0.1:9222');
    }
    const dataRoot = env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
    return {
        browserURL: url.origin,
        port: Number(url.port || 80),
        profile: path.join(dataRoot, 'TTWChatMessageServer', 'browser-profile'),
        executable: env.BROWSER_EXECUTABLE || ''
    };
}
module.exports = { browserConfig };
