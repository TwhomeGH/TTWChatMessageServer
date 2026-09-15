/** 以兩次取樣間隔計算程序 CPU；100% 等於一個核心，RSS 包含原生記憶體。 */
function createSampler(proc = process, clock = () => performance.now()) {
    let previous = proc.cpuUsage(), time = clock();
    return () => {
        const current = proc.cpuUsage(), now = clock(), elapsed = now - time;
        const cpuPercent = elapsed > 0 ? Math.max(0, (current.user + current.system - previous.user - previous.system) / (elapsed * 10)) : 0;
        previous = current; time = now;
        return { cpuPercent, rssBytes: proc.memoryUsage().rss };
    };
}
/** 僅 IPC 子程序啟用，背壓時跳過傳送，避免監控累積佇列。 */
function startReporting(proc = process) {
    if (typeof proc.send !== 'function') return;
    const sample = createSampler(proc);
    let pending = false;
    const timer = setInterval(() => {
        if (!proc.connected || pending) return;
        pending = true;
        try { proc.send({ type: 'RUNTIME_RESOURCES', ...sample() }, () => { pending = false; }); }
        catch { pending = false; }
    }, 2000);
    timer.unref();
    proc.once('disconnect', () => clearInterval(timer));
}
module.exports = { createSampler, startReporting };
