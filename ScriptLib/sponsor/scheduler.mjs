/**
 * 贊助廣告定時器：依 `intervalMinutes` 週期性把廣告送到疊加層並推播通知。
 * 送出動作（deliver）與通知（notify）由呼叫端注入，模組本身不直接依賴 socket／推播層。
 */

/** @typedef {import('./store.mjs').SponsorStore} SponsorStore */

/**
 * @typedef {Object} AdScheduler
 * @property {(adId: string, userId: string, intervalMinutes: number, adData: Object) => void} schedule 設定（或重設）某廣告的週期定時器。
 * @property {(adId: string) => void} clear 清除單一廣告的定時器。
 * @property {() => void} clearAll 清除所有定時器。
 * @property {() => void} resume 啟動時依 lastSentAt 恢復有效廣告的定時器。
 */

/**
 * 建立贊助廣告排程器。
 * @param {Object} deps
 * @param {(user: string, text: string, iconURL: string, useTTS: boolean) => void} deps.deliver 把廣告送到疊加層。
 * @param {(title: string, body: string, icon: string, url: string) => Promise<void>} deps.notify 推播通知。
 * @param {SponsorStore} deps.store 贊助廣告資料。
 * @param {string} deps.manageUrl 贊助管理頁網址（通知點擊用）。
 * @param {number} [deps.minIntervalMinutes=15] 最小間隔（分鐘）。
 * @param {Console} [deps.logger=console]
 * @returns {AdScheduler}
 */
export function createAdScheduler({ deliver, notify, store, manageUrl, minIntervalMinutes = 15, logger = console }) {
    const timers = {};

    /**
     * 清除單一廣告的定時器。
     * @param {string} adId
     * @returns {void}
     */
    function clear(adId) {
        if (timers[adId]) {
            clearTimeout(timers[adId]);
            delete timers[adId];
        }
    }

    /**
     * 清除所有定時器。
     * @returns {void}
     */
    function clearAll() {
        for (const adId of Object.keys(timers)) {
            clearTimeout(timers[adId]);
            delete timers[adId];
        }
    }

    /**
     * 設定（或重設）某廣告的週期定時器；間隔不足 minIntervalMinutes 時不排程。
     * @param {string} adId
     * @param {string} userId
     * @param {number} intervalMinutes
     * @param {{overlayUser: string, text: string, iconURL: string, useTTS: boolean}} adData
     * @returns {void}
     */
    function schedule(adId, userId, intervalMinutes, adData) {
        clear(adId);
        if (!intervalMinutes || intervalMinutes < minIntervalMinutes) return;
        const ms = intervalMinutes * 60 * 1000;
        timers[adId] = setTimeout(() => {
            try {
                const now = new Date().toISOString();
                logger.log(`⏰ 贊助廣告定時觸發: ${adData.overlayUser} - ${adData.text}`);
                deliver(adData.overlayUser, adData.text, adData.iconURL, adData.useTTS);
                notify(`⏰ 贊助廣告 (${adData.overlayUser})`, adData.text, adData.iconURL || '', manageUrl);
                // 在定時器 callback 內更新 lastSentAt，確保寫入的是實際觸發時間
                const sponsor = store.state.users[userId];
                if (sponsor) {
                    const ad = sponsor.ads.find(a => a.id === adId);
                    if (ad) {
                        ad.lastSentAt = now;
                        ad.intervalMinutes = intervalMinutes;
                        logger.log(`📝 贊助廣告 lastSentAt 已更新: ${adId} -> ${now} (${new Date(now).toLocaleString()})`);
                    }
                    store.save();
                }
                schedule(adId, userId, intervalMinutes, adData);
            } catch (err) {
                logger.error(`❌ 贊助廣告定時器錯誤: ${err.message}`);
            }
        }, ms);
        logger.log(`⏰ 已設定贊助廣告定時器: ${adId} (${Math.round(ms / 60000)} 分鐘後, 預計 ${new Date(Date.now() + ms).toLocaleString()} 發送)`);
    }

    /**
     * 啟動時恢復所有有效廣告的定時器。
     * @returns {void}
     */
    function resume() {
        clearAll();
        let count = 0;
        const now = Date.now();
        for (const uid of Object.keys(store.state.users)) {
            for (const ad of store.state.users[uid].ads) {
                if (!ad.enabled || !ad.intervalMinutes || ad.intervalMinutes < minIntervalMinutes || ad.approved === false) continue;
                let delayMs;
                if (ad.lastSentAt) {
                    const nextMs = new Date(ad.lastSentAt).getTime() + ad.intervalMinutes * 60 * 1000;
                    delayMs = Math.max(0, nextMs - now);
                    if (delayMs === 0) {
                        // 已錯過發送時間，從現在起算下個週期
                        delayMs = ad.intervalMinutes * 60 * 1000;
                    }
                } else {
                    delayMs = ad.intervalMinutes * 60 * 1000;
                }
                clear(ad.id);
                timers[ad.id] = setTimeout(() => {
                    try {
                        logger.log(`⏰ 贊助廣告定時觸發(恢復): ${ad.overlayUser} - ${ad.message}`);
                        deliver(ad.overlayUser, ad.message, ad.iconURL || '', ad.useTTS);
                        notify(`⏰ 贊助廣告 (${ad.overlayUser})`, ad.message, ad.iconURL || '', manageUrl);
                        ad.lastSentAt = new Date().toISOString();
                        store.save();
                        schedule(ad.id, uid, ad.intervalMinutes, {
                            overlayUser: ad.overlayUser, text: ad.message, iconURL: ad.iconURL || '', useTTS: ad.useTTS
                        });
                    } catch (err) {
                        logger.error(`❌ 贊助廣告恢復定時器錯誤: ${err.message}`);
                    }
                }, delayMs);
                count++;
                const eta = new Date(Date.now() + delayMs);
                logger.log(`⏰ 已恢復贊助廣告定時器: ${ad.id} (${Math.round(delayMs / 60000)} 分鐘後, 預計 ${eta.toLocaleString()} 發送)`);
            }
        }
        if (count > 0) logger.log(`⏰ 恢復了 ${count} 個贊助廣告定時器`);
    }

    return { schedule, clear, clearAll, resume };
}
