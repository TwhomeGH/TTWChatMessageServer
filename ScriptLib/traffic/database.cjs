const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

// 觀看取樣中斷超過這個間隔就視為新的觀測場次。平台有穩定 stream ID 時靠 ID 切，
// 沒有時才靠這個間隔推斷，所以取一個能容忍單次輪詢失敗的值。
const SESSION_GAP_MS = 120000;

// 「開場表現」只看場次開始後這段時間，避免長場次與當天內容差異混淆時段本身的效果。
const EARLY_WINDOW_MS = 30 * 60000;

// 太短或樣本太少的場次不納入排名，避免單點雜訊。
const MIN_SESSION_SPAN_MS = 60000;
const MIN_SESSION_SAMPLES = 2;

// 收縮估計的平滑常數：把樣本少的時段往整體平均拉，避免「只開過一次剛好爆紅」奪冠。
const SHRINK_K = 3;

// 一個時段至少要有這麼多場次才給排名，否則只標記資料不足。
const MIN_BUCKET_SESSIONS = 3;

// 場次累積的互動成效（來自中控台「直播指標」），累計值只取最大。
const SESSION_METRIC_COLUMNS = ['diamonds', 'gifters', 'newFollowers', 'likes', 'uniqueViewers'];

/**
 * 人流資料的持久層。
 *
 * 三種資料並存：
 * - events：原始事件（含觀看取樣），保留證據與去重。
 * - minutes：每分鐘的進房／聊天／觀看彙總，供長期分布查詢。
 * - sessions：由觀看取樣推斷的「觀測場次」，供時段排名使用。
 *
 * 每筆事件、分鐘彙總與場次更新都在同一個交易內提交，失敗整筆回滾。
 */
class TrafficDatabase {
    constructor(filename) {
        if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
        this.db = new DatabaseSync(filename);
        this.db.exec(`
            PRAGMA journal_mode=WAL;
            PRAGMA busy_timeout=3000;

            CREATE TABLE IF NOT EXISTS events (
                n INTEGER PRIMARY KEY,
                time INTEGER NOT NULL,
                platform TEXT NOT NULL,
                kind TEXT NOT NULL,
                dedup TEXT,
                expires INTEGER,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS events_time ON events(platform,time);
            CREATE INDEX IF NOT EXISTS events_recent ON events(time);
            CREATE INDEX IF NOT EXISTS events_dedup ON events(dedup,expires);

            CREATE TABLE IF NOT EXISTS minutes (
                platform TEXT,
                time INTEGER,
                joins INTEGER DEFAULT 0,
                chats INTEGER DEFAULT 0,
                viewerSum REAL DEFAULT 0,
                viewerCount INTEGER DEFAULT 0,
                PRIMARY KEY(platform,time)
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY,
                platform TEXT NOT NULL,
                stream TEXT,
                started INTEGER NOT NULL,
                ended INTEGER,
                lastSampleAt INTEGER NOT NULL,
                lastViewers REAL,
                peak REAL,
                area REAL DEFAULT 0,
                spanMs INTEGER DEFAULT 0,
                earlyArea REAL DEFAULT 0,
                earlySpanMs INTEGER DEFAULT 0,
                sampleCount INTEGER DEFAULT 0,
                joins INTEGER DEFAULT 0,
                chats INTEGER DEFAULT 0,
                closedBy TEXT,
                diamonds REAL DEFAULT 0,
                gifters REAL DEFAULT 0,
                newFollowers REAL DEFAULT 0,
                likes REAL DEFAULT 0,
                uniqueViewers REAL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS sessions_platform ON sessions(platform,started);
            CREATE INDEX IF NOT EXISTS sessions_open ON sessions(platform,ended);

            CREATE TABLE IF NOT EXISTS heartbeats (time INTEGER PRIMARY KEY);
        `);

        // 舊資料庫補上成效欄位（SQLite 的 ADD COLUMN 沒有 IF NOT EXISTS）。
        const columns = new Set(this.db.prepare('PRAGMA table_info(sessions)').all().map(column => column.name));
        for (const column of SESSION_METRIC_COLUMNS) {
            if (!columns.has(column)) this.db.exec(`ALTER TABLE sessions ADD COLUMN ${column} REAL DEFAULT 0`);
        }
    }

    /**
     * 寫入一筆事件、其分鐘彙總，並在同一個交易內更新觀測場次。
     * @param {object} event 正規化後的事件
     * @param {string|null} key 去重鍵
     * @param {number} expires 去重鍵的到期時間
     * @returns {boolean} 是否實際寫入（重複事件回傳 false）
     */
    append(event, key, expires) {
        const db = this.db;
        db.exec('BEGIN IMMEDIATE');
        try {
            if (key && db.prepare('SELECT 1 FROM events WHERE dedup=? AND expires>=? LIMIT 1').get(key, event.receivedAt)) {
                db.exec('ROLLBACK');
                return false;
            }

            db.prepare('INSERT INTO events(time,platform,kind,dedup,expires,payload) VALUES(?,?,?,?,?,?)')
                .run(event.time, event.platform, event.kind, key, expires, JSON.stringify(event));

            db.prepare(`INSERT INTO minutes(platform,time,joins,chats,viewerSum,viewerCount) VALUES(?,?,?,?,?,?)
                ON CONFLICT(platform,time) DO UPDATE SET
                    joins=joins+excluded.joins,
                    chats=chats+excluded.chats,
                    viewerSum=viewerSum+excluded.viewerSum,
                    viewerCount=viewerCount+excluded.viewerCount`)
                .run(
                    event.platform,
                    Math.floor(event.time / 60000) * 60000,
                    event.kind === 'join' ? 1 : 0,
                    event.kind === 'chat' ? 1 : 0,
                    event.viewers ?? 0,
                    event.kind === 'viewers' ? 1 : 0
                );

            this.updateSession(event);
            db.exec('COMMIT');
            return true;
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }

    /**
     * 依事件種類維護觀測場次：
     * - viewers：續接目前場次（累積觀看統計），或收尾後開新場次。
     * - metrics：續接目前場次（更新成效），或收尾後開新場次（沒有觀看樣本也能開）。
     * - join／chat：累加到該平台目前開啟的場次。
     */
    updateSession(event) {
        if (event.kind === 'viewers' || event.kind === 'metrics') {
            this.extendOrOpenSession(event);
            return;
        }
        if (event.kind === 'join' || event.kind === 'chat') {
            const open = this.openSession(event.platform);
            if (!open) return;
            const column = event.kind === 'join' ? 'joins' : 'chats';
            this.db.prepare(`UPDATE sessions SET ${column}=${column}+1 WHERE id=?`).run(open.id);
        }
    }

    /** 取得某平台目前仍在進行（尚未收尾）的場次。 */
    openSession(platform) {
        return this.db.prepare('SELECT * FROM sessions WHERE platform=? AND ended IS NULL ORDER BY id DESC LIMIT 1')
            .get(platform);
    }

    /**
     * 新的觀看取樣是否延續目前場次：
     * - 兩邊都有串流 ID 且相同 → 一定是同一場，即使中間程式離線也不切。
     * - 兩邊 ID 不同 → 換場，切。
     * - 任一方缺 ID → 只能靠間隔，超過 SESSION_GAP_MS 就切。
     */
    isContinuous(open, event) {
        if (open.stream && event.stream) return open.stream === event.stream;
        return event.time - open.lastSampleAt <= SESSION_GAP_MS;
    }

    extendOrOpenSession(event) {
        const open = this.openSession(event.platform);
        if (open && this.isContinuous(open, event)) {
            if (event.kind === 'metrics') this.applySessionMetrics(open.id, event);
            else this.extendSession(open, event);
            return;
        }
        if (open) this.closeSession(open, event.time);

        // metrics 事件沒有觀看數，sampleCount 記 0，排名時自然會被樣本門檻濾掉。
        const viewers = event.kind === 'viewers' ? event.viewers : null;
        const samples = event.kind === 'viewers' ? 1 : 0;
        const result = this.db.prepare(`INSERT INTO sessions(
                platform,stream,started,ended,lastSampleAt,lastViewers,peak,
                area,spanMs,earlyArea,earlySpanMs,sampleCount,joins,chats)
            VALUES(?,?,?,NULL,?,?,?,0,0,0,0,?,0,0)`)
            .run(event.platform, event.stream ?? null, event.time,
                event.time, viewers, viewers, samples);
        if (event.kind === 'metrics') this.applySessionMetrics(result.lastInsertRowid, event);
    }

    /** 以累計值更新場次成效；同一場次只前進不退（避免重送或延遲造成倒退）。 */
    applySessionMetrics(sessionId, event) {
        this.db.prepare(`UPDATE sessions SET
                lastSampleAt=?,
                diamonds=MAX(diamonds, ?),
                gifters=MAX(gifters, ?),
                newFollowers=MAX(newFollowers, ?),
                likes=MAX(likes, ?),
                uniqueViewers=MAX(uniqueViewers, ?)
            WHERE id=?`)
            .run(event.time, event.diamonds ?? 0, event.gifters ?? 0,
                event.newFollowers ?? 0, event.likes ?? 0, event.uniqueViewers ?? 0, sessionId);
    }

    /**
     * 續接場次。只有「觀測連續」（間隔在 SESSION_GAP_MS 內）的區段才納入時間加權，
     * 所以即使同一場次中間程式離線，未觀測的空檔也不會被線性內插進平均觀看。
     */
    extendSession(open, event) {
        const gap = event.time - open.lastSampleAt;
        const observed = gap > 0 && gap <= SESSION_GAP_MS;
        const viewers = event.viewers;

        const area = open.area + (observed ? ((open.lastViewers + viewers) / 2) * gap : 0);
        const spanMs = open.spanMs + (observed ? gap : 0);
        const early = observed
            ? this.extendEarlyWindow(open, event, gap)
            : { earlyArea: open.earlyArea, earlySpanMs: open.earlySpanMs };

        this.db.prepare(`UPDATE sessions SET
                ended=NULL,
                lastSampleAt=?,
                lastViewers=?,
                peak=?,
                area=?,
                spanMs=?,
                earlyArea=?,
                earlySpanMs=?,
                sampleCount=sampleCount+1
            WHERE id=?`)
            .run(event.time, viewers, Math.max(open.peak ?? viewers, viewers),
                area, spanMs, early.earlyArea, early.earlySpanMs, open.id);
    }

    /**
     * 累積「開場窗口」（場次開始後 EARLY_WINDOW_MS）內的時間加權觀看。
     * 若這一筆取樣跨越了窗口邊界，只計到邊界為止，並用線性內插求邊界上的觀看數。
     */
    extendEarlyWindow(open, event, dt) {
        let earlyArea = open.earlyArea;
        let earlySpanMs = open.earlySpanMs;
        const earlyEnd = open.started + EARLY_WINDOW_MS;

        if (dt > 0 && open.lastSampleAt < earlyEnd) {
            const segmentEnd = Math.min(event.time, earlyEnd);
            const segmentMs = segmentEnd - open.lastSampleAt;
            const endViewers = open.lastViewers + (event.viewers - open.lastViewers) * segmentMs / dt;
            earlyArea += ((open.lastViewers + endViewers) / 2) * segmentMs;
            earlySpanMs += segmentMs;
        }

        return { earlyArea, earlySpanMs };
    }

    /**
     * 收尾一個場次，並記錄中斷原因：
     * 中斷期間有心跳代表程式仍在觀察（斷流或輪詢失敗），沒有則代表程式離線（語意未知）。
     */
    closeSession(open, nextTime) {
        const closedBy = this.hasHeartbeat(open.lastSampleAt, nextTime) ? 'gap' : 'offline';
        this.db.prepare('UPDATE sessions SET ended=?, closedBy=? WHERE id=?')
            .run(open.lastSampleAt, closedBy, open.id);
    }

    /** 記錄程式此刻仍在觀察（每分鐘一列），用來分辨中斷是斷流還是程式離線。 */
    heartbeat(time) {
        this.db.prepare('INSERT OR IGNORE INTO heartbeats(time) VALUES(?)')
            .run(Math.floor(time / 60000) * 60000);
    }

    /** 指定的時間區間內是否曾有心跳。 */
    hasHeartbeat(from, to) {
        return !!this.db.prepare('SELECT 1 FROM heartbeats WHERE time>? AND time<? LIMIT 1').get(from, to);
    }

    /** 曾出現過的任何平台。 */
    platforms() {
        return this.db.prepare('SELECT DISTINCT platform FROM minutes ORDER BY platform').all().map(row => row.platform);
    }

    /** 該平台最早的一分鐘彙總時間（「全部」範圍的起點）；沒有資料回傳 null。 */
    earliest(platform) {
        const row = this.db.prepare('SELECT MIN(time) AS time FROM minutes WHERE platform=?').get(platform || '');
        return row?.time ?? null;
    }

    /**
     * 圖表序列：從 minutes（每分鐘彙總）取範圍資料，依 bucketMs 分桶。
     * 觀看數取桶內「有取樣分鐘」的平均；沒有取樣為 null，折線才會斷開而不是被補成 0。
     */
    series(platform, since, bucketMs, now) {
        const rows = this.db.prepare(`SELECT time, joins, chats, viewerSum, viewerCount
            FROM minutes WHERE platform=? AND time>=? AND time<=? ORDER BY time`)
            .all(platform || '', since, now);

        const totals = new Map();
        for (const row of rows) {
            const time = Math.floor(row.time / bucketMs) * bucketMs;
            if (!totals.has(time)) totals.set(time, { joins: 0, chats: 0, viewerSum: 0, viewerCount: 0 });
            const bucket = totals.get(time);
            bucket.joins += row.joins ?? 0;
            bucket.chats += row.chats ?? 0;
            bucket.viewerSum += row.viewerSum ?? 0;
            bucket.viewerCount += row.viewerCount ?? 0;
        }

        const series = [];
        for (let time = Math.floor(since / bucketMs) * bucketMs; time <= now; time += bucketMs) {
            const bucket = totals.get(time);
            series.push({
                time,
                joins: bucket?.joins ?? 0,
                chats: bucket?.chats ?? 0,
                viewers: bucket?.viewerCount ? Math.round(bucket.viewerSum / bucket.viewerCount) : null
            });
        }
        return series;
    }

    /** 最近的事件（原始證據），供即時視窗使用。 */
    recent(since) {
        return this.db.prepare('SELECT payload FROM events WHERE time>=? ORDER BY time DESC LIMIT 20000')
            .all(since).reverse().map(row => JSON.parse(row.payload));
    }

    /**
     * 週／月分布：長線查分鐘彙總而非載入所有事件。
     * 平均觀看先算每分鐘平均，再對「有取樣的分鐘」平均，避免頻繁回報放大權重；
     * 沒有觀看取樣的分鐘不算有效觀測，缺資料保持 null，不視為 0。
     */
    distribution(platform, days, now, timezone) {
        const platforms = this.platforms();
        platform = platforms.includes(platform) ? platform : platforms[0];
        const rows = this.db.prepare('SELECT * FROM minutes WHERE platform=? AND time>=? AND time<? ORDER BY time')
            .all(platform || '', now - days * 86400000, Math.floor(now / 60000) * 60000);

        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone, weekday: 'short', hour: '2-digit', hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit'
        });

        const cells = new Map();
        const daily = new Map();
        let previous = null;
        let segments = 0;

        for (const row of rows) {
            const parts = Object.fromEntries(formatter.formatToParts(row.time).map(part => [part.type, part.value]));
            const date = parts.year + '-' + parts.month + '-' + parts.day;
            const key = parts.weekday + ' ' + parts.hour;

            for (const [map, bucketKey] of [[cells, key], [daily, date]]) {
                if (!map.has(bucketKey)) {
                    map.set(bucketKey, { key: bucketKey, joins: 0, chats: 0, observedMinutes: 0, viewerSum: 0, dates: new Set() });
                }
                const item = map.get(bucketKey);
                item.joins += row.joins;
                item.chats += row.chats;
                if (row.viewerCount) {
                    item.observedMinutes++;
                    item.viewerSum += row.viewerSum / row.viewerCount;
                    item.dates.add(date);
                }
            }

            if (row.viewerCount) {
                if (previous === null || row.time - previous > 90000) segments++;
                previous = row.time;
            }
        }

        const finish = map => [...map.values()].map(({ viewerSum, dates, ...item }) => ({
            ...item,
            averageViewers: item.observedMinutes ? viewerSum / item.observedMinutes : null,
            observedDays: dates.size
        }));

        return {
            platform, platforms, days, timezone,
            cells: finish(cells), daily: finish(daily),
            observedSegments: segments, retention: 'persistent'
        };
    }

    /**
     * 依場次「開始時間」分桶的歷史時段排名。
     *
     * 以「場次」而非「分鐘」為單位，避免長場次主宰排名；每桶取開場平均觀看，
     * 計算中位數、平均、標準差與收縮估計（往整體平均拉），樣本不足者標記 insufficient。
     */
    rankings(platform, days, now, timezone) {
        const platforms = this.platforms();
        platform = platforms.includes(platform) ? platform : platforms[0];

        const rows = this.db.prepare(`SELECT * FROM sessions
            WHERE platform=? AND started>=? AND sampleCount>=? AND spanMs>=?
            ORDER BY started`)
            .all(platform || '', now - days * 86400000, MIN_SESSION_SAMPLES, MIN_SESSION_SPAN_MS);

        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone, weekday: 'short', hour: '2-digit', hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit'
        });

        const buckets = new Map();
        const allValues = [];

        for (const session of rows) {
            const early = session.earlySpanMs > 0 ? session.earlyArea / session.earlySpanMs : null;
            if (early === null) continue;

            const parts = Object.fromEntries(formatter.formatToParts(session.started).map(part => [part.type, part.value]));
            const key = parts.weekday + ' ' + parts.hour;
            const date = parts.year + '-' + parts.month + '-' + parts.day;

            if (!buckets.has(key)) buckets.set(key, { key, values: [], dates: new Set() });
            const bucket = buckets.get(key);
            bucket.values.push(early);
            bucket.dates.add(date);
            allValues.push(early);
        }

        const globalMean = allValues.length ? allValues.reduce((sum, v) => sum + v, 0) / allValues.length : 0;

        const cells = [...buckets.values()].map(bucket => {
            const values = bucket.values;
            const n = values.length;
            const mean = values.reduce((sum, v) => sum + v, 0) / n;

            const sorted = [...values].sort((a, b) => a - b);
            const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

            const variance = n > 1 ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) : 0;
            const sd = Math.sqrt(variance);
            const shrunk = (n * mean + SHRINK_K * globalMean) / (n + SHRINK_K);

            return {
                key: bucket.key,
                n,
                mean,
                median,
                sd,
                shrunk,
                ci95: n > 1 ? 1.96 * sd / Math.sqrt(n) : null,
                observedDays: bucket.dates.size,
                insufficient: n < MIN_BUCKET_SESSIONS
            };
        });

        cells.sort((a, b) => b.shrunk - a.shrunk);

        return {
            platform, platforms, days, timezone,
            earlyMinutes: EARLY_WINDOW_MS / 60000,
            sessionCount: rows.length, globalMean,
            minSessions: MIN_BUCKET_SESSIONS, cells
        };
    }

    /**
     * 每日成效：以場次「開始日」歸屬。
     * 互動指標（鑽石、送禮者、新粉絲、獲讚）跨場次相加；累計觸及人數取最大值，
     * 因為同一批觀眾可能橫跨多場，相加會重複計算。
     */
    metrics(platform, days, now, timezone) {
        const platforms = this.platforms();
        platform = platforms.includes(platform) ? platform : platforms[0];
        const rows = this.db.prepare(`SELECT started, diamonds, gifters, newFollowers, likes, uniqueViewers
            FROM sessions WHERE platform=? AND started>=? ORDER BY started`)
            .all(platform || '', now - days * 86400000);

        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const daily = new Map();
        for (const row of rows) {
            const parts = Object.fromEntries(formatter.formatToParts(row.started).map(part => [part.type, part.value]));
            const date = parts.year + '-' + parts.month + '-' + parts.day;
            if (!daily.has(date)) {
                daily.set(date, { key: date, diamonds: 0, gifters: 0, newFollowers: 0, likes: 0, uniqueViewers: 0 });
            }
            const item = daily.get(date);
            item.diamonds += row.diamonds ?? 0;
            item.gifters += row.gifters ?? 0;
            item.newFollowers += row.newFollowers ?? 0;
            item.likes += row.likes ?? 0;
            item.uniqueViewers = Math.max(item.uniqueViewers, row.uniqueViewers ?? 0);
        }

        return { platform, platforms, days, timezone, daily: [...daily.values()] };
    }

    close() {
        this.db.close();
    }
}

module.exports = { TrafficDatabase, SESSION_GAP_MS, EARLY_WINDOW_MS };
