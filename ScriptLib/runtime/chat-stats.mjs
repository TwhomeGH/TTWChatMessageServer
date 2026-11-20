/**
 * 聊天收發診斷計數。
 *
 * 只記平台、訊息 id、使用者、時間與處理結果，不保存聊天本文；
 * 用來判斷訊息是「平台沒送來」還是「送來後被過濾／去重／送出失敗」。
 */

const DEFAULT_PLATFORMS = ['tiktok', 'twitch', 'kick', 'youtube', 'odysee'];
const DEFAULT_RECENT = 12;

function normalizePlatform(value) {
    const platform = String(value || '').trim().toLowerCase();
    return platform || 'unknown';
}

function normalizeInfo(value = {}, now) {
    const at = Number(value.at);
    return {
        at: Number.isFinite(at) && at > 0 ? at : now(),
        id: value.id == null ? null : String(value.id),
        user: value.user == null ? '' : String(value.user)
    };
}

/**
 * @param {{platforms?: string[], recentLimit?: number, now?: () => number}} [options]
 * @returns {{received: Function, sent: Function, dropped: Function, failed: Function, snapshot: Function}}
 */
export function createChatStats({ platforms = DEFAULT_PLATFORMS, recentLimit = DEFAULT_RECENT, now = Date.now } = {}) {
    const limit = Math.max(1, Number(recentLimit) || DEFAULT_RECENT);
    const states = new Map();

    function row(platform) {
        const name = normalizePlatform(platform);
        if (!states.has(name)) {
            states.set(name, {
                platform: name,
                received: 0,
                sent: 0,
                dropped: 0,
                failed: 0,
                dropReasons: {},
                lastReceivedAt: null,
                lastSentAt: null,
                lastDroppedAt: null,
                lastFailedAt: null,
                lastReceived: null,
                lastSent: null,
                recent: []
            });
        }
        return states.get(name);
    }

    for (const platform of platforms || []) row(platform);

    function push(state, stage, info, reason = null) {
        state.recent.push({ ...info, stage, reason });
        if (state.recent.length > limit) state.recent.splice(0, state.recent.length - limit);
    }

    /** 平台原始聊天事件已收到。 */
    function received(platform, info = {}) {
        const state = row(platform);
        const value = normalizeInfo(info, now);
        state.received += 1;
        state.lastReceivedAt = value.at;
        state.lastReceived = value;
        push(state, 'received', value);
    }

    /** 已實際送進 SocketHub（或平台輸出）。 */
    function sent(platform, info = {}) {
        const state = row(platform);
        // 送出時間用目前時間；info.at 是收到平台事件的時間。
        const value = normalizeInfo({ ...info, at: undefined }, now);
        state.sent += 1;
        state.lastSentAt = value.at;
        state.lastSent = value;
        push(state, 'sent', value);
    }

    /** 收到但沒有送出，reason 例如 filtered／duplicate／invalid／replay／command／socket。 */
    function dropped(platform, reason, info = {}) {
        const state = row(platform);
        const value = normalizeInfo(info, now);
        const name = String(reason || 'other');
        state.dropped += 1;
        state.dropReasons[name] = (state.dropReasons[name] || 0) + 1;
        state.lastDroppedAt = value.at;
        push(state, 'dropped', value, name);
    }

    /** 處理器例外或輸出失敗；與 dropped 分開，避免把程式錯誤當成正常丟棄。 */
    function failed(platform, reason, info = {}) {
        const state = row(platform);
        const value = normalizeInfo(info, now);
        const name = String(reason || 'error');
        state.failed += 1;
        state.dropReasons[name] = (state.dropReasons[name] || 0) + 1;
        state.lastFailedAt = value.at;
        push(state, 'failed', value, name);
    }

    /** 產生 IPC 診斷用快照；每個平台獨立，不包含聊天內容。 */
    function snapshot() {
        const at = now();
        const platforms = {};
        for (const [name, state] of states) {
            platforms[name] = {
                ...state,
                dropReasons: { ...state.dropReasons },
                recent: state.recent.map(item => ({ ...item })),
                lastReceivedAgeMs: state.lastReceivedAt == null ? null : Math.max(0, at - state.lastReceivedAt),
                lastSentAgeMs: state.lastSentAt == null ? null : Math.max(0, at - state.lastSentAt)
            };
        }
        return { at, platforms };
    }

    return { received, sent, dropped, failed, snapshot };
}

export { DEFAULT_PLATFORMS, DEFAULT_RECENT };
