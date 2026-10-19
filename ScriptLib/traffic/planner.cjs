const ASSIGNABLE_PURPOSES = ['own', 'reference', 'test'];
const STATUSES = ['unclassified', 'own', 'reference', 'test', 'all'];
const BACKFILL_COMPLETE_SAMPLES = 2;
const MAX_BACKFILL = 20000;
const MAX_BACKFILL_SELECTION = 500;
const BACKFILL_SOURCE = `FROM sessions s LEFT JOIN traffic_profiles p
    ON p.platform=s.platform AND p.broadcaster=s.broadcaster`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HALF_HOUR = 30 * 60000;
const DAY = 86400000;
const formatters = new Map();
const DEFAULTS = {
    enabled: false, channels: [], timezone: 'Asia/Taipei', historyDays: 90,
    maxPerWeek: 1, weekdays: [0, 1, 2, 3, 4, 5, 6], hours: [18, 19, 20, 21, 22, 23]
};

/** 正規化主播識別：去空白、去開頭 @、轉小寫；空白回傳空字串。 */
function normalizeBroadcaster(value) {
    return typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
}

/**
 * 建立批次補分類的篩選 SQL（不含完整度條件）。
 * @param {Object} filter 平台、狀態與起始時間。
 * @returns {{effective: string, where: string, args: Array}} SQL 片段與參數。
 */
function backfillFilter({ platform, status, from }) {
    const effective = "COALESCE(s.purpose,p.purpose,'unknown')";
    const clauses = [];
    const args = [];
    if (platform) { clauses.push('s.platform=?'); args.push(platform); }
    if (status === 'unclassified') clauses.push(`${effective}='unknown'`);
    else if (status !== 'all') { clauses.push(`${effective}=?`); args.push(status); }
    if (from !== null) { clauses.push('COALESCE(s.actualStarted,s.started)>=?'); args.push(from); }
    return { effective, where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', args };
}

/** 驗證批次補分類的篩選欄位；不驗證要套用的值。 */
function validateBackfill(value = {}) {
    const platform = value.platform ?? '';
    if (typeof platform !== 'string' || platform.length > 40) throw new RangeError('backfill');
    const status = value.status ?? 'unclassified';
    if (!STATUSES.includes(status)) throw new RangeError('status');
    const days = value.days ?? null;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw new RangeError('days');
    if (typeof value.completeOnly !== 'boolean') throw new RangeError('completeOnly');
    const from = value.from ?? null;
    if (from !== null && !Number.isSafeInteger(from)) throw new RangeError('backfill');
    return { platform, status, days, completeOnly: value.completeOnly, from };
}

/** 將 UTC 時間轉為排程使用的本地日期、星期與整點；不依賴主機時區。 */
function calendar(time, timezone) {
    if (!formatters.has(timezone)) {
        if (formatters.size >= 32) formatters.clear();
        formatters.set(timezone, new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }));
    }
    const parts = Object.fromEntries(formatters.get(timezone).formatToParts(time).map(part => [part.type, part.value]));
    const day = WEEKDAYS.indexOf(parts.weekday);
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const week = new Date(Date.parse(date + 'T00:00:00Z') - day * DAY).toISOString().slice(0, 10);
    return { date, week, day, hour: Number(parts.hour), minute: Number(parts.minute), key: `${parts.weekday} ${parts.hour}` };
}

/** 驗證完整提醒設定；錯誤時拋出 RangeError，不接受靜默修正的排程。 */
function validateSettings(value) {
    if (!value || typeof value.enabled !== 'boolean') throw new RangeError('enabled');
    if (!Array.isArray(value.channels) || value.channels.some(x => !['ntfy', 'bark'].includes(x))) throw new RangeError('channels');
    if (value.enabled && !value.channels.length) throw new RangeError('channels');
    if (![30, 90, 180].includes(value.historyDays)) throw new RangeError('historyDays');
    if (!Number.isInteger(value.maxPerWeek) || value.maxPerWeek < 1 || value.maxPerWeek > 7) throw new RangeError('maxPerWeek');
    for (const [key, max] of [['weekdays', 6], ['hours', 23]]) {
        if (!Array.isArray(value[key]) || !value[key].length || value[key].length > max + 1 ||
            value[key].some(x => !Number.isInteger(x) || x < 0 || x > max)) throw new RangeError(key);
    }
    if (typeof value.timezone !== 'string' || value.timezone.length > 100) throw new RangeError('timezone');
    try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); }
    catch { throw new RangeError('timezone'); }
    return {
        enabled: value.enabled, channels: [...new Set(value.channels)], timezone: value.timezone,
        historyDays: value.historyDays, maxPerWeek: value.maxPerWeek,
        weekdays: [...new Set(value.weekdays)], hours: [...new Set(value.hours)]
    };
}

/**
 * 主播分類、歷史建議及持久提醒。所有發送由注入的 send 執行，測試不接觸外部服務。
 */
class TrafficPlanner {
    /** @param {Object} database TrafficDatabase。 @param {Object} options 注入時鐘、發送與通道設定狀態。 */
    constructor(database, { now = Date.now, send = async () => false, available = () => ({}) } = {}) {
        this.database = database;
        this.db = database.db;
        this.now = now;
        this.send = send;
        this.available = available;
        this.busy = false;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS traffic_planner_settings (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS traffic_reminders (
                id INTEGER PRIMARY KEY, platform TEXT NOT NULL, broadcaster TEXT NOT NULL,
                startAt INTEGER NOT NULL, week TEXT NOT NULL, slot TEXT NOT NULL, evidence TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'planned', UNIQUE(platform,broadcaster,startAt)
            );
            CREATE TABLE IF NOT EXISTS traffic_deliveries (
                startAt INTEGER NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, updatedAt INTEGER NOT NULL,
                PRIMARY KEY(startAt,channel)
            );
            CREATE TABLE IF NOT EXISTS traffic_classification_batches (
                id INTEGER PRIMARY KEY, createdAt INTEGER NOT NULL, platform TEXT NOT NULL, status TEXT NOT NULL,
                broadcaster TEXT, purpose TEXT, matched INTEGER NOT NULL, completeOnly INTEGER NOT NULL,
                days INTEGER, fromAt INTEGER, setBroadcaster INTEGER NOT NULL DEFAULT 0,
                setPurpose INTEGER NOT NULL DEFAULT 0, undoneAt INTEGER
            );
            CREATE TABLE IF NOT EXISTS traffic_classification_batch_rows (
                batch INTEGER NOT NULL, session INTEGER NOT NULL,
                previousBroadcaster TEXT, previousPurpose TEXT,
                PRIMARY KEY(batch, session)
            );
        `);
        // 「未分類」只是狀態，舊版卻曾把它寫成字面值。清掉後由 NULL 表示，
        // 避免同一狀態有兩種儲存方式，也讓可指派的用途只剩三種。
        this.db.exec("UPDATE sessions SET purpose=NULL WHERE purpose='unknown'");
        this.db.exec("DELETE FROM traffic_profiles WHERE purpose='unknown'");
    }

    /** @returns {Object} 已保存設定，未設定時關閉提醒。 */
    settings() {
        const row = this.db.prepare('SELECT payload FROM traffic_planner_settings WHERE id=1').get();
        return row ? JSON.parse(row.payload) : structuredClone(DEFAULTS);
    }

    /** @param {Object} value 完整設定。 @returns {void} */
    saveSettings(value) {
        const settings = validateSettings(value);
        const available = this.available();
        if (settings.enabled && settings.channels.some(channel => !available[channel])) throw new RangeError('channelNotConfigured');
        this.db.prepare('INSERT OR REPLACE INTO traffic_planner_settings VALUES(1,?)').run(JSON.stringify(settings));
        this.db.prepare("UPDATE traffic_reminders SET status='cancelled' WHERE status='planned'").run();
    }

    /**
     * 設定主播的預設用途；單場覆寫優先。purpose 為 null 時刪除預設，回到待分類。
     * @param {Object} value 平台、主播、用途。
     * @returns {void}
     */
    classifyProfile({ platform, broadcaster, purpose }) {
        if (typeof platform !== 'string' || !platform || platform.length > 40 || typeof broadcaster !== 'string' ||
            !normalizeBroadcaster(broadcaster) || broadcaster.length > 100 ||
            (purpose !== null && !ASSIGNABLE_PURPOSES.includes(purpose))) throw new RangeError('profile');
        const key = normalizeBroadcaster(broadcaster);
        if (purpose === null) {
            this.db.prepare('DELETE FROM traffic_profiles WHERE platform=? AND broadcaster=?').run(platform, key);
            return;
        }
        this.db.prepare('INSERT OR REPLACE INTO traffic_profiles VALUES(?,?,?)').run(platform, key, purpose);
    }

    /** 單場歸屬與用途可還原；不刪除原始統計。 @param {Object} value 場次 id、主播、用途（null 沿用帳號）。 */
    classifySession({ id, broadcaster, purpose }) {
        if (!Number.isSafeInteger(id) || typeof broadcaster !== 'string' || broadcaster.length > 100 ||
            (purpose !== null && !ASSIGNABLE_PURPOSES.includes(purpose))) throw new RangeError('session');
        const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
        if (!row) throw new RangeError('session');
        this.db.prepare('UPDATE sessions SET broadcaster=?,purpose=? WHERE id=?')
            .run(normalizeBroadcaster(broadcaster) || null, purpose, id);
    }

    /**
     * 批次指定用途；purpose 為 null 時清除單場設定（沿用帳號預設）。
     * @param {number[]} ids 場次 id，最多 50 筆。
     * @param {string|null} purpose 可指派用途或 null。
     * @returns {number} 實際變更的場次數。
     */
    assign(ids, purpose) {
        if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => !Number.isSafeInteger(id)))
            throw new RangeError('sessions');
        if (purpose !== null && !ASSIGNABLE_PURPOSES.includes(purpose)) throw new RangeError('purpose');
        const statement = this.db.prepare('UPDATE sessions SET purpose=? WHERE id=?');
        this.db.exec('BEGIN');
        let changed = 0;
        try {
            for (const id of ids) changed += statement.run(purpose, id).changes;
            this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
        return changed;
    }

    /** 舊入口：批次標記測試；保留給既有呼叫端一版。 @param {number[]} ids 場次 id。 @returns {number} 變更數。 */
    markTests(ids) { return this.assign(ids, 'test'); }

    /**
     * 預覽批次補分類會影響的場次；只讀取，不修改資料。
     * @param {Object} value 平台、狀態、天數、完整度與預覽用起始時間。
     * @returns {Object} 符合場次、被排除的資料不足場次、平台分布與樣本。
     */
    previewBackfill(value = {}) {
        const filter = validateBackfill(value);
        const from = filter.from ?? (filter.days ? this.now() - filter.days * DAY : null);
        const { effective, where, args } = backfillFilter({ ...filter, from });
        const completeWhere = filter.completeOnly
            ? (where ? where + ' AND ' : 'WHERE ') + 's.sampleCount>=?'
            : where;
        const completeArgs = filter.completeOnly ? [...args, BACKFILL_COMPLETE_SAMPLES] : args;
        const matched = this.db.prepare(`SELECT COUNT(*) AS n ${BACKFILL_SOURCE} ${completeWhere}`).get(...completeArgs).n;
        const excludedIncomplete = filter.completeOnly
            ? this.db.prepare(`SELECT COUNT(*) AS n ${BACKFILL_SOURCE} ${where ? where + ' AND ' : 'WHERE '}s.sampleCount<?`)
                .get(...args, BACKFILL_COMPLETE_SAMPLES).n
            : 0;
        const byPlatform = this.db.prepare(`SELECT s.platform, COUNT(*) AS n ${BACKFILL_SOURCE} ${completeWhere}
            GROUP BY s.platform ORDER BY n DESC,s.platform`).all(...completeArgs);
        const rows = this.db.prepare(`SELECT s.id,s.platform,s.broadcaster,s.purpose,s.started,s.actualStarted,s.ended,
            s.spanMs,s.area,s.lastViewers,s.peak,s.chats,s.joins,s.sampleCount,
            ${effective} AS effectivePurpose,
            CASE WHEN s.spanMs>0 THEN s.area/s.spanMs ELSE s.lastViewers END AS averageViewers
            ${BACKFILL_SOURCE} ${completeWhere}
            ORDER BY s.started DESC,s.id DESC LIMIT 50`).all(...completeArgs);
        return { matched, tooMany: matched > MAX_BACKFILL, excludedIncomplete, byPlatform, rows,
            truncated: matched > rows.length, from, filter: { ...filter, from } };
    }

    /**
     * 批次補上主播／用途；只更新分類欄位並記錄前一版以便復原。
     * @param {Object} value 篩選、要套用的值與預期場次數。
     * @returns {Object} 批次 id 與實際變更數。
     */
    applyBackfill(value = {}) {
        const filter = validateBackfill(value);
        const hasBroadcaster = Object.hasOwn(value, 'broadcaster');
        const hasPurpose = Object.hasOwn(value, 'purpose');
        if (!hasBroadcaster && !hasPurpose) throw new RangeError('assignment');
        let broadcaster = null;
        if (hasBroadcaster) {
            if (typeof value.broadcaster !== 'string' || value.broadcaster.length > 100)
                throw new RangeError('broadcaster');
            broadcaster = normalizeBroadcaster(value.broadcaster);
            if (!broadcaster) throw new RangeError('broadcaster');
        }
        if (hasPurpose && value.purpose !== null && !ASSIGNABLE_PURPOSES.includes(value.purpose))
            throw new RangeError('purpose');
        const from = filter.from ?? (filter.days ? this.now() - filter.days * DAY : null);
        let rows;
        if (Array.isArray(value.ids)) {
            // 勾選模式：只處理使用者實際勾選的場次，避免預覽後新增的資料被一起改掉。
            if (!value.ids.length || value.ids.length > MAX_BACKFILL_SELECTION ||
                value.ids.some(id => !Number.isSafeInteger(id))) throw new RangeError('sessions');
            const ids = [...new Set(value.ids)];
            if (!Number.isSafeInteger(value.expected) || value.expected !== ids.length) throw new RangeError('changed');
            const placeholders = ids.map(() => '?').join(',');
            rows = this.db.prepare(`SELECT id,broadcaster,purpose FROM sessions WHERE id IN (${placeholders}) ORDER BY id`)
                .all(...ids);
            if (rows.length !== ids.length) throw new RangeError('changed');
        } else {
            if (!Number.isSafeInteger(value.expected) || value.expected < 1) throw new RangeError('sessions');
            const { where, args } = backfillFilter({ ...filter, from });
            const completeWhere = filter.completeOnly
                ? (where ? where + ' AND ' : 'WHERE ') + 's.sampleCount>=?'
                : where;
            const completeArgs = filter.completeOnly ? [...args, BACKFILL_COMPLETE_SAMPLES] : args;
            rows = this.db.prepare(`SELECT s.id,s.broadcaster,s.purpose ${BACKFILL_SOURCE} ${completeWhere}
                ORDER BY s.id`).all(...completeArgs);
            if (rows.length !== value.expected) throw new RangeError('changed');
            if (rows.length > MAX_BACKFILL) throw new RangeError('tooMany');
        }
        const set = [];
        const setArgs = [];
        if (hasBroadcaster) { set.push('broadcaster=?'); setArgs.push(broadcaster); }
        if (hasPurpose) { set.push('purpose=?'); setArgs.push(value.purpose); }
        const update = this.db.prepare(`UPDATE sessions SET ${set.join(',')} WHERE id=?`);
        const record = this.db.prepare('INSERT INTO traffic_classification_batch_rows VALUES(?,?,?,?)');
        this.db.exec('BEGIN IMMEDIATE');
        let batch;
        try {
            batch = this.db.prepare(`INSERT INTO traffic_classification_batches(
                    createdAt,platform,status,broadcaster,purpose,matched,completeOnly,days,fromAt,setBroadcaster,setPurpose)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
                this.now(), filter.platform, filter.status, hasBroadcaster ? broadcaster : null,
                hasPurpose ? value.purpose : null, rows.length, filter.completeOnly ? 1 : 0,
                filter.days, from, hasBroadcaster ? 1 : 0, hasPurpose ? 1 : 0).lastInsertRowid;
            for (const row of rows) {
                record.run(batch, row.id, row.broadcaster, row.purpose);
                update.run(...setArgs, row.id);
            }
            this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
        return { saved: true, batch, changed: rows.length };
    }

    /**
     * 讀取批次補分類的明細，供復原前確認。
     * @param {number} id 批次 id。
     * @param {number} page 頁碼。
     * @returns {Object} 批次、目前值、復原後值與分頁。
     */
    batchDetails(id, page = 1) {
        if (!Number.isSafeInteger(id) || !Number.isInteger(page) || page < 1 || page > 100000)
            throw new RangeError('batch');
        const batch = this.db.prepare('SELECT * FROM traffic_classification_batches WHERE id=?').get(id);
        if (!batch) throw new RangeError('batch');
        const total = this.db.prepare('SELECT COUNT(*) AS n FROM traffic_classification_batch_rows WHERE batch=?')
            .get(id).n;
        const rows = this.db.prepare(`SELECT r.session, r.previousBroadcaster, r.previousPurpose,
            s.platform, s.started, s.actualStarted, s.broadcaster AS currentBroadcaster, s.purpose AS currentPurpose
            FROM traffic_classification_batch_rows r
            LEFT JOIN sessions s ON s.id=r.session
            WHERE r.batch=? ORDER BY r.session LIMIT 50 OFFSET ?`).all(id, (page - 1) * 50);
        return { batch, rows, total, page };
    }

    /**
     * 復原最近一次批次補分類；只還原該批次實際改過的欄位。
     * @param {number} id 批次 id。
     * @returns {Object} 實際復原的場次數。
     */
    undoBackfill(id) {
        if (!Number.isSafeInteger(id)) throw new RangeError('batch');
        const latest = this.db.prepare('SELECT * FROM traffic_classification_batches WHERE undoneAt IS NULL ORDER BY id DESC LIMIT 1').get();
        if (!latest || latest.id !== id) throw new RangeError('batch');
        const set = [];
        if (latest.setBroadcaster) set.push('broadcaster=?');
        if (latest.setPurpose) set.push('purpose=?');
        if (!set.length) throw new RangeError('batch');
        const update = this.db.prepare(`UPDATE sessions SET ${set.join(',')} WHERE id=?`);
        const rows = this.db.prepare('SELECT * FROM traffic_classification_batch_rows WHERE batch=?').all(id);
        this.db.exec('BEGIN IMMEDIATE');
        let restored = 0;
        try {
            for (const row of rows) {
                const values = [];
                if (latest.setBroadcaster) values.push(row.previousBroadcaster);
                if (latest.setPurpose) values.push(row.previousPurpose);
                restored += update.run(...values, row.session).changes;
            }
            this.db.prepare('UPDATE traffic_classification_batches SET undoneAt=? WHERE id=?').run(this.now(), id);
            this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
        return { saved: true, restored };
    }

    /** @returns {Object[]} 含有效用途的帳號清單，來源不明保留於場次清單。 */
    profiles() {
        return this.db.prepare(`SELECT s.platform,s.broadcaster,COALESCE(p.purpose,'unknown') AS purpose,COUNT(*) AS sessions
            FROM sessions s LEFT JOIN traffic_profiles p ON p.platform=s.platform AND p.broadcaster=s.broadcaster
            WHERE s.broadcaster IS NOT NULL GROUP BY s.platform,s.broadcaster
            UNION SELECT p.platform,p.broadcaster,p.purpose,0 FROM traffic_profiles p
            WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.platform=p.platform AND s.broadcaster=p.broadcaster)
            ORDER BY platform,broadcaster`).all();
    }

    /**
     * 場次分頁與狀態統計；預設只回待分類，避免已分類資料淹沒需要處理的場次。
     * @param {string} platform 平台，空字串表示全部。
     * @param {number} page 頁碼。
     * @param {string} status unclassified／own／reference／test／all。
     * @returns {Object} 場次分頁與各狀態筆數。
     */
    sessions(platform = '', page = 1, status = 'unclassified') {
        if (typeof platform !== 'string' || !Number.isInteger(page) || page < 1 || page > 100000 ||
            !STATUSES.includes(status)) throw new RangeError('page');
        const effective = "COALESCE(s.purpose,p.purpose,'unknown')";
        const base = `FROM sessions s LEFT JOIN traffic_profiles p ON p.platform=s.platform AND p.broadcaster=s.broadcaster
            WHERE (?='' OR s.platform=?)`;
        const filter = status === 'all' ? ''
            : status === 'unclassified' ? ` AND ${effective}='unknown'` : ` AND ${effective}=?`;
        const args = [platform, platform];
        if (status !== 'all' && status !== 'unclassified') args.push(status);
        const total = this.db.prepare(`SELECT COUNT(*) AS n ${base}${filter}`).get(...args).n;
        const rows = this.db.prepare(`SELECT s.id,s.platform,s.broadcaster,s.purpose,s.started,s.actualStarted,s.ended,
            s.sampleCount,s.spanMs,s.area,s.lastViewers,s.peak,s.chats,s.joins,
            ${effective} AS effectivePurpose,
            CASE WHEN s.spanMs>0 THEN s.area/s.spanMs ELSE s.lastViewers END AS averageViewers
            ${base}${filter}
            ORDER BY s.started DESC,s.id DESC LIMIT 50 OFFSET ?`).all(...args, (page - 1) * 50);
        const counts = this.db.prepare(`SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN ${effective}='unknown' THEN 1 ELSE 0 END),0) AS unclassified,
            COALESCE(SUM(CASE WHEN ${effective}='own' THEN 1 ELSE 0 END),0) AS own,
            COALESCE(SUM(CASE WHEN ${effective}='reference' THEN 1 ELSE 0 END),0) AS reference,
            COALESCE(SUM(CASE WHEN ${effective}='test' THEN 1 ELSE 0 END),0) AS test
            ${base}`).get(platform, platform);
        return {
            rows, total, page, status,
            counts: { all: counts.total, unclassified: counts.unclassified, own: counts.own, reference: counts.reference, test: counts.test }
        };
    }

    /** @param {Object} settings 提醒設定。 @returns {Object[]} 自己與參考主播各自的歷史，絕不合併觀看人數。 */
    analyses(settings = this.settings()) {
        const sources = this.db.prepare(`SELECT DISTINCT s.platform,s.broadcaster,COALESCE(s.purpose,p.purpose,'unknown') AS purpose
            FROM sessions s LEFT JOIN traffic_profiles p ON p.platform=s.platform AND p.broadcaster=s.broadcaster
            WHERE s.broadcaster IS NOT NULL`).all();
        return sources.filter(profile => ['own', 'reference'].includes(profile.purpose)).map(profile => ({
            ...profile,
            rankings: this.database.rankings(profile.platform, settings.historyDays, this.now(), settings.timezone, profile)
        }));
    }

    /**
     * 將各帳號每週最佳時段排入未來 14 天。每個日期最多一次；夏令時間重複整點只取一次。
     * @returns {Object[]} 歷史分析明細。
     */
    reconcile() {
        const settings = this.settings();
        const analyses = this.analyses(settings);
        const now = this.now();
        this.db.prepare("UPDATE traffic_reminders SET status='expired' WHERE status='planned' AND startAt-?<?")
            .run(HALF_HOUR, now - 5 * 60000);
        if (!settings.enabled) return analyses;

        const moments = [];
        // 掃描 UTC 分鐘可涵蓋 30／45 分鐘時區，不以主機 local time 做日期運算。
        for (let time = Math.floor((now - 7 * DAY) / (15 * 60000)) * 15 * 60000; time < now + 14 * DAY; time += 15 * 60000) {
            const part = calendar(time, settings.timezone);
            if (!part.minute && settings.weekdays.includes(part.day) && settings.hours.includes(part.hour)) moments.push({ time, ...part });
        }
        const selected = new Set();
        for (const analysis of analyses) {
            if (analysis.purpose !== 'own' || analysis.platform.toLowerCase() === 'unknown') continue;
            const qualified = analysis.rankings.cells.filter(cell => !cell.insufficient);
            if (qualified.length < 2) continue;
            const cells = new Map(qualified.map(cell => [cell.key, cell]));
            const weeks = new Map();
            for (const moment of moments) {
                if (!cells.has(moment.key)) continue;
                if (!weeks.has(moment.week)) weeks.set(moment.week, []);
                weeks.get(moment.week).push({ ...moment, cell: cells.get(moment.key) });
            }
            for (const [week, options] of weeks) {
                const dates = new Set();
                const existing = this.db.prepare(`SELECT * FROM traffic_reminders WHERE platform=? AND broadcaster=? AND week=?
                    AND status NOT IN ('planned','cancelled','expired')`).all(analysis.platform, analysis.broadcaster, week);
                for (const entry of existing) dates.add(calendar(entry.startAt, settings.timezone).date);
                let count = dates.size;
                options.sort((a, b) => b.cell.shrunk - a.cell.shrunk || a.time - b.time);
                for (const option of options) {
                    if (count >= settings.maxPerWeek) break;
                    if (dates.has(option.date)) continue;
                    // 將整週一起選完才去除已錯過時間，不因晚開程式而改推薦較差時段。
                    dates.add(option.date);
                    count++;
                    if (option.time - HALF_HOUR < now - 5 * 60000) continue;
                    const key = JSON.stringify([analysis.platform, analysis.broadcaster, option.time]);
                    selected.add(key);
                    const evidence = JSON.stringify(option.cell);
                    this.db.prepare(`INSERT INTO traffic_reminders(platform,broadcaster,startAt,week,slot,evidence)
                        VALUES(?,?,?,?,?,?) ON CONFLICT(platform,broadcaster,startAt) DO UPDATE SET
                        evidence=excluded.evidence,status=CASE WHEN status='cancelled' THEN 'planned' ELSE status END`)
                        .run(analysis.platform, analysis.broadcaster, option.time, week, option.key, evidence);
                }
            }
        }
        for (const job of this.db.prepare("SELECT * FROM traffic_reminders WHERE status='planned'").all()) {
            if (!selected.has(JSON.stringify([job.platform, job.broadcaster, job.startAt]))) {
                this.db.prepare("UPDATE traffic_reminders SET status='cancelled' WHERE id=?").run(job.id);
            }
        }
        return analyses;
    }

    /** @param {number} startAt 指定時間的全部平台提醒。 @returns {void} */
    skip(startAt) {
        if (!Number.isSafeInteger(startAt)) throw new RangeError('startAt');
        this.db.prepare("UPDATE traffic_reminders SET status='skipped' WHERE startAt=? AND status='planned'").run(startAt);
    }

    /** 每分鐘執行；先持久登記發送意圖，重啟遇到不確定結果不自動重送。 @returns {Promise<void>} */
    async tick() {
        if (this.busy) return;
        this.busy = true;
        try {
            this.reconcile();
            const settings = this.settings();
            if (!settings.enabled) return;
            const now = this.now();
            const due = this.db.prepare("SELECT * FROM traffic_reminders WHERE status='planned' AND startAt-?<=? ORDER BY startAt")
                .all(HALF_HOUR, now);
            for (const startAt of new Set(due.map(job => job.startAt))) {
                const jobs = due.filter(job => {
                    if (job.startAt !== startAt) return false;
                    // 只以同一主播的新鮮觀看取樣判斷在線；不能以舊的 ended=NULL 當成仍在直播。
                    const live = this.db.prepare(`SELECT 1 FROM sessions WHERE platform=? AND broadcaster=?
                        AND ended IS NULL AND sampleCount>0 AND actualStarted IS NOT NULL AND actualStarted<=?
                        AND lastSampleAt>=? AND lastSampleAt<=? LIMIT 1`)
                        .get(job.platform, job.broadcaster, now, now - 90000, now + 10000);
                    if (live) this.db.prepare("UPDATE traffic_reminders SET status='alreadyLive' WHERE id=?").run(job.id);
                    return !live;
                });
                if (!jobs.length) continue;
                for (const job of jobs) this.db.prepare("UPDATE traffic_reminders SET status='dispatching' WHERE id=?").run(job.id);
                const date = new Intl.DateTimeFormat('zh-TW', { timeZone: settings.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(startAt);
                const body = `建議於 ${date}（${settings.timezone}）開播\n` + jobs.map(job => {
                    const cell = JSON.parse(job.evidence);
                    return `${job.platform} / ${job.broadcaster}：${cell.n} 場、${cell.observedDays} 個日期，開場平均 ${cell.mean.toFixed(1)} 人`;
                }).join('\n') + '\n依自己的歷史開場觀測提供參考，不代表因果；詳情請查看人流分析頁。';
                for (const channel of settings.channels) {
                    const current = this.settings();
                    if (!current.enabled || !current.channels.includes(channel)) continue;
                    const claim = this.db.prepare('INSERT OR IGNORE INTO traffic_deliveries VALUES(?,?,?,?)')
                        .run(startAt, channel, 'sending', now);
                    if (!claim.changes) continue;
                    let success = false;
                    try { success = await this.send(channel, '開播提醒 · 約 30 分鐘後', body); } catch { /* 結果只記狀態，不記含憑證的例外。 */ }
                    this.db.prepare('UPDATE traffic_deliveries SET status=?,updatedAt=? WHERE startAt=? AND channel=?')
                        .run(success ? 'sent' : 'failed', this.now(), startAt, channel);
                }
                for (const job of jobs) this.db.prepare("UPDATE traffic_reminders SET status='processed' WHERE id=?").run(job.id);
            }
        } finally { this.busy = false; }
    }

    /** @returns {Object} 管理頁快照，不傳回推播網址或密鑰。 */
    snapshot() {
        const analyses = this.reconcile();
        const detected = new Map(this.db.prepare('SELECT platform,broadcaster FROM traffic_identities').all()
            .map(row => [row.platform, row.broadcaster]));
        const identity = (platform, ...keys) => detected.get(platform) ||
            normalizeBroadcaster(keys.map(key => process.env[key]).find(Boolean));
        const statusCounts = this.db.prepare(`SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN COALESCE(s.purpose,p.purpose,'unknown')='own' THEN 1 ELSE 0 END),0) AS own,
            COALESCE(SUM(CASE WHEN COALESCE(s.purpose,p.purpose,'unknown')='reference' THEN 1 ELSE 0 END),0) AS reference,
            COALESCE(SUM(CASE WHEN COALESCE(s.purpose,p.purpose,'unknown')='test' THEN 1 ELSE 0 END),0) AS test,
            COALESCE(SUM(CASE WHEN COALESCE(s.purpose,p.purpose,'unknown')='unknown' THEN 1 ELSE 0 END),0) AS unclassified
            FROM sessions s LEFT JOIN traffic_profiles p ON p.platform=s.platform AND p.broadcaster=s.broadcaster`).get();
        return {
            settings: this.settings(), available: this.available(), profiles: this.profiles(), analyses,
            unclassified: statusCounts.unclassified,
            statusCounts: {
                all: statusCounts.total, own: statusCounts.own, reference: statusCounts.reference,
                test: statusCounts.test, unclassified: statusCounts.unclassified
            },
            platforms: this.db.prepare('SELECT DISTINCT platform FROM sessions ORDER BY platform').all().map(row => row.platform),
            identities: {
                TikTok: identity('TikTok', 'TIKTOK_NAME'),
                Twitch: identity('Twitch', 'TWITCH_USER_ID', 'TWITCH_USER_NAME'),
                Kick: identity('Kick', 'KICK_USER_NAME'),
                Odysee: identity('Odysee', 'ODYSEE_CHANNEL_NAME'),
                Youtube: identity('Youtube', 'YOUTUBE_CHANNEL_ID')
            },
            broadcasters: this.db.prepare(`SELECT DISTINCT platform,broadcaster FROM sessions
                WHERE broadcaster IS NOT NULL ORDER BY platform,broadcaster`).all(),
            lastBatch: this.db.prepare(`SELECT * FROM traffic_classification_batches
                WHERE undoneAt IS NULL ORDER BY id DESC LIMIT 1`).get() || null,
            jobs: this.db.prepare("SELECT * FROM traffic_reminders WHERE status!='cancelled' AND startAt>=? ORDER BY startAt LIMIT 100")
                .all(this.now() - 7 * DAY).map(job => ({ ...job, evidence: JSON.parse(job.evidence) })),
            deliveries: this.db.prepare('SELECT * FROM traffic_deliveries ORDER BY startAt DESC LIMIT 50').all()
        };
    }
}

module.exports = { TrafficPlanner, validateSettings, calendar };
