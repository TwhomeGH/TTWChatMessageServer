/** 子程序生命週期快照；不將 spawn 成功誤認為平台登入或收訊成功。 */
class RuntimeState {
    constructor(now = Date.now) {
        this.now = now;
        this.child = null;
        this.data = { state: 'stopped', pid: null, startedAt: null, stoppedAt: null, stopRequestedAt: null, exitCode: null, signal: null, error: null, platforms: [] };
    }
    /** 綁定本次程序，過去程序的遲到事件不可覆寫新狀態。 */
    attach(child, platforms = []) {
        this.child = child;
        this.data = { state: 'starting', pid: null, startedAt: null, stoppedAt: null, stopRequestedAt: null, exitCode: null, signal: null, error: null, platforms: [...platforms] };
        child.once('spawn', () => {
            if (this.child !== child) return;
            this.data.pid = child.pid;
            this.data.startedAt = this.now();
            if (this.data.state !== 'stopping') this.data.state = 'running';
        });
        child.once('error', error => {
            if (this.child !== child) return;
            this.data.error = error.code || 'PROCESS_ERROR';
            this.data.state = 'failed';
            this.data.stoppedAt = this.now();
        });
        child.once('exit', (code, signal) => {
            if (this.child !== child) return;
            const expected = this.data.state === 'stopping';
            this.data.state = this.data.error || (!expected && (code !== 0 || signal)) ? 'failed' : 'stopped';
            Object.assign(this.data, { pid: null, stoppedAt: this.now(), exitCode: code, signal });
            this.child = null;
        });
    }
    /** 重複停止不重送 EXIT；寫入失敗仍保留實際程序狀態。 */
    stop(child) {
        if (!child || this.data.state === 'stopping') return;
        const previous = this.data.state;
        this.data.state = 'stopping';
        this.data.stopRequestedAt = this.now();
        const failed = error => {
            if (error && this.child === child) {
                this.data.state = previous;
                this.data.error = error.code || 'STOP_WRITE_FAILED';
                this.data.stopRequestedAt = null;
            }
        };
        try { child.stdin.write('EXIT\n', failed); } catch (error) { failed(error); }
    }
    snapshot() {
        return { ...this.data, platforms: [...this.data.platforms],
            uptimeMs: this.data.startedAt === null ? 0 : Math.max(0, (this.data.stoppedAt ?? this.now()) - this.data.startedAt),
            stopDelayed: this.data.state === 'stopping' && this.now() - this.data.stopRequestedAt >= 15000 };
    }
}
module.exports = { RuntimeState };
