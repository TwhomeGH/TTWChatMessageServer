/**
 * Twitch EventSub 事件處理（觀眾數、錯誤、開台／關台、追蹤、小奇點）。
 *
 * 所有副作用（推播、socket、寫日誌、合併觀眾數、剪輯重置、頭像查詢）都由 `deps` 注入，
 * 模組本身不直接依賴 TikTok.js 的全域狀態，方便測試與重用。
 */

/**
 * @typedef {Object} TwitchEventDeps
 * @property {() => (Object|null)} getAutoClip 取得自動剪輯管理器（尚未建立時為 null）。
 * @property {(data: Object) => void} reportTraffic 回報流量事件。
 * @property {(file: string, message: string, type?: string) => void} writeLog 寫入日誌檔。
 * @property {(title: string, body: string, icon?: string, url?: string) => Promise<void>} notify 推播通知。
 * @property {(text: string) => void} sendSystem 送出一則系統訊息到 socket。
 * @property {(user: string, text: string, icon: string) => void} sendNotice 送出一則使用者訊息到 socket。
 * @property {(count: number) => void} setViewerCount 更新 Twitch 觀眾數。
 * @property {() => void} updateCombinedViewerCount 重算合併觀眾數並送出。
 * @property {(userId: string) => Promise<string>} getUserIcon 取得使用者頭像 URL。
 * @property {Console} [logger=console]
 */

/**
 * 觀眾數更新（輪詢由 ScriptLib/twitch/client.mjs 負責）。
 * @param {{viewers: number, id?: (string|number), startDate?: Date}|null} stream
 * @param {TwitchEventDeps} deps
 * @returns {void}
 */
export function onViewer(stream, deps) {
    if (!stream) { deps.getAutoClip()?.reset(); return; }
    deps.setViewerCount(stream.viewers);
    deps.reportTraffic({ platform: 'Twitch', type: 'audience', userNum: stream.viewers, streamId: stream.id != null ? String(stream.id) : undefined, startedAt: stream.startDate?.toISOString() });
    deps.getAutoClip()?.updateViewers(stream.viewers);
    const DA = new Date();
    deps.logger.log(`📊 Twitch 觀眾數: ${stream.viewers} ${DA.toLocaleString()}`);
    deps.writeLog("Default", `Twitch 觀眾數: ${stream.viewers} ${DA.toLocaleString()}`, "Twitch View");
    deps.updateCombinedViewerCount();
}

/**
 * EventSub listener 錯誤處理。
 * @param {Error} err
 * @param {TwitchEventDeps} deps
 * @returns {void}
 */
export function onError(err, deps) {
    deps.getAutoClip()?.reset();
    deps.logger.error('⚠️ Twitch EventSub Listener error:', err);

    deps.writeLog("Default", `Twitch EventSub Listener error: ${err.message || err}`, "Error");

    deps.notify("Twitch 事件監聽錯誤", `Twitch EventSub Listener error: ${err.message || err}`, "");
    deps.sendSystem(`Twitch 事件監聽錯誤: ${err.message || err}`);
}

/**
 * 直播開始。
 * @param {{broadcasterName: string, type: string}} event
 * @param {TwitchEventDeps} deps
 * @returns {Promise<void>}
 */
export async function onStreamOnline(event, deps) {
    const message = `直播開始啦！標題：${event.broadcasterName} ${event.type}`;

    deps.logger.log(message);
    await deps.notify("直播開始啦！", `${event.broadcasterName} ${event.type}`, "");
    deps.sendSystem(message);

    deps.writeLog("Default", message, "Twitch Stream Status");
}

/**
 * 直播結束。
 * @param {{broadcasterName: string}} event
 * @param {TwitchEventDeps} deps
 * @returns {Promise<void>}
 */
export async function onStreamOffline(event, deps) {
    deps.getAutoClip()?.reset();
    const message = `直播結束啦！標題：${event.broadcasterName}`;

    deps.logger.log(message);

    await deps.notify("直播結束啦！", `${event.broadcasterName}`, "");
    deps.sendSystem(message);

    deps.writeLog("Default", message, "Twitch Stream Status");
}

/**
 * 新追蹤。
 * @param {{userId: string, userDisplayName: string}} event
 * @param {TwitchEventDeps} deps
 * @returns {Promise<void>}
 */
export async function onFollow(event, deps) {
    const icon = await deps.getUserIcon(event.userId);
    const message = `關注了主播`;

    deps.logger.log(message);

    await deps.notify(event.userDisplayName, "關注了主播", icon);

    deps.sendNotice(event.userDisplayName, message, icon);

    deps.writeLog("Default", `${event.userDisplayName} ${message}`, "Twitch Follow");
}

/**
 * 小奇點（bits）。
 * @param {{userId: string, userDisplayName: string, bits: number}} event
 * @param {TwitchEventDeps} deps
 * @returns {Promise<void>}
 */
export async function onCheer(event, deps) {
    const message = `送出 ${event.bits} 小奇點`;
    const icon = await deps.getUserIcon(event.userId);

    deps.logger.log(`${event.userDisplayName} ${message}`);

    await deps.notify(event.userDisplayName, message, icon);
    deps.sendNotice(event.userDisplayName, message, icon);

    deps.writeLog("Default", `${event.userDisplayName} ${message}`, "Twitch Cheer");
}
