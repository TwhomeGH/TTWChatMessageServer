// Disposable UI fixture; never starts the production server or reads saved messages.
import http from 'node:http';
import fs from 'node:fs';
const now = Date.now();
const rows = Array.from({ length: 32 }, (_, i) => ({ message: i === 0 ? '<img src=x onerror=alert(1)> 特殊字元測試' : `直播留言 ${i + 1}：這一段太精彩了！`, count: 40 - i,
    firstSeen: i === 1 ? null : now - 60000, lastSeen: i === 1 ? null : now - i * 1000,
    platforms: i===0?['Unknown']:['Twitch'], transports:['api','userscript'], recent: i === 1 ? [] : [{ key: String(i), receivedAt: now - i * 1000, sentAt: null, user: '測試觀眾', platform: i===0?'Unknown':'Twitch', transport:'userscript' }] }));
const server = http.createServer((req, res) => {
    if (req.url === '/status/keyword') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ type: 'all', data: rows })}\n\n`); return;
    }
    if (req.url === '/autoclip/data') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, config: { mode: 'shadow', platform: 'all', clipPlatform: 'Twitch' }, stats: [{ t: new Date().toISOString(), viewers: 10, msgRate: 12, baseMsgRate: 2, score: 4.8, triggered: true, status: 'shadow', mode: 'shadow', evidence: { sourcePlatform: 'TikTok', platforms: [{platform:'TikTok',transports:['api','userscript'],windowMsgs:6,uniqueUsers:3,msgRate:12,baseMsgRate:2,score:4.8,eligible:true,contribution:4.8},{platform:'Twitch',windowMsgs:0,uniqueUsers:0,msgRate:0,baseMsgRate:2,score:0.2,eligible:false,contribution:0}], total: 6, uniqueUsers: 3, minMessages: 6, minUsers: 3, threshold: 1.8, maxPerUser: 3, windowStart: now-30000, windowEnd: now, messages: [{ t: now-5000, name: '觀眾甲', platform: 'Twitch', timeSource: 'received', message: '剛剛那個操作太精彩了！' }, {t:now-4000,name:'觀眾乙',platform:'Twitch',timeSource:'received',message:'<img src=x> 哈哈哈！'}] }, reason: '影子模式：符合剪輯條件，未發送請求', totalClips: 0, shadowTriggers: 1, peakAt: now, triggeredAt: now }] })); return;
    }
    const file = req.url === '/autoclip' ? 'autoclip.html' : req.url === '/config' ? 'config.html' : 'keyword.html';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file, 'utf8').replaceAll('${AUTO_CLIP_MODE}', 'shadow'));
});
server.listen(18765, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:18765'));
