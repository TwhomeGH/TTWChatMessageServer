# Patched Plugins 說明

本目錄存放第三方套件的修改版本（patch），用於支援 custom sign server。

---

## 認證方式總覽

| 方式 | 環境變數 | 是否需要此 patch | 說明 |
|------|---------|-----------------|------|
| **A — 完整 Cookie** | `TIKTOK_COOKIES` | ✅ 必要 | 透過 Puppeteer 注入完整 Cookie 到瀏覽器，使用 `direct-signer` 簽名 |
| **B — Session ID** | `SESSION_ID` + `TT_TARGET_IDC` | ✅ 必要 | 同為 direct-signer 路徑，只設 sessionid，相容舊版配置 |
| **C — EulerStream 原生** | `SIGN_API_KEY` | ❌ 不需要 | 走原始 EulerStream API，不啟動 Puppeteer，不需 Cookie |

---

## 各 patch 說明

### `tiktok-live-connector/` (v2.4.0)

**位置：** `node_modules/tiktok-live-connector/dist/lib-YL2P_UWg.js`

**變更內容（與 npm 原版比較）：**
- WebSocket 建構子加入 `unexpected-response` 事件 log，便於除錯 WS handshake 失敗
- 加入 `//#region` / `//#endregion` 註解標記，提升可讀性
- `onMessage` 內的事件分派邏輯抽出為獨立方法 `processDecodedData`

**不受影響的部分：**
- `SignConfig` → 仍讀取 `process.env.SIGN_API_KEY`
- `createEulerClient()` → 行為不變
- `RouteConfig` 預設值 → 全部指向 Euler 路由

**使用方式 A/B（有 Cookie）：**
由 `SignServer/index.js` 的 `setupCustomSignServer()` 覆蓋 `RouteConfig` 相關路由，改走 direct-signer。

**使用方式 C（無 Cookie）：**
`setupCustomSignServer()` 偵測不到 `TIKTOK_COOKIES` / `SESSION_ID` 時直接 return，不觸發任何 RouteConfig 覆蓋，保留原廠 EulerStream 行為。

---

### `tiktok-signature/` (v1.x)

此套件已退役，不再使用。目前簽名全數透過 `SignServer/direct-signer.mjs` 處理。
保留在此僅供歷史參考。

---

### `kick-wss/`

Kick WebSocket 連線輔助模組，非 TikTok 相關，不需額外設定。

---

## 如何驗證目前走哪條路

啟動時觀察 log：

```
[TikTok] Using direct signer (TIKTOK_COOKIES/SESSION_ID)
[SignServer] TIKTOK_COOKIES/SESSION_ID found — using direct signer.
```

或

```
[TikTok] Using EulerStream signer (SIGN_API_KEY)
[SignServer] No TIKTOK_COOKIES or SESSION_ID — using EulerStream (native signer).
```
