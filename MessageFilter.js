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

// 頻率規則的線上狀態：Map(rule → 群組陣列)。模擬測試會用另一份 Map 完全隔離。
const liveThrottleState = new Map();

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
/**
 * 用指定規則清單處理一筆訊息。
 * `processFilter` 用線上規則；序列模擬會把候選規則接在後面一起跑。
 */
function processWithRules(rules, { user, message } = {}, now, throttleState) {
    user = (typeof user === 'string') ? user : '';
    message = (typeof message === 'string') ? message : '';
    let result = { user, message, blocked: false, reason: undefined, field: undefined, modified: false };

    for (const rule of rules) {
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

        if (action === 'throttle') {
            const outcome = applyThrottle(rule, result, now, throttleState);
            if (!outcome) continue;
            if (outcome.blocked) return { ...result, blocked: true, reason: rule.name, field: 'throttle' };
            result = { ...result, message: outcome.message, modified: true, reason: rule.name, field: 'message' };
        }
    }

    return result;
}

/** 用線上規則處理一筆訊息。 */
export function processFilter(input = {}, now = Date.now(), throttleState = liveThrottleState) {
    return processWithRules(filterRules, input, now, throttleState);
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
    liveThrottleState.clear();
}

/**
 * 取得所有規則列表（複本）
 */
export function getFilterRules() {
    return [...filterRules];
}

// ===== 頻率控制（有狀態；跨訊息）=====

/**
 * @typedef {Object} ThrottleRule
 * @property {'throttle'} action
 * @property {string} name
 * @property {'user'|'content'} scope  - user：同一人；content：同內容跨人
 * @property {number} windowMs         - 觀察窗（毫秒）
 * @property {number} max              - 窗內允許幾則，第 max+1 則起處置
 * @property {'off'|'exact'|'normalized'} similarity - off：純頻率（不看內容）；exact：完全相同；normalized：正規化後比對
 * @property {number} [distance]       - normalized 允許的編輯距離（預設 2）
 * @property {'drop'|'marker'|'summarize'} onExceed
 * @property {string} [marker]         - marker 模式的字尾，{n} 換成次數
 * @property {string} [summary]        - summarize 模式的摘要，{n}／{sample} 會替換
 */

/** 正規化：去掉 emoji 與其修飾、標點、符號、空白，再轉小寫。 */
function normalizeForCompare(text) {
    return text
        .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/gu, '')
        .replace(/[\p{P}\p{S}\s]/gu, '')
        .toLowerCase();
}

/** Levenshtein 距離；長度差已超過 limit 就直接回傳 limit + 1。 */
function editDistance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
        }
        previous = current;
    }
    return previous[b.length];
}

/** 兩則訊息是否算同一群。 */
function isSimilar(rule, a, b) {
    if (rule.similarity === 'off') return true;
    if (rule.similarity === 'exact') return a === b;
    const limit = rule.distance ?? 2;
    return editDistance(normalizeForCompare(a), normalizeForCompare(b), limit) <= limit;
}

/** 取得（必要時建立）某條規則在指定狀態下的群組。 */
function throttleGroups(state, rule) {
    let groups = state.get(rule);
    if (!groups) { groups = []; state.set(rule, groups); }
    return groups;
}

/**
 * 套用一條頻率規則。
 * @returns {null|{blocked?: boolean, message?: string}} null 表示放行；否則阻擋或改寫內容
 */
function applyThrottle(rule, result, now, state) {
    const groups = throttleGroups(state, rule);
    for (let i = groups.length - 1; i >= 0; i--) {
        if (now - groups[i].time > rule.windowMs) groups.splice(i, 1);
    }

    // 找最近的相符群組（依 scope 決定是否限同一人，再比相似度）。
    let group = null;
    for (let i = groups.length - 1; i >= 0; i--) {
        const candidate = groups[i];
        if (rule.scope === 'user' && candidate.user !== result.user) continue;
        if (!isSimilar(rule, candidate.sample, result.message)) continue;
        group = candidate;
        break;
    }
    if (!group) {
        group = { user: result.user, sample: result.message, time: now, count: 0, pending: 0 };
        groups.push(group);
    }

    group.time = now;
    group.count += 1;
    group.sample = result.message;   // 以「上一則」為比較基準（符合「與上一則差異不大」）
    if (group.count <= rule.max) return null;

    if (rule.onExceed === 'summarize') {
        group.pending += 1;
        return { blocked: true };
    }
    if (rule.onExceed === 'marker') {
        // marker 是「整串取代」的模板：{text}＝原文、{n}＝累積次數。
        // 預設只留標記；要保留原文就寫 '{text}（×{n}）'。
        const marker = (rule.marker || '（×{n}）')
            .replace('{text}', result.message)
            .replace('{n}', String(group.count));
        return { message: marker };
    }
    return { blocked: true };
}

/**
 * 取出「爆量已結束」的摘要（summarize 模式）。呼叫端負責把摘要送出去。
 */
export function takeThrottleSummaries(now = Date.now(), state = liveThrottleState, rules = filterRules) {
    const summaries = [];
    for (const rule of rules) {
        if ((rule.action || 'block') !== 'throttle') continue;
        const groups = state.get(rule);
        if (!groups) continue;
        for (let i = groups.length - 1; i >= 0; i--) {
            const group = groups[i];
            if (now - group.time <= rule.windowMs) continue;
            if (group.pending > 0) {
                summaries.push({
                    rule: rule.name,
                    user: group.user,
                    count: group.pending,
                    // 最早可能送出的時間＝最後一則 + 視窗；實際還要等下一次輪詢（最多再 +5 秒）。
                    at: group.time + rule.windowMs,
                    message: (rule.summary || '連續 {n} 則相似訊息（已省略）：{sample}')
                        .replace('{n}', String(group.pending))
                        .replace('{sample}', group.sample)
                });
            }
            groups.splice(i, 1);
        }
    }
    return summaries;
}

/**
 * 用一串訊息跑一次「隔離」的模擬（不動到線上狀態），供 /keyword 的序列測試。
 * 每則間隔 stepMs 毫秒；最後把時間往後推，讓 summarize 的摘要能結算出來。
 */
export function simulateSequence({ user = '', messages = [], stepMs = 1000, extraRules = [] } = {}, now = Date.now()) {
    const state = new Map();
    const rules = extraRules.length ? [...filterRules, ...extraRules] : filterRules;
    const results = messages.map((entry, index) => {
        const record = typeof entry === 'string' ? { user, message: entry } : entry;
        const time = now + index * stepMs;
        const result = processWithRules(rules, { user: record.user, message: record.message }, time, state);
        return { index, time, user: record.user, message: record.message, blocked: result.blocked, reason: result.reason, output: result.message };
    });
    const summaries = takeThrottleSummaries(now + messages.length * stepMs + 3600000, state, rules);
    return { results, summaries };
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
        name: 'any:廣告-混淆字元',
        field: 'any',
        action: 'block',
        // 圈號（①-⑳ 等 Enclosed Alphanumerics）與數學粗體字母（𝗔-𝟵）：正常暱稱或留言幾乎不會出現。
        // 用 any 是「預先防範」廣告哪天改成把帳號名塞進留言內容（目前尚未觀察到；目前是 emoji 洗頻）。
        test: (v) => /[\u2460-\u24FF]|[\u{1D400}-\u{1D7FF}]/u.test(v),
    },
    {
        name: 'msg:大量 emoji',
        field: 'message',
        action: 'block',
        // 連續 5 個以上 emoji：廣告用 emoji 洗頻，或拿來墊在帳號名前面。門檻可調。
        test: (m) => /(?:\p{Extended_Pictographic}[\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]*){5,}/u.test(m),
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
        if (action === 'throttle') {
            return ['user', 'content'].includes(rule.scope)
                && Number.isFinite(rule.windowMs) && rule.windowMs > 0
                && Number.isFinite(rule.max) && rule.max >= 0
                && ['off', 'exact', 'normalized'].includes(rule.similarity || 'normalized')
                && ['drop', 'marker', 'summarize'].includes(rule.onExceed || 'drop');
        }
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
    takeThrottleSummaries,
    simulateSequence,
};
