# ChangeHistory

## 2026.11.07 22:00 常客關係視覺與總頁數

**類型**: 改善 · **檔案**: `audience.html`、`assets/audience.js`、`assets/audience.css`、`lang/zh-TW.json`、`lang/en.json`、`Test/audience_ui.cjs`、`Docs/AUDIENCE.md`

### 問題

常客列表的關係欄只有同色文字，朋友與新朋友不易辨識；頁碼只顯示目前頁，缺少總頁數。

### 修改

- 觀眾欄加入 tenure 色碼 avatar 與名稱；關係欄改成「新朋友／朋友／老朋友／元老」色塊＋天數。
- 等級欄改成有色 badge＋分數；列首加上 tenure 色條。
- 新增關係圖例；新朋友關係已顯示時，標記欄不重複同一個 `newcomer` 標籤。
- 關係圖例可點擊多選篩選（新朋友／朋友／老朋友／元老），全部可清除；API 支援 `tenures`，總頁數依篩選結果計算。
- 頁碼改成「第 X / Y 頁」，測試補關係 badge、avatar、總頁數與新朋友篩選。

### 驗證

- `node Test/audience_ui.cjs`
- `npm run lint`、`npm run check:css`

---

## 2026.11.10 05:03 TikTok 訊息處理錯誤隔離

**類型**: 修正 · **檔案**: `ScriptLib/tiktok/events.mjs`、`Test/tiktok_events.test.mjs`

### 問題

`tiktok-live-connector` 的 `processProtoMessageFetchResult` 會接住事件 listener 的例外，再以 `ControlEvent.ERROR` 回報 `Failed to process decoded data`；原本只用 `JSON.stringify` 記錄，Error 的 message／stack 不可列舉，畫面只剩 `exception: {}`，且被誤標成連線錯誤。

### 修改

- 新增 `safeEvent`：同步 `try/catch` 與 async rejection 都記錄 event／message type／stack，單一 malformed 訊息不影響後續訊息。
- `ControlEvent.ERROR` 區分 `Failed to process decoded data` 與真正連線錯誤；前者只 log，不送 system 訊息、不觸發重連。
- 加入缺少 user／content／ranks 的 guard，避免常見 undefined 欄位直接丟錯。
- 同一種 handler 錯誤 10 秒內只記錄一次。

### 驗證

- `node --test Test/tiktok_events.test.mjs`
- `npm run lint`

---

## 2026.11.08 00:01 videoTK 事件驅動與可拖動劇院按鈕

**類型**: 改善 · **檔案**: `UserScript/videoTK.user.js`、`Test/video_tk_ui.cjs`、`Test/userscript_source.test.mjs`、`Docs/TEST_FILES_REFERENCE.md`

### 問題

- `requestAnimationFrame(loop)` 永久執行，每幀查詢 video／container、讀取 rect 並寫樣式。
- `removeMeta` 的 MutationObserver 每次 DOM 變動都查詢整份文件。
- 每幀設定 `video.muted = false`，會覆蓋使用者靜音。
- 禮物在啟動時無條件隱藏；OFF 使用硬編碼 `flex`／`calc(100% - 327px)` 還原，容易壞。
- 右下 OFF/ON 圓形按鈕不可拖動。

### 修改

- 移除永久 rAF loop；改用 ResizeObserver、loadedmetadata、resize、scroll 與低頻 maintenance 更新。
- 快取文字與位置，只有變更才寫 DOM。
- Theater 模式保存每個元素原始 inline style，關閉時精確還原；禮物只在 ON 時隱藏。
- 移除自動 unmute 與死程式碼 `updateInfo`。
- 右下改成緊湊的 `⛶` 按鈕：pointer 拖曳、位置存 localStorage、resize clamp、拖曳不會觸發切換。
- 新增 `Test/video_tk_ui.cjs` 驗證 Theater 還原與拖曳不誤觸。

### 驗證

- `node Test/video_tk_ui.cjs`
- `node --test Test/userscript_source.test.mjs`
- `npm run lint`

---

## 2026.11.07 23:54 TikTokChat observer 生命週期

**類型**: 改善 · **檔案**: `UserScript/TikTokChat.user.js`、`Test/userscript_source.test.mjs`、`Docs/USERSCRIPT_SOURCES.md`

### 問題

TikTokChat 在所有 TikTok 頁面都掛三個全頁 MutationObserver 與 15 秒觀眾回報；離開目標直播間、停用或分頁隱藏時仍持續處理 DOM，增加不必要的 CPU 與事件量。

### 修改

- 新增 `startMonitoring`／`stopMonitoring`／`syncMonitoring`。
- 只在目標 `/@帳號/live` 且分頁可見時掛 chat／gift／enter observer 與 audience timer。
- SPA 換頁、目標設定變更、停用、visibilitychange 都會重新評估並拆除 observer。
- 進入頁面時只標記既有聊天節點；重新開始時重置 hydration 與觀眾狀態。
- 版本提升到 2.13；補來源測試確認生命週期函式存在且舊的全域觀眾 timer 已移除。

### 驗證

- `node --test Test/userscript_source.test.mjs`
- `npm run lint`

---

## 2026.11.07 23:49 Signer 導航節流與 WAF 冷卻

**類型**: 修正 · **檔案**: `ScriptLib/tiktok/navigation-guard.mjs`、`SignServer/direct-signer.mjs`、`SignServer/index.js`、`Test/navigation_guard.test.mjs`、`.env.example`、`Docs/BROWSER.md`、`Docs/TEST_FILES_REFERENCE.md`

### 問題

WAF 403 時，fetch page 可能在兩次錯誤後立即重建並導航 TikTok；最壞情況每 5 秒一次，容易放大 IP 頻率保護。fetch page 原本也每 5 分鐘無條件更新。

### 修改

- 新增 `TikTokNavigationGuard`：所有 signer TikTok 文件導航最小間隔 10 秒，403／429／451 後冷卻 10 分鐘。
- 冷卻期間不重建也不導航；避免 WAF 時反覆開頁。
- fetch page 改為 15 分鐘更新；`im/fetch` 連續錯誤改指數退避，且 fetch page 最多每 10 分鐘重置一次。
- 導航 log 加入次數；狀態可由 `signerNavigationState()` 讀取。
- 補導航節流單元測試與環境變數文件。

### 驗證

- `node --test Test/navigation_guard.test.mjs`
- `node --check SignServer/direct-signer.mjs`、`node --check SignServer/index.js`
- `npm run lint`

---

## 2026.11.07 22:09 監控訊息歷史持久化

**類型**: 功能 · **檔案**: `ScriptLib/monitor/store.cjs`、`MonitorRoutes.cjs`、`Server.js`、`TikTok.js`、`ScriptLib/socket/hub.mjs`、`monitor.html`、`assets/monitor.js`、`assets/monitor.css`、`lang/zh-TW.json`、`lang/en.json`、`.env.example`、`.gitignore`、`Test/monitor_history.test.cjs`、`Test/monitor_routes.test.cjs`、`Test/monitor_audience_ui.cjs`、`Docs/RUNTIME.md`、`Docs/TEST_FILES_REFERENCE.md`、`todo.md`

### 問題

monitor 只保留記憶體內 500 則；主服務重啟或超過緩衝後就無法回顧先前的直播訊息。

### 修改

- 新增 `data/monitor.sqlite`：`sessions`／`messages`，每場由子程序啟動／結束界定，WAL 交易式寫入。
- 預設保留最近 10 場、14 天、每場 20,000 則；可用環境變數調整。`isTest` 測試訊息不寫入。
- 新增需登入的 `GET /api/monitor/sessions` 與 `GET /api/monitor/messages`，支援場次、分頁、全文搜尋與分類篩選。
- monitor 工具列新增「即時／歷史」；歷史模式有場次選單、分頁、搜尋／分類，切回即時不中斷背景 SSE。
- 補 SQLite、route 與 monitor UI 測試；資料庫加入 `.gitignore`。

### 限制

- 歷史以主服務啟動的子程序為場次邊界；同一個子程序內重連仍算同一場。
- 歷史 API 需要登入，未登入時 monitor 只顯示提示。
- SQLite 寫入目前逐則交易；極高訊息量時可能需要批次寫入。

### 驗證

- `node --test Test/monitor_history.test.cjs Test/monitor_routes.test.cjs`
- `node Test/monitor_audience_ui.cjs`
- `npm run test:core`、`npm run lint`、`npm run check:css`

---

## 2026.11.07 21:58 本場統計與點讚聚合

**類型**: 功能 · **檔案**: `ScriptLib/tiktok/events.mjs`、`ScriptLib/socket/hub.mjs`、`TikTok.js`、`monitor.html`、`assets/monitor.js`、`assets/monitor.css`、`lang/zh-TW.json`、`lang/en.json`、`Test/monitor_audience_ui.cjs`、`Test/socket_hub.test.mjs`、`Docs/RUNTIME.md`、`Docs/SOCKET_TRANSPORT.md`

### 問題

monitor 只能看到逐筆加入／點讚，沒有本場累計；每個點讚事件都直接推播，容易洗通知。

### 修改

- 子程序維護 `session: { joins, likes, chats }`，隨 `sendCat` payload 帶出；monitor 工具列顯示本場累計。
- 本場點讚以原始 `data.count` 累加；每位使用者的 60 秒累計顯示維持不變。
- 點讚 Bark／ntfy 改為 3 秒合併，類似加入事件；monitor 逐筆列保留。
- socket test 補 `session` payload 斷言；monitor UI 測試補本場統計列。

### 限制

- 本場統計綁定 TikTok 子程序生命週期；重新啟動後從 0 開始。
- 加入／點讚被 filter 或 socket 去重時，monitor 可能到下一個事件才看到最新累計。
- 點讚通知合併若在程序結束前尚未 flush，可能不發送。

### 驗證

- `node Test/monitor_audience_ui.cjs`
- `node --test Test/socket_hub.test.mjs`
- `npm run test:core`、`npm run lint`、`npm run check:css`

---

## 2026.11.07 21:51 修正 monitor 自動捲動

**類型**: 修正 · **檔案**: `monitor.html`、`assets/monitor.js`、`assets/monitor.css`、`lang/zh-TW.json`、`lang/en.json`、`Docs/RUNTIME.md`

### 問題

監控頁原本在每次 `scroll` 發現不在底部就關閉自動捲動；圖片／列高延遲載入或程式捲動造成誤判，使用者常需手動往下追新訊息。

### 修改

- 以 wheel／touch／pointer／key 的使用者意圖區分；使用者主動往上才停用自動捲動。
- 內容高度變化（頭貼載入等）用 `ResizeObserver` 持續貼底。
- 非自動捲動時累計 unseen，右下角顯示「N 則新訊息 ↓」；點擊恢復自動捲動。
- 使用者手動捲回底部時清除 unseen。

### 驗證

- monitor UI 測試、core 304 項、lint、`check:css`。

---

## 2026.11.06 19:55 Restream 指標頁排版與入口

**類型**: 改善 · **檔案**: `OtherTool/restream/index.html`、`log.html`、`runtime.html`、`monitor.html`、`lang/zh-TW.json`、`lang/en.json`、`Test/restream_page_ui.cjs`、`Docs/TEST_FILES_REFERENCE.md`

### 問題

Restream 頁面只有「回首頁」，沒有主控台／運行狀態／人流／監控入口；表格使用過大的最小寬度，長 showId 讓「樣本」欄被水平捲動裁掉，Health 與 bitrate 也不夠易讀。

### 修改

- 固定表格欄寬與 `table-layout: fixed`；showId 可換行，樣本欄保持可見，窄螢幕才水平捲動。
- Health 改為顏色 badge；Bitrate 在 ≥1000 Kbps 時顯示 Mbps；擷取／收到時間保留 title 相對時間。
- 頁首補 `/`、`/runtime`、`/traffic`、`/monitor`、`/restream` 導覽與「重新整理」按鈕。
- 主控台、運行狀態、直播訊息頁加入 `Restream 指標` 入口。
- 新增 `Test/restream_page_ui.cjs`：入口、表格不溢出、Health badge、Mbps 與樣本欄。

### 限制

- 頁面仍是單一表格；大量 show 時以垂直列表呈現，沒有趨勢圖。
- 指標仍只存在記憶體，重啟後消失。

### 驗證

- `node Test/restream_page_ui.cjs`
- `npm run lint`、`npm run check:css`

---

## 2026.11.06 06:27 測試派發目標與通知通道結果

**類型**: 改善 · **檔案**: `monitor.html`、`assets/monitor.js`、`assets/monitor.css`、`TikTok.js`、`ScriptLib/notify/index.mjs`、`Server.js`、`lang/zh-TW.json`、`lang/en.json`、`Test/notify.test.mjs`、`Test/monitor_audience_ui.cjs`、`Docs/RUNTIME.md`、`Docs/CHAT_API.md`、`Docs/SOCKET_TRANSPORT.md`

### 問題

測試訊息過去無條件走 socket 並呼叫通知派發器；monitor 只看得到 socket，沒有派發目標控制，也看不到 Bark／ntfy 哪個成功。`Notifier.notify` 也丟掉各通道結果。

### 修改

- 測試表單新增 `Socket`／`通知` 勾選；通知預設關閉，避免測試誤發。
- 測試 payload 帶 `testDispatch`；子程序只執行勾選的目標。
- `Notifier.notify` 回傳 `[{ channel, ok }]`；子程序彙整為 `sent`／`partial`／`failed`／`nochannels`。
- `TEST_RESULT`／`/status/stream/test-results` 加入 `notify` 與逐通道結果；monitor 同時顯示 socket 冷卻與通知通道。
- 有勾選通知時等待結果延長到 15 秒；預設 5 秒。
- 通知勾選狀態一併存入 localStorage。
- 派發目標獨立成一個 grid 列，覆寫 `.mon-test-grid label` 的 column 排列；checkbox 與文字改為同一列，不再和操作按鈕擠在一起。
- 標籤改為 `Socket／overlay` 與 `Bark／ntfy`，說明兩者獨立、同時勾選不會重複送 Socket。

### 限制

- 通知測試會實際送到已啟用的 Bark／ntfy；需要明確勾選與確認。
- 通知通道失敗只回報 ok=false；詳細例外交由子程序日誌。
- 仍只支援測試訊息；一般 `/chat` 不產生 TEST_RESULT。

### 驗證

- `node --test Test/notify.test.mjs`
- `node Test/monitor_audience_ui.cjs`
- `npm run test:core`、`npm run lint`、`npm run check:css`

---

## 2026.11.06 06:15 測試訊息精確結果與去重倒數

**類型**: 功能 · **檔案**: `Server.js`、`TikTok.js`、`ScriptLib/socket/dedup.mjs`、`ScriptLib/socket/hub.mjs`、`assets/monitor.js`、`lang/zh-TW.json`、`lang/en.json`、`Test/socket_hub.test.mjs`、`Test/monitor_audience_ui.cjs`、`Docs/RUNTIME.md`、`Docs/CHAT_API.md`、`Docs/SOCKET_TRANSPORT.md`

### 問題

`/chat` 回 HTTP 200 不代表 SocketHub 真的送出；遇到去重、filter 或子程序未處理時，monitor 沒有提示，也不知道同文同頭貼的測試何時可以再送。

### 修改

- monitor 送測試時帶 `testId`；TikTok.js 在 filter／heat／`sendSocketMessage` 後以 IPC `TEST_RESULT` 回報狀態。
- 主服務新增 `TEST_RESULT` IPC 處理與 `/status/stream/test-results` SSE；早退的 filter／offline 也由主服務回報。
- `MessageDedup.remaining()` 提供實際剩餘保護時間；測試 duplicate 不刷新 TTL。
- monitor 顯示 `sent`／`duplicate` 的去重倒數，以及 `filtered`／`ignored`／`offline`；5 秒沒有結果會提示。
- 測試 UI fixture 回報 sent／duplicate，並驗證精確狀態。

### 位置建議

- 測試輸入與即時結果留在 `/monitor`，因為操作與訊息上下文在一起。
- 若要瀏覽最近去重事件、查詢其他診斷訊息，建議另開獨立 `/dedup`（或 `/diagnostics/dedup`）頁；runtime 只保留程序生命週期與入口連結，不放去重管理。
- 目前先完成 monitor 內的精確結果；獨立頁尚未實作。

### 限制

- 只涵蓋 monitor 送出的 `isTest` 測試；正式 `/chat` 不會自動產生結果事件。
- 結果依賴 child→main IPC 與 SSE；子程序未回報時只能顯示 timeout。
- 5 秒等待時間是 UI 上限，不代表伺服器沒有處理。

### 驗證

- `node --test Test/socket_hub.test.mjs`
- `node Test/monitor_audience_ui.cjs`
- `npm run test:core`、`npm run lint`、`npm run check:css`

---

## 2026.11.06 06:05 修正測試訊息換頭貼仍被去重

**類型**: 修正 · **檔案**: `ScriptLib/socket/dedup.mjs`、`ScriptLib/socket/hub.mjs`、`TikTok.js`、`Test/socket_hub.test.mjs`、`Docs/CHAT_API.md`、`Docs/SOCKET_TRANSPORT.md`

### 問題

Socket 去重只用使用者＋第一行內容；`isTest` 測試訊息重複發送同文同人、只換頭貼時，第二次仍被 `MessageDedup` 當成重複而跳過，無法測試不同頭貼。

### 修改

- `MessageDedup.isDuplicate`／`add` 新增 opt-in `variant`；未帶時行為不變。
- `SocketHub.sendMessage` 接受 `dedupVariant` 並傳入去重比對。
- TikTok.js 的 `/chat` `isTest` 路徑使用 `test:<img>` 作為 variant：換頭貼可通過，同一頭貼仍去重。
- 一般正式訊息不帶 variant，維持原本跨路徑／重連去重。

### 限制

- 這是針對測試訊息的最小變更；正式訊息若也要把頭貼納入去重，需另外評估跨管道頭貼 URL 不一致的風險。
- 同文同人且同一頭貼的測試仍會在 TTL 內被去重。

### 驗證

- `node --test Test/socket_hub.test.mjs`：variant 與一般去重。
- `npm run test:core`：304 項。
- `npm run lint`。

---

## 2026.11.06 03:53 監控頁本機測試訊息

**類型**: 功能 · **檔案**: `monitor.html`、`assets/monitor.js`、`assets/monitor.css`、`EmojiRoutes.cjs`、`lang/zh-TW.json`、`lang/en.json`、`Test/monitor_audience_ui.cjs`、`Docs/RUNTIME.md`、`Docs/EMOJI_MAP.md`

### 問題

`/monitor` 只能看實際流入的訊息；要驗證頭貼、文字排版與 emoji 對應時，只能靠 live 或 `TestCenter` 走完整 `/chat` 管線，會依賴子程序，也可能混入其他處理。

### 修改

- monitor 新增可收合的「測試訊息（本機預覽）」：使用者、頭貼 URL、平台、分類、訊息。
- 只在本機 `append()` 測試列，標記「測試」badge；不送 `/chat`、平台、filter、AutoClip、traffic 或統計，重新整理即消失。
- 新增「送 socket 測試」：確認後檢查 `/api/runtime`，以 `isTest:true` POST `/chat`；需要 TikTok 子程序，經 filter／去重，可能被阻擋。
- 實際送出不做樂觀新增，等 SSE 回顯才出現；失敗或子程序未運行會顯示狀態。
- 新增公開唯讀 `GET /api/emoji/preview`，回傳目前啟用映射；測試訊息在瀏覽器用同一份 map 解析，支援將 emoji 代碼顯示為圖片。
- 頭貼可手動輸入 HTTP(S) URL，或從目前 emoji map 選取（同一 URL 去重）；選取後表單旁即時顯示頭貼預覽，載入失敗會提示。
- 使用者、頭貼、平台、分類保存在 `localStorage`（`ttw-monitor-test-prefs`），重新整理後還原；測試訊息本文不保存，另有「清除測試設定」。
- 文字以 DOM 文字節點／安全圖片元素建立，不注入 HTML。
- 「測試」badge 改成與平台／分類 chip 同高（1.25rem、inline-flex 置中），修正列內垂直對齊。
- 補 `zh-TW`／`en` 文案與 monitor UI 測試（頭貼選單、prefs 還原／清除、文字、emoji、badge 對齊、無 POST）。

### 限制

- 「加入預覽」不測試 filter、翻譯、AutoClip 或平台實際送出；「送 socket 測試」才會走 `/chat` 與子程序。
- 實際 socket 測試仍可能被 filter／去重阻擋；沒有回顯不代表送出失敗。
- 圖片仍受瀏覽器與外部主機可用性影響；失敗時 emoji 會退回原始代碼文字。
- `/api/emoji/preview` 是公開唯讀；只暴露目前啟用中的 emoji URL，不含本機管理狀態或寫入能力。
- 偏好只存在目前瀏覽器／profile 的 `localStorage`；不跨裝置同步，也不使用 cookie。

### 驗證

- `node Test/monitor_audience_ui.cjs`
- `npm run lint`

---

## 2026.11.06 03:37 修正 Pages timeout 上限與殘留部署清理

**類型**: CI · **檔案**: `.github/workflows/pages.yml`

### 問題

- `deploy-pages@v5` 的 `timeout` 上限是 **600000ms（10 分鐘）**；先前設定 20 分鐘會被 clamp，並在 log 產生 warning。
- 先前的 preflight 用 Pages deployment status 查詢；在 `7e8f988` 的案例中步驟雖成功，但沒有取消，deploy 仍收到 400。Pages 狀態 API 不一定反映後端仍持有的 lock。

### 修改

- 移除超過上限的 `timeout`，保留 `error_count: 20` 與 `reporting_interval: 10000`。
- preflight 改為列出 `github-pages` environment 的 Actions deployments，讀取每個 deployment 的最新狀態。
- 只挑戰/取消狀態不是 `success` 或 `inactive` 的舊 deployment（包含 failure／in_progress）：
  `POST /repos/{owner}/{repo}/pages/deployments/{sha}/cancel`。
- 每一步都記錄 SHA 與狀態；任何錯誤只記錄，不阻擋 deploy。

### 限制

- 只檢查最近 20 個 `github-pages` deployments；更舊的殘留仍需手動取消。
- 若 GitHub Pages 後端把 lock 掛在沒有對應 deployment 的狀態，仍可能需要 GitHub Support。
- 目前這筆修正尚未在 Pages 上完成實機驗證；下一個 push 會直接測試 preflight。

### 驗證

- YAML 解析確認 preflight 在 `deploy-pages` 前，且沒有超過上限的 timeout。
- 下一個 pages run 會先嘗試取消 `7e8f988` 等非 success 的殘留 deployment。

---

## 2026.11.06 03:31 GitHub Pages 取消殘留的進行中部署（初版）

**類型**: CI · **檔案**: `.github/workflows/pages.yml`

### 問題

`concurrency` 只會取消舊的 workflow run，不會取消已建立的 Pages deployment。`7e8f988` 的 deployment 在 Actions 顯示 failure，但 Pages 後端仍視為進行中，導致 `5177e79` 建立新 deployment 時收到 400：

> due to in progress deployment. Please cancel `7e8f988` first.

### 修改

- deploy 前新增 `actions/github-script` preflight：檢查最近 10 個 commit 的 Pages deployment。
- 只有狀態仍是 `deployment_in_progress`、`syncing_files`、`finished_file_sync`、`updating_pages`、`purging_cdn` 時才呼叫 cancel；成功或已失敗的不動。
- 404 或其他取消錯誤只記錄，不阻擋後續 deploy（`continue-on-error`）。
- 既有 20 分鐘 timeout 與 workflow-level concurrency 保留。

### 限制

- 只掃最近 10 個 commit；更舊的殘留 deployment 仍需手動取消。
- 這是清理殘留狀態的防呆，不會修復 Pages 後端本身卡住。

### 驗證

- YAML 解析確認 preflight 在 `deploy-pages` 前、參數正確。
- 下一次 push 的 pages run 會先清理殘留 deployment，再建立新部署。

---

## 2026.11.06 03:23 GitHub Pages deploy timeout 調整（上限 10 分鐘）

**類型**: CI · **檔案**: `.github/workflows/pages.yml`

### 問題

`actions/deploy-pages@v5` 使用預設 10 分鐘 timeout；Pages 後端偶爾停留在 `updating_pages` 超過 10 分鐘，導致 deploy job 失敗，網站仍停留在上一個版本。

### 修改

- 嘗試將 deploy timeout 設為 20 分鐘；`deploy-pages@v5` 上限為 600000ms，實際會被 clamp（後續修正見 03:37）。
- `error_count` 20、`reporting_interval` 10 秒，降低輪詢錯誤與 log 噪音。
- 保留既有 workflow-level `concurrency: pages`／`cancel-in-progress: true`；新 push 仍會取消舊的 pages run。

### 限制

- 這只容忍較慢的 Pages 佇列，不會修復 Pages 後端真正卡死；若持續超過 20 分鐘仍需重跑或檢查 Pages 狀態。

---

## 2026.11.06 03:02 表情停用卡片按鈕不再變暗

**類型**: 修正 · **檔案**: `assets/emoji.js`、`Test/emoji_ui.cjs`

### 問題 - 停用項目整張卡片變暗，操作按鈕看起來失效

停用預設時卡片套用 `opacity:.6`，連「編輯／啟用／恢復預設」一起變暗，容易被誤認為不能按。

### 修改

- 移除卡片整體透明度；只把縮圖調淡並加 `title="已停用"`。
- 代碼、來源／狀態與所有操作按鈕維持正常亮度。
- UI 測試新增斷言：停用卡片的 computed opacity 與按鈕 opacity 都必須是 1。

### 驗證

- `node Test/emoji_ui.cjs`
- `npm run lint`

---

## 2026.11.06 02:37 表情映射拆分預設與本機覆寫

**類型**: 功能 · **檔案**: `EmojiStore.cjs`、`EmojiMap.js`、`ScriptLib/emoji/image_cache.cjs`、`assets/emoji.js`、`emoji.html`、`.gitignore`、`Test/emoji_store.test.cjs`、`Test/emoji_ui.cjs`、`Docs/EMOJI_MAP.md`、`README.md`

### 問題 - 管理頁直接改寫預設表情清單

原本 `/emoji` 的儲存直接覆寫 `emoji_map.json`；版本更新或個人修改會互相覆蓋，也無法安全停用預設。

### 修改

- `emoji_map.json` 改為只讀的預設參考清單；管理頁只寫不提交的 `emoji_map_local.json`。
- 本機覆寫格式 `{version:1, emojis:{code:{url?, enabled?}}}`；`url` 覆寫網址、`enabled` 控制啟用，自訂需 `url`。
- 合併後只把啟用且有網址的項目放進聊天替換表；停用預設保留網址，可「恢復預設」。
- 管理頁列出所有項目（含停用），顯示預設／本機覆寫／自訂與啟用狀態，提供停用／啟用、恢復預設、刪除自訂。
- 圖片預覽路徑改用 `imageUrl()`，停用項目仍可預覽。
- 版本指紋涵蓋預設＋本機狀態；兩份檔案每秒熱載入，任一檔案損壞保留上一版。
- `EmojiStore` 保留舊單檔模式供測試與舊 API；正式 store 使用雙檔。

### 限制

- 目前仍只接受 HTTP(S) 圖片；`data:` base64 尚未支援，之後才做接收端能力判斷。
- 本機狀態是每個環境一份，不會跨機器同步；這是刻意不提交。
- 預設項目不能刪除，只能停用；避免失去恢復來源。

### 驗證

- `Test/emoji_store.test.cjs`：預設＋本機合併、覆寫、停用、恢復、自訂、預設檔不被改寫、損壞本機保留上一版、雙檔監看、版本衝突與既有單檔行為。
- `Test/emoji_ui.cjs`：停用預設可見、可啟用，POST 帶正確 revision。
- `npm run lint`。

---

## 2026.11.06 00:21 Restream 指標診斷通道

**類型**: 功能 · **檔案**: `RestreamRoutes.cjs`、`ScriptLib/restream/metrics.cjs`、`OtherTool/restream/index.html`、`Server.js`、`UserScript/restream-monitor.user.js`、`Test/restream_metrics.test.cjs`、`Test/restream_monitor.test.cjs`、`Test/restream_monitor_ui.cjs`、`Docs/USERSCRIPT_SOURCES.md`

### 問題 - Restream Health／Bitrate 沒有觀察入口

`restream-monitor` 原本只開啟 TikTok 監控頁與暫停預覽；Sample2 的 Health、Resolution、Bitrate、Frame rate、Keyframe interval 只能看 Restream 頁面，無法確認擷取是否正確，也不該混進 `/chat` 或交通場次。

### 修改

- 新增 `POST /restream/metrics` 與 `GET /restream/metrics`；每個 showId 在記憶體保留最新一筆與最近 120 筆，最多 20 場、24 小時。
- 新增 `OtherTool/restream/index.html`（`/restream`，需主服務登入）顯示最新 Health、解析度、Bitrate、FPS、Keyframe、擷取／收到時間與樣本數，5 秒更新。
- `restream-monitor` 從文字標籤擷取指標，送到使用者設定的主服務；面板顯示目前值與送出結果，並可開啟「指標頁」。
- 缺欄位送 null，不猜 0；只接受 `app.restream.io` 的來源；不寫 SQLite、交通或 `/chat`。
- 指標每 60 秒或數值變更時送一次；頁面隱藏時仍可送出，但不會額外請求 TikTok。

### 限制

- 依賴 Restream DOM 的標籤文字與 `value-` 結構；改版可能失效，面板會顯示找不到指標。
- 只用於診斷，不作為開播、斷播、AutoStop 或 AutoClip 判斷。
- 尚未在真實 Restream 頁面長時間驗證；目前以 Sample2 結構與 fixture DOM 測試。

### 驗證

- `Test/restream_metrics.test.cjs`：正規化、缺值、來源限制、樣本上限與排序。
- `Test/restream_monitor.test.cjs`：指標文字解析。
- `Test/restream_monitor_ui.cjs`：fixture DOM 擷取並確認送到 `/restream/metrics` 的 payload。
- `npm run test:core`、`npm run lint`、`npm run lint:restream`。

---

## 2026.11.06 00:04 Userscript 主服務位址可設定

**類型**: 功能 · **檔案**: `Server.js`、`UserScript/TikTokChat.user.js`、`UserScript/liveCenter.user.js`、`UserScript/restream-monitor.user.js`、`UserScript/ws-relay.user.js`、`UserScript/youtube-chat-userscript.user.js`、`UserScript/TestCenter.user.js`、`Test/userscript_source.test.mjs`、`eslint.config.mjs`、`Docs/USERSCRIPT_SOURCES.md`

### 問題 - 主服務位址只能改腳本原始碼

各腳本原本寫死不同位址：`TikTokChat`／`TestCenter` 是 `192.168.0.102`，`liveCenter`／`ws-relay` 是 `127.0.0.1`，YouTube 是 `localhost`。換 port、換機器或反向代理就得改原始碼。

### 修改

- 所有轉接腳本改用 `ttw-main-endpoint`（預設 `http://127.0.0.1:3332`）與 `ttwEndpoint()` 動態讀取。
- 統一 `normalizeEndpoint()`：允許 `host:port`、http(s)、可選路徑前綴；拒絕帳密、query、hash。
- `TikTokChat`、`ws-relay`、`youtube-chat`、`TestCenter` 加 Tampermonkey 選單；`liveCenter`、`restream-monitor` 面板加位址欄位與「測試主服務」。
- 新增 `GET /ping` 供設定畫面測試，不需要登入。
- 腳本加 `GM_registerMenuCommand` 與 `@connect *`，只送到使用者設定的位址。
- 版本：TikTokChat 2.12、liveCenter 1.19、restream-monitor 1.2.1、ws-relay 1.4、YouTube 1.8、TestCenter 1.6。

### 限制

- GM storage 是每個腳本各自獨立，沒有跨腳本／跨網域的單一設定；換主機仍需逐一設定。
- `/ping` 只證明主服務可達，不證明目前登入或聊天轉接正常。
- `@connect *` 是為了支援自訂主機；若只使用本機，建議設回 `127.0.0.1:3332`。

### 驗證

- `Test/userscript_source.test.mjs`：位址正規化與不安全格式拒絕；既有 payload 測試改注入 `ttwEndpoint()`。
- `Test/restream_monitor_ui.cjs`：面板與預覽功能仍正常。
- `npm run lint`、`npm run lint:restream`。

---

## 2026.11.05 23:47 Restream 助手自動暫停預覽

**類型**: 功能 · **檔案**: `UserScript/restream-monitor.user.js`、`Test/restream_monitor.test.cjs`、`Test/restream_monitor_ui.cjs`、`Docs/USERSCRIPT_SOURCES.md`

### 問題 - Restream show 頁預覽會自動播放

`restream-monitor.user.js` 原本只負責偵測並開啟 TikTok Live Monitor 連結，沒有處理 Restream show 頁的預覽播放；預覽自動播放會造成多餘播放與聲音。

### 修改

- 版本 1.2.0；新增「自動暫停預覽」選項，預設開啟，面板可取消，設定保存在腳本管理器。
- 在 show 頁尋找 `Play Preview`／`Pause Preview` 按鈕與相鄰預覽 `video`；播放中且使用者尚未手動操作時，點擊暫停或呼叫 `video.pause()`。
- 每場最多自動暫停一次；使用者手動按播放後不再自動暫停。
- 新增預覽狀態列；失敗或找不到控制項時靜默停用，不影響監控連結。
- 只影響預覽，不會停止 Restream 推流或直播。

### 限制

- 依賴 Restream 當前的按鈕文字與 `video` 結構；改版可能使自動暫停失效。
- 只處理 show 頁；不處理其他影片或瀏覽器原生子母畫面。
- 尚未在真實 Restream 頁面重播自動播放流程，僅以樣本 DOM 與純函式測試覆蓋。

### 驗證

- `Test/restream_monitor.test.cjs`：按鈕標籤辨識與自動暫停條件。
- `Test/restream_monitor_ui.cjs`：以 fixture DOM 驗證自動暫停一次，以及 `?pause=0` 時不暫停。
- `npm run lint:restream`。

---

## 2026.11.05 23:34 專用瀏覽器 TikTok live 403 修復

**類型**: 修復 · **檔案**: `ScriptLib/browser/waf.mjs`、`ScriptLib/browser/controller.cjs`、`SignServer/direct-signer.mjs`、`Test/browser_session.test.mjs`、`Docs/BROWSER.md`

### 問題 - 專用瀏覽器開 TikTok live 得到 403

專用 profile 開 `https://www.tiktok.com/` 正常，但開 `https://www.tiktok.com/@handle/live` 在文件層回 403；同一個 live 頁在無痕 context 是 200。把 profile cookies 複製到無痕可重現 403；逐一排除後，只刪除 `_waftokenid` 就恢復 200，其他單一 cookie（msToken、ttwid、s_v_web_id、odin_tt 等）仍 403。登入 session cookies 不帶路由 cookie 時也是 200。

原因是長時間閒置後 `_waftokenid`（WAF token）失效。403 發生在頁面載入前，TikTok 的 JS 沒有機會自行刷新，瀏覽器就卡在錯誤頁。

### 修改

- 新增 `ScriptLib/browser/waf.mjs`：只刪除 `.tiktok.com`／`www.tiktok.com` 的 `_waftokenid`，不動 `sessionid`、`sid_tt` 等登入 cookie。
- 專用瀏覽器啟動時清除一次；每次開 live 前再清除一次。這是本機 cookie 操作，不會多發 TikTok 請求。
- `SignServer/direct-signer.mjs` 的每次 TikTok 導航都先清除再導航，不等待 403。
- 背景監看手動開啟的分頁：文件層 403 時清除並重新載入，每個分頁 10 分鐘最多一次；另有每 6 小時一次主動清理（`BROWSER_WAF_CLEAN_MIN`）。
- 清除後由下一次成功的 TikTok 頁面重新產生 token。

### 限制

- 只處理 WAF token；若 403 來自帳號、IP 或平台限制，清除 cookie 不會修復。
- 手動點擊建立的分頁仍可能在請求送出後才被偵測到 403；背景監看會清除後重載該分頁，但無法保證完全不出現一瞬間的錯誤頁。

### 驗證

- 以 cookie 分組比對定位 `_waftokenid`；無痕 context 與只帶登入 cookie 皆為 200。
- 新增 `clearTikTokWafToken()` 單元測試：只刪 `_waftokenid`、不動登入 cookie、正確斷線。
- 未再大量導航 TikTok；後續以單元測試與實機開啟 live 驗證。

---

## 2026.11.05 05:37 AutoClip 歷史 UI 冒煙測試

**類型**: 測試 · **檔案**: `Test/autoclip_history_ui.cjs`、`assets/autoclip.js`、`Docs/TEST_FILES_REFERENCE.md`

### 問題 - 歷史頁的本場最高、單人門檻與觸發證據沒有自動化檢查

歷史頁先前只用手動預覽確認；單人模式新增後，卡片門檻、`scoreThreshold`、觸發證據與範圍摘要都可能在改動中回歸。

### 修改

- 新增 `Test/autoclip_history_ui.cjs`：以假歷史資料與 Chart stub 載入真正的 `assets/autoclip.js`。
- 檢查歷史場次選單、本場最高摘要、單人門檻（5 則／1 人、分數 2.5）、觸發證據（單人模式、每人 5 則）與切換到 10 分鐘範圍後的摘要。
- 測試時發現並修正前端 `summarizeRows()` 缺少 `scoreThreshold`／`solo`／`recentDistinctUsers`；「所選範圍」摘要現在會沿用單人門檻。
- 切回即時頁時確認歷史控制項隱藏、即時總覽顯示，且沒有 page error。

### 驗證

`node Test/autoclip_history_ui.cjs`。

---

## 2026.11.05 05:29 AutoClip 單人活躍發言者模式

**類型**: 功能 · **檔案**: `AutoClipV2.mjs`、`ScriptLib/autoclip/metrics.mjs`、`ScriptLib/autoclip/evidence.mjs`、`ScriptLib/autoclip/history.cjs`、`TikTok.js`、`assets/autoclip.js`、`.env.example`、`Docs/KEYWORD_AUTOCLIP_V2.md`、`Test/autoclip_v2.test.mjs`、`Test/autoclip_history.test.cjs`

### 問題 - 只有 1 位發言者的小台永遠無法觸發

一般自適應門檻最低仍要求 2 位不同發言人，且每人每 30 秒最多計入 3 則；因此長期只有 1 位觀眾聊天時，即使連續發言也無法達到 4 則／2 人。

### 修改

- 新增「近期發言者」追蹤：近 15 分鐘各平台只有 1 位不同發言者時，自動切換單人門檻。
- 單人門檻：1 位發言人、5 則不同訊息、聊天倍率 3.0、分數 2.5、每人最多 5 則；同一人重複相同文字不累計。
- `auto` 另外限制全平台觀眾 ≤ 20；`on` 忽略觀眾上限但仍要求 1 位發言者；`off` 停用。第二位發言者出現即回到一般門檻。
- 狀態列、平台卡片、觸發證據與歷史摘要記錄 `solo`、`recentDistinctUsers`、有效分數門檻與每人上限。
- 前端 `summarizeRows()` 同步複製 `scoreThreshold`／`solo`／`recentDistinctUsers`，讓「所選範圍」摘要沿用單人門檻。
- 新增 `AUTO_CLIP_SOLO`、`AUTO_CLIP_SOLO_*` 設定。

### 限制

- 單人模式仍可能被單一洗頻帳號觸發；已用不同文字、3 倍聊天倍率、2.5 分與 10 秒持續降低誤觸，但無法完全區分惡意洗頻。
- 目前沒有管理頁手動切換按鈕，只能透過環境變數 `off`／`auto`／`on`。

### 驗證

- 新增單人模式測試：3 則不足、5 則可觸發、重複文字不計、auto 觀眾上限與 on 覆寫。
- 歷史摘要與一般模式測試維持通過。

---

## 2026.11.05 05:04 人流頁新增每小時觀看時段

**類型**: 功能 · **檔案**: `ScriptLib/traffic/database.cjs`、`TrafficRoutes.cjs`、`assets/traffic-history.js`、`traffic.html`、`lang/zh-TW.json`、`lang/en.json`、`Test/traffic.test.cjs`、`Test/traffic_history_ui.cjs`、`Docs/TRAFFIC.md`、`Docs/WEB_UI.md`、`Docs/TEST_FILES_REFERENCE.md`

### 問題 - 沒有開播時間或開播時段不足時，長場次的觀看無法形成建議

原本排名只以場次開播時間分桶；沒有 `actualStarted` 的場次、或開播時段樣本不足時，長場次跨到其他小時的觀看只進熱圖，不會進入任何建議。

### 修改

- `TrafficDatabase.hourlyViewing()`：以 `minutes` 依當地星期／小時彙總；每個日期先算該小時平均（至少 10 分鐘才計入），再跨日期取中位數與平均。
- 長場次自然貢獻多個小時；不需要開播時間，可作為開播時段不足時的 fallback。
- `/api/traffic/history` 新增 `hourly`；回傳 `cells`、`qualified`（≥3 天）、`provisional`（未達 3 天）。
- 歷史頁新增「觀看時段（每小時平均）」表：列出中位數最高的時段、天數、有效分鐘與最近觀測；未達 3 天時列暫定時段並標示樣本不足。只用觀看樣本，不用進房或人數變化推估。
- 暫定時段先依天數排序，再看中位數，避免只有 1 天的時段排在多天時段前面。

### 限制

- `minutes` 是平台層級；同平台多主播時可能混入，不是單一主播的保證。
- 固定每個日期至少 10 分鐘、3 天門檻與最多 8 列，尚無自訂。
- 這是觀看時段，不是開播時段；不會寫入開播排名或 planner。

### 驗證

- 新增 `hourlyViewing` 測試：3 個日期、長場次跨 20:00／21:00、邊緣 5 分鐘不計、單日時段留在 provisional。
- UI smoke 檢查正式／暫定表、空狀態與語言鍵。

---

## 2026.11.05 04:41 人流頁新增場次開場比較

**類型**: 功能 · **檔案**: `ScriptLib/traffic/database.cjs`、`TrafficRoutes.cjs`、`assets/traffic-history.js`、`assets/traffic.css`、`traffic.html`、`lang/zh-TW.json`、`lang/en.json`、`Test/traffic.test.cjs`、`Test/traffic_history_ui.cjs`、`Docs/TRAFFIC.md`、`Docs/WEB_UI.md`、`Docs/TEST_FILES_REFERENCE.md`

### 問題 - 圖表只有單一時間線，看不出哪一場開場比較好

原本的觀看圖一次只顯示所選區間；要看場次差異必須自己記住日期與形狀，`Docs/WEB_UI.md` 也把「場次比較與按開播時間對齊」列為未實作。

### 修改

- `/api/traffic/history` 新增 `comparison`：以 `actualStarted`（沒有時用 `started`）為 0 分，對齊前 120 分鐘。
- 最多取最近 6 場自己的場次；每 5 分鐘一個點，回傳各場曲線與跨場中位數。
- 每場提供開場平均（exact／estimated 30 分、late／approx 45 分）、最高分鐘、峰值後低點、峰值時間、觀測分鐘、開播信心與結束狀態。
- 歷史頁新增 SVG 曲線圖與明細表；峰值加圓點，滑鼠移到圖上顯示十字線與當格各場數值，圖上另標全範圍最高；缺值保持 null，不補 0；只有 1 場時提示需要更多場次。
- 進行中／已結束以 `ended` 或最後樣本超過 5 分鐘判斷，避免舊場次一直顯示進行中。
- 補資料庫與 UI 冒煙測試。

### 限制

- 固定 5 分鐘桶、最近 6 場，尚無自訂桶寬或場次選擇。
- 曲線取自 `minutes`（平台層級）；同平台同時有兩個主播的極端情況可能混入。
- 場次長度不足 10 分鐘或開場觀測不足者不納入比較。

### 驗證

`node --test Test/traffic.test.cjs`、`node Test/traffic_history_ui.cjs`、`npm run lint`、`npm run check:css`。

---

## 2026.11.05 04:16 AutoClip 門檻自適應，歷史場次顯示本場最高

**類型**: 改善 · **檔案**: `AutoClipV2.mjs`、`ScriptLib/autoclip/metrics.mjs`、`ScriptLib/autoclip/evidence.mjs`、`ScriptLib/autoclip/history.cjs`、`assets/autoclip.js`、`TikTok.js`、`Test/autoclip_v2.test.mjs`、`Test/autoclip_history.test.cjs`、`Docs/KEYWORD_AUTOCLIP_V2.md`、`Docs/envExample`

### 問題 - 小台永遠達不到 6 則／3 人；歷史卡片只顯示最後快照

固定 `minMessages=6`、`minUsers=3` 對只有 1–2 位發言者的台幾乎不可能達標；歷史場次的平台卡片又只顯示最後一個有效樣本，最後一刻剛好 0 則時就會呈現「TikTok 0」，即使整場最高其實有 1.8 分。

### 根因

- 絕對門檻沒有跟著台的近期活躍度調整。
- `evaluate` 用跨平台總留言／總人數判定，會稀釋單一平台的自適應門檻。
- 歷史頁卡片取 `allRows.at(-1)`，不是整場彙整。

### 修改

- 自適應絕對門檻（預設開啟）：`minMessages = min(設定值, max(4, ceil(近期每分鐘訊息中位數)))`；`minUsers = min(設定值, max(2, 近期單一窗口最大發言人數))`。聊天倍率與分數門檻不變。
- 觸發判定改用達標平台自己的有效門檻，不再用跨平台總數。
- `AutoClipHistory.query()` 新增 `platforms` 彙整：最高分樣本、最高留言／人數／倍率／觀眾、達標窗口數、管道 union、最高分時間。
- 歷史卡片改顯示「本場最高」與「本場 0 個窗口達標」，不再被最後一刻的 0 誤導。
- 新增 `AUTO_CLIP_MIN_MESSAGES`、`AUTO_CLIP_MIN_USERS`、`AUTO_CLIP_MIN_MESSAGE_RATIO`、`AUTO_CLIP_ADAPTIVE_THRESHOLDS` 設定。

### 限制

- 真的只有 1 位發言者時仍不會觸發（`minUsers` 最低 2），避免單人洗頻誤觸。
- 自適應只下修絕對門檻，不會降低聊天倍率或分數門檻；沒有相對爆量仍不會觸發。

### 驗證

`node --test Test/autoclip_v2.test.mjs Test/autoclip_history.test.cjs`、`npm run test:core`、`npm run lint`。

---

## 2026.11.05 04:00 人流指標卡改為 3×2、圖表刻度與摘要更易讀

**類型**: 改善 · **檔案**: `assets/traffic.css`、`assets/traffic.js`、`lang/zh-TW.json`、`lang/en.json`、`Docs/TRAFFIC.md`

### 問題 - 六張指標卡擠在一列，長標籤換行讓數值高低不齊；圖表刻度出現 1.2／2.4

`平均觀看（有效取樣分鐘）` 在窄卡片內換行，其他卡片較矮，數值沒有對齊；觀看圖的 Y 軸用最大值 ×0.5 產生 1.2／2.4，但觀看數是整數，刻度反而比線更難讀。

### 修改

- 桌面改為 3 欄 × 2 列；卡片改用 flex，數值固定貼底，標籤長短不再讓數字忽高忽低。
- 圖表依資料選擇整數或小數刻度：觀看數／筆數用 0、1、2 這類整數，比率才用小數。
- 觀看圖下方摘要改為平均、最高分鐘與發生時間、有效分鐘與樣本數。
- 沒有觀看取樣或沒有互動時，圖表中央直接顯示原因，不再只留空白格線。

### 驗證

`node Test/traffic_history_ui.cjs`、`npm run test:core`、`npm run lint`、`npm run check:css`。

---

## 2026.11.05 01:50 開播時段排名不再要求精確開播時間，estimated 也能達標

**類型**: 修正 · **檔案**: `assets/traffic-history.js`、`traffic.html`、`lang/zh-TW.json`、`lang/en.json`、`Test/traffic_history_ui.cjs`、`Docs/TRAFFIC.md`

### 問題 - 沒有精確開播時間就永遠算不出建議時段

歷史頁只把 `confidence === 'exact'` 當成可比較時段；TikTok 的 late、其他平台的 approx，以及沒有 actualStarted 的 estimated 全部被歸到「輔助時段」，即使已達 3 場／3 日期也不會進入比較。planner 卻已經用 `!cell.insufficient` 推薦同一個時段，兩邊結論矛盾。

### 根因 - 把「開播信心」當成排名資格，而不是標籤

`rankings()` 本身已把 estimated 放進 cells 並套用 3 場／3 日期門檻；問題只在 `assets/traffic-history.js` 的 `partial`／`enough` 只收 exact，並走到 assistedOnly 分支，跳過逐時段進度。

### 修改

- 排名資格改為只看資料量：3 場、3 個不同日期、開場觀測 ≥20 分鐘；開播信心只作表格標示。
- 主排名表加入「開播信心」欄；late／approx／estimated 可正常達標。
- 「下一步」與進度改用所有未達標時段計算，列出場次／日期與還差幾場。
- 新增「時段累積進度」表；暫定觀察保留 2 場／2 日期預覽。
- 時段界線文案改為 exact／late 15 分、approx／estimated 30 分；缺少開播時間但沒有樣本才標 missing。
- 卡片明示長場次只歸開播時段，跨小時觀看要看熱圖。
- 移除「正式排名需要 Twitch」的 assistedOnly 死路。

### 限制

- estimated 以第一次觀測估算；連線越晚，時段偏移越大，UI 會標示但無法自動修正。
- 3 場／3 日期仍是最低資料量，不代表統計可靠。

### 驗證

`node Test/traffic_history_ui.cjs`、`npm run test:ci`、`npm run lint`（CSS 指紋已重建）。

---

## 2026.11.05 00:53 觀眾數缺值不再歸零，避免跨平台人數亂跳

**類型**: 修正 · **檔案**: `TikTok.js`、`ScriptLib/viewers/counts.mjs`、`ScriptLib/tiktok/connection.mjs`、`ScriptLib/tiktok/events.mjs`、`ScriptLib/twitch/events.mjs`、`Test/viewer_counts.test.mjs`、`Docs/MODULES.md`

### 問題 - 短暫取不到觀眾數時 socket 直接送 0

TikTok `ROOM_USER` 的 `total` 可能是 `"0"` 或缺少欄位，`fetchRoomInfo` 也可能暫時沒有 `user_count`；原本這些情況會被 `|| 0` 折成 0 並立即送出，造成疊層人數從 2 跳到 0 再跳回。

### 根因 - 把「未知」當成「0」，且 `ROOM_USER` 直接覆寫合併數

- `ScriptLib/tiktok/events.mjs` 的 `ROOM_USER` 直接 `setCacheUserNum(viewerCount)`，把 TikTok 單平台數寫進跨平台合併值，會蓋掉 Twitch／YouTube／Odysee。
- `connection.mjs`、`TikTok.js` 多處用 `|| 0` 或 `Number(undefined)` 處理缺值。

### 修改

- 新增 `ScriptLib/viewers/counts.mjs`：只接受有限非負數；缺值保留上次值；正值變 0 需持續 60 秒才確認；明確離線用 `reset()` 立即歸零。
- `ROOM_USER` 改走 `setTikTokViewerCount` + `updateCombinedViewerCount`，不再直接覆寫合併數；無效人數不更新。
- Twitch `onViewer(null)`（明確離線）歸零；TikTok `STREAM_END` 強制歸零。
- 合併值只在實際變動或需要更新 `userList` 時才送 socket；AutoClip 與 traffic 取樣也改用收斂後的有效值，不會收到短暫 0。

### 限制

- 真正掉到 0 人時，UI 最多延後約 60 秒（或下一次確認）才顯示 0。
- 平台若在沒有離線事件的情況下停止更新，會保留最後已知人數。

### 驗證

`node --test Test/viewer_counts.test.mjs Test/tiktok_connection.test.mjs Test/tiktok_events.test.mjs Test/twitch_events.test.mjs`、`npm run test:core`（281 tests）、`npm run lint` 全過。

---

## 2026.10.25 00:30 跳過 userscript 頁面刷新時的舊聊天重播

**類型**: 修正 · **檔案**: `UserScript/TikTokChat.user.js`、`UserScript/liveCenter.user.js`、`Docs/USERSCRIPT_SOURCES.md`

### 問題 - 頁面刷新後舊聊天被重送到 `/chat`，AutoClip 可能被重複訊息觸發

TikTokChat／liveCenter 的 MutationObserver 啟動時，聊天室可能還在補上重新載入前的舊訊息；這些節點被當成新訊息送出，且 TikTok 聊天沒有穩定 msgId／sentAt，導致 `/chat` 與 AutoClip 收到重播的聊天。樣本中 6 則舊訊息／3 位使用者剛好觸發 AutoClip。

### 根因 - 觀察器只處理「新增節點」，沒有區分頁面 hydration 補齊與真正的新訊息

### 修改

- 兩個 userscript 在觀察器啟動時先標記既有聊天節點，並在之後 4 秒內忽略新增節點（`HYDRATION_MS`），避免刷新補齊期重播。
- 聊天節點沒有 `data-msg-id`／`data-message-id` 時，最後才使用節點 `id` 作為 msgId；仍保留 null，不偽造時間。
- 版本：TikTokChat 2.10 → 2.11、liveCenter 1.17 → 1.18。

### 限制

- 只處理頁面重新載入造成的初始補齊；若同時開啟兩支 userscript、或聊天室在 4 秒後才虛擬化重畫舊訊息，仍可能重複。不要同時啟用兩個來源。

### 驗證

`Test/userscript_source.test.mjs`、`lint`、`test:ci` 全過。

---

## 2026.10.23 17:10 修正 keyword 規則產生器的字串跳脫

**類型**: 修正／安全 · **檔案**: `assets/keyword.js`

### 問題 - CodeQL #46／#47／#48：規則片段只跳脫部分字元

`/keyword` 的規則產生器把名稱、正則、旗標與取代文字直接串進單引號字串或正規表示式；名稱完全未跳脫，取代文字、marker 只處理單引號，遇到反斜線、換行或其他引號時可能產生壞掉的片段。這是使用者主動複製到 `FilterRules.custom.js` 的程式碼，不是伺服器執行路徑，但仍應產生合法且安全的文字。

### 根因 - 手動選擇性跳脫，沒有統一的 JavaScript 字串編碼

### 修改

- 所有文字欄位改用 `JSON.stringify()` 嵌入，正確處理引號、反斜線與換行。
- 正則與旗標改成 `new RegExp(<JSON 字串>, <JSON 字串>)`，不再手動拼接 `/.../flags`。
- 保留原本的規則格式與數值欄位。

### CodeQL 其他舊 alert

- `SignServer/xgnarly.mjs` 與 `Docs/patched-plugins/tiktok-signature/xgnarly.mjs` 的 biased-random alert 是演算法 checksum 插入位置，不是安全隨機；改動會破壞 TikTok 位元組相容。
- `Docs/patched-plugins/.../webmssdk_5.1.3.js` 是第三方 TikTok SDK，`Math.random` 在其內部；不可修改。
- 上述路徑已在 `.github/codeql/config.yml` 的 `paths-ignore` 排除；既有 alert 是舊掃描留下的，應以 false positive／won't fix 關閉，不是本次新程式碼。

### 驗證

`node --check assets/keyword.js`、`lint`、`test:ci` 全過。

---

## 2026.10.23 16:40 補充 http-cache-semantics 無補丁與爭議

**類型**: 文件／安全 · **檔案**: `Docs/ChangeHistory.md`

### 事實

- `GHSA-ch52-4w7c-c8xp`（CVE-2026-93748）標示 affected `<=4.2.0`，**patched version 為 None**。
- 這是因為 advisory 沒有宣告修補版本；`http-cache-semantics 4.3.0` 是 2026-10-04 的一般新版本，不是官方確認的 security patch。`npm audit` 會因為 4.3.0 落在 affected range 外而顯示 0，但這不等於行為已被官方證實修補。
- 上游 issue #56 已被維護者關閉為 not planned；維護者主張 RFC 9111 允許共享帶 Set-Cookie 的回應，並認為這是誤報。GitHub advisory 可能仍待更新或撤回。

### 本專案的暴露面

`http-cache-semantics` 只透過 `tiktok-live-connector` → `got` → `cacheable-request` 引入，是 client-side cache 語意工具；本專案沒有執行跨使用者的 shared/proxy cache，也沒有把 `satisfiesWithoutRevalidation` 當成多用戶快取邊界。依 advisory 的攻擊前提，目前不具實際可利用路徑。

### 處置

- 保留最新的 4.3.0 與 `npm audit 0`，但不把它描述成已確認的安全修補。
- 不新增 override；`tiktok-live-connector` 仍維持 2.4.0。
- 若 Dependabot #105 在 advisory 更新後仍存在，因其為 disputed 且本專案不使用 shared cache，可考慮以「Vulnerable code is not in use」記錄處置，而不是宣稱已有補丁。
- follow-redirects #107／#108 是另一組有實際修補的 advisory，已由 1.16.1 處理；source-map-js #106 已由 1.2.2 處理。

---

## 2026.10.23 16:10 更新間接依賴安全修補

**類型**: 安全 · **檔案**: `package-lock.json`、`assets/app.css.build.json`

### 問題 - Dependabot 回報 follow-redirects 1.16.0 的 sensitiveHeaders 正規表示式缺陷

`follow-redirects` 1.16.0 的 `sensitiveHeaders` 會把自訂敏感 header 名稱串成正規表示式，但只跳脫部分元字元，漏掉 `^`、`|`、`[`、`{`、`}`。header 名稱可合法包含 `^` 與 `|`，因此 `X-Api^Key`、`X-Token|Secret` 這類名稱在跨來源重新導向時不會被剝除，憑證可能被送到攻擊者；在 `beforeRedirect` 才加入的名稱也不會生效。內建的 Authorization／Proxy-Authorization／Cookie 不受影響。

### 根因 - 上游 1.16.0 的過濾器快照與不完整跳脫

### 修改

- 將 `follow-redirects` 從 1.16.0 更新到 1.16.1（axios 的 `^1.16.0` 範圍可直接相容；`tiktok-live-connector` 維持 2.4.0）。
- 一併由 `npm audit fix` 更新兩個 transitive 高風險項目：
  - `http-cache-semantics` 4.2.0 → 4.3.0（經 got／cacheable-request）
  - `source-map-js` 1.2.1 → 1.2.2（Tailwind 建置鏈）
- `npm audit --omit=dev` 為 0 vulnerabilities；未改動直接依賴版本。
- 本專案目前沒有使用 `follow-redirects` 的 `sensitiveHeaders` 自訂選項，內建敏感 header 清單不受此缺陷影響；仍更新以消除供應鏈風險。

### 驗證

`npm audit --omit=dev`、`npm run test:ci`、`check:css` 指紋檢查全過。

---

## 2026.10.23 15:40 運行狀態頁卡片、來源模式與 toast

**類型**: 介面 · **檔案**: `runtime.html`、`assets/runtime-start.js`、`RuntimeRoutes.cjs`、`styles/app.css`、`lang/zh-TW.json`、`lang/en.json`、`Test/runtime_ui.cjs`、`Docs/RUNTIME.md`

### 問題 - 運行頁只有一張狀態卡與原始清單，看不到目前聊天來源，啟停也沒有明確回饋

原本 `/runtime` 只有 `<dl>` 指標與基本按鈕，沒有顯示 TikTok／YouTube 的 auto／native／browser／manual，也沒有 toast；停止是直接 POST 換頁。

### 根因 - 頁面只渲染生命週期，沒有把來源設定與操作結果做成可讀狀態

### 修改

- 狀態卡改為指標格線，加入 state dot；聊天來源卡顯示 TikTok／YouTube 的 configured／effective 與 badge。
- `/api/runtime` 增加 `sources`（不包含憑證）；TikTok auto 會解析成 native／browser，YouTube auto 顯示自動。
- 啟動選項改為卡片列，checkbox 與帳號欄位在深色介面下可讀；執行中仍鎖定。
- 新增右下角 toast：手動重新檢查、啟動、停止、恢復預設與錯誤；停止改成留在原頁 POST `/close` 後刷新。
- 加入 zh-TW／en 文案與 `Test/runtime_ui.cjs`，輸出桌面／手機截圖。

### 驗證

`node Test/runtime_ui.cjs`、`build:css`、`check:css`、`lint`、`test:ci` 全過。

---

## 2026.10.23 15:10 補上 TikTok／YouTube manual 聊天來源

**類型**: 功能 · **檔案**: `ScriptLib/tiktok/source.cjs`、`ScriptLib/youtube/source.cjs`、`ScriptLib/youtube/chat.mjs`、`TikTok.js`、`Server.js`、`config.html`、`.env.example`、`Test/tiktok_source.test.cjs`、`Test/youtube_source.test.cjs`、`Test/config_login_ui.cjs`、`Docs/BROWSER.md`、`Docs/YOUTUBE_BROWSER.md`

### 問題 - 自己接 Edge userscript 沒有明確模式，容易和程式來源重複

TikTok 只有 auto／native／browser；YouTube 沒有來源選單，會自動 native 或 browser。使用者自己開 Edge 時，程式仍可能同時產生第二份來源。

### 根因 - 沒有「程式不啟動來源、只收外部 userscript」的選項

### 修改

- TikTok `TIKTOK_CHAT_SOURCE` 新增 `manual`：不啟動原生、不開程式瀏覽器；只收 Edge userscript 的 `/chat`。browser 與 manual 都停用 AutoStop（無可信結束訊號）。
- 新增 `YOUTUBE_CHAT_SOURCE=auto|native|browser|manual`：
  - `native` 只用原生，缺少 OAuth 直接停止，不偷偷開瀏覽器。
  - `browser` 只用程式 headless＋內建 relay，不使用外部 userscript。
  - `manual` 不啟動原生／瀏覽器，只收外部 userscript。
  - `auto` 有 OAuth 用 native，否則 browser。
- 設定頁新增 YouTube 來源選單與 TikTok manual 選項；browser／manual 的文案明確區分「程式專用」與「自己的 Edge」。
- 原生 401／403 只在 `auto` 模式下才會轉 browser；`native` 不會偷換來源。
- 文件與 `.env.example` 同步；config UI 測試欄位數更新為 24。

### 驗證

`Test/tiktok_source.test.cjs`、`Test/youtube_source.test.cjs`、`Test/config_login_ui.cjs`、`lint`、`test:ci` 全過。

---

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
- 沒有 API Key 時不啟用觀眾數輪詢；觀眾數會缺少，聊天、過濾、翻譯、AutoClip 訊息熱度與 socket 照常。
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
