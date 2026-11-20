/**
 * 訊息過濾器診斷計數。
 *
 * 只保留決策結果與規則／使用者等中繼資料，不保存聊天本文；
 * 用來確認過濾器是否過度攔截、哪條規則命中，以及 throttle 是否還有活動群組。
 */

const DEFAULT_RECENT = 20;

function text(value) {
    return value == null ? '' : String(value);
}

/**
 * @param {{recentLimit?: number, now?: () => number}} [options]
 * @returns {{record: Function, snapshot: Function}}
 */
export function createFilterDiagnostics({ recentLimit = DEFAULT_RECENT, now = Date.now } = {}) {
    const limit = Math.max(1, Number(recentLimit) || DEFAULT_RECENT);
    const state = {
        evaluated: 0,
        passed: 0,
        blocked: 0,
        modified: 0,
        adBlocked: 0,
        byField: {},
        byReason: {},
        lastAt: null,
        lastBlockedAt: null,
        lastDecision: null,
        recent: []
    };

    /**
     * 記錄一次 processFilter 決策。
     * @param {{user?: string, message?: string}} input
     * @param {{blocked?: boolean, modified?: boolean, reason?: string, field?: string, ad?: boolean}} result
     * @returns {void}
     */
    function record(input = {}, result = {}) {
        const at = now();
        const entry = {
            at,
            user: text(input.user).slice(0, 80),
            length: text(input.message).length,
            blocked: result.blocked === true,
            modified: result.modified === true,
            reason: result.reason || null,
            field: result.field || null,
            ad: result.ad === true
        };

        state.evaluated += 1;
        state.lastAt = at;
        state.lastDecision = entry;
        if (entry.blocked) {
            state.blocked += 1;
            state.lastBlockedAt = at;
            if (entry.ad) state.adBlocked += 1;
            const field = entry.field || 'none';
            const reason = entry.reason || 'unknown';
            state.byField[field] = (state.byField[field] || 0) + 1;
            state.byReason[reason] = (state.byReason[reason] || 0) + 1;
        } else if (entry.modified) {
            state.modified += 1;
        } else {
            state.passed += 1;
        }

        state.recent.push(entry);
        if (state.recent.length > limit) state.recent.splice(0, state.recent.length - limit);
    }

    /**
     * 產生 IPC 診斷快照。
     * @param {{rules?: Array, throttleState?: Map}} [options]
     * @returns {Object}
     */
    function snapshot({ rules = [], throttleState = null } = {}) {
        const at = now();
        const throttle = [];
        if (throttleState instanceof Map) {
            for (const rule of rules) {
                if ((rule.action || 'block') !== 'throttle') continue;
                const groups = throttleState.get(rule) || [];
                const windowMs = Number(rule.windowMs) || 0;
                const active = groups.filter(group => group && group.count > 0
                    && at - Number(group.time || 0) <= windowMs);
                throttle.push({
                    rule: rule.name,
                    scope: rule.scope || null,
                    windowMs: rule.windowMs,
                    max: rule.max,
                    onExceed: rule.onExceed || 'drop',
                    activeGroups: active.length,
                    pending: active.reduce((sum, group) => sum + (Number(group.pending) || 0), 0),
                    oldestAt: active.length ? Math.min(...active.map(group => Number(group.time) || 0)) : null
                });
            }
        }

        return {
            at,
            evaluated: state.evaluated,
            passed: state.passed,
            blocked: state.blocked,
            modified: state.modified,
            adBlocked: state.adBlocked,
            byField: { ...state.byField },
            byReason: { ...state.byReason },
            lastAt: state.lastAt,
            lastBlockedAt: state.lastBlockedAt,
            lastDecision: state.lastDecision ? { ...state.lastDecision } : null,
            recent: state.recent.map(item => ({ ...item })),
            rules: rules.map(rule => ({
                name: rule.name || '',
                field: rule.field || 'any',
                action: rule.action || 'block',
                ad: rule.ad === true || /廣告/.test(rule.name || ''),
                ...((rule.action || 'block') === 'throttle' ? {
                    throttle: {
                        scope: rule.scope || null,
                        windowMs: rule.windowMs,
                        max: rule.max,
                        onExceed: rule.onExceed || 'drop',
                        similarity: rule.similarity || 'normalized'
                    }
                } : {})
            })),
            throttle
        };
    }

    return { record, snapshot };
}

export { DEFAULT_RECENT };
