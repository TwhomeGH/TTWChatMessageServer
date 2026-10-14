import { WebcastEvent, ControlEvent, ControlAction } from 'tiktok-live-connector';

/**
 * 取得 TikTok v3 使用者頭像（avatarLarge → avatarMedium → avatarThumb）。
 * @param {object} user 事件的 user 物件。
 * @returns {string} 優先序最高的頭像 URL，取不到時回空字串。
 */
export function getTikTokProfilePic(user) {
    if (!user) return "";
    const urls = user.avatarLarge?.urlList || user.avatarMedium?.urlList || user.avatarThumb?.urlList;
    if (urls && urls.length > 0) {
        return urls.find(u => u.includes("100x100") && u.includes(".webp"))
            || urls.find(u => u.includes("100x100") && u.includes(".jpeg"))
            || urls.find(u => !u.includes("shrink"))
            || urls[0]
            || "";
    }
    return "";
}

/**
 * 註冊所有 TikTok WebcastEvent／ControlEvent 處理器。
 * 所有副作用與跨平台狀態皆由 deps 注入，模組本身不依賴 TikTok.js 全域。
 * @param {object} connection TikTokLiveConnection 實例。
 * @param {object} deps 依賴（見 Docs/MODULES.md「平台事件模組」）。
 */
export function registerTikTokEvents(connection, deps) {
    const {
        tiktokName, isTK,
        notify, sendSocketMessage,
        logRawEvent, writeLog, writeFileSync,
        dedup, sentCache, processFilter, reportFiltered, reportTraffic,
        replaceEmojis, recordChatHeat, chatMetadata, translate,
        tikTokChatGuard,
        giftNames, getGiftMapReady,
        getCacheUserNum, setCacheUserNum, setCacheUserList,
        getAutoClip, sendAudienceUpdate,
        isEnd, setStreamEnded, cancelReconnect,
        logger = console,
    } = deps;

    // 以固定 category／platform 送 socket 訊息的便利包裝。
    const sendCat = (category, user, message, img, giftImg, isMain = true, dedupUser, dedupMessage) =>
        sendSocketMessage(user, message, { img, giftImg, isMain, dedupUser, dedupMessage, category, platform: 'tiktok' });

    // 重播聊天過濾統計（僅本模組使用）。
    let lastTikTokReplayLog = 0;
    let tikTokReplayDropped = 0;

    // 加入事件：socket 逐筆送、bark/ntfy 累計 3 秒後合併。
    let memberBarkAccum = [];
    let memberBarkTimer = null;

    /**
     * 將累計的加入事件合併成一則推播（超過 5 人以「⋯等 N 人」摘要）。
     * @returns {void}
     */
    function flushMemberBark() {
        if (memberBarkAccum.length === 0) return;
        const count = memberBarkAccum.length;
        const names = memberBarkAccum.map(e => e.nickname);
        const randomAvatar = memberBarkAccum[Math.floor(Math.random() * count)].avatar;
        const body = count > 5
            ? `${names.slice(0, 5).join('、')}⋯等${count}人`
            : names.join('、');
        notify('👋 加入', body, randomAvatar);
        memberBarkAccum = [];
        memberBarkTimer = null;
    }

    // 點讚累加狀態（依使用者，逾時清空）。
    const userLikeClearTimer = process.env.USER_LIKE_CLEAR_TIMER ? Number(process.env.USER_LIKE_CLEAR_TIMER) : 60 * 1000;
    let UserLikeCount = new Map();

    /**
     * 累加點讚數，並在超過指定秒數未更新時自動清空。
     * @param {string} user 使用者 ID。
     * @param {number} likeCount 本次點讚數。
     * @returns {number} 該使用者最新的累計點讚數。
     */
    function likeUserCount(user, likeCount) {
        const now = Date.now();
        let userData = UserLikeCount.get(user);

        if (!userData) {
            userData = { count: 0, lastLikeTimestamp: now };
        } else if (now - userData.lastLikeTimestamp > userLikeClearTimer) {
            writeLog("Default", `用戶 ${user} 的點讚數已超過 ${userLikeClearTimer} 秒未更新，重置計數`, "Like清空");
            userData.count = 0;
        }

        userData.count += likeCount;
        userData.lastLikeTimestamp = now;
        UserLikeCount.set(user, userData);

        const secondsToClear = Math.ceil((userLikeClearTimer - (now - userData.lastLikeTimestamp)) / 1000);
        writeLog("Default", `用戶 ${user} 的點讚數更新為 ${userData.count} 將於${secondsToClear}秒 後清空`, "Like累加");

        return userData.count;
    }

    // 送禮累加狀態（依使用者，保留最多 MAX_CAPACITY 筆）。
    let UserGiftCount = new Map();
    const MAX_CAPACITY = 1000;

    /**
     * 累計使用者送禮次數（60 秒內），並維持最大容量上限。
     * @param {string} userId 使用者 ID。
     * @param {number} [increment=1] 本次送禮數。
     * @returns {number} 該使用者最新的累計送禮次數。
     */
    function recordGift(userId, increment = 1) {
        const now = Date.now();

        for (const [id, data] of UserGiftCount.entries()) {
            if (now - data.lastGiftTimestamp > 60 * 1000) UserGiftCount.delete(id);
        }

        if (UserGiftCount.size >= MAX_CAPACITY) {
            let oldestId = null;
            let oldestTime = Infinity;
            for (const [id, data] of UserGiftCount.entries()) {
                if (data.lastGiftTimestamp < oldestTime) {
                    oldestTime = data.lastGiftTimestamp;
                    oldestId = id;
                }
            }
            if (oldestId !== null) UserGiftCount.delete(oldestId);
        }

        let userData = UserGiftCount.get(userId);
        if (!userData) {
            userData = { count: 0, lastGiftTimestamp: now };
        } else if (now - userData.lastGiftTimestamp > 60 * 1000) {
            userData.count = 0;
        }

        userData.count += increment;
        userData.lastGiftTimestamp = now;
        UserGiftCount.set(userId, userData);

        return userData.count;
    }

    connection.on(ControlEvent.DISCONNECTED, (e) => {
        logger.log('Disconnected :( (error code: ' + e.errorCode + ', reason: ' + e.reason + ')');

        notify("TikTok 直播間已斷線", `已從 ${tiktokName} 的直播間斷線`, "");
        sendCat('system', "系統", `TikTok 直播間已斷線，已從 ${tiktokName} 的直播間斷線`, "", "", false);

        deps.stopViewCache?.();

        if (isEnd()) return;

        // 直播真正結束（使用者結束 / 平台封鎖）→ 不重連；否則有限次數自動重連
        if (deps.getStreamEnded?.()) {
            logger.log('⏹️ 直播已結束，不進行重連');
            return;
        }
        deps.scheduleReconnect?.();
    });

    connection.on(ControlEvent.ERROR, (err) => {
        const msg = typeof err === 'object' ? (err.message || JSON.stringify(err)) : err;
        logger.error('TikTok 連線錯誤:', msg);
        if (err && err.message === 'Unexpected server response: 200') {
            logger.error('[TikTok] WebSocket 200 錯誤 — 簽名可能無效或連線協定不符');
        }
        sendCat('system', "系統", `TikTok 連線錯誤: ${msg.substring(0, 100)}`, "", "", false);
    });

    connection.on(WebcastEvent.CAPTION_MESSAGE, (data) => {
        logRawEvent('CAPTION_MESSAGE', data);
        var MES_CAPTION = [""];

        if (data.content.length) {
            const lines = data.content.map(c => `[${c.lang}] ${c.content}`).join(' ');

            MES_CAPTION.push`Caption (${data.timestampMs}): ${lines}`;

            writeLog("Default", MES_CAPTION.join("\n"), "Caption");
        }
    });

    connection.on(WebcastEvent.ROOM_USER, data => {
        logRawEvent('ROOM_USER', data);
        const viewerCount = data.total ?? data.totalUser ?? connection.state?.roomInfo?.data?.user_count;
        logger.log(`Viewer Count: ${viewerCount}`);
        const ranksList = data.ranks || [];
        const topGifter = ranksList[0];
        if (topGifter?.user) {
            const uniqueId = topGifter.user.displayId;
            const nickname = topGifter.user.nickname;
            if (uniqueId) logger.log(`Top gifter uniqueId: ${uniqueId} (${topGifter.score})`);
            if (nickname) logger.log(`Top gifter nickname: ${nickname} (${topGifter.score})`);
        }

        setCacheUserList(ranksList.map(item => item.user.nickname));
        setCacheUserNum(viewerCount);
        getAutoClip()?.updatePlatformViewers('TikTok', Number(viewerCount));
        sendAudienceUpdate();
    });

    connection.on(WebcastEvent.MEMBER, data => {
        reportTraffic({ platform: 'TikTok', eventType: 'join', id: data.msgId || data.common?.msgId, sentAt: data.createTime || data.common?.createTime, userId: data.user?.userId || data.user?.id, user: data.user?.nickname });
        logRawEvent('MEMBER', data);

        let iconn = getTikTokProfilePic(data.user);

        logger.log(data.user.nickname, "加入了");
        logger.log("STATE View", connection.state.roomInfo.data.user_count, getCacheUserNum());

        // 跨路徑去重：檢查是否已被 userscript 路徑送出（檢查 syncBuffer）
        const isCrossPathDuplicate = dedup.isDuplicate(data.user.nickname.trim(), "加入了");

        if (isCrossPathDuplicate) {
            logger.log('🚫 跨路徑重複(來自userscript):', data.user.nickname, "加入了");
            writeLog("Default", `跨路徑重複訊息被過濾(來自userscript): ${data.user.nickname} : 加入了`, "CrossPathDuplicate");
            return;
        }

        const fr = processFilter({ user: data.user.nickname, message: "加入了" });
        if (fr.blocked) {
            logger.log('🚫 過濾器阻擋:', data.user.nickname, "加入了", `(規則: ${fr.reason})`);
            writeLog("Default", `過濾器阻擋訊息: ${data.user.nickname} : 加入了 (規則: ${fr.reason})`, "FilterBlocked");
            dedup.add(data.user.nickname.trim(), "加入了");
            return;
        }

        let nickname = fr.modified && fr.user ? fr.user : data.user.nickname;
        let message = fr.modified && fr.message ? fr.message : "加入了";

        if (!nickname || !message) {
            logger.log('⚠️ 過濾後 nick/message 為空，跳過:', data.user.nickname, "加入了");
            writeLog("Default", `過濾後 nick/message 為空，跳過: ${data.user.nickname} : 加入了`, "FilterEmpty");
            dedup.add(data.user.nickname.trim(), "加入了");
            return;
        }

        // socket：維持逐筆發送
        sendCat('member', nickname, "來了", iconn, "", false, data.user.nickname, "加入了");

        // bark：累計後合併發送
        memberBarkAccum.push({ nickname, avatar: iconn });
        if (memberBarkTimer) clearTimeout(memberBarkTimer);
        memberBarkTimer = setTimeout(flushMemberBark, 3000);

        dedup.add(data.user.nickname.trim(), "加入了");
    });

    connection.on(WebcastEvent.FOLLOW, data => {
        logRawEvent('FOLLOW', data);
        let iconn = getTikTokProfilePic(data.user);
        logger.log(data.user.nickname, "關注了主播");

        notify(data.user.nickname, "關注了主播", iconn);
        sendCat('follow', data.user.nickname, "關注了主播", iconn, "", false);
        dedup.add(data.user.nickname.trim(), "關注了主播");
    });

    connection.on(WebcastEvent.CHAT, data => {
        reportTraffic({ platform: 'TikTok', eventType: 'chat', id: data.msgId || data.common?.msgId, sentAt: data.createTime || data.common?.createTime, userId: data.user?.userId || data.user?.id, user: data.user?.nickname, message: data.comment });
        if (isTK) {
            const result = tikTokChatGuard.check(data);
            if (!result.accepted) {
                tikTokReplayDropped++;
                if (Date.now() - lastTikTokReplayLog >= 10000) {
                    lastTikTokReplayLog = Date.now();
                    logger.log(`[TikTok] 忽略重播聊天: ${result.reason}，累計 ${tikTokReplayDropped} 筆`);
                }
                return;
            }
        }
        logRawEvent('CHAT', data);

        if (!data.content) {
            writeFileSync(`./logs/TikTok/CHAT_NO_CONTENT_${Date.now()}.json`, JSON.stringify(data, null, 2), 'utf-8');
            logger.log('⚠️ CHAT 事件缺少 content，已寫入 logs/TikTok/CHAT_NO_CONTENT_*.json');

            if (data.emotes && data.emotes.length > 0) {
                data.content = `[表情] ${data.emotes[0]?.emote || ''}`;
            } else {
                return;
            }
        }

        const uniqueKey = `chat_${data.user.nickname}_${data.content}`;
        if (sentCache.alreadySent(uniqueKey)) return;

        const fr = processFilter({ user: data.user.nickname, message: data.content });
        if (fr.blocked) {
            reportFiltered(fr, { platform: 'TikTok', id: data.msgId || data.common?.msgId, sentAt: data.createTime || data.common?.createTime, userId: data.user?.userId || data.user?.id, user: data.user.nickname, message: data.content });
            logger.log('🚫 過濾器阻擋:', data.user.nickname, data.content, `(規則: ${fr.reason})`);
            writeLog("Default", `過濾器阻擋訊息: ${data.user.nickname} : ${data.content} (規則: ${fr.reason})`, "FilterBlocked");
            dedup.add(data.user.nickname.trim(), data.content.trim());
            return;
        }

        let nickname = fr.modified && fr.user ? fr.user : data.user.nickname;
        let comment = fr.modified && fr.message ? fr.message : data.content;
        let iconn = getTikTokProfilePic(data.user);

        logger.log(`Chat:${nickname} : ${comment}`);

        writeLog("Default", `原始訊息: ${data.user.nickname} : ${data.content}\n過濾後訊息: ${nickname} : ${comment}`, "Chat原過濾對比");

        if (!nickname || !comment) {
            logger.log('⚠️ 過濾後 nick/comment 為空，跳過:', data.user.nickname, data.content);
            writeLog("Default", `過濾後 nick/comment 為空，跳過: ${data.user.nickname} : ${data.content}`, "FilterEmpty");
            dedup.add(data.user.nickname.trim(), data.content.trim());
            return;
        }

        // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
        comment = replaceEmojis(comment);

        if (!recordChatHeat(comment, { platform: 'TikTok', ...{ id: chatMetadata(data).id, sentAt: chatMetadata(data).time }, userId: data.user?.id, user: data.user?.nickname })) return;

        notify(nickname, comment, iconn);

        translate(comment).then(RES => {
            var RESCHAT = `${comment}`;
            if (comment != RES) {
                RESCHAT += `\n${RES}`;
            }

            writeLog("Default", `${nickname} : ${RESCHAT}`, "Chat");

            if (RES.toLowerCase() != comment.toLowerCase()) {
                notify(nickname + "[翻譯]", RES, iconn);
            }

            sendCat('chat', nickname, RESCHAT, iconn, "", true, data.user.nickname, data.content);

            // 翻譯屬於同一則留言，不重複統計。

            dedup.add(data.user.nickname.trim(), data.content.trim());
        });
    });

    connection.on(WebcastEvent.SOCIAL, data => {
        logRawEvent('SOCIAL', data);

        var LOG_SOCIAL = [];

        if (data.action) LOG_SOCIAL.push(`Social action: ${data.action}`);
        const uniqueId = data.user?.displayId;
        const nickname = data.user?.nickname;
        if (uniqueId) LOG_SOCIAL.push(`User uniqueId: ${uniqueId}`);
        if (nickname) LOG_SOCIAL.push(`User nickname: ${nickname}`);
        if (data.shareType || data.shareTarget) LOG_SOCIAL.push(`Share type: ${data.shareType}, share target: ${data.shareTarget}`);

        writeLog("Default", LOG_SOCIAL.join("\n"), "Social分享");
    });

    connection.on(WebcastEvent.EMOTE, (data) => {
        logRawEvent('EMOTE', data);
        const uniqueId = data.user?.displayId;
        const nickname = data.user?.nickname;
        const profilePic = getTikTokProfilePic(data.user);

        var LOG_R = [];

        if (uniqueId) LOG_R.push(`User uniqueId: ${uniqueId}`);
        if (nickname) LOG_R.push(`User nickname: ${nickname}`);

        const emoteId = data.emoteList?.[0]?.emoteId;

        if (emoteId) {
            LOG_R.push(`Emote id: ${emoteId}`);
            const mess = `發送了表情 ${emoteId}`;
            sendCat('emote', nickname, mess, profilePic, "", true);
            notify(nickname, mess, profilePic);
            writeLog("Default", LOG_R.join("\n"), "Emote表情");
        }
    });

    connection.on(WebcastEvent.ROOM_MESSAGE, data => {
        logRawEvent('ROOM_MESSAGE', data);

        var LOG_ROOM = [];

        if (data.content) LOG_ROOM.push(`Room message: ${data.content}`);
        if (data.source) LOG_ROOM.push(`Source: ${data.source}`);

        LOG_ROOM.push(`Scene: ${data.scene}`);

        writeLog("Default", LOG_ROOM.join('\n'), "Room message");
    });

    connection.on(WebcastEvent.LIKE, data => {
        logRawEvent('LIKE', data);

        let iconn = getTikTokProfilePic(data.user);
        let likeCount = likeUserCount(data.user.nickname, data.count || 0);
        let mess = `喜歡你 ${likeCount} 次`;

        logger.log(`${data.user.nickname} ${mess}`);

        notify(data.user.nickname, mess, iconn);
        sendCat('like', data.user.nickname, mess, iconn, "", false);
        dedup.add(data.user.nickname.trim(), mess);

        writeLog("Default", `${data.user.nickname} ${mess}`, "Like");
    });

    connection.on(WebcastEvent.GIFT, async data => {
        logRawEvent('GIFT', data);
        await getGiftMapReady();
        const giftInfo = data.gift;
        const originalGiftName = giftInfo?.name || "";
        const translatedGiftName = await giftNames.ensureGiftNameTranslation(originalGiftName);
        const giftNameForDisplay = translatedGiftName || originalGiftName;
        let iconn = getTikTokProfilePic(data.user);
        let giftImg = giftInfo?.icon?.urlList?.[0] || "";

        if (giftInfo?.type === 1 && !data.repeatEnd) {
            // 連擊進行中 → 只發連擊進度，不回到底部
            let mess = `連擊了 ${giftNameForDisplay} ${data.repeatCount} 個`;
            logger.log(`連擊了 ${data.user.nickname} : ${giftNameForDisplay} x${data.repeatCount}`);
            notify(data.user.nickname, mess, giftImg);
            sendCat('gift', data.user.nickname, mess, iconn, giftImg, true);
            dedup.add(data.user.nickname.trim(), mess);
            writeLog("Default", `${data.user.nickname} ${mess}`, "Gift連擊");
            return;
        }

        // 連擊結束 / 非連擊禮物 → 送出最終通知
        let mess = `送出了 ${giftNameForDisplay} ${data.repeatCount} 個`;
        logger.log(`送出了 ${data.user.nickname} : ${giftNameForDisplay} ${data.repeatCount} 個`);

        notify(data.user.nickname, mess, giftImg);
        sendCat('gift', data.user.nickname, mess, iconn, giftImg, true);
        dedup.add(data.user.nickname.trim(), mess);
        writeLog("Default", `${data.user.nickname} ${mess}`, "Gift");

        // 累計送禮次數感謝（同一使用者 60 秒內送禮 >= 5 次）
        let count = recordGift(data.user.displayId);
        if (count >= 5) {
            let thanks = `${data.user.nickname} 謝謝支持`;
            logger.log("5次送禮感謝", data.user.nickname, thanks);
            notify(data.user.nickname, thanks, giftImg);
            sendCat('gift', "感謝大哥的餽贈", thanks, iconn, giftImg, true);
            dedup.add(data.user.nickname.trim(), thanks);
            writeLog("Default", thanks, "Gift感謝");
            UserGiftCount.set(data.user.displayId, { count: 0, lastGiftTimestamp: Date.now() });
        }
    });

    connection.on(WebcastEvent.SHARE, data => {
        logRawEvent('SHARE', data);
        let mess = "分享直播間";
        let iconn = getTikTokProfilePic(data.user);
        logger.log(`${data.user.nickname} ${mess}`);

        notify(data.user.nickname, mess, iconn);
        sendCat('share', data.user.nickname, mess, iconn, "", false);
        dedup.add(data.user.nickname.trim(), mess);

        writeLog("Default", `${data.user.nickname} 分享了直播間！`, "Share");
    });

    connection.on(WebcastEvent.ENVELOPE, data => {
        logRawEvent('ENVELOPE', data);
        const envelope = data.envelopeInfo;
        if (!envelope) return;

        if (envelope.envelopeId) logger.log(`Envelope ${envelope.envelopeId}`);
        if (envelope.sendUserName) logger.log(`From: ${envelope.sendUserName}`);
        logger.log(`Diamonds: ${envelope.diamondCount}, People: ${envelope.peopleCount}`);

        // Skip empty/system envelopes
        if (!envelope.diamondCount && !envelope.peopleCount) {
            logger.log("⚠️ 跳過空的寶箱事件");
            return;
        }

        let mess = `送出了寶箱，包含 ${envelope.diamondCount} 鑽石`;
        const senderName = envelope.sendUserName || data.nickname || "未知用戶";
        const profilePic = getTikTokProfilePic(data.user) || envelope.sendUserAvatar?.urlList?.[0] || "";
        notify(senderName, mess, profilePic);
        sendCat('envelope', senderName, mess, profilePic, "", true);

        writeLog("Default", `${senderName} 送出了寶箱，包含 ${envelope.diamondCount} 鑽石`, "Envelope");
    });

    connection.on(WebcastEvent.SUPER_FAN, (data) => {
        logRawEvent('SUPER_FAN', data);
        logger.log('A user became a superfan!');
        let mess = "鐵粉出現啦！";
        let iconn = getTikTokProfilePic(data.user);
        const nickname = data.user?.nickname || "用戶";
        logger.log(`${nickname} ${mess}`);

        notify(nickname, mess, iconn);
        sendCat('superfan', nickname, mess, iconn, "", true);

        writeLog("Default", `${nickname} 成為了鐵粉！`, "SuperFan");
    });

    connection.on(WebcastEvent.STREAM_END, ({ action }) => {
        let IMG = "https://img.icons8.com/?size=100&id=xruQNezCArqC&format=png&color=000000";
        let mess = "直播結束啦";

        logger.log(JSON.stringify({ action }, "", 4));

        if (action === ControlAction.CONTROL_ACTION_STREAM_ENDED) {
            writeLog("Default", "直播結束，用戶主動結束或推流斷線", "Stream Status");
            logger.log('Stream ended by user');
            notify(tiktokName, mess, IMG);
            sendCat('system', tiktokName, mess, IMG, '', false);
        }
        if (action === ControlAction.CONTROL_ACTION_STREAM_SUSPENDED) {
            logger.log('Stream ended by platform moderator (ban)');
            notify(tiktokName, mess, IMG);
            sendCat('system', tiktokName, mess, IMG, '', false);

            writeLog("Default", "直播被強行終止了 :(", "Stream Status");
        }
        // 直播真正結束：取消排程中的重連，不再自動重試
        setStreamEnded();
        cancelReconnect();
    });
}
