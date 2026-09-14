import { messageTime } from './MessageStats.mjs';
import { normalizeSource, normalizePlatform } from './MessageSource.mjs';
const MINUTE = 60000;
const median = values => {
    const a = [...values].sort((x, y) => x - y), m = Math.floor(a.length / 2);
    return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : 0;
};

export class AutoClipManager {
    constructor({ onCreateClip = async () => null, shadow = true, platform = 'all', delayOffsetsMs = {},
        rateWindowMin = 0.5, baselineWindowMin = 15, wViewers = 0.2, wMsg = 0.8,
        scoreThreshold = 1.8, floorViewers = 2, floorMsgPerMin = 2,
        cooldownMin = 15, sustainMin = 0.167, warmupMs = 180000,
        minMessages = 6, minUsers = 3, maxPerUser = 3, staleMs = 90000,
        titlePrefix = '', log = console.log, now = Date.now, requestTimeoutMs = 60000 } = {}) {
        Object.assign(this, { onCreateClip, shadow, platform, delayOffsetsMs, wViewers, wMsg, scoreThreshold,
            floorViewers, floorMsgPerMin, warmupMs, minMessages, minUsers, maxPerUser,
            staleMs, titlePrefix, log, now, requestTimeoutMs });
        this.rateMs = Math.max(5000, rateWindowMin * MINUTE);
        this.baselineMs = Math.max(this.rateMs * 2, baselineWindowMin * MINUTE);
        this.cooldownMs = cooldownMin * MINUTE;
        this.sustainMs = sustainMin * MINUTE;
        this.ids = new Map(); this.history = []; this.historyLimit = 2000;
        this.totalClips = 0; this.totalTriggers = 0; this.failedClips = 0; this.shadowTriggers = 0;
        this.pending = false; this.lastClipAt = null;
        this.reset();
    }
    reset() {
        this.messages = []; this.samples = []; this.aboveSince = null; this.peak = null;
        this.triggered = false; this.currentViewers = 0; this.viewerAt = null;
        this.startedAt = this.now();
        this.platformViewers = new Map();
        this.sourceActivity = new Map();
    }
    observeTransport(meta, now = this.now()) {
        const source = normalizeSource(meta);
        if (!source.heatEligible) return;
        const activity = this.sourceActivity.get(source.platform) || new Map();
        activity.set(source.transport, now);
        this.sourceActivity.set(source.platform, activity);
    }
    onChatMessage(event, now = this.now()) {
        if (!event || typeof event !== 'object') return false;
        const source = normalizeSource(event);
        if (!source.heatEligible || event.heatEligible === false) return false;
        event = { ...event, ...source };
        this.observeTransport(event, now);
        const originalTime = messageTime(event.sentAt) ?? messageTime(event.receivedAt) ?? now;
        const offset = Number(this.delayOffsetsMs[event.platform] || 0);
        const t = originalTime - (Number.isFinite(offset) ? offset : 0);
        if (now - t > this.rateMs || t > now + 3000 || t < this.startedAt) return false;
        const key = event.id ? `${event.platform}:${event.id}` : event.key;
        for (const [id, at] of this.ids) { if (now - at < 1800000) break; this.ids.delete(id); }
        if (key && this.ids.has(key)) return false;
        if (key) this.ids.set(key, now);
        while (this.ids.size > 10000) this.ids.delete(this.ids.keys().next().value);
        // Unknown identity cannot independently inflate the unique-user gate.
        const user = `${event.platform}:${event.userId || event.user || 'unknown'}`;
        this.messages = this.messages.filter(m => m.t >= now - this.rateMs);
        if (this.messages.filter(m => m.user === user).length >= this.maxPerUser) return false;
        this.messages.push({ t, originalTime, user, id: event.id || null,
            name: String(event.user || user).slice(0, 100),
            message: String(event.message || '').slice(0, 1000),
            platform: event.platform, transport: event.transport, receivedAt: event.receivedAt || now,
            timeSource: event.sentAt == null ? 'received' : 'platform' });
        if (this.messages.length > 10000) this.messages.shift();
        return true;
    }
    updateViewers(viewers, now = this.now()) {
        if (!Number.isFinite(viewers) || viewers < 0) return;
        if (this.viewerAt !== null && now - this.viewerAt > this.staleMs) this.reset();
        this.currentViewers = viewers; this.viewerAt = now;
        this.updatePlatformViewers('Twitch', viewers, now);
    }
    updatePlatformViewers(platform, viewers, now = this.now()) {
        platform = normalizePlatform(platform);
        if (Number.isFinite(viewers) && viewers >= 0) this.platformViewers.set(platform, { viewers, at: now });
    }
    _metrics(now) {
        this.messages = this.messages.filter(m => m.t >= now - this.rateMs && m.t <= now + 3000);
        const recent = this.samples.filter(s => s.t >= now - this.baselineMs && s.t < now - this.rateMs);
        const names = new Set([...this.platformViewers.keys(), ...this.messages.map(m => m.platform)]);
        const platforms = [...names].map(platform => {
            const messages = this.messages.filter(m => m.platform === platform);
            const v = this.platformViewers.get(platform);
            const viewers = v && now - v.at <= this.staleMs ? v.viewers : 0;
            const baseViewers = median(recent.map(s => s.platforms?.find(p => p.platform === platform)?.viewers || 0));
            const baseMsgRate = median(recent.map(s => s.platforms?.find(p => p.platform === platform)?.msgRate || 0));
            const msgRate = messages.length / (this.rateMs / MINUTE);
            const messageRatio = msgRate / Math.max(baseMsgRate, this.floorMsgPerMin);
            const uniqueUsers = new Set(messages.map(m => m.user)).size;
            // Equal platform treatment: normalize locally; never weight by raw audience size.
            const score = this.wMsg * Math.min(10, messageRatio) + this.wViewers * Math.min(2, viewers / Math.max(baseViewers, this.floorViewers));
            const transports = [...(this.sourceActivity.get(platform) || new Map())]
                .filter(([, at]) => now - at <= this.staleMs).map(([transport]) => transport);
            return { platform, transports, viewers, baseViewers, msgRate, baseMsgRate, messageRatio,
                windowMsgs: messages.length, uniqueUsers, score,
                eligible: messages.length >= this.minMessages && uniqueUsers >= this.minUsers && messageRatio >= 1.5 };
        });
        // Strongest independently qualified reaction wins; quiet platforms cannot dilute it.
        const winner = platforms.filter(p => p.eligible).sort((a,b) => b.score-a.score)[0];
        for (const p of platforms) p.contribution = p === winner ? p.score : 0;
        const sum = key => platforms.reduce((n,p) => n+p[key],0);
        return { viewers: sum('viewers'), msgRate: sum('msgRate'), baseViewers: sum('baseViewers'), baseMsgRate: sum('baseMsgRate'),
            platforms, sourcePlatform: winner?.platform || null,
            sampleCount: recent.length, windowMsgs: this.messages.length,
            uniqueUsers: new Set(this.messages.map(m => m.user)).size,
            messageRatio: winner?.messageRatio || 0, score: winner?.score || 0,
            totalClips: this.totalClips, totalTriggers: this.totalTriggers, failedClips: this.failedClips,
            shadowTriggers: this.shadowTriggers, pending: this.pending,
            cooldownLeftMin: this.lastClipAt === null ? 0 : Math.max(0, (this.lastClipAt + this.cooldownMs - now) / MINUTE) };
    }
    getStats(now = this.now()) { return this._metrics(now); }
    getHistory() { return this.history; }
    clearHistory() { this.history = []; }
    getConfig() {
        return { mode: this.shadow ? 'shadow' : 'live', platform: 'all', clipPlatform: 'Twitch', aggregation: 'max-qualified-platform', delayOffsetsMs: this.delayOffsetsMs,
            rateWindowMin: this.rateMs / MINUTE, baselineWindowMin: this.baselineMs / MINUTE,
            sustainMin: this.sustainMs / MINUTE, cooldownMin: this.cooldownMs / MINUTE,
            wViewers: this.wViewers, wMsg: this.wMsg, scoreThreshold: this.scoreThreshold,
            floorViewers: this.floorViewers, floorMsgPerMin: this.floorMsgPerMin,
            minMessages: this.minMessages, minUsers: this.minUsers, warmupMs: this.warmupMs };
    }
    evaluate(now = this.now()) {
        const s = this._metrics(now);
        const fresh = this.viewerAt !== null && now - this.viewerAt <= this.staleMs;
        let reason = '', fire = false;
        if (!fresh) { this.reset(); reason = '觀眾資料過期或斷線，重新暖機'; }
        else if (now - this.startedAt < this.warmupMs || s.sampleCount < 3) reason = '暖機收集基準';
        else if (s.viewers < this.floorViewers) reason = '觀眾不足';
        else if (s.windowMsgs < this.minMessages || s.uniqueUsers < this.minUsers) reason = '有效留言或不同發言人不足';
        else if (s.messageRatio < 1.5 || s.score < this.scoreThreshold) reason = '未達聊天突增門檻';
        const qualified = !reason;
        if (!qualified) { this.aboveSince = null; this.peak = null; this.triggered = false; }
        else {
            if (this.aboveSince === null) this.aboveSince = now;
            if (!this.peak || s.score > this.peak.score) this.peak = { at: now, score: s.score };
            if (this.pending) reason = '剪輯建立中';
            else if (s.cooldownLeftMin > 0) reason = '冷卻中';
            else if (this.triggered) reason = '等待熱度回落';
            else if (now - this.aboveSince < this.sustainMs) reason = '確認短期熱度持續';
            else { fire = true; reason = this.shadow ? '影子模式：符合剪輯條件，未發送請求' : '觸發剪輯'; }
        }
        if (fresh && (!this.samples.length || now - this.samples.at(-1).t >= 5000)) {
            this.samples.push({ t: now, viewers: s.viewers, msgRate: s.msgRate, platforms: s.platforms });
        }
        this.samples = this.samples.filter(x => x.t >= now - this.baselineMs);
        const row = { ...s, t: new Date(now).toISOString(), triggered: fire, reason,
            mode: this.shadow ? 'shadow' : 'live', status: 'observing' };
        this.history.push(row);
        if (this.history.length > this.historyLimit) this.history.shift();
        if (fire) {
            this.triggered = true; this.lastClipAt = now; this.totalTriggers++;
            Object.assign(row, { heatStartedAt: this.aboveSince, peakAt: this.peak.at, triggeredAt: now });
            // Freeze the exact counted window; later traffic must not rewrite the explanation.
            row.evidence = { windowStart: now - this.rateMs, windowEnd: now,
                total: this.messages.length, uniqueUsers: s.uniqueUsers, platforms: s.platforms.map(p => ({ ...p })), sourcePlatform: s.sourcePlatform,
                minMessages: this.minMessages, minUsers: this.minUsers,
                threshold: this.scoreThreshold, messageRatio: s.messageRatio,
                maxPerUser: this.maxPerUser,
                truncated: this.messages.length > 200,
                messages: this.messages.slice(-200).map(m => ({ ...m })).sort((a, b) => a.t - b.t) };
            if (this.shadow) { this.shadowTriggers++; row.status = 'shadow'; }
            else {
                this.pending = true; row.status = 'pending'; row.requestedAt = this.now();
                const title = this.titlePrefix ? `${this.titlePrefix} ${new Date(now).toLocaleString('zh-TW')}` : null;
                let timer;
                const timeout = new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('剪輯請求逾時，結果待人工確認，不自動重送')), this.requestTimeoutMs);
                });
                Promise.race([Promise.resolve().then(() => this.onCreateClip(title, row)), timeout]).then(result => {
                    if (!result?.id) throw new Error('未取得剪輯 ID');
                    this.totalClips++; row.status = 'success'; row.completedAt = this.now();
                    row.clip = result;
                }).catch(err => {
                    this.failedClips++; row.status = 'failed'; row.error = err.message;
                    row.completedAt = this.now();
                    this.log(`❌ [AutoClip] ${err.message}`);
                }).finally(() => {
                    clearTimeout(timer);
                    this.pending = false;
                    Object.assign(row, { totalClips: this.totalClips, failedClips: this.failedClips, pending: false });
                });
            }
            Object.assign(row, { totalTriggers: this.totalTriggers, shadowTriggers: this.shadowTriggers, pending: this.pending });
        }
        this.log(`[AutoClip] ${reason} | 留言=${s.windowMsgs} 人數=${s.uniqueUsers} 分數=${s.score.toFixed(2)}`);
        return { triggered: fire, reason, stats: row };
    }
}
