import { ApiClient } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { promises as fs, readFileSync, existsSync, writeFileSync } from 'fs';
import axios from 'axios';


import { config } from 'dotenv';

import net from 'net';



import path from 'path';

import { fileURLToPath } from 'url';

// 在 ESM 裡手動定義 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


import { TikTokLiveConnection, WebcastEvent,ControlEvent,ControlAction } from 'tiktok-live-connector';
import { setupCustomSignServer, waitForSigner, setStreamerName } from './SignServer/index.js';
import { type } from 'os';
import Translate from "./TranslateTest.js"
import { recordMessageStat, getTopMessages, getAllMessageStatsSorted, processFilter } from "./MessageFilter.js"
import { replaceEmojis, loadEmojiMap, getEmojiMap } from "./EmojiMap.js"
import { KickWebSocket } from 'kick-wss';
import console from 'console';

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
    console.log("使用預設",FileN)
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

config(); // 讀取 .env


const isDebugChild = process.env.DEBUG_CHILD === 'true';

if (isDebugChild) {

const child = fork('TikTok.js', [], {
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

console.log('isBark=', isBark, 'isSocket=', isSocket, 'isTwitch=', isTwitch, 'isKick=', isKick, 'isOdysee=', isOdysee, 'isYoutube=', isYoutube);
console.log('isBoth=', isBoth, 'platforms=', platformsArg ? platformsArg.split('=')[1] : '');

// TikTok 用戶名稱

const tiktokName = keyword.length > 0 ? keyword : process.env.TIKTOK_NAME || "coffeelatte0709";
const odyseeChannelName = process.env.ODYSEE_CHANNEL_NAME || keyword || '';
const youtubeChannelName = process.env.YOUTUBE_CHANNEL_ID || keyword || '';
const youtubeApiKey = process.env.YOUTUBE_API_KEY || '';
const youtubePollIntervalS = parseInt(process.env.YOUTUBE_POLL_INTERVAL_S) || 30


// --- 4. Socket 客戶端 ---

let client = null;
let reconnectTimer = null;
var isFirstSocketConnect = true;
let socketRetryCount = 0;
let socketRetryInterval = 15000; // 起始 15 秒
const SOCKET_RETRY_THRESHOLD = 10; // 連續 10 次失敗後開始調大
const SOCKET_RETRY_STEP = 5000;   // 每次增加 5 秒
const SOCKET_RETRY_MAX = 300000;  // 最長 5 分鐘
const SOCKET_RETRY_BASE = 15000;  // 基礎重連間隔 15 秒
const pendingQueue = [];
const MAX_PENDING = 50;

function flushPendingQueue() {
    if (pendingQueue.length === 0) return;
    if (!client || client.destroyed) return;
    const batch = pendingQueue.splice(0);
    let idx = 0;
    const sendNext = () => {
        if (idx >= batch.length || !client || client.destroyed) return;
        try {
            client.write(JSON.stringify(batch[idx]) + '\n');
        } catch (err) {
            console.error('⚠️ 補發佇列訊息失敗:', err.message);
        }
        idx++;
        setTimeout(sendNext, 300);
    };
    console.log(`📤[TK] 開始低頻補發 ${batch.length} 筆暫存訊息 (300ms/筆)`);
    sendNext();
}



const PORT = process.env.SOCKET_API?.split(':')[2] || 9322; // 你的 socket server 端口
const HOST = process.env.SOCKET_API?.split(':')[1]?.replace('//', '') || 'localhost'; // 你的 socket server 地址

const Bark = process.env.BARK_API;

const TRANSLATE_API_URL = process.env.TRANSLATE_API_URL || "https://api.mymemory.translated.net/get";
const TRANSLATE_SOURCE_LANG = process.env.TRANSLATE_SOURCE_LANG || "en";
const TRANSLATE_TARGET_LANG = process.env.TRANSLATE_TARGET_LANG || "zh-TW";


const GIFT_TRANSLATE_PREFILL_LIMIT = Number(process.env.GIFT_TRANSLATE_PREFILL_LIMIT || 10);

// ---- 贊助廣告 (G#Ad) 持久化 ----
const SPONSOR_ADS_FILE = path.join(__dirname, 'sponsor_ads.json');
const SPONSOR_MANAGE_URL = process.env.SPONSOR_MANAGE_URL || 'http://localhost:3332/sponsor';
let sponsorAds = {};
let adTimers = {}; // { adId: setTimeout handle }


const CACHE_FILE = path.resolve("./send_messages.json");
const GIFT_MAP_FILE = path.resolve("./gift_map.json");
const GIFT_LIST_FILE = path.resolve("./gift_list.json");
let sentMessages = {}; // { uniqueKey: timestamp }
let newSentMessages = {};    // 只保存這次新產生的訊息
let giftNameMap = {};
const missingGiftNames = new Set();
const pendingGiftTranslations = new Map();


const MESSAGE_TTL = 5 * 60 * 1000; // 5 分鐘

async function loadSentMessages() {
    try {
        const raw = await fs.readFile(CACHE_FILE, "utf-8");
        if (!raw || raw.trim().length === 0) {
            console.log("⚠️ send_messages.json 為空，初始化空物件");
            sentMessages = {};
            return;
        }
        const data = JSON.parse(raw);
        sentMessages = Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, new Date(v).getTime()])
        );
        console.log(`✅ 載入 ${Object.keys(sentMessages).length} 筆歷史訊息`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log("⚠️ send_messages.json 不存在，初始化空物件");
            sentMessages = {};
        } else {
            console.error("❌ 載入 send_messages 失敗:", err);
        }
    }
}

async function loadGiftNameMap() {
    try {
        const raw = await fs.readFile(GIFT_MAP_FILE, "utf-8");
        giftNameMap = JSON.parse(raw);
        console.log(`✅ 載入 ${Object.keys(giftNameMap).length} 筆 gift_map 對應`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            giftNameMap = {};
            await saveGiftNameMap();
            console.log("⚠️ gift_map.json 不存在，已初始化空對照表");
        } else {
            console.error("❌ 載入 gift_map.json 失敗:", err);
            giftNameMap = {};
        }
    }
}

async function saveGiftNameMap() {
    try {
        const sortedMap = Object.fromEntries(
            Object.entries(giftNameMap).sort(([a], [b]) => a.localeCompare(b))
        );
        await fs.writeFile(GIFT_MAP_FILE, JSON.stringify(sortedMap, null, 4), "utf-8");
    } catch (err) {
        console.error("❌ 儲存 gift_map.json 失敗:", err);
    }
}

function getTranslatedGiftNameFromMap(giftName) {
    if (!giftName || typeof giftName !== 'string') {
        return giftName;
    }

    const translatedName = giftNameMap[giftName];
    if (typeof translatedName === 'string' && translatedName.trim().length > 0) {
        return translatedName;
    }

    if (!Object.prototype.hasOwnProperty.call(giftNameMap, giftName)) {
        giftNameMap[giftName] = "";
        if (!missingGiftNames.has(giftName)) {
            missingGiftNames.add(giftName);
            saveGiftNameMap();
            console.log(`📝 發現未翻譯禮物: ${giftName}，已加入 gift_map.json`);
        }
    }

    return "";
}



async function translateGiftNameByApi(giftName) {
    try {
        const response = await axios.get(TRANSLATE_API_URL, {
            params: {
                q: giftName,
                langpair: `${TRANSLATE_SOURCE_LANG}|${TRANSLATE_TARGET_LANG}`
            },
            timeout: 10000
        });

        const translatedText = response?.data?.responseData?.translatedText?.trim();
        if (!translatedText || translatedText.toLowerCase() === giftName.toLowerCase()) {
            return "";
        }

        console.log(`🌐 禮物翻譯成功: ${giftName} -> ${translatedText}`);
        return translatedText;
    } catch (err) {
        console.error(`❌ 禮物翻譯失敗 (${giftName}):`, err.message);
        return "";
    }
}

async function ensureGiftNameTranslation(giftName) {
    if (!giftName || typeof giftName !== 'string') {
        return giftName;
    }

    const translatedName = getTranslatedGiftNameFromMap(giftName);
    if (translatedName) {
        return translatedName;
    }

    if (pendingGiftTranslations.has(giftName)) {
        return pendingGiftTranslations.get(giftName);
    }

    const translationPromise = (async () => {
        if (!Object.prototype.hasOwnProperty.call(giftNameMap, giftName)) {
            giftNameMap[giftName] = "";
            if (!missingGiftNames.has(giftName)) {
                missingGiftNames.add(giftName);
                await saveGiftNameMap();
                console.log(`📝 發現未翻譯禮物: ${giftName}，已加入 gift_map.json`);
            }
        }

        const translatedByApi = await translateGiftNameByApi(giftName);
        if (translatedByApi) {
            giftNameMap[giftName] = translatedByApi;
            await saveGiftNameMap();
            return translatedByApi;
        }

        return giftName;
    })();

    pendingGiftTranslations.set(giftName, translationPromise);

    try {
        return await translationPromise;
    } finally {
        pendingGiftTranslations.delete(giftName);
    }
}

async function saveGiftCatalog(giftList) {
    try {
        const normalizedGiftList = giftList.map(gift => ({
            id: gift.id,
            name: gift.name,
            diamond_count: gift.diamond_count,
            translatedName: giftNameMap[gift.name] || ""
        }));

        await fs.writeFile(GIFT_LIST_FILE, JSON.stringify(normalizedGiftList, null, 4), "utf-8");
        console.log(`✅ 已儲存 gift_list.json，共 ${normalizedGiftList.length} 筆禮物資料`);
    } catch (err) {
        console.error("❌ 儲存 gift_list.json 失敗:", err);
    }
}

async function syncGiftMapFromGiftList(giftList) {
    let hasNewGift = false;

    for (const gift of giftList) {
        if (!gift?.name) {
            continue;
        }

        if (!Object.prototype.hasOwnProperty.call(giftNameMap, gift.name)) {
            giftNameMap[gift.name] = "";
            hasNewGift = true;
        }
    }

    if (hasNewGift) {
        await saveGiftNameMap();
        console.log("📝 已將 giftList 中尚未翻譯的禮物加入 gift_map.json");
    }
}

async function backfillGiftTranslationsFromGiftList(giftList) {
    const unresolvedGiftNames = giftList
        .map(gift => gift?.name)
        .filter(name => name && !getTranslatedGiftNameFromMap(name));

    const namesToTranslate = unresolvedGiftNames.slice(0, Math.max(0, GIFT_TRANSLATE_PREFILL_LIMIT));
    if (namesToTranslate.length === 0) {
        return;
    }

    console.log(`🌐 準備自動翻譯 ${namesToTranslate.length} 個禮物名稱`);

    for (const giftName of namesToTranslate) {
        await ensureGiftNameTranslation(giftName);
    }
}



async function saveStatsToFile(filePath = './message_stats.json') {
    const data = getAllMessageStatsSorted();

    try {
    console.log("訊息統計:", data);

    console.log(`正在儲存訊息統計到 ${filePath}... 共 ${data.length} 條訊息統計`);

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✅ 已進行儲存訊息統計到 ${filePath}`);

    console.log(`📊 訊息統計:\n`, data.slice(0, 20)); // 顯示前 20 條統計

    } catch (err) {
        console.error('❌ 儲存訊息統計失敗:', err);
    }
    
}

async function saveSentMessages() {
    try {
        const data = Object.fromEntries(
            Object.entries(newSentMessages).map(([k, v]) => [k, new Date(v).toISOString()])
        );
        await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
        console.log(`✅ 已儲存 ${Object.keys(sentMessages).length} 筆 send_messages`);
   
    } catch (err) {
        console.error("❌ 儲存 send_messages 失敗:", err);
    }
}

function alreadySent(uniqueKey) {
    const now = Date.now();

    // 清理過期
    for (const [key, ts] of Object.entries(sentMessages)) {
        if (now - ts > MESSAGE_TTL) {
            delete sentMessages[key];
        }
    }

    if (sentMessages[uniqueKey]) return true;

    // 記錄新訊息
    sentMessages[uniqueKey] = now;
    newSentMessages[uniqueKey] = now; // 只記錄本次新訊息

    // 限制最大筆數
    const maxSize = 1000;
    if (Object.keys(sentMessages).length > maxSize) {
        const sortedKeys = Object.entries(sentMessages)
            .sort((a, b) => a[1] - b[1])
            .slice(0, 100)
            .map(([k]) => k);
        sortedKeys.forEach(k => delete sentMessages[k]);
    }

    return false;
}

var isEnd=false

async function handleExit() {
    console.log("⏹️ 程式結束，儲存 send_messages...");
    
    clearInterval(twitchViewCache)

    isEnd=true

    sendBarkNotification("系統通知", "TTW Chat Message Server 已關閉", "");
    
    if (client && !client.destroyed) {
        // 先嘗試送最後一條訊息
        await new Promise((resolve) => {
            client.write(JSON.stringify({
                type: 'StreamMessage',
                user: "系統",
                message: "TTW Chat Message Server 已關閉",
                img: "",
                giftImg: "",
                isMain: false
            }) + '\n', () => {
                // 等到 write callback 確認送出後再關閉
                client.end(() => {
                    resolve();
                });
            });
        });
    }

    clearAllAdTimers();
    saveSponsorAds();
    // 關閉時重置 Socket 重連狀態，下次啟動從 15s 開始
    socketRetryCount = 0;
    socketRetryInterval = SOCKET_RETRY_BASE;

    await saveSentMessages();

    await saveStatsToFile();
    
    console.log("✅ 優雅退出完成");

    process.exit(0);
}

process.on('unhandledRejection', (reason) => {
    console.error('未捕獲的 Promise 拒絕，防止崩潰:', reason instanceof Error ? reason.message : reason);
});

process.on('uncaughtException', (err) => {
    console.error('未捕獲的例外，防止崩潰:', err.message);
    sendBarkNotification("TikTok.js 發生錯誤", err.message.substring(0, 100));
    sendSocketMessage("系統", `TikTok.js 發生錯誤: ${err.message.substring(0, 100)}`, "", "", false, CacheUserNum, CacheUserList);
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

        // 🔴 Kick 啟動指令
        if (msg === 'KICK_START') {
            if (!isKick) {
                isKick = true;
                startKickChat();
            }
            return;
        }

        // 🟢 JSON 訊息
        try {
            const json = JSON.parse(msg);


            if (json.type === 'audience') {
                CacheUserNum = json.userNum ?? CacheUserNum;
                if (json.userList) CacheUserList = json.userList;
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

                recordMessageStat(json.message);

                if (json.userNum !== CacheUserNum) {
                    TikTokViewerCount = json.userNum

                    updateCombinedViewerCount()

                }
                if (json.userList) {
                    CacheUserList = json.userList;
                }

                sendSocketMessage(json.user, json.message, json.img || '', json.giftImg || '', true, CacheUserNum, CacheUserList, origUser, origMsg);

                addToSyncBuffer(origUser, origMsg);

                // sendToTCP(json, origUser, origMsg);

                let Gift = json.giftImg || ''

                sendBarkNotification(json.user, json.message, json.img || Gift);

                console.log('📥 收到 JSON 訊息:', json);
                return;
            }

            // ---- 贊助廣告管理指令 ----
            if (json.type === 'SPONSOR_SETTINGS' && json.settings) {
                sponsorAds.settings = { ...sponsorAds.settings, ...json.settings };
                saveSponsorAds();
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
                                scheduleAdTimer(ad.id, uid, ad.intervalMinutes, {
                                    overlayUser: ad.overlayUser,
                                    text: ad.message,
                                    iconURL: ad.iconURL || '',
                                    useTTS: ad.useTTS
                                });
                            }
                        } else {
                            clearAdTimer(ad.id);
                            ad.enabled = false;
                            console.log(`❌ 已拒絕贊助廣告: ${ad.overlayUser} - ${ad.message}`);
                        }
                        saveSponsorAds();
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
                            scheduleAdTimer(ad.id, uid, ad.intervalMinutes, {
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
                            clearAdTimer(ad.id);
                        }
                        saveSponsorAds();
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
                        clearAdTimer(json.adId);
                        sponsorAds.users[uid].ads.splice(idx, 1);
                        if (sponsorAds.users[uid].ads.length === 0) {
                            delete sponsorAds.users[uid];
                        }
                        saveSponsorAds();
                        console.log(`🗑️ 已刪除贊助廣告: ${json.adId}`);
                        return;
                    }
                }
                console.warn(`⚠️ 未找到贊助廣告: ${json.adId}`);
                return;
            }

            if (json.type === 'SPONSOR_CREATE') {
                const { userId, displayName, message, iconURL, useTTS, overlayUser, intervalMinutes, targetId } = json;
                if (!userId || !message) {
                    console.warn('⚠️ SPONSOR_CREATE 缺少必要欄位');
                    return;
                }
                const sponsor = getOrCreateSponsor(userId, displayName || userId);
                const now = new Date().toISOString();

                // 有指定 targetId 且存在 → 更新；否則新增（上限 5）
                if (typeof targetId === 'number' && targetId >= 0 && targetId < sponsor.ads.length) {
                    const ad = sponsor.ads[targetId];
                    clearAdTimer(ad.id);
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
                        scheduleAdTimer(ad.id, userId, intervalMinutes, {
                            overlayUser: ad.overlayUser, text: message, iconURL: ad.iconURL || '', useTTS: ad.useTTS
                        });
                    }
                    saveSponsorAds();
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
                saveSponsorAds();
                sendAdOverylayMessage(adRecord.overlayUser, message, adRecord.iconURL || '', adRecord.useTTS);
                if (intervalMinutes >= 15) {
                    scheduleAdTimer(adId, userId, intervalMinutes, {
                        overlayUser: adRecord.overlayUser, text: message, iconURL: adRecord.iconURL || '', useTTS: adRecord.useTTS
                    });
                }
                console.log(`✅ 手動建立贊助廣告成功: ${adRecord.overlayUser} - ${message}`);
                process.stdout.write(JSON.stringify({ type: 'SPONSOR_CREATED', adId }) + '\n');
                return;
            }

        } catch (e) {
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

loadSentMessages()
const giftMapReady = loadGiftNameMap();
loadEmojiMap();
loadSponsorAds();
resumeAdTimers();


console.log("TikTok 直播間名稱:", tiktokName);
setStreamerName(tiktokName);

const eulerKey = process.env.SIGN_API_KEY || process.env.SIGN_API;
const hasDirectCreds = !!(process.env.TIKTOK_COOKIES || process.env.SESSION_ID);
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
    console.log('[TikTok] Using direct signer (TIKTOK_COOKIES/SESSION_ID)');
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





function stripEmojiUrls(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/https?:\/\/[^\s]+(?:png|jpg|jpeg|gif|webp)[^\s]*/gi, '').trim();
}

function pickEmojiIcon(comment) {
    if (!comment || typeof comment !== 'string') return null;
    const map = getEmojiMap();
    const matched = Object.entries(map).filter(([code]) => comment.includes(code));
    if (matched.length === 0) return null;
    const pick = matched[Math.floor(Math.random() * matched.length)];
    return { code: pick[0], url: pick[1] };
}

function stripEmojiCodes(text, keepCode) {
    if (!text || typeof text !== 'string') return text;
    const map = getEmojiMap();
    let result = text;
    for (const code of Object.keys(map)) {
        if (code === keepCode) continue;
        result = result.split(code).join('');
    }
    if (keepCode) {
        const count = (result.match(new RegExp(keepCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        if (count > 1) {
            result = result.replace(new RegExp(keepCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim();
            result = keepCode + ' x' + count + (result ? ' ' + result : '');
        }
    }
    return result.replace(/\s+/g, ' ').trim();
}

async function sendBarkNotification(title = "Twitch", comment, icon, url) {

    if (!isBark) { return }
    if (!Bark || Bark.toLowerCase() === "none") return;

    try {
        const pick = pickEmojiIcon(comment);
        let finalIcon = pick ? pick.url : icon;
        if (!pick) {
            const imgMatch = comment.match(/https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?/i);
            if (imgMatch) finalIcon = imgMatch[0];
        }
        const body = stripEmojiCodes(stripEmojiUrls(comment), pick ? pick.code : null);
        const payload = { title, body, icon: finalIcon };
        if (url) payload.url = url;
        console.info(`📢 發送 Bark 通知: ${title} - ${body}`);
        await axios.post(Bark, payload, { headers: { "Content-Type": "application/json; charset=utf-8" } });

        console.info("✅ Bark 推送成功");
    } catch (err) {
        console.error("❌ Bark 推送錯誤:", err.message);
    }
}




function sendToTCP(payload, dedupUser, dedupMessage) {
    if (!client || client.destroyed) return;

    const checkUser = dedupUser ?? payload.user;
    const checkMsg = dedupMessage ?? payload.message;
    if (isDuplicate(checkUser.trim(), checkMsg.trim())) {
        console.log('🚫 重複訊息跳過:', payload.user, payload.message);
        return;
    }

    console.log('📤 發送 TCP 訊息:紀錄',payload.user,payload.message);
    console.log('📤 發送 TCP 訊息Sync:', payload);

    try {
        var payload_bak = { ...payload }
        payload_bak.message = replaceEmojis(payload.message)

        var CHAT_RES = payload_bak.message

        Translate.TranslateText(payload_bak.message).then(RES=>{
            
            if (payload_bak.message != RES) {
                CHAT_RES += `\n${RES}`
            }

            payload_bak["message"] = CHAT_RES

            client.write(JSON.stringify(payload_bak) + '\n');
        })


        


        

        addToSyncBuffer((dedupUser ?? payload.user).trim(), (dedupMessage ?? payload.message).trim());

    } catch (err) {
        console.error('⚠️ 發送 TCP 訊息失敗:', err.message);
    }

}





// ===== 暫存最多 10 筆 =====
var syncBuffer = []; // [{ username, message, timestamp }]

function addToSyncBuffer(username, message) {
    syncBuffer.push({
        username,
        message,
        timestamp: Date.now()
    });


    // 清理超過 60 秒的訊息
    const now = Date.now();
    syncBuffer = syncBuffer.filter(item => now - item.timestamp <= 60000);
        
    // 超過 500 筆就移除最舊的
    if (syncBuffer.length > 500) {
        syncBuffer.shift();
    }
}

function isDuplicate(username, message) {
    // 只比對第一行原始文字（翻譯會附加在 \n 之後）
    const originalPart = message.split('\n')[0].trim();
    return syncBuffer.some(item =>
        item.username === username &&
        item.message === originalPart
    );
}

var CacheUserList = [] // 用於去重的用戶列表
var CacheUserNum = 0 // 用於去重的用戶數量
var TikTokViewerCount = 0
var TwitchViewerCount = 0
var OdyseeViewerCount = 0
var YoutubeViewerCount = 0


function sendAdOverylayMessage(user,text,iconURL,useTTS){

    const payload = { type: 'AdOverlay', user, text, iconURL, useTTS };
    
    console.log('📤 發送 AdOverlay 訊息:', payload);
    if (!client || client.destroyed) {
        pendingQueue.push(payload);
        return;
    }
    
    try {
        client.write(JSON.stringify(payload) + '\n');
    } catch (err) {
        console.error('⚠️ 發送 AdOverlay 訊息失敗:', err.message);
        pendingQueue.push(payload);
    }
    
}

// ---- 贊助廣告持久化 ----
function loadSponsorAds() {
    try {
        if (existsSync(SPONSOR_ADS_FILE)) {
            const data = JSON.parse(readFileSync(SPONSOR_ADS_FILE, 'utf-8'));
            if (!data.settings && !data.users) {
                sponsorAds = { settings: { reviewMode: 'none' }, users: data };
                saveSponsorAds();
            } else {
                sponsorAds = data;
            }
            if (!sponsorAds.settings) sponsorAds.settings = { reviewMode: 'none' };
            if (!sponsorAds.users) sponsorAds.users = {};
            console.log(`📂 已載入贊助廣告資料 (${Object.keys(sponsorAds.users).length} 位贊助者)`);
        } else {
            sponsorAds = { settings: { reviewMode: 'none' }, users: {} };
        }
    } catch (err) {
        console.error('⚠️ 載入贊助廣告資料失敗:', err.message);
        sponsorAds = { settings: { reviewMode: 'none' }, users: {} };
    }
}

function saveSponsorAds() {
    try {
        writeFileSync(SPONSOR_ADS_FILE, JSON.stringify(sponsorAds, null, 2), 'utf-8');
    } catch (err) {
        console.error('⚠️ 儲存贊助廣告資料失敗:', err.message);
    }
}

function getOrCreateSponsor(userId, displayName) {
    if (!sponsorAds.users[userId]) {
        sponsorAds.users[userId] = {
            userId,
            displayName,
            ads: []
        };
    } else {
        sponsorAds.users[userId].displayName = displayName;
    }
    return sponsorAds.users[userId];
}

function scheduleAdTimer(adId, userId, intervalMinutes, adData) {
    clearAdTimer(adId);
    if (!intervalMinutes || intervalMinutes < 15) return;
    const ms = intervalMinutes * 60 * 1000;
    adTimers[adId] = setTimeout(() => {
        console.log(`⏰ 贊助廣告定時觸發: ${adData.overlayUser} - ${adData.text}`);
        sendAdOverylayMessage(adData.overlayUser, adData.text, adData.iconURL, adData.useTTS);
        sendBarkNotification(`⏰ 贊助廣告 (${adData.overlayUser})`, adData.text, adData.iconURL || '', SPONSOR_MANAGE_URL);
        scheduleAdTimer(adId, userId, intervalMinutes, adData);
    }, ms);
    const sponsor = sponsorAds.users[userId];
    if (sponsor) {
        const ad = sponsor.ads.find(a => a.id === adId);
        if (ad) {
            ad.lastSentAt = new Date().toISOString();
            ad.intervalMinutes = intervalMinutes;
        }
        saveSponsorAds();
    }
    console.log(`⏰ 已設定贊助廣告定時器: ${adId} (每 ${intervalMinutes} 分鐘)`);
}

function clearAdTimer(adId) {
    if (adTimers[adId]) {
        clearTimeout(adTimers[adId]);
        delete adTimers[adId];
    }
}

function clearAllAdTimers() {
    for (const adId of Object.keys(adTimers)) {
        clearTimeout(adTimers[adId]);
    }
    adTimers = {};
}

// 啟動時恢復有效廣告的定時器
function resumeAdTimers() {
    let count = 0;
    const now = Date.now();
    for (const uid of Object.keys(sponsorAds.users)) {
        for (const ad of sponsorAds.users[uid].ads) {
            if (!ad.enabled || !ad.intervalMinutes || ad.intervalMinutes < 15 || ad.approved === false) continue;
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
            adTimers[ad.id] = setTimeout(() => {
                console.log(`⏰ 贊助廣告定時觸發(恢復): ${ad.overlayUser} - ${ad.message}`);
                sendAdOverylayMessage(ad.overlayUser, ad.message, ad.iconURL || '', ad.useTTS);
                sendBarkNotification(`⏰ 贊助廣告 (${ad.overlayUser})`, ad.message, ad.iconURL || '', SPONSOR_MANAGE_URL);
                ad.lastSentAt = new Date().toISOString();
                saveSponsorAds();
                scheduleAdTimer(ad.id, uid, ad.intervalMinutes, {
                    overlayUser: ad.overlayUser, text: ad.message, iconURL: ad.iconURL || '', useTTS: ad.useTTS
                });
            }, delayMs);
            count++;
            console.log(`⏰ 已恢復贊助廣告定時器: ${ad.id} (${Math.round(delayMs/60000)} 分鐘後首次發送)`);
        }
    }
    if (count > 0) console.log(`⏰ 恢復了 ${count} 個贊助廣告定時器`);
}

/**
 * 觀眾人數更新
 *
 * @return {*} 
 */
function sendAudienceUpdate() {
    const payload = { type: 'audience', userNum: CacheUserNum, userList: CacheUserList };
    if (!client || client.destroyed) {
        pendingQueue.push(payload);
        return;
    }
    try {
        client.write(JSON.stringify(payload) + '\n');
    } catch (err) {
        console.error('⚠️ 發送 Audience 訊息失敗:', err.message);
        pendingQueue.push(payload);
    }
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
function sendSocketMessage(user, message, img, giftImg,isMain=true,userNum=0,userList=[], dedupUser, dedupMessage) {

    const checkUser = dedupUser ?? user;
    const checkMsg = dedupMessage ?? message;
    if (isDuplicate(checkUser.trim(), checkMsg.trim())) {
        console.log('🚫內部 重複訊息跳過:', user, message, `(原始: ${checkUser} : ${checkMsg})`);
        return;
    }

    
    const processedMessage = replaceEmojis(String(message));

    const payload = {
        type: 'StreamMessage',
        user: String(user),
        message: processedMessage,
        img,
        giftImg,
        isMain: Boolean(isMain),
        userNum: Number(userNum),
        userList
    };

    if (!client || client.destroyed) {
        if (pendingQueue.length < MAX_PENDING) {
            pendingQueue.push(payload);
        }
        return;
    }
    
    try {
        console.log('📤[TK] 發送 Socket 訊息:', payload);
        client.write(JSON.stringify(payload) + '\n');
    } catch (err) {
        console.error('⚠️ 發送 Socket 訊息失敗:', err.message);
        if (pendingQueue.length < MAX_PENDING) {
            pendingQueue.push(payload);
        }
    }
}

var TkRetryCount = 0
let TkRetryMaxCount = 5

function connectSocket() {
    if (!isSocket) { return }
    if (client && !client.destroyed) return; // 已經連線中

    client = new net.Socket();
    
    client.connect(PORT, HOST, () => {
        console.log('✅ TCP Socket connected');
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        // 連線成功 → 清空重連計數與間隔
        socketRetryCount = 0;
        socketRetryInterval = SOCKET_RETRY_BASE;
        flushPendingQueue();
        if (isFirstSocketConnect) {
            sendSocketMessage("系統", "TTW Chat Message Server 已連線", "", "", false,CacheUserNum,CacheUserList);
            isFirstSocketConnect = false;
        }
    });

    var buffer = '';

    client.on('data', (data) => {
        buffer += data.toString();

        // 按照換行符號切割
        let parts = buffer.split('\n');
        buffer = parts.pop(); // 最後可能是不完整的，留著下次再拼

        for (const part of parts) {
            try {
                const json = JSON.parse(part.trim());
                console.log('收到服務器訊息:', json);

                if (json.type === 'keepalive') {
                    client.write(JSON.stringify({ type: 'heartbeat' }) + '\n');
                    console.log('💓 收到 keepalive，已回覆 heartbeat ' + new Date().toLocaleString());
                }

                buffer = ''; // 清空 buffer，避免重複解析
            } catch (e) {
                console.log('解析失敗:', part);
            }
        }
    });

    client.on('close', () => {
        if (isEnd){
            console.log("程式已結束，停止重連");
            return; 
        }

        socketRetryCount++;
        if (socketRetryCount > SOCKET_RETRY_THRESHOLD) {
            socketRetryInterval = Math.min(socketRetryInterval + SOCKET_RETRY_STEP, SOCKET_RETRY_MAX);
        }
        console.log(`⚠️ TCP Socket closed，${socketRetryCount} 次斷線，${Math.round(socketRetryInterval/1000)} 秒後重連`);
        reconnectTimer = setTimeout(connectSocket, socketRetryInterval);
        
    });

    client.on('error', (err) => {
        console.error('⚠️ TCP Socket error:', err.message);
        client?.destroy();
    });
}


var RoomID = ""
var writeViewCount = 0
var writeDebugView = false

function viewCache() {
    console.log("📊 CacheUserNum:", CacheUserNum)
    console.log("📋 CacheUserList:", CacheUserList);

    connection.fetchRoomInfo(RoomID).then(async (roomInfo) => {
        let Viewer = roomInfo.data.user_count

        if (writeViewCount > 100 && writeDebugView) {
            writeLog("Default", `DEBUG View:\n${JSON.stringify(roomInfo)}`, "View統計")
            console.log("🔄 更新觀眾數量 寫入Debug_RoomInfo數據:", Viewer)
            writeViewCount = 0
        }

        writeViewCount += 1
        TikTokViewerCount = Viewer
        updateCombinedViewerCount();

    }).catch(err => {
        console.log("RoomError", err.message)
    })
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

        RoomID = state.roomId

        let DisplayTitle = connection.state.roomInfo.data.title || "未知直播間";
        TikTokViewerCount = connection.state.roomInfo.data.user_count || 0;
        CacheUserNum = (isTK && isTwitch) ? TikTokViewerCount + TwitchViewerCount : TikTokViewerCount;
        
        sendBarkNotification("TikTok 直播間連線成功", `已連接到 ${tiktokName} 的直播間 ${DisplayTitle}`, "");
        sendSocketMessage("系統", `TikTok 直播間連線成功，已連接到 ${tiktokName} 的直播間 ${DisplayTitle}`, "", "", false,CacheUserNum,CacheUserList);
        // 連線成功後恢復贊助廣告定時器
        resumeAdTimers();
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
        sendBarkNotification("TikTok 直播間連線失敗", (errDetail.message || "").substring(0, 100));
        sendSocketMessage("系統", `TikTok 直播間連線失敗: ${err.message}`, "", "", false, CacheUserNum, CacheUserList);

        // 暫時停用重連機制，改為直接退出程式，避免無限重試
        // if (TkRetryCount < TkRetryMaxCount) {
        //     TkRetryCount += 1;
        //     //console.log(`${TkRetryCount} 秒後嘗試重新連線 (${TkRetryCount}/${TkRetryMaxCount})...`);
        //     // setTimeout(() => {
        //     //     connection.connect().then(state => {
        //     //         console.log(`重新連線成功，roomId ${state.roomId}`);
        //     //         TkRetryCount = 0;
        //     //         RoomID = state.roomId;
        //     //     }).catch(err => {
        //     //         console.error("重新連線失敗:", err.message);
        //     //     });
        //     // }, 15000);


        // }

    });

    setInterval(viewCache, 10000); // 每10秒更新一次用戶數量   


}


connection.on(ControlEvent.DISCONNECTED, (e) => {
    console.log('Disconnected :( \(error code: ' + e.errorCode + ', reason: ' + e.reason + ')');
    
    sendBarkNotification("TikTok 直播間已斷線", `已從 ${tiktokName} 的直播間斷線`, "");
    sendSocketMessage("系統", `TikTok 直播間已斷線，已從 ${tiktokName} 的直播間斷線`, "", "", false,CacheUserNum,CacheUserList);

    clearInterval(viewCache);

    if (isEnd) return;

    setTimeout(() => {
        if (TkRetryCount >= TkRetryMaxCount) {
            console.log("已達 TikTok 最大重連次數，停止重連");
            sendSocketMessage("系統", "TikTok 重連已達上限，請重新啟動", "", "", false,CacheUserNum,CacheUserList);
            return;
        }

        TkRetryCount += 1;
        console.log(`TikTok 重新連線嘗試 (${TkRetryCount}/${TkRetryMaxCount})...`);
        sendSocketMessage("系統", `TikTok 重新連線嘗試 (${TkRetryCount}/${TkRetryMaxCount})...`, "", "", false,CacheUserNum,CacheUserList);

        connection.connect().then(state => {
            console.log(`重新連線成功，roomId ${state.roomId}`);
            TkRetryCount = 0;
            RoomID = state.roomId;
            setInterval(viewCache, 10000);
            sendSocketMessage("系統", "TikTok 重新連線成功", "", "", false,CacheUserNum,CacheUserList);
        }).catch(err => {
            console.error("重新連線失敗:", err.message);
            sendSocketMessage("系統", `TikTok 重新連線失敗: ${err.message}`, "", "", false,CacheUserNum,CacheUserList);
        });

    }, 15000);
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
    sendBarkNotification('👋 加入', body, randomAvatar);
    memberBarkAccum = [];
    memberBarkTimer = null;
}

connection.on(WebcastEvent.MEMBER,data => {
    logRawEvent('MEMBER', data);

    let iconn = getTikTokProfilePic(data.user)
    
    console.log(data.user.nickname,"加入了") 
    console.log("STATE View",connection.state.roomInfo.data.user_count,CacheUserNum) 

    // 跨路徑去重：檢查是否已被 userscript 路徑送出（檢查 syncBuffer）
    const isCrossPathDuplicate = isDuplicate(data.user.nickname.trim(), "加入了");

    if (isCrossPathDuplicate) {
        console.log('🚫 跨路徑重複(來自userscript):', data.user.nickname, "加入了");
        writeLog("Default", `跨路徑重複訊息被過濾(來自userscript): ${data.user.nickname} : 加入了`, "CrossPathDuplicate")
        return;
    }

    const fr = processFilter({ user: data.user.nickname, message: "加入了" });
    if (fr.blocked) {
        console.log('🚫 過濾器阻擋:', data.user.nickname, "加入了", `(規則: ${fr.reason})`);
        writeLog("Default", `過濾器阻擋訊息: ${data.user.nickname} : 加入了 (規則: ${fr.reason})`, "FilterBlocked")
        addToSyncBuffer(data.user.nickname.trim(), "加入了");
        return;
    }

    let nickname = fr.modified && fr.user ? fr.user : data.user.nickname;
    let message = fr.modified && fr.message ? fr.message : "加入了";

    if (!nickname || !message) {
        console.log('⚠️ 過濾後 nick/message 為空，跳過:', data.user.nickname, "加入了");
        writeLog("Default", `過濾後 nick/message 為空，跳過: ${data.user.nickname} : 加入了`, "FilterEmpty")
        addToSyncBuffer(data.user.nickname.trim(), "加入了");
        return;
    }

    // socket：維持逐筆發送
    sendSocketMessage(nickname, "來了",iconn,"",false,CacheUserNum,CacheUserList, data.user.nickname, "加入了");

    // bark：累計後合併發送
    memberBarkAccum.push({ nickname, avatar: iconn });
    if (memberBarkTimer) clearTimeout(memberBarkTimer);
    memberBarkTimer = setTimeout(flushMemberBark, 3000);

    addToSyncBuffer(data.user.nickname.trim(), "加入了");

})

connection.on(WebcastEvent.FOLLOW,data =>{
    logRawEvent('FOLLOW', data);
    let iconn = getTikTokProfilePic(data.user)
    console.log(data.user.nickname,"關注了主播")

    sendBarkNotification(data.user.nickname, "關注了主播",iconn);
    sendSocketMessage(data.user.nickname, "關注了主播",iconn,"",false,CacheUserNum,CacheUserList);
    addToSyncBuffer(data.user.nickname.trim(), "關注了主播");

})


connection.on(WebcastEvent.CHAT, data => {
    logRawEvent('CHAT', data);

    if (!data.content) {
        if (data.emotes && data.emotes.length > 0) {
            data.content = `[表情] ${data.emotes[0]?.emoteId || ''}`;
        } else {
            return;
        }
    }

    const uniqueKey = `chat_${data.user.nickname}_${data.content}`;
    if (alreadySent(uniqueKey)) return;

    // 跨路徑去重：檢查是否已被 userscript 路徑送出（檢查 syncBuffer）
    const isCrossPathDuplicate = isDuplicate(data.user.nickname.trim(), data.content.trim());

    if (isCrossPathDuplicate) {
        console.log('🚫 跨路徑重複(來自userscript):', data.user.nickname, data.content);
        writeLog("Default", `跨路徑重複訊息被過濾(來自userscript): ${data.user.nickname} : ${data.content}`, "CrossPathDuplicate")
        return;
    }

    const fr = processFilter({ user: data.user.nickname, message: data.content });
    if (fr.blocked) {
        console.log('🚫 過濾器阻擋:', data.user.nickname, data.content, `(規則: ${fr.reason})`);
        writeLog("Default", `過濾器阻擋訊息: ${data.user.nickname} : ${data.content} (規則: ${fr.reason})`, "FilterBlocked")
        addToSyncBuffer(data.user.nickname.trim(), data.content.trim());
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
        addToSyncBuffer(data.user.nickname.trim(), data.content.trim());
        return;
    }

    // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
    comment = replaceEmojis(comment);

    recordMessageStat(comment);

    sendBarkNotification(nickname, comment,iconn);

    Translate.TranslateText(comment).then(RES=>{
            var RESCHAT=`${comment}`
            if (comment != RES) {
                RESCHAT += `\n${RES}`
            }

            writeLog("Default", `${nickname} : ${RESCHAT}`, "Chat")

            if (RES.toLowerCase() != comment.toLowerCase() ) {
                sendBarkNotification(nickname + "[翻譯]", RES,iconn);
            }

            sendSocketMessage(nickname, RESCHAT,iconn,"",true,CacheUserNum,CacheUserList, data.user.nickname, data.content);

            recordMessageStat(RESCHAT);

            addToSyncBuffer(data.user.nickname.trim(), data.content.trim());
        
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
        sendBarkNotification(nickname, mess, profilePic);
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

    let totalLikeCount = parseInt(data.total) || 0
    let likeCount = likeUserCount(data.user.nickname, data.count || 0)

    let mess = `喜歡你 ${likeCount} 次`

    console.log(`${data.user.nickname} ${mess}`)

    sendBarkNotification(data.user.nickname, mess,iconn);
    sendSocketMessage(data.user.nickname, mess,iconn,"",false,CacheUserNum,CacheUserList);
    addToSyncBuffer(data.user.nickname.trim(), mess);

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
    const translatedGiftName = await ensureGiftNameTranslation(originalGiftName);
    const giftNameForDisplay = translatedGiftName || originalGiftName;
    let iconn = getTikTokProfilePic(data.user)
    let giftImg = giftInfo?.icon?.urlList?.[0] || ""

    if (giftInfo?.type === 1 && !data.repeatEnd) {
        // 連擊進行中 → 只發連擊進度，不回到底部
        let mess = `連擊了 ${giftNameForDisplay} ${data.repeatCount} 個`
        console.log(`連擊了 ${data.user.nickname} : ${giftNameForDisplay} x${data.repeatCount}`)
        sendBarkNotification(data.user.nickname, mess, giftImg);
        sendSocketMessage(data.user.nickname, mess, iconn, giftImg, true, CacheUserNum, CacheUserList);
        addToSyncBuffer(data.user.nickname.trim(), mess);
        writeLog("Default", `${data.user.nickname} ${mess}`, "Gift連擊")
        return;
    }

    // 連擊結束 / 非連擊禮物 → 送出最終通知
    let mess = `送出了 ${giftNameForDisplay} ${data.repeatCount} 個`
    console.log(`送出了 ${data.user.nickname} : ${giftNameForDisplay} ${data.repeatCount} 個`)

    sendBarkNotification(data.user.nickname, mess, giftImg);
    sendSocketMessage(data.user.nickname, mess, iconn, giftImg, true, CacheUserNum, CacheUserList);
    addToSyncBuffer(data.user.nickname.trim(), mess);
    writeLog("Default", `${data.user.nickname} ${mess}`, "Gift")

    // 累計送禮次數感謝（同一使用者 60 秒內送禮 >= 5 次）
    let count = recordGift(data.user.displayId);
    if (count >= 5) {
        let thanks = `${data.user.nickname} 謝謝支持`
        console.log("5次送禮感謝", data.user.nickname, thanks)
        sendBarkNotification(data.user.nickname, thanks, giftImg);
        sendSocketMessage("感謝大哥的餽贈", thanks, iconn, giftImg, true, CacheUserNum, CacheUserList);
        addToSyncBuffer(data.user.nickname.trim(), thanks);
        writeLog("Default", thanks, "Gift感謝")
        UserGiftCount.set(data.user.displayId, { count: 0, lastGiftTimestamp: Date.now() });
    }
});


connection.on(WebcastEvent.SHARE, data =>{
    logRawEvent('SHARE', data);
    let mess = "分享直播間"
    let iconn = getTikTokProfilePic(data.user)
    console.log(`${data.user.nickname} ${mess}`)
    
    sendBarkNotification(data.user.nickname, mess,iconn);
    sendSocketMessage(data.user.nickname, mess,iconn,"",false,CacheUserNum,CacheUserList);
    addToSyncBuffer(data.user.nickname.trim(), mess);

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
    sendBarkNotification(senderName, mess, profilePic);
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

    sendBarkNotification(nickname, mess, iconn);
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
        sendBarkNotification(data.user.nickname, mess,IMG);
        sendSocketMessage(data.user.nickname, mess,IMG,"",false);

    }
    if (action === ControlAction.CONTROL_ACTION_STREAM_SUSPENDED) {
        console.log('Stream ended by platform moderator (ban)');
        sendBarkNotification(data.user.nickname, mess,IMG);
        sendSocketMessage(data.user.nickname, mess,IMG,"",false);

        writeLog("Default", "直播被強行終止了 :(", "Stream Status")

    }
});


function fetchAndSyncGifts() {
    writeLog("Default", "開始取得 TikTok禮物列表", "System")
    connection.fetchAvailableGifts().then(async (giftList) => {
        await giftMapReady;
        console.log(tiktokName,"Tiktok giftList.length:", giftList.length);
        await syncGiftMapFromGiftList(giftList);
        await backfillGiftTranslationsFromGiftList(giftList);
        await saveGiftCatalog(giftList);
    }).catch(err => {
        console.error("取得禮物列表失敗:", err.message);
    })
}



// --- 1. Auth ---
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;


const tokenPath = path.resolve('./tokens.json');

// 定義空範本
const emptyTokenTemplate = {
    accessToken: "",
    refreshToken: "",
    scope: [
        "bits:read",
        "channel:read:goals",
        "channel:read:redemptions",
        "channel:read:subscriptions",
        "chat:read",
        "clips:edit",
        "moderator:read:followers",
        "user:read:chat",
        "user:read:subscriptions"
    ],
    expiresIn: 0,
    obtainmentTimestamp: Date.now()
};
// 檢查 tokens.json 是否存在且有效，否則建立空範本

async function loadTokens() {
    try {
        const data = await fs.readFile(tokenPath, 'utf-8');
        const raw = JSON.parse(data);
        // 標準化：將 snake_case（Twitch API 原始格式）轉為 camelCase（twurple 格式）
        if (raw.access_token && !raw.accessToken) {
            raw.accessToken = raw.access_token;
            raw.refreshToken = raw.refresh_token || raw.refreshToken;
            raw.expiresIn = raw.expires_in ?? raw.expiresIn;
            raw.obtainmentTimestamp = raw.obtainmentTimestamp || Date.now();
        }
        return raw;
    } catch (err) {
        if (err.code === 'ENOENT') {
            // 檔案不存在 → 建立空範本
            await fs.writeFile(tokenPath, JSON.stringify(emptyTokenTemplate, null, 4), 'utf-8');
            return emptyTokenTemplate;
        } else {
            // 其他錯誤直接丟
            throw err;
        }
    }
}

    const REQUIRED_TWITCH_SCOPES = ['user:read:subscriptions'];

async function ensureTwitchScopes(tokenData, authProvider) {
    const missing = REQUIRED_TWITCH_SCOPES.filter(s => !tokenData.scope?.includes(s));
    if (missing.length === 0) {
        console.log('✅ Twitch OAuth scope 完整');
        return;
    }

    console.warn(`⚠️ Twitch token 缺少 scope:`, missing.join(', '));
    console.log(`📋 目前 scope: ${(tokenData.scope || []).join(', ')}`);
    console.log('需重新授權以取得完整權限。');

    const SERVER_PORT = process.env.TWITCH_REDIRECT_URI
        ? new URL(process.env.TWITCH_REDIRECT_URI).port || '3332'
        : '3332';
    const redirectUri = `http://localhost:${SERVER_PORT}/twitch-oauth-callback`;
    console.log(`ℹ️ 回調網址: ${redirectUri}`);

    const scopes = [...new Set([...(tokenData.scope || []), ...REQUIRED_TWITCH_SCOPES])].join(' ');
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}`;

    console.log(`🔗 正在瀏覽器中開啟 Twitch 授權頁面…`);
    try {
        const { execSync } = await import('child_process');
        execSync(`start "" "${authUrl}"`, { timeout: 5000 });
    } catch (_) {
        console.log(`若瀏覽器未自動開啟，請手動訪問授權連結`);
    }

    let code = null;
    const pollUrl = `http://localhost:${SERVER_PORT}/twitch-oauth-poll`;
    const deadline = Date.now() + 120000;
    console.log(`⏳ 等待用戶授權中（最長 120 秒）...`);
    while (Date.now() < deadline) {
        try {
            const res = await fetch(pollUrl);
            if (res.ok) {
                const data = await res.json();
                if (data.code) {
                    code = data.code;
                    console.log(`✅ 收到授權碼，正在交換 token...`);
                    break;
                }
            }
        } catch (_) {
            // Server.js not ready yet
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    if (!code) {
        console.error('❌ Twitch OAuth 逾時（2分鐘），請重啟程式再試');
        console.warn('💡 也可透過 Config 頁面手動重新授權: http://localhost:3332/config');
        return;
    }

    console.log(`🔄 正在交換 authorization code 為 access token...`);
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
        })
    });

    if (!tokenRes.ok) {
        const errText = await tokenRes.text().catch(() => '');
        console.error('❌ Token 交換失敗:', tokenRes.status, errText);
        return;
    }

    const newToken = await tokenRes.json();
    console.log(`📦 Token 回應: access_token=***${newToken.access_token?.slice(-6)}, expires_in=${newToken.expires_in}s, scope=${(newToken.scope || []).join(',')}`);

    const normalizedToken = {
        accessToken: newToken.access_token,
        refreshToken: newToken.refresh_token,
        expiresIn: newToken.expires_in,
        scope: newToken.scope || scopes.split(' '),
        obtainmentTimestamp: Date.now()
    };

    await fs.writeFile(tokenPath, JSON.stringify(normalizedToken, null, 4), 'utf-8');
    console.log('✅ tokens.json 已更新');

    console.log(`🔄 正在更新 authProvider...`);
    try {
        await authProvider.addUserForToken(normalizedToken);
        console.log('✅ Twitch OAuth 完成，Token 已生效');
    } catch (err) {
        console.error('❌ authProvider 更新失敗:', err.message);
    }
}

const tokenData = await loadTokens();

const authProvider = new RefreshingAuthProvider({ clientId, clientSecret });
authProvider.onRefresh(async (userId, newTokenData) => {
    await fs.writeFile(`./tokens.json`, JSON.stringify(newTokenData, null, 4), 'utf-8');
});
await authProvider.addUserForToken(tokenData).catch(err => {
    console.warn('⚠️ Twitch token 無效，可透過 Config 頁面重新授權:', err.message);
});
if (isTwitch) await ensureTwitchScopes(tokenData, authProvider);

let apiClient, listener, tuser;
try {
    apiClient = new ApiClient({ authProvider });

    let TwitchUserName = process.env.TWITCH_USER_NAME || "coffeelatte0709"
    const user = await apiClient.users.getUserByName(TwitchUserName);
    tuser = user.id;

    console.log("[Twitch] UserID", tuser);
    writeLog("Default", `取得 Twitch UserID: ${tuser}`, "System")


    // --- 2. EventSub WebSocket ---
    listener = new EventSubWsListener({ apiClient, port: 0 });

    if (isTwitch) {
        console.log("啟用 Twitch 事件監聽");

        writeLog("Default", "啟用 Twitch 事件監聽", "System")

        listener.start();
    }
} catch (err) {
    console.error('⚠️ Twitch 初始化失敗（token 無效或缺少權限），Twitch 功能已停用:', err.message);
    console.warn('💡 可透過 Config 頁面重新授權: http://localhost:3332/config');
}


async function getUserIcon(id) {
    const uss = await apiClient.users.getUserById(id);
    return uss.profilePictureUrl;
}








connectSocket();

// Twitch 觀眾數定時更新
function twitchViewCache() {
    apiClient.streams.getStreamByUserId(tuser).then(stream => {
        if (stream) {
            TwitchViewerCount = stream.viewers;
            let DA = new Date()
            console.log(`📊 Twitch 觀眾數: ${TwitchViewerCount} ${DA.toLocaleString()}`);
            writeLog("Default", `Twitch 觀眾數: ${TwitchViewerCount} ${DA.toLocaleString()}`, "Twitch View");
            updateCombinedViewerCount();
        }
    }).catch(err => {
        console.error("⚠️ Twitch 觀眾數取得失敗:", err.message);
    });
}

if (isTwitch) {
    console.log("啟用 Twitch 觀眾數定時更新 (30秒)");
    twitchViewCache();
    setInterval(twitchViewCache, 30000);
}


// 錯誤處理
listener.on("error", (err) => {
    console.error('⚠️ Twitch EventSub Listener error:', err);

    writeLog("Default", `Twitch EventSub Listener error: ${err.message || err}`, "Error")

    sendBarkNotification("Twitch 事件監聽錯誤", `Twitch EventSub Listener error: ${err.message || err}`, "");
    sendSocketMessage("系統", `Twitch 事件監聽錯誤: ${err.message || err}`, "", "", false,CacheUserNum,CacheUserList);
    
});



// --- 3. Twitch EventSub 直播開始/結束 ---
listener.onStreamOnline(tuser, async (event) => {
    const message = `直播開始啦！標題：${event.broadcasterName} ${event.type}`; 

    console.log(message);
    sendBarkNotification("直播開始啦！", `${event.broadcasterName} ${event.type}`, "");
    sendSocketMessage("系統", message, "", "", false,CacheUserNum,CacheUserList);

    writeLog("Default", message, "Twitch Stream Status")

    
});

listener.onStreamOffline(tuser, async (event) => {
    const message = `直播結束啦！標題：${event.broadcasterName}`;  

    console.log(message);

    sendBarkNotification("直播結束啦！", `${event.broadcasterName}`, "");
    sendSocketMessage("系統", message, "", "", false,CacheUserNum,CacheUserList);

    writeLog("Default", message, "Twitch Stream Status")

}); 


// --- 5. Twitch EventSub ---
listener.onChannelFollow(tuser, tuser, async (event) => {
    const icon = await getUserIcon(event.userId);
    const message = `關注了主播`;

    console.log(message);

    sendBarkNotification(event.userDisplayName, "關注了主播", icon);

    sendSocketMessage(event.userDisplayName, message, icon,"", false,CacheUserNum,CacheUserList);

    writeLog("Default", `${event.userDisplayName} ${message}`, "Twitch Follow")

});

listener.onChannelCheer(tuser, tuser, async (event) => {
    const message = `送出 ${event.bits} 小奇點`;
    const icon = await getUserIcon(event.userId);

    console.log(`${event.userDisplayName} ${message}`);

    sendBarkNotification(event.userDisplayName, message, icon);
    sendSocketMessage(event.userDisplayName, message, icon,"", false,CacheUserNum,CacheUserList);

    writeLog("Default", `${event.userDisplayName} ${message}`, "Twitch Cheer")

    
});

listener.onChannelChatMessage(tuser, tuser, async (event) => {
    const icon = await getUserIcon(event.chatterId);
    
    
    console.log(`${event.chatterDisplayName} : ${event.messageText}`);

    // 需要先確認是不是Twitch訂閱者（或主播本人）才能使用 G#Ad
    if (event.messageText.startsWith("G#Ad")) {

        if (event.chatterId === tuser) {
            console.log(`${event.chatterDisplayName} 是主播本人，視同訂閱者可以使用 G#Ad 指令`);
            handleGAd(event);
            return;
        } else {
            apiClient.subscriptions.checkUserSubscription(tuser, event.chatterId).then(subRes => {
                if (subRes.isSubscribed) {
                    console.log(`${event.chatterDisplayName} 是訂閱者（${subRes.tier || '?'} 方案, 累計 ${subRes.totalMonths || 0} 月），可以使用 G#Ad 指令`);
                    handleGAd(event);
                    return;
                } else {
                    console.log(`${event.chatterDisplayName} 不是訂閱者（API 回傳 isSubscribed=false），無法使用 G#Ad 指令`);
                }

            }).catch(err => {
                console.error(`⚠️ [訂閱檢查] ${event.chatterDisplayName} 查詢失敗: ${err.message} (status=${err.response?.status || 'N/A'})`);
                if (err.response?.status === 404) {
                    console.log(`   → 使用者 ${event.chatterDisplayName} 未訂閱此頻道（404）`);
                } else if (err.message?.includes('scope')) {
                    console.warn('   → 缺少 scope: user:read:subscriptions，可透過 Config 重新授權');
                } else {
                    console.log(`   → 完整錯誤:`, err.response?.data?.message || err.message);
                }
            });
        }

    }

    function handleGAd(event) {
        if (event.messageText.startsWith("G#Ad") ) {

            var res = event.messageText.split(" ")

            let useTTS = event.messageText.toLowerCase().includes("tts")
            let iconURL = event.messageText.includes("icon=") ? event.messageText.split("icon=")[1].split(" ")[0] : null
            let displayIcon = iconURL || icon

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
                    console.warn(`⚠️ [G#Ad] ${warnMsg}`);
                    sendBarkNotification(`⚠️ 贊助廣告間隔調整 (${overlayUser})`, warnMsg, icon);
                    sendAdOverylayMessage(overlayUser, `⚠️ ${warnMsg}`, icon, false);
                    logRawEvent('G#Ad 間隔調整', { user: overlayUser, rawInterval, adjusted: 15 });
                } else {
                    intervalMinutes = rawInterval;
                }
            }

            res = res.filter(e => e.toLowerCase() !== "tts") // 去掉 TTS
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

            let lastMsg=replaceEmojis(res.join(" "));

            const sponsor = getOrCreateSponsor(event.chatterId, event.chatterDisplayName);
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
            const reviewMode = sponsorAds.settings.reviewMode || 'none';
            if (reviewMode === 'filter') {
                const fr = processFilter({ user: overlayUser, message: lastMsg });
                if (fr.blocked) {
                    approved = false;
                    const rejectReason = `過濾器阻擋: ${fr.reason || '不符合規範'}`;
                    console.log(`🚫 [G#Ad] 贊助廣告被過濾器阻擋: ${overlayUser} - ${lastMsg}`);
                    sendBarkNotification(`🚫 贊助廣告被阻擋 (${overlayUser})`, rejectReason, icon);
                    sendAdOverylayMessage(overlayUser, `⚠️ ${rejectReason}`, icon, false);
                    logRawEvent('G#Ad 審核拒絕', { user: overlayUser, message: lastMsg, reason: fr.reason });
                }
            } else if (reviewMode === 'manual') {
                approved = null; // 待審核
                console.log(`📋 [G#Ad] 贊助廣告待審核: ${overlayUser} - ${lastMsg}`);
                sendBarkNotification(`📋 贊助廣告待審核 (${overlayUser})`, lastMsg, icon, SPONSOR_MANAGE_URL);
                sendAdOverylayMessage(overlayUser, `📋 贊助廣告已送審，待管理員審核`, icon, false);
                logRawEvent('G#Ad 待審核', { user: overlayUser, message: lastMsg });
            } else {
                const intervalText = intervalMinutes >= 15 ? `每${intervalMinutes}分鐘` : '單次';
                sendBarkNotification(`📢 贊助廣告 (${overlayUser})`, `[${intervalText}] ${lastMsg}`, icon, SPONSOR_MANAGE_URL);
            }

            if (targetAd) {
                // ---- 更新現有廣告 ----
                clearAdTimer(targetAd.id);
                targetAd.message = lastMsg;
                targetAd.iconURL = iconURL;
                targetAd.useTTS = useTTS;
                targetAd.overlayUser = overlayUser;
                targetAd.intervalMinutes = intervalMinutes;
                targetAd.approved = approved;
                targetAd.enabled = approved !== false;
                targetAd.updatedAt = now;
                targetAd.lastSentAt = approved === true ? now : targetAd.lastSentAt;
                const adId = targetAd.id;

                if (approved === true) {
                    sendAdOverylayMessage(overlayUser, lastMsg, displayIcon, useTTS);
                    if (intervalMinutes >= 15) {
                        scheduleAdTimer(adId, event.chatterId, intervalMinutes, {
                            overlayUser, text: lastMsg, iconURL: displayIcon, useTTS
                        });
                    }
                }
                saveSponsorAds();
                console.log(`🔄 ${event.chatterDisplayName} 更新 G#Ad #${targetIdx} 成功，user=${overlayUser}, 訊息: ${lastMsg}, TTS: ${useTTS}, 間隔: ${intervalMinutes > 0 ? intervalMinutes + ' 分鐘' : '單次'}`);
            } else {
                // ---- 新增廣告 ----
                if (sponsor.ads.length >= 5) {
                    console.warn(`⚠️ [G#Ad] ${event.chatterDisplayName} 已達 5 則廣告上限，無法新增`);
                    sendAdOverylayMessage(overlayUser, `⚠️ 您已達到 5 則廣告上限，請先刪除舊的再新增`, icon, false);
                    return;
                }
                const adId = `ad_${event.chatterId}_${Date.now()}`;
                const adRecord = {
                    id: adId, message: lastMsg, iconURL, useTTS, overlayUser,
                    intervalMinutes, approved, enabled: approved !== false,
                    createdAt: now, updatedAt: now,
                    lastSentAt: approved === true ? now : null
                };
                sponsor.ads.push(adRecord);
                saveSponsorAds();

                if (approved === true) {
                    sendAdOverylayMessage(overlayUser, lastMsg, displayIcon, useTTS);
                    if (intervalMinutes >= 15) {
                        scheduleAdTimer(adId, event.chatterId, intervalMinutes, {
                            overlayUser, text: lastMsg, iconURL: displayIcon, useTTS
                        });
                    }
                }
                console.log(`✅ ${event.chatterDisplayName} 新增 G#Ad 成功，user=${overlayUser}, 訊息: ${lastMsg}, TTS: ${useTTS}, 間隔: ${intervalMinutes > 0 ? intervalMinutes + ' 分鐘' : '單次'}`);
            }


        }
    }
    

    if (event.messageText.startsWith("G#clip")) {

        let res = event.messageText.split(" ")
        res.shift() // 去掉 G#clip

        const title = res.length > 0 ? res.join(" ") : null
        
        apiClient.clips.createClip({
            channel:tuser,
            duration:60,
            createAfterDelay:true,
            ...(title ? { title } : {})
        }).then( (e)=>{
            

            console.log("剪輯資訊",e)
            writeLog("Default",`[剪輯建立] ${title} ${e}`)
            sendBarkNotification("剪輯建立",`${title} ${e}`,icon)
            sendSocketMessage("剪輯建立",`${title} ${e}`,icon)
            
        
            
        }
        )       

        
        
    }

    const fr = processFilter({ user: event.chatterDisplayName, message: event.messageText });
    if (fr.blocked) {
        console.log('🚫 過濾器阻擋(Twitch):', event.chatterDisplayName, event.messageText, `(規則: ${fr.reason})`);
        writeLog("Default", `過濾器阻擋(Twitch): ${event.chatterDisplayName} : ${event.messageText} (規則: ${fr.reason})`, "Filter")

        return;
    }

    console.log(fr.modified ? `過濾器修改後的訊息(Twitch): ${fr.user} : ${fr.message}` : "過濾器未修改訊息(Twitch)")

    writeLog("Default", fr.modified ? `過濾器修改後的訊息(Twitch): ${fr.user} : ${fr.message}` : "過濾器未修改訊息(Twitch)", "Filter")

    console.log(event.chatterDisplayName, "說了:", event.messageText)

    writeLog("Default", `${event.chatterDisplayName} 說了: ${event.messageText}`, "Twitch Chat Original")

    let tUser = fr.modified && fr.user ? fr.user : event.chatterDisplayName;
    let tMsg = fr.modified && fr.message ? fr.message : event.messageText;

    if (!tUser || !tMsg) {
        console.log('⚠️ 過濾後(Twitch) nick/msg 為空，跳過:', event.chatterDisplayName, event.messageText);
        return;
    }

    recordMessageStat(tMsg);

    sendBarkNotification(tUser, tMsg, icon);

    // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
    tMsg = replaceEmojis(tMsg);

    Translate.TranslateText(tMsg).then(RES=>{

            let RESCHAT=`${tMsg}${tMsg == RES ? "" :`\n${RES}`}`

            if (RES.toLowerCase() != tMsg.toLowerCase() ) {
                sendBarkNotification(tUser + "[翻譯]", RES, icon);
            }

            sendSocketMessage(tUser, RESCHAT,icon,"",true,CacheUserNum,CacheUserList);

            writeLog("Default", `${tUser} : ${RESCHAT}`, "Twitch Chat")
    })

    
});

// 其他事件同理可加 sendSocketMessage

// ===== Kick WebSocket 整合 =====

let kickWS = null;
const kickAvatarCache = new Map();

const kickTokenFile = path.join(__dirname, 'kick_tokens.json');

let kickAccessToken = null;

function loadKickTokens() {
    try {
        if (existsSync(kickTokenFile)) {
            return JSON.parse(readFileSync(kickTokenFile, 'utf8'));
        }
    } catch (err) {
        console.error('⚠️ 讀取 kick_tokens.json 失敗:', err.message);
    }
    return null;
}

async function refreshKickToken(refreshToken) {
    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.KICK_CLIENT_ID || '',
        client_secret: process.env.KICK_CLIENT_SECRET || '',
        refresh_token: refreshToken,
    });
    const res = await fetch('https://id.kick.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Kick token refresh failed: ${res.status} ${errText}`);
    }
    return res.json();
}

async function getValidKickToken() {
    if (kickAccessToken) return kickAccessToken;
    const tokens = loadKickTokens();
    if (!tokens?.access_token) return null;
    const expiresAt = (tokens.obtainmentTimestamp || 0) + (tokens.expires_in || 3600) * 1000;
    if (Date.now() >= expiresAt - 60000 && tokens.refresh_token) {
        try {
            const newTokens = await refreshKickToken(tokens.refresh_token);
            newTokens.obtainmentTimestamp = Date.now();
            writeFileSync(kickTokenFile, JSON.stringify(newTokens, null, 2));
            kickAccessToken = newTokens.access_token;
            return kickAccessToken;
        } catch (e) {
            console.error('⚠️ Kick token 刷新失敗:', e.message);
            return null;
        }
    }
    kickAccessToken = tokens.access_token;
    return kickAccessToken;
}

function guessKickChannelId(channelName) {
    const knownChannels = {
        'nuclear0709': 24640237,
    };
    return knownChannels[channelName.toLowerCase()] || 0;
}

async function resolveKickChannelId(channelName) {
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
        console.error('⚠️ 無法取得 Kick 頻道資訊:', e.message);
        return 0;
    }
}

async function getKickUserAvatar(username, userId) {
    if (username === '未知' || (!username && !userId)) return "";
    const cacheKey = (username || userId || "").toString().toLowerCase();
    const cached = kickAvatarCache.get(cacheKey);
    if (cached) return cached;

    const token = await getValidKickToken();
    if (!token) {
        console.info(`[Kick Avatar] ❌ 無 OAuth token，跳過: ${username}`);
        return "";
    }
    const authHeaders = { 'Authorization': `Bearer ${token}` };

    const baseUrl = 'https://api.kick.com/public/v1';

    try {
        const res = await axios.get(`${baseUrl}/users`, {
            params: { slug: username },
            headers: { ...authHeaders, 'Accept': 'application/json' }
        });
        const user = Array.isArray(res.data?.data) ? res.data.data[0] : null;
        const avatar = user?.profile_picture || user?.profile_pic || null;
        if (avatar) {
            console.info(`[Kick Avatar] ✅ 取得頭像(user): ${username}`);
            kickAvatarCache.set(cacheKey, avatar);
            return avatar;
        }
    } catch (e) {}

    try {
        const res = await axios.get(`${baseUrl}/channels`, {
            params: { slug: username },
            headers: { ...authHeaders, 'Accept': 'application/json' }
        });
        const chan = Array.isArray(res.data?.data) ? res.data.data[0] : null;
        const avatar = chan?.user?.profile_pic || null;
        if (avatar) {
            console.info(`[Kick Avatar] ✅ 取得頭像(channel): ${username}`);
            kickAvatarCache.set(cacheKey, avatar);
            return avatar;
        }
    } catch (e) {}

    console.info(`[Kick Avatar] ❌ 無法取得頭像: ${username}`);
    return "";
}

async function startKickChat() {
    const kickChannel = process.env.KICK_USER_NAME || keyword || '';
    if (!kickChannel) {
        console.log('⚠️ 未指定 Kick 頻道名稱，跳過');
        writeLog("Default", "未指定 Kick 頻道名稱", "Kick");
        return;
    }

    console.info(`🎯 正在連接 Kick 頻道: ${kickChannel}`);
    writeLog("Default", `正在連接 Kick 頻道: ${kickChannel}`, "Kick");

    const channelId = await resolveKickChannelId(kickChannel);
    console.info(`🔍 Kick 頻道 chatroom ID: ${channelId || '無法取得'}`);
    writeLog("Default", `Kick 頻道 chatroom ID: ${channelId || '無法取得'}`, "Kick");

    kickWS = new KickWebSocket({ debug: false, autoReconnect: true, ...(channelId > 0 && { channelId }) });
    
    kickWS.on('ready', () => {
        console.info(`✅ Kick WebSocket 已連線: ${kickChannel}`);

        writeLog("Default", `Kick WebSocket 已連線: ${kickChannel}`, "Kick");

        sendBarkNotification("Kick 連線", `已連線 ${kickChannel}`, "");
        sendSocketMessage("系統", `Kick 已連線 ${kickChannel}`, "", "", false, CacheUserNum, CacheUserList);
    });

    function getSenderAvatar(sender) {
        return sender?.profile_picture || sender?.profile_pic || sender?.picture || sender?.avatar || "";
    }

    kickWS.on('ChatMessage', async (data) => {
        const userName = data.sender?.username || '未知';
        const message = data.content || '';
        let avatar = getSenderAvatar(data.sender);
        if (!avatar) avatar = await getKickUserAvatar(userName, data.sender?.id);

        console.info(`[Kick Chat] ${userName} : ${message}`);
        writeLog("Default", `${userName} : ${message}`, "Kick Chat Original");

        const fr = processFilter({ user: userName, message });
        if (fr.blocked) {
            console.info('🚫 過濾器阻擋(Kick):', userName, message, `(規則: ${fr.reason})`);
            writeLog("Default", `過濾器阻擋(Kick): ${userName} : ${message} (規則: ${fr.reason})`, "Filter");
            return;
        }

        let tUser = fr.modified && fr.user ? fr.user : userName;
        let tMsg = fr.modified && fr.message ? fr.message : message;

        if (!tUser || !tMsg) {
            console.info('⚠️ 過濾後(Kick) nick/msg 為空，跳過:', userName, message);
            return;
        }

        recordMessageStat(tMsg);

        console.info(`📢 發送 Bark 通知: ${tUser} - ${tMsg}`);
        sendBarkNotification(tUser, tMsg, avatar);

        // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
        tMsg = replaceEmojis(tMsg);

        Translate.TranslateText(tMsg).then(RES => {
            let RESCHAT = `${tMsg}${tMsg == RES ? "" : `\n${RES}`}`;
            if (RES.toLowerCase() != tMsg.toLowerCase()) {
                console.info(`📢 發送 Bark 通知: ${tUser} - ${RES}`);
                sendBarkNotification(tUser, RES, avatar);
            }
            sendSocketMessage(tUser, RESCHAT, avatar, "", true, CacheUserNum, CacheUserList);
            writeLog("Default", `${tUser} : ${RESCHAT}`, "Kick Chat");
        });
    });

    kickWS.on('Subscription', async (data) => {
        const username = data.username || '未知';
        const message = `订阅了频道`;
        const avatar = await getKickUserAvatar(username);

        console.info(`[Kick Sub] ${username} ${message}`);
        writeLog("Default", `${username} ${message}`, "Kick Sub");

        sendBarkNotification(username, message, avatar);
        sendSocketMessage(username, message, avatar, "", false, CacheUserNum, CacheUserList);
    });

    kickWS.on('GiftedSubscriptions', async (data) => {
        const gifter = data.gifted_by || '未知';
        const recipients = Array.isArray(data.recipients) ? data.recipients.join(', ') : '';
        const message = `赠送了订阅给 ${recipients}`;
        const avatar = await getKickUserAvatar(gifter);

        console.info(`[Kick GiftSub] ${gifter} ${message}`);
        writeLog("Default", `${gifter} ${message}`, "Kick GiftSub");

        sendBarkNotification(gifter, message, avatar);
        sendSocketMessage(gifter, message, avatar, "", false, CacheUserNum, CacheUserList);
    });

    kickWS.on('UserBanned', async (data) => {
        const username = data.username || '未知';
        const message = `已被封禁`;
        const avatar = await getKickUserAvatar(username);

        console.log(`[Kick Ban] ${username} ${message}`);
        writeLog("Default", `${username} ${message}`, "Kick Ban");

        sendSocketMessage(username, message, avatar, "", false, CacheUserNum, CacheUserList);
    });

    kickWS.on('error', (err) => {
        console.error('⚠️ Kick WebSocket 錯誤:', err);
        writeLog("Default", `Kick WebSocket 錯誤: ${err.message || err}`, "Error");
    });

    kickWS.on('disconnect', (data) => {
        console.log('❌ Kick WebSocket 斷線:', data?.reason || '未知原因');
        writeLog("Default", `Kick WebSocket 斷線: ${data?.reason || '未知原因'}`, "Kick");
    });

    kickWS.connect(kickChannel).catch(err => {
        console.error('❌ Kick 連線失敗:', err.message);
        writeLog("Default", `Kick 連線失敗: ${err.message}`, "Error");
        sendBarkNotification("Kick 連線失敗", err.message, "");
    });
}

// ===== Odysee Live Chat 整合 =====

let odyseeWs = null
let odyseeViewerInterval = null

async function resolveOdyseeChannelClaimId(channelName) {
    const cleanName = channelName.startsWith('@') ? channelName : `@${channelName}`
    try {
        const res = await axios.post('https://api.na-backend.odysee.com/api/v1/proxy?m=resolve', {
            jsonrpc: '2.0',
            method: 'resolve',
            params: { urls: [`lbry://${cleanName}`] },
            id: 1
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000
        })
        const result = res.data?.result
        if (!result) throw new Error('resolve 回傳空結果')
        const claim = Object.values(result)[0]
        if (!claim) throw new Error('無法解析頻道')
        return {
            claimId: claim.claim_id,
            channelName: claim.name || cleanName
        }
    } catch (err) {
        console.error('❌ Odysee resolve 失敗:', err.message)
        return null
    }
}

async function checkOdyseeIsLive(claimId) {
    try {
        const res = await axios.post('https://api.odysee.live/livestream/is_live',
            new URLSearchParams({ channel_claim_id: claimId }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 10000
            }
        )
        const data = res.data?.data
        if (!data) return { live: false, viewerCount: 0 }
        return {
            live: data.Live === true,
            viewerCount: data.ViewerCount || 0,
            videoUrl: data.VideoURL || '',
            streamClaimId: data.ActiveClaim?.ClaimID || null,
            isProtected: data.ActiveClaim?.Protected || false
        }
    } catch (err) {
        console.error('❌ Odysee is_live 檢查失敗:', err.message)
        return { live: false, viewerCount: 0 }
    }
}

function connectOdyseeChat(claimId, channelName) {
    const wsUrl = `wss://sockety.odysee.tv/ws/commentron?id=${claimId}&category=${encodeURIComponent(channelName)}&sub_category=viewer`
    console.log(`🔌 Odysee WebSocket 連線: ${wsUrl}`)
    writeLog("Default", `Odysee WebSocket 連線: ${wsUrl}`, "Odysee")

    try {
        odyseeWs = new WebSocket(wsUrl)
    } catch (err) {
        console.error('❌ Odysee WebSocket 建立失敗:', err.message)
        return
    }

    odyseeWs.onopen = () => {
        console.log('✅ Odysee WebSocket 已連線')
        writeLog("Default", "Odysee WebSocket 已連線", "Odysee")
        sendBarkNotification("Odysee 連線", `已連線 ${channelName}`, "")
        sendSocketMessage("系統", `Odysee 已連線 ${channelName}`, "", "", false, CacheUserNum, CacheUserList)
    }

    odyseeWs.onmessage = (event) => {
        console.log('[Odysee RAW]', event.data.substring(0, 500))
        try {
            const msg = JSON.parse(event.data)
            if (msg.type === 'delta' && msg.data?.comment) {
                const comment = msg.data.comment
                const userName = comment.channel_name || comment.author || '未知'
                const message = comment.comment || ''
                const avatar = ''

                console.info(`[Odysee Chat] ${userName} : ${message}`)
                writeLog("Default", `${userName} : ${message}`, "Odysee Chat Original")

                const fr = processFilter({ user: userName, message })
                if (fr.blocked) {
                    console.info('🚫 過濾器阻擋(Odysee):', userName, message, `(規則: ${fr.reason})`)
                    writeLog("Default", `過濾器阻擋(Odysee): ${userName} : ${message} (規則: ${fr.reason})`, "Filter")
                    return
                }

                let tUser = fr.modified && fr.user ? fr.user : userName
                let tMsg = fr.modified && fr.message ? fr.message : message
                if (!tUser || !tMsg) {
                    console.info('⚠️ 過濾後(Odysee) nick/msg 為空，跳過:', userName, message)
                    return
                }

                recordMessageStat(tMsg)

                sendBarkNotification(tUser, tMsg, avatar)

                // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
                tMsg = replaceEmojis(tMsg)

                Translate.TranslateText(tMsg).then(RES => {
                    let RESCHAT = `${tMsg}${tMsg == RES ? "" : `\n${RES}`}`
                    if (RES.toLowerCase() != tMsg.toLowerCase()) {
                        sendBarkNotification(tUser, RES, avatar)
                    }
                    sendSocketMessage(tUser, RESCHAT, avatar, "", true, CacheUserNum, CacheUserList)
                    writeLog("Default", `${tUser} : ${RESCHAT}`, "Odysee Chat")
                })
            } else if (msg.type === 'viewers') {
                OdyseeViewerCount = msg.data?.connected || msg.data?.viewerCount || msg.data?.count || 0
                updateCombinedViewerCount()
            }
        } catch (err) {
            console.error('⚠️ Odysee 訊息解析錯誤:', err.message)
        }
    }

    odyseeWs.onerror = (err) => {
        console.error('⚠️ Odysee WebSocket 錯誤:', err.message || err)
        writeLog("Default", `Odysee WebSocket 錯誤: ${err.message || err}`, "Error")
    }

    odyseeWs.onclose = (event) => {
        console.log(`❌ Odysee WebSocket 斷線: code=${event.code} reason=${event.reason}`)
        writeLog("Default", `Odysee WebSocket 斷線: ${event.reason || '未知原因'}`, "Odysee")
        clearInterval(odyseeViewerInterval)
        odyseeWs = null
    }
}

// ===== YouTube Live Chat 整合 =====

let youtubePollInterval = null
let youtubeLiveChatId = null
let youtubeVideoId = null
let youtubeNextPageToken = null
let youtubeViewerInterval = null
let youtubeAccessToken = null

// Youtube OAuth token 管理
const youtubeTokenFile = path.join(__dirname, 'youtube_tokens.json')
const youtubeCacheFile = path.join(__dirname, 'youtube_cache.json')

function loadYoutubeCache() {
    try {
        if (existsSync(youtubeCacheFile)) return JSON.parse(readFileSync(youtubeCacheFile, 'utf8'))
    } catch (_) {}
    return null
}
function saveYoutubeCache(data) {
    try { writeFileSync(youtubeCacheFile, JSON.stringify(data)) } catch (_) {}
}

function loadYoutubeTokens() {
    try {
        if (existsSync(youtubeTokenFile)) {
            return JSON.parse(readFileSync(youtubeTokenFile, 'utf8'))
        }
    } catch (err) {
        console.error('⚠️ 讀取 youtube_tokens.json 失敗:', err.message)
    }
    return null
}

async function getYoutubeAuthParams() {
    if (youtubeAccessToken) {
        console.log('ℹ️ Youtube 使用 OAuth Bearer token（記憶體）')
        return { headers: { Authorization: `Bearer ${youtubeAccessToken}` }, params: {} }
    }
    // 嘗試從檔案載入 token
    const tokens = loadYoutubeTokens()
    if (tokens?.access_token) {
        const expiresAt = (tokens.obtainmentTimestamp || 0) + (tokens.expires_in || 3600) * 1000
        if (Date.now() < expiresAt - 60000) {
            youtubeAccessToken = tokens.access_token
            console.log('ℹ️ Youtube 使用 OAuth Bearer token（檔案）')
            return { headers: { Authorization: `Bearer ${youtubeAccessToken}` }, params: {} }
        }
        // token 過期，嘗試刷新
        if (tokens.refresh_token) {
            try {
                const params = new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: process.env.YOUTUBE_CLIENT_ID || '',
                    client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
                    refresh_token: tokens.refresh_token,
                })
                const res = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params,
                })
                if (res.ok) {
                    const newTokens = await res.json()
                    newTokens.obtainmentTimestamp = Date.now()
                    writeFileSync(youtubeTokenFile, JSON.stringify(newTokens, null, 2))
                    youtubeAccessToken = newTokens.access_token
                    console.log('ℹ️ Youtube OAuth token 已刷新')
                    return { headers: { Authorization: `Bearer ${youtubeAccessToken}` }, params: {} }
                } else {
                    console.error('⚠️ Youtube token 刷新失敗:', res.status, await res.text().catch(() => ''))
                }
            } catch (e) {
                console.error('⚠️ Youtube token 刷新失敗:', e.message)
            }
        }
    }
    // fallback 到 API key
    if (!youtubeApiKey) {
        console.error('❌ 未設定 YOUTUBE_API_KEY 且無有效 OAuth token')
        return null
    }
    console.log('ℹ️ Youtube 使用 API Key 認證（無 OAuth token）')
    return { headers: {}, params: { key: youtubeApiKey } }
}

async function resolveYoutubeChannelId(input) {
    // 如果輸入已經是 UC 開頭的頻道 ID，直接跳過 API 解析（省 100 單位）
    if (/^UC[\w-]{20,}$/.test(input)) {
        console.log(`ℹ️ 輸入已是頻道 ID，跳過 resolve API 呼叫`)
        return { channelId: input, channelName: input }
    }
    const q = input.startsWith('@') ? input.substring(1) : input
    try {
        const auth = await getYoutubeAuthParams()
        if (!auth) throw new Error('無可用認證')
        const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: { part: 'snippet', q: q, type: 'channel', maxResults: 1, ...auth.params },
            headers: auth.headers,
            timeout: 15000
        })
        const items = res.data?.items
        if (!items || items.length === 0) throw new Error('找不到頻道')
        return {
            channelId: items[0].snippet.channelId,
            channelName: items[0].snippet.channelTitle
        }
    } catch (err) {
        const status = err.response?.status || ''
        const data = err.response?.data?.error?.message || err.message
        console.error(`❌ Youtube resolve 失敗 [${status}]: ${data}`)
        return null
    }
}

async function checkYoutubeIsLive(channelId) {
    try {
        const auth = await getYoutubeAuthParams()
        if (!auth) throw new Error('無可用認證')

        // 先嘗試用快取的 videoId（省 100 單位 search）
        const cache = loadYoutubeCache()
        if (cache?.videoId) {
            console.log(`ℹ️ Youtube 嘗試快取 videoId: ${cache.videoId}`)
            try {
                const videoRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                    params: { part: 'liveStreamingDetails', id: cache.videoId, maxResults: 1, ...auth.params },
                    headers: auth.headers,
                    timeout: 10000
                })
                const video = videoRes.data?.items?.[0]
                const liveDetails = video?.liveStreamingDetails
                if (liveDetails?.activeLiveChatId) {
                    console.log(`✅ Youtube 快取 videoId 仍有效`)
                    saveYoutubeCache({ videoId: cache.videoId, liveChatId: liveDetails.activeLiveChatId, channelId })
                    return {
                        live: true,
                        liveChatId: liveDetails.activeLiveChatId,
                        videoId: cache.videoId,
                        concurrentViewers: parseInt(liveDetails.concurrentViewers) || 0
                    }
                }
            } catch (_) { /* 快取失效，繼續 search */ }
        }

        // 快取失效→用 search.list（100 單位）
        const searchUrl = 'https://www.googleapis.com/youtube/v3/search'
        const res = await axios.get(searchUrl, {
            params: { part: 'snippet', channelId: channelId, eventType: 'live', type: 'video', maxResults: 1, ...auth.params },
            headers: auth.headers,
            timeout: 15000
        })
        const items = res.data?.items
        if (!items || items.length === 0) {
            console.log(`ℹ️ Youtube 搜尋直播影片結果為空，頻道可能未開播`)
            return { live: false, liveChatId: null, videoId: null, concurrentViewers: 0 }
        }

        const videoId = items[0].id.videoId

        const videoRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
            params: { part: 'liveStreamingDetails', id: videoId, maxResults: 1, ...auth.params },
            headers: auth.headers,
            timeout: 15000
        })
        const video = videoRes.data?.items?.[0]
        const liveDetails = video?.liveStreamingDetails
        if (!liveDetails || !liveDetails.activeLiveChatId) throw new Error('無法取得聊天室 ID')

        // 快取此 videoId
        saveYoutubeCache({ videoId, liveChatId: liveDetails.activeLiveChatId, channelId })

        return {
            live: true,
            liveChatId: liveDetails.activeLiveChatId,
            videoId: videoId,
            concurrentViewers: parseInt(liveDetails.concurrentViewers) || 0
        }
    } catch (err) {
        const status = err.response?.status || ''
        const data = err.response?.data?.error?.message || err.message
        console.error(`❌ Youtube is_live 檢查失敗 [${status}]: ${data}`)
        if (status === 403) {
            console.error('   ⚠️ API 金鑰可能未啟用 YouTube Data API v3 或有限制，請檢查 Google Cloud Console')
        }
        return { live: false, liveChatId: null, videoId: null, concurrentViewers: 0 }
    }
}

function connectYoutubeChat(liveChatId, videoId, channelName) {
    youtubeLiveChatId = liveChatId
    youtubeNextPageToken = null

    console.log(`🔌 Youtube 聊天室開始輪詢: liveChatId=${liveChatId}`)
    writeLog("Default", `Youtube 聊天室開始輪詢: ${liveChatId}`, "Youtube")

    sendBarkNotification("Youtube 連線", `已連線 ${channelName}`, "")
    sendSocketMessage("系統", `Youtube 已連線 ${channelName}`, "", "", false, CacheUserNum, CacheUserList)

    youtubeVideoId = videoId  // 儲存 videoId 供 viewer count 更新用

    // 定期更新觀眾數
    youtubeViewerInterval = setInterval(async () => {
        if (!youtubeVideoId) return
        try {
            const auth = await getYoutubeAuthParams()
            if (!auth) return
            const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: { part: 'liveStreamingDetails', id: youtubeVideoId, maxResults: 1, ...auth.params },
                headers: auth.headers,
                timeout: 10000
            })
            const cv = res.data?.items?.[0]?.liveStreamingDetails?.concurrentViewers
            if (cv) {
                YoutubeViewerCount = parseInt(cv) || 0
                updateCombinedViewerCount()
            }
        } catch (_) { /* ignore poll errors */ }
    }, 60000)

    function poll() {
        if (!youtubeLiveChatId) return

        getYoutubeAuthParams().then(auth => {
            if (!auth) { youtubePollInterval = setTimeout(poll, 30000); return }

            const params = {
                part: 'snippet,authorDetails',
                liveChatId: youtubeLiveChatId,
                maxResults: 200,
                ...auth.params
            }
            if (youtubeNextPageToken) params.pageToken = youtubeNextPageToken

            axios.get('https://www.googleapis.com/youtube/v3/liveChat/messages', { params, headers: auth.headers, timeout: 10000 })
            .then(res => {
                const data = res.data
                youtubeNextPageToken = data.nextPageToken || null

                if (data.items) {
                    for (const item of data.items) {
                        const type = item.snippet.type
                        const userName = item.authorDetails?.displayName || '未知'
                        const avatar = item.authorDetails?.profileImageUrl || ''

                        if (type === 'textMessageEvent') {
                            const message = item.snippet.displayMessage || ''

                            console.info(`[Youtube Chat] ${userName} : ${message}`)
                            writeLog("Default", `${userName} : ${message}`, "Youtube Chat Original")

                            const fr = processFilter({ user: userName, message })
                            if (fr.blocked) {
                                console.info('🚫 過濾器阻擋(Youtube):', userName, message, `(規則: ${fr.reason})`)
                                writeLog("Default", `過濾器阻擋(Youtube): ${userName} : ${message} (規則: ${fr.reason})`, "Filter")
                                continue
                            }

                            let tUser = fr.modified && fr.user ? fr.user : userName
                            let tMsg = fr.modified && fr.message ? fr.message : message
                            if (!tUser || !tMsg) {
                                console.info('⚠️ 過濾後(Youtube) nick/msg 為空，跳過:', userName, message)
                                continue
                            }

                            recordMessageStat(tMsg)
                            sendBarkNotification(tUser, tMsg, avatar)

                            // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
                            tMsg = replaceEmojis(tMsg)

                            Translate.TranslateText(tMsg).then(RES => {
                                let RESCHAT = `${tMsg}${tMsg == RES ? "" : `\n${RES}`}`
                                if (RES.toLowerCase() != tMsg.toLowerCase()) {
                                    sendBarkNotification(tUser, RES, avatar)
                                }
                                sendSocketMessage(tUser, RESCHAT, avatar, "", true, CacheUserNum, CacheUserList)
                                writeLog("Default", `${tUser} : ${RESCHAT}`, "Youtube Chat")
                            })

                        } else if (type === 'superChatEvent') {
                            const details = item.snippet.superChatDetails
                            const amount = details?.amountDisplayString || ''
                            const msg = details?.userComment || ''
                            const display = msg ? `${msg} (${amount})` : amount
                            console.info(`💰[Youtube SuperChat] ${userName}: ${display}`)
                            writeLog("Default", `SuperChat ${userName}: ${display}`, "Youtube")
                            sendBarkNotification(`💰 ${userName}`, display, avatar)
                            sendSocketMessage(userName, `💰 超級感謝 ${display}`, avatar, "", true, CacheUserNum, CacheUserList)

                        } else if (type === 'superStickerEvent') {
                            const details = item.snippet.superStickerDetails
                            const amount = details?.amountDisplayString || ''
                            const sticker = details?.superStickerMetadata?.sticker?.localizedDescription || '貼圖'
                            console.info(`🖼️[Youtube SuperSticker] ${userName}: ${sticker} (${amount})`)
                            writeLog("Default", `SuperSticker ${userName}: ${sticker} (${amount})`, "Youtube")
                            sendBarkNotification(`🖼️ ${userName}`, `${sticker} (${amount})`, avatar)
                            sendSocketMessage(userName, `🖼️ 超級貼圖 ${sticker} (${amount})`, avatar, "", true, CacheUserNum, CacheUserList)

                        } else if (type === 'newSponsorEvent') {
                            console.info(`🎉[Youtube 新會員] ${userName}`)
                            writeLog("Default", `新會員 ${userName}`, "Youtube")
                            sendBarkNotification("🎉 新會員", userName, avatar)
                            sendSocketMessage(userName, "🎉 成為新會員", avatar, "", true, CacheUserNum, CacheUserList)

                        } else if (type === 'giftMembershipReceivedEvent') {
                            const details = item.snippet.giftMembershipReceivedDetails
                            const gifter = details?.gifterChannelId || '未知'
                            console.info(`🎁[Youtube 收到贈禮] ${userName} 來自 ${gifter}`)
                            writeLog("Default", `收到贈禮會員 ${userName} 來自 ${gifter}`, "Youtube")
                            sendBarkNotification("🎁 收到贈禮會員", `${userName} 來自 ${gifter}`, avatar)
                            sendSocketMessage(userName, `🎁 收到贈送的會員`, avatar, "", true, CacheUserNum, CacheUserList)

                        } else if (type === 'memberMilestoneChatEvent') {
                            const details = item.snippet.memberMilestoneChatDetails
                            const tier = details?.memberTierName || '會員'
                            const months = details?.memberMonth || ''
                            const msg = details?.userComment || ''
                            const display = `${tier}${months ? ` ${months}個月` : ''}${msg ? `: ${msg}` : ''}`
                            console.info(`⭐[Youtube 會員里程碑] ${userName}: ${display}`)
                            writeLog("Default", `會員里程碑 ${userName}: ${display}`, "Youtube")
                            sendBarkNotification(`⭐ ${userName}`, display, avatar)
                            sendSocketMessage(userName, `⭐ 會員里程碑 ${display}`, avatar, "", true, CacheUserNum, CacheUserList)
                        }
                    }
                }

                const apiInterval = data.pollingIntervalMillis || 5000
                const userInterval = youtubePollIntervalS * 1000
                const intervalMs = Math.max(apiInterval, userInterval)
                youtubePollInterval = setTimeout(poll, intervalMs)
            })
            .catch(err => {
                console.error('⚠️ Youtube 輪詢錯誤:', err.message)
                youtubePollInterval = setTimeout(poll, 10000)
            })
    })

    poll()
}
}

function disconnectYoutubeChat() {
    clearTimeout(youtubePollInterval)
    clearInterval(youtubeViewerInterval)
    youtubePollInterval = null
    youtubeViewerInterval = null
    youtubeLiveChatId = null
    youtubeVideoId = null
    youtubeNextPageToken = null
    console.log('❌ Youtube 聊天室已斷線')
    writeLog("Default", "Youtube 聊天室已斷線", "Youtube")
}

if (isOdysee) {
    ;(async () => {
        if (!odyseeChannelName) {
            console.log('⚠️ 未指定 Odysee 頻道名稱，跳過')
            writeLog("Default", "未指定 Odysee 頻道名稱", "Odysee")
            return
        }
        console.log(`🎯 正在解析 Odysee 頻道: ${odyseeChannelName}`)
        writeLog("Default", `正在解析 Odysee 頻道: ${odyseeChannelName}`, "Odysee")

        const info = await resolveOdyseeChannelClaimId(odyseeChannelName)
        if (!info) {
            console.log('❌ 無法解析 Odysee 頻道，跳過')
            sendSocketMessage("系統", "Odysee 頻道解析失敗", "", "", false, CacheUserNum, CacheUserList)
            return
        }
        console.log(`🔍 Odysee 頻道 claim ID: ${info.claimId}`)

        const liveInfo = await checkOdyseeIsLive(info.claimId)
        if (!liveInfo.live) {
            console.log('📴 Odysee 頻道未開播，結束程序')
            writeLog("Default", "Odysee 頻道未開播", "Odysee")
            sendBarkNotification("Odysee 未開播", `${odyseeChannelName} 目前沒有直播`, "")
            sendSocketMessage("系統", `Odysee ${odyseeChannelName} 未開播`, "", "", false, CacheUserNum, CacheUserList)
            return
        }

        OdyseeViewerCount = liveInfo.viewerCount
        updateCombinedViewerCount()
        console.log(`📺 Odysee 直播中，觀眾數: ${liveInfo.viewerCount}`)

        const streamId = liveInfo.streamClaimId
            ? (liveInfo.isProtected
                ? liveInfo.streamClaimId.split('').reverse().join('')
                : liveInfo.streamClaimId)
            : null
        if (!streamId) {
            console.log('❌ 無法取得直播串流 claim ID，跳過')
            return
        }
        connectOdyseeChat(streamId, info.channelName)
    })()
}

if (isYoutube) {
    ;(async () => {
        if (!youtubeApiKey) {
            console.log('⚠️ 未設定 YOUTUBE_API_KEY，跳過')
            writeLog("Default", "未設定 YOUTUBE_API_KEY", "Youtube")
            return
        }
        if (!youtubeChannelName) {
            console.log('⚠️ 未指定 Youtube 頻道名稱，跳過')
            writeLog("Default", "未指定 Youtube 頻道名稱", "Youtube")
            return
        }
        console.log(`🎯 正在解析 Youtube 頻道: ${youtubeChannelName}`)
        writeLog("Default", `正在解析 Youtube 頻道: ${youtubeChannelName}`, "Youtube")

        const info = await resolveYoutubeChannelId(youtubeChannelName)
        if (!info) {
            console.log('❌ 無法解析 Youtube 頻道，跳過')
            sendSocketMessage("系統", "Youtube 頻道解析失敗", "", "", false, CacheUserNum, CacheUserList)
            return
        }
        console.log(`🔍 Youtube 頻道 ID: ${info.channelId}`)

        const liveInfo = await checkYoutubeIsLive(info.channelId)
        if (!liveInfo.live) {
            console.log('📴 Youtube 頻道未開播，結束程序')
            writeLog("Default", "Youtube 頻道未開播", "Youtube")
            sendBarkNotification("Youtube 未開播", `${info.channelName} 目前沒有直播`, "")
            sendSocketMessage("系統", `Youtube ${info.channelName} 未開播`, "", "", false, CacheUserNum, CacheUserList)
            return
        }

        YoutubeViewerCount = liveInfo.concurrentViewers
        updateCombinedViewerCount()
        console.log(`📺 Youtube 直播中，觀眾數: ${liveInfo.concurrentViewers}`)

        connectYoutubeChat(liveInfo.liveChatId, liveInfo.videoId, info.channelName)
    })()
}

if (isKick) {
    startKickChat();
}
