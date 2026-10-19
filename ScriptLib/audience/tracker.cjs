const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DAY = 86400000;
const WINDOW_DAYS = 30;
const MAX_MESSAGES_PER_SESSION = 10;
const MAX_MESSAGES_PER_MINUTE = 2;
const MAX_GIFTS_PER_SESSION = 5;
const MAX_LIST_USERS = 2000;
const PAGE_SIZE = 50;

const PLATFORM_NAMES = {
    tiktok: 'TikTok', twitch: 'Twitch', kick: 'Kick', youtube: 'Youtube', odysee: 'Odysee'
};
const IGNORED_CATEGORIES = new Set(['system', 'audience', 'heartbeat', 'summary', 'ad', 'clip']);

const LEVELS = [
    { level: 4, minScore: 85, gate: 'streak>=6' },
    { level: 3, minScore: 65, gate: 'activeStreams>=10' },
    { level: 2, minScore: 40, gate: 'streak>=3' },
    { level: 1, minScore: 20, gate: 'activeStreams>=3' }
];

/** 將監控 payload 的平台名稱統一成 traffic 使用的名稱。 */
function platformName(value) {
    const key = String(value || '').trim().toLowerCase();
    return PLATFORM_NAMES[key] || (key ? String(value).trim() : '');
}

/** 優先用平台 userId，沒有時才退回顯示名稱；回傳 key 與顯示名稱。 */
function identity(entry) {
    const id = entry?.userId;
    const idText = (typeof id === 'string' || typeof id === 'number') ? String(id).trim() : '';
    const name = typeof entry?.user === 'string' ? entry.user.trim() : '';
    if (!idText && !name) return null;
    if (name === '系統') return null;
    return { key: (idText || name).toLowerCase(), name: name || idText };
}

/**
 * 計算 0–100 的活躍分數；每個分量都有上限，避免洗頻或送禮金額直接決定等級。
 * @param {Object} stats 出席、連續、活躍天數、訊息與送禮次數。
 * @returns {Object} 各分量分數與總分。
 */
function computeScore({ activeStreams = 0, streak = 0, activeDays = 0, messages = 0, gifts = 0 } = {}) {
    const round = value => Math.round(value * 1000) / 1000;
    const attendance = round(Math.min(activeStreams / 20, 1) * 35);
    const consecutive = round(Math.min(streak / 8, 1) * 25);
    const breadth = round(Math.min(activeDays / 15, 1) * 15);
    const interaction = round(Math.min(messages / 100, 1) * 15);
    const support = round(Math.min(gifts / 10, 1) * 10);
    return {
        attendance, consecutive, breadth, interaction, support,
        total: Math.round((attendance + consecutive + breadth + interaction + support) * 10) / 10
    };
}

/** 依分數與門檻換算 0–4 級；分數達標但出席／連續不足時不升級。 */
function levelFor({ score = 0, activeStreams = 0, streak = 0 } = {}) {
    if (score >= 85 && streak >= 6) return 4;
    if (score >= 65 && activeStreams >= 10) return 3;
    if (score >= 40 && streak >= 3) return 2;
    if (score >= 20 && activeStreams >= 3) return 1;
    return 0;
}

/** 產生監控頁用的簡短標記；標記不寫入資料庫，門檻調整後立即生效。 */
function labelsFor({ activeStreams = 0, streak = 0, messages = 0, gifts = 0, giftStreams = 0, tenureDays = 0 } = {}) {
    const labels = [];
    if (giftStreams >= 2 && gifts >= 3) labels.push('giftRegular');
    if (streak >= 3) labels.push('alwaysHere');
    if (activeStreams >= 3 && messages >= 20) labels.push('frequentChatter');
    if (tenureDays < 7) labels.push('newcomer');
    return labels;
}

/**
 * 建立觀眾活躍度追蹤器；資料寫入獨立的 audience.sqlite，不與 traffic 分類混用。
 * @param {Object} [options]
 * @param {string} [options.file] SQLite 檔案，`:memory:` 供測試使用。
 * @param {(platform: string, time: number) => (number|null)} [options.sessionFor] 查詢時間點所屬的 traffic 場次。
 * @param {(platform: string, limit: number) => number[]} [options.recentSessions] 查詢最近場次 id（新到舊）。
 * @param {() => string} [options.timezone] 活躍日期使用的時區。
 * @param {() => number} [options.now] 注入時鐘。
 * @returns {Object} observe／list／details／prune／close。
 */
function createAudienceTracker({
    file = path.resolve(__dirname, '../../data/audience.sqlite'),
    sessionFor = () => null,
    recentSessions = () => [],
    timezone = () => 'Asia/Taipei',
    now = Date.now
} = {}) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS audience_users (
            platform TEXT NOT NULL, user_key TEXT NOT NULL, display_name TEXT NOT NULL,
            first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
            PRIMARY KEY(platform,user_key)
        );
        CREATE TABLE IF NOT EXISTS audience_attendance (
            platform TEXT NOT NULL, session INTEGER NOT NULL, user_key TEXT NOT NULL,
            day TEXT NOT NULL, messages INTEGER NOT NULL DEFAULT 0, gifts INTEGER NOT NULL DEFAULT 0,
            joins INTEGER NOT NULL DEFAULT 0, last_seen INTEGER NOT NULL,
            PRIMARY KEY(platform,session,user_key)
        );
        CREATE TABLE IF NOT EXISTS audience_days (
            platform TEXT NOT NULL, user_key TEXT NOT NULL, day TEXT NOT NULL,
            PRIMARY KEY(platform,user_key,day)
        );
        CREATE INDEX IF NOT EXISTS audience_attendance_user
            ON audience_attendance(platform,user_key,last_seen);
        CREATE INDEX IF NOT EXISTS audience_days_user
            ON audience_days(platform,user_key,day);
    `);

    let dayFormatter = null;
    let dayFormatterZone = '';
    const dayKey = time => {
        const zone = timezone();
        if (zone !== dayFormatterZone) {
            dayFormatterZone = zone;
            dayFormatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
            });
        }
        return dayFormatter.format(time);
    };

    const minuteCounts = new Map();
    const summaryCache = new Map();
    const sessionCache = new Map();

    const recentFor = platform => {
        const cached = sessionCache.get(platform);
        if (cached && now() - cached.at < 5000) return cached.ids;
        const ids = (recentSessions(platform, 30) || [])
            .map(value => Number(value))
            .filter(Number.isSafeInteger);
        sessionCache.set(platform, { at: now(), ids });
        return ids;
    };

    const allowMessage = (platform, key, session, time) => {
        const minute = Math.floor(time / 60000);
        const mapKey = [platform, key, session ?? 0, minute].join('|');
        const current = minuteCounts.get(mapKey);
        if (current && current.count >= MAX_MESSAGES_PER_MINUTE) return false;
        minuteCounts.set(mapKey, { minute, count: (current?.count || 0) + 1 });
        if (minuteCounts.size > 2000) {
            for (const [entryKey, value] of minuteCounts) {
                if (value.minute < minute - 2) minuteCounts.delete(entryKey);
            }
        }
        return true;
    };

    /** 彙總單一使用者最近 30 天的活動；分數與等級在讀取時計算。 */
    const summary = (platform, key) => {
        const user = db.prepare('SELECT * FROM audience_users WHERE platform=? AND user_key=?').get(platform, key);
        if (!user) return null;
        const cutoff = now() - WINDOW_DAYS * DAY;
        const rows = db.prepare(`SELECT session,messages,gifts,joins,day,last_seen
            FROM audience_attendance WHERE platform=? AND user_key=?`).all(platform, key);
        const bySession = new Map(rows.map(row => [Number(row.session), row]));
        const recent = rows.filter(row => row.last_seen >= cutoff);
        const activeStreams = recent.length;
        const messages = recent.reduce((total, row) => total + row.messages, 0);
        const gifts = recent.reduce((total, row) => total + row.gifts, 0);
        const giftStreams = recent.filter(row => row.gifts > 0).length;
        const activeDays = db.prepare(`SELECT COUNT(*) AS n FROM audience_days
            WHERE platform=? AND user_key=? AND day>=?`).get(platform, key, dayKey(cutoff)).n;
        let streak = 0;
        for (const id of recentFor(platform)) {
            if (!bySession.has(id)) break;
            streak++;
        }
        const tenureDays = Math.max(0, Math.floor((now() - user.first_seen) / DAY));
        const components = computeScore({ activeStreams, streak, activeDays, messages, gifts });
        const level = levelFor({ score: components.total, activeStreams, streak });
        return {
            platform,
            userKey: key,
            displayName: user.display_name,
            firstSeen: user.first_seen,
            lastSeen: user.last_seen,
            tenureDays,
            activeStreams,
            streak,
            activeDays,
            messages,
            gifts,
            giftStreams,
            score: components.total,
            components,
            level,
            labels: labelsFor({ activeStreams, streak, messages, gifts, giftStreams, tenureDays })
        };
    };

    const cachedSummary = (platform, key) => {
        const cacheKey = `${platform}|${key}`;
        const cached = summaryCache.get(cacheKey);
        if (cached && now() - cached.at < 5000) return cached.value;
        const value = summary(platform, key);
        if (!value) { summaryCache.delete(cacheKey); return null; }
        summaryCache.set(cacheKey, { at: now(), value });
        if (summaryCache.size > 2000) {
            for (const [entryKey, entry] of summaryCache) {
                if (now() - entry.at >= 5000) summaryCache.delete(entryKey);
            }
        }
        return value;
    };

    const list = ({ platform = '', q = '', sort = 'score', page = 1, pageSize = PAGE_SIZE } = {}) => {
        if (!Number.isInteger(page) || page < 1 || page > 100000) throw new RangeError('page');
        const size = Math.min(Math.max(Number(pageSize) || PAGE_SIZE, 1), 100);
        const users = db.prepare(`SELECT platform,user_key FROM audience_users
            WHERE (?='' OR platform=?) AND (?='' OR instr(lower(display_name),lower(?))>0)
            ORDER BY last_seen DESC LIMIT ?`).all(platform, platform, q, q, MAX_LIST_USERS);
        const rows = users.map(row => summary(row.platform, row.user_key)).filter(Boolean);
        const order = {
            score: (a, b) => b.score - a.score || b.lastSeen - a.lastSeen,
            sessions: (a, b) => b.activeStreams - a.activeStreams || b.score - a.score,
            messages: (a, b) => b.messages - a.messages || b.score - a.score,
            recent: (a, b) => b.lastSeen - a.lastSeen
        };
        rows.sort(order[sort] || order.score);
        return {
            users: rows.slice((page - 1) * size, page * size),
            total: rows.length,
            page,
            pageSize: size,
            sort: order[sort] ? sort : 'score',
            generatedAt: now()
        };
    };

    const details = (platform, key) => {
        const info = summary(platform, key);
        if (!info) return null;
        const recent = db.prepare(`SELECT session,day,messages,gifts,joins,last_seen
            FROM audience_attendance WHERE platform=? AND user_key=?
            ORDER BY last_seen DESC LIMIT 10`).all(platform, key);
        return { ...info, recent, levels: LEVELS };
    };

    const observe = entry => {
        const platform = platformName(entry?.platform);
        const user = identity(entry);
        if (!platform || !user) return null;
        const category = String(entry.category || '');
        if (IGNORED_CATEGORIES.has(category)) return null;
        const time = Number(entry.t) || now();
        const day = dayKey(time);
        const isMessage = category === 'chat' && typeof entry.message === 'string' &&
            !/^(?:[!/]|G#)/i.test(entry.message.trim());
        const isGift = category === 'gift';
        const isJoin = category === 'member' || category === 'join' || category === 'follow';
        const rawSession = sessionFor(platform, time);
        const session = Number.isSafeInteger(rawSession) ? rawSession
            : (Number.isSafeInteger(Number(rawSession)) ? Number(rawSession) : null);

        db.exec('BEGIN IMMEDIATE');
        try {
            db.prepare(`INSERT INTO audience_users(platform,user_key,display_name,first_seen,last_seen)
                VALUES(?,?,?,?,?) ON CONFLICT(platform,user_key) DO UPDATE SET
                display_name=excluded.display_name,last_seen=excluded.last_seen`)
                .run(platform, user.key, user.name, time, time);
            db.prepare('INSERT OR IGNORE INTO audience_days(platform,user_key,day) VALUES(?,?,?)')
                .run(platform, user.key, day);
            if (session !== null) {
                const current = db.prepare(`SELECT messages,gifts,joins FROM audience_attendance
                    WHERE platform=? AND session=? AND user_key=?`).get(platform, session, user.key);
                const messages = Math.min(MAX_MESSAGES_PER_SESSION, (current?.messages || 0) +
                    (isMessage && allowMessage(platform, user.key, session, time) ? 1 : 0));
                const gifts = Math.min(MAX_GIFTS_PER_SESSION, (current?.gifts || 0) + (isGift ? 1 : 0));
                const joins = Math.min(1, (current?.joins || 0) + (isJoin ? 1 : 0));
                db.prepare(`INSERT INTO audience_attendance(platform,session,user_key,day,messages,gifts,joins,last_seen)
                    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(platform,session,user_key) DO UPDATE SET
                    day=excluded.day,messages=excluded.messages,gifts=excluded.gifts,
                    joins=excluded.joins,last_seen=excluded.last_seen`)
                    .run(platform, session, user.key, day, messages, gifts, joins, time);
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        const info = cachedSummary(platform, user.key);
        if (!info) return null;
        return {
            level: info.level,
            score: info.score,
            labels: info.labels,
            sessions: info.activeStreams,
            streak: info.streak,
            days: info.activeDays,
            messages: info.messages,
            gifts: info.gifts,
            tenureDays: info.tenureDays
        };
    };

    const prune = (days = 180) => {
        const cutoff = now() - days * DAY;
        let changed = 0;
        db.exec('BEGIN IMMEDIATE');
        try {
            changed += db.prepare('DELETE FROM audience_attendance WHERE last_seen<?').run(cutoff).changes;
            changed += db.prepare('DELETE FROM audience_days WHERE day<?').run(dayKey(cutoff)).changes;
            changed += db.prepare('DELETE FROM audience_users WHERE last_seen<?').run(cutoff).changes;
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        return changed;
    };

    return { observe, list, details, prune, close: () => db.close() };
}

module.exports = { createAudienceTracker, computeScore, levelFor, labelsFor, LEVELS, platformName };
