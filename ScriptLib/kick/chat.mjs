/**
 * Kick 聊天：解析 chatroom ID、取得頭像，並以 KickWebSocket 接收聊天／訂閱事件。
 *
 * Kick 的 OAuth token 由同目錄的 `tokens.cjs` 取得；其餘副作用（推播、socket、過濾、統計、翻譯）
 * 由 `deps` 注入，模組本身不依賴 TikTok.js 的全域狀態。
 */

import { KickWebSocket } from 'kick-wss';
import kickTokens from './tokens.cjs';

const KNOWN_CHANNELS = {
    'nuclear0709': 24640237,
};

/**
 * @typedef {Object} KickChatDeps
 * @property {string} channelName Kick 頻道名稱。
 * @property {(file: string, message: string, type?: string) => void} writeLog 寫入日誌檔。
 * @property {(title: string, body: string, icon?: string, url?: string) => Promise<void>} notify 推播通知。
 * @property {(text: string) => void} sendSystem 送出系統訊息到 socket（isMain=false）。
 * @property {(user: string, message: string, avatar: string) => void} sendChat 送出聊天訊息到 socket（isMain=true）。
 * @property {(user: string, message: string, avatar: string) => void} sendNotice 送出事件訊息到 socket（isMain=false）。
 * @property {(data: Object) => void} reportTraffic 回報流量事件。
 * @property {(fr: Object, meta: Object) => void} reportFiltered 回報被過濾的訊息。
 * @property {(msg: Object) => Object} filter 過濾規則。
 * @property {(message: string, meta: Object) => boolean} recordHeat 記錄聊天熱度。
 * @property {(text: string) => string} replaceEmojis 取代 emoji shortcode。
 * @property {(text: string) => Promise<string>} translate 翻譯文字。
 * @property {{get: Function}} axios HTTP 用戶端（取得 Kick 頭像用）。
 * @property {(options: Object) => Object} [createSocket] 建立 Kick socket；預設 `new KickWebSocket(options)`（測試可注入替身）。
 * @property {Console} [logger=console]
 */

/**
 * 由已知清單猜測 chatroom ID。
 * @param {string} channelName
 * @returns {number}
 */
function guessKickChannelId(channelName) {
    return KNOWN_CHANNELS[channelName.toLowerCase()] || 0;
}

/**
 * 解析 Kick chatroom ID：優先環境變數，其次已知清單，最後呼叫 kick.com API。
 * @param {string} channelName
 * @param {Console} logger
 * @returns {Promise<number>}
 */
async function resolveKickChannelId(channelName, logger) {
    const envId = parseInt(process.env.KICK_CHANNEL_ID, 10);
    if (envId > 0) return envId;

    const knownId = guessKickChannelId(channelName);
    if (knownId > 0) return knownId;

    try {
        const res = await fetch(`https://kick.com/api/v2/channels/${channelName}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://kick.com/',
                'Origin': 'https://kick.com',
                'Accept-Encoding': 'gzip'
            }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data?.chatroom?.id || 0;
    } catch (e) {
        logger.error('⚠️ 無法取得 Kick 頻道資訊:', e.message);
        return 0;
    }
}

/**
 * 取得 Kick 使用者頭像（先查 users 端點，再查 channels）；結果會被快取。
 * @param {string} username
 * @param {(string|number)} [userId]
 * @param {{axios: Object, cache: Map, logger: Console}} ctx
 * @returns {Promise<string>} 頭像 URL；無法取得時回傳空字串。
 */
async function getKickUserAvatar(username, userId, ctx) {
    if (username === '未知' || (!username && !userId)) return "";
    const cacheKey = (username || userId || "").toString().toLowerCase();
    const cached = ctx.cache.get(cacheKey);
    if (cached) return cached;

    const token = await kickTokens.getValidKickToken();
    if (!token) {
        ctx.logger.info(`[Kick Avatar] ❌ 無 OAuth token，跳過: ${username}`);
        return "";
    }
    const authHeaders = { 'Authorization': `Bearer ${token}` };

    const baseUrl = 'https://api.kick.com/public/v1';

    try {
        const res = await ctx.axios.get(`${baseUrl}/users`, {
            params: { slug: username },
            headers: { ...authHeaders, 'Accept': 'application/json' }
        });
        const user = Array.isArray(res.data?.data) ? res.data.data[0] : null;
        const avatar = user?.profile_picture || user?.profile_pic || null;
        if (avatar) {
            ctx.logger.info(`[Kick Avatar] ✅ 取得頭像(user): ${username}`);
            ctx.cache.set(cacheKey, avatar);
            return avatar;
        }
    } catch (err) { ctx.logger.warn('[Kick Avatar] 查詢 user 端點失敗:', err?.message || err); }

    try {
        const res = await ctx.axios.get(`${baseUrl}/channels`, {
            params: { slug: username },
            headers: { ...authHeaders, 'Accept': 'application/json' }
        });
        const chan = Array.isArray(res.data?.data) ? res.data.data[0] : null;
        const avatar = chan?.user?.profile_pic || null;
        if (avatar) {
            ctx.logger.info(`[Kick Avatar] ✅ 取得頭像(channel): ${username}`);
            ctx.cache.set(cacheKey, avatar);
            return avatar;
        }
    } catch (err) { ctx.logger.warn('[Kick Avatar] 查詢 channel 端點失敗:', err?.message || err); }

    ctx.logger.info(`[Kick Avatar] ❌ 無法取得頭像: ${username}`);
    return "";
}

/**
 * 連接 Kick 聊天室並掛上事件處理。
 * @param {KickChatDeps} deps
 * @returns {Promise<KickWebSocket|undefined>} 建立的 socket（未指定頻道時為 undefined）。
 */
export async function startKickChat(deps) {
    const { channelName, writeLog, notify, sendSystem, sendChat, sendNotice, reportTraffic, reportFiltered, filter, recordHeat, replaceEmojis, translate, axios, logger = console } = deps;

    if (!channelName) {
        logger.log('⚠️ 未指定 Kick 頻道名稱，跳過');
        writeLog("Default", "未指定 Kick 頻道名稱", "Kick");
        return;
    }

    logger.info(`🎯 正在連接 Kick 頻道: ${channelName}`);
    writeLog("Default", `正在連接 Kick 頻道: ${channelName}`, "Kick");

    const channelId = await resolveKickChannelId(channelName, logger);
    logger.info(`🔍 Kick 頻道 chatroom ID: ${channelId || '無法取得'}`);
    writeLog("Default", `Kick 頻道 chatroom ID: ${channelId || '無法取得'}`, "Kick");

    const avatarCache = new Map();
    const avatarCtx = { axios, cache: avatarCache, logger };

    const kickWS = (deps.createSocket || ((options) => new KickWebSocket(options)))({ debug: false, autoReconnect: true, ...(channelId > 0 && { channelId }) });

    kickWS.on('ready', () => {
        logger.info(`✅ Kick WebSocket 已連線: ${channelName}`);

        writeLog("Default", `Kick WebSocket 已連線: ${channelName}`, "Kick");

        notify("Kick 連線", `已連線 ${channelName}`, "");
        sendSystem(`Kick 已連線 ${channelName}`);
    });

    function getSenderAvatar(sender) {
        return sender?.profile_picture || sender?.profile_pic || sender?.picture || sender?.avatar || "";
    }

    kickWS.on('ChatMessage', async (data) => {
        const userName = data.sender?.username || '未知';
        const message = data.content || '';
        let avatar = getSenderAvatar(data.sender);
        if (!avatar) avatar = await getKickUserAvatar(userName, data.sender?.id, avatarCtx);

        logger.info(`[Kick Chat] ${userName} : ${message}`);
        writeLog("Default", `${userName} : ${message}`, "Kick Chat Original");
        reportTraffic({ platform: 'Kick', eventType: 'chat', id: data.id, userId: data.sender?.id, user: userName, sentAt: data.created_at, message });

        const fr = filter({ user: userName, message });
        if (fr.blocked) {
            reportFiltered(fr, { platform: 'Kick', id: data.id, userId: data.sender?.id, user: userName, sentAt: data.created_at, message });
            logger.info('🚫 過濾器阻擋(Kick):', userName, message, `(規則: ${fr.reason})`);
            writeLog("Default", `過濾器阻擋(Kick): ${userName} : ${message} (規則: ${fr.reason})`, "Filter");
            return;
        }

        let tUser = fr.modified && fr.user ? fr.user : userName;
        let tMsg = fr.modified && fr.message ? fr.message : message;

        if (!tUser || !tMsg) {
            logger.info('⚠️ 過濾後(Kick) nick/msg 為空，跳過:', userName, message);
            return;
        }

        if (!recordHeat(tMsg, { platform: 'Kick', id: data.id, userId: data.sender?.id, user: userName, sentAt: data.created_at })) return;

        logger.info(`📢 發送 Bark 通知: ${tUser} - ${tMsg}`);
        notify(tUser, tMsg, avatar);

        // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
        tMsg = replaceEmojis(tMsg);

        translate(tMsg).then(RES => {
            let RESCHAT = `${tMsg}${tMsg == RES ? "" : `\n${RES}`}`;
            if (RES.toLowerCase() != tMsg.toLowerCase()) {
                logger.info(`📢 發送 Bark 通知: ${tUser} - ${RES}`);
                notify(tUser, RES, avatar);
            }
            sendChat(tUser, RESCHAT, avatar);
            writeLog("Default", `${tUser} : ${RESCHAT}`, "Kick Chat");
        });
    });

    kickWS.on('Subscription', async (data) => {
        const username = data.username || '未知';
        const message = `订阅了频道`;
        const avatar = await getKickUserAvatar(username, undefined, avatarCtx);

        logger.info(`[Kick Sub] ${username} ${message}`);
        writeLog("Default", `${username} ${message}`, "Kick Sub");

        notify(username, message, avatar);
        sendNotice(username, message, avatar);
    });

    kickWS.on('GiftedSubscriptions', async (data) => {
        const gifter = data.gifted_by || '未知';
        const recipients = Array.isArray(data.recipients) ? data.recipients.join(', ') : '';
        const message = `赠送了订阅给 ${recipients}`;
        const avatar = await getKickUserAvatar(gifter, undefined, avatarCtx);

        logger.info(`[Kick GiftSub] ${gifter} ${message}`);
        writeLog("Default", `${gifter} ${message}`, "Kick GiftSub");

        notify(gifter, message, avatar);
        sendNotice(gifter, message, avatar);
    });

    kickWS.on('UserBanned', async (data) => {
        const username = data.username || '未知';
        const message = `已被封禁`;
        const avatar = await getKickUserAvatar(username, undefined, avatarCtx);

        logger.log(`[Kick Ban] ${username} ${message}`);
        writeLog("Default", `${username} ${message}`, "Kick Ban");

        sendNotice(username, message, avatar);
    });

    kickWS.on('error', (err) => {
        logger.error('⚠️ Kick WebSocket 錯誤:', err);
        writeLog("Default", `Kick WebSocket 錯誤: ${err.message || err}`, "Error");
    });

    kickWS.on('disconnect', (data) => {
        logger.log('❌ Kick WebSocket 斷線:', data?.reason || '未知原因');
        writeLog("Default", `Kick WebSocket 斷線: ${data?.reason || '未知原因'}`, "Kick");
    });

    kickWS.connect(channelName).catch(err => {
        logger.error('❌ Kick 連線失敗:', err.message);
        writeLog("Default", `Kick 連線失敗: ${err.message}`, "Error");
        notify("Kick 連線失敗", err.message, "");
    });

    return kickWS;
}
