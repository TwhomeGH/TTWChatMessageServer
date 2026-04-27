const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url')

const fs = require('fs');
const path = require('path');

const { config } = require('dotenv');
const { time } = require('console');

config(); // 讀取 .env

let tiktokProcess = null;

let logs = [];
const MAX_LOG_LINES = 200; // 最多保留 200 行

const sseClients = new Set();

var cacheKeywordDataTop = []
var cacheKeywordDataAll = []

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

function SaveCacheKeywordDataAll() {

    cacheKeywordDataAll = getAllMessageStatsSorted();
    fs.writeFileSync('./message_stats.json', JSON.stringify(cacheKeywordDataAll, null, 2));
    pushLog('💾 已將所有關鍵字統計寫入 message_stats.json');

}

/**
 * 日誌推送函數，會同時推送給所有 SSE client
 * @param  {...any} line 
 */
function pushLog(...line) {


    console.log(...line);


    if (logs.length > MAX_LOG_LINES) {
        logs.shift();
    }
    const text = line.map(item =>
        typeof item === 'object' ? JSON.stringify(item) : String(item)
    ).join(' ');

    logs.push(text);
    if (logs.length > MAX_LOG_LINES) logs.shift();



    // 推送給所有 SSE client
    for (const client of sseClients) {
        client.write(`data: ${text}\n\n`);
    }

}


function sendToTikTok(obj) {

    if (tiktokProcess) {
        pushLog("正在運行主TikTok,js 傳遞Socket與訊息紀錄")
        tiktokProcess.stdin.write(JSON.stringify(obj) + '\n');
    } else {
        pushLog("未運行TikTok.js")
    }

}



// server.js
const crypto = require('crypto');


const server_tokenFile = path.join(__dirname, 'server_tokens.json');

// 用 Map 儲存 token -> expiry
var validTokens = new Map();


// 啟動時載入
if (fs.existsSync(server_tokenFile)) {
    const data = JSON.parse(fs.readFileSync(server_tokenFile, 'utf8'));
    validTokens = new Map(Object.entries(data));
}

    // 儲存到檔案
    function saveTokens() {
    const obj = Object.fromEntries(validTokens);
    fs.writeFileSync(server_tokenFile, JSON.stringify(obj, null, 2));
}

// 建立 token，設定有效期 (例如 30 分鐘)
function createToken() {
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 14 * 24 * 60 * 60 * 1000; // 14天  24小時 60 分鐘
    validTokens.set(token, expiry);
    return token;
}

// 驗證 token
function isValidToken(token) {
    if (!token) return false;
    const expiry = validTokens.get(token);
    if (!expiry) return false;
    
    saveTokens();
    
    if (Date.now() > expiry) {
        validTokens.delete(token); // 過期就刪掉
        
        return false;
    }
    return true;
}

const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    // =======================
    // /open
    // =======================
    if (req.url.startsWith('/open')) {
        if (tiktokProcess) {
            res.end('TikTok.js already running\n');
            return;
        }

        console.log("開啟通知!!");

        // ✅ 新增：解析 query
        const url = new URL(req.url, `http://${req.headers.host}`)

        const user = url.searchParams.get('user') ?? ''

        var isTK = url.searchParams.get('isTK') === '1'
        var isTwitch = url.searchParams.get('isTwitch') === '1'

        const isBark = url.searchParams.get('isBark') === '1'
        const isSocket = url.searchParams.get('isSocket') === '1'
        const isBoth = url.searchParams.get('isBoth') === '1'



        pushLog('Starting TikTok.js with user=', user, 'isTK=', isTK);
        pushLog('isBark=', isBark, 'isSocket=', isSocket, 'isTwitch=', isTwitch);
        pushLog('isBoth=', isBoth);

        logs = [];
        pushLog('[SYSTEM] Starting TikTok.js');
        pushLog(`[SYSTEM] user=${user} ${isTK ? '(TikTok)' : '(Twitch)'}`);

        // ✅ 關鍵：把參數傳給 node
        const args = ['TikTok.js']
        if (user) args.push(user)
        if (isTK) args.push('--tiktok')

        if (isBark) args.push('--bark')
        if (isSocket) args.push('--socket')
        if (isTwitch) args.push('--twitch')
        if (isBoth) args.push('--both')

        tiktokProcess = spawn('node', args);

        tiktokProcess.stdout.on('data', (data) => {
            data
                .toString()
                .split('\n')
                .forEach(line => line && pushLog(`[OUT] ${line}`));


            var line = data.toString().trim();

            if (line.startsWith('{') && line.endsWith('}')) {
                // 可能是 JSON
                line = line.replace(/^[^\{]*/, '').replace(/[^\}]*$/, ''); // 嘗試提取 JSON 部分

                const json = JSON.parse(line);

                var PType = json.type;

                if (PType == "top10") {
                    cacheKeywordDataTop = json.data
                } else if (PType == "all") {
                    cacheKeywordDataAll = json.data
                }

                pushLog('📈 TikTok.js 回傳解析後:', json)

            }

        });

        tiktokProcess.stderr.on('data', (data) => {
            data
                .toString()
                .split('\n')
                .forEach(line => line && pushLog(`[ERR] ${line}`));
        });

        tiktokProcess.on('exit', (code, signal) => {
            pushLog(`[SYSTEM] Exit code=${code} signal=${signal}`);
            tiktokProcess = null;
        });







        let consoleLog = `TikTok.js started (TikTokUserName=${user}) isTK=${isTK} isBark=${isBark} isSocket=${isSocket} isTwitch=${isTwitch} isBoth=${isBoth}`;

        pushLog(`[SYSTEM] ${consoleLog}`);

        // 5s jump to / webpage
        // 假設你在 Node.js/Express 裡
        res.setHeader('Content-Type', 'text/html');

        res.end(`
  <html>
    <head>
     <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
 
      <title>Redirecting...</title>
    </head>
    <style>
        body {  
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #25211eff;
            color: #e4d4d4ff;
        }
        pre {   
            background-color: #333;
            color: #eee;
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
        }
        #countdown {
            margin-top: 20px;
            font-size: 18px;
            color: #edd4d4ff;
            background-color: #444;
            padding: 10px;
            border-radius: 5px;
        }
    </style>
    
    <body>
      <pre>${consoleLog}</pre>
      <div id="countdown">5</div>
      <script>
        let seconds = 5;
        const countdownEl = document.getElementById('countdown');
        const interval = setInterval(() => {
          seconds--;
          countdownEl.textContent = "即將跳轉到日志頁面 " + seconds;
          if (seconds <= 0) {
            clearInterval(interval);
            window.location.href = '/';
          }
        }, 1000);
      </script>
    </body>
  </html>
`);


    }
    // ===============================
    // /chat 主入口
    // ===============================

    else if (req.method === 'POST' && req.url === '/chat') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {

            try {


                pushLog('Chat入口📩 收到訊息:', body);

                const data = JSON.parse(body);

                setTimeout(() => {
                    pushLog('📩 0.7秒後處理訊息:', data);
                    sendToTikTok({
                        type: 'StreamMessage',
                        ...data
                    });

                }, 700);



                const { user, message } = data;

                recordMessageStat(message);

                pushLog('📩 發送訊息:', user, message);

                res.writeHead(200);
                res.end("OK");

            } catch (err) {
                console.error("❌ 處理 /chat 訊息失敗:", err.message);
                res.writeHead(400);
                res.end("Invalid JSON");
            }

        });

    }
    // =======================
    // /close
    // =======================
    else if (req.url === '/close') {

        if (!tiktokProcess) {
            res.end('TikTok.js not running\n');
            return;
        }

        // 透過 stdin 發送退出命令
        tiktokProcess.stdin.write('EXIT\n');


        let consoleLog = `TikTok.js stopping...`;


        pushLog(`[SYSTEM] ${consoleLog}`);

        res.setHeader('Content-Type', 'text/html');
        res.end(`
  <html>
    <head>
     <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
 
      <title>Redirecting...</title>
    </head>
    <style>
        body {  
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #25211eff;
            color: #e4d4d4ff;
        }
        pre {   
            background-color: #333;
            color: #eee;
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
        }
        #countdown {
            margin-top: 20px;
            font-size: 18px;
            color: #edd4d4ff;
            background-color: #444;
            padding: 10px;
            border-radius: 5px;
        }
    </style>
    
    <body>
      <pre>${consoleLog}</pre>
      <div id="countdown">5</div>
      <script>
        let seconds = 5;
        const countdownEl = document.getElementById('countdown');
        const interval = setInterval(() => {
          seconds--;
          countdownEl.textContent = "即將跳轉到日志頁面 " + seconds;
          if (seconds <= 0) {
            clearInterval(interval);
            window.location.href = '/';
          }
        }, 1000);
      </script>
    </body>
  </html>
`);

    }

    // =======================
    // /status
    // =======================
    else if (req.url === '/status') {
        res.write(`Running: ${tiktokProcess ? 'YES' : 'NO'}\n`);
        res.write('-------------------------\n');
        res.write(logs.join('\n'));
        res.write('\n');
        res.end();
    }
    else if (req.url === '/status/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        // 立刻送一次目前狀態
        res.write(`data: Running: ${tiktokProcess ? 'YES' : 'NO'}\n\n`);
        res.write(`data: -------------------------\n\n`);

        logs.forEach(line => {
            res.write(`data: ${line}\n\n`);
        });

        // 註冊 client
        const client = res;
        sseClients.add(client);

        // client 中斷時清理
        req.on('close', () => {
            sseClients.delete(client);
        });
    }


    // 補丁前端頁面 status/keyword

    else if (req.url === '/status/keyword') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });


        // 透過 stdin 發送退出命令
        if (!tiktokProcess) {

            res.write(`data: ${JSON.stringify({
                type: 'error',
                message: 'TikTok.js 未啟動，沒有實時關鍵字資料'
            })}\n\n`);

        }

        function sendKeywordDataCacheTop() {

            if (!tiktokProcess) {

                pushLog('未運行使用快取資料推送 top10 關鍵字統計');
                cacheKeywordDataTop = getTopMessages(10);
                if (cacheKeywordDataTop.length > 0) {
                    res.write(`data: ${JSON.stringify({
                        type: 'top10',
                        data: cacheKeywordDataTop
                    })}\n\n`);
                }

            } else {
                pushLog('請求 TikTok.js 推送 top10 關鍵字統計');
                tiktokProcess.stdin.write('GETTOP\n');

                if (cacheKeywordDataTop.length > 0) {
                    res.write(`data: ${JSON.stringify({
                        type: 'top10',
                        data: cacheKeywordDataTop
                    })}\n\n`);
                }

            }


        }


        function sendKeywordDataCacheAll() {

            if (!tiktokProcess) {
                pushLog('TikTok.js not running, cannot get ALL keyword data');

                cacheKeywordDataAll = getAllMessageStatsSorted();
                if (cacheKeywordDataAll.length > 0) {
                    res.write(`data: ${JSON.stringify({
                        type: 'all',
                        data: cacheKeywordDataAll
                    })}\n\n`);
                }


            } else {

                pushLog('請求 All Keyword TikTok.js');
                tiktokProcess.stdin.write('GETALL\n');

                if (cacheKeywordDataAll.length > 0) {
                    res.write(`data: ${JSON.stringify({
                        type: 'all',
                        data: cacheKeywordDataAll
                    })}\n\n`);
                }

            }
        }

        function sendKeywordData() {
            try {
                const raw = fs.readFileSync('./message_stats.json', 'utf-8');
                const json = JSON.parse(raw);

                pushLog('📈 讀取 message_stats.json:', json);

                const stats = json || [];

                const top10 = stats
                    .slice(0, 10); // 你存檔時已排序就直接 slice


                pushLog('📈 傳送 top10:', top10);
                pushLog('📈 傳送 all stats:', stats);

                res.write(`data: ${JSON.stringify({
                    type: 'top10',
                    data: top10
                })}\n\n`);

                res.write(`data: ${JSON.stringify({
                    type: 'all',
                    data: stats
                })}\n\n`);

            } catch (err) {
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    message: '無法讀取關鍵字檔案'
                })}\n\n`);
            }
        }

        // 進來先送一次
        sendKeywordData();


        // 如果你未來會更新檔案，可以定時推
        const interval = setInterval(sendKeywordDataCacheTop, 1000);
        const intervalAll = setInterval(sendKeywordDataCacheAll, 5000);


        req.on('close', () => {
            clearInterval(interval);
            clearInterval(intervalAll);

            pushLog('Client 中斷，停止推送關鍵字資料[TikTokJS 未運行，使用快取資料]');

            if (!tiktokProcess) {
                SaveCacheKeywordDataAll();
                pushLog('TikTok.js not running, saved cache keyword data to file on client disconnect');
                pushLog('Saved cache keyword data to file on client disconnect');
            }

        });


    }

    else if (req.url === '/keyword') {
        fs.readFile('./keyword.html', (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading keyword.html');
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    }

    // 登入 API
    else if (req.url === '/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const { password } = JSON.parse(body);

            if (password === process.env.CONFIG_KEY) {
            const token = createToken(); // 你自己的 token 生成邏輯
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': `authToken=${token}; SameSite=Strict`
            });
            res.end(JSON.stringify({ success: true }));
            } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid password' }));
            }
        });
        }


    // 保護的 config API
    
    // GET /config → 顯示表單
    else if (req.url.startsWith('/config') && req.method === 'GET') {

        const cookies = req.headers.cookie || '';
        const token = cookies.split(';')
            .map(c => c.trim())
            .find(c => c.startsWith('authToken='))
            ?.split('=')[1];
        
        console.log("Cookie",token.substring(0,token.length-5)+"00000")

        if (!isValidToken(token)) {
            // 直接回傳 login.html，而不是 302
            const loginPath = path.join(__dirname, 'login.html');
            fs.readFile(loginPath, 'utf8', (err, html) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server Error');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            });
            return;
        }

        // 讀取分離好的 config.html
        const filePath = path.join(__dirname, 'config.html');
        fs.readFile(filePath, 'utf8', (err, html) => {
            if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server Error');
            return;
            }

            // 在 HTML 裡替換佔位符
            let filledHtml = html
            .replace('${BARK_API}', process.env.BARK_API || '')
            .replace('${SOCKET_API}', process.env.SOCKET_API || '');

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(filledHtml);
        });

        
    }

    // POST /config → 接收表單
    else if (req.url === '/config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const params = new URLSearchParams(body);
            const newBark = params.get('BARK_API') || '';
            const newSocket = params.get('SOCKET_API') || '';

            // 更新 process.env
            process.env.BARK_API = newBark;
            process.env.SOCKET_API = newSocket;

            // 更新 .env 檔案
            const envPath = path.resolve('.env');
            let envContent = '';
            try {
                if (fs.existsSync(envPath)) {
                    envContent = fs.readFileSync(envPath, 'utf-8');
                }
            } catch (err) { console.error(err); }

            const updateEnv = (key, value) => {
                const regex = new RegExp(`^${key}=.*$`, 'm');
                if (regex.test(envContent)) {
                    envContent = envContent.replace(regex, `${key}=${value}`);
                } else {
                    envContent += `\n${key}=${value}`;
                }
            }

            updateEnv('BARK_API', newBark);
            updateEnv('SOCKET_API', newSocket);

            fs.writeFileSync(envPath, envContent, 'utf-8');

            let FixBARK = newBark.substring(0,newBark.length-5) + "00000"
            
            pushLog(`[SYSTEM] Updated .env: BARK_API=${FixBARK}, SOCKET_API=${newSocket}`);



            // 直接回傳 login.html，而不是 302
            const UpdatePath = path.join(__dirname, 'Update.html');
            fs.readFile(UpdatePath, 'utf8', (err, html) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server Error');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            });


        });
    }

    else if (req.url === '/logout') {
    res.writeHead(200, {
        'Set-Cookie': 'authToken=; HttpOnly; SameSite=Strict; Max-Age=0'
        // 本地測試時不要加 Secure，正式環境再加
    });
    res.end(JSON.stringify({ success: true }));
    }


    else if (req.url === '/help') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Available endpoints:
/open?user=xxx&isTK=1&isBark=1&isSocket=1&isTwitch=1&isBoth=1
starts TikTok.js with parameters:
user=xxx : 指定 TikTok 或 Twitch 用戶名稱
isTK=1   : 使用 TikTok (不設或設為 0 則使用 Twitch)
isBark=1 : 啟用 Bark 通知
isSocket=1 : 啟用 Socket 通知
isTwitch=1 : 啟用 Twitch 通知
isBoth=1 : 同時啟用 TikTok 和 Twitch


/close
stops TikTok.js

/config
view and edit configuration (.env variables) via HTML form

/status
once-off status and logs

/status/stream
streaming status and logs via Server-Sent Events

/help
this help message
/
shows this HTML page
Process view logs in real-time.

`);

    }


    else if (req.url === '/') {
        const filePath = path.join(__dirname, 'log.html');

        fs.readFile(filePath, 'utf8', (err, html) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Failed to load log.html');
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        });
    }


    else {
        res.statusCode = 404;
        res.end('Not found\n');
    }
});

server.listen(3332, '0.0.0.0', () => {
    pushLog('HTTP control server listening on port 3332');
});

process.on("SIGINT", async () => {
    await handleExit()
});

process.on("SIGTERM", async () => {
    await handleExit()
});




async function handleExit() {

    pushLog("Exiting...");

    if (!tiktokProcess) {
        SaveCacheKeywordDataAll();
        pushLog('TikTok.js not running, saved cache keyword data to file on exit');
    }
    if (tiktokProcess) {
        const proc = tiktokProcess;
        tiktokProcess = null;

        // 透過 stdin 發送退出命令
        proc.stdin.write('EXIT\n');

        await new Promise(resolve => {
            proc.once('exit', () => resolve());
            // 超時保險
            setTimeout(() => {
                if (!proc.killed) proc.kill('SIGKILL');
                resolve();
            }, 5000);
        });
        pushLog("✅ TikTok.js process exited");

    }

    pushLog("TikTok.js exited, exiting main process");

    process.exit(0);


}
