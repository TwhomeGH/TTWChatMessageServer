# ChangeHistory

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

### 修改 - 抽出 chat.mjs（deps 注入）

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

### 修改 - 抽出 chat.mjs（deps 注入）

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
