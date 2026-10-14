import { reportTraffic } from './ScriptLib/traffic/report.mjs';
import { closeDirectSigner } from './SignServer/direct-signer.mjs';
import { startOdyseeChat, stopOdyseeChat } from './ScriptLib/odysee/chat.mjs';
import { startYoutubeChat, stopYoutubeChat } from './ScriptLib/youtube/chat.mjs';
import { createNotifier } from './ScriptLib/notify/index.mjs';
import { normalizeSource } from './MessageSource.mjs';
import { startTwitchClient, stopTwitchClient, getUserIcon, apiClient, tuser } from './ScriptLib/twitch/client.mjs';
import { onViewer as twitchOnViewer, onError as twitchOnError, onStreamOnline as twitchOnStreamOnline, onStreamOffline as twitchOnStreamOffline, onFollow as twitchOnFollow, onCheer as twitchOnCheer } from './ScriptLib/twitch/events.mjs';
import { createClipService } from './ScriptLib/twitch/clip.mjs';
import { onChat as twitchOnChat } from './ScriptLib/twitch/chat.mjs';
import { promises as fs, readFileSync, existsSync, writeFileSync } from 'fs';
import axios from 'axios';

import { createHub } from './ScriptLib/socket/hub.mjs';
import { MessageDedup } from './ScriptLib/socket/dedup.mjs';
import { createGiftNameStore } from './ScriptLib/gift/names.mjs';
import { createSponsorStore } from './ScriptLib/sponsor/store.mjs';
import { createAdScheduler } from './ScriptLib/sponsor/scheduler.mjs';
import { createSentCache } from './ScriptLib/sponsor/sent-cache.mjs';
import { TikTokChatGuard, chatMetadata } from './TikTokChatGuard.mjs';



import path from 'path';

import { fileURLToPath } from 'url';

// 在 ESM 裡手動定義 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


import { TikTokLiveConnection, WebcastEvent,ControlEvent,ControlAction } from 'tiktok-live-connector';
import { setupCustomSignServer, waitForSigner, setStreamerName } from './SignServer/index.js';
import Translate from "./TranslateTest.js"
import { recordMessageStat, getTopMessages, getAllMessageStatsSorted, processFilter, clearStats, takeThrottleSummaries } from "./MessageFilter.js"
import { replaceEmojis, loadEmojiMap, getEmojiMap } from "./EmojiMap.js"
import { startKickChat } from './ScriptLib/kick/chat.mjs';
import console from 'console';
import { AutoClipManager } from './AutoClip.js'

import { fork } from 'child_process'





/**
 * 將日誌訊息追加到檔案尾端
 * @param {string} filename - 日誌檔案名稱 Default使用預設
 * @param {string} message - 要寫入的訊息
 * @param {string} type - 訊息類型 (預設為 "Other"，可用於區分不同類型的訊息)
 */
function writeLog(filename="TikTokRun.log", message,type="Other") {
  
  var FileN = filename
  if (filename.toLowerCase().startsWith("default")) {
    FileN = "TikTokRun.log"
  }

  const logPath = path.resolve(__dirname, FileN);

  const logLine = `[${type}] ${new Date().toLocaleString()} - ${message}\n`;

  fs.appendFile(logPath, logLine, (err) => {
    if (err) {
      console.error('寫入日誌失敗:', err);
    }
  });
}


// Translate.TranslateText("Hello User").then(RES=>{
//     console.log("測試翻譯",RES)
// })

process.loadEnvFile(".env"); // 讀取 .env


const isDebugChild = process.env.DEBUG_CHILD === 'true';

if (isDebugChild) {

fork('TikTok.js', [], {
  execArgv: ['--inspect=9237'] // 指定子程序的 debug port
});


}



// node 內建：process.argv
// argv[0] = node 路徑 / user?
// argv[1] = TikTok.js 路徑
// argv[2] 開始才是你傳的參數

const args = process.argv.slice(2)

// 你要的後綴參數
const keyword = args.find(a => !a.startsWith('-')) || ''

console.log('啟動參數:', args.join(' '));


let isTK = args.includes('--tiktok')
let isTwitch = args.includes('--twitch')
let isKick = args.includes('--kick')
let isOdysee = args.includes('--odysee')
let isYoutube = args.includes('--youtube')


let isBark = args.includes('--bark')


let isNtfy = args.includes('--ntfy')


let isSocket = args.includes('--socket')

let isBoth = args.includes('--both')

// 解析 --platforms=tiktok,twitch,kick 組合參數
const platformsArg = args.find(a => a.startsWith('--platforms='))
if (platformsArg) {
    const list = platformsArg.split('=')[1].split(',').map(p => p.trim().toLowerCase())
    isTK = list.includes('tiktok')
    isTwitch = list.includes('twitch')
    isKick = list.includes('kick')
    isOdysee = list.includes('odysee')
    isYoutube = list.includes('youtube')
} else if (isBoth) {
    // 向後相容：--both → tiktok + twitch
    isTK = true
    isTwitch = true
}

console.log('收到參數:', keyword, isTK ? '(TikTok)' : '', isTwitch ? '(Twitch)' : '', isKick ? '(Kick)' : '', isOdysee ? '(Odysee)' : '', isYoutube ? '(Youtube)' : '');

console.log('isBark=', isBark, 'isNtfy=', isNtfy, 'isSocket=', isSocket, 'isTwitch=', isTwitch, 'isKick=', isKick, 'isOdysee=', isOdysee, 'isYoutube=', isYoutube);
console.log('isBoth=', isBoth, 'platforms=', platformsArg ? platformsArg.split('=')[1] : '');

// TikTok 用戶名稱

const tiktokName = keyword.length > 0 ? keyword : process.env.TIKTOK_NAME || "coffeelatte0709";
const odyseeChannelName = process.env.ODYSEE_CHANNEL_NAME || keyword || '';
const youtubeChannelName = process.env.YOUTUBE_CHANNEL_ID || keyword || '';
const youtubeApiKey = process.env.YOUTUBE_API_KEY || '';
const youtubePollIntervalS = parseInt(process.env.YOUTUBE_POLL_INTERVAL_S) || 30


// --- 4. Socket 客戶端 ---

let isFirstSocketConnect = true;
let autoClip = null;
function applyRelayAudience(data) {
    const source = normalizeSource(data, 'userscript');
    if (!source.heatEligible || data.audienceKind === 'top-fans' || !Number.isFinite(data.userNum) || data.userNum < 0) return;
    autoClip?.updatePlatformViewers(source.platform, data.userNum);
    if (source.platform === 'TikTok') TikTokViewerCount = data.userNum;
    else if (source.platform === 'Twitch') TwitchViewerCount = data.userNum;
    else if (source.platform === 'Youtube') YoutubeViewerCount = data.userNum;
    else if (source.platform === 'Odysee') OdyseeViewerCount = data.userNum;
    updateCombinedViewerCount();
}
function recordChatHeat(message, metadata) {
    metadata = { ...metadata, ...normalizeSource(metadata) };
    autoClip?.observeTransport(metadata);
    const event = recordMessageStat(message, metadata);
    if (event) autoClip?.onChatMessage(event);
    return event;
}
// 頻率規則（throttle）summarize 的摘要：定時檢查「爆量已結束」的群組並送出。
setInterval(() => {
    try {
        for (const summary of takeThrottleSummaries()) {
            console.log('🗒️ 頻率摘要:', summary.user, summary.message);
            writeLog("Default", `頻率摘要: ${summary.user} : ${summary.message}`, "ThrottleSummary");
            sendSocketMessage(summary.user || "系統", summary.message, "", "", false, CacheUserNum, CacheUserList);
        }
    } catch (err) {
        console.error('⚠️ 頻率摘要送出失敗:', err.message);
    }
}, 5000).unref();

/**
 * 回報「被過濾器擋下」的事件：只進攔截率與廣告比例統計，不算聊天數。
 * 廣告類規則由規則的 `ad` 旗標或名稱含「廣告」判定（MessageFilter 端算好放在 fr.ad）。
 */
function reportFiltered(fr, meta) {
    reportTraffic({ ...meta, type: 'filter', rule: fr.reason, ad: fr.ad === true });
}

const tikTokChatGuard = new TikTokChatGuard();
let lastTikTokReplayLog = 0;
let tikTokReplayDropped = 0;

// TikTok 直播間斷線自動重連（有限次數 + 指數退避）
let tkReconnectTimer = null;   // 重連計時器
let viewCacheInterval = null;  // viewer 更新 interval handle（斷線時確實清除，避免重連後疊加）
let viewCacheFailures = 0;     // 連續的 fetchRoomInfo 失敗次數，用來診斷觀看數為何沒更新
let streamEnded = false;       // 直播真正結束（使用者主動結束 / 平台封鎖）→ 不再重連
const TK_RETRY_BASE = 15000;   // 重連基礎間隔 15 秒（指數退避 15s→30s→60s→120s→240s）

// Socket 輸出層：端點／去重／扇出皆在 ScriptLib/socket/。
const dedup = new MessageDedup();
const socketHub = createHub({
    socketApi: process.env.SOCKET_API || 'tcp://localhost:9322',
    enabled: isSocket,
    replaceEmojis,
    dedup,
    onConnect: () => {
        if (isFirstSocketConnect) {
            sendSocketMessage("系統", "TTW Chat Message Server 已連線", "", "", false, CacheUserNum, CacheUserList);
            isFirstSocketConnect = false;
        }
    }
});

const Bark = process.env.BARK_API;
const Ntfy = process.env.NTFY_API;

// 推播輸出層：Bark／ntfy 通道與分派器皆在 ScriptLib/notify/。
// notify() 一次扇出到所有已啟用通道，事件點不必知道有哪些通道。
const notifier = createNotifier({ isBark, isNtfy, barkApi: Bark, ntfyApi: Ntfy, getEmojiMap, axios });
const notify = (title, comment, icon, url) => notifier.notify(title, comment, icon, url);

const TRANSLATE_API_URL = process.env.TRANSLATE_API_URL || "https://api.mymemory.translated.net/get";
const TRANSLATE_SOURCE_LANG = process.env.TRANSLATE_SOURCE_LANG || "en";
const TRANSLATE_TARGET_LANG = process.env.TRANSLATE_TARGET_LANG || "zh-TW";


const GIFT_TRANSLATE_PREFILL_LIMIT = Number(process.env.GIFT_TRANSLATE_PREFILL_LIMIT || 10);

// ---- 贊助廣告 (G#Ad) 持久化 ----
const SPONSOR_ADS_FILE = path.join(__dirname, 'sponsor_ads.json');
const SPONSOR_MANAGE_URL = process.env.SPONSOR_MANAGE_URL || 'http://localhost:3332/sponsor';
const sponsorStore = createSponsorStore({ fs: { existsSync, readFileSync, writeFileSync }, file: SPONSOR_ADS_FILE });
const sponsorAds = sponsorStore.state;
const adScheduler = createAdScheduler({
    deliver: (user, text, iconURL, useTTS) => sendAdOverylayMessage(user, text, iconURL, useTTS),
    notify, store: sponsorStore, manageUrl: SPONSOR_MANAGE_URL
});

const CACHE_FILE = path.resolve("./send_messages.json");
const GIFT_MAP_FILE = path.resolve("./gift_map.json");
const GIFT_MAP_EXAMPLE_FILE = path.resolve("./gift_map.example.json");
const GIFT_LIST_FILE = path.resolve("./gift_list.json");
const sentCache = createSentCache({ fs, file: CACHE_FILE });

const clipService = createClipService({
    getApiClient: () => apiClient,
    getTuser: () => tuser,
    fs: { existsSync, readFileSync, writeFileSync },
    file: path.join(__dirname, 'clip_history.json'),
    writeLog, notify, sendSocketMessage
});

const kickDeps = {
    channelName: process.env.KICK_USER_NAME || keyword || '',
    writeLog,
    notify,
    sendSystem: (text) => sendSocketMessage("系統", text, "", "", false, CacheUserNum, CacheUserList),
    sendChat: (user, message, avatar) => sendSocketMessage(user, message, avatar, "", true, CacheUserNum, CacheUserList),
    sendNotice: (user, message, avatar) => sendSocketMessage(user, message, avatar, "", false, CacheUserNum, CacheUserList),
    reportTraffic,
    reportFiltered,
    filter: processFilter,
    recordHeat: recordChatHeat,
    replaceEmojis,
    translate: (text) => Translate.TranslateText(text),
    axios,
    logger: console,
};


var isEnd=false

const EXIT_TIMEOUT_MS = 8000;

async function handleExit() {
    console.log("⏹️ 程式結束，開始收尾...");

    // 收尾若卡住（網路 / Puppeteer），必須有硬性上限，否則行程永遠不退出，
    // 主程式會一直停在 stopping 且之後無法重新啟動。
    const forceTimer = setTimeout(() => {
        console.error(`⏹️ 收尾逾時（${EXIT_TIMEOUT_MS}ms），強制退出`);
        process.exit(0);
    }, EXIT_TIMEOUT_MS);
    forceTimer.unref?.();

    isEnd = true;

    if (tkReconnectTimer) { clearTimeout(tkReconnectTimer); tkReconnectTimer = null; }
    if (viewCacheInterval) { clearInterval(viewCacheInterval); viewCacheInterval = null; }
    stopYoutubeChat();
    stopOdyseeChat();
    stopTwitchClient();
    console.log("⏹️ 已停止重連／計時器");

    notify("系統通知", "TTW Chat Message Server 已關閉", "");

    try {
        await socketHub.close({
            type: 'StreamMessage', category: 'system', user: '系統', message: 'TTW Chat Message Server 已關閉',
            img: '', giftImg: '', isMain: false
        });
        console.log("⏹️ Socket 已關閉");
    } catch (err) {
        console.error("⏹️ Socket 關閉失敗（仍繼續退出）:", err?.message || err);
    }

    adScheduler.clearAll();
    sponsorStore.save();

    try {
        await sentCache.save();
        console.log("⏹️ send_messages 已儲存");
    } catch (err) {
        console.error("⏹️ 儲存 send_messages 失敗（仍繼續退出）:", err?.message || err);
    }

    try {
        await closeDirectSigner();
        console.log("⏹️ direct signer 已關閉");
    } catch (err) {
        console.error("⏹️ 關閉 direct signer 失敗（仍繼續退出）:", err?.message || err);
    }

    // 統計統一由 Server.js 管理：此處把最終快照回傳，讓 Server.js 合併進它自己的統計。
    // 若 stdout 一直不排空，交由 forceTimer 收尾。
    try {
        const allStats = getAllMessageStatsSorted();
        process.stdout.write(JSON.stringify({ type: "all", data: allStats }) + '\n', () => {
            console.log("✅ 優雅退出完成");
            process.exit(0);
        });
    } catch (err) {
        console.error("⏹️ 輸出最終統計失敗，強制退出:", err?.message || err);
        process.exit(0);
    }
}

// 啟動是否已完成（頂層初始化全部跑完）。ESM 頂層 await 一旦 reject，後續頂層程式不會
// 再執行；因此啟動期間的未捕捉例外代表程式處於半初始化狀態（例如 socket 從未 connect），
// 必須直接結束，不能像執行期例外那樣吞掉後繼續跑。
let startupComplete = false;

/** 把任意被丟出的值轉成可讀字串（Error 附完整 stack）；非 Error 值也不會讓處理器自己爆掉。 */
function describeError(value) {
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    if (value && typeof value === 'object') {
        try { return JSON.stringify(value); } catch { return String(value); }
    }
    return String(value);
}

process.on('unhandledRejection', (reason) => {
    console.error('未捕獲的 Promise 拒絕，防止崩潰:\n' + describeError(reason));
});

process.on('uncaughtException', (err) => {
    const detail = describeError(err);
    console.error('未捕獲的例外，防止崩潰:\n' + detail);
    const shortMsg = detail.split('\n')[0].substring(0, 100);

    if (!startupComplete) {
        console.error('❌ 啟動階段致命錯誤：頂層初始化已被中止，程式無法正常運作，即將結束 (exit 1)。');
        console.error(`   診斷：socket connected=${socketHub.primary?.connected ?? false} queued=${socketHub.primary?.transport.queue.length ?? 0} reconnects=${socketHub.primary?.transport.stats.reconnects ?? 0}`);
        // Bark 非同步，先送出再結束；硬性逾時避免卡住結束流程。
        const forceExit = setTimeout(() => process.exit(1), 5000);
        Promise.resolve()
            .then(() => notify("TikTok.js 啟動失敗", shortMsg))
            .catch(() => {})
            .finally(() => { clearTimeout(forceExit); process.exit(1); });
        return;
    }

    notify("TikTok.js 發生錯誤", shortMsg);
    sendSocketMessage("系統", `TikTok.js 發生錯誤: ${shortMsg}`, "", "", false, CacheUserNum, CacheUserList);
});

let stdinBuffer = '';

process.stdin.on('data', async (chunk) => {
    stdinBuffer += chunk.toString();

    let lines = stdinBuffer.split('\n');
    stdinBuffer = lines.pop(); // 留下未完成的半行

    for (const line of lines) {
        const msg = line.trim();
        if (!msg) continue;

        // 🔴 純文字指令
        if (msg === 'EXIT') {
            await handleExit();
            
            return;
        }

        // 🔴 純文字指令
        if (msg === 'GETTOP') {
            const topMessages = getTopMessages(10);
            
            console.log("📈 最高出現次數訊息:\n", topMessages);
            
            // 回傳給 Server.js
            process.stdout.write(JSON.stringify({
                type: "top10",
                data: topMessages
            }) + '\n');

            return;
        }
        // 🔴 純文字指令
        if (msg === 'GETALL') {
            const allMessages = getAllMessageStatsSorted();
            
            console.log("📈 所有訊息統計:\n", allMessages);
            
            // 回傳給 Server.js
            process.stdout.write(JSON.stringify({
                type: "all",
                data: allMessages
            }) + '\n');

            return;
        }

        // 🔴 純文字指令：清空統計（由 Server.js 的 /keyword/clear 觸發）
        if (msg === 'CLEAR') {
            clearStats();
            console.log('🗑️ 已清空關鍵字統計 (由 Server 要求)');
            return;
        }

        // 🔴 純文字指令：清空自動剪輯分析歷史（由 Server.js 的 /autoclip/clear 觸發）
        if (msg === 'AUTOCLIP_CLEAR') {
            autoClip?.clearHistory();
            console.log('🗑️ 已清空自動剪輯分析歷史 (由 Server 要求)');
            return;
        }

        // 🔴 Kick 啟動指令
        if (msg === 'KICK_START') {
            if (!isKick) {
                isKick = true;
                startKickChat(kickDeps);
            }
            return;
        }

        // 🟢 JSON 訊息
        try {
            const json = JSON.parse(msg);


            if (json.type === 'audience') { applyRelayAudience(json); return; }

            // 由 Server.js 轉來的頻率摘要：直接顯示，不再過濾（避免摘要本身被同一條規則攔下）。
            if (json.type === 'ThrottleSummary') {
                sendSocketMessage(json.user || '系統', json.message, '', '', false, CacheUserNum, CacheUserList);
                return;
            }

            if (json.type === 'StreamMessage') {
                // 先存原始值供去重比對
                const origUser = json.user;
                const origMsg = json.message;

                json.message = replaceEmojis(json.message);

                const fr = processFilter({ user: json.user, message: json.message });
                if (fr.blocked) {
                    console.log('🚫 過濾器阻擋(來自Server):', json.user, json.message, `(規則: ${fr.reason})`);
                    return;
                }
                if (fr.modified && fr.user) json.user = fr.user;
                if (fr.modified && fr.message) json.message = fr.message;

                if (!recordChatHeat(json.message, { ...normalizeSource(json, 'userscript'), id: json.msgId || json.id, sentAt: json.sentAt || json.createTime, userId: json.userId, user: origUser, receivedAt: json.receivedAt || Date.now() })) return;

                applyRelayAudience(json);

                sendSocketMessage(json.user, json.message, json.img || '', json.giftImg || '', true, CacheUserNum, CacheUserList, origUser, origMsg);

                dedup.add(origUser, origMsg);

                let Gift = json.giftImg || ''

                notify(json.user, json.message, json.img || Gift);

                console.log('📥 收到 JSON 訊息:', json);
                return;
            }

            // ---- 贊助廣告管理指令 ----
            if (json.type === 'SPONSOR_SETTINGS' && json.settings) {
                sponsorAds.settings = { ...sponsorAds.settings, ...json.settings };
                sponsorStore.save();
                console.log('⚙️ 贊助廣告設定已更新:', sponsorAds.settings);
                return;
            }

            if (json.type === 'SPONSOR_APPROVE' && json.adId) {
                for (const uid of Object.keys(sponsorAds.users)) {
                    const ad = sponsorAds.users[uid].ads.find(a => a.id === json.adId);
                    if (ad) {
                        ad.approved = json.approved;
                        ad.updatedAt = new Date().toISOString();
                        if (json.approved === true) {
                            ad.enabled = ad.intervalMinutes >= 15;
                            sendAdOverylayMessage(ad.overlayUser, ad.message, ad.iconURL || '', ad.useTTS);
                            console.log(`✅ 已審核通過贊助廣告: ${ad.overlayUser} - ${ad.message}`);
                            if (ad.intervalMinutes >= 15) {
                                adScheduler.schedule(ad.id, uid, ad.intervalMinutes, {
                                    overlayUser: ad.overlayUser,
                                    text: ad.message,
                                    iconURL: ad.iconURL || '',
                                    useTTS: ad.useTTS
                                });
                            }
                        } else {
                            adScheduler.clear(ad.id);
                            ad.enabled = false;
                            console.log(`❌ 已拒絕贊助廣告: ${ad.overlayUser} - ${ad.message}`);
                        }
                        sponsorStore.save();
                        process.stdout.write(JSON.stringify({ type: 'SPONSOR_UPDATED', adId: ad.id, approved: ad.approved }) + '\n');
                        return;
                    }
                }
                console.warn(`⚠️ 未找到贊助廣告: ${json.adId}`);
                return;
            }

            if (json.type === 'SPONSOR_TOGGLE' && json.adId) {
                for (const uid of Object.keys(sponsorAds.users)) {
                    const ad = sponsorAds.users[uid].ads.find(a => a.id === json.adId);
                    if (ad) {
                        ad.enabled = json.enabled;
                        ad.updatedAt = new Date().toISOString();
                        if (json.enabled && ad.approved !== false && ad.intervalMinutes >= 15) {
                            adScheduler.schedule(ad.id, uid, ad.intervalMinutes, {
                                overlayUser: ad.overlayUser,
                                text: ad.message,
                                iconURL: ad.iconURL || '',
                                useTTS: ad.useTTS
                            });
                            if (!ad.lastSentAt) {
                                sendAdOverylayMessage(ad.overlayUser, ad.message, ad.iconURL || '', ad.useTTS);
                                ad.lastSentAt = new Date().toISOString();
                            }
                        } else {
                            adScheduler.clear(ad.id);
                        }
                        sponsorStore.save();
                        console.log(`🔁 贊助廣告已${json.enabled ? '啟用' : '停用'}: ${ad.overlayUser} - ${ad.message}`);
                        return;
                    }
                }
                console.warn(`⚠️ 未找到贊助廣告: ${json.adId}`);
                return;
            }

            if (json.type === 'SPONSOR_DELETE' && json.adId) {
                for (const uid of Object.keys(sponsorAds.users)) {
                    const idx = sponsorAds.users[uid].ads.findIndex(a => a.id === json.adId);
                    if (idx !== -1) {
                        adScheduler.clear(json.adId);
                        sponsorAds.users[uid].ads.splice(idx, 1);
                        if (sponsorAds.users[uid].ads.length === 0) {
                            delete sponsorAds.users[uid];
                        }
                        sponsorStore.save();
                        console.log(`🗑️ 已刪除贊助廣告: ${json.adId}`);
                        return;
                    }
                }
                console.warn(`⚠️ 未找到贊助廣告: ${json.adId}`);
                return;
            }

            if (json.type === 'SPONSOR_TRIGGER' && json.adId) {
                sponsorStore.load();
                for (const uid of Object.keys(sponsorAds.users)) {
                    const ad = sponsorAds.users[uid].ads.find(a => a.id === json.adId);
                    if (ad) {
                        if (ad.approved === false) {
                            console.warn(`⚠️ 贊助廣告已被拒絕，略過手動發送: ${json.adId}`);
                            return;
                        }
                        const now = json.sentAt || new Date().toISOString();
                        sendAdOverylayMessage(ad.overlayUser, ad.message, ad.iconURL || '', ad.useTTS);
                        notify(`📢 手動發送贊助廣告 (${ad.overlayUser})`, ad.message, ad.iconURL || '', SPONSOR_MANAGE_URL);
                        ad.lastSentAt = now;
                        ad.updatedAt = now;
                        sponsorStore.save();
                        if (ad.enabled && ad.intervalMinutes >= 15) {
                            adScheduler.schedule(ad.id, uid, ad.intervalMinutes, {
                                overlayUser: ad.overlayUser,
                                text: ad.message,
                                iconURL: ad.iconURL || '',
                                useTTS: ad.useTTS
                            });
                        }
                        console.log(`📢 已手動發送贊助廣告: ${ad.overlayUser} - ${ad.message}`);
                        process.stdout.write(JSON.stringify({ type: 'SPONSOR_TRIGGERED', adId: ad.id, sentAt: now }) + '\n');
                        return;
                    }
                }
                console.warn(`⚠️ 未找到贊助廣告: ${json.adId}`);
                return;
            }

            if (json.type === 'SPONSOR_CREATE') {
                const { userId, displayName, message, iconURL, useTTS, overlayUser, intervalMinutes, targetId, alreadyPersisted, adId: persistedAdId } = json;
                if (!userId || !message) {
                    console.warn('⚠️ SPONSOR_CREATE 缺少必要欄位');
                    return;
                }
                // Server.js 已直接寫入 JSON → 重新載入後僅套用執行期效果（立即發送 + 定時器），避免重複建立
                if (alreadyPersisted) {
                    sponsorStore.load();
                    const sponsor = sponsorAds.users[userId];
                    const ad = sponsor && sponsor.ads.find(a => a.id === persistedAdId);
                    if (!ad) {
                        console.warn(`⚠️ SPONSOR_CREATE 找不到已持久化廣告: ${persistedAdId}`);
                        return;
                    }
                    sendAdOverylayMessage(ad.overlayUser, ad.message, ad.iconURL || '', ad.useTTS);
                    if (ad.intervalMinutes >= 15) {
                        adScheduler.schedule(ad.id, userId, ad.intervalMinutes, {
                            overlayUser: ad.overlayUser, text: ad.message, iconURL: ad.iconURL || '', useTTS: ad.useTTS
                        });
                    }
                    console.log(`✅ 已套用贊助廣告執行期效果 (Server 持久化): ${ad.overlayUser} - ${ad.message}`);
                    process.stdout.write(JSON.stringify({ type: 'SPONSOR_CREATED', adId: ad.id }) + '\n');
                    return;
                }
                const sponsor = sponsorStore.getOrCreate(userId, displayName || userId);
                const now = new Date().toISOString();

                // 有指定 targetId 且存在 → 更新；否則新增（上限 5）
                if (typeof targetId === 'number' && targetId >= 0 && targetId < sponsor.ads.length) {
                    const ad = sponsor.ads[targetId];
                    adScheduler.clear(ad.id);
                    ad.message = message;
                    ad.iconURL = iconURL || null;
                    ad.useTTS = !!useTTS;
                    ad.overlayUser = overlayUser || displayName || userId;
                    ad.intervalMinutes = intervalMinutes || 0;
                    ad.enabled = true;
                    ad.updatedAt = now;
                    ad.lastSentAt = now;
                    sendAdOverylayMessage(ad.overlayUser, message, ad.iconURL || '', ad.useTTS);
                    if (intervalMinutes >= 15) {
                        adScheduler.schedule(ad.id, userId, intervalMinutes, {
                            overlayUser: ad.overlayUser, text: message, iconURL: ad.iconURL || '', useTTS: ad.useTTS
                        });
                    }
                    sponsorStore.save();
                    console.log(`🔄 手動更新贊助廣告 #${targetId}: ${ad.overlayUser} - ${message}`);
                    process.stdout.write(JSON.stringify({ type: 'SPONSOR_CREATED', adId: ad.id }) + '\n');
                    return;
                }

                if (sponsor.ads.length >= 5) {
                    console.warn(`⚠️ 手動建立贊助廣告失敗：${userId} 已達 5 則上限`);
                    return;
                }
                const adId = `ad_${userId}_${Date.now()}`;
                const adRecord = {
                    id: adId, message, iconURL: iconURL || null, useTTS: !!useTTS,
                    overlayUser: overlayUser || displayName || userId,
                    intervalMinutes: intervalMinutes || 0,
                    approved: true, enabled: true,
                    createdAt: now, updatedAt: now, lastSentAt: now
                };
                sponsor.ads.push(adRecord);
                sponsorStore.save();
                sendAdOverylayMessage(adRecord.overlayUser, message, adRecord.iconURL || '', adRecord.useTTS);
                if (intervalMinutes >= 15) {
                    adScheduler.schedule(adId, userId, intervalMinutes, {
                        overlayUser: adRecord.overlayUser, text: message, iconURL: adRecord.iconURL || '', useTTS: adRecord.useTTS
                    });
                }
                console.log(`✅ 手動建立贊助廣告成功: ${adRecord.overlayUser} - ${message}`);
                process.stdout.write(JSON.stringify({ type: 'SPONSOR_CREATED', adId }) + '\n');
                return;
            }

        } catch {
            console.error('stdin JSON 解析失敗:', msg);
        }
    }
});

process.on("SIGINT", async () => {
    await handleExit();
});

process.on("SIGTERM", async () => {
    console.log("Received SIGTERM, exiting gracefully...");
    await handleExit();
});

sentCache.load()
// 禮物名稱翻譯／快取（gift_map.json、gift_list.json）在 ScriptLib/gift/。
const giftNames = createGiftNameStore({
    fs,
    axios,
    translateApiUrl: TRANSLATE_API_URL,
    sourceLang: TRANSLATE_SOURCE_LANG,
    targetLang: TRANSLATE_TARGET_LANG,
    prefillLimit: GIFT_TRANSLATE_PREFILL_LIMIT,
    giftMapFile: GIFT_MAP_FILE,
    giftMapExampleFile: GIFT_MAP_EXAMPLE_FILE,
    giftListFile: GIFT_LIST_FILE,
});
const giftMapReady = giftNames.ready;
loadEmojiMap();
sponsorStore.load();
adScheduler.resume();


console.log("TikTok 直播間名稱:", tiktokName);
setStreamerName(tiktokName);

const eulerKey = process.env.SIGN_API_KEY || process.env.SIGN_API;
const hasDirectCreds = process.env.DIRECT_SIGNER_ENABLED === '1' || !!(process.env.TIKTOK_COOKIES || process.env.SESSION_ID);
const useDirect = hasDirectCreds && (!eulerKey || process.env.DIRECT_SIGNER_PRIORITY === '1');
const connOpts = {};

if (useDirect) {
    connOpts.session = {
        cookie: {
            type: 'cookie',
            value: {
                sessionId: process.env.SESSION_ID || '',
                ttTargetIdc: process.env.TT_TARGET_IDC || 'alisg'
            }
        }
    };
    console.log('[TikTok] Using persistent browser signer');
} else if (eulerKey) {
    connOpts.signApiKey = eulerKey;
    console.log('[TikTok] Using EulerStream signer (SIGN_API_KEY)');
} else if (hasDirectCreds) {
    connOpts.session = {
        cookie: {
            type: 'cookie',
            value: {
                sessionId: process.env.SESSION_ID || '',
                ttTargetIdc: process.env.TT_TARGET_IDC || 'alisg'
            }
        }
    };
    console.warn('[TikTok] Using direct signer (no EulerStream key available)');
} else {
    console.warn('[TikTok] No TIKTOK_COOKIES/SESSION_ID or SIGN_API_KEY — signing may fail');
}

const connection = new TikTokLiveConnection(tiktokName, connOpts)

























var CacheUserList = [] // 用於去重的用戶列表
var CacheUserNum = 0 // 用於去重的用戶數量
var TikTokViewerCount = 0
var TwitchViewerCount = 0
var OdyseeViewerCount = 0
var YoutubeViewerCount = 0


function sendAdOverylayMessage(user,text,iconURL,useTTS){

    const payload = { type: 'AdOverlay', category: 'ad', user, text, iconURL, useTTS };
    
    console.log('📤 發送 AdOverlay 訊息:', payload);
    socketHub.send(payload);
}


/**
 * 觀眾人數更新
 *
 * @return {*} 
 */
function sendAudienceUpdate() {
    const payload = { type: 'audience', category: 'audience', userNum: CacheUserNum, userList: CacheUserList };
    socketHub.send(payload);
}

function updateCombinedViewerCount() {
    let combined = 0
    if (isTK) combined += TikTokViewerCount || 0
    if (isTwitch) combined += TwitchViewerCount || 0
    if (isOdysee) combined += OdyseeViewerCount || 0
    if (isYoutube) combined += YoutubeViewerCount || 0
    CacheUserNum = combined
    sendAudienceUpdate()
}

/**
 * 用於發送 Socket 訊息的統一函數，會先檢查是否重複，再格式化後發送
 * 
 * @param {*} user 
 * @param {*} message 
 * @param {*} img 
 * @param {*} giftImg 
 * @param {*} isMain 
 * @param {*} userNum 
 * @param {*} userList 
 * @returns 
 */
function sendSocketMessage(user, message, img, giftImg, isMain = true, userNum = 0, userList = [], dedupUser, dedupMessage, category) {
    socketHub.sendMessage(user, message, { img, giftImg, isMain, userNum, userList, dedupUser, dedupMessage, category });
}

var TkRetryCount = 0
let TkRetryMaxCount = 5

function connectSocket() {
    socketHub.connect();
}


var RoomID = ""
var writeViewCount = 0
var writeDebugView = false

// 從房間資訊取真實開播時間；TikTok room/info 以秒為單位，找不到回 undefined，
// 不用首次接收時間代替（traffic 的 actualStarted 規則）。
function roomStartTime(roomInfo) {
    const data = roomInfo?.data ?? roomInfo ?? {};
    const candidates = [data.start_time, data.create_time, data.startTime, data.createTime, data.room_info?.start_time];
    for (const value of candidates) {
        let ms = Number(value);
        if (!Number.isFinite(ms) || ms <= 0) continue;
        if (ms < 1e11) ms *= 1000;              // 秒 → 毫秒
        if (ms <= Date.now()) return new Date(ms).toISOString();
    }
    return undefined;
}

// 只印一次，用來確認房資實際提供哪些開播時間欄位（欄位名可能隨 TikTok 改版）。
let startTimeProbeLogged = false;
function probeStartTimeOnce(roomInfo, startedAt) {
    if (startTimeProbeLogged) return;
    startTimeProbeLogged = true;
    const data = roomInfo?.data ?? {};
    const sample = ['start_time', 'create_time', 'startTime', 'createTime', 'finish_time', 'status', 'id']
        .map(key => `${key}=${data[key] ?? '∅'}`).join(' ');
    console.log(`🕒 TikTok 開播時間探測：${startedAt ?? '未取得'}｜${sample}`);
    if (!startedAt) console.log('🕒 TikTok 房資欄位：', Object.keys(data).join(','));
}

function viewCache() {
    console.log("📊 CacheUserNum:", CacheUserNum)
    console.log("📋 CacheUserList:", CacheUserList);

    connection.fetchRoomInfo(RoomID).then(async (roomInfo) => {
        viewCacheFailures = 0
        let Viewer = roomInfo.data.user_count

        if (writeViewCount > 100 && writeDebugView) {
            writeLog("Default", `DEBUG View:\n${JSON.stringify(roomInfo)}`, "View統計")
            console.log("🔄 更新觀眾數量 寫入Debug_RoomInfo數據:", Viewer)
            writeViewCount = 0
        }

        writeViewCount += 1
        const startedAt = roomStartTime(roomInfo);
        probeStartTimeOnce(roomInfo, startedAt);
        reportTraffic({platform:'TikTok',type:'audience',userNum:Number(Viewer),streamId:RoomID != null ? String(RoomID) : undefined,startedAt});
        autoClip?.updatePlatformViewers('TikTok', Number(Viewer));
        TikTokViewerCount = Viewer
        updateCombinedViewerCount();

    }).catch(err => {
        viewCacheFailures += 1
        console.log(`RoomError（連續 ${viewCacheFailures} 次，觀看數不會更新）:`, err.message)
    })
}

// TikTok 連線成功後的共同初始化（初次連線與重連共用）
function onTikTokConnected(state) {
    TkRetryCount = 0;
    if (tkReconnectTimer) { clearTimeout(tkReconnectTimer); tkReconnectTimer = null; }
    RoomID = state.roomId;
    let DisplayTitle = connection.state.roomInfo.data.title || "未知直播間";
    TikTokViewerCount = connection.state.roomInfo.data.user_count || 0;
    CacheUserNum = (isTK && isTwitch) ? TikTokViewerCount + TwitchViewerCount : TikTokViewerCount;
    notify("TikTok 直播間連線成功", `已連接到 ${tiktokName} 的直播間 ${DisplayTitle}`, "");
    sendSocketMessage("系統", `TikTok 直播間連線成功，已連接到 ${tiktokName} 的直播間 ${DisplayTitle}`, "", "", false, CacheUserNum, CacheUserList);
    adScheduler.resume();
    if (!viewCacheInterval) {
        viewCacheInterval = setInterval(viewCache, 30000);
    }
}

// TikTok 斷線/連線失敗自動重連：指數退避 + 有限次數，次數用盡則優雅退出
function scheduleTikTokReconnect() {
    if (isEnd || streamEnded) return;
    if (tkReconnectTimer) return; // 已有排程，避免重複
    if (TkRetryCount >= TkRetryMaxCount) {
        console.error(`❌ TikTok 已達最大重連次數 (${TkRetryMaxCount})，停止重連並退出`);
        sendSocketMessage("系統", "TikTok 重連已達上限，程式停止，請手動重新啟動", "", "", false, CacheUserNum, CacheUserList);
        notify("TikTok 重連失敗", "已達最大重連次數，程式停止", "");
        handleExit();
        return;
    }
    TkRetryCount += 1;
    const delay = Math.min(TK_RETRY_BASE * Math.pow(2, TkRetryCount - 1), 300000);
    console.log(`🔁 TikTok 斷線，${Math.round(delay / 1000)} 秒後嘗試重新連線 (${TkRetryCount}/${TkRetryMaxCount})...`);
    sendSocketMessage("系統", `TikTok 斷線，${Math.round(delay / 1000)} 秒後嘗試重新連線 (${TkRetryCount}/${TkRetryMaxCount})`, "", "", false, CacheUserNum, CacheUserList);
    tkReconnectTimer = setTimeout(() => {
        tkReconnectTimer = null;
        if (isEnd || streamEnded) return;
        tikTokChatGuard.beginReconnect();
        connection.connect().then(state => {
            console.info(`✅ TikTok 重新連線成功，roomId ${state.roomId}`);
            onTikTokConnected(state);
        }).catch(err => {
            const errDetail = err.exception || err;
            console.error(`❌ TikTok 重連失敗: ${errDetail.message || errDetail} (${TkRetryCount}/${TkRetryMaxCount})`);
            sendSocketMessage("系統", `TikTok 重連失敗: ${String(errDetail.message || errDetail).substring(0, 80)}`, "", "", false, CacheUserNum, CacheUserList);
            scheduleTikTokReconnect(); // 遞迴進入下一次退避
        });
    }, delay);
}




if (isTK) {
    console.log("連接 TikTok 直播間:", tiktokName)

    // 初始化簽名服務（僅 TikTok 模式需要）
    setupCustomSignServer();

    // 等待簽名服務就緒
    console.log("等待簽名服務就緒...");
    await waitForSigner();

    // Connect to the chat (await can be used as well)
    connection.connect().then(state => {
        console.info(`Connected to roomId ${state.roomId}`);
        onTikTokConnected(state);
        // fetchAndSyncGifts(); // eulerstream 需付費，禮物名稱由收到事件時即時翻譯
        
    }).catch(err => {
        const errDetail = err.exception || err;
        console.error('Failed to connect', errDetail.message || errDetail);
        console.error('[TikTok] 完整錯誤:', JSON.stringify({
            message: errDetail.message,
            info: err.info,
            code: errDetail.code,
            type: errDetail.type,
        }, null, 2));
        notify("TikTok 直播間連線失敗", (errDetail.message || "").substring(0, 100));
        sendSocketMessage("系統", `TikTok 直播間連線失敗: ${err.message}`, "", "", false, CacheUserNum, CacheUserList);

        // 初次連線失敗也進入有限次數自動重連（指數退避，用盡後退出）
        scheduleTikTokReconnect();
    });

}


connection.on(ControlEvent.DISCONNECTED, (e) => {
    console.log('Disconnected :( (error code: ' + e.errorCode + ', reason: ' + e.reason + ')');
    
    notify("TikTok 直播間已斷線", `已從 ${tiktokName} 的直播間斷線`, "");
    sendSocketMessage("系統", `TikTok 直播間已斷線，已從 ${tiktokName} 的直播間斷線`, "", "", false,CacheUserNum,CacheUserList);

    if (viewCacheInterval) { clearInterval(viewCacheInterval); viewCacheInterval = null; }

    if (isEnd) return;

    // 直播真正結束（使用者結束 / 平台封鎖）→ 不重連；否則有限次數自動重連
    if (streamEnded) {
        console.log('⏹️ 直播已結束，不進行重連');
        return;
    }
    scheduleTikTokReconnect();
});

connection.on(ControlEvent.ERROR, (err) => {
    const msg = typeof err === 'object' ? (err.message || JSON.stringify(err)) : err;
    console.error('TikTok 連線錯誤:', msg);
    if (err && err.message === 'Unexpected server response: 200') {
        console.error('[TikTok] WebSocket 200 錯誤 — 簽名可能無效或連線協定不符');
    }
    sendSocketMessage("系統", `TikTok 連線錯誤: ${msg.substring(0, 100)}`, "", "", false, CacheUserNum, CacheUserList);
});

// ====== 原始訊息 Debug 日誌 ======
function logRawEvent(eventName, data) {
    if (!data) { console.log(`[RAW] ${eventName}: (no data)`); return; }
    const keys = Object.keys(data).filter(k => {
        const v = data[k];
        if (v === null || v === undefined) return false;
        if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
        return true;
    });
    const info = { event: eventName, keys };
    if (data.user && typeof data.user === 'object') {
        const u = data.user;
        info.user = {};
        if (u.displayId !== undefined) info.user.displayId = u.displayId;
        if (u.nickname !== undefined) info.user.nickname = u.nickname;
        if (u.id !== undefined) info.user.id = u.id;
        if (u.uniqueId !== undefined) info.user.uniqueId = u.uniqueId;
        if (u.role !== undefined) info.user.role = u.role;
        if (u.level !== undefined) info.user.level = u.level;
        if (u.badge !== undefined) info.user.badge = u.badge;
        if (u.isModerator !== undefined) info.user.isModer = u.isModerator;
        if (u.isSubscriber !== undefined) info.user.isSub = u.isSubscriber;
        if (u.isNewGifter !== undefined) info.user.isNewGifter = u.isNewGifter;
        if (Object.keys(info.user).length === 0) delete info.user;
    }
    if (data.gift && typeof data.gift === 'object') {
        const g = data.gift;
        info.gift = {};
        if (g.name !== undefined) info.gift.name = g.name;
        if (g.id !== undefined) info.gift.id = g.id;
        if (g.diamondCount !== undefined) info.gift.cost = g.diamondCount;
        if (g.repeatCount !== undefined) info.gift.repeat = g.repeatCount;
        if (g.repeatEnd !== undefined) info.gift.repeatEnd = g.repeatEnd;
        if (g.type !== undefined) info.gift.type = g.type;
        if (g.streakable !== undefined) info.gift.streakable = g.streakable;
        if (g.giftType !== undefined) info.gift.giftType = g.giftType;
        if (Object.keys(info.gift).length === 0) delete info.gift;
    }
    // Common fields
    if (data.content !== undefined) info.content = typeof data.content === 'string' ? data.content.substring(0, 120) : '[non-string]';
    if (data.action !== undefined) info.action = data.action;
    if (data.shareType !== undefined) info.shareType = data.shareType;
    if (data.shareTarget !== undefined) info.shareTarget = data.shareTarget;
    if (data.likeCount !== undefined) info.likeCount = data.likeCount;
    if (data.total !== undefined) info.total = data.total;
    if (data.count !== undefined) info.count = data.count;
    if (data.describe !== undefined) info.describe = data.describe;
    if (data.msgId !== undefined) info.msgId = data.msgId;
    if (data.createTime !== undefined) info.createTime = data.createTime;
    if (data.emoteId !== undefined) info.emoteId = data.emoteId;
    if (data.followRole !== undefined) info.followRole = data.followRole;
    if (data.memberCount !== undefined) info.memberCount = data.memberCount;
    if (data.viewersCount !== undefined) info.viewersCount = data.viewersCount;
    if (data.topViewers !== undefined) info.topViewers = data.topViewers;
    if (data.roomId !== undefined) info.roomId = data.roomId;
    if (data.subscribeType !== undefined) info.subscribeType = data.subscribeType;
    if (data.timestampMs !== undefined) info.timestampMs = data.timestampMs;
    if (data.currency !== undefined) info.currency = data.currency;
    if (data.amount !== undefined) info.amount = data.amount;
    if (data.multibuy !== undefined) info.multibuy = data.multibuy;
    console.log(`[RAW] ${JSON.stringify(info)}`);
}
// =================================

connection.on(WebcastEvent.CAPTION_MESSAGE, (data) => {
    logRawEvent('CAPTION_MESSAGE', data);
    var MES_CAPTION = [""]

    if (data.content.length) {
        const lines = data.content.map(c => `[${c.lang}] ${c.content}`).join(' ');

        MES_CAPTION.push`Caption (${data.timestampMs}): ${lines}`

        writeLog("Default", MES_CAPTION.join("\n"), "Caption")

    }
});

// 取得 TikTok v3 使用者頭像（avatarLarge → avatarMedium → avatarThumb）
function getTikTokProfilePic(user) {
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

// 取得人數和頭號觀眾列表的事件

connection.on(WebcastEvent.ROOM_USER, data => {
    logRawEvent('ROOM_USER', data);
    const viewerCount = data.total ?? data.totalUser ?? connection.state?.roomInfo?.data?.user_count;
    console.log(`Viewer Count: ${viewerCount}`);
    const ranksList = data.ranks || [];
    const topGifter = ranksList[0];
    if (topGifter?.user) {
        const uniqueId = topGifter.user.displayId;
        const nickname = topGifter.user.nickname;
        if (uniqueId) {
            console.log(`Top gifter uniqueId: ${uniqueId} (${topGifter.score})`);
        }
        if (nickname) {
            console.log(`Top gifter nickname: ${nickname} (${topGifter.score})`);
        }
    }

    CacheUserList = ranksList.map(item => item.user.nickname);
    CacheUserNum = viewerCount;
    autoClip?.updatePlatformViewers('TikTok', Number(viewerCount));
    sendAudienceUpdate();

});

// Define the events that you want to handle
// In this case we listen to chat messages (comments)

let memberBarkAccum = [];
let memberBarkTimer = null;

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

connection.on(WebcastEvent.MEMBER,data => {
    reportTraffic({platform:'TikTok',eventType:'join',id:data.msgId || data.common?.msgId,sentAt:data.createTime || data.common?.createTime,userId:data.user?.userId || data.user?.id,user:data.user?.nickname});
    logRawEvent('MEMBER', data);

    let iconn = getTikTokProfilePic(data.user)
    
    console.log(data.user.nickname,"加入了") 
    console.log("STATE View",connection.state.roomInfo.data.user_count,CacheUserNum) 

    // 跨路徑去重：檢查是否已被 userscript 路徑送出（檢查 syncBuffer）
    const isCrossPathDuplicate = dedup.isDuplicate(data.user.nickname.trim(), "加入了");

    if (isCrossPathDuplicate) {
        console.log('🚫 跨路徑重複(來自userscript):', data.user.nickname, "加入了");
        writeLog("Default", `跨路徑重複訊息被過濾(來自userscript): ${data.user.nickname} : 加入了`, "CrossPathDuplicate")
        return;
    }

    const fr = processFilter({ user: data.user.nickname, message: "加入了" });
    if (fr.blocked) {
        console.log('🚫 過濾器阻擋:', data.user.nickname, "加入了", `(規則: ${fr.reason})`);
        writeLog("Default", `過濾器阻擋訊息: ${data.user.nickname} : 加入了 (規則: ${fr.reason})`, "FilterBlocked")
        dedup.add(data.user.nickname.trim(), "加入了");
        return;
    }

    let nickname = fr.modified && fr.user ? fr.user : data.user.nickname;
    let message = fr.modified && fr.message ? fr.message : "加入了";

    if (!nickname || !message) {
        console.log('⚠️ 過濾後 nick/message 為空，跳過:', data.user.nickname, "加入了");
        writeLog("Default", `過濾後 nick/message 為空，跳過: ${data.user.nickname} : 加入了`, "FilterEmpty")
        dedup.add(data.user.nickname.trim(), "加入了");
        return;
    }

    // socket：維持逐筆發送
    sendSocketMessage(nickname, "來了",iconn,"",false,CacheUserNum,CacheUserList, data.user.nickname, "加入了");

    // bark：累計後合併發送
    memberBarkAccum.push({ nickname, avatar: iconn });
    if (memberBarkTimer) clearTimeout(memberBarkTimer);
    memberBarkTimer = setTimeout(flushMemberBark, 3000);

    dedup.add(data.user.nickname.trim(), "加入了");

})

connection.on(WebcastEvent.FOLLOW,data =>{
    logRawEvent('FOLLOW', data);
    let iconn = getTikTokProfilePic(data.user)
    console.log(data.user.nickname,"關注了主播")

    notify(data.user.nickname, "關注了主播",iconn);
    sendSocketMessage(data.user.nickname, "關注了主播",iconn,"",false,CacheUserNum,CacheUserList);
    dedup.add(data.user.nickname.trim(), "關注了主播");

})


connection.on(WebcastEvent.CHAT, data => {
    reportTraffic({platform:'TikTok',eventType:'chat',id:data.msgId || data.common?.msgId,sentAt:data.createTime || data.common?.createTime,userId:data.user?.userId || data.user?.id,user:data.user?.nickname,message:data.comment});
    if (isTK) {
        const result = tikTokChatGuard.check(data);
        if (!result.accepted) {
            tikTokReplayDropped++;
            if (Date.now() - lastTikTokReplayLog >= 10000) {
                lastTikTokReplayLog = Date.now();
                console.log(`[TikTok] 忽略重播聊天: ${result.reason}，累計 ${tikTokReplayDropped} 筆`);
            }
            return;
        }
    }
    logRawEvent('CHAT', data);

    if (!data.content) {
        writeFileSync(`./logs/TikTok/CHAT_NO_CONTENT_${Date.now()}.json`, JSON.stringify(data, null, 2), 'utf-8');
        console.log('⚠️ CHAT 事件缺少 content，已寫入 logs/TikTok/CHAT_NO_CONTENT_*.json');
        
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
        console.log('🚫 過濾器阻擋:', data.user.nickname, data.content, `(規則: ${fr.reason})`);
        writeLog("Default", `過濾器阻擋訊息: ${data.user.nickname} : ${data.content} (規則: ${fr.reason})`, "FilterBlocked")
        dedup.add(data.user.nickname.trim(), data.content.trim());
        return;
    }

    let nickname = fr.modified && fr.user ? fr.user : data.user.nickname;
    let comment = fr.modified && fr.message ? fr.message : data.content;
    let iconn = getTikTokProfilePic(data.user)

    console.log(`Chat:${nickname} : ${comment}`)

    writeLog("Default", `原始訊息: ${data.user.nickname} : ${data.content}\n過濾後訊息: ${nickname} : ${comment}`, "Chat原過濾對比")

    if (!nickname || !comment) {
        console.log('⚠️ 過濾後 nick/comment 為空，跳過:', data.user.nickname, data.content);
        writeLog("Default", `過濾後 nick/comment 為空，跳過: ${data.user.nickname} : ${data.content}`, "FilterEmpty")
        dedup.add(data.user.nickname.trim(), data.content.trim());
        return;
    }

    // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
    comment = replaceEmojis(comment);

    if (!recordChatHeat(comment, { platform: 'TikTok', ...{ id: chatMetadata(data).id, sentAt: chatMetadata(data).time }, userId: data.user?.id, user: data.user?.nickname })) return;

    notify(nickname, comment,iconn);

    Translate.TranslateText(comment).then(RES=>{
            var RESCHAT=`${comment}`
            if (comment != RES) {
                RESCHAT += `\n${RES}`
            }

            writeLog("Default", `${nickname} : ${RESCHAT}`, "Chat")

            if (RES.toLowerCase() != comment.toLowerCase() ) {
                notify(nickname + "[翻譯]", RES,iconn);
            }

            sendSocketMessage(nickname, RESCHAT,iconn,"",true,CacheUserNum,CacheUserList, data.user.nickname, data.content);

            // 翻譯屬於同一則留言，不重複統計。

            dedup.add(data.user.nickname.trim(), data.content.trim());
        
    })

    

});


// 分享類型

connection.on(WebcastEvent.SOCIAL, data => {
    logRawEvent('SOCIAL', data);

    var LOG_SOCIAL = []
    
    if (data.action) {
        LOG_SOCIAL.push(`Social action: ${data.action}`);
    }
    const uniqueId = data.user?.displayId;
    const nickname = data.user?.nickname;
    if (uniqueId) {
        LOG_SOCIAL.push(`User uniqueId: ${uniqueId}`);
    }
    if (nickname) {
        LOG_SOCIAL.push(`User nickname: ${nickname}`);
    }
    if (data.shareType || data.shareTarget) {
        LOG_SOCIAL.push(`Share type: ${data.shareType}, share target: ${data.shareTarget}`);
    }


    writeLog("Default",LOG_SOCIAL.join("\n"), "Social分享")

});

// EMOTE 表情

connection.on(WebcastEvent.EMOTE, (data) => {
    logRawEvent('EMOTE', data);
    const uniqueId = data.user?.displayId;
    const nickname = data.user?.nickname;
    const profilePic = getTikTokProfilePic(data.user);

    var LOG_R = [ ]

    if (uniqueId) {
        LOG_R.push(`User uniqueId: ${uniqueId}`);
    }
    if (nickname) {
        LOG_R.push(`User nickname: ${nickname}`);
    }

    
    const emoteId = data.emoteList?.[0]?.emoteId;
    
    if (emoteId) {
        LOG_R.push(`Emote id: ${emoteId}`);
        const mess = `發送了表情 ${emoteId}`;
        sendSocketMessage(nickname, mess, profilePic, "", true, CacheUserNum, CacheUserList);
        notify(nickname, mess, profilePic);
        writeLog("Default",LOG_R.join("\n"), "Emote表情")
    }
    
});


connection.on(WebcastEvent.ROOM_MESSAGE, data => {
    logRawEvent('ROOM_MESSAGE', data);

    var LOG_ROOM = []

    if (data.content) {
        LOG_ROOM.push(`Room message: ${data.content}`);
    }
    if (data.source) {
        LOG_ROOM.push(`Source: ${data.source}`);
    }

    LOG_ROOM.push(`Scene: ${data.scene}`);

    writeLog("Default",LOG_ROOM.join('\n'), "Room message")


    
});


let UserLikeClearTimer = process.env.USER_LIKE_CLEAR_TIMER ? Number(process.env.USER_LIKE_CLEAR_TIMER) : 60 * 1000; // 默認 60 秒


// 包含時間戳的點讚事件 用於計算一定時間內的累加點讚數量
let UserLikeCount = new Map(); 
// key: userId, value: { count: number, lastLikeTimestamp: number }

/**
 * 累加點讚數，並在超過 60 秒時自動清空
 * @param {string} user - 用戶ID
 * @param {number} likeCount - 點讚數
 * @returns {number} - 該用戶最新的累計點讚數
 */
function likeUserCount(user, likeCount) {
    const now = Date.now();
    let userData = UserLikeCount.get(user);

    if (!userData) {
        // 沒有紀錄，初始化
        userData = { count: 0, lastLikeTimestamp: now };
    } else {
        // 檢查是否超過 60 秒
        if (now - userData.lastLikeTimestamp > UserLikeClearTimer) {
            // 超過 60 秒，清空計數
            writeLog("Default", `用戶 ${user} 的點讚數已超過 ${UserLikeClearTimer} 秒未更新，重置計數`, "Like清空")
            userData.count = 0;
        }
    }

    // 累加點讚數並更新時間
    userData.count += likeCount;
    userData.lastLikeTimestamp = now;

    UserLikeCount.set(user, userData);

    let secondsToClear = Math.ceil((UserLikeClearTimer - (now - userData.lastLikeTimestamp)) / 1000);

    writeLog("Default", `用戶 ${user} 的點讚數更新為 ${userData.count} 將於${secondsToClear}秒 後清空`, "Like累加")

    return userData.count;
}




connection.on(WebcastEvent.LIKE, data => {
    logRawEvent('LIKE', data);

    let iconn = getTikTokProfilePic(data.user)

    let likeCount = likeUserCount(data.user.nickname, data.count || 0)

    let mess = `喜歡你 ${likeCount} 次`

    console.log(`${data.user.nickname} ${mess}`)

    notify(data.user.nickname, mess,iconn);
    sendSocketMessage(data.user.nickname, mess,iconn,"",false,CacheUserNum,CacheUserList);
    dedup.add(data.user.nickname.trim(), mess);

    writeLog("Default", `${data.user.nickname} ${mess}`, "Like")

})

// Map: key = userId, value = { count: number, lastGiftTimestamp: number }
let UserGiftCount = new Map();
const MAX_CAPACITY = 1000; // 保留最多1000筆

/**
 * 累計用戶送禮次數，並在超過 60 秒時自動清空
 * 同時維持最大容量限制，超過時刪掉最舊紀錄
 * @param {string} userId - 用戶ID
 * @param {number} increment - 本次送禮數量 (通常是1)
 * @returns {number} - 該用戶最新的累計送禮次數
 */
function recordGift(userId, increment = 1) {
    const now = Date.now();

    // 先清理過期的用戶紀錄
    for (const [id, data] of UserGiftCount.entries()) {
        if (now - data.lastGiftTimestamp > 60 * 1000) {
            UserGiftCount.delete(id);
        }
    }

    // 如果超過最大容量，刪掉最舊的紀錄
    if (UserGiftCount.size >= MAX_CAPACITY) {
        let oldestId = null;
        let oldestTime = Infinity;
        for (const [id, data] of UserGiftCount.entries()) {
            if (data.lastGiftTimestamp < oldestTime) {
                oldestTime = data.lastGiftTimestamp;
                oldestId = id;
            }
        }
        if (oldestId !== null) {
            UserGiftCount.delete(oldestId);
        }
    }

    let userData = UserGiftCount.get(userId);

    if (!userData) {
        // 初始化
        userData = { count: 0, lastGiftTimestamp: now };
    } else {
        // 檢查是否超過 60 秒
        if (now - userData.lastGiftTimestamp > 60 * 1000) {
            userData.count = 0; // 清空
        }
    }

    // 累加送禮數並更新時間
    userData.count += increment;
    userData.lastGiftTimestamp = now;

    UserGiftCount.set(userId, userData);

    return userData.count;
}



connection.on(WebcastEvent.GIFT, async data => {
    logRawEvent('GIFT', data);
    await giftMapReady;
    const giftInfo = data.gift;
    const originalGiftName = giftInfo?.name || "";
    const translatedGiftName = await giftNames.ensureGiftNameTranslation(originalGiftName);
    const giftNameForDisplay = translatedGiftName || originalGiftName;
    let iconn = getTikTokProfilePic(data.user)
    let giftImg = giftInfo?.icon?.urlList?.[0] || ""

    if (giftInfo?.type === 1 && !data.repeatEnd) {
        // 連擊進行中 → 只發連擊進度，不回到底部
        let mess = `連擊了 ${giftNameForDisplay} ${data.repeatCount} 個`
        console.log(`連擊了 ${data.user.nickname} : ${giftNameForDisplay} x${data.repeatCount}`)
        notify(data.user.nickname, mess, giftImg);
        sendSocketMessage(data.user.nickname, mess, iconn, giftImg, true, CacheUserNum, CacheUserList);
        dedup.add(data.user.nickname.trim(), mess);
        writeLog("Default", `${data.user.nickname} ${mess}`, "Gift連擊")
        return;
    }

    // 連擊結束 / 非連擊禮物 → 送出最終通知
    let mess = `送出了 ${giftNameForDisplay} ${data.repeatCount} 個`
    console.log(`送出了 ${data.user.nickname} : ${giftNameForDisplay} ${data.repeatCount} 個`)

    notify(data.user.nickname, mess, giftImg);
    sendSocketMessage(data.user.nickname, mess, iconn, giftImg, true, CacheUserNum, CacheUserList);
    dedup.add(data.user.nickname.trim(), mess);
    writeLog("Default", `${data.user.nickname} ${mess}`, "Gift")

    // 累計送禮次數感謝（同一使用者 60 秒內送禮 >= 5 次）
    let count = recordGift(data.user.displayId);
    if (count >= 5) {
        let thanks = `${data.user.nickname} 謝謝支持`
        console.log("5次送禮感謝", data.user.nickname, thanks)
        notify(data.user.nickname, thanks, giftImg);
        sendSocketMessage("感謝大哥的餽贈", thanks, iconn, giftImg, true, CacheUserNum, CacheUserList);
        dedup.add(data.user.nickname.trim(), thanks);
        writeLog("Default", thanks, "Gift感謝")
        UserGiftCount.set(data.user.displayId, { count: 0, lastGiftTimestamp: Date.now() });
    }
});


connection.on(WebcastEvent.SHARE, data =>{
    logRawEvent('SHARE', data);
    let mess = "分享直播間"
    let iconn = getTikTokProfilePic(data.user)
    console.log(`${data.user.nickname} ${mess}`)
    
    notify(data.user.nickname, mess,iconn);
    sendSocketMessage(data.user.nickname, mess,iconn,"",false,CacheUserNum,CacheUserList);
    dedup.add(data.user.nickname.trim(), mess);

    writeLog("Default", `${data.user.nickname} 分享了直播間！`, "Share")

})


connection.on(WebcastEvent.ENVELOPE, data => {
    logRawEvent('ENVELOPE', data);
    const envelope = data.envelopeInfo;
    if (!envelope) return;

    if (envelope.envelopeId) {
        console.log(`Envelope ${envelope.envelopeId}`);
    }
    if (envelope.sendUserName) {
        console.log(`From: ${envelope.sendUserName}`);
    }
    console.log(`Diamonds: ${envelope.diamondCount}, People: ${envelope.peopleCount}`);

    // Skip empty/system envelopes
    if (!envelope.diamondCount && !envelope.peopleCount) {
        console.log("⚠️ 跳過空的寶箱事件");
        return;
    }

    let mess = `送出了寶箱，包含 ${envelope.diamondCount} 鑽石`
    const senderName = envelope.sendUserName || data.nickname || "未知用戶";
    const profilePic = getTikTokProfilePic(data.user) || envelope.sendUserAvatar?.urlList?.[0] || "";
    notify(senderName, mess, profilePic);
    sendSocketMessage(senderName, mess, profilePic, "", true, CacheUserNum, CacheUserList);

    writeLog("Default", `${senderName} 送出了寶箱，包含 ${envelope.diamondCount} 鑽石`, "Envelope")
});

connection.on(WebcastEvent.SUPER_FAN, (data) => {
    logRawEvent('SUPER_FAN', data);
    console.log('A user became a superfan!');
    let mess = "鐵粉出現啦！"
    let iconn = getTikTokProfilePic(data.user)
    const nickname = data.user?.nickname || "用戶"
    console.log(`${nickname} ${mess}`)

    notify(nickname, mess, iconn);
    sendSocketMessage(nickname, mess, iconn, "", true, CacheUserNum, CacheUserList);

    writeLog("Default", `${nickname} 成為了鐵粉！`, "SuperFan")

});

connection.on(ControlEvent.STREAM_END, ({ action }) => {

let IMG = "https://img.icons8.com/?size=100&id=xruQNezCArqC&format=png&color=000000"
    
let mess = "直播結束啦"

console.log(JSON.stringify({ action },"",4))

    if (action === ControlAction.CONTROL_ACTION_STREAM_ENDED) {
        writeLog("Default", "直播結束，用戶主動結束或推流斷線", "Stream Status")
        console.log('Stream ended by user');
        notify(tiktokName, mess, IMG);
        sendSocketMessage(tiktokName, mess, IMG, "", false);

    }
    if (action === ControlAction.CONTROL_ACTION_STREAM_SUSPENDED) {
        console.log('Stream ended by platform moderator (ban)');
        notify(tiktokName, mess, IMG);
        sendSocketMessage(tiktokName, mess, IMG, "", false);

        writeLog("Default", "直播被強行終止了 :(", "Stream Status")

    }
    // 直播真正結束：取消排程中的重連，不再自動重試
    streamEnded = true;
    if (tkReconnectTimer) { clearTimeout(tkReconnectTimer); tkReconnectTimer = null; }
});




// 由於 EulerStream 禮物清單需付費 API，改為收到禮物事件時即時翻譯；保留此函式與其同步
// 工具供未來啟用。
// eslint-disable-next-line no-unused-vars
function fetchAndSyncGifts() {
    writeLog("Default", "開始取得 TikTok禮物列表", "System")
    connection.fetchAvailableGifts().then(async (giftList) => {
        await giftMapReady;
        console.log(tiktokName,"Tiktok giftList.length:", giftList.length);
        await giftNames.syncGiftMapFromGiftList(giftList);
        await giftNames.backfillGiftTranslationsFromGiftList(giftList);
        await giftNames.saveGiftCatalog(giftList);
    }).catch(err => {
        console.error("取得禮物列表失敗:", err.message);
    })
}

// --- Twitch SDK 生命週期（auth／apiClient／listener／viewer）交由 ScriptLib/twitch/client.mjs 管理 ---
const twitchDeps = {
    getAutoClip: () => autoClip,
    reportTraffic,
    writeLog,
    notify,
    sendSystem: (text) => sendSocketMessage("系統", text, "", "", false, CacheUserNum, CacheUserList),
    sendNotice: (user, text, icon) => sendSocketMessage(user, text, icon, "", false, CacheUserNum, CacheUserList),
    setViewerCount: (count) => { TwitchViewerCount = count; },
    updateCombinedViewerCount,
    getUserIcon,
    logger: console,
};

const twitchChatDeps = {
    getApiClient: () => apiClient,
    getTuser: () => tuser,
    getUserIcon,
    notify,
    sendChat: (user, message, icon) => sendSocketMessage(user, message, icon, "", true, CacheUserNum, CacheUserList),
    sendAd: (user, text, iconURL, useTTS) => sendAdOverylayMessage(user, text, iconURL, useTTS),
    writeLog,
    reportTraffic,
    reportFiltered,
    processFilter,
    recordChatHeat,
    replaceEmojis,
    translate: (text) => Translate.TranslateText(text),
    sponsorStore,
    adScheduler,
    manageUrl: SPONSOR_MANAGE_URL,
    clipService,
    logRawEvent,
    logger: console,
};

await startTwitchClient({
    userName: process.env.TWITCH_USER_NAME || "coffeelatte0709",
    enabled: isTwitch,
    writeLog,
    onError: (err) => twitchOnError(err, twitchDeps),
    onStreamOnline: (event) => twitchOnStreamOnline(event, twitchDeps),
    onStreamOffline: (event) => twitchOnStreamOffline(event, twitchDeps),
    onFollow: (event) => twitchOnFollow(event, twitchDeps),
    onCheer: (event) => twitchOnCheer(event, twitchDeps),
    onChat: (event) => twitchOnChat(event, twitchChatDeps),
    onSocketDisconnect: () => autoClip?.reset(),
    onViewer: (stream) => twitchOnViewer(stream, twitchDeps),
});








connectSocket();

// ─── Twitch 自動剪輯 (AutoClip) ───

if (isTwitch && process.env.AUTO_CLIP_ENABLED === '1') {
    autoClip = new AutoClipManager({
        onCreateClip: (title, context) => clipService.createClip(title, '', 'auto', context),
        shadow: process.env.AUTO_CLIP_MODE !== 'live',
        delayOffsetsMs: (() => {
            try {
                const offsets = JSON.parse(process.env.AUTO_CLIP_PLATFORM_DELAY_MS || '{}');
                return offsets && typeof offsets === 'object' && !Array.isArray(offsets) ? offsets : {};
            } catch { console.warn('[AutoClip] 平台延遲設定無效，使用 0ms'); return {}; }
        })(),
        baselineWindowMin: parseInt(process.env.AUTO_CLIP_BASELINE_WINDOW_MIN) || 30,
        rateWindowMin: parseFloat(process.env.AUTO_CLIP_RATE_WINDOW_MIN) || 0.5,
        wViewers: Number(process.env.AUTO_CLIP_W_VIEWERS ?? 0.2),
        wMsg: Number(process.env.AUTO_CLIP_W_MSG ?? 0.8),
        scoreThreshold: parseFloat(process.env.AUTO_CLIP_SCORE_THRESHOLD) || 1.8,
        floorViewers: parseInt(process.env.AUTO_CLIP_FLOOR_VIEWERS) || 2,
        floorMsgPerMin: parseFloat(process.env.AUTO_CLIP_FLOOR_MSG_PER_MIN) || 2,
        cooldownMin: parseInt(process.env.AUTO_CLIP_COOLDOWN_MIN) || 15,
        sustainMin: parseFloat(process.env.AUTO_CLIP_SUSTAIN_MIN) || 0.167,
        titlePrefix: process.env.AUTO_CLIP_TITLE_PREFIX || '',
    });
    console.log('🎬 自動剪輯已啟用 (AutoClipManager)，每 5 秒評估一次');
    setInterval(() => {
        try {
            autoClip.evaluate();
            pushAutoClipStats();
        } catch (err) { console.error('❌ [AutoClip] 評估異常:', err); }
    }, 5000);
}

// 自動剪輯統計：執行中只透過 stdout 推送到 Server.js（存在記憶體），
// 由 Server.js 在 TikTok.js 結束時才寫入 autoclip_stats.json
const autoClipSession = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ─── 啟動完成標記 ───
// 這行是頂層初始化最後的執行點；在此之前的未捕捉例外都視為啟動失敗（見上方 uncaughtException）。
startupComplete = true;

function pushAutoClipStats() {
    if (!autoClip) return;
    try {
        process.stdout.write(JSON.stringify({
            type: 'AUTOCLIP_STATS',
            session: autoClipSession,
            data: { config: autoClip.getConfig(), stats: autoClip.getHistory() }
        }) + '\n');
    } catch (err) {
        console.error('⚠️ 推播自動剪輯統計失敗:', err.message);
    }
}



// 其他事件同理可加 sendSocketMessage



if (isOdysee) {
    startOdyseeChat(odyseeChannelName, {
        axios,
        writeLog,
        notify,
        sendSystem: (text) => sendSocketMessage("系統", text, "", "", false, CacheUserNum, CacheUserList),
        sendChat: (user, message, img) => sendSocketMessage(user, message, img, "", true, CacheUserNum, CacheUserList),
        reportTraffic,
        reportFiltered,
        filter: processFilter,
        recordHeat: recordChatHeat,
        replaceEmojis,
        translate: (text) => Translate.TranslateText(text),
        onViewerCount: (count) => {
            OdyseeViewerCount = count
            autoClip?.updatePlatformViewers('Odysee', Number(count))
            updateCombinedViewerCount()
        },
    })
}

if (isYoutube) {
    startYoutubeChat(youtubeChannelName, {
        axios,
        apiKey: youtubeApiKey,
        pollIntervalS: youtubePollIntervalS,
        writeLog,
        notify,
        sendSystem: (text) => sendSocketMessage("系統", text, "", "", false, CacheUserNum, CacheUserList),
        sendChat: (user, message, img) => sendSocketMessage(user, message, img, "", true, CacheUserNum, CacheUserList),
        reportTraffic,
        reportFiltered,
        filter: processFilter,
        recordHeat: recordChatHeat,
        replaceEmojis,
        translate: (text) => Translate.TranslateText(text),
        onViewerCount: (count) => {
            YoutubeViewerCount = count
            autoClip?.updatePlatformViewers('Youtube', Number(count))
            updateCombinedViewerCount()
        },
    })
}

if (isKick) {
    startKickChat(kickDeps);
}
