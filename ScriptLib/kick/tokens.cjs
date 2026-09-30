'use strict';

// Kick OAuth token 的生命週期：交換授權碼、讀取、儲存、刷新與取得有效 token。
// 以 CommonJS 撰寫，讓 Server.js（require，處理 OAuth callback）與
// TikTok.js（ESM default import，連線 Kick 聊天室時取用）共用同一份實作。
const fs = require('fs');
const path = require('path');

const TOKEN_URL = 'https://id.kick.com/oauth/token';
const REDIRECT_URI = 'http://localhost:3332/get-kick-token';

// 專案根目錄的 kick_tokens.json（此檔位於 ScriptLib/kick/）。
const kickTokenFile = path.resolve(__dirname, '..', '..', 'kick_tokens.json');

let cachedAccessToken = null;

function loadKickTokens() {
    try {
        if (fs.existsSync(kickTokenFile)) {
            return JSON.parse(fs.readFileSync(kickTokenFile, 'utf8'));
        }
    } catch (err) {
        console.error('⚠️ 讀取 kick_tokens.json 失敗:', err.message || err);
    }
    return null;
}

function saveKickTokens(tokens) {
    fs.writeFileSync(kickTokenFile, JSON.stringify(tokens, null, 2));
}

async function exchangeKickCode(code, verifier) {
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KICK_CLIENT_ID || '',
        client_secret: process.env.KICK_CLIENT_SECRET || '',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
    });
    const res = await fetch(TOKEN_URL, {
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
    const res = await fetch(TOKEN_URL, {
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

async function getValidKickToken() {
    if (cachedAccessToken) return cachedAccessToken;

    const tokens = loadKickTokens();
    if (!tokens?.access_token) return null;

    const expiresAt = (tokens.obtainmentTimestamp || 0) + (tokens.expires_in || 3600) * 1000;
    if (Date.now() >= expiresAt - 60000 && tokens.refresh_token) {
        try {
            const newTokens = await refreshKickToken(tokens.refresh_token);
            newTokens.obtainmentTimestamp = Date.now();
            saveKickTokens(newTokens);
            cachedAccessToken = newTokens.access_token;
            return cachedAccessToken;
        } catch (err) {
            console.error('⚠️ Kick token 刷新失敗:', err.message || err);
            return null;
        }
    }

    cachedAccessToken = tokens.access_token;
    return cachedAccessToken;
}

module.exports = { kickTokenFile, loadKickTokens, saveKickTokens, exchangeKickCode, refreshKickToken, getValidKickToken };
