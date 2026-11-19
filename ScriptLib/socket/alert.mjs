/**
 * Socket 連線異常通知策略。
 *
 * Socket 目標暫時離線時，傳輸層會一直重試；這裡只在連續失敗達到門檻後，
 * 透過其他仍可用的通知通道提醒使用者「主服務還在跑」，避免每分鐘洗版。
 * 同一端點成功重連後清除狀態；再次離線會重新累計。
 */

/**
 * 建立通知策略。
 * @param {Object} options
 * @param {(title: string, comment: string) => Promise<Array<{channel: string, ok: boolean}>>} options.notify
 * @param {() => string[]} [options.channels] 目前可用的其他通知通道；空陣列時不發送。
 * @param {number} [options.threshold=5] 連續失敗幾次後通知。
 * @param {number} [options.repeatMs=21600000] 同一次離線的最短重複通知間隔；0 表示只通知一次。
 * @param {Console} [options.logger=console]
 * @param {() => number} [options.now=Date.now]
 * @returns {{ failure: (info: Object) => void, recovery: (info: Object) => void, clear: () => void }}
 */
export function createSocketAlertPolicy({ notify, channels = () => [], threshold = 5,
    repeatMs = 6 * 60 * 60 * 1000, logger = console, now = Date.now } = {}) {
    const states = new Map();
    const minimum = Math.max(1, Number(threshold) || 1);
    const repeat = Number.isFinite(Number(repeatMs)) && Number(repeatMs) >= 0
        ? Number(repeatMs) : 6 * 60 * 60 * 1000;

    const keyOf = info => `${info?.host || '?'}:${info?.port || '?'}`;

    /**
     * 傳輸層每次重連失敗時呼叫。
     * @param {Object} info
     * @param {string} [info.host]
     * @param {number} [info.port]
     * @param {number} [info.retries] 連續失敗次數。
     * @param {number} [info.reconnects] 累計重連次數。
     * @param {number} [info.queued] 目前待送佇列。
     * @param {number} [info.dropped] 已丟棄訊息數。
     * @param {string} [info.error] 最後錯誤訊息。
     * @returns {void}
     */
    function failure(info = {}) {
        const retries = Number(info.retries) || 0;
        if (retries < minimum) return;

        const activeChannels = typeof channels === 'function' ? channels() : [];
        if (!Array.isArray(activeChannels) || !activeChannels.length) return;

        const key = keyOf(info);
        const at = now();
        const state = states.get(key) || { lastAlertAt: 0 };
        // repeat=0 代表同一次離線只提醒一次；成功重連後 recovery 會清除狀態。
        if (state.lastAlertAt && (repeat === 0 || at - state.lastAlertAt < repeat)) return;

        state.lastAlertAt = at;
        states.set(key, state);

        const target = key;
        const attemptText = `${retries} 次`;
        const queueText = `待送 ${Number(info.queued) || 0} 則、已丟棄 ${Number(info.dropped) || 0} 則、累計重連 ${Number(info.reconnects) || 0} 次`;
        const errorText = info.error ? `最後錯誤：${info.error}。` : '';
        const message = `Socket 端點 ${target} 已連續 ${attemptText}無法連線。${errorText}`
            + 'TTW 主服務仍在執行；若已不使用 Socket，請到 Runtime 關閉「Socket／overlay」，'
            + `或確認目標服務是否啟動。（${queueText}）`;

        try {
            const result = notify('TTW Socket 連線異常', message);
            if (result && typeof result.then === 'function') {
                result.then(items => {
                    if (!Array.isArray(items) || !items.length) {
                        logger.warn?.(`[SocketAlert] ${target} 已達重試門檻，但沒有可用的通知通道`);
                    }
                }).catch(error => logger.warn?.(`[SocketAlert] 通知失敗: ${error.message}`));
            }
            logger.warn?.(`[SocketAlert] ${target} 連續失敗 ${retries} 次，已透過其他通道提醒`);
        } catch (error) {
            logger.warn?.(`[SocketAlert] 通知失敗: ${error.message}`);
        }
    }

    /** 連線成功後清除該端點的離線通知狀態。 */
    function recovery(info = {}) {
        states.delete(keyOf(info));
    }

    /** 執行中關閉 Socket 時清除所有狀態。 */
    function clear() {
        states.clear();
    }

    return { failure, recovery, clear };
}
