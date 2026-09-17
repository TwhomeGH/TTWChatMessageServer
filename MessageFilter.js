import { normalizeSource } from './MessageSource.mjs';
import { promises as fs, existsSync, copyFileSync } from 'fs';
import { MessageStats, mergeStatEntries } from './MessageStats.mjs';
export { mergeStatEntries };
const stats = new MessageStats();
const STATS_FILE = './message_stats.json';
export function recordMessageStat(message, metadata = {}) { return stats.record(message, metadata); }
export function getTopMessages(limit = 10) { return stats.all().slice(0, limit); }
export function getAllMessageStatsSorted() { return stats.all(); }
export function getMessageStats() { return new Map(stats.all().map(r => [r.message, r.count])); }
export function mergeStats(entries) { if (Array.isArray(entries)) stats.merge(entries); }
export async function saveStatsToFile(filePath = STATS_FILE) {
    await fs.writeFile(filePath, JSON.stringify(stats.all(), null, 2), 'utf-8');
}
export async function loadStatsFromFile(filePath = STATS_FILE) {
    try {
        const entries = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        if (Array.isArray(entries)) { stats.clear(); stats.merge(entries); }
    } catch (err) { if (err.code !== 'ENOENT') console.error('讀取統計失敗:', err); }
}
export function clearStats() { stats.clear(); }
await loadStatsFromFile();

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
        // 含簡體「濑」、異體「頼/賴」、全形 ｌｉｎｅ，並允許中間有空白。
        test: (u) => /加\s*(LINE|line|ｌｉｎｅ|[瀨濑頼賴])/i.test(u),
    },
    {
        name: 'user:廣告帳號-混淆字元',
        field: 'user',
        action: 'block',
        // 圈號（①-⑳ 等 Enclosed Alphanumerics）與數學粗體字母（𝗔-𝟵）：正常暱稱幾乎不會出現。
        test: (u) => /[\u2460-\u24FF]|[\u{1D400}-\u{1D7FF}]/u.test(u),
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
            if (codePoints.length < 8) return false;
            const cjk = (u.match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length;
            if (cjk === 0) return false;
            const other = codePoints.filter(c => !/[\u4e00-\u9fff\u3000-\u303f\w\s]/u.test(c)).length;
            if (other < 6) return false;
            const hasCombining = /[\u0300-\u036f\u20d0-\u20ff\ufe00-\ufe0f]/.test(u);
            return hasCombining ? other > cjk * 4 : other > cjk * 6;
        },
    },

    // ── 訊息內容：block ──
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
        match: /[^\p{L}\p{N}\s_]/gu,
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
    {
        name: 'msg:廣告-補幣/按我頭像',
        field: 'message',
        action: 'block',
        // 這類廣告會週期性換詞重刷，直接阻擋；不要再改寫成梗，否則等於變相洗版。
        test: (m) => /補[幣币]|按我頭像/.test(m),
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

// ===== 自訂規則檔 =====

// 使用者自己的規則放在 FilterRules.custom.js（不進版控）；首次啟動若不存在，從範本複製一份。
const CUSTOM_RULES_FILE = './FilterRules.custom.js';
const CUSTOM_RULES_EXAMPLE = './FilterRules.custom.example.js';

/**
 * 過濾掉格式不正確的自訂規則，避免一份打錯的檔案讓整個過濾器失效。
 */
export function validateFilterRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules.filter(rule => {
        if (!rule || typeof rule !== 'object') return false;
        if (!['user', 'message', 'any'].includes(rule.field)) return false;
        const action = rule.action || 'block';
        if (action === 'block') return typeof rule.test === 'function';
        if (action === 'replace' || action === 'delete') return rule.match instanceof RegExp || typeof rule.match === 'string';
        return false;
    });
}

try {
    if (!existsSync(CUSTOM_RULES_FILE) && existsSync(CUSTOM_RULES_EXAMPLE)) {
        copyFileSync(CUSTOM_RULES_EXAMPLE, CUSTOM_RULES_FILE);
        console.log('已從範本建立 FilterRules.custom.js');
    }
    const customRules = (await import('./FilterRules.custom.js')).default;
    const validRules = validateFilterRules(customRules);
    addFilterRules(validRules);
    if (validRules.length) console.log(`已載入 ${validRules.length} 條自訂過濾規則`);
} catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') console.error('自訂過濾規則載入失敗:', error);
}

export default {
    normalizeSource,
    mergeStatEntries,
    recordMessageStat,
    getTopMessages,
    getAllMessageStatsSorted,
    getMessageStats,
    mergeStats,
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
