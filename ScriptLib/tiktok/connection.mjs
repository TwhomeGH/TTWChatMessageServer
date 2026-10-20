/**
 * TikTok 連線生命週期：連線後的初始化、觀眾數輪詢（viewCache）與斷線自動重連。
 *
 * 狀態（roomId、重連次數、計時器、連續失敗次數）封裝在實例內；與其他模組互動的全域狀態
 * （觀眾數、快取）與副作用（推播、socket、日誌、統計、剪輯、退出）都以 `deps` 注入。
 */

import { roomStartTime, createStartTimeProbe } from './viewers.mjs';

/**
 * @typedef {Object} TikTokConnectionDeps
 * @property {() => Object} getConnection 取得 TikTokLiveConnection。
 * @property {string} tiktokName 直播間名稱。
 * @property {boolean} isTK 是否啟用 TikTok（合併觀眾數用）。
 * @property {boolean} isTwitch 是否啟用 Twitch（合併觀眾數用）。
 * @property {() => number} getTwitchViewerCount 取得 Twitch 觀眾數。
 * @property {(n: number) => void} setTikTokViewerCount 設定 TikTok 觀眾數。
 * @property {(n: number) => void} setCacheUserNum 設定合併觀眾數。
 * @property {() => number} getCacheUserNum 取得合併觀眾數（日誌用）。
 * @property {() => Array} getCacheUserList 取得用戶清單（日誌用）。
 * @property {() => void} updateCombinedViewerCount 重算合併觀眾數並送出。
 * @property {(title: string, body: string, icon?: string, url?: string) => Promise<void>} notify 推播通知。
 * @property {(text: string) => void} sendSystem 送出系統訊息到 socket。
 * @property {(file: string, message: string, type?: string) => void} writeLog 寫入日誌檔。
 * @property {(data: Object) => void} reportTraffic 回報流量事件。
 * @property {() => (Object|null)} getAutoClip 取得自動剪輯管理器。
 * @property {{beginReconnect: Function}} tikTokChatGuard 聊天守衛。
 * @property {{resume: Function}} adScheduler 贊助廣告排程器。
 * @property {() => void} handleExit 收尾退出。
 * @property {() => boolean} isEnd 是否已進入結束流程。
 * @property {() => boolean} getStreamEnded 直播是否已真正結束（不再重連）。
 * @property {() => void} [onLive] 連線成功（初次或重連）時通知。
 * @property {number} [retryBase=15000] 重連基礎間隔（ms）。
 * @property {number} [retryMax=5] 最大重連次數。
 * @property {number} [viewCacheIntervalMs=30000] 觀眾數輪詢間隔（ms）。
 * @property {Console} [logger=console]
 */

/**
 * 建立 TikTok 連線管理器。
 * @param {TikTokConnectionDeps} deps
 * @returns {{onConnected: Function, scheduleReconnect: Function, cancelReconnect: Function, stopViewCache: Function, stop: Function, getRoomId: Function}}
 */
export function createTikTokConnectionManager(deps) {
    const {
        getConnection, tiktokName, isTK, isTwitch, getTwitchViewerCount,
        setTikTokViewerCount, setCacheUserNum, getCacheUserNum, getCacheUserList,
        updateCombinedViewerCount, notify, sendSystem, writeLog, reportTraffic,
        getAutoClip, tikTokChatGuard, adScheduler, handleExit, isEnd, getStreamEnded, onLive,
        retryBase = 15000, retryMax = 5, viewCacheIntervalMs = 30000, logger = console
    } = deps;

    let roomId = "";
    let retryCount = 0;
    let retryTimer = null;
    let viewInterval = null;
    let viewFailures = 0;
    let writeViewCount = 0;
    let writeDebugView = false;
    const startTimeProbe = createStartTimeProbe(logger);

    /** 抓取房資更新觀眾數（由 viewCache 計時器週期呼叫）。 */
    function fetchViewers() {
        logger.log("📊 CacheUserNum:", getCacheUserNum());
        logger.log("📋 CacheUserList:", getCacheUserList());

        getConnection().fetchRoomInfo(roomId).then(async (roomInfo) => {
            viewFailures = 0;
            const Viewer = roomInfo.data.user_count;

            if (writeViewCount > 100 && writeDebugView) {
                writeLog("Default", `DEBUG View:\n${JSON.stringify(roomInfo)}`, "View統計");
                logger.log("🔄 更新觀眾數量 寫入Debug_RoomInfo數據:", Viewer);
                writeViewCount = 0;
            }

            writeViewCount += 1;
            const startedAt = roomStartTime(roomInfo);
            startTimeProbe.probe(roomInfo, startedAt);
            reportTraffic({ platform: 'TikTok', type: 'audience', userNum: Number(Viewer), streamId: roomId != null ? String(roomId) : undefined, startedAt });
            getAutoClip()?.updatePlatformViewers('TikTok', Number(Viewer));
            setTikTokViewerCount(Viewer);
            updateCombinedViewerCount();

        }).catch(err => {
            viewFailures += 1;
            logger.log(`RoomError（連續 ${viewFailures} 次，觀看數不會更新）:`, err.message);
        });
    }

    /**
     * 連線成功後的共同初始化（初次連線與重連共用）。
     * @param {{roomId: string}} state
     * @returns {void}
     */
    function onConnected(state) {
        retryCount = 0;
        onLive?.();
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        roomId = state.roomId;
        const info = getConnection().state.roomInfo.data;
        const title = info.title || "未知直播間";
        const viewerCount = info.user_count || 0;
        setTikTokViewerCount(viewerCount);
        setCacheUserNum((isTK && isTwitch) ? viewerCount + getTwitchViewerCount() : viewerCount);
        notify("TikTok 直播間連線成功", `已連接到 ${tiktokName} 的直播間 ${title}`, "");
        sendSystem(`TikTok 直播間連線成功，已連接到 ${tiktokName} 的直播間 ${title}`);
        adScheduler.resume();
        if (!viewInterval) {
            viewInterval = setInterval(fetchViewers, viewCacheIntervalMs);
        }
    }

    /** 清除排程中的重連計時器。 */
    function cancelReconnect() {
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    }

    /** 停止觀眾數輪詢。 */
    function stopViewCache() {
        if (viewInterval) { clearInterval(viewInterval); viewInterval = null; }
    }

    /** 停止所有計時器（收尾用）。 */
    function stop() {
        cancelReconnect();
        stopViewCache();
    }

    /**
     * 斷線／連線失敗後的自動重連：指數退避 + 有限次數，次數用盡則優雅退出。
     * @returns {void}
     */
    function scheduleReconnect() {
        if (isEnd() || getStreamEnded()) return;
        if (retryTimer) return; // 已有排程，避免重複
        if (retryCount >= retryMax) {
            logger.error(`❌ TikTok 已達最大重連次數 (${retryMax})，停止重連並退出`);
            sendSystem("TikTok 重連已達上限，程式停止，請手動重新啟動");
            notify("TikTok 重連失敗", "已達最大重連次數，程式停止", "");
            handleExit();
            return;
        }
        retryCount += 1;
        const delay = Math.min(retryBase * Math.pow(2, retryCount - 1), 300000);
        logger.log(`🔁 TikTok 斷線，${Math.round(delay / 1000)} 秒後嘗試重新連線 (${retryCount}/${retryMax})...`);
        sendSystem(`TikTok 斷線，${Math.round(delay / 1000)} 秒後嘗試重新連線 (${retryCount}/${retryMax})`);
        retryTimer = setTimeout(() => {
            retryTimer = null;
            if (isEnd() || getStreamEnded()) return;
            tikTokChatGuard.beginReconnect();
            getConnection().connect().then(state => {
                logger.info(`✅ TikTok 重新連線成功，roomId ${state.roomId}`);
                onConnected(state);
            }).catch(err => {
                const errDetail = err.exception || err;
                logger.error(`❌ TikTok 重連失敗: ${errDetail.message || errDetail} (${retryCount}/${retryMax})`);
                sendSystem(`TikTok 重連失敗: ${String(errDetail.message || errDetail).substring(0, 80)}`);
                scheduleReconnect(); // 遞迴進入下一次退避
            });
        }, delay);
    }

    return { onConnected, scheduleReconnect, cancelReconnect, stopViewCache, stop, getRoomId: () => roomId };
}
