# 自訂簽名伺服器 (Custom Sign Server)

## 問題背景

TikTok 的 Euler Stream 簽名伺服器 (`tiktok.eulerstream.com`) 自 2026 年中起持續回傳 HTTP 500，導致 `tiktok-live-connector` 無法取得 WebSocket 連線所需的 X-Bogus 簽名。

## 解決方案

以本機 TikTok SDK + Puppeteer 取代 Euler Stream，直接在本機產生 X-Bogus。

### 架構

```
TikTok.js
  └─ setupCustomSignServer()      ← SignServer/index.js 掛勾
       ├─ directSign(url)         ← SignServer/direct-signer.mjs (核心)
       │    ├─ Puppeteer headless 瀏覽器
       │    ├─ 注入 webmssdk_5.1.3.js (byted_acrawler)
       │    ├─ 注入 webmssdk_2.0.0.485.js (__sdkN + 版本表)
       │    ├─ 導航到 TikTok.com 讓 SDK 初始化
       │    └─ 調用 u995() 產生 X-Bogus
       ├─ RouteConfig.fetchWebcastSignatureFromProvider   ← 簽署 HTTP API 請求
       ├─ TikTokLiveConnection.setupWebsocket              ← 簽署 WebSocket URL
       └─ RouteConfig.fetchSignedWebSocketFromProvider     ← 繞過 Euler
```

### 改動檔案

| 檔案 | 說明 |
|------|------|
| `SignServer/direct-signer.mjs` | 核心簽名引擎。啟動 Puppeteer、注入 SDK、產生 X-Bogus |
| `SignServer/index.js` | tiktok-live-connector 掛勾。覆寫 3 個提供者方法 |
| `SignServer/config.js` | 設定（pushServer 等） |
| `TikTok.js` | 匯入 + 呼叫 `setupCustomSignServer()` + `await waitForSigner()` |

### 移除的依賴

- `tiktok-signature` HTTP server（不再需要啟動子行程）
- `Euler Stream`（不再需要外部簽名伺服器）

## 安裝與使用

### 0. 必要條件

- Node.js >= 18
- 原本已依賴的 `puppeteer` 套件（在 `node_modules` 中）
- 目錄 `node_modules/tiktok-signature/javascript/` 內需有 SDK 檔案：
  - `webmssdk_5.1.3.js`
  - `webmssdk_2.0.0.485.js`
  - `webmssdk_1.0.0.368.js`

### 1. 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `SESSION_ID` | — | TikTok 登入 session ID（必要） |
| `TT_TARGET_IDC` | `alisg` | TikTok IDC 區域 |
| `SIGN_PUSH_SERVER` | `wss://webcast-ws.tiktok.com/...` | WebSocket push server |

不再需要 `SIGN_API_KEY` 或 `SIGN_SERVICE_API`。

### 2. 初始化流程

```
npm start -- --tiktok
```

啟動後會依序：
1. 讀取 SDK 檔案
2. 啟動 Puppeteer headless 瀏覽器
3. 注入 SDK 到空白頁
4. 導航到 `tiktok.com/@zara`（初始化 SDK 版本表）
5. 重新載入頁面（穩定 session）
6. 檢查 `__sdkN.o[995]` 就緒
7. 開始 TikTok 連線

初始化約需 **15-25 秒**（瀏覽器啟動 + 頁面載入 + SDK 初始化）。

### 3. 運作方式

連線過程中，三個掛勾自動運作：

**A. HTTP API 請求簽名**
- 攔截所有對 `webcast.tiktok.com` 的請求
- URL 送去 `directSign()` 產生 X-Bogus
- X-Bogus 附加到 URL query string

**B. WebSocket URL 簽名**
- 攔截 `setupWebsocket()`
- 組合完整 WebSocket URL（含 DEFAULT_WS_CLIENT_PARAMS）
- URL 送去 `directSign()` 產生 X-Bogus
- X-Bogus 設入 `wsParams`

**C. 繞過 Euler Stream**
- `fetchSignedWebSocketFromProvider` 改為直接呼叫
  `webClient.getDeserializedObjectFromWebcastApi("im/fetch/", ...)`
- 不再依賴 `tiktok.eulerstream.com`

### 4. 除錯

啟動時加上 Node.js 除錯可看 SDK 狀態：

```
[DirectSigner] SDK status: {"hasAcrawler":true,"hasSdkN_O":true,"hasFrontierSign":true}
```

- `hasAcrawler`：`byted_acrawler` 已初始化
- `hasSdkN_O`：`__sdkN.o[995]`（X-Bogus 計算函數）已載入
- `hasFrontierSign`：備用簽名函數可用

如果 SDK 初始化失敗，檢查：
1. `tiktok-signature/javascript/` 內是否有 SDK 檔案
2. `www.tiktok.com` 是否可正常存取（CDN 封鎖會導致初始化失敗）
3. Puppeteer 是否能正常啟動 headless Chrome

### 5. 常見問題

**Q: 初始化很久 / 卡在 Navigating to TikTok profile page**
A: TikTok.com 可能暫時被封鎖（CDN 封鎖），等待 15-30 分鐘後重試。

**Q: X-Bogus 產生但 WebSocket 還是 HTTP 200**
A: 確認 SESSION_ID 未過期。若仍在連接到舊的 Euler Stream，檢查
`RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = true` 是否有設。

**Q: UserOfflineError**
A: 直播主未開台。正常行為。

## 打包檔案

本目錄包含完整插件封裝：

| 檔案 | 大小 | 說明 |
|------|------|------|
| `tiktok-signature_patched.zip` | ~25 MB | 完整的 tiktok-signature 套件（含 SDK 檔案） |
| `tiktok-live-connector_patched.zip` | ~112 KB | 完整的 tiktok-live-connector 套件 |

還原方式：將 zip 解壓縮覆蓋到專案的 `node_modules/` 對應目錄。

### 備份（重要檔案獨立備份）

| 檔案 | 說明 |
|------|------|
| `SignServer_index.js_backup.txt` | 掛勾程式 |
| `SignServer_direct-signer_backup.txt` | 簽名引擎 |
| `SignServer_config_backup.txt` | 設定檔 |
