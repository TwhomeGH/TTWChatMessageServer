// Youtube 直播聊天室整合：解析頻道、檢查開播，並輪詢 YouTube Data API v3 取得訊息。
// 依賴由呼叫端以 deps 注入（DI），模組自己持有輪詢計時器與聊天室狀態。
// OAuth token 的讀取／刷新在 ./tokens.cjs。
//
// deps = {
//   axios, apiKey, pollIntervalS,
//   writeLog(file, message, type),
//   bark(title, comment, icon, url?),
//   sendSystem(text),
//   sendChat(user, message, img),
//   reportTraffic(data),
//   reportFiltered(fr, meta),
//   filter(message),
//   recordHeat(message, meta) -> boolean,
//   replaceEmojis(text),
//   translate(text) -> Promise<string>,
//   onViewerCount(n),
// }

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import youtubeTokens from './tokens.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const youtubeCacheFile = path.resolve(__dirname, '..', '..', 'youtube_cache.json');

let youtubePollInterval = null;
let youtubeLiveChatId = null;
let youtubeVideoId = null;
let youtubeNextPageToken = null;
let youtubeViewerInterval = null;

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

function connect(liveChatId, videoId, channelName, deps) {
    const { axios, apiKey, pollIntervalS, writeLog, bark, sendSystem, sendChat, reportTraffic, reportFiltered, filter, recordHeat, replaceEmojis, translate, onViewerCount } = deps;
    youtubeLiveChatId = liveChatId;
    youtubeNextPageToken = null;

    console.log(`🔌 Youtube 聊天室開始輪詢: liveChatId=${liveChatId}`);
    writeLog("Default", `Youtube 聊天室開始輪詢: ${liveChatId}`, "Youtube");

    bark("Youtube 連線", `已連線 ${channelName}`, "");
    sendSystem(`Youtube 已連線 ${channelName}`);

    youtubeVideoId = videoId; // 儲存 videoId 供 viewer count 更新用

    // 定期更新觀眾數
    youtubeViewerInterval = setInterval(async () => {
        if (!youtubeVideoId) return;
        try {
            const auth = await youtubeTokens.getYoutubeAuthParams(apiKey);
            if (!auth) return;
            const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: { part: 'liveStreamingDetails', id: youtubeVideoId, maxResults: 1, ...auth.params },
                headers: auth.headers,
                timeout: 10000,
            });
            const cv = res.data?.items?.[0]?.liveStreamingDetails?.concurrentViewers;
            if (cv) {
                onViewerCount(parseInt(cv) || 0);
            }
        } catch { /* ignore poll errors */ }
    }, 60000);

    function poll() {
        if (!youtubeLiveChatId) return;

        youtubeTokens.getYoutubeAuthParams(apiKey).then(auth => {
            if (!auth) { youtubePollInterval = setTimeout(poll, 30000); return; }

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
                youtubeNextPageToken = data.nextPageToken || null;

                if (data.items) {
                    for (const item of data.items) {
                        const type = item.snippet.type;
                        const userName = item.authorDetails?.displayName || '未知';
                        const avatar = item.authorDetails?.profileImageUrl || '';

                        if (type === 'textMessageEvent') {
                            const message = item.snippet.displayMessage || '';

                            console.info(`[Youtube Chat] ${userName} : ${message}`);
                            writeLog("Default", `${userName} : ${message}`, "Youtube Chat Original");
                            reportTraffic({ platform: 'Youtube', eventType: 'chat', id: item.id, userId: item.authorDetails?.channelId, user: userName, sentAt: item.snippet.publishedAt, message });

                            const fr = filter({ user: userName, message });
                            if (fr.blocked) {
                                reportFiltered(fr, { platform: 'Youtube', id: item.id, userId: item.authorDetails?.channelId, user: userName, sentAt: item.snippet.publishedAt, message });
                                console.info('🚫 過濾器阻擋(Youtube):', userName, message, `(規則: ${fr.reason})`);
                                writeLog("Default", `過濾器阻擋(Youtube): ${userName} : ${message} (規則: ${fr.reason})`, "Filter");
                                continue;
                            }

                            let tUser = fr.modified && fr.user ? fr.user : userName;
                            let tMsg = fr.modified && fr.message ? fr.message : message;
                            if (!tUser || !tMsg) {
                                console.info('⚠️ 過濾後(Youtube) nick/msg 為空，跳過:', userName, message);
                                continue;
                            }

                            if (!recordHeat(tMsg, { platform: 'Youtube', id: item.id, userId: item.authorDetails?.channelId, user: userName, sentAt: item.snippet.publishedAt })) continue;
                            bark(tUser, tMsg, avatar);

                            // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
                            tMsg = replaceEmojis(tMsg);

                            translate(tMsg).then(RES => {
                                let RESCHAT = `${tMsg}${tMsg == RES ? "" : `\n${RES}`}`;
                                if (RES.toLowerCase() != tMsg.toLowerCase()) {
                                    bark(tUser, RES, avatar);
                                }
                                sendChat(tUser, RESCHAT, avatar);
                                writeLog("Default", `${tUser} : ${RESCHAT}`, "Youtube Chat");
                            });

                        } else if (type === 'superChatEvent') {
                            const details = item.snippet.superChatDetails;
                            const amount = details?.amountDisplayString || '';
                            const msg = details?.userComment || '';
                            const display = msg ? `${msg} (${amount})` : amount;
                            console.info(`💰[Youtube SuperChat] ${userName}: ${display}`);
                            writeLog("Default", `SuperChat ${userName}: ${display}`, "Youtube");
                            bark(`💰 ${userName}`, display, avatar);
                            sendChat(userName, `💰 超級感謝 ${display}`, avatar);

                        } else if (type === 'superStickerEvent') {
                            const details = item.snippet.superStickerDetails;
                            const amount = details?.amountDisplayString || '';
                            const sticker = details?.superStickerMetadata?.sticker?.localizedDescription || '貼圖';
                            console.info(`🖼️[Youtube SuperSticker] ${userName}: ${sticker} (${amount})`);
                            writeLog("Default", `SuperSticker ${userName}: ${sticker} (${amount})`, "Youtube");
                            bark(`🖼️ ${userName}`, `${sticker} (${amount})`, avatar);
                            sendChat(userName, `🖼️ 超級貼圖 ${sticker} (${amount})`, avatar);

                        } else if (type === 'newSponsorEvent') {
                            console.info(`🎉[Youtube 新會員] ${userName}`);
                            writeLog("Default", `新會員 ${userName}`, "Youtube");
                            bark("🎉 新會員", userName, avatar);
                            sendChat(userName, "🎉 成為新會員", avatar);

                        } else if (type === 'giftMembershipReceivedEvent') {
                            const details = item.snippet.giftMembershipReceivedDetails;
                            const gifter = details?.gifterChannelId || '未知';
                            console.info(`🎁[Youtube 收到贈禮] ${userName} 來自 ${gifter}`);
                            writeLog("Default", `收到贈禮會員 ${userName} 來自 ${gifter}`, "Youtube");
                            bark("🎁 收到贈禮會員", `${userName} 來自 ${gifter}`, avatar);
                            sendChat(userName, `🎁 收到贈送的會員`, avatar);

                        } else if (type === 'memberMilestoneChatEvent') {
                            const details = item.snippet.memberMilestoneChatDetails;
                            const tier = details?.memberTierName || '會員';
                            const months = details?.memberMonth || '';
                            const msg = details?.userComment || '';
                            const display = `${tier}${months ? ` ${months}個月` : ''}${msg ? `: ${msg}` : ''}`;
                            console.info(`⭐[Youtube 會員里程碑] ${userName}: ${display}`);
                            writeLog("Default", `會員里程碑 ${userName}: ${display}`, "Youtube");
                            bark(`⭐ ${userName}`, display, avatar);
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
                console.error('⚠️ Youtube 輪詢錯誤:', err.message);
                youtubePollInterval = setTimeout(poll, 10000);
            });
        });
    }

    poll();
}

export async function startYoutubeChat(channelName, deps) {
    const { writeLog, sendSystem, bark, apiKey } = deps;

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

    const liveInfo = await checkIsLive(deps.axios, apiKey, info.channelId);
    if (!liveInfo.live) {
        console.log('📴 Youtube 頻道未開播，結束程序');
        writeLog("Default", "Youtube 頻道未開播", "Youtube");
        bark("Youtube 未開播", `${info.channelName} 目前沒有直播`, "");
        sendSystem(`Youtube ${info.channelName} 未開播`);
        return;
    }

    deps.onViewerCount(liveInfo.concurrentViewers);
    console.log(`📺 Youtube 直播中，觀眾數: ${liveInfo.concurrentViewers}`);

    connect(liveInfo.liveChatId, liveInfo.videoId, info.channelName, deps);
}

export function stopYoutubeChat() {
    clearTimeout(youtubePollInterval);
    clearInterval(youtubeViewerInterval);
    youtubePollInterval = null;
    youtubeViewerInterval = null;
    youtubeLiveChatId = null;
    youtubeVideoId = null;
    youtubeNextPageToken = null;
    console.log('❌ Youtube 聊天室已斷線');
}
