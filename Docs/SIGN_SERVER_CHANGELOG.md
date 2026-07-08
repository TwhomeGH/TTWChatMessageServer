# Sign Server 改動紀錄與使用說明

## 文件導覽

| 文件 | 適合誰 | 內容 |
|------|--------|------|
| 本文件 | 開發者/維護者 | 套件結構、修改流程、架構演進、CDP 設計說明 |
| `TEST_FILES_REFERENCE.md` | 測試者/除錯 | 開發測試腳本的用途與使用方式 |
| `apply-patches.mjs` | 所有人 | 一鍵同步修補到 node_modules |
| `zip-patches.mjs` | 維護者 | 從原始檔重新打包 ZIP |

## 修補套件目錄結構

```
Docs/
├── patched-plugins/           ← 原始檔（直接編輯）
│   ├── tiktok-signature/
│   │   ├── server.mjs         ← 簽名伺服器（繞過 Euler）
│   │   ├── xgnarly.mjs        ← X-Gnarly 演算法
│   │   ├── javascript/
│   │   │   ├── webmssdk_5.1.3.js
│   │   │   ├── webmssdk_2.0.0.485.js
│   │   │   └── webmssdk_1.0.0.368.js
│   │   └── package.json
│   ├── tiktok-live-connector/
│   │   ├── dist/
│   │   │   ├── lib-YL2P_UWg.js ← 主程式（繞過 Euler Stream）
│   │   │   ├── index.js
│   │   │   └── ...
│   │   └── package.json
│   └── kick-wss/               ← Kick WebSocket 函式庫
├── tiktok-signature_patched_v2.zip    ← 自動產生的 ZIP
├── tiktok-live-connector_patched_v2.zip
├── kick-wss_patched_v2.zip
├── apply-patches.mjs          ← 套用修補到 node_modules
├── zip-patches.mjs            ← 從 patched-plugins/ 重新打包 ZIP
└── SIGN_SERVER_CHANGELOG.md
```

## 使用流程

**編輯插件 → 同步 node_modules → 測試**

```bash
# 1. 編輯 patched-plugins/ 內的檔案（直接改）
# 2. 套用到 node_modules
node Docs/apply-patches.mjs
# 3. 重新打包 ZIP（選用）
node Docs/zip-patches.mjs
```

## 套用修補

### 方式一：自動腳本（推薦）

```bash
node Docs/apply-patches.mjs
```

### 方式二：手動複製特定檔案

```bash
# tiktok-live-connector
copy Docs\patched-plugins\tiktok-live-connector\dist\lib-YL2P_UWg.js node_modules\tiktok-live-connector\dist\

# 單一檔案
copy Docs\patched-plugins\tiktok-signature\server.mjs node_modules\tiktok-signature\
```

### 方式三：解壓縮完整套件

```bash
# 先備份原始套件
move node_modules\tiktok-signature node_modules\tiktok-signature.bak
move node_modules\tiktok-live-connector node_modules\tiktok-live-connector.bak

# 解壓修補版
powershell "Expand-Archive -Path Docs\tiktok-signature_patched_v2.zip -DestinationPath node_modules\tiktok-signature -Force"
powershell "Expand-Archive -Path Docs\tiktok-live-connector_patched_v2.zip -DestinationPath node_modules\tiktok-live-connector -Force"
```

## 還原原始版本

```bash
npm install tiktok-live-connector@latest
npm install tiktok-signature@latest
```

## 修改指引

1. 編輯 `Docs/patched-plugins/` 內的原始檔案
2. 執行 `node Docs/apply-patches.mjs` 同步到 `node_modules/`
3. 執行 `node Docs/zip-patches.mjs` 重新打包 ZIP（選用）
4. 重新啟動應用程式測試

## 架構演進

### 階段一：Euler Stream（原始）
tiktok-live-connector v2.4.0 依賴 `tiktok.eulerstream.com` 第三方付費簽名伺服器。當 Euler Stream 回傳 500 時無法連線，且需要付費 API key。

### 階段二：X-Bogus 直接簽名（current）
`SignServer/direct-signer.mjs` 使用 Puppeteer headless 瀏覽器注入 TikTok 官方 webmssdk，在本機產生 X-Bogus 簽名。用於 `im/fetch/` API 請求（room/info、聊天資料等），完全繞過 Euler Stream，零成本。

### 階段三：CDP WebSocket Proxy（explored → 備用方案）
透過 Chrome DevTools Protocol 讓瀏覽器處理 WebSocket 連線，Node.js 只做訊息轉發。後來發現 TikTok 近期已將 WebSocket 基礎設施從 `webcast-ws.tiktok.com` 遷移到 `im-ws-sg.tiktok.com/ws/v2`，改用 `access_key` 認證，原生 library 的 WS 連線不需簽名也能正常工作，CDP 方案因此降為備用。

## CDP 設計說明

> CDP = Chrome DevTools Protocol，Chrome/Chromium 提供的偵錯協定，可用來控制瀏覽器行為。

### 用途
當 TikTok WebSocket API 需要瀏覽器環境才能建立簽名連線時（例如 `access_key` 由 TikTok 頁面 JavaScript 動態產生），CDP 方案讓 **瀏覽器自己管理 WebSocket**，Node.js 只透過 Puppeteer API 讀取訊息：

```
Node.js (Event Emitter)  ←→  CDP (Puppeteer)  ←→  Headless Chrome
                                                       ↓
                                              TikTok 直播頁面 JS
                                                       ↓
                                              WebSocket (access_key)
```

### 實作方式
- `initLivePage(username)` — 導航到 `@使用者/live`，覆寫 `window.WebSocket` 建構子
- 攔截 `ws.onmessage` → 推入 `window.__wsMessageQueue`
- `pollLiveMessages()` — Node.js 每 50ms 從瀏覽器輪詢佇列
- `sendLiveMessage(data)` — 透過 CDP 注入到瀏覽器的 WebSocket

### 優點
- 完全不需要理解 TikTok 簽名演算法（access_key、X-Bogus 等），瀏覽器自動處理
- TikTok 每次改版都自動跟上，不需更新程式碼
- 瀏覽器管理 session、cookie、重連邏輯

### 缺點
- 需要一直掛一個 headless Chrome 瀏覽器（約 200MB 記憶體）
- 每 50ms polling 有輕微延遲（聊天訊息無感）
- 瀏覽器需要導航到直播頁面才能建立 WS，連線時間較長（~15-20s）

### 啟用時機
目前 CDP 方案為備用：當 `isLiveWsReady()` 回傳 `false` 時，直接使用 library 原生 WebSocket（大部分情況可用）。CDP 可做為 future fallback 保留。

## 改動記錄

### v2.0.1 (2026-07-08) — 改用 im/fetch/ API 取得正確 WS 端點

- **移除 CDP Proxy**：捨棄 Puppeteer 直播頁 WebSocket 代理（initLivePage / pollLiveMessages / sendLiveMessage）
- **新增 `fetchSignedWebSocketFromProvider` override**：直接呼叫 TikTok `im/fetch/` API（X-Bogus 簽名），取得正確的區域 WebSocket 端點（eu / sg / us）
- **簡化 `setupWebsocket`**：不再 override，直接使用 library 原生 WebSocket 連線
- **清除無關 import**：移除 EventEmitter、CDP 相關函數

### v2.0.0 (2026-07-08) — CDP WebSocket Proxy

- 導入 Puppeteer CDP 代理，攔截直播頁 WebSocket 並透過 CDP 轉發訊息
- 後因發現原生 library WS 可正常連線而降為備用方案

### v1.2.0 (2026-07-07) — X-Bogus + X-Gnarly 雙簽名

- X-Bogus + X-Gnarly 簽名實作

### v1.1.0 (2026-07-07) — 本機直接簽名器

- 建立 `direct-signer.mjs`：Puppeteer headless 瀏覽器 + injected TikTok SDK
- `setupCustomSignServer()` 架構確立
