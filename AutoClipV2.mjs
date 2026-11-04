import { calculateMetrics } from './ScriptLib/autoclip/metrics.mjs';
import { captureEvidence } from './ScriptLib/autoclip/evidence.mjs';
import { requestClip } from './ScriptLib/autoclip/clipRequest.mjs';
import { messageTime } from './ScriptLib/messageStats/time.mjs';
import { normalizeSource, normalizePlatform } from './MessageSource.mjs';
const MINUTE = 60000;

export class AutoClipManager {

    /** 建立偵測器；now 與 onCreateClip 可注入測試時鐘及剪輯服務。 */
    constructor({ onCreateClip = async () => null, shadow = true, platform = 'all', delayOffsetsMs = {},
        rateWindowMin = 0.5, baselineWindowMin = 15, wViewers = 0.2, wMsg = 0.8,
        scoreThreshold = 1.8, floorViewers = 2, floorMsgPerMin = 2,
        cooldownMin = 15, sustainMin = 0.167, warmupMs = 180000,
        minMessages = 6, minUsers = 3, minMessageRatio = 1.5, adaptiveThresholds = true,
        maxPerUser = 3, staleMs = 90000,
        solo = 'auto', soloWindowMin = 15, soloMaxViewers = 20,
        soloMinMessages = 5, soloMinUsers = 1, soloMinMessageRatio = 3,
        soloScoreThreshold = 2.5, soloMaxPerUser = 5,
        titlePrefix = '', log = console.log, now = Date.now, requestTimeoutMs = 60000,
        logIntervalMs = 60000 } = {}) {
        Object.assign(this, { onCreateClip, shadow, platform, delayOffsetsMs, wViewers, wMsg, scoreThreshold,
            floorViewers, floorMsgPerMin, warmupMs, minMessages, minUsers, minMessageRatio, adaptiveThresholds,
            maxPerUser, staleMs, titlePrefix, log, now, requestTimeoutMs, logIntervalMs });
        // 單人活躍發言者模式：預設自動判斷；on 只看發言者數，off 完全停用。
        this.solo = ['off', 'auto', 'on'].includes(solo) ? solo : 'auto';
        this.soloMaxViewers = Math.max(1, soloMaxViewers);
        this.soloMinMessages = Math.max(1, soloMinMessages);
        this.soloMinUsers = Math.max(1, soloMinUsers);
        this.soloMinMessageRatio = Math.max(1, soloMinMessageRatio);
        this.soloScoreThreshold = Math.max(0, soloScoreThreshold);
        this.soloMaxPerUser = Math.max(1, soloMaxPerUser);
        // 狀態列只在狀態改變、觸發或達到心跳間隔時輸出，避免每次評估（5 秒）洗版。
        this.lastLogReason = null;
        this.lastLogAt = 0;
        this.rateMs = Math.max(5000, rateWindowMin * MINUTE);
        this.soloWindowMs = Math.max(this.rateMs, soloWindowMin * MINUTE);
        this.baselineMs = Math.max(this.rateMs * 2, baselineWindowMin * MINUTE);
        this.cooldownMs = cooldownMin * MINUTE;
        this.sustainMs = sustainMin * MINUTE;
        this.ids = new Map();
        this.history = [];
        this.historyLimit = 2000;
        this.totalClips = 0;
        this.totalTriggers = 0;
        this.failedClips = 0;
        this.shadowTriggers = 0;
        this.pending = false;
        this.lastClipAt = null;
        this.reset();
    }

    /** 重置暖機與窗口；保留去重、冷卻、累計結果及進行中的請求。 */
    reset() {
        this.messages = [];
        this.samples = [];
        this.aboveSince = null;
        this.peak = null;
        this.triggered = false;
        this.currentViewers = 0;
        this.viewerAt = null;
        this.startedAt = this.now();
        this.platformViewers = new Map();
        this.sourceActivity = new Map();
        this.recentChatters = new Map();
    }

    /** 記錄有效來源最近活動，供平台卡片顯示接收管道。 */
    observeTransport(meta, now = this.now()) {
        const source = normalizeSource(meta);
        if (!source.heatEligible) return;
        const activity = this.sourceActivity.get(source.platform) || new Map();
        activity.set(source.transport, now);
        this.sourceActivity.set(source.platform, activity);
    }

    /** 依訊息時間、平台去重與每人上限納入有效留言；回傳是否計入。 */
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
        for (const [id, at] of this.ids) {
            if (now - at < 1800000) break;
            this.ids.delete(id);
        }
        if (key && this.ids.has(key)) return false;
        if (key) this.ids.set(key, now);
        while (this.ids.size > 10000) this.ids.delete(this.ids.keys().next().value);
        // 無身分留言共用一個使用者，避免虛增不同發言人數。
        const user = `${event.platform}:${event.userId || event.user || 'unknown'}`;
        // 近期發言者只用來判斷單人模式；即使這則因每人上限沒計入，發言者仍算活躍。
        this.recentChatters.set(user, now);
        while (this.recentChatters.size > 10000) this.recentChatters.delete(this.recentChatters.keys().next().value);
        const soloMode = this.soloModeFor(event.platform, now);
        this.messages = this.messages.filter(m => m.t >= now - this.rateMs);
        const text = String(event.message || '').slice(0, 1000);
        // 單人模式要求不同訊息；同一人重複相同文字不累積成 5 則。
        if (soloMode && this.messages.some(m => m.user === user && m.message === text)) return false;
        const perUserLimit = soloMode ? this.soloMaxPerUser : this.maxPerUser;
        if (this.messages.filter(m => m.user === user).length >= perUserLimit) return false;
        this.messages.push({ t, originalTime, user, id: event.id || null,
            name: String(event.user || user).slice(0, 100),
            message: text,
            platform: event.platform, transport: event.transport, receivedAt: event.receivedAt || now,
            timeSource: event.sentAt == null ? 'received' : 'platform' });
        if (this.messages.length > 10000) this.messages.shift();
        return true;
    }

    /** 更新 Twitch 剪輯入口的觀眾狀態；斷線恢復後重新暖機。 */
    updateViewers(viewers, now = this.now()) {
        if (!Number.isFinite(viewers) || viewers < 0) return;
        if (this.viewerAt !== null && now - this.viewerAt > this.staleMs) this.reset();
        this.currentViewers = viewers;
        this.viewerAt = now;
        this.updatePlatformViewers('Twitch', viewers, now);
    }

    /** 記錄指定平台的觀眾數與時間，過期資料不參與分數。 */
    updatePlatformViewers(platform, viewers, now = this.now()) {
        platform = normalizePlatform(platform);
        if (Number.isFinite(viewers) && viewers >= 0) this.platformViewers.set(platform, { viewers, at: now });
    }

    /** 清除超過單人判斷窗口的發言者。 */
    pruneRecentChatters(now = this.now()) {
        for (const [key, at] of this.recentChatters) {
            if (now - at > this.soloWindowMs) this.recentChatters.delete(key);
        }
    }

    /** 指定平台近期有發言的不同使用者數。 */
    recentDistinctUsers(platform, now = this.now()) {
        this.pruneRecentChatters(now);
        const prefix = `${platform}:`;
        let count = 0;
        for (const key of this.recentChatters.keys()) if (key.startsWith(prefix)) count += 1;
        return count;
    }

    /** 目前所有平台的新鮮觀眾總數；只用於單人模式的觀眾上限。 */
    totalViewers(now = this.now()) {
        let total = 0;
        for (const item of this.platformViewers.values()) {
            if (now - item.at <= this.staleMs) total += item.viewers;
        }
        return total;
    }

    /**
     * 單人模式只在近期剛好 1 位發言者時成立；auto 再加觀眾上限，
     * on 只忽略觀眾上限，仍要求 1 位發言者。
     */
    soloModeFor(platform, now = this.now()) {
        if (this.solo === 'off') return false;
        if (this.recentDistinctUsers(platform, now) !== 1) return false;
        return this.solo === 'on' || this.totalViewers(now) <= this.soloMaxViewers;
    }

    /** 更新有效窗口並取得平台分數；保留既有內部介面。 */
    _metrics(now) {
        this.pruneRecentChatters(now);
        return calculateMetrics(this, now);
    }

    /** 取得目前窗口統計，不執行觸發判定。 */
    getStats(now = this.now()) {
        return this._metrics(now);
    }

    /** 取得歷史列；未完成的剪輯會在原列更新結果。 */
    getHistory() { return this.history; }

    /** 清除顯示歷史，不重設偵測窗口或冷卻。 */
    clearHistory() { this.history = []; }

    /** 提供管理頁使用的設定，明確區分熱度來源與 Twitch 剪輯入口。 */
    getConfig() {
        return { mode: this.shadow ? 'shadow' : 'live', platform: 'all', clipPlatform: 'Twitch', aggregation: 'max-qualified-platform', delayOffsetsMs: this.delayOffsetsMs,
            rateWindowMin: this.rateMs / MINUTE, baselineWindowMin: this.baselineMs / MINUTE,
            sustainMin: this.sustainMs / MINUTE, cooldownMin: this.cooldownMs / MINUTE,
            wViewers: this.wViewers, wMsg: this.wMsg, scoreThreshold: this.scoreThreshold,
            floorViewers: this.floorViewers, floorMsgPerMin: this.floorMsgPerMin,
            minMessages: this.minMessages, minUsers: this.minUsers, minMessageRatio: this.minMessageRatio,
            adaptiveThresholds: this.adaptiveThresholds,
            maxPerUser: this.maxPerUser, warmupMs: this.warmupMs,
            solo: this.solo, soloWindowMin: this.soloWindowMs / MINUTE, soloMaxViewers: this.soloMaxViewers,
            soloMinMessages: this.soloMinMessages, soloMinUsers: this.soloMinUsers,
            soloMinMessageRatio: this.soloMinMessageRatio, soloScoreThreshold: this.soloScoreThreshold,
            soloMaxPerUser: this.soloMaxPerUser };
    }

    /** 推進暖機、持續熱度與冷卻狀態；每次記錄統計，符合條件才提交剪輯。 */
    evaluate(now = this.now()) {
        const s = this._metrics(now);
        const fresh = this.viewerAt !== null && now - this.viewerAt <= this.staleMs;
        let reason = '', fire = false;
        if (!fresh) {
            this.reset();
            reason = '觀眾資料過期或斷線，重新暖機';
        } else if (now - this.startedAt < this.warmupMs || s.sampleCount < 3) reason = '暖機收集基準';
        else if (s.viewers < this.floorViewers) reason = '觀眾不足';
        // sourcePlatform 只在某個平台自己的有效門檻都通過時才會有值；
        // 不可再用跨平台總留言／總人數判定，否則自適應門檻會被其他平台稀釋。
        else if (!s.sourcePlatform) reason = '平台未達留言／人數／倍率門檻';
        else if (s.score < (s.scoreThreshold ?? this.scoreThreshold)) reason = '未達聊天突增門檻';
        const qualified = !reason;
        if (!qualified) {
            this.aboveSince = null;
            this.peak = null;
            this.triggered = false;
        } else {
            if (this.aboveSince === null) this.aboveSince = now;
            if (!this.peak || s.score > this.peak.score) this.peak = { at: now, score: s.score };
            if (this.pending) reason = '剪輯建立中';
            else if (s.cooldownLeftMin > 0) reason = '冷卻中';
            else if (this.triggered) reason = '等待熱度回落';
            else if (now - this.aboveSince < this.sustainMs) reason = '確認短期熱度持續';
            else {
                fire = true;
                reason = this.shadow ? '影子模式：符合剪輯條件，未發送請求' : '觸發剪輯';
            }
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
            this.triggered = true;
            this.lastClipAt = now;
            this.totalTriggers++;
            Object.assign(row, { heatStartedAt: this.aboveSince, peakAt: this.peak.at, triggeredAt: now });
            row.evidence = captureEvidence(this, s, now);
            if (this.shadow) {
                this.shadowTriggers++;
                row.status = 'shadow';
            } else {
                requestClip(this, row, now);
            }
            Object.assign(row, { totalTriggers: this.totalTriggers, shadowTriggers: this.shadowTriggers, pending: this.pending });
        }
        // 狀態列節流：狀態改變、觸發，或距上次輸出達 logIntervalMs 時才輸出。
        if (reason !== this.lastLogReason || fire || now - this.lastLogAt >= this.logIntervalMs) {
            this.log(`[AutoClip]${s.solo ? ' [單人]' : ''} ${reason} | 留言=${s.windowMsgs} 人數=${s.uniqueUsers} 分數=${s.score.toFixed(2)}`);
            this.lastLogReason = reason;
            this.lastLogAt = now;
        }
        return { triggered: fire, reason, stats: row };
    }
}
