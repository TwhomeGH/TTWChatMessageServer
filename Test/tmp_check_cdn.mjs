import https from 'https';

const url = 'https://www.tiktok.com/res/webmssdk/5.1.3/webmssdk.js';
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, (res) => {
    console.log('Status:', res.statusCode);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        if (res.statusCode === 200) {
            console.log('Length:', data.length);
            const hasFrontier = data.includes('frontierSign');
            const has995 = data.includes('995');
            console.log('Has frontierSign:', hasFrontier);
            console.log('Has 995:', has995);
        } else {
            console.log('Headers:', JSON.stringify(res.headers));
        }
    });
}).on('error', e => console.log('Error:', e.message));
