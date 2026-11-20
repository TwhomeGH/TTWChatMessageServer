/**
 * Runtime IPC 診斷：只回傳白名單內的結構化狀態，不執行任意程式碼。
 *
 * 子程序把目前的 platformManager、transports、viewers、socket、autoClip 等
 * 整理成可序列化物件；主服務透過 IPC 請求，診斷頁只讀結果。
 */

const DIAGNOSTIC_COMMANDS = Object.freeze([
    'snapshot', 'ping', 'platforms', 'transports', 'viewers',
    'session', 'socket', 'autoclip', 'twitch', 'clips', 'chat', 'filter'
]);

/** 只保留有限的最近幾筆，避免把整段聊天或歷史帶進診斷回應。 */
function recentAutoClipRows(autoClip) {
    if (!autoClip || typeof autoClip.getHistory !== 'function') return null;
    const rows = autoClip.getHistory().filter(row => row && row.triggered).slice(-3);
    return rows.map(row => ({
        status: row.status || null,
        reason: row.reason || null,
        triggeredAt: row.triggeredAt || null,
        score: row.score ?? null,
        totalClips: row.totalClips ?? null,
        failedClips: row.failedClips ?? null,
        error: row.error || null
    }));
}

function recentClips(clipService) {
    if (!clipService || typeof clipService.loadHistory !== 'function') return null;
    try {
        return clipService.loadHistory().slice(0, 3).map(clip => ({
            id: clip.id || null,
            title: clip.title || '',
            source: clip.source || null,
            confirmed: clip.confirmed !== false,
            verification: clip.verification || null,
            createdAt: clip.createdAt || null
        }));
    } catch {
        return null;
    }
}

/**
 * 依命令取出狀態；未知命令回傳 error 而不是執行任何動作。
 * @param {string} command
 * @param {Object} state 由子程序整理的狀態
 * @returns {{ok: true, command: string, data: Object}|{ok: false, command: string, error: string, commands: string[]}}
 */
function runDiagnostic(command, state = {}) {
    const name = String(command || 'snapshot').trim().toLowerCase();
    if (!DIAGNOSTIC_COMMANDS.includes(name)) {
        return { ok: false, command: name, error: '不支援的診斷命令', commands: [...DIAGNOSTIC_COMMANDS] };
    }
    const data = {
        at: Date.now(),
        process: state.process || null,
        platforms: state.platforms || [],
        transports: state.transports || null,
        viewers: state.viewers || null,
        combinedViewers: state.combinedViewers ?? null,
        session: state.session || null,
        socket: state.socket || null,
        autoClip: state.autoClip || null,
        twitch: state.twitch || null,
        clips: state.clips || null,
        chat: state.chat || null,
        filter: state.filter || null
    };
    if (name === 'ping') {
        return { ok: true, command: name, data: { at: data.at, process: data.process } };
    }
    if (name === 'snapshot') return { ok: true, command: name, data };
    const key = name === 'autoclip' ? 'autoClip' : name;
    return { ok: true, command: name, data: data[key] };
}

module.exports = {
    DIAGNOSTIC_COMMANDS,
    runDiagnostic,
    recentAutoClipRows,
    recentClips
};
