# Sign Server 改動紀錄與使用說明

## 文件導覽

| 文件 | 適合誰 | 內容 |
|------|--------|------|
| 本文件 | 開發者/維護者 | 套件結構、修改流程、架構演進、CDP 設計說明 |
| `PATCHES.md` | 所有人 | 最小差異 patch 系統（patch 清單、套用/還原/產生方式） |
| `TEST_FILES_REFERENCE.md` | 測試者/除錯 | 開發測試腳本的用途與使用方式 |
| `dotenv-axios-native-replacements.md` | 所有人 | dotenv→`process.loadEnvFile`、axios→原生 `fetch` 的遷移狀態與差異說明 |
| `CODEQL_FIXES.md` | 開發者/維護者 | CodeQL 告警清單、修復方式、誤報/無法修項目的標記排除 |
| `apply-patches.mjs` | 所有人 | 依版本套用最小差異 patch 到 node_modules |
| `make-patches.mjs` | 維護者 | 從 node_modules 重新產生 patch |

## 修補套件目錄結構

```
Docs/
├── patches/                    ← 最小差異 patch（依版本命名）
│   ├── tiktok-live-connector/2.4.0.patch
│   └── kick-wss/1.0.5.patch
├── apply-patches.mjs           ← 套用 / 檢查 / 還原
├── make-patches.mjs            ← 重新產生 patch
├── patched-plugins/            ← [已棄用] 舊整檔複製來源（保留供歷史參考）
├── *_patched_v2.zip            ← [已棄用] 舊打包產物
└── zip-patches.mjs             ← [已棄用] 舊打包流程
```

## 使用流程

**編輯 node_modules → 產生 patch → 套用/驗證**

```bash
# 1. 編輯 node_modules/<套件>/ 內的檔案
# 2. 產生最小差異 patch
node Docs/make-patches.mjs
# 3. 驗證
node Docs/apply-patches.mjs --check
```

## 套用修補

```bash
node Docs/apply-patches.mjs            # 套用（已套用則略過）
node Docs/apply-patches.mjs --check    # 只檢查
node Docs/apply-patches.mjs --revert   # 還原為原廠
```

詳細說明與目前 patch 清單見 [`PATCHES.md`](./PATCHES.md)。

## 還原原始版本

```bash
node Docs/apply-patches.mjs --revert
# 或直接重裝
npm install tiktok-live-connector@latest
```

## 修改指引

1. 安裝對應版本：`npm install <套件>@<版本>`
2. 編輯 `node_modules/<套件>/` 內的檔案
3. `node Docs/make-patches.mjs` 產生/更新 patch
4. `node Docs/apply-patches.mjs --check` 驗證，再重新啟動應用程式測試

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
