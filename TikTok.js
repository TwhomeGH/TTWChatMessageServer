import { ApiClient } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { promises as fs } from 'fs';
import axios from 'axios';


import { config } from 'dotenv';

import net from 'net';

import { SignConfig } from "tiktok-live-connector";


import path from 'path';

import { fileURLToPath } from 'url';

// 在 ESM 裡手動定義 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


import { TikTokLiveConnection, WebcastEvent,ControlEvent,ControlAction } from 'tiktok-live-connector';
import { type } from 'os';
import Translate from "./TranslateTest.js"
import { recordMessageStat, getTopMessages, getAllMessageStatsSorted, processFilter } from "./MessageFilter.js"
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

let sign_api= process.env.SIGN_API
SignConfig.apiKey = sign_api


// node 內建：process.argv
// argv[0] = node 路徑 / user?
// argv[1] = TikTok.js 路徑
// argv[2] 開始才是你傳的參數

const args = process.argv.slice(2)

// 你要的後綴參數
const keyword = args[0] || ''


let isTK = args.includes('--tiktok')
let isTwitch = args.includes('--twitch')
let isKick = args.includes('--kick')


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
} else if (isBoth) {
    // 向後相容：--both → tiktok + twitch
    isTK = true
    isTwitch = true
}

console.log('收到參數:', keyword, isTK ? '(TikTok)' : '', isTwitch ? '(Twitch)' : '', isKick ? '(Kick)' : '');

console.log('isBark=', isBark, 'isSocket=', isSocket, 'isTwitch=', isTwitch, 'isKick=', isKick);
console.log('isBoth=', isBoth, 'platforms=', platformsArg ? platformsArg.split('=')[1] : '');

// TikTok 用戶名稱

const tiktokName = keyword.length > 0 ? keyword : process.env.TIKTOK_NAME || "coffeelatte0709";


// --- 4. Socket 客戶端 ---

let client = null;
let reconnectTimer = null;

let heartbeatTimer = null;


const PORT = process.env.SOCKET_API?.split(':')[2] || 9322; // 你的 socket server 端口
const HOST = process.env.SOCKET_API?.split(':')[1]?.replace('//', '') || 'localhost'; // 你的 socket server 地址

const Bark = process.env.BARK_API;

const TRANSLATE_API_URL = process.env.TRANSLATE_API_URL || "https://api.mymemory.translated.net/get";
const TRANSLATE_SOURCE_LANG = process.env.TRANSLATE_SOURCE_LANG || "en";
const TRANSLATE_TARGET_LANG = process.env.TRANSLATE_TARGET_LANG || "zh-TW";


const GIFT_TRANSLATE_PREFILL_LIMIT = Number(process.env.GIFT_TRANSLATE_PREFILL_LIMIT || 10);


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

                    clearTimeout(heartbeatTimer);
                    heartbeatTimer = null;

                    resolve();
                });
            });
        });
    }

    await saveSentMessages();

    await saveStatsToFile();
    
    console.log("✅ 優雅退出完成");

    process.exit(0);
}


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

            if (json.type === 'StreamMessage') {
                const fr = processFilter({ user: json.user, message: json.message });
                if (fr.blocked) {
                    console.log('🚫 過濾器阻擋(來自Server):', json.user, json.message);
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

                sendToTCP(json);
                console.log('📥 收到 JSON 訊息:', json);
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



const connection = new TikTokLiveConnection(tiktokName,{
    sessionId: process.env.SESSION_ID,
    ttTargetIdc: process.env.TT_TARGET_IDC || "alisg"

})





async function sendBarkNotification(title = "Twitch", comment, icon) {

    if (!isBark) { return }
    if (!Bark || Bark.toLowerCase() === "none") return;
    try {

        console.info(`📢 發送 Bark 通知: ${title} - ${comment}`);
        await axios.post(Bark, { title, body: comment, icon }, { headers: { "Content-Type": "application/json; charset=utf-8" } });
        
        console.info("✅ Bark 推送成功");
    } catch (err) {
        console.error("❌ Bark 推送錯誤:", err.message);
    }
}




function sendToTCP(payload) {
    if (!client || client.destroyed) return;


    if (isDuplicate(payload.user.trim(), payload.message.trim())) {
        console.log('🚫 重複訊息跳過:', payload.user, payload.message);
        return;
    }

    console.log('📤 發送 TCP 訊息:紀錄',payload.user,payload.message);
    console.log('📤 發送 TCP 訊息Sync:', payload);

    try {
        var payload_bak = payload

        var CHAT_RES = payload.message

        Translate.TranslateText(payload.message).then(RES=>{
            
            if (payload.message != RES) {
                CHAT_RES += `\n${RES}`
            }

            payload_bak["message"] = CHAT_RES

            client.write(JSON.stringify(payload_bak) + '\n');
        })


        


        

        addToSyncBuffer(payload.user.trim(), payload.message.trim());

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

function updateCombinedViewerCount() {
    let combined
    if (isTK && isTwitch) {
        combined = (TikTokViewerCount || 0) + (TwitchViewerCount || 0)
    } else if (isTK) {
        combined = TikTokViewerCount || 0
    } else if (isTwitch) {
        combined = TwitchViewerCount || 0
    } else {
        combined = 0
    }
    CacheUserNum = combined
    sendSocketMessage("", "", "", "", false, CacheUserNum, CacheUserList)
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
function sendSocketMessage(user, message, img, giftImg,isMain=true,userNum=0,userList=[]) {
    if (!client || client.destroyed) return;

    
    if (isDuplicate(user.trim(), message.trim())) {
        console.log('🚫內部 重複訊息跳過:', user, message);
        return;
    }

    
    const payload = {
        type: 'StreamMessage',
        user:String(user),
        message:String(message),
        img,
        giftImg,
        isMain:Boolean(isMain),
        userNum,
        userList
    };
    
    try {
        console.log('📤[TK] 發送 Socket 訊息:', payload);
        client.write(JSON.stringify(payload) + '\n'); // '\n' 可以讓 server 分行處理
    } catch (err) {

        console.error('⚠️ 發送 Socket 訊息失敗:', err.message);
    }
}

var SocketRetryCount = 0
let SocketRetryMaxCount = process.env.SOCKET_RETRY_MAX_COUNT || 3



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
        sendSocketMessage("系統", "TTW Chat Message Server 已連線", "", "", false,CacheUserNum,CacheUserList);
    
        // 啟動心跳
        heartbeatTimer = setInterval(() => {
            if (client && !client.destroyed) {
                client.write(JSON.stringify({ type: 'heartbeat' }) + '\n');
            }
        }, 50000); // 每 50 秒送一次心跳

    });


    client.on('data', (data) => {
        console.log('收到服務器訊息:', data.toString());
    });

    client.on('close', () => {
        console.log('⚠️ TCP Socket closed, reconnecting in 15s...');

        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;

        if (isEnd){
            console.log("程式已結束，停止重連");
            return; 
        }// 如果是程式結束就不重連

        SocketRetryCount += 1 

        if (SocketRetryCount < SocketRetryMaxCount ) {
            
            console.log(`當前 ${SocketRetryCount} 最多重試上限 -> ${SocketRetryMaxCount}`)
            reconnectTimer = setTimeout(connectSocket, 15000);

        } else {

            console.log("已達最大重試次數 取消重連")
            sendBarkNotification("Socket重試已停止","請重新透過/open啟動")

        }
        
    });

    client.on('error', (err) => {
        console.error('⚠️ TCP Socket error:', err.message);
        client?.destroy();

        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
    });
}


var RoomID = ""
var writeViewCount = 0
var writeDebugView = false

function viewCache() {
    console.log("📊 CacheUserNum:", CacheUserNum)
    console.log("📋 CacheUserList:", CacheUserList);
    
    try {
        connection.fetchRoomInfo(RoomID).then(async (roomInfo) => {

            let Viewer = roomInfo.data.user_count
            
            if (writeViewCount > 100 && writeDebugView) {
            writeLog("Default",`DEBUG View:\n${JSON.stringify(roomInfo)}`, "View統計")
                console.log("🔄 更新觀眾數量 寫入Debug_RoomInfo數據:", Viewer)    
                writeViewCount=0
            
            }

            writeViewCount+=1

            TikTokViewerCount = Viewer
            updateCombinedViewerCount();

        })


    } catch (err) {
        console.log("RoomError",err)

    }
    
    
}




if (isTK) {
    console.log("連接 TikTok 直播間:", tiktokName)
    // Connect to the chat (await can be used as well)
    connection.connect().then(state => {
        console.info(`Connected to roomId ${state.roomId}`);

        RoomID = state.roomId

        let DisplayTitle = connection.state.roomInfo.data.title || "未知直播間";
        TikTokViewerCount = connection.state.roomInfo.data.user_count || 0;
        CacheUserNum = (isTK && isTwitch) ? TikTokViewerCount + TwitchViewerCount : TikTokViewerCount;
        
        sendBarkNotification("TikTok 直播間連線成功", `已連接到 ${tiktokName} 的直播間 ${DisplayTitle}`, "");
        sendSocketMessage("系統", `TikTok 直播間連線成功，已連接到 ${tiktokName} 的直播間 ${DisplayTitle}`, "", "", false,CacheUserNum,CacheUserList);
        
    }).catch(err => {

        let DisplayTitle = "None"

        console.error('Failed to connect', err);
        sendBarkNotification("TikTok 直播間連線失敗", `無法連接到 ${tiktokName} 的直播間 ${DisplayTitle}`, "");
        sendSocketMessage("系統", `TikTok 直播間連線失敗，無法連接到 ${tiktokName} 的直播間 ${DisplayTitle}`, "", "", false,CacheUserNum,CacheUserList);
    });

    setInterval(viewCache, 10000); // 每10秒更新一次用戶數量   


}


connection.on(ControlEvent.DISCONNECTED, (e) => {
    console.log('Disconnected :( \(error code: ' + e.errorCode + ', reason: ' + e.reason + ')');
    
    sendBarkNotification("TikTok 直播間已斷線", `已從 ${tiktokName} 的直播間斷線`, "");
    sendSocketMessage("系統", `TikTok 直播間已斷線，已從 ${tiktokName} 的直播間斷線`, "", "", false,CacheUserNum,CacheUserList);


    setTimeout(() => {
        console.log("需要重新連線 TikTok 直播間...");
        sendSocketMessage("系統", "需要重新連線 TikTok 直播間...", "", "", false,CacheUserNum,CacheUserList);

        clearInterval(viewCache);
        //try {
        
        // connection.fetchIsLive().then(isLive => {
        //     if (isLive) {
        //         console.log("直播間仍在線上，嘗試重新連線...");
        //         connection.connect();
        //     } else {
        //         console.log("直播間已下線，暫不重新連線");
        //     }
        // }).catch(err => {
        //     console.error("檢查直播狀態失敗:", err);
        //     });
            
        // } catch (err) {
        
        //     if (err instanceof errors_1.UserOfflineError) {
        //         console.log('[INFO] 使用者不在線上');
        //         return;
        //     }

        //     console.error('重新連線失敗:', err);
            
        // }


    }, 15000);


});



connection.on(WebcastEvent.CAPTION_MESSAGE, (data) => {
    var MES_CAPTION = [""]

    if (data.content.length) {
        const lines = data.content.map(c => `[${c.lang}] ${c.content}`).join(' ');

        MES_CAPTION.push`Caption (${data.timestampMs}): ${lines}`

        writeLog("Default", MES_CAPTION.join("\n"), "Caption")

    }
});

// 取得人數和頭號觀眾列表的事件

connection.on(WebcastEvent.ROOM_USER, data => {
    console.log(`Viewer Count: ${data.viewerCount}`);
    const topGifter = data.ranksList[0];
    if (topGifter?.user) {
        const uniqueId = topGifter.user.uniqueId;
        const nickname = topGifter.user.nickname;
        if (uniqueId) {
            console.log(`Top gifter uniqueId: ${uniqueId} (${topGifter.coinCount})`);
        }
        if (nickname) {
            console.log(`Top gifter nickname: ${nickname} (${topGifter.coinCount})`);
        }
    }

    CacheUserList = data.ranksList.map(item => item.user.nickname);
    CacheUserNum = data.viewerCount;

});

// Define the events that you want to handle
// In this case we listen to chat messages (comments)


connection.on(WebcastEvent.MEMBER,data => {

    let iconn = data.user.profilePicture.url[1]
    //console.log(JSON.stringify(data,"",4))
    
    console.log(data.user.nickname,"加入了") 
    console.log("STATE View",connection.state.roomInfo.data.user_count,CacheUserNum) 

    
    sendBarkNotification(data.user.nickname, "來了",iconn);
    sendSocketMessage(data.user.nickname, "來了",iconn,"",false,CacheUserNum,CacheUserList);

    // 同時記錄訊息統計 加入訊息存儲用與TikTok的結果一致 以便去重
    addToSyncBuffer(data.user.nickname.trim(), "加入了");




})

connection.on(WebcastEvent.FOLLOW,data =>{
    let iconn = data.user.profilePicture.url[1]
    console.log(data.user.nickname,"關注了主播")

    sendBarkNotification(data.user.nickname, "關注了主播",iconn);
    sendSocketMessage(data.user.nickname, "關注了主播",iconn,"",false,CacheUserNum,CacheUserList);

})


connection.on(WebcastEvent.CHAT, data => {

    const uniqueKey = `chat_${data.user.nickname}_${data.comment}`;
    if (alreadySent(uniqueKey)) return;

    // 跨路徑去重：檢查是否已被 userscript 路徑送出（檢查 syncBuffer）
    const isCrossPathDuplicate = isDuplicate(data.user.nickname.trim(), data.comment.trim());

    if (isCrossPathDuplicate) {
        console.log('🚫 跨路徑重複(來自userscript):', data.user.nickname, data.comment);
        writeLog("Default", `跨路徑重複訊息被過濾(來自userscript): ${data.user.nickname} : ${data.comment}`, "CrossPathDuplicate")
        return;
    }

    const fr = processFilter({ user: data.user.nickname, message: data.comment });
    if (fr.blocked) {
        console.log('🚫 過濾器阻擋:', data.user.nickname, data.comment);
        writeLog("Default", `過濾器阻擋訊息: ${data.user.nickname} : ${data.comment}`, "FilterBlocked")
        return;
    }

    let nickname = fr.modified && fr.user ? fr.user : data.user.nickname;
    let comment = fr.modified && fr.message ? fr.message : data.comment;
    let iconn = data.user.profilePicture.url[1]

    console.log(`Chat:${nickname} : ${comment}`)

    writeLog("Default", `原始訊息: ${data.user.nickname} : ${data.comment}\n過濾後訊息: ${nickname} : ${comment}`, "Chat原過濾對比")

    if (!nickname || !comment) {
        console.log('⚠️ 過濾後 nick/comment 為空，跳過:', data.user.nickname, data.comment);
        writeLog("Default", `過濾後 nick/comment 為空，跳過: ${data.user.nickname} : ${data.comment}`, "FilterEmpty")
        return;
    }

    recordMessageStat(comment);

    sendBarkNotification(nickname, comment,iconn);

    Translate.TranslateText(comment).then(RES=>{
            var RESCHAT=`${comment}`
            if (comment != RES) {
                RESCHAT += `\n${RES}`
            }

            writeLog("Default", `${nickname} : ${RESCHAT}`, "Chat")

            if (RES.toLowerCase() != comment.toLowerCase() ) {
                sendBarkNotification(nickname, RES,iconn);
            }

            sendSocketMessage(nickname, RESCHAT,iconn,"",true,CacheUserNum,CacheUserList);

            addToSyncBuffer(nickname.trim(), comment.trim());
        
    })

    

});


// 分享類型

connection.on(WebcastEvent.SOCIAL, data => {

    var LOG_SOCIAL = []
    
    if (data.action) {
        LOG_SOCIAL.push(`Social action: ${data.action}`);
    }
    const uniqueId = data.user?.uniqueId;
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
    const uniqueId = data.user?.uniqueId;
    const nickname = data.user?.nickname;

    var LOG_R = [ ]

    if (uniqueId) {
        LOG_R.push(`User uniqueId: ${uniqueId}`);
    }
    if (nickname) {
        LOG_R.push(`User nickname: ${nickname}`);
    }

    
    const emoteId = data.emoteList[0]?.emoteId;
    
    if (emoteId) {
        LOG_R.push(`Emote id: ${emoteId}`);
        LOG_R.push(emoteList)
        LOG_R.push("原始數據:")
        LOG_R.push(data)

        writeLog("Default",LOG_R.join("\n"), "Emote表情")
    }
    
});


connection.on(WebcastEvent.ROOM_MESSAGE, data => {

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
        if (now - userData.lastLikeTimestamp > UserLikeClearTimer * 1000) {
            // 超過 60 秒，清空計數
            writeLog("Default", `用戶 ${user} 的點讚數已超過 ${UserLikeClearTimer} 秒未更新，重置計數`, "Like清空")
            userData.count = 0;
        }
    }

    // 累加點讚數並更新時間
    userData.count += likeCount;
    userData.lastLikeTimestamp = now;

    UserLikeCount.set(user, userData);

    let secondsToClear = Math.ceil((UserLikeClearTimer * 1000 - (now - userData.lastLikeTimestamp)) / 1000);

    writeLog("Default", `用戶 ${user} 的點讚數更新為 ${userData.count} 將於${secondsToClear}秒 後清空`, "Like累加")

    return userData.count;
}




connection.on(WebcastEvent.LIKE, data => {

    let iconn = data.user.profilePicture.url[1]

    // 本場總累加點讚數 data.totalLikeCount 單次點擊次數 data.likeCount 聊天室訊息顯示 應用總點讚為準
    let totalLikeCount = data.totalLikeCount || 0
    let likeCount = data.likeCount || 0

    let mess = `喜歡你 ${data.likeCount} 次`
    // data.likeCount 單次點擊次數 聊天室訊息顯示 應用總點讚為準


    console.log(`${data.user.nickname} ${mess}`)
    //let giftImg =  "https://img.icons8.com/?size=100&id=xruQNezCArqC&format=png&color=000000"
    

    sendBarkNotification(data.user.nickname, mess,iconn);
    sendSocketMessage(data.user.nickname, mess,iconn,"",false,CacheUserNum,CacheUserList);

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



// And here we receive gifts sent to the streamer
connection.on(WebcastEvent.GIFT, async data => {
    await giftMapReady;
    const originalGiftName = data.giftDetails?.giftName || "";
    const translatedGiftName = await ensureGiftNameTranslation(originalGiftName);
    const giftNameForDisplay = translatedGiftName || originalGiftName;
        
    //console.log(JSON.stringify(data,"",4))
    if (data.giftType === 1 && !data.repeatEnd ){

        // 連擊開始 => show only temporary
        console.log('Gift 連擊開始 in progress');

        console.log(`連擊了 ${data.user.nickname} : ${giftNameForDisplay} x${data.repeatCount}`)
    
        let mess = `連擊了 ${giftNameForDisplay} ${data.repeatCount} 個`
        let iconn = data.user.profilePicture.url[1]
        let giftImg = data.giftDetails.icon.url[1]

        console.log("giftimg",giftImg,"連擊訊息",mess)
        // 連擊過程中只顯示連擊訊息 不顯示單次贈送訊息
        // sendBarkNotification(data.user.nickname, mess,giftImg);
        // sendSocketMessage(data.user.nickname, mess,iconn,giftImg,true,CacheUserNum,CacheUserList);

    
    } else {
        // 連續贈送活動結束或贈送活動無法連續贈送 => 使用最終的
        console.log('Gift 連續贈送活動結束 or non-streakable gift');

        let MESS=`${data.user.nickname} 謝謝支持`
        let MESS_MAIN="感謝大哥的餽贈"
        let iconn = "https://img.icons8.com/fluency/48/gift-card.png"
        let giftImg = data.giftDetails.icon.url[1]

        let count = recordGift(data.user.uniqueId);

        if (count >= 5) {
            console.log("5次連擊感謝",data.user.nickname,MESS)
            sendBarkNotification(data.user.nickname, MESS,giftImg);
            sendSocketMessage(MESS_MAIN,MESS,iconn,giftImg,true,CacheUserNum,CacheUserList);

            // 清空計數
            UserGiftCount.set(data.user.id, { count: 0, lastGiftTimestamp: Date.now() });
            
        }

    }
    
    
    console.log(`送出了 ${data.user.nickname} : ${giftNameForDisplay} ${data.repeatCount} 個`)

    let mess = `送出了 ${giftNameForDisplay} ${data.repeatCount} 個`
    let iconn = data.user.profilePicture.url[1]
    let giftImg = data.giftDetails.icon.url[1]

    console.log("giftimg",giftImg,"訊息",mess)

    sendBarkNotification(data.user.nickname, mess,giftImg);

    sendSocketMessage(data.user.nickname, mess,iconn,giftImg,true,CacheUserNum,CacheUserList);

    writeLog("Default", `${data.user.nickname} 送出了 ${giftNameForDisplay} ${data.repeatCount} 個`, "Gift")

    
});


connection.on(WebcastEvent.SHARE, data =>{
    let mess = "分享直播間"
    let iconn = data.user.profilePicture.url[1]
    console.log(`${data.user.nickname} ${mess}`)
    
    sendBarkNotification(data.user.nickname, mess,iconn);
    sendSocketMessage(data.user.nickname, mess,iconn,"",false,CacheUserNum,CacheUserList);

    writeLog("Default", `${data.user.nickname} 分享了直播間！`, "Share")

})


connection.on(WebcastEvent.ENVELOPE, data => {
    const envelope = data.envelopeInfo;
    if (envelope) {
        if (envelope.envelopeId) {
            console.log(`Envelope ${envelope.envelopeId}`);
        }
        if (envelope.sendUserName) {
            console.log(`From: ${envelope.sendUserName}`);
        }
        console.log(`Diamonds: ${envelope.diamondCount}, People: ${envelope.peopleCount}`);


        let mess = `送出了寶箱，包含 ${envelope.diamondCount} 鑽石`
        sendBarkNotification(data.nickname, mess , data.user.profilePicture.url[1]);
        sendSocketMessage(data.nickname, mess, data.user.profilePicture.url[1], "", true, CacheUserNum, CacheUserList);

        writeLog("Default", `${data.nickname} 送出了寶箱，包含 ${envelope.diamondCount} 鑽石`, "Envelope")

    }
});

connection.on(WebcastEvent.SUPER_FAN, (data) => {
    console.log('A user became a superfan!');
    let mess = "鐵粉出現啦！"
    let iconn = data.user.profilePicture.url[1]
    console.log(`${data.user.nickname} ${mess}`)
    
    sendBarkNotification(data.user.nickname, mess,iconn);
    sendSocketMessage(data.user.nickname, mess,iconn,"",true,CacheUserNum,CacheUserList);

    writeLog("Default", `${data.user.nickname} 成為了鐵粉！`, "SuperFan")

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


// Gift

if (isTK) {
connection.fetchAvailableGifts().then(async (giftList) => {
    await giftMapReady;
    console.log(tiktokName,"Tiktok giftList.length:", giftList.length);
    await syncGiftMapFromGiftList(giftList);
    await backfillGiftTranslationsFromGiftList(giftList);

    await saveGiftCatalog(giftList);
    // giftList.forEach(gift => {
    //     console.log(`id: ${gift.id}, name: ${gift.name}, cost: ${gift.diamond_count}`)
    // });
    
}).catch(err => {
    console.error(err);
})


writeLog("Default", "開始取得 TikTok禮物列表", "System")

} else {
    console.log("跳過 TikTok禮物列表取得")

    writeLog("Default", "跳過 TikTok禮物列表取得", "System")
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
        "user:read:chat"
    ],
    expiresIn: 0,
    obtainmentTimestamp: Date.now()
};
// 檢查 tokens.json 是否存在且有效，否則建立空範本

async function loadTokens() {
    try {
        // 嘗試讀檔
        const data = await fs.readFile(tokenPath, 'utf-8');
        return JSON.parse(data);
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

const tokenData = await loadTokens();

const authProvider = new RefreshingAuthProvider({ clientId, clientSecret });
authProvider.onRefresh(async (userId, newTokenData) => {
    await fs.writeFile(`./tokens.json`, JSON.stringify(newTokenData, null, 4), 'utf-8');
});
await authProvider.addUserForToken(tokenData);

const apiClient = new ApiClient({ authProvider });

let TwitchUserName = process.env.TWITCH_USER_NAME || "coffeelatte0709"
const user = await apiClient.users.getUserByName(TwitchUserName);
const tuser = user.id;

console.log("[Twitch] UserID", tuser);
writeLog("Default", `取得 Twitch UserID: ${tuser}`, "System")


// --- 2. EventSub WebSocket ---
const listener = new EventSubWsListener({ apiClient, port: 0 });

if (isTwitch) {
    console.log("啟用 Twitch 事件監聽");

    writeLog("Default", "啟用 Twitch 事件監聽", "System")

    listener.start();
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
            console.log(`📊 Twitch 觀眾數: ${TwitchViewerCount}`);
            writeLog("Default", `Twitch 觀眾數: ${TwitchViewerCount}`, "Twitch View");
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


    if (event.messageText.startsWith("G#clip")) {

        let res = event.messageText.split(" ")
        res.shift() // 去掉 R#clip

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
        console.log('🚫 過濾器阻擋(Twitch):', event.chatterDisplayName, event.messageText);
        writeLog("Default", `過濾器阻擋(Twitch): ${event.chatterDisplayName} : ${event.messageText}`, "Filter")

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

    Translate.TranslateText(tMsg).then(RES=>{

            let RESCHAT=`${tMsg}${tMsg == RES ? "" :`\n${RES}`}`

            if (RES.toLowerCase() != tMsg.toLowerCase() ) {
                sendBarkNotification(tUser, RES, icon);
            }

            sendSocketMessage(tUser, RESCHAT,icon,"",true,CacheUserNum,CacheUserList);

            writeLog("Default", `${tUser} : ${RESCHAT}`, "Twitch Chat")
    })

    
});

// 其他事件同理可加 sendSocketMessage

// ===== Kick WebSocket 整合 =====

let kickWS = null;

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

async function startKickChat() {
    const kickChannel = process.env.KICK_USER_NAME || keyword || '';
    if (!kickChannel) {
        console.log('⚠️ 未指定 Kick 頻道名稱，跳過');
        writeLog("Default", "未指定 Kick 頻道名稱", "Kick");
        return;
    }

    console.info(`🎯 正在連接 Kick 頻道: ${kickChannel.substring(0,kickChannel.length-5) +"0".repeat(5)}`);
    writeLog("Default", `正在連接 Kick 頻道: ${kickChannel}`, "Kick");

    const channelId = await resolveKickChannelId(kickChannel);
    console.info(`🔍 Kick 頻道 chatroom ID: ${channelId || '無法取得'}`);

    kickWS = new KickWebSocket({ debug: false, autoReconnect: true, ...(channelId > 0 && { channelId }) });
    
    kickWS.on('ready', () => {
        console.info(`✅ Kick WebSocket 已連線: ${kickChannel.substring(0,kickChannel.length-5) +"0".repeat(5)}`);

        writeLog("Default", `Kick WebSocket 已連線: ${kickChannel}`, "Kick");

        sendBarkNotification("Kick 連線", `已連線 ${kickChannel.substring(0,kickChannel.length-5) +"0".repeat(5)}`, "");
        sendSocketMessage("系統", `Kick 已連線 ${kickChannel.substring(0,kickChannel.length-5) +"0".repeat(5)}`, "", "", false, CacheUserNum, CacheUserList);
    });

    kickWS.on('ChatMessage', async (data) => {
        const userName = data.sender?.username || '未知';
        const message = data.content || '';

        console.info(`[Kick Chat] ${userName} : ${message}`);
        writeLog("Default", `${userName} : ${message}`, "Kick Chat Original");

        const fr = processFilter({ user: userName, message });
        if (fr.blocked) {
            console.info('🚫 過濾器阻擋(Kick):', userName, message);
            writeLog("Default", `過濾器阻擋(Kick): ${userName} : ${message}`, "Filter");
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
        sendBarkNotification(tUser, tMsg, "");

        Translate.TranslateText(tMsg).then(RES => {
            let RESCHAT = `${tMsg}${tMsg == RES ? "" : `\n${RES}`}`;
            if (RES.toLowerCase() != tMsg.toLowerCase()) {
                console.info(`📢 發送 Bark 通知: ${tUser} - ${RES}`);
                sendBarkNotification(tUser, RES, "");
            }
            sendSocketMessage(tUser, RESCHAT, "", "", true, CacheUserNum, CacheUserList);
            writeLog("Default", `${tUser} : ${RESCHAT}`, "Kick Chat");
        });
    });

    kickWS.on('Subscription', (data) => {
        const username = data.username || '未知';
        const message = `订阅了频道`;

        console.info(`[Kick Sub] ${username} ${message}`);
        writeLog("Default", `${username} ${message}`, "Kick Sub");

        sendBarkNotification(username, message, "");
        sendSocketMessage(username, message, "", "", false, CacheUserNum, CacheUserList);
    });

    kickWS.on('GiftedSubscriptions', (data) => {
        const gifter = data.gifted_by || '未知';
        const recipients = Array.isArray(data.recipients) ? data.recipients.join(', ') : '';
        const message = `赠送了订阅给 ${recipients}`;

        console.info(`[Kick GiftSub] ${gifter} ${message}`);
        writeLog("Default", `${gifter} ${message}`, "Kick GiftSub");

        sendBarkNotification(gifter, message, "");
        sendSocketMessage(gifter, message, "", "", false, CacheUserNum, CacheUserList);
    });

    kickWS.on('UserBanned', (data) => {
        const username = data.username || '未知';
        const message = `已被封禁`;

        console.log(`[Kick Ban] ${username} ${message}`);
        writeLog("Default", `${username} ${message}`, "Kick Ban");

        sendSocketMessage(username, message, "", "", false, CacheUserNum, CacheUserList);
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

if (isKick) {
    startKickChat();
}
