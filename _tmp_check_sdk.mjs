import axios from 'axios';

const res = await axios.get('https://www.tiktok.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 10000,
    maxRedirects: 5
});
const html = res.data;
const matches = [...html.matchAll(/webmssdk[^"'\s]+/g)];
console.log('SDK refs:', [...new Set(matches.map(m => m[0]))]);
const verMatches = [...html.matchAll(/\/webmssdk\/[\d.]+/g)];
console.log('Versioned:', [...new Set(verMatches.map(m => m[0]))].slice(0, 10));
