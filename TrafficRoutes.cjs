const fs = require('node:fs');
const path = require('node:path');
const { TrafficStore } = require('./ScriptLib/traffic/store.cjs');
const { TrafficDatabase } = require('./ScriptLib/traffic/database.cjs');

const database = new TrafficDatabase(path.join(__dirname, 'data/traffic.sqlite'));
const traffic = new TrafficStore(Date.now, database);

// 啟動時清掉過期的原始事件（7 天），並定期再清一次；分鐘彙總等統計永久保留。
const pruned = database.prune();
if (pruned) console.log(`[Traffic] 已清理 ${pruned} 筆過期事件`);
const pruneTimer = setInterval(() => database.prune(), 6 * 3600000);
pruneTimer.unref();
let storageError = null;

// 包一層記錄：保存失敗時只提示訊息，不讓整個程序因磁碟問題中斷。
const recordEvent = traffic.record.bind(traffic);
traffic.record = raw => {
    try {
        const accepted = recordEvent(raw);
        storageError = null;
        return accepted;
    } catch (error) {
        storageError = '人流資料保存失敗，請檢查磁碟空間與檔案權限';
        console.error('[Traffic]', error.message);
        return false;
    }
};

// 每分鐘記錄一次「程式仍在觀察」。場次中斷時若期間有心跳，代表是斷流；
// 沒有心跳則代表程式離線，該段中斷的語意未知。
function startHeartbeat() {
    const beat = () => {
        try { traffic.heartbeat(); } catch { /* 心跳失敗不致命，忽略即可 */ }
    };
    beat();
    const timer = setInterval(beat, 60000);
    timer.unref();
    return timer;
}
startHeartbeat();

/** 人流觀察路由，與自動剪輯分離，不產生剪輯請求。 */
function serveTraffic(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!['/traffic', '/api/traffic', '/api/traffic/history', '/api/traffic/clear'].includes(url.pathname)) return false;

    res.setHeader('Cache-Control', 'no-store');

    // 清理統計：POST { platform, from, to, confirm }。沒有 confirm 只回預覽筆數，
    // 有 confirm 才真的刪除；用來清掉誤收的髒資料，不必整庫重來。
    if (url.pathname === '/api/traffic/clear') {
        if (req.method !== 'POST') {
            res.writeHead(405);
            res.end();
            return true;
        }
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 10000) req.destroy();
        });
        req.on('end', () => {
            try {
                const { platform = 'all', from, to, confirm } = JSON.parse(body || '{}');
                if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('時間範圍不正確');
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                if (!confirm) {
                    const timezone = url.searchParams.get('timezone') || 'Asia/Taipei';
                    new Intl.DateTimeFormat('en-US', { timeZone: timezone });   // 先驗證時區字串
                    res.end(JSON.stringify({
                        preview: true, from, to,
                        counts: database.countRange(platform, from, to),
                        detail: database.previewRange(platform, from, to, timezone)
                    }));
                    return;
                }
                const removed = database.deleteRange(platform, from, to);
                const memoryEvents = traffic.reload();
                console.log('[Traffic] 已清理統計', new Date(from).toISOString(), '~', new Date(to).toISOString(), removed);
                res.end(JSON.stringify({ removed, memoryEvents }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return true;
    }

    if (req.method !== 'GET') {
        res.writeHead(405);
        res.end();
        return true;
    }

    if (url.pathname === '/api/traffic/history') {
        try {
            const timezone = url.searchParams.get('timezone') || 'Asia/Taipei';
            new Intl.DateTimeFormat('en-US', { timeZone: timezone }); // 先驗證時區字串
            const platform = url.searchParams.get('platform');
            const days = Number(url.searchParams.get('days')) === 7 ? 7 : 30;
            const now = Date.now();
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({
                storageError,
                ...database.distribution(platform, days, now, timezone),
                rankings: database.rankings(platform, days, now, timezone),
                metrics: database.metrics(platform, days, now, timezone)
            }));
        } catch {
            res.writeHead(400);
            res.end('Invalid history request');
        }
        return true;
    }

    if (url.pathname === '/api/traffic') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(traffic.snapshot(
            url.searchParams.get('platform'),
            url.searchParams.get('range') || '30'
        )));
        return true;
    }

    fs.readFile(path.join(__dirname, 'traffic.html'), (error, html) => {
        res.writeHead(error ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(error ? 'Unable to load page' : html);
    });
    return true;
}

module.exports = { traffic, serveTraffic };
