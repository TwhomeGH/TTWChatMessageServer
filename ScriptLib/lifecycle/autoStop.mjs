/**
 * 所有支援結束偵測的平台都結束後，經過寬限期自動停止程序。
 * 只處理明確的「直播結束／離線」訊號，不把一般斷線當成結束。
 */

/**
 * 建立自動停止管理器。
 * @param {Object} [options]
 * @param {boolean} [options.enabled=false] 是否啟用（設定開關）。
 * @param {string[]} [options.platforms=[]] 有可靠結束訊號的平台。
 * @param {string[]} [options.blocked=[]] 同時啟用但沒有可靠結束訊號的平台；非空時不自動停止。
 * @param {number} [options.graceMs=60000] 全部結束後等待多久才停止。
 * @param {() => void} [options.onStop] 真正停止時呼叫。
 * @param {(message: string) => void} [options.log] 日誌輸出。
 * @param {(fn: Function, ms: number) => any} [options.setTimeout] 注入計時器（測試用）。
 * @param {(id: any) => void} [options.clearTimeout] 注入取消計時器（測試用）。
 * @returns {Object} markLive／markEnded／state／dispose。
 */
export function createAutoStop({
    enabled = false,
    platforms = [],
    blocked = [],
    graceMs = 60000,
    onStop = () => {},
    log = () => {},
    setTimeout: schedule = setTimeout,
    clearTimeout: cancel = clearTimeout
} = {}) {
    const states = new Map(platforms.map(platform => [platform, 'live']));
    let timer = null;
    let stopped = false;
    let sawLive = false;
    const active = enabled && platforms.length > 0 && blocked.length === 0;

    if (enabled && blocked.length > 0) {
        log(`自動停止未啟用：${blocked.join('、')} 沒有可靠的結束訊號`);
    }

    const allEnded = () => active && sawLive && platforms.every(platform => states.get(platform) === 'ended');

    const clear = reason => {
        if (!timer) return;
        cancel(timer);
        timer = null;
        log(`自動停止已取消：${reason}`);
    };

    const scheduleStop = () => {
        if (!active || stopped || timer || !allEnded()) return;
        const seconds = Math.round(graceMs / 1000);
        log(`所有平台已結束，${seconds} 秒後自動停止`);
        timer = schedule(() => {
            timer = null;
            if (stopped || !allEnded()) return;
            stopped = true;
            log('自動停止程序');
            onStop();
        }, graceMs);
    };

    return {
        /** 平台恢復直播時取消倒數。 */
        markLive(platform) {
            if (!states.has(platform)) return;
            sawLive = true;
            states.set(platform, 'live');
            clear(`${platform} 恢復直播`);
        },
        /** 平台明確結束時檢查是否全部結束。 */
        markEnded(platform) {
            if (!states.has(platform)) return;
            states.set(platform, 'ended');
            scheduleStop();
        },
        /** 目前各平台狀態（測試與診斷用）。 */
        state() {
            return Object.fromEntries(states);
        },
        /** 停止管理器，不再觸發自動停止。 */
        dispose() {
            clear('管理器關閉');
            stopped = true;
        }
    };
}
