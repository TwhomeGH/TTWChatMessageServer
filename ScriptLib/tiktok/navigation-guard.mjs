/**
 * TikTok 導航節流：限制 signer 對 TikTok 文件頁面的導航頻率，
 * 並在 403／429／451 後冷卻，避免 WAF 期間反覆重建頁面。
 */
export class TikTokNavigationGuard {
    /**
     * @param {Object} [options]
     * @param {number} [options.minIntervalMs=10000]
     * @param {number} [options.wafCooldownMs=600000]
     * @param {() => number} [options.now]
     * @param {(ms: number) => Promise<void>} [options.sleep]
     * @param {Console} [options.logger]
     */
    constructor({ minIntervalMs = 10000, wafCooldownMs = 600000, now = Date.now,
        sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), logger = console } = {}) {
        this.minIntervalMs = Math.max(0, Number(minIntervalMs) || 0);
        this.wafCooldownMs = Math.max(0, Number(wafCooldownMs) || 0);
        this.now = now;
        this.sleep = sleep;
        this.logger = logger;
        this.lastNavigationAt = -Infinity;
        this.cooldownUntil = 0;
        this.count = 0;
        this.lastStatus = null;
        this.queue = Promise.resolve();
    }

    /**
     * 取得下一次導航許可；需要等待時會 sleep。WAF 冷卻中會 reject。
     * @param {string} [url]
     * @returns {Promise<void>}
     */
    async acquire(url = '') {
        const task = this.queue.then(async () => {
            const current = this.now();
            if (current < this.cooldownUntil) {
                const retryAfterMs = this.cooldownUntil - current;
                const error = new Error(`TikTok WAF cooldown (${Math.ceil(retryAfterMs / 1000)}s)`);
                error.code = 'TIKTOK_WAF_COOLDOWN';
                error.retryAfterMs = retryAfterMs;
                throw error;
            }
            const wait = Math.max(0, this.lastNavigationAt + this.minIntervalMs - current);
            if (wait > 0) await this.sleep(wait);
            this.lastNavigationAt = this.now();
            this.count += 1;
            this.logger.log?.(`[TikTokGuard] navigation #${this.count}: ${url}`);
        });
        this.queue = task.catch(() => {});
        return task;
    }

    /**
     * 記錄導航結果；403／429／451 會啟動冷卻。
     * @param {number|null} status
     * @param {string} [url]
     */
    record(status, url = '') {
        this.lastStatus = status;
        if ([403, 429, 451].includes(Number(status))) {
            this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + this.wafCooldownMs);
            this.logger.warn?.(`[TikTokGuard] ${status} on ${url}; pausing TikTok navigation for ${Math.round(this.wafCooldownMs / 1000)}s`);
        }
    }

    /** @returns {{count:number,lastStatus:number|null,cooldownRemainingMs:number}} */
    state() {
        return {
            count: this.count,
            lastStatus: this.lastStatus,
            cooldownRemainingMs: Math.max(0, this.cooldownUntil - this.now())
        };
    }
}
