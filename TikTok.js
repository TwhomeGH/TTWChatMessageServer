import { ApiClient } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { promises as fs } from 'fs';
import axios from 'axios';

import { config } from 'dotenv';

import net from 'net';

import { SignConfig } from "tiktok-live-connector";


import path from 'path';


import { TikTokLiveConnection, WebcastEvent,ControlEvent,ControlAction } from 'tiktok-live-connector';
import { type } from 'os';


config(); // 讀取 .env

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


let isBark = args.includes('--bark')


let isSocket = args.includes('--socket')

let isBoth = args.includes('--both')

if (isBoth) {
    isTK = true
    isTwitch = true
}

console.log('收到參數:', keyword, isTK ? '(TikTok)' : '(Twitch)');

console.log('isBark=', isBark, 'isSocket=', isSocket, 'isTwitch=', isTwitch);
console.log('isBoth=', isBoth);

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



        // 🟢 JSON 訊息
        try {
            const json = JSON.parse(msg);

            if (json.type === 'StreamMessage') {
                // 同時記錄訊息統計
                recordMessageStat(json.message);

                if (json.userNum !== CacheUserNum) {
                    CacheUserNum = json.userNum;
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

        await axios.post(Bark, { title, body: comment, icon }, { headers: { "Content-Type": "application/json" } });
        console.log("✅ Bark 推送成功");
    } catch (err) {
        console.error("❌ Bark 推送錯誤:", err.message);
    }
}




function sendToTCP(payload) {
    if (!client || client.destroyed) return;

    console.log('📤 發送 TCP 訊息:紀錄',payload.user,payload.message);
    
    try {
        console.log('📤 發送 TCP 訊息Sync:', payload);

        if (isDuplicate(payload.user, payload.message)) {
            console.log('🚫 重複訊息跳過:', payload.user, payload.message);
            return;
        }

        client.write(JSON.stringify(payload) + '\n');

        addToSyncBuffer(payload.user, payload.message);

    } catch (err) {
        console.error('⚠️ 發送 TCP 訊息失敗:', err.message);
    }

}


const messageStats = new Map();
// key: message 內容
// value: 出現次數

function recordMessageStat(message) {
    if (!message) return;

    const count = messageStats.get(message) || 0;
    messageStats.set(message, count + 1);
}

// 取得出現次數最高的 N 條訊息
function getTopMessages(limit = 10) {
    return [...messageStats.entries()]
        .sort((a, b) => b[1] - a[1]) // 依次數由大到小
        .slice(0, limit)            // 取前 N 名
        .map(([message, count]) => ({
            message,
            count
        }));
}

// 取得所有訊息統計，依次數排序
function getAllMessageStatsSorted() {
    return [...messageStats.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([message, count]) => ({
            message,
            count
        }));
}


// ===== 暫存最多 10 筆 =====
let syncBuffer = []; // [{ username, message, timestamp }]

function addToSyncBuffer(username, message) {
    syncBuffer.push({
        username,
        message,
        timestamp: Date.now()
    });

    
    // 超過 100 筆就移除最舊的
    if (syncBuffer.length > 100) {
        syncBuffer.shift();
    }
}

function isDuplicate(username, message) {
    return syncBuffer.some(item =>
        item.username === username &&
        item.message === message
    );
}

var CacheUserList = [] // 用於去重的用戶列表
var CacheUserNum = 0 // 用於去重的用戶數量

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

    
    if (isDuplicate(user, message)) {
        console.log('🚫內部 重複訊息跳過:', user, message);
        return;
    }

    

    const payload = {
        type: 'StreamMessage',
        user,
        message:String(message),
        img,
        giftImg,
        isMain,
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

        reconnectTimer = setTimeout(connectSocket, 15000);

       
    });

    client.on('error', (err) => {
        console.error('⚠️ TCP Socket error:', err.message);
        client?.destroy();

        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
    });
}




if (isTK) {
    console.log("連接 TikTok 直播間:", tiktokName)
    // Connect to the chat (await can be used as well)
    connection.connect().then(state => {
        console.info(`Connected to roomId ${state.roomId}`);

        sendBarkNotification("TikTok 直播間連線成功", `已連接到 ${tiktokName} 的直播間`, "");
        sendSocketMessage("系統", `TikTok 直播間連線成功，已連接到 ${tiktokName} 的直播間`, "", "", false,CacheUserNum,CacheUserList);
  
    }).catch(err => {
        console.error('Failed to connect', err);
        sendBarkNotification("TikTok 直播間連線失敗", `無法連接到 ${tiktokName} 的直播間`, "");
        sendSocketMessage("系統", `TikTok 直播間連線失敗，無法連接到 ${tiktokName} 的直播間`, "", "", false,CacheUserNum,CacheUserList);
    });
}


connection.on(ControlEvent.DISCONNECTED, (e) => {
    console.log('Disconnected :( \(error code: ' + e.errorCode + ', reason: ' + e.reason + ')');
    
    sendBarkNotification("TikTok 直播間已斷線", `已從 ${tiktokName} 的直播間斷線`, "");
    sendSocketMessage("系統", `TikTok 直播間已斷線，已從 ${tiktokName} 的直播間斷線`, "", "", false,CacheUserNum,CacheUserList);


    setTimeout(() => {
        console.log("需要重新連線 TikTok 直播間...");
        sendSocketMessage("系統", "需要重新連線 TikTok 直播間...", "", "", false,CacheUserNum,CacheUserList);

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

    
    sendBarkNotification(data.user.nickname, "來了",iconn);
    sendSocketMessage(data.user.nickname, "來了",iconn,"",false,CacheUserNum,CacheUserList);

   // 同時記錄訊息統計 加入訊息存儲用與TikTok的結果一致 以便去重
    addToSyncBuffer(data.user.nickname, "加入了");

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

    let iconn = data.user.profilePicture.url[1]

    console.log(`Chat:${data.user.nickname} : ${data.comment}`)
    console.log("訊息已記錄到統計中:", data.comment)
    // 同時記錄訊息統計
    recordMessageStat(data.comment);

    sendBarkNotification(data.user.nickname, data.comment,iconn);
    sendSocketMessage(data.user.nickname, data.comment,iconn,"",true,CacheUserNum,CacheUserList);

    // 同時記錄訊息統計
    addToSyncBuffer(data.user.nickname, data.comment);

});


connection.on(WebcastEvent.ROOM_MESSAGE, data => {

    printf("ROOM_MESSAGE", JSON.stringify(data, "", 4));

    const uniqueKey = `chat_${data.user.nickname}_${data.comment}`;
    if (alreadySent(uniqueKey)) return;

    let iconn = data.user.profilePicture.url[1]

    console.log(`${data.user.nickname} : ${data.comment}`)

    // 同時記錄訊息統計
    recordMessageStat(data.comment);

    sendBarkNotification(data.user.nickname, data.comment,iconn);
    sendSocketMessage(data.user.nickname, data.comment,iconn,"");

});


connection.on(WebcastEvent.LIKE, data => {

    let iconn = data.user.profilePicture.url[1]
    let mess = `喜歡你 ${data.likeCount} 次`

    console.log(`${data.user.nickname} ${mess}`)
    //let giftImg =  "https://img.icons8.com/?size=100&id=xruQNezCArqC&format=png&color=000000"
    

    sendBarkNotification(data.user.nickname, mess,iconn);
    sendSocketMessage(data.user.nickname, mess,iconn,"",false);

})

// And here we receive gifts sent to the streamer
connection.on(WebcastEvent.GIFT, async data => {
    await giftMapReady;
    const originalGiftName = data.giftDetails?.giftName || "";
    const translatedGiftName = await ensureGiftNameTranslation(originalGiftName);
    const giftNameForDisplay = translatedGiftName || originalGiftName;
        
    //console.log(JSON.stringify(data,"",4))
    if (data.giftType === 1 && !data.repeatEnd ){
       
        console.log(`送出了 ${data.user.nickname} : ${giftNameForDisplay} x${data.repeatCount}`)
        
        let mess = `送出了 ${giftNameForDisplay} x${data.repeatCount}`
        let iconn = data.user.profilePicture.url[1]
        let giftImg = data.giftDetails.icon.url[1]

        //giftPictureUrl

        console.log("giftimg",giftImg)

        sendBarkNotification(data.user.nickname, mess,giftImg);
        sendSocketMessage(data.user.nickname, mess,iconn,giftImg);

        
    } else {
        console.log(`送出了 ${data.user.nickname} : ${giftNameForDisplay} x${data.repeatCount}`)
        let mess = `送出了 ${giftNameForDisplay} x${data.repeatCount}`
        let iconn = data.user.profilePicture.url[1]
        let giftImg = data.giftDetails.icon.url[1]

        console.log("giftimg",giftImg)
        sendBarkNotification(data.user.nickname, mess,giftImg);

        sendSocketMessage(data.user.nickname, mess,iconn,giftImg,CacheUserNum,CacheUserList);

    }
     
   

     
});


connection.on(WebcastEvent.SHARE, data =>{
    let mess = "分享直播間"
    let iconn = data.user.profilePicture.url[1]
    console.log(`${data.user.nickname} ${mess}`)
    
    sendBarkNotification(data.user.nickname, mess,iconn);
    sendSocketMessage(data.user.nickname, mess,iconn,"",false,CacheUserNum,CacheUserList);

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

        sendBarkNotification(data.nickname, `送出了寶箱，包含 ${envelope.diamondCount} 鑽石`, data.user.profilePicture.url[1]);
        sendSocketMessage(data.nickname, `送出了寶箱，包含 ${envelope.diamondCount} 鑽石`, data.user.profilePicture.url[1], "", true, CacheUserNum, CacheUserList);
    }
});

connection.on(WebcastEvent.SUPER_FAN, (data) => {
    console.log('A user became a superfan!');
    let mess = "鐵粉出現啦！"
    let iconn = data.user.profilePicture.url[1]
    console.log(`${data.user.nickname} ${mess}`)
    
    sendBarkNotification(data.user.nickname, mess,iconn);
    sendSocketMessage(data.user.nickname, mess,iconn,"",true,CacheUserNum,CacheUserList);

});

connection.on(ControlEvent.STREAM_END, ({ action }) => {

let IMG = "https://img.icons8.com/?size=100&id=xruQNezCArqC&format=png&color=000000"
    
let mess = "直播結束啦"

console.log(JSON.stringify({ action },"",4))

    if (action === ControlAction.CONTROL_ACTION_STREAM_ENDED) {
        console.log('Stream ended by user');
        sendBarkNotification(data.user.nickname, mess,IMG);
        sendSocketMessage(data.user.nickname, mess,IMG,"",false);

    }
    if (action === ControlAction.CONTROL_ACTION_STREAM_SUSPENDED) {
        console.log('Stream ended by platform moderator (ban)');
        sendBarkNotification(data.user.nickname, mess,IMG);
        sendSocketMessage(data.user.nickname, mess,IMG,"",false);

    }
});


// Gift
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
const user = await apiClient.users.getUserByName("coffeelatte0709");
const tuser = user.id;

console.log("[Twitch] UserID", tuser);


// --- 2. EventSub WebSocket ---
const listener = new EventSubWsListener({ apiClient, port: 0 });

if (isTwitch) {
    console.log("啟用 Twitch 事件監聽");
    listener.start();
}


async function getUserIcon(id) {
    const uss = await apiClient.users.getUserById(id);
    return uss.profilePictureUrl;
}








connectSocket();



// 錯誤處理
listener.on("error", (err) => {
    console.error('⚠️ Twitch EventSub Listener error:', err);
});



// --- 3. Twitch EventSub 直播開始/結束 ---
listener.onStreamOnline(tuser, async (event) => {
    const message = `直播開始啦！標題：${event.broadcasterName} ${event.type}`; 

    console.log(message);
    sendBarkNotification("直播開始啦！", `${event.broadcasterName} ${event.type}`, "");
    sendSocketMessage("系統", message, "", "", false,CacheUserNum,CacheUserList);

    
});

listener.onStreamOffline(tuser, async (event) => {
    const message = `直播結束啦！標題：${event.broadcasterName}`;  

    console.log(message);

    sendBarkNotification("直播結束啦！", `${event.broadcasterName}`, "");
    sendSocketMessage("系統", message, "", "", false,CacheUserNum,CacheUserList);
});


// --- 5. Twitch EventSub ---
listener.onChannelFollow(tuser, tuser, async (event) => {
    const icon = await getUserIcon(event.userId);
    const message = `關注了主播`;

    console.log(message);

    sendBarkNotification(event.userDisplayName, "關注了主播", icon);

    sendSocketMessage(event.userDisplayName, message, icon,"", false,CacheUserNum,CacheUserList);

   
});

listener.onChannelCheer(tuser, tuser, async (event) => {
    const message = `送出 ${event.bits} 小奇點`;
    const icon = await getUserIcon(event.userId);

    console.log(`${event.userDisplayName} ${message}`);

    sendBarkNotification(event.userDisplayName, message, icon);
    sendSocketMessage(event.userDisplayName, message, icon,"", false,CacheUserNum,CacheUserList);

   
});

listener.onChannelChatMessage(tuser, tuser, async (event) => {
    const icon = await getUserIcon(event.chatterId);
    
    
    console.log(`${event.chatterDisplayName} : ${event.messageText}`);

    recordMessageStat(event.messageText);

    sendBarkNotification(event.chatterDisplayName, event.messageText, icon);
    sendSocketMessage(event.chatterDisplayName, event.messageText, icon,"Chat", false,CacheUserNum,CacheUserList);

    
});

// 其他事件同理可加 sendSocketMessage
