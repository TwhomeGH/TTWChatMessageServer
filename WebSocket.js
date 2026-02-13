import { createServer } from 'http';
import { Socket } from 'net';

import { config } from 'dotenv';

config(); // 讀取 .env 檔案

const TCP_HOST = process.env.SOCKET_API?.split(':')[1]?.replace('//', '')  || '192.168.0.195';
const TCP_PORT = process.env.SOCKET_API?.split(':')[2] || 9322;

const HEARTBEAT_INTERVAL = 50000; // 50 秒

let tcpClient = null;
let heartbeatTimer = null;




// node 內建：process.argv
// argv[0] = node 路徑 / user?
// argv[1] = TikTok.js 路徑
// argv[2] 開始才是你傳的參數

const args = process.argv.slice(2)

// 你要的後綴參數
const keyword = args[0] || ''


let isRepeat = args.includes('--repeat')
let isDelay = args.includes('--delay')

// ===== 設定開關 =====
let enableDuplicateCheck = isRepeat;   // 是否啟用重複檢查
let enableDelayCheck = isDelay;       // 是否延遲 2 秒檢查

// ===== 暫存最多 10 筆 =====
let syncBuffer = []; // [{ username, message, timestamp }]


/**********************
 * 🔌 建立 TCP 連線
 **********************/
function connectTCP() {

    tcpClient = new Socket();

    tcpClient.connect(TCP_PORT, TCP_HOST, () => {
        console.log('✅ TCP 已連線');
        startHeartbeat();
    });

    tcpClient.on('error', (err) => {
        console.error('❌ TCP 錯誤:', err.message);
    });

    tcpClient.on('close', () => {
        console.warn('⚠️ TCP 連線關閉，5秒後重連...');
        stopHeartbeat();
        setTimeout(connectTCP, 5000);
    });
}

/**********************
 * 💓 心跳機制
 **********************/
function startHeartbeat() {
    stopHeartbeat(); // 避免重複

    heartbeatTimer = setInterval(() => {
        if (!tcpClient || tcpClient.destroyed) return;

        const heartbeat = JSON.stringify({
            type: "Heartbeat"
        });

        try {
            tcpClient.write(heartbeat + '\n');
            console.log("💓 已發送心跳");
        } catch (err) {
            console.error("心跳發送失敗:", err.message);
        }

    }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}


async function handleExit() {
    console.log("⏹️ 程式結束，儲存 send_messages...");
    

    isEnd=true

    if (tcpClient && !tcpClient.destroyed) {
        // 先嘗試送最後一條訊息
        await new Promise((resolve) => {
            tcpClient.write(JSON.stringify({
                type: 'StreamMessage',
                user: "系統",
                message: "TTW Chat Message WebServer 已關閉",
                img: "",
                giftImg: "",
                isMain: false
            }) + '\n', () => {
                // 等到 write callback 確認送出後再關閉
                tcpClient.end(() => {
                    stopHeartbeat(); // 停止心跳
                    resolve();
                });
            });
        });
        server.close((e) =>{
            if(e) {
                console.error("HTTP Server 關閉失敗:", e.message);
            }
        });
    }

  
    console.log("✅ 優雅退出完成");

    process.exit(0);
}

process.stdin.on('data', async (data) => {
    const msg = data.toString().trim();
    if (msg === 'EXIT') {
        console.log('[SYSTEM] Received EXIT command via stdin');
        await handleExit(); // 可以完整 await
    }
});

process.on("SIGINT", async () => {
    await handleExit();
});

process.on("SIGTERM", async () => {
    console.log("Received SIGTERM, exiting gracefully...");
    await handleExit();
});


function addToSyncBuffer(username, message) {
    syncBuffer.push({
        username,
        message,
        timestamp: Date.now()
    });

    // 超過 10 筆就移除最舊的
    if (syncBuffer.length > 10) {
        syncBuffer.shift();
    }
}

function isDuplicate(username, message) {
    return syncBuffer.some(item =>
        item.username === username &&
        item.message === message
    );
}


/**********************
 * 🌐 HTTP Server
 **********************/
const server = createServer((req, res) => {

    // ===============================
    // /chat 主入口
    // ===============================

    if (req.method === 'POST' && req.url === '/chat') {

        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {

             try {
                       
                console.log('📩 收到訊息:', body);

                const data = JSON.parse(body);
                const { user, message } = data;

               const processSend = () => {

                    if (enableDuplicateCheck && isDuplicate(user, message)) {
                        console.log('🚫 重複訊息跳過:', user, message);
                        return;
                    }

                    console.log('📩 發送訊息:', user, message);

                    if (tcpClient && !tcpClient.destroyed) {
                        tcpClient.write(JSON.stringify(data) + '\n');
                    }

                    // 加入 buffer 避免短時間內重複
                    addToSyncBuffer(user, message);
                };

                if (enableDuplicateCheck && enableDelayCheck) {
                    // 延遲 2 秒
                    setTimeout(processSend, 2000);
                } else {
                    processSend();
                }

                res.writeHead(200);
                res.end("OK");

            } catch (err) {
                console.error("❌ 處理 /chat 訊息失敗:", err.message);
                res.writeHead(400);
                res.end("Invalid JSON");
            }

        });

    } 

    // ===============================
    // /sendSync 預同步入口
    // ===============================

    else if (req.method === 'POST' && req.url === '/sendSync') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

       req.on('end', () => {

            try {
                const data = JSON.parse(body);
                const { username, message } = data;

                console.log('🔄 收到同步來源:', username, message);

                addToSyncBuffer(username, message);

                res.writeHead(200);
                res.end("SYNC OK");

            } catch (err) {
                res.writeHead(400);
                res.end("Invalid JSON");
            }
        });


    }  else {
        res.writeHead(404);
        res.end();
    }

});

server.listen(3001, () => {
    console.log("🚀 HTTP Server 3001 啟動");
});

/**********************
 * 🚀 啟動 TCP
 **********************/
connectTCP();