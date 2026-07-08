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

### v2.1.0 (2026-07-08) — Hybrid: local im/fetch/ + CDP fallback

當前版本。雙層解析器：

```
fetchSignedWebSocketFromProvider(roomId)
  ├─ [主] local im/fetch/ + X-Bogus（由 directSign 產生）
  │    ├─ 成功 → 回傳 pushServer（正確區域端點）
  │    └─ 403 → CDP fallback（瀏覽器處理 X-Dynosaur）
  │
  └─ [備] signWebSocketForUser(username)
       ├─ Puppeteer 導航到 @使用者/live
       ├─ 瀏覽器自動產生 X-Dynosaur + 帶 Cookie
       ├─ 攔截 TikTok 頁面 JS 建立的 WebSocket URL
       └─ 回傳 pushServer + routeParams（含 access_key）
```

**特點：**
- CDP 只在 local 簽名失敗時才啟動，不影響正常連線速度
- `setupWebsocket` 無 override，全部使用 library 原生 WebSocket
- 當 TikTok 更新簽名演算法時，CDP 自動適應（瀏覽器處理一切）
- 本地 X-Bogus 簽名仍用於 room/info/ 等 HTTP API 請求

## 開發歷程

### 階段一：Euler Stream 依賴（原始問題）
tiktok-live-connector v2.4.0 依賴 `tiktok.eulerstream.com` 第三方付費簽名伺服器取得 WebSocket 端點。當 Euler Stream 回傳 500 時系統完全無法連線，且需要付費 API key。

### 階段二：X-Bogus 直接簽名
建立 `direct-signer.mjs`，注入 TikTok 官方 webmssdk 到 Puppeteer，在本機產生 X-Bogus。用於 HTTP API 簽名（room/info 等），成功繞過 Euler Stream。

### 階段三：CDP WebSocket Proxy（備用探索）
讓瀏覽器自己管理 WebSocket，Node.js 只做訊息轉發。後發現 TikTok 已將 WS 基礎設施從 `webcast-ws.tiktok.com` 遷移到 `im-ws-sg.tiktok.com/ws/v2` 改用 `access_key`，原生 library 不需簽名也能連部分區域，CDP proxy 降為備用。

### 階段四（當前）：Hybrid 雙層解析器
local X-Bogus 簽名為主，403 時自動啟動 CDP 捕捉瀏覽器產生的真實 WS URL（含 X-Dynosaur / access_key），兼顧速度與相容性。

## 改動記錄

### v2.1.0 (2026-07-08) — Hybrid: local X-Bogus + CDP fallback

- **雙層解析器**：`fetchSignedWebSocketFromProvider` 先試 local im/fetch/（X-Bogus），403 時自動啟動 CDP fallback (`signWebSocketForUser`)
- **CDP 僅當備用**：瀏覽器只在 local 簽名失敗才啟動，不影響正常連線速度
- **無 mock WS**：移除所有 mock WebSocket / EventEmitter，WS 連線全部使用 library 原生
- **X-Dynosaur 發現**：`im/fetch/` 403 原因是 TikTok 改用 `X-Dynosaur`（base64 簽章）取代 X-Bogus，僅瀏覽器執行環境可產生
- **簡化 import**：移除 `SIGN_SERVER_CONFIG`、`origSetupWebsocket`、CDP proxy 等無用程式碼

### v2.0.1 (2026-07-08) — im/fetch/ API 端點解析

- 移除 CDP proxy，改呼叫 TikTok `im/fetch/` API 取得區域 WS 端點
- 因 X-Dynosaur 缺失導致 403，後被 Hybrid 方案取代

### v2.0.0 (2026-07-08) — CDP WebSocket Proxy

- 導入 Puppeteer CDP 代理攔截直播頁 WS 並轉發訊息

### v1.2.0 (2026-07-07) — X-Bogus + X-Gnarly 雙簽名

- X-Bogus + X-Gnarly 簽名實作（tiktok-signature xgnarly.mjs）

### v1.1.0 (2026-07-07) — 本機直接簽名器

- 建立 `direct-signer.mjs`、`setupCustomSignServer()` 架構
