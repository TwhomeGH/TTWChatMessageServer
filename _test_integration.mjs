import { initDirectSigner, directSign } from './SignServer/direct-signer.mjs';
import axios from 'axios';

const ready = await initDirectSigner();
if (!ready) {
    console.log('FAILED to init');
    process.exit(1);
}

// Test 1: Sign an im/fetch URL
const fetchUrl = 'https://webcast.tiktok.com/webcast/im/fetch/?room_id=7659729173387660052&cursor=0&aid=1988&app_language=en&browser_language=en&browser_name=Mozilla&browser_online=true&browser_platform=Win32&browser_version=5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F129.0.0.0%20Safari%2F537.36&cookie_enabled=true&platform=desktop&screen_width=1920&screen_height=1080&webcast_language=en';
const r1 = await directSign(fetchUrl);
console.log('Test 1 - im/fetch sign:', r1.xBogus ? 'OK' : 'FAIL', 'X-Bogus:', r1.xBogus?.substring(0,20));

// Test 2: Use signed URL to call TikTok API
if (r1.signedUrl) {
    try {
        const apiRes = await axios.get(r1.signedUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            }
        });
        console.log('Test 2 - API call status:', apiRes.status, 'data type:', typeof apiRes.data, apiRes.data?.status_code ?? '');
    } catch (e) {
        console.log('Test 2 - API call failed:', e.message);
        if (e.response) console.log('Response:', e.response.status, typeof e.response.data, Object.keys(e.response.data || {}).slice(0,10));
    }
}

// Test 3: Sign a WebSocket URL
const wsUrl = 'wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/?version_code=270000&aid=1988&app_language=en&browser_language=en&browser_name=Mozilla&browser_online=true&browser_platform=Win32&browser_version=5.0&cookie_enabled=true&platform=desktop&screen_width=1920&screen_height=1080&webcast_language=en&compress=gzip&room_id=7659729173387660052&cursor=0&internal_ext=&msToken=';
const r3 = await directSign(wsUrl);
console.log('Test 3 - WS sign:', r3.xBogus ? 'OK' : 'FAIL', 'X-Bogus:', r3.xBogus?.substring(0,20));

console.log('\nAll tests done');
process.exit(0);
