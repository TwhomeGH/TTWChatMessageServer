const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url')

const fs = require('fs');
const path = require('path');

const { config } = require('dotenv');
const { time } = require('console');

// PKCE helpers for Kick OAuth
function base64URLEncode(buffer) {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

let pkceVerifier = null;
let pkceChallenge = null;
let isBark = false;
let isSocket = false;

async function exchangeKickCode(code, verifier) {
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KICK_CLIENT_ID || '',
        client_secret: process.env.KICK_CLIENT_SECRET || '',
        code,
        code_verifier: verifier,
        redirect_uri: `http://localhost:3332/get-kick-token`,
    });
    const res = await fetch('https://id.kick.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Kick token exchange failed: ${res.status} ${errText}`);
    }
    return res.json();
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

const kickTokenFile = path.join(__dirname, 'kick_tokens.json');

function loadKickTokens() {
    try {
        if (fs.existsSync(kickTokenFile)) {
            return JSON.parse(fs.readFileSync(kickTokenFile, 'utf8'));
        }
    } catch (err) {
        console.error('讀取 kick_tokens.json 失敗:', err);
    }
    return null;
}

function saveKickTokens(tokens) {
    fs.writeFileSync(kickTokenFile, JSON.stringify(tokens, null, 2));
}

let messageFilter = null;
import('./MessageFilter.js').then(mod => {
    messageFilter = mod.default || mod;
}).catch(err => {
    console.error('❌ 無法載入 MessageFilter 模組:', err);
});


var TEST_LOG = [
    Date.now().toLocaleString(),
    "測試主 LOG文件"
]

writeLog("Default",TEST_LOG.join("\n"))

config(); // 讀取 .env

let tiktokProcess = null;

let logs = [];
const MAX_LOG_LINES = 200; // 最多保留 200 行

const sseClients = new Set();

var cacheKeywordDataTop = []
var cacheKeywordDataAll = []

function recordMessageStat(message) {
    if (!message) return;
    if (messageFilter) messageFilter.recordMessageStat(message);
}

function getTopMessages(limit = 10) {
    return messageFilter ? messageFilter.getTopMessages(limit) : [];
}

function getAllMessageStatsSorted() {
    return messageFilter ? messageFilter.getAllMessageStatsSorted() : [];
}

function isFiltered({ user, message } = {}) {
    return messageFilter ? messageFilter.isFiltered({ user, message }) : false;
}

function processFilter({ user, message } = {}) {
    return messageFilter ? messageFilter.processFilter({ user, message }) : { user, message, blocked: false, modified: false };
}

function SaveCacheKeywordDataAll() {
    cacheKeywordDataAll = getAllMessageStatsSorted();
    fs.writeFileSync('./message_stats.json', JSON.stringify(cacheKeywordDataAll, null, 2));
    pushLog('💾 已將所有關鍵字統計寫入 message_stats.json');
}


/**
 * 將日誌訊息追加到檔案尾端
 * @param {string} filename - 日誌檔案名稱
 * @param {string} message - 要寫入的訊息
 */
function writeLog(filename="Main_Log.log", message) {

    var FileN = filename
    if (filename.toLowerCase().startsWith("default")) {
    console.log("使用預設",FileN)
    FileN = "Main_Log.log"
    }
    const logPath = path.resolve(__dirname, FileN);
    const logLine = `${new Date().toLocaleString()} - ${message}\n`;

    fs.appendFile(logPath, logLine, (err) => {
        if (err) {
        console.error('寫入日誌失敗:', err);
        }
    });

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

    if (tiktokProcess && !tiktokProcess.killed) {
        pushLog("正在運行主TikTok,js 傳遞Socket與訊息紀錄")
        try {
            tiktokProcess.stdin.write(JSON.stringify(obj) + '\n');
        } catch (err) {
            pushLog(`寫入 TikTok 進程失敗: ${err.message}`)
        }
    } else {
        pushLog("未運行TikTok.js")
    }

}



// server.js
const crypto = require('crypto');
const { text } = require('stream/consumers');


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
        const twitchUser = url.searchParams.get('twitchUser') ?? ''
        const kickUser = url.searchParams.get('kickUser') ?? ''
        const odyseeUser = url.searchParams.get('odyseeUser') ?? ''
        const youtubeUser = url.searchParams.get('youtubeUser') ?? ''

        var isTK = url.searchParams.get('isTK') === '1'
        var isTwitch = url.searchParams.get('isTwitch') === '1'
        var isKick = url.searchParams.get('isKick') === '1'
        var isOdysee = url.searchParams.get('isOdysee') === '1'
        var isYoutube = url.searchParams.get('isYouTube') === '1'

        isBark = url.searchParams.get('isBark') === '1'
        isSocket = url.searchParams.get('isSocket') === '1'
        const isBoth = url.searchParams.get('isBoth') === '1'
        const platforms = url.searchParams.get('platforms')  // e.g. "tiktok,twitch,kick"

        // platforms 參數優先：可任意組合平台
        if (platforms) {
            const list = platforms.split(',').map(p => p.trim().toLowerCase())
            isTK = list.includes('tiktok')
            isTwitch = list.includes('twitch')
            isKick = list.includes('kick')
            isOdysee = list.includes('odysee')
            isYoutube = list.includes('youtube')
        } else if (isBoth) {
            // 向後相容：isBoth=1 → tiktok + twitch
            isTK = true
            isTwitch = true
        }

        if (twitchUser) process.env.TWITCH_USER_NAME = twitchUser;
        if (kickUser) process.env.KICK_USER_NAME = kickUser;
        if (odyseeUser) process.env.ODYSEE_CHANNEL_NAME = odyseeUser;
        if (youtubeUser) process.env.YOUTUBE_CHANNEL_ID = youtubeUser;

        pushLog('Starting TikTok.js with user=', user, 'isTK=', isTK);
        pushLog('isBark=', isBark, 'isSocket=', isSocket, 'isTwitch=', isTwitch, 'isKick=', isKick, 'isOdysee=', isOdysee, 'isYoutube=', isYoutube);
        pushLog('isBoth=', isBoth, 'platforms=', platforms);
        if (twitchUser) pushLog('Twitch user=', twitchUser);
        if (kickUser) pushLog('Kick user=', kickUser);
        if (odyseeUser) pushLog('Odysee user=', odyseeUser);
        if (youtubeUser) pushLog('Youtube user=', youtubeUser);

        logs = [];
        pushLog('[SYSTEM] Starting TikTok.js');
        pushLog(`[SYSTEM] user=${user} ${isTK ? '(TikTok)' : ''}${isTwitch ? '(Twitch)' : ''}${isKick ? '(Kick)' : ''}${isOdysee ? '(Odysee)' : ''}${isYoutube ? '(Youtube)' : ''}`);

        // ✅ 關鍵：把參數傳給 node
        const args = ['TikTok.js']
        if (user) args.push(user)

        // 若有 platforms 則傳遞組合字串，否則逐一傳遞個別旗標
        const activePlatforms = []
        if (isTK) activePlatforms.push('tiktok')
        if (isTwitch) activePlatforms.push('twitch')
        if (isKick) activePlatforms.push('kick')
        if (isOdysee) activePlatforms.push('odysee')
        if (isYoutube) activePlatforms.push('youtube')
        if (activePlatforms.length > 0) {
            args.push(`--platforms=${activePlatforms.join(',')}`)
        }

        if (isBark) args.push('--bark')
        if (isSocket) args.push('--socket')
        // 向後相容：仍保留個別旗標給舊版 TikTok.js
        if (isTK) args.push('--tiktok')
        if (isTwitch) args.push('--twitch')
        if (isKick) args.push('--kick')
        if (isOdysee) args.push('--odysee')
        if (isYoutube) args.push('--youtube')
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







        let consoleLog = `TikTok.js started (user=${user}) isTK=${isTK} isBark=${isBark} isSocket=${isSocket} isTwitch=${isTwitch} isKick=${isKick} isBoth=${isBoth} platforms=${platforms}`;

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
    // Chat 主入口
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

                const { user, message } = data;

                const fr = processFilter({ user, message });
                if (fr.blocked) {
                    pushLog('🚫 過濾器阻擋(/chat):', user, message, `(規則: ${fr.reason})`);
                    res.writeHead(200);
                    res.end("Filtered");
                    return;
                }

                // 傳原始資料給 TikTok.js，讓它自己跑 filter + 去重
                const payload = { type: 'StreamMessage', ...data };

                sendToTikTok(payload);

                recordMessageStat(fr.modified ? fr.message : message);

                pushLog('📩 發送訊息:', fr.modified ? fr.user : user, fr.modified ? fr.message : message);

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
        
        console.log("Cookie",String(token).substring(0,String(token).length-5)+"00000")

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
            .replace('${SOCKET_API}', process.env.SOCKET_API || '')
            .replace('${BING_TRANSLATE_API_KEY}', process.env.BING_TRANSLATE_API_KEY || '')
            .replace('${KICK_CLIENT_ID}', process.env.KICK_CLIENT_ID || '')
            .replace('${KICK_CLIENT_SECRET}', process.env.KICK_CLIENT_SECRET || '')
            .replace('${KICK_USER_NAME}', process.env.KICK_USER_NAME || '');

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
            const newBingKey = params.get('BING_TRANSLATE_API_KEY') || '';
            const newKickClientId = params.get('KICK_CLIENT_ID') || '';
            const newKickClientSecret = params.get('KICK_CLIENT_SECRET') || '';
            const newKickUserName = params.get('KICK_USER_NAME') || '';

            // 更新 process.env
            process.env.BARK_API = newBark;
            process.env.SOCKET_API = newSocket;
            process.env.BING_TRANSLATE_API_KEY = newBingKey;
            process.env.KICK_CLIENT_ID = newKickClientId;
            process.env.KICK_CLIENT_SECRET = newKickClientSecret;
            process.env.KICK_USER_NAME = newKickUserName;

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
            updateEnv('BING_TRANSLATE_API_KEY', newBingKey);
            updateEnv('KICK_CLIENT_ID', newKickClientId);
            updateEnv('KICK_CLIENT_SECRET', newKickClientSecret);
            updateEnv('KICK_USER_NAME', newKickUserName);

            fs.writeFileSync(envPath, envContent, 'utf-8');

            let FixBARK = newBark.substring(0,newBark.length-5) + "00000"
            
            pushLog(`[SYSTEM] Updated .env: BARK_API=${FixBARK}, SOCKET_API=${newSocket}, BING_TRANSLATE_API_KEY=${newBingKey ? '***' : ''}`);



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

    // =======================
    // Kick OAuth login
    // =======================
    else if (req.url === '/kick-login') {
        pkceVerifier = base64URLEncode(crypto.randomBytes(32));
        pkceChallenge = base64URLEncode(crypto.createHash('sha256').update(pkceVerifier).digest());
        const state = base64URLEncode(crypto.randomBytes(16));

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: process.env.KICK_CLIENT_ID || '',
            redirect_uri: 'http://localhost:3332/get-kick-token',
            scope: 'user:read channel:read',
            state,
            code_challenge: pkceChallenge,
            code_challenge_method: 'S256',
        });

        res.writeHead(302, { 'Location': `https://id.kick.com/oauth/authorize?${params}` });
        res.end();
    }

    // =======================
    // Kick OAuth callback
    // =======================
    else if (req.url.startsWith('/get-kick-token')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>缺少授權碼 (code)</h2>');
            return;
        }

        (async () => {
            try {
                const tokens = await exchangeKickCode(code, pkceVerifier);
                tokens.obtainmentTimestamp = Date.now();
                saveKickTokens(tokens);
                pushLog('✅ Kick OAuth 成功，已儲存 token');

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<h2>✅ Kick 授權成功！</h2><p>Token 已儲存。</p><a href="/config">回到設定頁</a>`);
            } catch (err) {
                console.error('❌ Kick token exchange 失敗:', err);
                pushLog('❌ Kick token exchange 失敗:', err.message);
                res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<h2>❌ 授權失敗</h2><p>${err.message}</p>`);
            }
        })();
    }

    // =======================
    // Youtube OAuth
    // =======================
    else if (req.url === '/youtube-auth') {
        const params = new URLSearchParams({
            client_id: process.env.YOUTUBE_CLIENT_ID || '',
            redirect_uri: 'http://localhost:3332/get-youtube-token',
            response_type: 'code',
            scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
            access_type: 'offline',
            prompt: 'consent',
        });
        res.writeHead(302, { 'Location': `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
        res.end();
    }

    // =======================
    // Youtube OAuth callback
    // =======================
    else if (req.url.startsWith('/get-youtube-token')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h2>❌ 授權失敗</h2><p>${error}</p>`);
            return;
        }

        if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>缺少授權碼 (code)</h2>');
            return;
        }

        (async () => {
            try {
                const params = new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: process.env.YOUTUBE_CLIENT_ID || '',
                    client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
                    redirect_uri: 'http://localhost:3332/get-youtube-token',
                    code: code,
                });
                const res2 = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params,
                });
                if (!res2.ok) throw new Error(`Token exchange failed: ${res2.status} ${await res2.text()}`);

                const tokens = await res2.json();
                tokens.obtainmentTimestamp = Date.now();
                const tokenFile = path.join(__dirname, 'youtube_tokens.json');
                fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
                pushLog('✅ Youtube OAuth 成功，已儲存 token');

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<h2>✅ Youtube 授權成功！</h2><p>Token 已儲存，可關閉此頁面。</p><a href="/config">回到設定頁</a>`);
            } catch (err) {
                console.error('❌ Youtube token exchange 失敗:', err);
                pushLog('❌ Youtube token exchange 失敗:', err.message);
                res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<h2>❌ 授權失敗</h2><p>${err.message}</p>`);
            }
        })();
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
/open?user=xxx&twitchUser=yyy&kickUser=zzz&platforms=tiktok,twitch,kick&isBark=1&isSocket=1
starts TikTok.js with parameters:
user=xxx       : 指定 TikTok 用戶名稱
twitchUser=yyy : 指定 Twitch 用戶名稱
kickUser=zzz   : 指定 Kick 頻道名稱
platforms      : 自由組合平台（用逗號分隔），例如：
                 platforms=tiktok,twitch,kick  (三平台全開)
                 platforms=twitch,kick         (只開 Twitch+Kick)
                 platforms=tiktok,twitch       (TikTok+Twitch，同 isBoth=1)
                 platforms=tiktok              (只開 TikTok)
isTK=1         : 使用 TikTok（個別旗標，與 platforms 擇一使用）
isTwitch=1     : 啟用 Twitch 通知（同上）
isKick=1       : 啟用 Kick 通知（同上）
isBark=1       : 啟用 Bark 通知
isSocket=1     : 啟用 Socket 通知
isBoth=1       : （已棄用，建議改用 platforms=tiktok,twitch）

Kick OAuth:
先至 https://id.kick.com/oauth/authorize 取得授權，
或直接訪問 /get-kick-token?code=xxx 手動設定 token

/get-kick-token
Kick OAuth callback endpoint (redirect URI)

Youtube OAuth:
先至 /youtube-auth 進行 Google 授權，
或直接訪問 /get-youtube-token?code=xxx 手動設定 token

/get-youtube-token
Youtube OAuth callback endpoint (redirect URI)

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
    else if (req.url === '/logViewer') {
        const filePath = path.join(__dirname, 'logFile.html');

        fs.readFile(filePath, 'utf8', (err, html) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Failed to load logFile.html');
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        });

    }

    else if (req.url.startsWith('/Clear_LOG') && req.method == "POST") {

         let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {

            const { file } = JSON.parse(body);
            console.log("收到清理請求:", file);

            try {
            // 這裡執行清空檔案的邏輯
            fs.writeFileSync(file, "");


            res.writeHead(200, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ status: "ok", cleared: file }));

            } catch (err) {
                console.log("清理錯誤",err)

                res.writeHead(500, {
                'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({ status: "error", cleared: file }));


            }

        })


            
    }
    else if (req.url.startsWith('/Get_LOG') && req.method == "GET") {


            // ✅ 新增：解析 query
        const url = new URL(req.url, `http://${req.headers.host}`)
    
        
        const log_File = url.searchParams.get('file') ?? 'Main_Log.log'

        pushLog("讀取文件",url,"File",log_File)

        const filePath = path.join(__dirname, log_File);

        fs.readFile(filePath, 'utf8', (err, html_text) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`加載失敗日誌文件 Load Error : ${log_File}`);
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(html_text);
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
