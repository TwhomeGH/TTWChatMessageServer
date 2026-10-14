/**
 * Twitch 聊天處理：G#Ad 贊助廣告指令、G#clip 剪輯指令，以及一般聊天轉發。
 *
 * 所有副作用（推播、socket、過濾、統計、贊助資料、剪輯、翻譯、日誌）都以 `deps` 注入；
 * `apiClient`／`tuser` 為啟動後才設定的 live binding，故以 getter 於呼叫當下取值。
 */

/**
 * @typedef {Object} TwitchChatDeps
 * @property {() => Object} getApiClient 取得目前 Twitch ApiClient。
 * @property {() => string} getTuser 取得目前頻道 UserID。
 * @property {(userId: string) => Promise<string>} getUserIcon 取得使用者頭像 URL。
 * @property {(title: string, body: string, icon?: string, url?: string) => Promise<void>} notify 推播通知。
 * @property {(user: string, message: string, icon: string) => void} sendChat 送出聊天訊息到 socket（isMain）。
 * @property {(user: string, message: string, icon?: string, giftImg?: string, isMain?: boolean) => void} sendAd 直接把文字送到疊加層（AdOverlay）。
 * @property {(file: string, message: string, type?: string) => void} writeLog 寫入日誌檔。
 * @property {(data: Object) => void} reportTraffic 回報流量事件。
 * @property {(fr: Object, meta: Object) => void} reportFiltered 回報被過濾的訊息。
 * @property {(msg: Object) => Object} processFilter 套用過濾規則。
 * @property {(message: string, meta: Object) => boolean} recordChatHeat 記錄聊天熱度。
 * @property {(text: string) => string} replaceEmojis 取代 emoji shortcode。
 * @property {(text: string) => Promise<string>} translate 翻譯文字。
 * @property {import('../sponsor/store.mjs').SponsorStore} sponsorStore 贊助廣告資料。
 * @property {{clear: Function, schedule: Function}} adScheduler 贊助廣告定時器。
 * @property {string} manageUrl 贊助管理頁網址。
 * @property {import('./clip.mjs').ClipService} clipService 剪輯服務。
 * @property {(name: string, data: Object) => void} logRawEvent 記錄原始事件。
 * @property {Console} [logger=console]
 */

/**
 * 處理一則 Twitch 聊天訊息。
 * @param {{chatterId: string, chatterDisplayName: string, messageText: string, messageId: string}} event
 * @param {TwitchChatDeps} deps
 * @returns {Promise<void>}
 */
export async function onChat(event, deps) {
    const receivedAt = Date.now();
    const icon = await deps.getUserIcon(event.chatterId);

    deps.logger.log(`${event.chatterDisplayName} : ${event.messageText}`);

    // 需要先確認是不是 Twitch 訂閱者（或主播本人）才能使用 G#Ad
    if (event.messageText.startsWith("G#Ad")) {
        const tuser = deps.getTuser();

        if (event.chatterId === tuser) {
            deps.logger.log(`${event.chatterDisplayName} 是主播本人，視同訂閱者可以使用 G#Ad 指令`);
            handleGAd(event, deps, icon);
            return;
        } else {
            let subRes;
            try {
                subRes = await deps.getApiClient().subscriptions.checkUserSubscription(tuser, event.chatterId);
            } catch (err) {
                deps.logger.error(`⚠️ [訂閱檢查] ${event.chatterDisplayName} 查詢失敗: ${err.message} (status=${err.response?.status || 'N/A'})`);
                if (err.response?.status === 404) {
                    deps.logger.log(`   → 使用者 ${event.chatterDisplayName} 未訂閱此頻道（404）`);
                } else if (err.message?.includes('scope')) {
                    deps.logger.warn('   → 缺少 scope: user:read:subscriptions，可透過 Config 重新授權');
                } else {
                    deps.logger.log(`   → 完整錯誤:`, err.response?.data?.message || err.message);
                }
            }
            if (subRes?.isSubscribed) {
                deps.logger.log(`${event.chatterDisplayName} 是訂閱者（${subRes.tier || '?'} 方案, 累計 ${subRes.totalMonths || 0} 月），可以使用 G#Ad 指令`);
                handleGAd(event, deps, icon);
            } else {
                deps.logger.log(`${event.chatterDisplayName} 不是訂閱者（API 回傳 isSubscribed=false），無法使用 G#Ad 指令`);
            }
            return;
        }
    }

    if (event.messageText.startsWith("G#clip")) {
        const tuser = deps.getTuser();

        // 權限檢查：主播本人、訂閱者或追隨者才能建剪輯
        let authorized = event.chatterId === tuser;
        if (!authorized) {
            const subRes = await deps.getApiClient().subscriptions.checkUserSubscription(tuser, event.chatterId).catch(err => {
                deps.logger.error(`⚠️ [G#clip] ${event.chatterDisplayName} 訂閱檢查失敗: ${err.message}`);
                return { isSubscribed: false };
            });
            authorized = !!subRes?.isSubscribed;
        }
        if (!authorized) {
            const follows = await deps.getApiClient().channels.getChannelFollowers(tuser, event.chatterId).catch(err => {
                deps.logger.error(`⚠️ [G#clip] ${event.chatterDisplayName} 追隨檢查失敗: ${err.message}`);
                return { data: [] };
            });
            authorized = follows.data.length > 0;
        }
        if (!authorized) {
            deps.logger.log(`🚫 [G#clip] ${event.chatterDisplayName} 不是主播、訂閱者或追隨者，無法使用 G#clip 指令`);
            return;
        }

        let res = event.messageText.split(" ")
        res.shift() // 去掉 G#clip

        const title = res.length > 0 ? res.join(" ") : null

        deps.clipService.createClip(title, icon);

        return; // 指令已處理，不再當一般訊息轉發
    }

    deps.reportTraffic({ platform: 'Twitch', eventType: 'chat', id: event.messageId, userId: event.chatterId, user: event.chatterDisplayName, message: event.messageText });

    const fr = deps.processFilter({ user: event.chatterDisplayName, message: event.messageText });
    if (fr.blocked) {
        deps.reportFiltered(fr, { platform: 'Twitch', id: event.messageId, userId: event.chatterId, user: event.chatterDisplayName, message: event.messageText });
        deps.logger.log('🚫 過濾器阻擋(Twitch):', event.chatterDisplayName, event.messageText, `(規則: ${fr.reason})`);
        deps.writeLog("Default", `過濾器阻擋(Twitch): ${event.chatterDisplayName} : ${event.messageText} (規則: ${fr.reason})`, "Filter");

        return;
    }

    deps.logger.log(fr.modified ? `過濾器修改後的訊息(Twitch): ${fr.user} : ${fr.message}` : "過濾器未修改訊息(Twitch)");

    deps.writeLog("Default", fr.modified ? `過濾器修改後的訊息(Twitch): ${fr.user} : ${fr.message}` : "過濾器未修改訊息(Twitch)", "Filter");

    deps.logger.log(event.chatterDisplayName, "說了:", event.messageText);

    deps.writeLog("Default", `${event.chatterDisplayName} 說了: ${event.messageText}`, "Twitch Chat Original");

    let tUser = fr.modified && fr.user ? fr.user : event.chatterDisplayName;
    let tMsg = fr.modified && fr.message ? fr.message : event.messageText;

    if (!tUser || !tMsg) {
        deps.logger.log('⚠️ 過濾後(Twitch) nick/msg 為空，跳過:', event.chatterDisplayName, event.messageText);
        return;
    }

    if (!deps.recordChatHeat(tMsg, { platform: 'Twitch', id: event.messageId, userId: event.chatterId, user: event.chatterDisplayName, receivedAt })) return;

    deps.notify(tUser, tMsg, icon);

    // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
    tMsg = deps.replaceEmojis(tMsg);

    deps.translate(tMsg).then(RES => {
        let RESCHAT = `${tMsg}${tMsg == RES ? "" : `\n${RES}`}`

        if (RES.toLowerCase() != tMsg.toLowerCase()) {
            deps.notify(tUser + "[翻譯]", RES, icon);
        }

        deps.sendChat(tUser, RESCHAT, icon);

        deps.writeLog("Default", `${tUser} : ${RESCHAT}`, "Twitch Chat")
    })
}

/**
 * 處理 G#Ad 指令：解析參數、審核，並新增或更新贊助廣告。
 * @param {Object} event
 * @param {TwitchChatDeps} deps
 * @param {string} icon 指令發送者頭像（作為 fallback）。
 * @returns {void}
 */
function handleGAd(event, deps, icon) {
    if (!event.messageText.startsWith("G#Ad")) return;

    let res = event.messageText.split(" ")

    let useTTS = event.messageText.toLowerCase().includes("tts")
    let iconURL = event.messageText.includes("icon=") ? event.messageText.split("icon=")[1].split(" ")[0] : null
    let displayIcon;

    // 自訂 user：若訊息含 user=xxx 則使用該值，否則用用戶名
    let overlayUser = event.chatterDisplayName;
    let userValue = event.messageText.includes("user=") ? event.messageText.split("user=")[1].split(" ")[0] : null;
    if (userValue) overlayUser = userValue;

    // 解析 interval=N（分鐘）
    let intervalMinutes = 0;
    let rawInterval = event.messageText.includes("interval=") ? parseInt(event.messageText.split("interval=")[1].split(" ")[0]) : 0;
    if (!isNaN(rawInterval) && rawInterval > 0) {
        if (rawInterval < 15) {
            intervalMinutes = 15;
            const warnMsg = `${overlayUser}，您設定的廣告間隔為 ${rawInterval} 分鐘，最低不能低於 15 分鐘，已自動調整為 15 分鐘`;
            deps.logger.warn(`⚠️ [G#Ad] ${warnMsg}`);
            deps.notify(`⚠️ 贊助廣告間隔調整 (${overlayUser})`, warnMsg, icon);
            deps.sendAd(overlayUser, `⚠️ ${warnMsg}`, icon, false);
            deps.logRawEvent('G#Ad 間隔調整', { user: overlayUser, rawInterval, adjusted: 15 });
        } else {
            intervalMinutes = rawInterval;
        }
    }

    res = res.filter(e => { const l = e.toLowerCase(); return l !== "tts" && l !== "usetts"; }) // 去掉 TTS / useTTS
    const iconIdx = res.findIndex(e => e.startsWith("icon="));
    if (iconIdx !== -1) res.splice(iconIdx, 1); // 去掉 icon=xxx
    const userIdx = res.findIndex(e => e.startsWith("user="));
    if (userIdx !== -1) res.splice(userIdx, 1); // 去掉 user=xxx
    const intervalIdx = res.findIndex(e => e.startsWith("interval="));
    if (intervalIdx !== -1) res.splice(intervalIdx, 1); // 去掉 interval=xxx
    const idIdx = res.findIndex(e => e.startsWith("id="));
    let targetId = -1;
    if (idIdx !== -1) {
        targetId = parseInt(res[idIdx].split("=")[1]);
        if (isNaN(targetId) || targetId < 0) targetId = -1;
        res.splice(idIdx, 1); // 去掉 id=xxx
    }

    res.shift() // 去掉 G#Ad

    // B: 無 icon= 時自動偵測訊息文字中的圖片網址作為頭像，並從文字中移除
    if (!iconURL) {
        const IMG_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[\w=&.,-]*)?$/i;
        const imgIdx = res.findIndex(t => IMG_URL_RE.test(t));
        if (imgIdx !== -1) {
            iconURL = res[imgIdx];
            res.splice(imgIdx, 1);
        }
    }
    displayIcon = iconURL || icon

    let lastMsg = deps.replaceEmojis(res.join(" "));

    const sponsor = deps.sponsorStore.getOrCreate(event.chatterId, event.chatterDisplayName);
    const now = new Date().toISOString();

    // ---- 判斷要更新還是新增 ----
    let targetAd = null;
    let targetIdx = -1;
    if (targetId >= 0 && targetId < sponsor.ads.length) {
        targetIdx = targetId;
        targetAd = sponsor.ads[targetIdx];
    } else if (targetId < 0 && sponsor.ads.length > 0) {
        targetIdx = 0;
        targetAd = sponsor.ads[0];
    }

    // ---- 審核判定 ----
    let approved = true;
    const reviewMode = deps.sponsorStore.state.settings.reviewMode || 'none';
    if (reviewMode === 'filter') {
        const fr = deps.processFilter({ user: overlayUser, message: lastMsg });
        if (fr.blocked) {
            approved = false;
            const rejectReason = `過濾器阻擋: ${fr.reason || '不符合規範'}`;
            deps.logger.log(`🚫 [G#Ad] 贊助廣告被過濾器阻擋: ${overlayUser} - ${lastMsg}`);
            deps.notify(`🚫 贊助廣告被阻擋 (${overlayUser})`, rejectReason, icon);
            deps.sendAd(overlayUser, `⚠️ ${rejectReason}`, icon, false);
            deps.logRawEvent('G#Ad 審核拒絕', { user: overlayUser, message: lastMsg, reason: fr.reason });
        }
    } else if (reviewMode === 'manual') {
        approved = null; // 待審核
        deps.logger.log(`📋 [G#Ad] 贊助廣告待審核: ${overlayUser} - ${lastMsg}`);
        deps.notify(`📋 贊助廣告待審核 (${overlayUser})`, lastMsg, icon, deps.manageUrl);
        deps.sendAd(overlayUser, `📋 贊助廣告已送審，待管理員審核`, icon, false);
        deps.logRawEvent('G#Ad 待審核', { user: overlayUser, message: lastMsg });
    } else {
        const intervalText = intervalMinutes >= 15 ? `每${intervalMinutes}分鐘` : '單次';
        deps.notify(`📢 贊助廣告 (${overlayUser})`, `[${intervalText}] ${lastMsg}`, icon, deps.manageUrl);
    }

    if (targetAd) {
        // ---- 更新現有廣告 ----
        deps.adScheduler.clear(targetAd.id);
        targetAd.message = lastMsg;
        // A+C: 沒帶 icon= 時保留舊頭像，避免被覆寫成 null；有帶則存已解析值（含 Twitch fallback）
        targetAd.iconURL = iconURL ? displayIcon : (targetAd.iconURL || icon);
        targetAd.useTTS = useTTS;
        // 沒帶 user= 時保留原 overlayUser
        targetAd.overlayUser = userValue ? overlayUser : (targetAd.overlayUser || overlayUser);
        targetAd.intervalMinutes = intervalMinutes;
        targetAd.approved = approved;
        targetAd.enabled = approved !== false;
        targetAd.updatedAt = now;
        targetAd.lastSentAt = approved === true ? now : targetAd.lastSentAt;
        const adId = targetAd.id;

        if (approved === true) {
            deps.sendAd(targetAd.overlayUser, lastMsg, targetAd.iconURL || '', useTTS);
            if (intervalMinutes >= 15) {
                deps.adScheduler.schedule(adId, event.chatterId, intervalMinutes, {
                    overlayUser: targetAd.overlayUser, text: lastMsg, iconURL: targetAd.iconURL || '', useTTS
                });
            }
        }
        deps.sponsorStore.save();
        deps.logger.log(`🔄 ${event.chatterDisplayName} 更新 G#Ad #${targetIdx} 成功，user=${overlayUser}, 訊息: ${lastMsg}, TTS: ${useTTS}, 間隔: ${intervalMinutes > 0 ? intervalMinutes + ' 分鐘' : '單次'}`);
    } else {
        // ---- 新增廣告 ----
        if (sponsor.ads.length >= 5) {
            deps.logger.warn(`⚠️ [G#Ad] ${event.chatterDisplayName} 已達 5 則廣告上限，無法新增`);
            deps.sendAd(overlayUser, `⚠️ 您已達到 5 則廣告上限，請先刪除舊的再新增`, icon, false);
            return;
        }
        const adId = `ad_${event.chatterId}_${Date.now()}`;
        const adRecord = {
            id: adId, message: lastMsg, iconURL: displayIcon, useTTS, overlayUser,
            intervalMinutes, approved, enabled: approved !== false,
            createdAt: now, updatedAt: now,
            lastSentAt: approved === true ? now : null
        };
        sponsor.ads.push(adRecord);
        deps.sponsorStore.save();

        if (approved === true) {
            deps.sendAd(overlayUser, lastMsg, displayIcon, useTTS);
            if (intervalMinutes >= 15) {
                deps.adScheduler.schedule(adId, event.chatterId, intervalMinutes, {
                    overlayUser, text: lastMsg, iconURL: displayIcon, useTTS
                });
            }
        }
        deps.logger.log(`✅ ${event.chatterDisplayName} 新增 G#Ad 成功，user=${overlayUser}, 訊息: ${lastMsg}, TTS: ${useTTS}, 間隔: ${intervalMinutes > 0 ? intervalMinutes + ' 分鐘' : '單次'}`);
    }
}
