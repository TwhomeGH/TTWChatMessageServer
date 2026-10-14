// 把已送出的 socket payload 鏡像回父程序（供 WebUI 監控面板）。
// 與 ScriptLib/traffic/report.mjs 相同策略：只在 IPC 可用且未積壓時送出，
// 避免大量聊天把 IPC 通道灌爆。

/**
 * 建立監控鏡像器。
 * @param {Object} [options]
 * @param {number} [options.limit=200] 同時未完成的 IPC 傳送上限。
 * @param {(message: object, callback?: () => void) => void} [options.send] 送出函式（預設 process.send）。
 * @param {() => boolean} [options.isConnected] 回報 IPC 是否可用（預設檢查 process.send／process.connected）。
 * @returns {{forward: (payload: object) => boolean}} 鏡像器；forward 回傳是否已排入。
 */
export function createMonitorRelay({
    limit = 200,
    send,
    isConnected = () => typeof process.send === 'function' && process.connected === true
} = {}) {
    const sendFn = send || ((message, callback) => process.send(message, callback));
    let pending = 0;

    return {
        forward(payload) {
            if (pending >= limit) return false;
            if (!isConnected()) return false;
            pending++;
            try {
                sendFn({ type: 'STREAM_MESSAGE', data: payload }, () => { pending--; });
                return true;
            } catch {
                pending--;
                return false;
            }
        }
    };
}
