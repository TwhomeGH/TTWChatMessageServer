// Youtube 直播聊天室整合：解析頻道、檢查開播，並輪詢 YouTube Data API v3 取得訊息。
// 依賴由呼叫端以 deps 注入（DI），模組自己持有輪詢計時器與聊天室狀態。
// OAuth token 的讀取／刷新在 ./tokens.cjs。

/**
 * YouTube 聊天模組的依賴注入物件。
 * @typedef {Object} YoutubeChatDeps
 * @property {Object} axios axios 實例，用於 YouTube Data API v3。
 * @property {string} apiKey YOUTUBE_API_KEY；無有效 OAuth token 時作為認證。
 * @property {number} pollIntervalS 最小輪詢間隔（秒）；實際取 API 建議值與此值較大者。
 * @property {(file: string, message: string, type?: string) => void} writeLog 寫入執行日誌。
 * @property {(title: string, comment: string, icon?: string, url?: string) => void} notify 發送推播通知（Bark／ntfy 分派）。
 * @property {(text: string) => void} sendSystem 送出系統訊息（呼叫端自行帶入目前觀眾數／清單）。
 * @property {(user: string, message: string, img?: string) => void} sendChat 送出聊天訊息。
 * @property {(data: Object) => void} reportTraffic 回報人流事件。
 * @property {(fr: Object, meta: Object) => void} reportFiltered 回報被過濾的訊息。
 * @property {(message: {user: string, message: string}) => Object} filter 套用訊息過濾規則，回傳 {blocked, modified, user, message, reason}。
 * @property {(message: string, meta: Object) => boolean} recordHeat 記錄聊天熱度；回傳 false 表示略過此訊息。
 * @property {(text: string) => string} replaceEmojis 將表情短碼替換成圖片網址。
 * @property {(text: string) => Promise<string>} translate 翻譯文字。
 * @property {(count: number) => void} onViewerCount 回報觀眾數。
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import youtubeTokens from './tokens.cjs';
import { startYoutubeBrowser, stopYoutubeBrowser, youtubeBrowserEnabled } from './browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const youtubeCacheFile = path.resolve(__dirname, '..', '..', 'youtube_cache.json');

let youtubePollInterval = null;
let youtubeLiveChatId = null;
let youtubeVideoId = null;
let youtubeNextPageToken = null;
let youtubeViewerInterval = null;
let youtubeBrowserFallbackStarted = false;

function loadYoutubeCache() {
    try {
        if (existsSync(youtubeCacheFile)) return JSON.parse(readFileSync(youtubeCacheFile, 'utf8'));
    } catch (err) { console.warn('[Youtube] 讀取快取失敗:', err?.message || err); }
    return null;
}
function saveYoutubeCache(data) {
    try { writeFileSync(youtubeCacheFile, JSON.stringify(data)); } catch (err) { console.warn('[Youtube] 寫入快取失敗:', err?.message || err); }
}

async function resolveChannelId(axios, apiKey, input) {
    // 如果輸入已經是 UC 開頭的頻道 ID，直接跳過 API 解析（省 100 單位）
    if (/^UC[\w-]{20,}$/.test(input)) {
        console.log(`ℹ️ 輸入已是頻道 ID，跳過 resolve API 呼叫`);
        return { channelId: input, channelName: input };
    }
    const q = input.startsWith('@') ? input.substring(1) : input;
    try {
        const auth = await youtubeTokens.getYoutubeAuthParams(apiKey);
        if (!auth) throw new Error('無可用認證');
        const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: { part: 'snippet', q: q, type: 'channel', maxResults: 1, ...auth.params },
            headers: auth.headers,
            timeout: 15000,
        });
        const items = res.data?.items;
        if (!items || items.length === 0) throw new Error('找不到頻道');
        return {
            channelId: items[0].snippet.channelId,
            channelName: items[0].snippet.channelTitle,
        };
    } catch (err) {
        const status = err.response?.status || '';
        const data = err.response?.data?.error?.message || err.message;
        console.error(`❌ Youtube resolve 失敗 [${status}]: ${data}`);
        return null;
    }
}

async function checkIsLive(axios, apiKey, channelId) {
    try {
        const auth = await youtubeTokens.getYoutubeAuthParams(apiKey);
        if (!auth) throw new Error('無可用認證');

        // 先嘗試用快取的 videoId（省 100 單位 search）
        const cache = loadYoutubeCache();
        if (cache?.videoId) {
            console.log(`ℹ️ Youtube 嘗試快取 videoId: ${cache.videoId}`);
            try {
                const videoRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                    params: { part: 'liveStreamingDetails', id: cache.videoId, maxResults: 1, ...auth.params },
                    headers: auth.headers,
                    timeout: 10000,
                });
                const video = videoRes.data?.items?.[0];
                const liveDetails = video?.liveStreamingDetails;
                if (liveDetails?.activeLiveChatId) {
                    console.log(`✅ Youtube 快取 videoId 仍有效`);
                    saveYoutubeCache({ videoId: cache.videoId, liveChatId: liveDetails.activeLiveChatId, channelId });
                    return {
                        live: true,
                        liveChatId: liveDetails.activeLiveChatId,
                        videoId: cache.videoId,
                        concurrentViewers: parseInt(liveDetails.concurrentViewers) || 0,
                    };
                }
            } catch { /* 快取失效，繼續 search */ }
        }

        // 快取失效→用 search.list（100 單位）
        const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: { part: 'snippet', channelId: channelId, eventType: 'live', type: 'video', maxResults: 1, ...auth.params },
            headers: auth.headers,
            timeout: 15000,
        });
        const items = res.data?.items;
        if (!items || items.length === 0) {
            console.log(`ℹ️ Youtube 搜尋直播影片結果為空，頻道可能未開播`);
            return { live: false, liveChatId: null, videoId: null, concurrentViewers: 0 };
        }

        const videoId = items[0].id.videoId;

        const videoRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
            params: { part: 'liveStreamingDetails', id: videoId, maxResults: 1, ...auth.params },
            headers: auth.headers,
            timeout: 15000,
        });
        const video = videoRes.data?.items?.[0];
        const liveDetails = video?.liveStreamingDetails;
        if (!liveDetails || !liveDetails.activeLiveChatId) throw new Error('無法取得聊天室 ID');

        saveYoutubeCache({ videoId, liveChatId: liveDetails.activeLiveChatId, channelId });

        return {
            live: true,
            liveChatId: liveDetails.activeLiveChatId,
            videoId: videoId,
            concurrentViewers: parseInt(liveDetails.concurrentViewers) || 0,
        };
    } catch (err) {
        const status = err.response?.status || '';
        const data = err.response?.data?.error?.message || err.message;
        console.error(`❌ Youtube is_live 檢查失敗 [${status}]: ${data}`);
        if (status === 403) {
            console.error('   ⚠️ API 金鑰可能未啟用 YouTube Data API v3 或有限制，請檢查 Google Cloud Console');
        }
        return { live: false, liveChatId: null, videoId: null, concurrentViewers: 0 };
    }
}

/**
 * 處理一則 YouTube 文字聊天。原生 API 與瀏覽器 relay 共用同一條過濾／翻譯／剪輯／人流管線。
 * @param {Object} payload id、user、userId、sentAt、message、img。
 * @param {YoutubeChatDeps} deps
 * @param {string} transport native 或 browser。
 */
function handleYoutubeText(payload, deps, transport = 'native') {
    const { id, user, userId, sentAt, message, img: avatar } = payload;
    if (!user || !message) return;
    const { writeLog, notify, sendChat, reportTraffic, reportFiltered, filter, recordHeat, replaceEmojis, translate } = deps;
    const event = { platform: 'Youtube', eventType: 'chat', id, userId, user, sentAt, message, transport };

    console.info(`[Youtube Chat] ${user} : ${message}`);
    writeLog("Default", `${user} : ${message}`, "Youtube Chat Original");
    reportTraffic(event);

    const fr = filter({ user, message });
    if (fr.blocked) {
        reportFiltered(fr, event);
        console.info('🚫 過濾器阻擋(Youtube):', user, message, `(規則: ${fr.reason})`);
        writeLog("Default", `過濾器阻擋(Youtube): ${user} : ${message} (規則: ${fr.reason})`, "Filter");
        return;
    }

    const tUser = fr.modified && fr.user ? fr.user : user;
    let tMsg = fr.modified && fr.message ? fr.message : message;
    if (!tUser || !tMsg) {
        console.info('⚠️ 過濾後(Youtube) nick/msg 為空，跳過:', user, message);
        return;
    }

    if (!recordHeat(tMsg, event)) return;
    notify(tUser, tMsg, avatar);

    // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
    tMsg = replaceEmojis(tMsg);
    translate(tMsg).then(RES => {
        const RESCHAT = `${tMsg}${tMsg === RES ? '' : `\n${RES}`}`;
        if (RES.toLowerCase() !== tMsg.toLowerCase()) {
            notify(tUser, RES, avatar);
        }
        sendChat(tUser, RESCHAT, avatar);
        writeLog("Default", `${tUser} : ${RESCHAT}`, "Youtube Chat");
    });
}

/** 每 60 秒用 API Key 更新觀眾數；瀏覽器 fallback 與原生 API 共用。 */
function startYoutubeViewerPolling(videoId, deps) {
    clearInterval(youtubeViewerInterval);
    youtubeVideoId = videoId;
    youtubeViewerInterval = setInterval(async () => {
        if (!youtubeVideoId) return;
        try {
            const auth = await youtubeTokens.getYoutubeAuthParams(deps.apiKey);
            if (!auth) return;
            const res = await deps.axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: { part: 'liveStreamingDetails', id: youtubeVideoId, maxResults: 1, ...auth.params },
                headers: auth.headers,
                timeout: 10000,
            });
            const cv = res.data?.items?.[0]?.liveStreamingDetails?.concurrentViewers;
            if (cv) deps.onViewerCount(parseInt(cv) || 0);
        } catch { /* ignore poll errors */ }
    }, 60000);
}

function connect(liveChatId, videoId, channelName, deps) {
    const { axios, apiKey, pollIntervalS, writeLog, notify, sendSystem, sendChat } = deps;
    youtubeLiveChatId = liveChatId;
    youtubeNextPageToken = null;
    youtubeBrowserFallbackStarted = false;

    console.log(`🔌 Youtube 聊天室開始輪詢: liveChatId=${liveChatId}`);
    writeLog("Default", `Youtube 聊天室開始輪詢: ${liveChatId}`, "Youtube");

    notify("Youtube 連線", `已連線 ${channelName}`, "");
    sendSystem(`Youtube 已連線 ${channelName}`);

    startYoutubeViewerPolling(videoId, deps);

    let youtubePollFailures = 0;

    function poll() {
        if (!youtubeLiveChatId) return;

        youtubeTokens.getYoutubeAuthParams(apiKey).then(auth => {
            if (!auth) {
                console.error('⛔ 無可用 YouTube 認證，已停止原生聊天室輪詢。');
                youtubeLiveChatId = null;
                return;
            }
            // liveChatMessages.list 需要 OAuth；API Key 只用於影片／開播查詢，不能拿來輪詢聊天室。
            if (auth.mode !== 'bearer') {
                console.error('⛔ 原生 YouTube 聊天室需要 OAuth 授權；目前只有 API Key，已停止輪詢。請至設定頁重新授權 YouTube，或使用 YouTube userscript。');
                youtubeLiveChatId = null;
                return;
            }

            const params = {
                part: 'snippet,authorDetails',
                liveChatId: youtubeLiveChatId,
                maxResults: 200,
                ...auth.params,
            };
            if (youtubeNextPageToken) params.pageToken = youtubeNextPageToken;

            axios.get('https://www.googleapis.com/youtube/v3/liveChat/messages', { params, headers: auth.headers, timeout: 10000 })
            .then(res => {
                const data = res.data;
                youtubePollFailures = 0;
                youtubeNextPageToken = data.nextPageToken || null;

                if (data.items) {
                    for (const item of data.items) {
                        const type = item.snippet.type;
                        const userName = item.authorDetails?.displayName || '未知';
                        const avatar = item.authorDetails?.profileImageUrl || '';

                        if (type === 'textMessageEvent') {
                            handleYoutubeText({
                                id: item.id,
                                userId: item.authorDetails?.channelId,
                                user: userName,
                                sentAt: item.snippet.publishedAt,
                                message: item.snippet.displayMessage || '',
                                img: avatar
                            }, deps, 'native');

                        } else if (type === 'superChatEvent') {
                            const details = item.snippet.superChatDetails;
                            const amount = details?.amountDisplayString || '';
                            const msg = details?.userComment || '';
                            const display = msg ? `${msg} (${amount})` : amount;
                            console.info(`💰[Youtube SuperChat] ${userName}: ${display}`);
                            writeLog("Default", `SuperChat ${userName}: ${display}`, "Youtube");
                            notify(`💰 ${userName}`, display, avatar);
                            sendChat(userName, `💰 超級感謝 ${display}`, avatar);

                        } else if (type === 'superStickerEvent') {
                            const details = item.snippet.superStickerDetails;
                            const amount = details?.amountDisplayString || '';
                            const sticker = details?.superStickerMetadata?.sticker?.localizedDescription || '貼圖';
                            console.info(`🖼️[Youtube SuperSticker] ${userName}: ${sticker} (${amount})`);
                            writeLog("Default", `SuperSticker ${userName}: ${sticker} (${amount})`, "Youtube");
                            notify(`🖼️ ${userName}`, `${sticker} (${amount})`, avatar);
                            sendChat(userName, `🖼️ 超級貼圖 ${sticker} (${amount})`, avatar);

                        } else if (type === 'newSponsorEvent') {
                            console.info(`🎉[Youtube 新會員] ${userName}`);
                            writeLog("Default", `新會員 ${userName}`, "Youtube");
                            notify("🎉 新會員", userName, avatar);
                            sendChat(userName, "🎉 成為新會員", avatar);

                        } else if (type === 'giftMembershipReceivedEvent') {
                            const details = item.snippet.giftMembershipReceivedDetails;
                            const gifter = details?.gifterChannelId || '未知';
                            console.info(`🎁[Youtube 收到贈禮] ${userName} 來自 ${gifter}`);
                            writeLog("Default", `收到贈禮會員 ${userName} 來自 ${gifter}`, "Youtube");
                            notify("🎁 收到贈禮會員", `${userName} 來自 ${gifter}`, avatar);
                            sendChat(userName, `🎁 收到贈送的會員`, avatar);

                        } else if (type === 'memberMilestoneChatEvent') {
                            const details = item.snippet.memberMilestoneChatDetails;
                            const tier = details?.memberTierName || '會員';
                            const months = details?.memberMonth || '';
                            const msg = details?.userComment || '';
                            const display = `${tier}${months ? ` ${months}個月` : ''}${msg ? `: ${msg}` : ''}`;
                            console.info(`⭐[Youtube 會員里程碑] ${userName}: ${display}`);
                            writeLog("Default", `會員里程碑 ${userName}: ${display}`, "Youtube");
                            notify(`⭐ ${userName}`, display, avatar);
                            sendChat(userName, `⭐ 會員里程碑 ${display}`, avatar);
                        }
                    }
                }

                const apiInterval = data.pollingIntervalMillis || 5000;
                const userInterval = pollIntervalS * 1000;
                const intervalMs = Math.max(apiInterval, userInterval);
                youtubePollInterval = setTimeout(poll, intervalMs);
            })
            .catch(err => {
                const status = err.response?.status || 0;
                const apiError = err.response?.data?.error;
                const reason = apiError?.errors?.[0]?.reason || '';
                const detail = apiError?.message || err.message;
                if (status === 401 || status === 403 || status === 404 || status === 410) {
                    console.error(`⛔ Youtube 原生聊天室停止輪詢 (${status}${reason ? ' ' + reason : ''})：${detail}`);
                    if (status === 403) {
                        console.error('   請確認 OAuth 授權含 youtube.force-ssl 且額度足夠；API Key 不能用於 liveChatMessages。');
                    }
                    youtubeLiveChatId = null;
                    if ((status === 401 || status === 403) && youtubeBrowserEnabled() && !youtubeBrowserFallbackStarted && youtubeVideoId) {
                        youtubeBrowserFallbackStarted = true;
                        console.log(`🌐 Youtube 原生聊天室無法使用，改用專用瀏覽器讀取實際觀看頁：${youtubeVideoId}`);
                        startYoutubeBrowser({
                            videoId: youtubeVideoId,
                            channelName,
                            deps: {
                                writeLog,
                                onText: payload => handleYoutubeText(payload, deps, 'browser')
                            }
                        }).then(() => {
                            notify("Youtube 連線", `已改由專用瀏覽器連線 ${channelName}`, "");
                            sendSystem(`Youtube 已改由專用瀏覽器連線 ${channelName}`);
                        }).catch(error => {
                            console.error('❌ YouTube 瀏覽器 fallback 失敗:', error.message);
                            writeLog("Default", `YouTube 瀏覽器 fallback 失敗: ${error.message}`, "Youtube");
                            notify("Youtube 連線失敗", `專用瀏覽器無法讀取聊天室：${error.message}`, "");
                        });
                    }
                    return;
                }
                youtubePollFailures += 1;
                const delay = Math.min(60000, 10000 * 2 ** (youtubePollFailures - 1));
                if (youtubePollFailures === 1 || youtubePollFailures % 5 === 0) {
                    console.error(`⚠️ Youtube 輪詢錯誤 (${status || 'network'})：${detail}；${Math.round(delay / 1000)} 秒後重試`);
                }
                youtubePollInterval = setTimeout(poll, delay);
            });
        });
    }

    poll();
}

/**
 * 啟動 YouTube 聊天：解析頻道、檢查是否開播，開始輪詢 liveChat 訊息與觀眾數。
 * @param {string} channelName YouTube 頻道名稱或 UC 開頭頻道 ID。
 * @param {YoutubeChatDeps} deps
 * @returns {Promise<void>}
 */
export async function startYoutubeChat(channelName, deps) {
    const { writeLog, sendSystem, notify, apiKey, onChannelIdentity } = deps;

    if (!apiKey) {
        console.log('⚠️ 未設定 YOUTUBE_API_KEY，跳過');
        writeLog("Default", "未設定 YOUTUBE_API_KEY", "Youtube");
        return;
    }
    if (!channelName) {
        console.log('⚠️ 未指定 Youtube 頻道名稱，跳過');
        writeLog("Default", "未指定 Youtube 頻道名稱", "Youtube");
        return;
    }

    console.log(`🎯 正在解析 Youtube 頻道: ${channelName}`);
    writeLog("Default", `正在解析 Youtube 頻道: ${channelName}`, "Youtube");

    const info = await resolveChannelId(deps.axios, apiKey, channelName);
    if (!info) {
        console.log('❌ 無法解析 Youtube 頻道，跳過');
        sendSystem("Youtube 頻道解析失敗");
        return;
    }
    console.log(`🔍 Youtube 頻道 ID: ${info.channelId}`);
    // 人流歸屬使用解析後、大小寫正確的頻道 ID，而不是使用者輸入的 @handle。
    if (typeof onChannelIdentity === 'function') onChannelIdentity(info.channelId, info.channelName);

    const liveInfo = await checkIsLive(deps.axios, apiKey, info.channelId);
    if (!liveInfo.live) {
        console.log('📴 Youtube 頻道未開播，結束程序');
        writeLog("Default", "Youtube 頻道未開播", "Youtube");
        notify("Youtube 未開播", `${info.channelName} 目前沒有直播`, "");
        sendSystem(`Youtube ${info.channelName} 未開播`);
        return;
    }

    deps.onViewerCount(liveInfo.concurrentViewers);
    console.log(`📺 Youtube 直播中，觀眾數: ${liveInfo.concurrentViewers}`);

    const auth = await youtubeTokens.getYoutubeAuthParams(apiKey);
    if (auth?.mode === 'bearer') {
        connect(liveInfo.liveChatId, liveInfo.videoId, info.channelName, deps);
        return;
    }

    if (!youtubeBrowserEnabled()) {
        console.error('⛔ 沒有有效的 YouTube OAuth，原生聊天室不可用；瀏覽器 fallback 已停用。請重新授權或設定 YOUTUBE_BROWSER_FALLBACK=1。');
        writeLog("Default", "YouTube 無 OAuth 且瀏覽器 fallback 已停用", "Youtube");
        return;
    }

    console.log(`🌐 沒有有效 OAuth，改用 YouTube 專用瀏覽器讀取實際觀看頁：${liveInfo.videoId}`);
    startYoutubeViewerPolling(liveInfo.videoId, deps);
    try {
        await startYoutubeBrowser({
            videoId: liveInfo.videoId,
            channelName: info.channelName,
            deps: {
                writeLog,
                onText: payload => handleYoutubeText(payload, deps, 'browser')
            }
        });
        sendSystem(`Youtube 已透過專用瀏覽器連線 ${info.channelName}`);
        notify("Youtube 連線", `已透過專用瀏覽器連線 ${info.channelName}`, "");
    } catch (error) {
        clearInterval(youtubeViewerInterval);
        youtubeViewerInterval = null;
        console.error('❌ YouTube 瀏覽器 fallback 失敗:', error.message);
        writeLog("Default", `YouTube 瀏覽器 fallback 失敗: ${error.message}`, "Youtube");
        notify("Youtube 連線失敗", `專用瀏覽器無法讀取聊天室：${error.message}`, "");
        sendSystem(`Youtube 瀏覽器 fallback 失敗：${error.message}`);
    }
}

/**
 * 停止 YouTube 輪詢、觀眾數計時器與瀏覽器 fallback（可重複呼叫）。
 * @returns {Promise<void>}
 */
export async function stopYoutubeChat() {
    clearTimeout(youtubePollInterval);
    clearInterval(youtubeViewerInterval);
    youtubePollInterval = null;
    youtubeViewerInterval = null;
    youtubeLiveChatId = null;
    youtubeVideoId = null;
    youtubeNextPageToken = null;
    youtubeBrowserFallbackStarted = false;
    try {
        await stopYoutubeBrowser();
    } catch (error) {
        console.error('❌ 關閉 Youtube 專用瀏覽器失敗:', error.message);
    }
    console.log('❌ Youtube 聊天室已斷線');
}
