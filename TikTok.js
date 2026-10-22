import { reportTraffic as sendTraffic } from './ScriptLib/traffic/report.mjs';
import { broadcasterForPlatform } from './ScriptLib/traffic/attribution.mjs';
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
import { createAutoStop } from './ScriptLib/lifecycle/autoStop.mjs';
import { createMonitorRelay } from './ScriptLib/socket/monitor-relay.mjs';
import { MessageDedup } from './ScriptLib/socket/dedup.mjs';
import { createGiftNameStore } from './ScriptLib/gift/names.mjs';
import { logRawEvent } from './ScriptLib/tiktok/rawLog.mjs';
import { buildConnectionOptions } from './ScriptLib/tiktok/signing.mjs';
import { createTikTokConnectionManager } from './ScriptLib/tiktok/connection.mjs';
import { registerTikTokEvents } from './ScriptLib/tiktok/events.mjs';
import { createSponsorStore } from './ScriptLib/sponsor/store.mjs';
import { createAdScheduler } from './ScriptLib/sponsor/scheduler.mjs';
import { createSentCache } from './ScriptLib/sponsor/sent-cache.mjs';
import { TikTokChatGuard, chatMetadata } from './TikTokChatGuard.mjs';



import path from 'path';

import { fileURLToPath } from 'url';

// 在 ESM 裡手動定義 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


import { TikTokLiveConnection } from 'tiktok-live-connector';
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

// 各平台正在觀測的主播識別；留言者 ID 不能用作主播 ID。
const tiktokName = keyword.length > 0 ? keyword : process.env.TIKTOK_NAME || "coffeelatte0709";
const kickChannelName = process.env.KICK_USER_NAME || keyword || '';
const odyseeChannelName = process.env.ODYSEE_CHANNEL_NAME || keyword || '';
const youtubeChannelName = process.env.YOUTUBE_CHANNEL_ID || keyword || '';
// YouTube 的 @handle 會由 startYoutubeChat 解析成頻道 ID；人流身分要用解析後的 UC ID。
let youtubeBroadcasterId = '';

/**
 * 將正在觀測的主播身分附於事件。
 * tuser 是 ESM live binding，必須在事件發生時讀取，不能在模組載入時快取值。
 * @param {Object} data 原生事件。
 * @returns {void}
 */
function reportTraffic(data) {
    sendTraffic({ ...data, broadcasterId: broadcasterForPlatform(data.platform, {
        tiktokName, twitchUser: tuser, kickName: kickChannelName,
        odyseeName: odyseeChannelName, youtubeName: youtubeBroadcasterId || youtubeChannelName
    }) });
}
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
            sendSocketMessage(summary.user || "系統", summary.message, { isMain: false, category: 'summary' });
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

// TikTok 直播間斷線自動重連（有限次數 + 指數退避）
let streamEnded = false;       // 直播真正結束（使用者主動結束 / 平台封鎖）→ 不再重連
let autoStop = null;           // 所有支援平台結束後自動停止的管理器（啟動後才建立）
let tiktokLiveBeforeAutoStop = false; // 連線早於管理器建立時，先記住已上線

// Socket 輸出層：端點／去重／扇出皆在 ScriptLib/socket/。
const dedup = new MessageDedup();
const monitorRelay = createMonitorRelay();
const socketHub = createHub({
    socketApi: process.env.SOCKET_API || 'tcp://localhost:9322',
    apis: process.env.SOCKET_APIS || '',
    enabled: isSocket,
    replaceEmojis,
    dedup,
    onSend: (payload) => monitorRelay.forward(payload),
    onConnect: () => {
        if (isFirstSocketConnect) {
            sendSocketMessage("系統", "TTW Chat Message Server 已連線", { isMain: false, category: 'system' });
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

/**
 * 產生一組平台綁定的 socket 送出器（固定 category 與 platform）。
 * @param {string} platform 來源平台名稱。
 * @returns {{system: (text: string) => void, chat: (user: string, message: string, img?: string) => void, notice: (user: string, message: string, img?: string) => void}}
 */
function platformSenders(platform) {
    return {
        system: (text) => sendSocketMessage("系統", text, { isMain: false, category: 'system', platform }),
        chat: (user, message, img) => sendSocketMessage(user, message, { img, category: 'chat', platform }),
        notice: (user, message, img) => sendSocketMessage(user, message, { img, isMain: false, category: 'system', platform }),
    };
}
const kickSenders = platformSenders('kick');
const twitchSenders = platformSenders('twitch');
const youtubeSenders = platformSenders('youtube');
const odyseeSenders = platformSenders('odysee');
const tiktokSenders = platformSenders('tiktok');

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
    channelName: kickChannelName,
    writeLog,
    notify,
    sendSystem: kickSenders.system,
    sendChat: kickSenders.chat,
    sendNotice: kickSenders.notice,
    reportTraffic,
    reportFiltered,
    filter: processFilter,
    recordHeat: recordChatHeat,
    replaceEmojis,
    translate: (text) => Translate.TranslateText(text),
    axios,
    logger: console,
};

const tiktokConn = createTikTokConnectionManager({
    getConnection: () => connection,
    tiktokName,
    isTK, isTwitch,
    getTwitchViewerCount: () => TwitchViewerCount,
    setTikTokViewerCount: (n) => { TikTokViewerCount = n; },
    setCacheUserNum: (n) => { CacheUserNum = n; },
    getCacheUserNum: () => CacheUserNum,
    getCacheUserList: () => CacheUserList,
    updateCombinedViewerCount,
    notify,
    sendSystem: tiktokSenders.system,
    writeLog,
    reportTraffic,
    getAutoClip: () => autoClip,
    tikTokChatGuard,
    adScheduler,
    handleExit,
    isEnd: () => isEnd,
    getStreamEnded: () => streamEnded,
    onLive: () => {
        if (autoStop) autoStop.markLive('TikTok');
        else tiktokLiveBeforeAutoStop = true;
    },
    });


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

    tiktokConn.stop();
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
    sendSocketMessage("系統", `TikTok.js 發生錯誤: ${shortMsg}`, { isMain: false, category: 'system' });
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
            // Kick 沒有可靠的結束訊號；一旦啟用就停用自動停止，避免誤停。
            autoStop?.dispose();
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
                sendSocketMessage(json.user || '系統', json.message, { isMain: false, category: 'summary' });
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

                sendSocketMessage(json.user, json.message, { img: json.img || '', giftImg: json.giftImg || '', category: 'chat', platform: 'tiktok', dedupUser: origUser, dedupMessage: origMsg });

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

const { connOpts } = buildConnectionOptions(process.env, console);

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
 * 發送 Socket 訊息的統一入口（去重 → emoji 取代 → 依 category 扇出）。
 * 觀眾數與頭號觀眾清單一律取目前快取。
 *
 * @param {string} user 顯示名稱。
 * @param {string} message 訊息內容。
 * @param {Object} [options]
 * @param {string} [options.img] 頭像 URL。
 * @param {string} [options.giftImg] 禮物圖 URL。
 * @param {boolean} [options.isMain=true] 是否為主訊息（置底）。
 * @param {string} [options.category] 訊息分類（供端點 ?filter= 過濾）。
 * @param {string} [options.platform] 來源平台（tiktok／twitch／kick／youtube／odysee）。
 * @param {string} [options.dedupUser] 覆寫去重比對的使用者。
 * @param {string} [options.dedupMessage] 覆寫去重比對的訊息。
 * @returns {void}
 */
function sendSocketMessage(user, message, { img = '', giftImg = '', isMain = true, category, platform, dedupUser, dedupMessage } = {}) {
    socketHub.sendMessage(user, message, { img, giftImg, isMain, userNum: CacheUserNum, userList: CacheUserList, category, platform, dedupUser, dedupMessage });
}


function connectSocket() {
    socketHub.connect();
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
        tiktokConn.onConnected(state);
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
        sendSocketMessage("系統", `TikTok 直播間連線失敗: ${err.message}`, { isMain: false, category: 'system', platform: 'tiktok' });

        // 初次連線失敗也進入有限次數自動重連（指數退避，用盡後退出）
        tiktokConn.scheduleReconnect();
    });

}


// ─── 自動停止：只在有可靠結束訊號的平台都結束後才觸發 ───
const autoStopRequested = /^(1|true|yes|on)$/i.test(process.env.AUTO_STOP_ENABLED || '');
const autoStopGraceMs = Math.min(Math.max(Number(process.env.AUTO_STOP_GRACE_SEC || 60) * 1000, 10000), 600000) || 60000;
autoStop = createAutoStop({
    enabled: autoStopRequested,
    platforms: [isTK && 'TikTok', isTwitch && 'Twitch'].filter(Boolean),
    blocked: [isKick && 'Kick', isOdysee && 'Odysee', isYoutube && 'Youtube'].filter(Boolean),
    graceMs: autoStopGraceMs,
    log: message => writeLog('Default', `[AutoStop] ${message}`),
    onStop: () => {
        writeLog('Default', '[AutoStop] 所有平台已結束，停止程序');
        void handleExit();
    }
});
if (tiktokLiveBeforeAutoStop) autoStop.markLive('TikTok');

// 註冊所有 TikTok 事件處理器（實作在 ScriptLib/tiktok/events.mjs）
registerTikTokEvents(connection, {
    tiktokName, isTK,
    notify, sendSocketMessage,
    logRawEvent, writeLog, writeFileSync,
    dedup, sentCache, processFilter, reportFiltered, reportTraffic,
    replaceEmojis, recordChatHeat, chatMetadata, translate: (text) => Translate.TranslateText(text),
    tikTokChatGuard,
    giftNames, getGiftMapReady: () => giftMapReady,
    getCacheUserNum: () => CacheUserNum,
    setCacheUserNum: (n) => { CacheUserNum = n; }, setCacheUserList: (n) => { CacheUserList = n; },
    getAutoClip: () => autoClip, sendAudienceUpdate,
    isEnd: () => isEnd, getStreamEnded: () => streamEnded, setStreamEnded: () => { streamEnded = true; },
    onStreamEnd: () => autoStop.markEnded('TikTok'),
    stopViewCache: () => tiktokConn.stopViewCache(),
    scheduleReconnect: () => tiktokConn.scheduleReconnect(),
    cancelReconnect: () => tiktokConn.cancelReconnect(),
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
    sendSystem: twitchSenders.system,
    sendNotice: twitchSenders.notice,
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
    sendChat: twitchSenders.chat,
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
    onStreamOnline: (event) => { autoStop.markLive('Twitch'); twitchOnStreamOnline(event, twitchDeps); },
    onStreamOffline: (event) => { autoStop.markEnded('Twitch'); twitchOnStreamOffline(event, twitchDeps); },
    onFollow: (event) => twitchOnFollow(event, twitchDeps),
    onCheer: (event) => twitchOnCheer(event, twitchDeps),
    onChat: (event) => twitchOnChat(event, twitchChatDeps),
    onSocketDisconnect: () => autoClip?.reset(),
    onViewer: (stream) => {
        if (stream) autoStop.markLive('Twitch');
        else autoStop.markEnded('Twitch');
        twitchOnViewer(stream, twitchDeps);
    },
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
        sendSystem: odyseeSenders.system,
        sendChat: odyseeSenders.chat,
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
        sendSystem: youtubeSenders.system,
        sendChat: youtubeSenders.chat,
        reportTraffic,
        reportFiltered,
        filter: processFilter,
        recordHeat: recordChatHeat,
        replaceEmojis,
        translate: (text) => Translate.TranslateText(text),
        onChannelIdentity: (channelId) => {
            if (typeof channelId === 'string' && channelId) youtubeBroadcasterId = channelId;
        },
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
