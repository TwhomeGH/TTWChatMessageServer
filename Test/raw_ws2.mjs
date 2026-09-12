// Test raw WebSocket with 'unexpected-response' listener to capture body
import WebSocket from 'ws';

const ROOM_ID = '7660050875841121045';
const XB = 'DFSzKIROmeJANGXjClLC9gy8Ls0Z';
const XG = 'MPH/oAhT2w0gXBzKLy3YqW1u3LIeRceq8gkvQ7ibhGzxCgivypsXdXHSWjFXD/lAPXdys5biL8uGIwcy5fuQPWEwUvYaQlPFy85wZQv0Aaoqqw/EYMrERmSK5IPAOfzAZ/tLbcknn5u15Gca8Q4ld5m/Oepp8zdLf1W9gKyH3B-3TzJBOGZ3JS4SNXEYu0SPYNAbzlfQdLS6zAvJOHacD3ThlIaG/7RN0BwhO6PZLuKgVBinOrRBEUGuszfXJyP088wj-l-z24pS/By1yMFq79gN/Jf78TkXFy6qaeOqFRx4JwMrbdYoyyTgmLxYX76DVCvXi0wz8I==';

const params = {
    'version_code': '270000',
    'aid': '1988',
    'app_language': 'en',
    'app_name': 'tiktok_web',
    'browser_platform': 'Win32',
    'browser_language': 'en-DE',
    'browser_name': 'Mozilla',
    'browser_version': '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'browser_online': 'true',
    'cookie_enabled': 'true',
    'tz_name': 'Europe/Berlin',
    'device_platform': 'web_pc',
    'identity': 'audience',
    'live_id': '12',
    'webcast_language': 'en',
    'room_id': ROOM_ID,
    'X-Bogus': XB,
    'X-Gnarly': XG,
};

// Try TWO different base URLs
for (const baseUrl of [
    'wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/',
    'wss://webcast-ws.tiktok.com/webcast/im/ws/',
]) {
    const qs = new URLSearchParams(params).toString();
    const url = baseUrl + '?' + qs;
    
    console.log(`\n[URL: ${baseUrl}]`);
    console.log(`Full URL (first 300): ${url.substring(0, 300)}`);
    
    const ws = new WebSocket(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
            'Cookie': `sessionid=${process.env.SESSION_ID || ''}; tt-target-idc=alisg`,
            'Origin': 'https://www.tiktok.com',
        },
        handshakeTimeout: 10000,
    });
    
    try {
        const result = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve('TIMEOUT'), 15000);
            ws.on('open', () => { clearTimeout(timer); resolve('CONNECTED'); });
            ws.on('error', (err) => { clearTimeout(timer); resolve('ERROR: ' + err.message); });
            ws.on('unexpected-response', (req, res) => {
                clearTimeout(timer);
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    resolve(`HTTP ${res.statusCode}: ${body.substring(0, 500)}`);
                });
            });
        });
        console.log(`Result: ${result}`);
    } catch(e) {
        console.log(`Exception: ${e.message}`);
    }
}
