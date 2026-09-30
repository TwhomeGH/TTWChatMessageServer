'use strict';

// Youtube OAuth token 的生命週期：授權碼交換、讀取、儲存、刷新與取得認證參數。
// 以 CommonJS 撰寫，讓 Server.js（require，處理 OAuth callback）與
// TikTok.js／ScriptLib/youtube/chat.mjs（ESM default import，輪詢聊天室時取用）共用。
const fs = require('fs');
const path = require('path');

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_URI = 'http://localhost:3332/get-youtube-token';

// 專案根目錄的 youtube_tokens.json（此檔位於 ScriptLib/youtube/）。
const youtubeTokenFile = path.resolve(__dirname, '..', '..', 'youtube_tokens.json');

let youtubeAccessToken = null;

function loadYoutubeTokens() {
    try {
        if (fs.existsSync(youtubeTokenFile)) {
            return JSON.parse(fs.readFileSync(youtubeTokenFile, 'utf8'));
        }
    } catch (err) {
        console.error('⚠️ 讀取 youtube_tokens.json 失敗:', err.message || err);
    }
    return null;
}

function saveYoutubeTokens(tokens) {
    fs.writeFileSync(youtubeTokenFile, JSON.stringify(tokens, null, 2));
}

async function exchangeYoutubeCode(code) {
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.YOUTUBE_CLIENT_ID || '',
        client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
        redirect_uri: REDIRECT_URI,
        code,
    });
    const res = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });
    if (!res.ok) throw new Error(`Youtube token exchange failed: ${res.status} ${await res.text()}`);
    const tokens = await res.json();
    tokens.obtainmentTimestamp = Date.now();
    return tokens;
}

// 回傳 { headers, params } 供 YouTube Data API 使用；無 OAuth token 時退回 API Key。
async function getYoutubeAuthParams(apiKey) {
    if (youtubeAccessToken) {
        console.log('ℹ️ Youtube 使用 OAuth Bearer token（記憶體）');
        return { headers: { Authorization: `Bearer ${youtubeAccessToken}` }, params: {} };
    }

    const tokens = loadYoutubeTokens();
    if (tokens?.access_token) {
        const expiresAt = (tokens.obtainmentTimestamp || 0) + (tokens.expires_in || 3600) * 1000;
        if (Date.now() < expiresAt - 60000) {
            youtubeAccessToken = tokens.access_token;
            console.log('ℹ️ Youtube 使用 OAuth Bearer token（檔案）');
            return { headers: { Authorization: `Bearer ${youtubeAccessToken}` }, params: {} };
        }
        // token 過期，嘗試刷新
        if (tokens.refresh_token) {
            try {
                const params = new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: process.env.YOUTUBE_CLIENT_ID || '',
                    client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
                    refresh_token: tokens.refresh_token,
                });
                const res = await fetch(OAUTH_TOKEN_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params,
                });
                if (res.ok) {
                    const newTokens = await res.json();
                    newTokens.obtainmentTimestamp = Date.now();
                    saveYoutubeTokens(newTokens);
                    youtubeAccessToken = newTokens.access_token;
                    console.log('ℹ️ Youtube OAuth token 已刷新');
                    return { headers: { Authorization: `Bearer ${youtubeAccessToken}` }, params: {} };
                }
                console.error('⚠️ Youtube token 刷新失敗:', res.status, await res.text().catch(() => ''));
            } catch (err) {
                console.error('⚠️ Youtube token 刷新失敗:', err.message || err);
            }
        }
    }

    if (!apiKey) {
        console.error('❌ 未設定 YOUTUBE_API_KEY 且無有效 OAuth token');
        return null;
    }
    console.log('ℹ️ Youtube 使用 API Key 認證（無 OAuth token）');
    return { headers: {}, params: { key: apiKey } };
}

module.exports = { youtubeTokenFile, loadYoutubeTokens, saveYoutubeTokens, exchangeYoutubeCode, getYoutubeAuthParams };
