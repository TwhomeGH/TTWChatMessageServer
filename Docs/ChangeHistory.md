# ChangeHistory

## 2026.10.12 00:26 為 notify／socket／gift 模組補齊 JSDoc

**類型**: 文件 · **檔案**: `ScriptLib/gift/names.mjs`

### 問題 - 新模組只有檔首註解，函式缺參數說明

`ScriptLib/gift`／`notify`／`socket` 的函式多半只有單行或無註解，看不出參數與回傳值，與既有 `SocketTransport.mjs` 的風格不一致。

### 根因 - 模組搬移時只搬了程式，未同步文件

抽出模組時沿用原本（缺乏註解）的程式碼，未補上 API 文件。

### 修改 - 補齊 JSDoc（@param／@returns）

- `gift/names.mjs`：`createGiftNameStore` 的 `@typedef`（`GiftNameStoreDeps`／`GiftNameStore`）與每個內部函式的 `@param`／`@returns`。
- `notify/format.mjs`、`channels/bark.mjs`、`channels/ntfy.mjs`：函式與 `send` 的參數說明。
- `socket/endpoint.mjs`、`hub.mjs`、`dedup.mjs`：建構子、方法與 `normalizeFilter` 的參數／回傳說明。

---

## 2026.10.12 00:19 禮物名稱翻譯抽出 ScriptLib/gift 模組

**類型**: 重構 · **檔案**: `ScriptLib/gift/names.mjs`

### 問題 - 禮物名稱翻譯／快取散在 TikTok.js

`gift_map.json`／`gift_list.json` 的載入、翻譯、快取與目錄同步都寫在 TikTok.js（約 250 行），與其他平台事件混在一起。

### 根因 - 缺少禮物領域的模組邊界

這些函式只服務禮物名稱，卻和平台連線、聊天處理共用同一個檔案與作用域。

### 修改 - 抽出 ScriptLib/gift

- 新增 `ScriptLib/gift/names.mjs`（`createGiftNameStore(deps)`：檔案 I/O、翻譯 API、prefill 上限皆注入）。
- TikTok.js 改以 `giftNames.*` 呼叫，移除舊的載入／翻譯／快取函式（-182 行）。
- 新增 `Test/gift_names.test.mjs`（5 測試，假 fs／axios）並納入 `test:core`。

---

## 2026.10.12 00:03 socket 輸出層抽出 ScriptLib/socket 模組

**類型**: 重構 · **檔案**: `ScriptLib/socket/hub.mjs`

### 問題 - 傳輸／去重／扇出全塞在 TikTok.js

底層 `SocketTransport.mjs` 放在根目錄，而去重（`syncBuffer`／`addToSyncBuffer`／`isDuplicate`）與訊息組裝都寫在 TikTok.js。既無法單獨測試，之後要加「多個 socket 端點」也沒有落腳處。

### 根因 - 缺少 socket 輸出層的模組邊界

傳輸、去重、payload 組裝與平台事件處理交錯在同一檔，任何一個改動都得動入口。

### 修改 - 抽出 ScriptLib/socket（transport／dedup／endpoint／hub）

- `transport.mjs`：原根目錄 `SocketTransport.mjs` 移入（低階、行為不變）。
- `dedup.mjs`：`MessageDedup` 取代 `syncBuffer`／`addToSyncBuffer`／`isDuplicate`；TikTok.js 14 處呼叫點改走 `dedup.add`／`dedup.isDuplicate`。
- `endpoint.mjs`：`SocketEndpoint`（`parseSocketUrl` ＋ 依 `category` 決定是否接收，空 filter＝全收）。
- `hub.mjs`：`SocketHub`（`send` 依 category 扇出、`sendMessage` 去重＋`replaceEmojis`＋組 payload、`close` 逐一關閉、`primary` 供診斷）。
- TikTok.js 改以 `createHub(...)` 組裝；`sendSocketMessage`／`connectSocket`／`handleExit`／未捕捉例外診斷引用一律改指 `socketHub`。
- 新增 `Test/socket_hub.test.mjs`（6 測試）並納入 `test:core`；更新 `Test/socket_transport.test.mjs` 與 `Docs/SOCKET_TRANSPORT.md` 的 import／路徑。

---

## 2026.10.11 23:57 推播輸出層抽出 ScriptLib/notify 模組

**類型**: 重構 · **檔案**: `ScriptLib/notify/index.mjs`

### 問題 - 推播邏輯全塞在 TikTok.js

Bark／ntfy 通道、emoji 格式化與分派器都寫在 TikTok.js 內，無法單獨測試、也讓本已龐大的入口檔更腫。

### 根因 - 缺少「輸出層」模組邊界

推播是獨立的輸出職責，卻與平台事件處理交錯在同一檔；新增通道或改格式只能動 TikTok.js。

### 修改 - 抽成 ScriptLib/notify（class + DI）

- 新增 `ScriptLib/notify/format.mjs`（`stripEmojiUrls`／`pickEmojiIcon`／`stripEmojiCodes`／`buildNotification`）。
- 新增 `channels/bark.mjs`、`channels/ntfy.mjs`（`BarkChannel`／`NtfyChannel`，I/O 與 emoji getter 以 DI 注入）。
- 新增 `index.mjs`（`Notifier`／`createNotifier`）；分派器行為不變，仍是一次扇出。
- TikTok.js 只留組裝：`createNotifier(...)` 後 `notify(...)`；移除舊的格式化與通道函式（-103 行）。
- 新增 `Test/notify.test.mjs`（6 測試，假 axios）並納入 `test:core`。

**相關文件**: [ntfy 發送訊息](https://docs.ntfy.sh/publish/)

---

## 2026.10.11 23:48 新增 ntfy 推播通道並收斂為推播分派器

**類型**: 功能 · **檔案**: `TikTok.js`

### 問題 - 推播只有 Bark 一種，且散落各處

手機推播原本只有 Bark 一個通道，而每個事件點都各自直接呼叫 `sendBarkNotification(...)`（40 餘處）。要新增第二個推播通道，等於得在每一處都再補一次呼叫。

### 根因 - 缺少單一分派層，通道邏輯與事件處理綁死

沒有「送推播」的統一入口，通道實作與事件處理交錯，新增／移除通道的成本隨呼叫點數量成長。

### 修改 - 新增 ntfy 通道，改由 notify() 一次扇出

- 新增 ntfy 推播：讀 `NTFY_API`（形如 `https://ntfy.sh/<topic>`）；用 **JSON publish**（POST 到 server 根、`topic` 放 body）避免中文標題進 HTTP header 出錯；`icon` 僅在 JPEG／PNG 時帶上、`url` 對應 `click`。
- 原 `sendBarkNotification` 改名 `barkNotify`（Bark 專用），新增 `sendNtfyNotification`；新增分派器 `notify()` 一次扇出 Bark＋ntfy。
- 43 處呼叫點改走 `notify()`；`ScriptLib/youtube`、`ScriptLib/odysee` 的 DI 依賴 `bark` 更名為 `notify`。
- 開關：`/open?isNtfy=1` → `--ntfy`；`ScriptLib/runtime/options.cjs` 白名單與啟動頁功能列加入 ntfy（改為由 options 動態產生）。
- `/config` 與 `config.html` 新增 `NTFY_API` 欄位；`.env.example`、`Docs/envExample`、`Docs/RUNTIME.md`、`README.md` 補上說明。

**相關文件**: [ntfy 發送訊息](https://docs.ntfy.sh/publish/)

---

## 2026.10.11 23:26 修正 CI 觸發分支：master → main

**類型**: 修復 · **檔案**: `.github/ci.yaml`

### 問題 - 既有 CI 從未執行過

`.github/ci.yaml` 的 `on.pull_request.branches` 與 `on.push.branches` 都寫成 `master`，但本 repo 的預設分支是 `main`，因此所有 push 與 PR 都觸發不了這個 workflow，形同失效。

### 根因 - 觸發條件分支名寫死且與預設分支不符

workflow 以事件的分支白名單過濾，分支名一旦與實際不符即完全不符，GitHub 不會報錯、只是靜默不觸發。

### 修改 - 觸發分支改為 main

- `pull_request.branches` 與 `push.branches` 由 `master` 改為 `main`。

---

## 2026.10.11 23:24 補上變更歷史靜態站 CI，部署 GitHub Pages

**類型**: 功能 · **檔案**: `.github/workflows/pages.yml`

### 問題 - 只有本機 GUI，沒有可分享的唯讀版本

專案接上 changelogkit 後只有本機伺服器版：想看變更歷史與開發索引，都得在開發機終端跑 `changelogkit serve` 才打得開，沒有任何人打開連結就能看的版本。

### 根因 - 本機伺服器無法放上 GitHub Pages

changelogkit 本體是**本機 server**（要跑 `git`、處理 POST 編輯、即時查詢），而 GitHub Pages 只能放靜態檔；因此工具另提供 `changelogkit export`，把變更歷史與開發索引輸出成**唯讀靜態快照**（全相對路徑、可掛在 `/<repo>/` 子路徑），適合交給 CI 發佈。

### 修改 - 新增 pages workflow，用 changelogkit export 產生靜態站並部署

- 新增 `.github/workflows/pages.yml`：push 到 `main`（或手動觸發）時匯出靜態站並部署 GitHub Pages。
- checkout 用 `fetch-depth: 0`：開發索引要列 commits 與 diff，需要完整 git 歷史。
- `pip install changelogkit`（不鎖版本）後執行 `changelogkit export _site --branch main`。
- 以 `configure-pages` / `upload-pages-artifact` / `deploy-pages` 完成部署（權限 `pages: write`、`id-token: write`）。
- `.gitignore` 補上 `_site/`，避免本機匯出被誤提交。

**相關文件**: [ChangeLogKit GitHub Pages 匯出](https://github.com/TwhomeGH/ChangeLogKit/blob/main/Docs/pages.md)

---

## 2026.10.11 10:51 接入通用開發日誌紀錄工具

**類型**: 功能 · **檔案**: `Docs/ChangeHistory.md`

### 問題 - 變更歷史工具原本散在個別專案內

本工具最早只存在於 ReplyKIT 與 HaishinKitFixSwfit 兩個專案內。後來功能持續增加、也陸續拆出各種子功能，需要「變更歷史 + 程式改動查看」；兩份各自演進、逐漸不同步，其他專案要用也接不上。

### 根因 - 工具與專案耦合，難以跨專案重用

因為同時在開發多個專案，發現同一個工具其實每個 repo 都可能用到，但它把專案路徑、標題與品牌字樣寫死在程式裡，無法直接沿用；因此決定抽離成獨立套件，讓各專案以設定檔接入。

### 修改 - 抽離為通用套件 ChangeLogKit，並在本專案接入

- 工具抽離成獨立套件 **ChangeLogKit**（`changelogkit`），各專案差異改用 `.changelog.toml` 設定。
- 本專案接上：以 `Docs/ChangeHistory.md` 記錄變更歷史；開發索引可一併查看 `Docs/` 內的文件與近期改動。

**相關文件**:

- [ChangeLogKit 通用Repo開發日誌管理](https://github.com/TwhomeGH/ChangeLogKit)
- [ReplyKIT IOS直播推流端](https://github.com/TwhomeGH/ReplyKit)
- [HaishinKitFitSwift RTMP推流底層模塊](https://github.com/TwhomeGH/HaishinKitFixSwfit)

---
