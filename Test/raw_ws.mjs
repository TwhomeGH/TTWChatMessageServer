// Test raw WebSocket connection to webcast-ws.tiktok.com
// Build the URL ourselves and try to connect
import WebSocket from 'ws';

const ROOM_ID = '7660050875841121045'; // eatpoopbro's room
const USERNAME = 'eatpoopbro';

// Build the WS URL manually matching the library's DEFAULT_WS_CLIENT_PARAMS
const params = {
    'version_code': '180800',
    'aid': '1988',
    'app_language': 'en',
    'app_name': 'tiktok_web',
    'browser_platform': 'MacIntel',
    'browser_language': 'en-DE',
    'browser_name': 'Mozilla',
    'browser_version': '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'browser_online': 'true',
    'cookie_enabled': 'true',
    'tz_name': 'Europe/Berlin',
    'device_platform': 'web',
    'identity': 'audience',
    'live_id': '12',
    'webcast_language': 'en',
    'room_id': ROOM_ID,
};

const append = '&version_code=270000';

// Try the simplest possible URL - maybe we don't need X-Bogus at all?
// Let's try WITHOUT X-Bogus first to see what happens
const baseUrl = 'wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/';

for (const testCase of ['no_xbogus', 'with_xbogus']) {
    const testParams = { ...params };
    if (testCase === 'with_xbogus') {
        testParams['X-Bogus'] = 'DFSzKIROmeJANGXjClLC9gy8Ls0Z';
        testParams['X-Gnarly'] = 'MPH/oAhT2w0gXBzKLy3YqW1u3LIeRceq8gkvQ7ibhGzxCgivypsXdXHSWjFXD/lAPXdys5biL8uGIwcy5fuQPWEwUvYaQlPFy85wZQv0Aaoqqw/EYMrERmSK5IPAOfzAZ/tLbcknn5u15Gca8Q4ld5m/Oepp8zdLf1W9gKyH3B-3TzJBOGZ3JS4SNXEYu0SPYNAbzlfQdLS6zAvJOHacD3ThlIaG/7RN0BwhO6PZLuKgVBinOrRBEUGuszfXJyP088wj-l-z24pS/By1yMFq79gN/Jf78TkXFy6qaeOqFRx4JwMrbdYoyyTgmLxYX76DVCvXi0wz8I==';
    }
    
    const qs = new URLSearchParams(testParams).toString() + append;
    const url = baseUrl + '?' + qs;
    
    console.log(`\n[CASE ${testCase}] Connecting to WS...`);
    console.log(`URL (first 200): ${url.substring(0, 200)}...`);
    
    try {
        const ws = new WebSocket(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Cookie': `sessionid=${process.env.SESSION_ID || ''}; tt-target-idc=alisg`,
            },
            handshakeTimeout: 10000,
        });
        
        await new Promise((resolve, reject) => {
            ws.on('open', () => {
                console.log(`[${testCase}] CONNECTED!`);
                ws.close();
                resolve();
            });
            ws.on('error', (err) => {
                console.log(`[${testCase}] Error: ${err.message}`);
                reject(err);
            });
            ws.on('unexpected-response', (req, res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    console.log(`[${testCase}] Unexpected response: HTTP ${res.statusCode}, body(${body.length}): ${body.substring(0, 300)}`);
                    resolve();
                });
            });
            setTimeout(() => { console.log(`[${testCase}] Timed out`); resolve(); }, 15000);
        });
    } catch(e) {
        console.log(`[${testCase}] Exception: ${e.message}`);
    }
}
