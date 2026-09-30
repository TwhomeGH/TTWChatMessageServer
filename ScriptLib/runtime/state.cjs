/** 子程序生命週期快照；不將 spawn 成功誤認為平台登入或收訊成功。 */
class RuntimeState {
    constructor(now = Date.now, options = {}) {
        this.now = now;
        this.stopTimeoutMs = options.stopTimeoutMs ?? 15000;
        this.logger = options.logger || null;
        this._stopTimer = null;
        this.child = null;
        this.data = { state: 'stopped', pid: null, startedAt: null, stoppedAt: null, stopRequestedAt: null, exitCode: null, signal: null, error: null, platforms: [] };
    }
    _log(...parts) {
        if (this.logger) this.logger(...parts);
    }
    /**
     * 綁定本次子程序；過去程序的遲到事件不會覆寫新狀態。
     * @param {import('node:child_process').ChildProcess} child
     * @param {string[]} [platforms=[]] 本次啟用的平台。
     * @returns {void}
     */
    attach(child, platforms = []) {
        this.child = child;
        this.resources = null;
        child.on('message', message => {
            if (this.child !== child || message?.type !== 'RUNTIME_RESOURCES') return;
            if (!Number.isFinite(message.cpuPercent) || message.cpuPercent < 0 || !Number.isFinite(message.rssBytes) || message.rssBytes < 0) return;
            this.resources = { cpuPercent: message.cpuPercent, rssBytes: message.rssBytes, sampledAt: this.now() };
        });
        this.data = { state: 'starting', pid: null, startedAt: null, stoppedAt: null, stopRequestedAt: null, exitCode: null, signal: null, error: null, platforms: [...platforms] };
        child.once('spawn', () => {
            if (this.child !== child) return;
            this.data.pid = child.pid;
            this.data.startedAt = this.now();
            if (this.data.state !== 'stopping') this.data.state = 'running';
        });
        child.once('error', error => {
            if (this.child !== child) return;
            this.clearStopTimer();
            this.data.error = error.code || 'PROCESS_ERROR';
            this.data.state = 'failed';
            this.data.stoppedAt = this.now();
        });
        child.once('exit', (code, signal) => {
            if (this.child !== child) return;
            this.clearStopTimer();
            const expected = this.data.state === 'stopping';
            this.data.state = this.data.error || (!expected && (code !== 0 || signal)) ? 'failed' : 'stopped';
            Object.assign(this.data, { pid: null, stoppedAt: this.now(), exitCode: code, signal });
            this.child = null;
        });
    }
    clearStopTimer() {
        if (this._stopTimer) {
            clearTimeout(this._stopTimer);
            this._stopTimer = null;
        }
    }
    /**
     * 逾時強制終止：EXIT 只是請求，若子程序卡在收尾（網路／Puppeteer），
     * 就必須在 stopTimeoutMs 後 SIGKILL，否則永遠停在 stopping 且無法重啟。
     */
    _armStopTimer(child) {
        this.clearStopTimer();
        if (!this.stopTimeoutMs) return;
        this._stopTimer = setTimeout(() => {
            this._stopTimer = null;
            if (this.child !== child) return;
            this._log(`[RUNTIME] 停止逾時 ${this.stopTimeoutMs}ms，強制終止 PID=${child.pid}`);
            let killed = false;
            try {
                killed = child.kill('SIGKILL');
            } catch (error) {
                this._log('[RUNTIME] 強制終止失敗:', error.code || error.message);
            }
            if (!killed && this.child === child) {
                this.data.error = 'STOP_KILL_FAILED';
                this.data.state = 'failed';
            }
        }, this.stopTimeoutMs);
        if (typeof this._stopTimer.unref === 'function') this._stopTimer.unref();
    }
    /**
     * 送出 EXIT 請求停止子程序（重複呼叫不重送）；寫入失敗仍保留實際程序狀態。
     * @param {import('node:child_process').ChildProcess} child
     * @returns {void}
     */
    stop(child) {
        if (!child || this.data.state === 'stopping') return;
        const previous = this.data.state;
        this.data.state = 'stopping';
        this.data.stopRequestedAt = this.now();
        const failed = error => {
            if (error && this.child === child) {
                this.clearStopTimer();
                this.data.state = previous;
                this.data.error = error.code || 'STOP_WRITE_FAILED';
                this.data.stopRequestedAt = null;
            }
        };
        const written = error => {
            if (error) return failed(error);
            this._armStopTimer(child);
        };
        try { child.stdin.write('EXIT\n', written); } catch (error) { failed(error); }
    }
    /**
     * 取得目前狀態快照（含資源取樣、uptime 與停止延遲標記）。
     * @returns {Object}
     */
    snapshot() {
        return { ...this.data, resources: this.child && ['running', 'stopping'].includes(this.data.state) && this.resources && this.now() - this.resources.sampledAt <= 10000 ? { ...this.resources } : null, platforms: [...this.data.platforms],
            uptimeMs: this.data.startedAt === null ? 0 : Math.max(0, (this.data.stoppedAt ?? this.now()) - this.data.startedAt),
            stopDelayed: this.data.state === 'stopping' && this.now() - this.data.stopRequestedAt >= 15000 };
    }
}
module.exports = { RuntimeState };
