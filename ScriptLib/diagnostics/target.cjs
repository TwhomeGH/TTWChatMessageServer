/**
 * 診斷 Socket 的連線目標沿用聊天輸出設定，不另外維護一份 host／port。
 * 優先 SOCKET_API，其次 SOCKET_APIS 的第一個可用端點。
 */
const DEFAULT_SOCKET_PORT = 9322;

/**
 * @param {string} raw
 * @returns {{host: string, port: number}|null}
 */
function parseSocketTarget(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    try {
        const url = new URL(text);
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const port = Number(url.port || DEFAULT_SOCKET_PORT);
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
        return { host, port };
    } catch {
        return null;
    }
}

/** SOCKET_APIS 可含 ?filter=；先依換行／分號切，再移除 query。 */
function splitSocketApis(value) {
    return String(value || '')
        .split(/[\n;]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

/**
 * @param {NodeJS.ProcessEnv|Object} [env]
 * @returns {{host: string, port: number, source: string, configured: boolean}}
 */
function resolveDiagnosticsTarget(env = process.env) {
    const primary = parseSocketTarget(env.SOCKET_API);
    if (primary) return { ...primary, source: 'SOCKET_API', configured: true };
    for (const spec of splitSocketApis(env.SOCKET_APIS)) {
        const query = spec.indexOf('?');
        const parsed = parseSocketTarget(query === -1 ? spec : spec.slice(0, query));
        if (parsed) return { ...parsed, source: 'SOCKET_APIS', configured: true };
    }
    return { host: '', port: DEFAULT_SOCKET_PORT, source: '', configured: false };
}

module.exports = { DEFAULT_SOCKET_PORT, parseSocketTarget, resolveDiagnosticsTarget };
