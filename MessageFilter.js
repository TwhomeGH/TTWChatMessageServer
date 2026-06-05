import { promises as fs } from 'fs';

const messageStats = new Map();

const STATS_FILE = './message_stats.json';

export function recordMessageStat(message) {
    if (!message) return;
    const count = messageStats.get(message) || 0;
    messageStats.set(message, count + 1);
}

export function getTopMessages(limit = 10) {
    return [...messageStats.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([message, count]) => ({ message, count }));
}

export function getAllMessageStatsSorted() {
    return [...messageStats.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([message, count]) => ({ message, count }));
}

export function getMessageStats() {
    return messageStats;
}

export async function saveStatsToFile(filePath = STATS_FILE) {
    const data = getAllMessageStatsSorted();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function loadStatsFromFile(filePath = STATS_FILE) {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
            messageStats.clear();
            for (const { message, count } of data) {
                if (message && typeof count === 'number') {
                    messageStats.set(message, count);
                }
            }
        }
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('❌ 讀取 message_stats.json 失敗:', err);
        }
    }
}

export function clearStats() {
    messageStats.clear();
}

// ===== 過濾規則系統 =====

/**
 * @typedef {Object} FilterRule
 * @property {string}             name        - 規則名稱（用於日誌）
 * @property {'user'|'message'|'any'} field  - 作用欄位
 * @property {'block'|'replace'|'delete'} [action='block'] - 動作類型
 *
 * block 規則:
 * @property {function}           test        - (value) => boolean，true 表示阻擋
 *
 * replace 規則:
 * @property {RegExp|string}      match       - 要取代的 pattern
 * @property {string|function}    [replacement] - 取代成什麼（預設 ''）
 *
 * delete 規則（等同 replacement='' 的 replace）:
 * @property {RegExp|string}      match       - 要刪除的 pattern
 */

const filterRules = [];

export function addFilterRule(rule) {
    filterRules.push(rule);
}

export function addFilterRules(rules) {
    for (const rule of rules) {
        addFilterRule(rule);
    }
}

/**
 * 完整處理：依序套用所有規則（block → 中斷; replace/delete → 改值）
 * @param {{ user?: string, message?: string }} input
 * @returns {{ user?: string, message?: string, blocked: boolean, reason?: string, field?: string, modified: boolean }}
 */
export function processFilter({ user, message } = {}) {
    user = (typeof user === 'string') ? user : '';
    message = (typeof message === 'string') ? message : '';
    let result = { user, message, blocked: false, reason: undefined, field: undefined, modified: false };

    for (const rule of filterRules) {
        const action = rule.action || 'block';

        if (action === 'block') {
            if (rule.field === 'user' || rule.field === 'any') {
                if (result.user && rule.test(result.user)) {
                    return { ...result, blocked: true, reason: rule.name, field: 'user' };
                }
            }
            if (rule.field === 'message' || rule.field === 'any') {
                if (result.message && rule.test(result.message)) {
                    return { ...result, blocked: true, reason: rule.name, field: 'message' };
                }
            }
        }

        if (action === 'replace' || action === 'delete') {
            const replacement = action === 'delete' ? '' : (rule.replacement ?? '');

            if (rule.field === 'user' || rule.field === 'any') {
                if (result.user && rule.match) {
                    const next = result.user.replace(rule.match, replacement);
                    if (next !== result.user) {
                        result.user = next;
                        result.modified = true;
                    }
                }
            }
            if (rule.field === 'message' || rule.field === 'any') {
                if (result.message && rule.match) {
                    const next = result.message.replace(rule.match, replacement);
                    if (next !== result.message) {
                        result.message = next;
                        result.modified = true;
                    }
                }
            }
        }
    }

    return result;
}

/**
 * 檢查是否需要阻擋（只檢查 action='block' 的規則）
 * @returns {{ filtered: boolean, reason?: string, field?: string }}
 */
export function checkFilter(input) {
    const res = processFilter(input);
    return { filtered: res.blocked, reason: res.reason, field: res.field };
}

/**
 * 快速布林檢查（只檢查阻擋規則）
 */
export function isFiltered(input) {
    return checkFilter(input).filtered;
}

/**
 * 清除所有過濾規則
 */
export function clearFilterRules() {
    filterRules.length = 0;
}

/**
 * 取得所有規則列表（複本）
 */
export function getFilterRules() {
    return [...filterRules];
}

// ===== 預設規則 =====

const COMBINING_MARKS = /[\u{20D0}-\u{20FF}\u{FE00}-\u{FE0F}\u{0300}-\u{036F}]/u;

addFilterRules([
    // ── 用戶名：block ──
    {
        name: 'user:廣告帳號-加LINE/加瀨',
        field: 'user',
        action: 'block',
        test: (u) => /加(LINE|瀨|line|ｌｉｎｅ)/.test(u),
    },
    {
        name: 'user:廣告帳號-特殊組合字',
        field: 'user',
        action: 'block',
        test: (u) => /LINE|瀨/.test(u) && COMBINING_MARKS.test(u),
    },
    {
        name: 'user:廣告帳號-臺幣/蚪幣',
        field: 'user',
        action: 'block',
        test: (u) => /[臺蚪].*[幣⃑]/.test(u),
    },
    {
        name: 'user:廣告帳號-過長中文比例異常',
        field: 'user',
        action: 'block',
        test: (u) => {
            const codePoints = [...u];
            if (codePoints.length < 6) return false;
            const cjk = (u.match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length;
            const other = codePoints.filter(c => !/[\u4e00-\u9fff\u3000-\u303f\w\s]/u.test(c)).length;
            return other > cjk * 2;
        },
    },

    // ── 訊息內容：block ──
    {
        name: 'msg:僅標點符號',
        field: 'message',
        action: 'block',
        test: (m) => /^[。，、．.．,，\s…\-—‥・·]+$/.test(m),
    },
    {
        name: 'msg:僅單一字元',
        field: 'message',
        action: 'block',
        test: (m) => {
            const trimmed = m.trim();
            return trimmed.length <= 1 && /[。.？?!！~～]/.test(trimmed);
        },
    },


    {
        name: 'user:刪除特殊符號',
        field: 'user',
        action: 'delete',
        match: /[^\w\s\p{sc=Han}]/gu,
    },
    {
        name: 'any:刪除控制字元',
        field: 'any',
        action: 'delete',
        match: /[\x00-\x1F\x7F]/g,
    },
    {
        name: 'any:刪除過多空白',
        field: 'any',
        action: 'replace',
        match: /\s{2,}/g,
        replacement: ' ',
    },

    // ── 範例：replace / delete（預設關閉，使用者可按需啟用）──
    {
        name: 'msg:遮罩髒話',
        field: 'message',
        action: 'replace',
        match: /他媽的|操你媽|幹你娘/g,
        replacement: '***',
    },
    {
        name: 'msg:刪除網址',
        field: 'message',
        action: 'delete',
        match: /https?:\/\/\S+/g,
    },
    
    {
        name: 'msg:刪除色情詞彙',
        field: 'message',
        action: 'delete',
        match: /小穴|乳交|足交|私暗號/g,
    }

]);

export default {
    recordMessageStat,
    getTopMessages,
    getAllMessageStatsSorted,
    getMessageStats,
    saveStatsToFile,
    loadStatsFromFile,
    clearStats,
    addFilterRule,
    addFilterRules,
    processFilter,
    checkFilter,
    isFiltered,
    clearFilterRules,
    getFilterRules,
};
