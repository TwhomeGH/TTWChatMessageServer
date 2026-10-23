# ChangeHistory

## 2026.10.23 14:30 釐清 browser 與 manual 聊天來源

**類型**: 文件／文案 · **檔案**: `config.html`、`Docs/BROWSER.md`、`Docs/YOUTUBE_BROWSER.md`

### 問題 - `browser` 被誤解成「自己開 Edge 掛 userscript」

TikTok 的 `browser` 其實是程式管理的專用 profile；YouTube 的 browser fallback 則是程式自己的 headless 瀏覽器＋內建 relay。兩者都不是日常 Edge，但原本文案沒有把 browser／manual 的界線寫清楚。

### 根因 - 同一個詞在不同平台代表不同托管方式，且沒有定義 manual

### 修改

- 設定頁 TikTok 選項與說明改為：「程式專用瀏覽器（不是日常 Edge）」；browser 仍要在該專用 profile 安裝 userscript。
- 明確標示 `manual` 是「自己用 Edge／Tampermonkey 掛腳本」，目前尚未提供；手動 Edge 與 browser 同時開會重複。
- BROWSER 文件新增 manual 列與 browser／manual 差異。
- YOUTUBE_BROWSER 文件標明 browser fallback 是程式 headless＋內建 relay，不需要 userscript。

### 驗證

`build:css`、`check:css`、`lint`、`test:ci` 全過；未改變實際來源選擇行為。

---

## 2026.10.23 14:10 設定／登入 UI 冒煙測試

**類型**: 測試 · **檔案**: `Test/config_login_ui.cjs`、`Docs/WEB_UI.md`、`Docs/TEST_FILES_REFERENCE.md`

### 問題 - 設定／登入只有臨時截圖，沒有可重複的 UI 驗證

深色重排後只用臨時預覽伺服器看過畫面；`output/playwright` 有截圖，但沒有測試會檢查安全閘門、欄位、響應式導覽、未儲存狀態或登入錯誤／成功。

### 根因 - 這兩個頁面不在既有 UI 冒煙測試清單內

### 修改

- 新增 `Test/config_login_ui.cjs`：本機靜態預覽、不啟動聊天服務。
- 驗證深色主題、安全確認閘門、23 個欄位、桌面側欄與手機分區導覽、390px 無水平溢出、sticky 儲存列高度、未儲存提示。
- 驗證登入錯誤訊息與成功後導向 `/config`。
- 輸出 `config-desktop.png`、`config-mobile.png`、`login-desktop.png` 到 `output/playwright`（展示用，不進 git）。
- 文件標明這是需要 Chrome／Edge 的手動 UI 測試，不在 `test:ci`。

### 驗證

`node Test/config_login_ui.cjs` 全過；`lint`、`test:ci` 全過。

---

## 2026.10.23 13:40 修正設定頁品牌標記對齊

**類型**: 介面 · **檔案**: `config.html`、`styles/app.css`

### 問題 - 側邊欄「TTW／控制台／設定」字沒有對齊

`config-brand span` 同時選到 `.config-brand-mark`，把 TTW 標記的 `inline-flex` 置中、顏色與字級覆蓋成一般說明文字；標記與右側文字看起來歪掉。

### 根因 - 過寬的後代選擇器影響到品牌標記本身

### 修改

- 右側文字加上 `.config-brand-copy`，選擇器只作用在複製區。
- TTW 標記固定 `inline-flex`、`flex: none`、`line-height: 1`，保持正方塊內置中。
- 複製區改為 `grid` 並統一兩行 `line-height`，與 38px 標記垂直對齊。

### 驗證

以 1280 寬度檢查 computed layout（標記與文字中心同為 y=53）與截圖；`build:css`、`check:css`、`lint`、`test:ci` 全過。

---

## 2026.10.23 13:10 設定與登入頁深色優先重排

**類型**: 介面 · **檔案**: `config.html`、`login.html`、`Update.html`、`styles/app.css`、`Docs/WEB_UI.md`

### 問題 - 設定／登入是亮色，其他營運頁是深色；設定頁仍是沒有導覽的長表單

設定頁與登入頁使用 `bg-gray-100`／`bg-white`，但 monitor、traffic、autoclip、audience 都是深色。設定頁雖然已置中，仍把通知、Kick、剪輯、TikTok、自動停止與 OAuth 串成一大張表單，沒有分區導覽與儲存回饋。

### 根因 - 各頁硬編碼顏色，沒有共用主題；設定頁沒有資訊架構

### 修改

- 設定頁改為深色分區卡片：連線與通知、Kick、Twitch 自動剪輯、TikTok、自動停止、平台授權。
- 桌面使用 sticky 側邊導覽，手機使用水平分區膠囊；捲動時同步目前區段。
- 剪輯進階門檻收進 `<details>`，常用欄位留在上層。
- 底部 sticky 儲存列顯示「尚未修改／有未儲存變更／儲存中」，離頁前提示未儲存。
- 登入頁改為深色卡片、表單 Enter 送出、`role="alert"` 錯誤與 autofocus。
- 更新完成頁改用同一組深色結果卡與主要／次要動作。
- 設定/登入使用頁面區域 CSS 變數；目前是深色優先，**沒有**淺／深切換。未來若要切換需全站 token 與 `data-theme`。
- 既有欄位 ID／name／placeholder 全部保留，Server 的 `/config` POST 不需改。

### 驗證

`npm run build:css`、`check:css`、`lint`、`test:ci` 全過；以本機靜態預覽檢查 1280 與 390 寬度、登入頁、未儲存狀態與分區導覽。

---

## 2026.10.23 12:10 TikTok 無簽名時的專用瀏覽器聊天來源

**類型**: 功能 · **檔案**: `ScriptLib/tiktok/source.cjs`、`ScriptLib/browser/controller.cjs`、`BrowserRoutes.cjs`、`Server.js`、`TikTok.js`、`config.html`、`Test/tiktok_source.test.cjs`、`Test/browser_session.test.mjs`、`Docs/BROWSER.md`

### 問題 - 沒有 EulerStream 時沒有原生 TikTok 聊天，使用者只能自己開 Edge 掛 userscript

原生 TikTok 需要簽名；沒有 `SIGN_API_KEY`／Cookie／Direct Signer 時連線失敗。手動再開一個瀏覽器掛 userscript 又可能和程式形成兩份來源。

### 根因 - 聊天來源只有 native，專用瀏覽器只負責簽名，沒有聊天模式

### 修改

- 新增 `TIKTOK_CHAT_SOURCE=auto|native|browser`：
  - `auto` 依簽名設定選擇；`browser` 強制專用瀏覽器；`native` 維持原本。
- 主服務在 TikTok browser 模式啟動時，透過既有專用瀏覽器控制器開啟或重用 `tiktok.com/@handle/live`；避免多個直播分頁。
- `TikTok.js` 在 browser 模式略過原生 TikTok 連線；userscript 的 `/chat` 訊息仍進入現有子程序、過濾、翻譯、AutoClip 與 socket。
- 設定頁新增來源選單，並提示 browser 模式要安裝一次 `TikTokChat.user.js`、不要另開 Edge。
- browser 模式停用 AutoStop（沒有可信的結束訊號），觀眾數不保證。

### 驗證

`Test/tiktok_source.test.cjs` 與 `Test/browser_session.test.mjs` 的 TikTok URL／來源選擇測試；`test:ci` 與 lint 全過。

---

## 2026.10.23 11:10 控制台登入 token 日誌、cookie 與持久化

**類型**: 修正／安全 · **檔案**: `Server.js`、`.env.example`

### 問題 - `/config` 日誌出現 `Cookie unde00000`，而且遮罩後仍洩漏大部分 token

未登入時 cookie 沒有 `authToken`，舊程式直接對 `undefined` 取 substring，得到 `unde00000`；有 token 時則保留前 59 個字元，只把最後 5 個換成 `00000`。`maskKey` 也有同樣問題。

另外登入 cookie 沒有 `HttpOnly`、`Path`、`Max-Age`；token 只在第一次驗證時才寫入 `server_tokens.json`，且每次驗證都重寫檔案。

### 根因 - 日誌直接格式化未定義值，遮罩邏輯保留過多原文；cookie 與 token 生命週期沒有對齊

### 修改

- 移除 `/config` 的 token 日誌；不再輸出 `unde00000` 或 token 原文。
- `maskKey` 改為只保留開頭／結尾各 4 個字元，其餘以 `…` 遮罩。
- 登入 cookie 加上 `HttpOnly; Path=/; SameSite=Strict; Max-Age=<token TTL>`；`/logout` 也補上 `Path=/`。
- token 建立時立即寫入 `server_tokens.json`；驗證成功不再每次寫檔，只有建立與過期清理時寫入。
- 新增 `CONTROL_TOKEN_TTL_SECONDS`（預設 14 天），token 與 cookie 有效期一致。

### 驗證

`node --check Server.js`、`npm run lint`、`npm run test:ci` 全過。舊的 session cookie 仍可沿用，重新登入後會換成 HttpOnly 版本。

---

## 2026.10.23 10:10 YouTube 零 API Key 的瀏覽器 discovery

**類型**: 功能 · **檔案**: `ScriptLib/youtube/browser.mjs`、`ScriptLib/youtube/chat.mjs`、`Test/youtube_browser_ui.mjs`、`.env.example`、`Docs/YOUTUBE_BROWSER.md`

### 問題 - 沒有 API Key 時仍會直接跳過 YouTube

原本 `startYoutubeChat()` 一開頭就要求 `YOUTUBE_API_KEY`；即使瀏覽器 fallback 已存在，沒有 API Key 也找不到 `videoId`，對不想建立 Google Cloud 專案的使用者沒有幫助。

### 根因 - 直播 discovery 綁在 API Key，而不是瀏覽器實際頁面

### 修改

- 移除啟動時的 API Key 硬性檢查；先取得認證：
  - 有 bearer → 原生 API。
  - 只有 API Key → API 找 `videoId` 後用瀏覽器。
  - 兩者都沒有 → 直接讓瀏覽器開頻道 `/live` 頁，等待轉址取得 `videoId`。
- `channelLiveUrl()` 支援 `@handle`、`UC...`、完整頻道 URL；`waitForVideoId()` 讀網址、canonical 與 `videoDetails`。
- 從實際觀看頁的 `videoDetails.channelId` 取得主播頻道 ID（不使用可能代表登入觀眾的 `ytcfg.CHANNEL_ID`）。
- 沒有 API Key 時不啟用觀眾數輪詢；觀眾數缺省，聊天、過濾、翻譯、AutoClip 訊息熱度與 socket 照常。
- 保留有 API Key／OAuth 的既有路徑與 viewer 更新。

### 驗證

`Test/youtube_browser_ui.mjs` 改為從本地 `/@handle/live` 轉址到 watch 頁，確認 discovery、聊天 iframe 與 relay；`test:ci` 與 lint 全過。

---

## 2026.10.23 09:10 無 OAuth 時用專用瀏覽器讀取 YouTube 實際觀看頁

**類型**: 功能 · **檔案**: `ScriptLib/youtube/browser.mjs`、`ScriptLib/browser/path.cjs`、`ScriptLib/youtube/chat.mjs`、`TikTok.js`、`Test/youtube_browser_ui.mjs`、`.env.example`、`Docs/YOUTUBE_BROWSER.md`

### 問題 - OAuth 失效後原生 YouTube 聊天室完全不能用

`liveChatMessages.list` 需要 OAuth；只有 API Key 會得到 403。使用者不一定會重新授權，且 API Key 的輪詢會被拒絕。

### 根因 - 把人流／剪輯資料來源綁在單一 OAuth API

沒有 OAuth 時缺少另一條可讀取聊天室的來源。

### 修改

- 新增專用瀏覽器 fallback：API Key 只解析目前 `videoId`，用 Chrome／Edge 的獨立 profile 開啟實際觀看頁 `watch?v=...`。
- 在 `/live_chat` iframe（找不到時在主頁）注入 relay；透過 Puppeteer binding 回傳訊息，避開 GM API 與 CORS。
- 瀏覽器訊息和原生 API 共用 `handleYoutubeText()`，走相同的過濾、翻譯、AutoClip、人流與 socket 管線；transport 記為 `browser`。
- 啟動時沒有 bearer，或原生輪詢 401／403，才啟用 fallback；404／410 不啟用。觀眾數仍由 API Key 更新。
- 專用 profile 放在 `data/youtube-browser-profile`（gitignore）；第一次登入／同意可用 `YOUTUBE_BROWSER_HEADLESS=0`，之後 headless。
- 可設定 `YOUTUBE_BROWSER_FALLBACK`、`YOUTUBE_BROWSER_PATH`、`YOUTUBE_BROWSER_HEADLESS`、`YOUTUBE_BROWSER_PROFILE`。
- `stopYoutubeChat()` 改為 async，關閉瀏覽器後才結束。

### 驗證

`Test/youtube_browser_ui.mjs` 以本地 watch 頁＋聊天 iframe 啟動 headless Chrome，確認既有與新增訊息都進入 relay；找不到瀏覽器時 skip。`test:ci` 全過。

---

## 2026.10.23 08:10 YouTube OAuth 失效的刷新與輪詢退避

**類型**: 修正 · **檔案**: `ScriptLib/youtube/tokens.cjs`、`ScriptLib/youtube/chat.mjs`、`Test/youtube_tokens.test.cjs`

### 問題 - invalid_grant 每 30 秒重試，API Key 輪詢聊天室 403 又每 10 秒重試

refresh token 失效後，`getYoutubeAuthParams()` 每次呼叫都重新嘗試刷新並印出「使用 API Key 認證」；`liveChatMessages.list` 用 API Key 得到 403 後，輪詢又以 10 秒間隔重試，造成日誌與請求量異常。

### 根因 - 沒有認證狀態快取／失敗冷卻，且把所有錯誤都當成可立即重試

永久性的 `invalid_grant` 與權限錯誤被當成暫態；API Key 也不能用於需要 OAuth 的 liveChatMessages。

### 修改

- token 模組快取認證方式與 API Key，只在切換時輸出一次；`invalid_grant` 冷卻 30 分鐘、其他刷新錯誤冷卻 1 分鐘，冷卻期間只回 API Key，不再打 token endpoint。
- 重新授權成功會清除冷卻與記憶體 token。
- `poll()` 在只有 API Key 時直接停止原生聊天室輪詢，不再送出必定 403 的請求；401／403／404／410 只記錄一次並停止。
- 其他暫態錯誤改用 10→20→40→60 秒指數退避，不再固定 10 秒；成功後重置。
- 無可用認證時停止輪詢，不無限重試。

### 驗證

新增 `Test/youtube_tokens.test.cjs`：refresh 只打一次、第二次直接 API Key、日誌各只出現一次；`test:ci` 全過。

---

## 2026.10.23 06:40 YouTube 轉接讀取 Studio 影片路徑

**類型**: 修正 · **檔案**: `UserScript/youtube-chat-userscript.user.js`、`Test/userscript_source.test.mjs`、`Docs/USERSCRIPT_SOURCES.md`

### 問題 - 按下啟用或「鎖定此聊天室」沒有反應

在 Studio 的 `/video/{id}/livestreaming` 或內嵌聊天 iframe 中，`currentVideoId()` 只讀 query `v=` 與 `top` 的 query；Studio 的影片 ID 在**路徑**裡，因此回傳空字串。`bindCurrentTarget()` 取得不到 ID 就默默取消 enabled，畫面看起來像按鈕沒反應。

### 根因 - 只支援 `?v=`，沒有解析 `/video/{id}`／`/live/{id}`，失敗也沒有提示

### 修改

- 新增 `videoIdFromUrl()`，支援 `?v=`／`?video_id=`、`/video/{id}/livestreaming`、`/live/{id}`；依序讀 iframe 自己、外層頁面、referrer，最後才用 `videoDetails`。
- 鎖定失敗時保留 enabled 關閉並顯示「讀不到影片 ID」的明確訊息，不再靜默。
- userscript 升至 1.7。

### 驗證

`userscript_source` 新增 popout、Studio 路徑與 `/live/` 的影片 ID 解析測試；15 項全過，`test:ci` 全過。

---

## 2026.10.23 06:10 YouTube 轉接鎖定目標聊天室與可拖移面板

**類型**: 修正 · **檔案**: `UserScript/youtube-chat-userscript.user.js`、`Test/userscript_source.test.mjs`、`Docs/USERSCRIPT_SOURCES.md`、`Docs/TRAFFIC.md`

### 問題 - 開啟轉接後，開到別的聊天室仍會用同一個主播送資料

`state.enabled` 是整個 origin 共用，`currentVideoId()` 只拿來顯示，`send()` 沒有比對目前聊天室；一旦啟用，導覽到另一個 `live_chat?v=...` 仍會轉送。面板固定在左下角，無法避開 YouTube 控制列。

### 根因 - 沒有目標影片綁定，面板位置也沒有持久化

轉接狀態只記 `enabled` 與主播，沒有 `targetVideoId`；`send()` 只檢查 enabled。面板 CSS 固定 `left/bottom`，沒有拖曳或位置儲存。

### 修改

- 啟用或按「鎖定此聊天室」時記錄目前 `v=`；`send()` 只在 `currentVideoId() === targetVideoId` 時送出，其他聊天室顯示暫停且不送。
- 同一個影片重新整理會自動恢復；換新影片需重新鎖定。可選「自動跟隨此頻道的新直播」，僅在頻道 ID 相同且 `ytcfg`／`videoDetails` 確認直播中時才更新目標。
- 舊版只有 enabled、沒有 target 的狀態會先停用，避免升級後直接送到錯的聊天室。
- 面板 pill 可拖移並記住位置；拖曳與點擊以位移門檻和時間抑制區分，行動版用 pointer events 與 `touch-action:none`；展開面板或視窗縮放時會夾回可視範圍。
- userscript 升至 1.6。

### 驗證

`userscript_source` 新增 `isTargetChat` 目標比對測試；`test:ci` 全過。

---

## 2026.10.23 05:10 YouTube 主播識別改用頻道 ID

**類型**: 修正 · **檔案**: `ScriptLib/traffic/identity.cjs`、`attribution.mjs`、`store.cjs`、`planner.cjs`、`TikTok.js`、`ScriptLib/youtube/chat.mjs`、`UserScript/youtube-chat-userscript.user.js`、測試與文件

### 問題 - 同一台 YouTube 用 @handle 和 UC 頻道 ID 會變成兩個主播

原生 YouTube 已經在 `resolveChannelId()` 取得真正的 `channelId`，但 `reportTraffic` 仍使用 `YOUTUBE_CHANNEL_ID`／`keyword` 的原始輸入；userscript 也把主播欄位一律轉小寫。YouTube 頻道 ID 大小寫敏感，handle 又可能改名，因此同一台可能被拆成不同主播，或和 userscript 場次對不上。

### 根因 - 所有平台共用同一套小寫正規化，且解析後的身分沒有回傳給 traffic

`normalizeBroadcaster` 只做 `trim`、去 `@`、`toLowerCase`，沒有平台概念；`startYoutubeChat` 解析出的 `channelId` 只用在 API 查詢，沒有交給人流歸屬。

### 修改

- 新增 `ScriptLib/traffic/identity.cjs`：YouTube `UC...` 保留大小寫；`@handle` 僅作 fallback 並轉小寫；其他平台維持原規則。
- `attribution.mjs`、`store.cjs`、`planner.cjs` 改用同一個正規化，並在可取得平台時傳入平台。
- `startYoutubeChat` 解析後透過 `onChannelIdentity` 回傳 `channelId`；`TikTok.js` 的人流事件改用解析後的 UC ID。
- YouTube userscript 升級到 1.5：欄位改為「YouTube 頻道 ID」，嘗試從 `ytcfg`／`videoDetails` 自動偵測，保留 UC 大小寫；抓不到時請使用者貼 UC ID。
- liveCenter／TikTok 仍使用 handle；文件與 `.env.example` 說明 YouTube 建議填 UC ID。

### 影響與限制

既有已寫入的 YouTube 主播若是小寫 handle 或小寫化 ID，無法可靠還原原始大小寫；不會自動合併。需要時用批次補分類填入 UC ID，讓後續場次使用同一個身分。

### 驗證

`traffic_attribution`、`traffic`、`traffic_planner`、`userscript_source` 共 78 項通過；`test:ci` 全過。

---

## 2026.10.23 04:20 AUTO_CLIP_MODE 設定與執行模式分開顯示

**類型**: 修正 · **檔案**: `Server.js`、`config.html`、`assets/autoclip.js`、`assets/autoclip.css`

### 問題 - 設定頁改成正式模式，自動剪輯頁仍顯示影子模式

`AUTO_CLIP_MODE` 在設定頁儲存後只更新 `.env` 與 Server 的 `process.env`；正在執行的子程序仍使用啟動時讀到的模式。若子程序已停止，`/autoclip/data` 又從舊的 `autoclip_stats.json` 讀取上次執行的 config，頁面因此一直顯示影子模式，看起來像設定沒有生效。

### 根因 - 徽章只反映上一次執行的 config，沒有和目前設定比較

頁面沒有拿到「目前儲存設定」，也沒有標示待套用狀態；設定頁對這個欄位也沒有明確的重啟提示。

### 修改

- `/autoclip/data` 新增 `configured.mode`／`configured.enabled`，直接反映目前 `.env`／`process.env`。
- 模式徽章顯示上次執行模式；若與目前設定不同，加上「（待套用）」並在 banner 顯示「目前執行…；設定…（重新啟動子程序後生效）」。
- 設定頁在 `AUTO_CLIP_MODE` 下方明確標示：變更需要停止後再啟動直播子程序，儲存不會中斷目前直播。
- 未改動模式套用邏輯：仍在子程序啟動時讀取，避免執行中變更造成不可預期的剪輯行為。

### 驗證

`test:ci` 全過；以 mock API 驗證設定為 live、上次執行 shadow 時顯示「正式剪輯模式（待套用）」。

---

## 2026.10.23 03:40 自動剪輯即時／歷史分離與模式提示

**類型**: 功能／修正 · **檔案**: `ScriptLib/autoclip/history.cjs`、`Server.js`、`autoclip.html`、`assets/autoclip.js`、`assets/autoclip.css`、`Test/autoclip_history.test.cjs`、`.gitignore`

### 問題 - 停止後頁面看起來像死掉、平台卡片空白，歷史只有 2.8 小時

子程序停止後 `/autoclip/data` 仍回傳最後一份快照，頁面沒有 stale 或「未運行」提示；平台卡片只讀最後一列，而最後幾列是 `platforms: []` 的 reset，造成卡片始終空白。歷史又只在子程序結束時寫入 JSON 並每次覆寫，2000 筆 × 5 秒只能留約 2.8 小時，沒有跨 session 紀錄；影子模式也沒有明顯提示，容易誤以為自動剪輯壞掉。

另外，首次出現觸發列時，`load()` 內的 `const timing = row.clip?.timing` 遮蔽了上方「最近觸發時間」區塊的 `timing`，導致 `timing.append` 讀到 undefined，整段載入失敗。

### 根因 - 即時快照與歷史共用記憶體，且沒有獨立的持久化

即時頁需要的是最近窗口；歷史頁需要的則是跨場次資料。原本兩者都依賴 `AutoClipManager.historyLimit` 的 2000 筆與 `/autoclip/data`，停止後就沒有新資料，也無法查詢舊場次。reset 列又被當成「目前平台狀態」，而不是「上次有效快照」。

### 修改 - SQLite 歷史、即時／歷史分頁、stale 與模式提示

- 新增 `ScriptLib/autoclip/history.cjs`：`data/autoclip.sqlite` 的 sessions／samples，以 `session + t` 去重；只寫新列與觸發更新，支援查詢、降採樣、30 天保留、清空與舊 `autoclip_stats.json` 匯入。
- Server 在收到 `AUTOCLIP_STATS` 時持續寫入歷史（不再只在結束時寫檔），子程序結束時標記 `endedAt`；新增 `/autoclip/sessions` 與 `/autoclip/history`。
- 頁面新增「即時／歷史」分頁：即時維持 5 秒輪詢；歷史有場次選單，查 SQLite 並可查看完整 session 與觸發，不再被 2.8 小時限制。
- 即時平台卡片在最後一列沒有平台資料時，退回最近有效的平台快照並標示時間；頂部新增「影子模式／正式剪輯模式」徽章與 runtime／stale banner（未運行、超過 30 秒未更新）。
- 修正觸發時間區塊的 `timing` 變數遮蔽；首次觸發不再讓整個載入失敗。
- 舊 `autoclip_stats.json` 首次啟動會匯入成 legacy session；`clip_history.json` 與正式剪輯歷史維持獨立。

### 驗證

`Test/autoclip_history.test.cjs`（去重、觸發更新、降採樣、legacy 匯入與 prune）；`test:ci` core（含新增歷史測試）＋startup 17＋CSS 全過。另以 mock API 實際載入頁面，確認即時平台卡片、stale banner、模式徽章與歷史場次切換。

---

## 2026.10.23 00:13 開播信心分級：exact／late／approx／estimated

**類型**: 功能 · **檔案**: `ScriptLib/traffic/database.cjs`、`assets/traffic-history.js`、`assets/traffic-planner.js`

### 問題 - 所有平台都被當成有精確開播時間，TikTok 與無開播時間的場次被排除

排名原本用同一個 30 分鐘窗口與 15 分鐘分桶，且沒有 `actualStarted` 就直接排除。Twitch 的 `startDate` 很明確，但 TikTok 通常較晚才連得上；Kick／Odysee／YouTube 不一定有精確開播時間。工具若在開播後才啟動，第一次觀測其實仍是有效的觀測開場，卻被當成 missing。

### 根因 - 只有單一開播時間與單一開場窗口

`rankings` 直接以 `actualStarted` 計算，`extendEarlyWindow` 只累積 30 分鐘，沒有開播信心或 45 分鐘容錯；UI 也沒有區分精確與輔助資料。

### 修改 - 四級信心、45 分鐘開場與 estimated

- session 新增 `lateArea`／`lateSpanMs`，同時累積 30 與 45 分鐘開場；沒有平台開播時間時，以第一次觀測作 estimated 起點。
- 信心分級：Twitch exact（30／20、15 分桶）、TikTok late（45／20、15 分桶）、Kick／Odysee／YouTube approx（45／20、30 分桶）、無平台時間但有 viewer sample 為 estimated（30／20、30 分桶）；沒有 viewer sample 才列 missing。
- ranking cells 新增 `confidence` 與 `startTypes`；歷史頁分成精確排名與「輔助時段」表，輔助資料不冒充精確排名。
- planner 分析表顯示開播信心；推薦與提醒可使用 assisted／estimated，但文案與時段表標示信心。approx／estimated 的累積提醒窗口使用 30 分鐘、exact／late 使用 15 分鐘，正點 fallback 不變。
- 測試：traffic 34、planner 26、i18n、歷史頁 assisted 案例、collecting UI、`test:ci`。

**相關文件**: [TRAFFIC.md](TRAFFIC.md)

---


## 2026.10.22 00:05 一週累積計畫、2/2 暫定觀察與計畫介面

**類型**: 功能 · **檔案**: `ScriptLib/traffic/planner.cjs`、`assets/traffic-planner.js`、`assets/traffic-history.js`

### 問題 - 累積目標只能逐時段加入，2 場時仍看不到任何數據

資料不足時只能一個時段一個時段加入；同一星期要湊滿 3 個日期往往要數週，2 場／2 日期又完全沒有可看的數字。多個 1/3 時段以大型卡片呈現，建立一週面板夾在日期之間，累積計畫與正式推薦混在一起。

### 根因 - 缺少跨星期建立、暫定資料與整點層級的版面

`addCollectingSlot` 只接受目前有資料的單一時段；排名只輸出 3/3 達標的時段；planner 以逐日卡片呈現，沒有把同一個整點的多個星期收斂成一張表。

### 修改 - 冷啟動跨星期目標、2/2 暫定表與整點表格

- `TrafficPlanner.addCollectingSeries` 從已知時段建立同一個整點的其他星期目標，允許尚無資料的 0/3 冷啟動；平台取整個整點觀測到的聯集，避免只建立種子那一個平台。
- `collectingAddSlot`、`collectingRemoveSlot` 與每週各日提醒沿用既有目標機制；達標、離開可開播設定或分類改變時自動停用。
- `traffic-history.js` 新增 2 場／2 日期的「暫定觀察（樣本不足）」表；正式排名仍要求 3 場／3 日期、至少 2 個時段達標。
- planner UI 改為每個整點一張表（星期、平台進度、下次提醒、操作）；「建立一週」面板移到整點底部，正式推薦加上「正式開播建議」分區。
- 已排程提醒顯示「今天／明天／後天／N 天後」徽章，以主服務 `now` 與提醒時區換算；空白徽章以 `:empty` 與文字檢查隱藏。
- 新增操作 toast、`capabilities.collectingSeries` 能力提示，舊後端不會靜默 400。
- 測試：planner 26、`traffic_planner_collecting_ui.cjs`（同整點多平台、建立週一／三／五、0/3、日期徽章）、`traffic_history_ui.cjs`（2/2 暫定表）、`test:ci`。

**相關文件**: [TRAFFIC.md](TRAFFIC.md)

---

## 2026.10.21 00:34 資料累積建議與分組每週提醒

**類型**: 功能 · **檔案**: `ScriptLib/traffic/planner.cjs`、`ScriptLib/traffic/plannerRoutes.cjs`、`assets/traffic-planner.js`

### 問題 - 資料不足時沒有下一步，同一個時段的平台被拆成兩個提醒

planner 只在至少 2 個時段達標後推薦；未達標時畫面只說等待，主播不知道要補哪個時段。Twitch／TikTok 同一時間各自一個提醒，加入時要按兩次。

### 根因 - 只有合格時段的排程，沒有部分時段的目標模型

`reconcile` 只讀 `qualified` cells；`traffic_reminders` 沒有累積類型，也沒有跨平台分組的目標表。

### 修改 - collecting 建議、目標表與每週提醒

- `TrafficPlanner.collecting` 依缺口、最近開播、開場平均排序自己的未達標時段；只取可開播星期／整點。
- 新增 `traffic_collecting_targets`；`traffic_reminders` 加 `kind`（舊資料預設 recommendation）。
- `collectingAdd`／`collectingAddSlot`／`collectingRemove`／`collectingRemoveSlot`；同一個時段的多平台合併成一組。
- 每週最多提醒一次，達標自動停用；正式推薦同時段優先，累積提醒不佔 `maxPerWeek`；通知標題為「資料累積提醒」。
- UI 顯示進度、最近開播、開場平均（僅供參考）與加入／移除；提醒關閉或管道未設定時只能查看。
- 測試：planner 25、collecting UI、`test:ci`。

**相關文件**: [TRAFFIC.md](TRAFFIC.md)

---

## 2026.10.20 23:59 15 分鐘開播容差與分散累積提示

**類型**: 功能 · **檔案**: `ScriptLib/traffic/database.cjs`、`assets/traffic-history.js`

### 問題 - 19:59 與 20:01 被拆成不同時段，分散開播只看到一堆 1/3

排名用嚴格整點分桶，差幾分鐘就落在不同星期×小時；多個 1/3 時段時，下一步卡只會挑兩個 arbitrary 時段。

### 根因 - 沒有開播容差，也沒有分散狀態

`rankings` 直接以 `actualStarted` 取 weekday/hour；UI 只依 partial 排序取前兩個。

### 修改 - 15 分鐘容差與分散提示

- `RANKING_START_GRACE_MS = 15 分鐘`：`actualStarted + 15 分鐘` 後取整點，19:45–20:44 都歸 20:00；19:44 仍屬 19:00。
- 時段標籤與計算說明同步；UI 不再用 `20:00–20:59` 造成邊界誤解。
- 多個 1/3（4 個以上、每桶 1 場）顯示「開播時間分散」，先引導固定 1–2 個時段。
- 測試：19:59／20:01 同桶、分散 UI、`test:ci`。

**相關文件**: [TRAFFIC.md](TRAFFIC.md)

---

## 2026.10.20 22:57 時段累積的下一步指引

**類型**: 功能 · **檔案**: `assets/traffic-history.js`、`assets/traffic.css`

### 問題 - 累積說明是一長串規則，主播不知道要再開幾場

歷史頁只列總數、排除原因與每個時段缺幾場，沒有把「下一步」放在最前面。

### 根因 - 規則與行動混在同一段文字

`renderRanking` 依序輸出 summary、criteria、reasons、progress，沒有先計算最接近達標的兩個時段。

### 修改 - 下一步卡與可摺疊規則

- 依缺口排序最接近的兩個時段，顯示「再開 N 場就能解鎖」、每週估算與「開在其他時段不會推進」提示。
- 只有 1 個時段達標時提示補第二個時段；沒有可用資料時提示先累積開場觀測。
- 規則、排除原因與完整進度收進「計算方式與排除原因」摺疊區。
- 新增 `traffic_history_ui.cjs` 與 i18n；`test:ci`。

**相關文件**: [TRAFFIC.md](TRAFFIC.md)

---

## 2026.10.20 22:57 可選的自動停止

**類型**: 功能 · **檔案**: `ScriptLib/lifecycle/autoStop.mjs`、`TikTok.js`、`Server.js`

### 問題 - TikTok 與 Twitch 都結束後程序仍掛著

直播結束後聊天子程序繼續存在，只能手動關閉。

### 根因 - 沒有跨平台的結束狀態與自動停止機制

TikTok `STREAM_END` 只取消重連；Twitch 離線只更新狀態，沒有整合判斷。

### 修改 - 可選的跨平台自動停止

- `AUTO_STOP_ENABLED`（預設 0）與 `AUTO_STOP_GRACE_SEC`（預設 60，10–600）可在 `/config` 或 `.env` 設定。
- TikTok `STREAM_END` 與 Twitch 離線／`onViewer(null)` 都確認後才倒數；任一平台恢復即取消。
- 啟動時尚未觀測到直播不停止；同時啟用 Kick／Odysee／YouTube 時停用（沒有可靠結束訊號）；`KICK_START` 也會停用。
- 停止走既有 `handleExit` 收尾；設定頁、文件與單元測試同步。

**相關文件**: [README.md](../README.md)、[envExample](envExample)

---

## 2026.10.20 22:57 修正混淆字元規則誤殺

**類型**: 修正 · **檔案**: `MessageFilter.js`

### 問題 - 裝飾用數學字母的觀眾加入被廣告規則阻擋

`any:廣告-混淆字元` 只要名稱含圈號或數學字母就阻擋，`☾soyeno 𝜗𝜚...` 的加入被誤殺。

### 根因 - 混淆字元規則沒有廣告訊號條件

規則對 `\u2460-\u24FF` 與 `\u{1D400}-\u{1D7FF}` 直接 block，未區分裝飾暱稱與廣告。

### 修改 - 混淆字元＋廣告訊號才阻擋

- 規則改為同時符合混淆字元與 `加LINE`／微信／Telegram／http／`瀨`／`濑` 等廣告訊號。
- 保留原本廣告帳號阻擋；新增裝飾名、`①`、裝飾訊息不阻擋的回歸測試。

**相關文件**: [MessageFilter.js](../MessageFilter.js)

---

## 2026.10.20 16:14 liveCenter 主播帳號正規化

**類型**: 修正 · **檔案**: `UserScript/liveCenter.user.js`

### 問題 - 輸入「 @handle 」時仍留下 `@`

舊流程先去 `@` 再 trim，開頭空白會讓 `@` 留著。

### 根因 - 正規化順序錯誤

### 修改 - 固定 trim → 去 `@` → trim → 小寫

- liveCenter 版本 1.16 → 1.17；後端 `store.record` 與 planner 也用相同順序。
- 新增 userscript 正規化測試（`@Handle`／` @Handle `／`Handle` 都收斂為 `handle`）。

**相關文件**: [TRAFFIC.md](TRAFFIC.md)

---

## 2026.10.20 13:35 UI 測試自動偵測 Chrome/Edge

**類型**: 測試 · **檔案**: `Test/browser_path.cjs`

### 問題 - UI 測試硬編碼 Edge 路徑，headless 啟動失敗只回 Code 0

### 根因 - 固定 x86 Edge 路徑，沒有瀏覽器偵測與明確錯誤

### 修改 - 共用 browserPath 與環境變數

- 依 `TRAFFIC_TEST_BROWSER`／`CHROME_PATH`，再找 Windows／macOS／Linux 的 Chrome、Edge、Chromium。
- audience／monitor／traffic planner UI 測試改用；找不到時給明確訊息。
- 文件同步。

**相關文件**: [AUDIENCE.md](AUDIENCE.md)

---

## 2026.10.20 04:35 常客活躍等級、分析頁與監控標記

**類型**: 功能 · **檔案**: `ScriptLib/audience/tracker.cjs`、`AudienceRoutes.cjs`

### 問題 - 監控看不到常客，也沒有專門的觀眾頁

### 根因 - 觀眾關係沒有獨立資料層，traffic 與 monitor 混在一起

### 修改 - audience 模組、/audience 與監控標記

- `data/audience.sqlite` 只存聚合；`user_key` 優先平台 userId，沒有才退回平台＋正規化名稱。
- 四種標記（送禮常客／每次都來／常打字／新朋友）在查詢時計算；0–100 分數與 L0–L4 由 tenure（first_seen）＋最近 30 天活躍分量即時算出，不存 XP。
- `/audience` 列表、搜尋、平台篩選、分數拆解與最近 10 場；monitor 名稱旁標記 chip、只看常客。
- 場次邊界向 traffic 讀取；每日 prune(180)；測試與 `AUDIENCE.md`。

**相關文件**: [AUDIENCE.md](AUDIENCE.md)

---

## 2026.10.19 23:11 主播歸屬、批次補分類與開播分析

**類型**: 功能 · **檔案**: `ScriptLib/traffic/attribution.mjs`、`ScriptLib/traffic/planner.cjs`

### 問題 - 新場次常缺主播、舊場次無法批次補分類，排名混入其他來源

### 根因 - 原生事件只有 TikTok／Twitch 帶 broadcaster；userscript 不帶身分；場次以平台＋主播切分；沒有批次補分類與 own 篩選

### 修改 - 五平台歸屬、分類契約、補分類與時段分析

- 五個原生平台都帶 `broadcasterId`；TikTokChat 自動從 `/@handle/live` 帶入；liveCenter／YouTube userscript 可選填，未填保持未分類。
- 用途契約 own／reference／test，「待分類」是 NULL 狀態；批次 assign 可清除；unknown 不再寫入。
- 批次補分類：篩選、預覽 50 場、勾選、expected 409、批次記錄與最近一批復原；只改 broadcaster／purpose。
- `traffic_identities` 原生偵測優先，其次 `.env`；表單可帶入。
- 排名優先 own，沒有 own 時回退全來源並標 scope；只有 1 個達標時段不排名。
- planner 帳號預設、時段分析、提醒與管理頁；UI 分類、補分類、分析卡。
- 測試、`TRAFFIC.md`。

**相關文件**: [TRAFFIC.md](TRAFFIC.md)

---

## 2026.10.19 23:10 notify 支援 ntfy 主題名稱與通知可用狀態

**類型**: 重構 · **檔案**: `ScriptLib/notify/targets.cjs`

### 問題 - ntfy 只能填完整網址，設定頁無法區分未設定與格式錯誤

### 根因 - ntfy 通道直接解析 URL，沒有共用 target 解析與可用狀態

### 修改 - 抽出 target 解析與狀態

- `NTFY_API` 可填 ntfy.sh 主題名稱（英數、底線、連字號）或完整 HTTP(S) 網址；`targets.cjs` 統一解析。
- ntfy 通道改用解析後 URL；`/config` 顯示設定狀態，不洩漏主題或密鑰。
- Bark 仍使用完整網址；通知可用狀態供 planner 顯示。

**相關文件**: [README.md](../README.md)

---

## 2026.10.15 06:35 WebUI 直播訊息監控面板（/monitor）

**類型**: 功能 · **檔案**: `Server.js`

### 問題 - 無法在網頁直接查看目前收到的訊息

過去要在看板看訊息，必須另開一個 socket 消費者；且沒有 socket 端點時完全看不到。

### 根因 - 子程序送出的訊息未回傳主服務、前端無對應頁面

子程序把訊息送往 socket 端點後即結束，主服務與前端都拿不到。

### 修改 - 子程序鏡像 + SSE + 監控頁

- 子程序：`SocketHub` 新增 `onSend` 鉤子；每送出一則 payload 由 `ScriptLib/socket/monitor-relay.mjs` 以 IPC（`type:'STREAM_MESSAGE'`）鏡像回父程序（具背壓上限）。
- payload 新增 `platform` 欄位；`sendSocketMessage` 改為 options 物件（`category`／`platform`），各平台以 `platformSenders(platform)` 綁定。
- 主服務：有界環形緩衝 `streamMessages`（500）＋ SSE `/status/stream/messages` ＋ 分類 API `/api/message-categories` ＋ 頁面路由 `/monitor`（別名 `/messages`）。
- 前端：`monitor.html` ＋ `assets/monitor.js`／`assets/monitor.css`（聊天室列、分類篩選、搜尋、自動捲動、清除、平台標示）；i18n `zh-TW`／`en`；`WebAssets.cjs` 白名單。
- 測試：`Test/monitor_relay.test.mjs`（3 測試）。

**相關文件**: [MODULES.md](MODULES.md)、[RUNTIME.md](RUNTIME.md)

---

## 2026.10.15 06:24 Socket 多端點（SOCKET_APIS）與訊息分類過濾

**類型**: 功能 · **檔案**: `ScriptLib/socket/hub.mjs`

### 問題 - socket 只能連一組、訊息無法分類

原本只能設定單一 `SOCKET_API`，無法同時送往多台（例如 PC 與 iPad）；且所有訊息不分類，無法只把部分類型分送到某個端點。

### 根因 - createHub 僅接受單一網址、payload 無 category

`createHub` 只建立一個端點；`StreamMessage` 沒有可辨識的分類欄位（僅 ad/audience 有）。

### 修改 - 多端點 + category 過濾

- `createHub` 支援 `SOCKET_API`（單一）＋ `SOCKET_APIS`（多筆，分號／換行分隔；未含 `?` 時逗號亦可分隔）；相同網址合併，端點可帶 `?filter=類別`（空＝全收）。
- 新增 `parseEndpointSpec`／`splitApis`（`ScriptLib/socket/hub.mjs`）。
- 新增 `ScriptLib/messages/categories.cjs` 統一分類清單（system／chat／member／follow／like／gift／share／emote／envelope／superfan／subscribe／clip／ad／audience／summary／heartbeat）。
- 所有 socket 送出點標上 category：TikTok 事件以 `sendCat`、Twitch／Kick／YouTube／Odysee 的 `sendChat／sendSystem／sendNotice` 包裝、剪輯 `clip`、`ad`／`audience`／頻率摘要。
- 設定：`Server.js` 的 `/config` 讀寫 `SOCKET_APIS`（換行 ↔ 分號）、`config.html` 新增欄位、`.env.example`／`Docs/envExample`／`Docs/RUNTIME.md`／`README.md` 更新。
- 測試：`Test/socket_hub.test.mjs` 新增多端點／過濾 4 測試。

**相關文件**: [MODULES.md](MODULES.md)

---

## 2026.10.15 06:13 修正 TikTok 直播結束事件註冊（ControlEvent.STREAM_END 未定義）

**類型**: 修正 · **檔案**: `ScriptLib/tiktok/events.mjs`

### 問題 - TikTok 直播結束事件從未觸發

`connection.on(ControlEvent.STREAM_END, ...)` 中的 `ControlEvent.STREAM_END` 未定義（該常數屬於 `WebcastEvent`），因此處理器被註冊在 `undefined` 事件名下、永遠不會被呼叫。

### 根因 - 用錯事件列舉

`ControlEvent` 只有 `CONNECTED／DISCONNECTED／ERROR／RAW_DATA／DECODED_DATA／WEBSOCKET_CONNECTED／WEBSOCKET_DATA／ENTER_ROOM`；`STREAM_END` 屬於 `WebcastEvent`。

### 修改 - 改註冊 WebcastEvent.STREAM_END

- 事件改以 `WebcastEvent.STREAM_END`（`'streamEnd'`）註冊。
- 直播結束／被平台中止時的推播、`writeLog`、`streamEnded` 標記與 `cancelReconnect` 現在才會真正執行。
- 於事件抽取模組化時一併修正（原缺陷已存在於 TikTok.js）。

---

## 2026.10.15 06:13 TikTok 原生事件抽出 ScriptLib/tiktok/events.mjs

**類型**: 重構 · **檔案**: `ScriptLib/tiktok/events.mjs`

### 問題 - TikTok 原生事件處理內嵌在 TikTok.js

DISCONNECTED／ERROR／CAPTION／ROOM_USER／MEMBER／FOLLOW／CHAT／SOCIAL／EMOTE／ROOM_MESSAGE／LIKE／GIFT／SHARE／ENVELOPE／SUPER_FAN／STREAM_END 等 16 個 `connection.on(...)` 處理器，連同 `likeUserCount`／`recordGift`／`flushMemberBark`／`getTikTokProfilePic` 與其狀態（約 577 行）全部寫在 TikTok.js。

### 根因 - 缺少事件模組邊界

每個處理器都需要推播、socket、過濾、統計、翻譯、贊助、剪輯、去重等副作用，但卻散落且直接引用 TikTok.js 全域。

### 修改 - 抽出 events.mjs（registrar + deps 注入）

- `registerTikTokEvents(connection, deps)` 註冊所有事件；狀態（加入合併、點讚累加、送禮累加、重播統計）收進模組閉包。
- 副作用與跨平台存取（`notify`／`sendSocketMessage`／`logRawEvent`／`writeLog`／`dedup`／`sentCache`／`processFilter`／`reportFiltered`／`reportTraffic`／`replaceEmojis`／`recordChatHeat`／`chatMetadata`／`translate`／`tikTokChatGuard`／`giftNames`／快取 getter-setter／`autoClip`／`sendAudienceUpdate`／`isEnd`／`streamEnded`／重連控制）皆由 deps 注入。
- `getTikTokProfilePic` 一併移入並匯出。TikTok.js 移除約 577 行（現 1077 行）。
- 新增 `Test/tiktok_events.test.mjs`（7 測試，假 connection + 記錄型 deps）。
- 附帶修正 `STREAM_END` 註冊錯誤（見上一筆）。

**相關文件**: [MODULES.md](MODULES.md)

---

## 2026.10.15 01:35 TikTok 連線生命週期抽出 ScriptLib/tiktok/connection.mjs

**類型**: 重構 · **檔案**: `ScriptLib/tiktok/connection.mjs`

### 問題 - 連線生命週期與狀態內嵌在 TikTok.js

`viewCache`／`onTikTokConnected`／`scheduleTikTokReconnect` 以及 `roomId`、重連次數、計時器、連續失敗次數等狀態全散在 TikTok.js，難以測試。

### 根因 - 缺少連線模組邊界

連線後的初始化、觀眾數輪詢與自動重連是同一組職責，卻與事件處理混在一起。

### 修改 - 抽出 connection.mjs（狀態封裝 + deps 注入）

- `createTikTokConnectionManager(deps)` 回傳 `{ onConnected, scheduleReconnect, cancelReconnect, stopViewCache, stop }`；`roomId`／重連次數／計時器等狀態收進實例。
- 與全域互動（觀眾數、快取）與副作用（`notify`／`sendSystem`／`reportTraffic`／`adScheduler`／`handleExit`／`isEnd`／`streamEnded`）以 deps／getter 注入。
- TikTok.js 改以 `tiktokConn.*` 呼叫；移除約 80 行與 4 個狀態宣告（現 1309 行）。
- 新增 `Test/tiktok_connection.test.mjs`（5 測試，mock timers）。

**相關文件**: [MODULES.md](MODULES.md)

## 2026.10.15 01:27 TikTok 簽名設定／開播時間／原始日誌抽出 ScriptLib/tiktok

**類型**: 重構 · **檔案**: `ScriptLib/tiktok/signing.mjs`

### 問題 - TikTok 連線細節內嵌在 TikTok.js

簽名設定（EulerStream／直連）、開播時間解析與探測、原始事件摘要日誌都寫在 TikTok.js，夾在平台事件處理之間。

### 根因 - 缺少 TikTok 模組邊界

這些是獨立、可測的小職責，卻與 900 行的原生事件區塊混在一起。

### 修改 - 先抽出三個獨立小模組（第一步）

- `ScriptLib/tiktok/signing.mjs`：`buildConnectionOptions(env, logger)` 回傳 `{ connOpts, mode }`。
- `ScriptLib/tiktok/viewers.mjs`：`roomStartTime(roomInfo)` 與 `createStartTimeProbe(logger)`。
- `ScriptLib/tiktok/rawLog.mjs`：`logRawEvent(eventName, data, logger)`。
- TikTok.js 改 import 取用（−114 行，現 1367 行）；新增 `Test/tiktok_helpers.test.mjs`（4 測試）。
- 後續再把連線生命週期（connect／viewCache／reconnect）與原生事件處理抽成更大的模組。

**相關文件**: [MODULES.md](MODULES.md)

## 2026.10.15 01:21 Kick 聊天抽出 ScriptLib/kick/chat.mjs

**類型**: 重構 · **檔案**: `ScriptLib/kick/chat.mjs`

### 問題 - Kick 聊天內嵌在 TikTok.js

`startKickChat`（連同 `resolveKickChannelId`、`getKickUserAvatar`、`kickAvatarCache`）全寫在 TikTok.js，直接使用 `kickTokens`、`KickWebSocket` 與全域變數。

### 根因 - 缺少 Kick 模組邊界

Kick 是獨立平台，卻與其他平台邏輯混在一檔。

### 修改 - 抽出 Kick chat.mjs（deps 注入）

- 匯出 `startKickChat(deps)`：推播、socket、過濾、統計、翻譯、日誌全由 `KickChatDeps` 注入；OAuth token 由同目錄 `tokens.cjs` 取得；socket 以 `createSocket` 可注入（測試用）。
- TikTok.js 組 `kickDeps` 並改呼 `startKickChat(kickDeps)`；移除 Kick 區塊（−213 行，現 1481 行）與 `kickTokens`／`KickWebSocket` import。
- 新增 `Test/kick_chat.test.mjs`（5 測試，假 socket／deps）。

**相關文件**: [MODULES.md](MODULES.md)

## 2026.10.15 01:18 Twitch 聊天與 G#Ad 抽出 ScriptLib/twitch/chat.mjs

**類型**: 重構 · **檔案**: `ScriptLib/twitch/chat.mjs`

### 問題 - onTwitchChat 與 G#Ad 內嵌在 TikTok.js

一般聊天、G#Ad 贊助廣告指令與 G#clip 剪輯指令全都塞在 `onTwitchChat`（含巢狀 `handleGAd`，約 278 行），直接引用 `apiClient`／`tuser`／`sponsorStore`／`adScheduler`／`clipService` 等，難以單獨測試。

### 根因 - 缺少聊天模組邊界

聊天處理與其他平台邏輯混在一檔，副作用硬編碼。

### 修改 - 抽出 Twitch chat.mjs（deps 注入）

- 匯出 `onChat(event, deps)`；`handleGAd` 收為模組內部函式。所有副作用（推播、socket、過濾、統計、翻譯、贊助資料、剪輯、日誌）由 `TwitchChatDeps` 注入，`apiClient`／`tuser` 以 getter 取值。
- TikTok.js 組 `twitchChatDeps` 並接上 `onChat`，移除 `onTwitchChat`（−278 行，現 1639 行）。
- 新增 `Test/twitch_chat.test.mjs`（6 測試，假 deps）——因 test:core 已改 glob，自動納入。

**相關文件**: [MODULES.md](MODULES.md)

## 2026.10.15 01:11 核心測試改用 glob 自動探索，啟動測試移入 Test/startup/

**類型**: 重構 · **檔案**: `package.json`

### 問題 - test:core 手寫一長串測試清單，容易漏加

`test:core` 把每個測試檔逐一列出，新增測試常忘記補進清單（例如本次新增 `twitch_clip.test.mjs` 就漏了），CI 與本機因此可能少跑測試。

### 根因 - 清單靠人工維護

沒有自動探索機制，只要有人新增檔案就得記得同步 `package.json` 與文件。

### 修改 - 改用 glob，並以目錄區隔啟動測試

- `test:core` 改為 `node --test --test-concurrency=1 "Test/*.test.cjs" "Test/*.test.mjs"`，符合命名的新測試自動納入（每個檔案仍在獨立行程執行）。
- 啟動／CSS 建置測試（`start.test.cjs`、`css_build.test.cjs`）移入 `Test/startup/`，不匹配核心 glob；`test:startup` 改指新路徑，CI 步驟不變。
- 移動後修正兩檔的相對路徑（`../` → `../../`）；`Test/README.md` 同步更新。
- 註：`node --test` 的 glob 不支援 `!` 排除（實測無效），因此以子目錄而非排除樣式區隔。

**相關文件**: [測試維護指南](../Test/README.md)

## 2026.10.15 01:10 Twitch 剪輯抽出 ScriptLib/twitch/clip.mjs

**類型**: 重構 · **檔案**: `ScriptLib/twitch/clip.mjs`

### 問題 - 剪輯建立與歷史內嵌在 TikTok.js

建立剪輯、解析標題、時間量測與 `clip_history.json` 記錄都寫在 TikTok.js，直接引用 `apiClient`／`tuser`，無法單獨測試。

### 根因 - 缺少剪輯模組邊界

剪輯是獨立的 Twitch 功能，卻與事件、聊天處理混在同一檔。

### 修改 - 抽出 clip.mjs（getter 注入 live binding）

- `createClipService({ getApiClient, getTuser, fs, file, writeLog, notify, sendSocketMessage })`：`apiClient`／`tuser` 因啟動後才設定，改以 getter 於呼叫當下取值。
- TikTok.js 改以 `clipService.createClip(...)`（AutoClip 與 G#clip 兩處）；移除 `CLIP_HISTORY_FILE` 與 5 個函式（−158 行，現 1852 行）。
- 新增 `Test/twitch_clip.test.mjs`（5 測試，假 apiClient／fs）。

**相關文件**: [MODULES.md](MODULES.md)

## 2026.10.15 01:05 Twitch EventSub 事件抽出 ScriptLib/twitch/events.mjs

**類型**: 重構 · **檔案**: `ScriptLib/twitch/events.mjs`

### 問題 - Twitch 事件處理綁在 TikTok.js

觀眾數、錯誤、開台／關台、追蹤、小奇點等 EventSub 事件處理常式都寫在 TikTok.js，直接引用全域狀態（`TwitchViewerCount`、`CacheUserNum`、`autoClip`），難以單獨測試。

### 根因 - 缺少事件層模組，副作用硬編碼

事件處理與推播、socket、日誌、合併觀眾數等副作用緊耦合，無法脫離 TikTok.js 執行。

### 修改 - 抽出 events.mjs（deps 注入）

- 新增 `onViewer`／`onError`／`onStreamOnline`／`onStreamOffline`／`onFollow`／`onCheer`，副作用全由 `TwitchEventDeps` 注入。
- TikTok.js 在 `startTwitchClient` 前組 `twitchDeps`（`sendSystem`／`sendNotice` 封裝 `CacheUserNum/List`、`getAutoClip` 取 current、`setViewerCount`／`updateCombinedViewerCount`）。
- 移除 6 個內嵌事件函式（−77 行），TikTok.js 現 1985 行。
- 新增 `Test/twitch_events.test.mjs`（6 測試，假 deps）納入 `test:core`。

**相關文件**: [MODULES.md](MODULES.md)

## 2026.10.15 01:01 贊助廣告與已送快取抽出 ScriptLib/sponsor 模組

**類型**: 重構 · **檔案**: `ScriptLib/sponsor/store.mjs`

### 問題 - 贊助廣告與已送快取散落在 TikTok.js

贊助廣告的持久化、定時器與 `send_messages.json` 已送快取全寫在 TikTok.js 內，與聊天事件處理混在一起，難以定位與測試。

### 根因 - 缺少獨立模組邊界

這些都是可獨立於平台事件的職責，卻與 stdin 指令處理、Twitch G#Ad 交錯在同一檔。

### 修改 - 抽成 ScriptLib/sponsor

- `store.mjs`：`SponsorStore` 承接 `sponsor_ads.json` 載入（相容舊格式）、儲存與 `getOrCreate`；`state` 以單一物件維護，呼叫端持有參照即可就地修改。
- `scheduler.mjs`：`createAdScheduler` 承接排程／清除／恢復定時器，`deliver`／`notify` 由外部注入。
- `sent-cache.mjs`：`createSentCache` 承接 `send_messages.json` 的載入、TTL／上限清理與去重。
- TikTok.js 改以 `sponsorStore.*`／`adScheduler.*`／`sentCache.*` 呼叫（−約 190 行，現 2024 行）。
- 新增 `Test/sponsor.test.mjs`（7 測試，假 fs＋mock timers）納入 `test:core`。

**相關文件**: [MODULES.md](MODULES.md)

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
