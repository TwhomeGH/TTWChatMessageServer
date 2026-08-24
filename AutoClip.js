/**
 * AutoClipManager — Twitch 自動剪輯觸發器
 *
 * 設計：以「頻道自己的近期常態」做自適應基準 (adaptive baseline)，
 * 比較當前人氣 / 聊天速率相對平常的倍率，計算加權分數，超過門檻即觸發剪輯。
 *
 * - 訊息滑動窗口：記錄每則聊天訊息的時間戳，修剪出近 N 分鐘窗口
 * - 基準樣本：每個 poll 週期記錄一次 (viewers, msgRate)，取中位數當基準
 * - score = W_viewers·(viewers / max(baseViewers, floorV))
 *         + W_msg·(msgRate / max(baseMsgRate, floorM))
 * - 上升緣偵測 + cooldown，避免連續觸發
 */

const MINUTE = 60 * 1000;

function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class AutoClipManager {
    constructor({
        onCreateClip = async () => {},
        windowMin = 30,
        baselineWindowMin = 30,
        rateWindowMin = 5,
        wViewers = 0.5,
        wMsg = 0.5,
        scoreThreshold = 1.8,
        floorViewers = 2,
        floorMsgPerMin = 0.3,
        cooldownMin = 15,
        titlePrefix = '',
        log = console.log,
    } = {}) {
        this.onCreateClip = onCreateClip;
        this.windowMs = windowMin * MINUTE;
        this.baselineMs = baselineWindowMin * MINUTE;
        this.rateMs = rateWindowMin * MINUTE;
        this.wViewers = wViewers;
        this.wMsg = wMsg;
        this.scoreThreshold = scoreThreshold;
        this.floorViewers = floorViewers;
        this.floorMsgPerMin = floorMsgPerMin;
        this.cooldownMs = cooldownMin * MINUTE;
        this.titlePrefix = titlePrefix || '';
        this.log = log;

        this.msgTimes = [];
        this.samples = [];
        this.currentViewers = 0;
        this.lastClipAt = 0;
        this.triggered = false;
        this.totalMessages = 0;
        this.totalClips = 0;
        this.history = [];
        this.historyLimit = 2000;
    }

    // 注意：呼叫端一律傳訊息文字，第一參數僅作為占位（可能未來做內容過濾），
    // 時間戳一律用 Date.now()，避免把字串當時間戳塞進 msgTimes 導致速率恆為 0
    onChatMessage(_msg, now = Date.now()) {
        this.msgTimes.push(now);
        this.totalMessages++;
        this._pruneMsgs(now);
    }

    _pruneMsgs(now = Date.now()) {
        const cutoff = now - this.windowMs;
        while (this.msgTimes.length && this.msgTimes[0] < cutoff) this.msgTimes.shift();
    }

    currentMsgRate(now = Date.now()) {
        const cutoff = now - this.rateMs;
        let count = 0;
        for (let i = this.msgTimes.length - 1; i >= 0; i--) {
            if (this.msgTimes[i] >= cutoff) count++;
            else break;
        }
        return count / (this.rateMs / MINUTE);
    }

    updateViewers(viewers, now = Date.now()) {
        this.currentViewers = viewers;
        this.samples.push({ t: now, viewers, msgRate: this.currentMsgRate(now) });
        const cutoff = now - this.baselineMs;
        while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
    }

    _baselines(now = Date.now()) {
        const cutoff = now - this.baselineMs;
        const recent = this.samples.filter(s => s.t >= cutoff);
        return {
            baseViewers: median(recent.map(s => s.viewers)),
            baseMsgRate: median(recent.map(s => s.msgRate)),
            sampleCount: recent.length,
        };
    }

    _score(baseViewers, baseMsgRate, now = Date.now()) {
        const rate = this.currentMsgRate(now);
        const vTerm = this.currentViewers / Math.max(baseViewers, this.floorViewers);
        const mTerm = rate / Math.max(baseMsgRate, this.floorMsgPerMin);
        return this.wViewers * vTerm + this.wMsg * mTerm;
    }

    getStats(now = Date.now()) {
        const { baseViewers, baseMsgRate, sampleCount } = this._baselines(now);
        const rate = this.currentMsgRate(now);
        const cooldownLeft = this.lastClipAt ? (this.lastClipAt + this.cooldownMs - now) / MINUTE : 0;
        return {
            windowMsgs: this.msgTimes.length,
            msgRate: +rate.toFixed(2),
            viewers: this.currentViewers,
            baseViewers: +baseViewers.toFixed(1),
            baseMsgRate: +baseMsgRate.toFixed(2),
            sampleCount,
            score: +this._score(baseViewers, baseMsgRate, now).toFixed(2),
            cooldownLeftMin: +(cooldownLeft > 0 ? cooldownLeft : 0).toFixed(1),
            totalClips: this.totalClips,
        };
    }

    /**
     * 取得歷史評估點（供圖表分析頁面使用）
     */
    getHistory() {
        return this.history;
    }

    /**
     * 清空歷史（由 Server 的清空指令觸發）
     */
    clearHistory() {
        this.history = [];
    }

    /**
     * 取得目前設定（供圖表頁顯示門檻線與狀態）
     */
    getConfig() {
        return {
            windowMin: this.windowMs / MINUTE,
            baselineWindowMin: this.baselineMs / MINUTE,
            rateWindowMin: this.rateMs / MINUTE,
            wViewers: this.wViewers,
            wMsg: this.wMsg,
            scoreThreshold: this.scoreThreshold,
            floorViewers: this.floorViewers,
            floorMsgPerMin: this.floorMsgPerMin,
            cooldownMin: this.cooldownMs / MINUTE,
        };
    }

    /**
     * 定期評估是否觸發自動剪輯（建議每 30 秒與人數 poll 對齊呼叫）
     * @returns {{ triggered: boolean, reason: string, stats: object }}
     */
    evaluate(now = Date.now()) {
        this._pruneMsgs(now);
        const { baseViewers, baseMsgRate, sampleCount } = this._baselines(now);
        const rate = this.currentMsgRate(now);
        const score = this._score(baseViewers, baseMsgRate, now);

        let triggered = false;
        let reason = '';

        if (sampleCount < 3) {
            reason = '基準樣本不足，等待收集中';
        } else if (this.currentViewers < this.floorViewers) {
            reason = `觀眾 ${this.currentViewers} < 最低門檻 ${this.floorViewers}`;
        } else if (this.lastClipAt && now - this.lastClipAt < this.cooldownMs) {
            const left = Math.ceil((this.lastClipAt + this.cooldownMs - now) / MINUTE);
            reason = `冷卻中，剩 ${left} 分`;
        } else {
            const over = score >= this.scoreThreshold;
            if (over && !this.triggered) {
                triggered = true;
                reason = `分數 ${score.toFixed(2)} 達門檻 ${this.scoreThreshold}`;
            } else {
                this.triggered = false;
                reason = over ? '持續達標，等待分數回落' : `分數 ${score.toFixed(2)} < ${this.scoreThreshold}`;
            }
        }

        const stats = this.getStats(now);
        this.log(`🎬 [AutoClip] 觀眾=${stats.viewers} | 基準=${stats.baseViewers} | 訊息=${stats.msgRate}/min | 基準訊息=${stats.baseMsgRate} | 分數=${stats.score}/${this.scoreThreshold} | 樣本=${sampleCount} → ${reason}`);

        // 記錄歷史點（供圖表頁）
        this.history.push({
            t: new Date(now).toISOString(),
            viewers: this.currentViewers,
            baseViewers: stats.baseViewers,
            msgRate: stats.msgRate,
            baseMsgRate: stats.baseMsgRate,
            score: stats.score,
            sampleCount,
            triggered,
            reason,
        });
        if (this.history.length > this.historyLimit) {
            this.history.splice(0, this.history.length - this.historyLimit);
        }

        if (triggered) {
            this.triggered = true;
            this.lastClipAt = now;
            this.totalClips++;
            const title = this.titlePrefix ? `${this.titlePrefix} ${new Date().toLocaleString('zh-TW')}` : null;
            this.log(`🎬 [AutoClip] 🎥 觸發自動剪輯! title=${title}`);
            try {
                const ret = this.onCreateClip(title);
                if (ret && typeof ret.then === 'function') {
                    ret.catch(err => this.log(`❌ [AutoClip] 剪輯建立失敗: ${err.message}`));
                }
            } catch (err) {
                this.log(`❌ [AutoClip] 觸發剪輯異常: ${err.message}`);
            }
        }

        return { triggered, reason, stats };
    }
}
