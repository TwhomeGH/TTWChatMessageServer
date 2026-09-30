// Twitch SDK 生命週期：OAuth token、AuthProvider、ApiClient、EventSub listener 與觀眾數輪詢。
// 事件一律透過 deps 的 callback 往外送；聊天內容、指令（G#Ad／G#clip）與剪輯邏輯由呼叫端負責。
// apiClient／tuser 以 ESM live binding 匯出，供呼叫端的剪輯與訂閱檢查使用。
//
// deps = {
//   userName,            // 要連線的 Twitch 頻道名稱
//   enabled,             // 是否啟用（EventSub 開始監聽與觀眾數輪詢）
//   writeLog(file, message, type),
//   onError(err),
//   onStreamOnline(event), onStreamOffline(event),
//   onFollow(event), onCheer(event), onChat(event),
//   onSocketDisconnect(),
//   onViewer(stream|null),
// }

import fs from 'fs';
import path from 'path';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';

const tokenPath = path.resolve('./tokens.json');
const REQUIRED_TWITCH_SCOPES = ['user:read:subscriptions'];

const emptyTokenTemplate = {
    accessToken: "",
    refreshToken: "",
    scope: [
        "bits:read",
        "channel:read:goals",
        "channel:read:redemptions",
        "channel:read:subscriptions",
        "chat:read",
        "clips:edit",
        "moderator:read:followers",
        "user:read:chat",
        "user:read:subscriptions"
    ],
    expiresIn: 0,
    obtainmentTimestamp: Date.now()
};

/** 目前的 Twitch ApiClient（ESM live binding，startTwitchClient 後生效）。 */
export let apiClient = null;
/** 目前頻道的 Twitch UserID（ESM live binding，startTwitchClient 後生效）。 */
export let tuser = null;

let clientId = null;
let clientSecret = null;
let authProvider = null;
let listener = null;
let viewerTimer = null;

/** 讀取 tokens.json；不存在時建立空範本。Twitch API 原始 snake_case 會轉成 camelCase。 */
async function loadTokens() {
    try {
        const data = await fs.readFile(tokenPath, 'utf-8');
        const raw = JSON.parse(data);
        if (raw.access_token && !raw.accessToken) {
            raw.accessToken = raw.access_token;
            raw.refreshToken = raw.refresh_token || raw.refreshToken;
            raw.expiresIn = raw.expires_in ?? raw.expiresIn;
            raw.obtainmentTimestamp = raw.obtainmentTimestamp || Date.now();
        }
        return raw;
    } catch (err) {
        if (err.code === 'ENOENT') {
            await fs.writeFile(tokenPath, JSON.stringify(emptyTokenTemplate, null, 4), 'utf-8');
            return emptyTokenTemplate;
        }
        throw err;
    }
}

/** 缺少必要 scope 時開啟瀏覽器授權頁，輪詢主服務取得 code 並交換 token。 */
async function ensureTwitchScopes(tokenData) {
    const missing = REQUIRED_TWITCH_SCOPES.filter(s => !tokenData.scope?.includes(s));
    if (missing.length === 0) {
        console.log('✅ Twitch OAuth scope 完整');
        return;
    }

    console.warn(`⚠️ Twitch token 缺少 scope:`, missing.join(', '));
    console.log(`📋 目前 scope: ${(tokenData.scope || []).join(', ')}`);
    console.log('需重新授權以取得完整權限。');

    const SERVER_PORT = process.env.TWITCH_REDIRECT_URI
        ? new URL(process.env.TWITCH_REDIRECT_URI).port || '3332'
        : '3332';
    const redirectUri = `http://localhost:${SERVER_PORT}/twitch-oauth-callback`;
    console.log(`ℹ️ 回調網址: ${redirectUri}`);

    const scopes = [...new Set([...(tokenData.scope || []), ...REQUIRED_TWITCH_SCOPES])].join(' ');
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}`;

    console.log(`🔗 正在瀏覽器中開啟 Twitch 授權頁面…`);
    try {
        const { execSync } = await import('child_process');
        execSync(`start "" "${authUrl}"`, { timeout: 5000 });
    } catch {
        console.log(`若瀏覽器未自動開啟，請手動訪問授權連結`);
    }

    let code = null;
    const pollUrl = `http://localhost:${SERVER_PORT}/twitch-oauth-poll`;
    const deadline = Date.now() + 120000;
    console.log(`⏳ 等待用戶授權中（最長 120 秒）...`);
    while (Date.now() < deadline) {
        try {
            const res = await fetch(pollUrl);
            if (res.ok) {
                const data = await res.json();
                if (data.code) {
                    code = data.code;
                    console.log(`✅ 收到授權碼，正在交換 token...`);
                    break;
                }
            }
        } catch {
            // Server.js not ready yet
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    if (!code) {
        console.error('❌ Twitch OAuth 逾時（2分鐘），請重啟程式再試');
        console.warn('💡 也可透過 Config 頁面手動重新授權: http://localhost:3332/config');
        return;
    }

    console.log(`🔄 正在交換 authorization code 為 access token...`);
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
        })
    });

    if (!tokenRes.ok) {
        const errText = await tokenRes.text().catch(() => '');
        console.error('❌ Token 交換失敗:', tokenRes.status, errText);
        return;
    }

    const newToken = await tokenRes.json();
    console.log(`📦 Token 回應: access_token=***${newToken.access_token?.slice(-6)}, expires_in=${newToken.expires_in}s, scope=${(newToken.scope || []).join(',')}`);

    const normalizedToken = {
        accessToken: newToken.access_token,
        refreshToken: newToken.refresh_token,
        expiresIn: newToken.expires_in,
        scope: newToken.scope || scopes.split(' '),
        obtainmentTimestamp: Date.now()
    };

    await fs.writeFile(tokenPath, JSON.stringify(normalizedToken, null, 4), 'utf-8');
    console.log('✅ tokens.json 已更新');

    console.log(`🔄 正在更新 authProvider...`);
    try {
        await authProvider.addUserForToken(normalizedToken);
        console.log('✅ Twitch OAuth 完成，Token 已生效');
    } catch (err) {
        console.error('❌ authProvider 更新失敗:', err.message);
    }
}

/** 取得使用者頭像網址。 */
export async function getUserIcon(id) {
    const user = await apiClient.users.getUserById(id);
    return user.profilePictureUrl;
}

async function pollViewer(deps) {
    try {
        const stream = await apiClient.streams.getStreamByUserId(tuser);
        deps.onViewer?.(stream ?? null);
    } catch (err) {
        console.error("⚠️ Twitch 觀眾數取得失敗:", err.message);
    }
}

function registerHandlers(deps) {
    listener.on("error", err => deps.onError?.(err));
    listener.onStreamOnline(tuser, async event => deps.onStreamOnline?.(event));
    listener.onStreamOffline(tuser, async event => deps.onStreamOffline?.(event));
    listener.onChannelFollow(tuser, tuser, async event => deps.onFollow?.(event));
    listener.onChannelCheer(tuser, tuser, async event => deps.onCheer?.(event));
    listener.onChannelChatMessage(tuser, tuser, async event => deps.onChat?.(event));
    listener.onUserSocketDisconnect?.(() => deps.onSocketDisconnect?.());
}

/**
 * 初始化 Twitch 連線並註冊 EventSub 事件，事件透過 deps callback 回呼。
 * apiClient／tuser 會以 live binding 更新。
 * @param {Object} deps 見檔首 deps 說明。
 * @returns {Promise<void>}
 */
export async function startTwitchClient(deps = {}) {
    const { userName, enabled = true, writeLog } = deps;
    clientId = process.env.CLIENT_ID;
    clientSecret = process.env.CLIENT_SECRET;

    const tokenData = await loadTokens();
    authProvider = new RefreshingAuthProvider({ clientId, clientSecret });
    authProvider.onRefresh(async (userId, newTokenData) => {
        await fs.writeFile(tokenPath, JSON.stringify(newTokenData, null, 4), 'utf-8');
    });
    await authProvider.addUserForToken(tokenData).catch(err => {
        console.warn('⚠️ Twitch token 無效，可透過 Config 頁面重新授權:', err.message);
    });
    if (enabled) await ensureTwitchScopes(tokenData);

    try {
        apiClient = new ApiClient({ authProvider });
        const user = await apiClient.users.getUserByName(userName);
        tuser = user.id;
        console.log("[Twitch] UserID", tuser);
        writeLog?.("Default", `取得 Twitch UserID: ${tuser}`, "System");

        listener = new EventSubWsListener({ apiClient, port: 0 });
        if (enabled) {
            console.log("啟用 Twitch 事件監聽");
            writeLog?.("Default", "啟用 Twitch 事件監聽", "System");
            listener.start();
        }
    } catch (err) {
        console.error('⚠️ Twitch 初始化失敗（token 無效或缺少權限），Twitch 功能已停用:', err.message);
        console.warn('💡 可透過 Config 頁面重新授權: http://localhost:3332/config');
        return;
    }

    registerHandlers(deps);

    if (enabled) {
        console.log("啟用 Twitch 觀眾數定時更新 (30秒)");
        pollViewer(deps);
        viewerTimer = setInterval(() => pollViewer(deps), 30000);
    }
}

/** 停止觀眾數輪詢與 EventSub listener。 */
export function stopTwitchClient() {
    if (viewerTimer) { clearInterval(viewerTimer); viewerTimer = null; }
    try {
        listener?.stop?.();
    } catch (err) {
        console.warn('Twitch listener 停止失敗:', err?.message || err);
    }
}
