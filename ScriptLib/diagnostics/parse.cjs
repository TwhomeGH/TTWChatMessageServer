/**
 * 把外部應用送進來的原始 log body 整理成可分析的診斷資料。
 *
 * 這裡只做「顯示與搜尋用」的解析，不改寫原始 title／body；未知欄位保留在
 * fields，沒有可靠 timestamp 時保留空字串，讓呼叫端自行用 receivedAt 顯示。
 */

const TAG = /\[([^[\]]{1,80})\]/;
const TIMESTAMP = /^(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\S*\d{1,2}:\d{2}:\d{2}):\s*(.*)$/;
const SESSION = /\bsession(?:Id)?=([0-9A-Fa-f-]{8,}|[A-Za-z0-9_.-]+)/;
const FIELD = /\b([A-Za-z_][A-Za-z0-9_.-]*)=([^\s]+)/g;
const ERROR_WORDS = /\b(failed|failure|fatal|panic|crash|jetsam|watchdog|abort|exception)\b/gi;
const WARN_WORDS = /(\[!\]|warning|memory\.warning|save failed|incomplete|syncState=(drifting|jumped)|lastError=(?!none\b|0\b)\S+)/i;
const FALSE_VALUES = new Set(['0', 'none', 'false', 'no']);

/**
 * 把 log body 的關鍵字分成 error／warn／info，避免 `failed=0` 或
 * `lastError=none` 被誤判成錯誤。
 * @param {string} text
 * @returns {'error'|'warn'|'info'}
 */
function classifySeverity(text) {
    const value = String(text || '');
    for (const match of value.matchAll(ERROR_WORDS)) {
        const suffix = value.slice(match.index + match[0].length);
        const assigned = suffix.match(/^\s*=\s*([^\s]+)/);
        if (assigned && FALSE_VALUES.has(assigned[1].toLowerCase())) continue;
        return 'error';
    }
    const assigned = value.match(/\berror\s*=\s*([^\s]+)/i);
    if (assigned && !FALSE_VALUES.has(assigned[1].toLowerCase())) return 'error';
    if (WARN_WORDS.test(value)) return 'warn';
    return 'info';
}

/** 從 title／body 取得第一個 tag；沒有 tag 時用 title 作為分類。 */
function categoryOf(title, body) {
    const tag = TAG.exec(body) || TAG.exec(title);
    if (tag) return tag[1].trim();
    const fallback = String(title || '').trim();
    return fallback && fallback !== 'log' ? fallback.slice(0, 80) : 'Other';
}

/** 只保留短 value，避免把整段 JSON 或檔案路徑拆成欄位。 */
function fieldsOf(body) {
    const fields = {};
    for (const match of String(body || '').matchAll(FIELD)) {
        if (match[2].length <= 160) fields[match[1]] = match[2];
    }
    return fields;
}

/** 接受發送端已整理好的 fields；只保留短字串值，避免任意巢狀物件進到 UI。 */
function providedFields(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const fields = {};
    for (const [key, raw] of Object.entries(value)) {
        const text = String(raw ?? '').trim();
        if (key && text && text.length <= 160) fields[key] = text;
    }
    return Object.keys(fields).length ? fields : null;
}

/**
 * 優先使用 JSON payload 已提供的結構化欄位；只有舊版 sender 只帶
 * time／title／body 時，才用文字規則補分類、嚴重度、session 與 fields。
 *
 * @param {{time?: string, title?: string, body?: string, receivedAt?: number,
 *   category?: string, severity?: 'error'|'warn'|'info', session?: string, fields?: Object}} entry
 * @returns {{time: string, title: string, body: string, receivedAt: number,
 *   category: string, severity: 'error'|'warn'|'info', session: string|null,
 *   fields: Object<string,string>}}
 */
function parseDiagnosticLog(entry = {}) {
    const title = String(entry.title ?? 'log').trim() || 'log';
    let body = String(entry.body ?? entry.message ?? '').trimStart();
    let time = String(entry.time ?? '').trim();
    const timestamp = TIMESTAMP.exec(body);
    if (timestamp) {
        time = time || timestamp[1];
        body = timestamp[2];
    }
    if (body.startsWith('liveApp:')) body = body.slice('liveApp:'.length).trimStart();

    const suppliedSeverity = String(entry.severity ?? '').trim().toLowerCase();
    const severity = ['error', 'warn', 'info'].includes(suppliedSeverity)
        ? suppliedSeverity
        : classifySeverity(`${title}\n${body}`);
    const suppliedCategory = String(entry.category ?? '').trim();
    const parsedSession = SESSION.exec(body) || SESSION.exec(title);
    const suppliedSession = String(entry.session ?? '').trim();
    const suppliedFields = providedFields(entry.fields);
    return {
        time,
        title,
        body,
        receivedAt: Number(entry.receivedAt) || 0,
        category: suppliedCategory.slice(0, 80) || categoryOf(title, body),
        severity,
        session: suppliedSession || (parsedSession ? parsedSession[1] : null),
        fields: suppliedFields || fieldsOf(body)
    };
}

/**
 * 產生不隨篩選變動的全量摘要。
 * @param {Array<ReturnType<typeof parseDiagnosticLog>>} logs
 */
function summarizeDiagnostics(logs) {
    const categories = new Map();
    const sessions = new Set();
    let warn = 0;
    let error = 0;
    let info = 0;
    for (const line of logs) {
        categories.set(line.category, (categories.get(line.category) || 0) + 1);
        if (line.session) sessions.add(line.session);
        if (line.severity === 'error') error++;
        else if (line.severity === 'warn') warn++;
        else info++;
    }
    const first = logs.find(line => line.time)?.time || '';
    const last = [...logs].reverse().find(line => line.time)?.time || '';
    return {
        total: logs.length,
        range: first ? (first === last ? first : `${first} ～ ${last}`) : '無時間戳',
        categories: [...categories.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([name, count]) => ({ name, count })),
        sessions: [...sessions].sort(),
        warn,
        error,
        info
    };
}

module.exports = { parseDiagnosticLog, summarizeDiagnostics, classifySeverity };
