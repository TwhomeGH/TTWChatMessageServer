// 原生觀看樣本在線時，備用（userscript）樣本在這段時間內不計入，避免兩條來源互相污染。
// 超過這個時間沒有原生樣本，就讓備用接手。
const NATIVE_PRIORITY_MS = 90000;

// 中控台「直播指標」的累計成效欄位。
const METRIC_FIELDS = ['diamonds', 'gifters', 'newFollowers', 'likes', 'uniqueViewers'];

/**
 * 人流即時狀態與寫入入口。
 *
 * 即時視窗只快取最近 24 小時；持久資料庫獨立保留所有事件、分鐘統計與觀測場次。
 * 觀看取樣會一併帶上平台串流 ID，讓場次識別在平台有 ID 時跨重啟仍可靠。
 */
class TrafficStore {
    constructor(now = Date.now, database = null) {
        this.now = now;
        this.startedAt = now();
        this.database = database;
        this.events = database ? database.recent(now() - 86400000) : [];
        this.seen = new Map();
        // 各平台最後一次原生觀看樣本的時間，用來決定備用樣本是否可以接手。
        this.lastNativeViewersAt = new Map();
        for (const event of this.events) {
            if (event.kind === 'viewers' && event.evidence === 'native') {
                const previous = this.lastNativeViewersAt.get(event.platform) ?? 0;
                if (event.receivedAt > previous) this.lastNativeViewersAt.set(event.platform, event.receivedAt);
            }
        }
    }

    /** 記錄程式此刻仍在觀察，供資料庫分辨場次中斷是「斷流」還是「程式離線」。 */
    heartbeat() {
        if (this.database) this.database.heartbeat(this.now());
    }

    /**
     * 正規化並寫入一筆事件。
     *
     * 只接受明確的 join／chat／audience；測試資料、重複事件、時間不合理、
     * 觀看數無效都回傳 false，呼叫端不需要再自行過濾。
     *
     * @param {object} raw 來自 IPC 或 /chat 的原始事件
     * @returns {boolean} 是否接受並寫入
     */
    record(raw) {
        if (!raw || raw.isTest === true) return false;

        const receivedAt = this.now();
        const sentAt = this.sentAtOf(raw);
        const time = Number.isFinite(sentAt) && sentAt > 0 ? sentAt : receivedAt;
        // 平台時間可能缺漏或錯誤：太舊（超過 2 分鐘）或超前（超過 10 秒）都排除。
        if (time < receivedAt - 120000 || time > receivedAt + 10000) return false;

        const kind = this.kindOf(raw);
        if (!kind) return false;

        const platform = typeof raw.platform === 'string' ? raw.platform.slice(0, 40) : 'Unknown';
        const transport = typeof raw.transport === 'string' ? raw.transport.slice(0, 40) : 'unknown';
        const user = String(raw.userId || raw.user || '').slice(0, 100);
        const stream = this.streamOf(raw);

        const id = raw.msgId || raw.id;
        this.expireSeen(receivedAt);

        // 有事件 ID 用 ID 去重（保留 24 小時）；沒 ID 的 join／chat 用
        // 「同平台、同類型、同人、同文字」10 秒去重；觀看取樣不去重。
        const key = id
            ? platform + ':' + kind + ':' + id
            : kind !== 'viewers' && user
                ? platform + ':' + kind + ':' + user + ':' + String(raw.message || '')
                : null;
        if (key && this.seen.has(key)) return false;

        if (kind === 'viewers' && (typeof raw.userNum !== 'number' || !Number.isFinite(raw.userNum) || raw.userNum < 0)) return false;

        // 原生優先：原生樣本在線時，備用（userscript）觀看樣本不計入；原生靜默後備用才接手。
        if (kind === 'viewers') {
            if (transport === 'native') {
                this.lastNativeViewersAt.set(platform, receivedAt);
            } else {
                const lastNative = this.lastNativeViewersAt.get(platform);
                if (lastNative != null && receivedAt - lastNative <= NATIVE_PRIORITY_MS) return false;
            }
        }

        while (this.seen.size > 20000) this.seen.delete(this.seen.keys().next().value);

        // 成效快照：只收有限非負的數值，至少要有一個欄位才算有效。
        let metrics = null;
        if (kind === 'metrics') {
            metrics = {};
            let hasValue = false;
            for (const field of METRIC_FIELDS) {
                const value = raw[field];
                if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
                    metrics[field] = value;
                    hasValue = true;
                }
            }
            if (!hasValue) return false;
        }

        const event = {
            time,
            receivedAt,
            kind,
            platform,
            transport,
            user,
            userId: String(raw.userId || ''),
            viewers: kind === 'viewers' ? raw.userNum : null,
            stream,
            evidence: transport === 'native' ? 'native' : 'declared',
            timeSource: sentAt > 0 ? 'platform' : 'received'
        };
        if (metrics) Object.assign(event, metrics);

        if (this.database && !this.database.append(event, key, receivedAt + (id ? 86400000 : 10000))) return false;
        if (key) this.seen.set(key, receivedAt + (id ? 86400000 : 10000));

        this.events.push(event);
        this.events = this.events.filter(e => e.time >= receivedAt - 86400000).slice(-20000);
        return true;
    }

    /** 平台時間可能是秒、毫秒或 ISO 字串；統一轉成毫秒。 */
    sentAtOf(raw) {
        let sentAt = raw.sentAt ?? raw.createTime;
        if (typeof sentAt === 'string' && !/^\d+(\.\d+)?$/.test(sentAt)) sentAt = Date.parse(sentAt);
        else sentAt = Number(sentAt);
        if (sentAt > 0 && sentAt < 1e11) sentAt *= 1000;
        return sentAt;
    }

    /**
     * audience 視為 viewers；其餘只認明確的 join／chat，一般聊天字詞不算進房。
     * 原生連線用 eventType；userscript 轉接送的是 type:'StreamMessage'（沒有 eventType），兩者都要收。
     */
    kindOf(raw) {
        if (raw.type === 'audience') return 'viewers';
        if (raw.type === 'metrics') return 'metrics';
        if (raw.eventType === 'join') return 'join';
        if (raw.eventType === 'chat' || raw.type === 'StreamMessage') return 'chat';
        return null;
    }

    /** 串流 ID（room／stream）；有就帶上，讓場次識別跨重啟可靠。 */
    streamOf(raw) {
        const value = raw.streamId ?? raw.roomId;
        if (value === undefined || value === null || value === '') return null;
        return String(value).slice(0, 80);
    }

    /** 清掉已過期的去重鍵。 */
    expireSeen(receivedAt) {
        for (const [key, expires] of this.seen) if (expires < receivedAt) this.seen.delete(key);
    }

    /**
     * 即時視窗快照（依平台分桶）。
     *
     * 缺少觀看數保持 null；不跨平台相加，避免把不同平台的人數誤認成去重人數。
     */
    snapshot(platform, minutes = 30) {
        const now = this.now();
        const since = now - minutes * 60000;
        this.events = this.events.filter(e => e.time >= now - 86400000);

        const platforms = this.database
            ? this.database.platforms()
            : [...new Set(this.events.map(e => e.platform))].sort();
        platform = platforms.includes(platform) ? platform : platforms[0];

        const events = this.events
            .filter(e => e.platform === platform && e.time >= since)
            .sort((a, b) => a.time - b.time);

        const buckets = new Map();
        for (let t = Math.floor(since / 60000) * 60000; t <= now; t += 60000) {
            buckets.set(t, { time: t, joins: 0, chats: 0, viewers: null, users: new Set() });
        }
        for (const event of events) {
            const bucket = buckets.get(Math.floor(event.time / 60000) * 60000);
            if (!bucket) continue;
            if (event.kind === 'join') bucket.joins++;
            if (event.kind === 'chat') {
                bucket.chats++;
                if (event.userId) bucket.users.add(event.userId);
            }
            if (event.kind === 'viewers') bucket.viewers = event.viewers;
        }

        const samples = events.filter(e => e.kind === 'viewers');
        const last = samples.at(-1);
        const fresh = last && now - last.time <= 90000;

        let growth = null;
        let growingMs = 0;
        if (fresh && samples.length > 1) {
            const previous = samples.at(-2);
            const dt = last.time - previous.time;
            if (dt > 0 && dt <= 90000) growth = (last.viewers - previous.viewers) * 60000 / dt;
            for (let i = samples.length - 1; i > 0; i--) {
                const a = samples[i - 1];
                const b = samples[i];
                if (b.time - a.time > 90000 || b.viewers <= a.viewers) break;
                growingMs += b.time - a.time;
            }
        }

        return {
            startedAt: this.startedAt,
            now,
            platform,
            platforms,
            currentViewers: fresh ? last.viewers : null,
            lastViewerAt: last?.time ?? null,
            growth,
            growingMs,
            buckets: [...buckets.values()].map(bucket => ({ ...bucket, users: bucket.users.size })),
            events: events.filter(e => e.kind === 'join').slice(-200)
        };
    }
}

module.exports = { TrafficStore };
