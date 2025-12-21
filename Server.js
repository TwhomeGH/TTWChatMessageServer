const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url')

const fs = require('fs');
const path = require('path');


let tiktokProcess = null;
let logs = [];
const MAX_LOG_LINES = 200; // 最多保留 200 行

const sseClients = new Set();

function pushLog(line) {
    logs.push(line);
    if (logs.length > MAX_LOG_LINES) {
        logs.shift();
    }
    // 推送給所有 SSE client
    for (const client of sseClients) {
        client.write(`data: ${line}\n\n`);
    }

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

        // ✅ 新增：解析 query
        const url = new URL(req.url, `http://${req.headers.host}`)
        const user = url.searchParams.get('user') ?? ''

        var isTK = url.searchParams.get('isTK') === '1'
        var isTwitch = url.searchParams.get('isTwitch') === '1'

        const isBark = url.searchParams.get('isBark') === '1'
        const isSocket = url.searchParams.get('isSocket') === '1'
        const isBoth = url.searchParams.get('isBoth') === '1'

        console.log('Starting TikTok.js with user=', user, 'isTK=', isTK);
        console.log('isBark=', isBark, 'isSocket=', isSocket, 'isTwitch=', isTwitch);
        console.log('isBoth=', isBoth);


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
        console.log(consoleLog);
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

    // =======================
    // /close
    // =======================
    else if (req.url === '/close') {
        if (!tiktokProcess) {
            res.end('TikTok.js not running\n');
            return;
        }

        pushLog('[SYSTEM] Stopping TikTok.js');

        const proc = tiktokProcess;   // ✅ 保留引用
        tiktokProcess = null;         // ✅ 先標記為「不再接受新請求」

        // 1️⃣ 嘗試優雅關閉
        proc.kill('SIGTERM');

        // 2️⃣ 等真正退出
        proc.once('exit', (code, signal) => {
            pushLog(`[SYSTEM] TikTok.js exited code=${code} signal=${signal}`);
        });

        // 3️⃣ 保險：超時還不死就強制
        setTimeout(() => {
            if (!proc.killed) {
                pushLog('[SYSTEM] Force killing TikTok.js');
                proc.kill('SIGKILL');
            }
        }, 5000);

        res.end('TikTok.js stopping...\n');
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
    console.log('HTTP control server listening on port 3332');
});

process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);

function handleExit() {
    console.log("Exiting...");

    if (tiktokProcess) {
        tiktokProcess.kill('SIGTERM');
    }
    process.exit(0);


}