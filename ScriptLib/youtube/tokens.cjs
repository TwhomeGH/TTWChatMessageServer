'use strict';

// Youtube OAuth token 的生命週期：授權碼交換、讀取、儲存、刷新與取得認證參數。
// 以 CommonJS 撰寫，讓 Server.js（require，處理 OAuth callback）與
// TikTok.js／ScriptLib/youtube/chat.mjs（ESM default import，輪詢聊天室時取用）共用。
const fs = require('fs');
const path = require('path');

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_URI = 'http://localhost:3332/get-youtube-token';

// 專案根目錄的 youtube_tokens.json（此檔位於 ScriptLib/youtube/）。
// YOUTUBE_TOKEN_FILE 僅供測試或隔離環境覆寫，正式環境不用設定。
const youtubeTokenFile = process.env.YOUTUBE_TOKEN_FILE
    ? path.resolve(process.env.YOUTUBE_TOKEN_FILE)
    : path.resolve(__dirname, '..', '..', 'youtube_tokens.json');

let youtubeAccessToken = null;
let refreshBlockedUntil = 0;
let refreshFailureKey = '';
let lastNotice = '';
let apiKeyCache = null;

function notice(message) {
    if (lastNotice === message) return;
    lastNotice = message;
    console.log(message);
}

function bearerAuth(source) {
    notice(`ℹ️ Youtube 使用 OAuth Bearer token（${source}）`);
    return { headers: { Authorization: `Bearer ${youtubeAccessToken}` }, params: {}, mode: 'bearer' };
}

/** 只在認證方式或 API Key 變更時輸出一次，避免每次輪詢都洗版。 */
function apiKeyAuth(apiKey) {
    if (!apiKey) {
        notice('❌ 未設定 YOUTUBE_API_KEY 且無有效 OAuth token');
        return null;
    }
    if (apiKeyCache?.key === apiKey) return apiKeyCache.auth;
    notice('ℹ️ Youtube 使用 API Key 認證（無 OAuth token）');
    apiKeyCache = {
        key: apiKey,
        auth: { headers: {}, params: { key: apiKey }, mode: 'apiKey' }
    };
    return apiKeyCache.auth;
}

function blockRefresh(ms, key, message) {
    refreshBlockedUntil = Date.now() + ms;
    if (refreshFailureKey === key) return;
    refreshFailureKey = key;
    console.error(message);
}

/**
 * 讀取 youtube_tokens.json。
 * @returns {Object|null} token 物件；檔案不存在或解析失敗時為 null。
 */
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

/**
 * 將 token 寫入 youtube_tokens.json。
 * @param {Object} tokens
 * @returns {void}
 */
function saveYoutubeTokens(tokens) {
    fs.writeFileSync(youtubeTokenFile, JSON.stringify(tokens, null, 2));
}

/**
 * 以 OAuth 授權碼交換 token（Server.js 的 /get-youtube-token callback 用）。
 * 成功時會附加 obtainmentTimestamp。
 * @param {string} code 授權碼
 * @returns {Promise<Object>} token 物件
 * @throws {Error} 交換失敗時
 */
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
    youtubeAccessToken = tokens.access_token || null;
    refreshBlockedUntil = 0;
    refreshFailureKey = '';
    lastNotice = '';
    apiKeyCache = null;
    return tokens;
}

/**
 * 取得 YouTube Data API 認證參數：優先使用 OAuth Bearer token（記憶體→檔案，過期則刷新），
 * 否則退回 API Key。
 * @param {string} [apiKey] YOUTUBE_API_KEY
 * @returns {Promise<{headers: Object, params: Object}|null>} 無任何可用認證時為 null
 */
async function getYoutubeAuthParams(apiKey) {
    if (youtubeAccessToken) return bearerAuth('記憶體');

    const tokens = loadYoutubeTokens();
    if (tokens?.access_token) {
        const expiresAt = (tokens.obtainmentTimestamp || 0) + (tokens.expires_in || 3600) * 1000;
        if (Date.now() < expiresAt - 60000) {
            youtubeAccessToken = tokens.access_token;
            return bearerAuth('檔案');
        }
        // 過期才嘗試刷新；invalid_grant 是永久性錯誤，不應每次輪詢都重試。
        if (tokens.refresh_token && Date.now() >= refreshBlockedUntil) {
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
                    refreshBlockedUntil = 0;
                    refreshFailureKey = '';
                    notice('ℹ️ Youtube OAuth token 已刷新');
                    return bearerAuth('記憶體');
                }
                const body = await res.text().catch(() => '');
                const invalidGrant = res.status === 400 && /invalid_grant/.test(body);
                blockRefresh(
                    invalidGrant ? 30 * 60 * 1000 : 60 * 1000,
                    `${res.status}:${body}`,
                    invalidGrant
                        ? '⚠️ Youtube OAuth refresh token 已失效（invalid_grant）；已停止自動刷新，請至設定頁重新授權 YouTube。'
                        : `⚠️ Youtube token 刷新失敗 (${res.status})：${body.slice(0, 200)}`
                );
            } catch (err) {
                blockRefresh(60 * 1000, `network:${err.message || err}`,
                    `⚠️ Youtube token 刷新失敗（網路）：${err.message || err}`);
            }
        }
    }

    return apiKeyAuth(apiKey);
}

module.exports = { youtubeTokenFile, loadYoutubeTokens, saveYoutubeTokens, exchangeYoutubeCode, getYoutubeAuthParams };
