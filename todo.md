# Restream / TikTok Live Monitor 後續規劃

> 2026-11-06 更新：補上 endpoint 設定、預覽自動暫停、Restream 指標診斷與 WAF 403 修復。

## 2026-11-06 近期完成

- [x] 所有轉接 userscript 的主服務位址可設定（`ttw-main-endpoint`、`GET /ping`）。
- [x] Restream 助手自動暫停預覽（1.2.0；可取消）。
- [x] Restream 指標診斷：`POST／GET /restream/metrics` 與 `/restream` 觀察頁（1.3.0）。
- [x] 專用瀏覽器 TikTok `_waftokenid` 過期 403 的主動清理、背景監看與重試。

### 新增待辦

- [ ] WAF 修正後重啟主服務的實機驗證。
- [ ] 集中式 endpoint 設定頁（可選；目前每個腳本各自設定）。

## 訊息診斷後續（2026-11-06）

- [x] monitor 測試訊息精確結果：`testId`、child IPC、`/status/stream/test-results`、sent／duplicate／filtered／ignored／offline 與去重倒數。
- [x] 測試派發目標（Socket／通知）與 Bark／ntfy 逐通道結果；通知預設關閉。
- [x] monitor 本場加入／點讚／聊天統計與點讚通知 3 秒聚合。
- [ ] 獨立 `/dedup`（或 `/diagnostics/dedup`）診斷頁：最近 test results、其他送入訊息的去重狀態查詢與剩餘冷卻；由 monitor／runtime 提供入口。
- [x] monitor 歷史 SQLite 持久化、最近場次 API 與即時／歷史切換。
- [x] Signer TikTok 導航節流與 WAF 403 冷卻，避免 fetch page 重建風暴。
- [x] 圖片媒體快取 Phase 1：本地 `/media/<hash>`、SocketHub 頭像／禮物圖與 AdOverlay 圖片改寫。
- [x] Python overlay 支援 img／giftImg／AdOverlay icon 與訊息內嵌 data URI。
- [x] monitor MediaCache 檢視／本地連結複製與 Raw Socket 測試入口。
- [ ] 正式環境以實際 child 程序驗證 IPC 結果與倒數（目前 monitor UI 使用假 SSE／fake `/chat`）。

## 表情映射後續（2026-11-06）

- [x] Phase 1：`emoji_map.json` 只讀預設；`emoji_map_local.json` 支援 `url`／`enabled`、停用預設、恢復預設、自訂刪除與管理頁開關。
- [ ] Phase 2：data URI 可選來源。允許 `data:image/(png|jpeg|gif|webp);base64,...`、大小上限；SVG 因主動內容／腳本注入風險不直接放行（必要時伺服器端 rasterize）。管理頁預覽與 `/emoji/image` 解碼。
- [ ] Phase 3：接收端 capability。`replaceEmojis` 依 target 決定是否輸出 data URI；不支援的聊天／通知保留原始代碼，不送 base64。
- [x] 真實 route／UI 整合（temp 雙檔）：停用／恢復預設、local 只寫、預設檔不變、重新載入後保留。
- [ ] 正式環境手動驗證：登入、正式 `emoji_map.json`、Server.js 重啟與預設檔更新穿透。
- [ ] 決定預設檔是否統一成 v2（目前 hybrid；非必要）。
- [ ] data URI 的訊息長度限制與各平台／通知實際支援矩陣。
- [ ] 安全性：`image_cache` 目前只檢查 `image/*`，遠端 HTTP SVG 也需拒絕或伺服器端 rasterize，避免直接開啟 `/emoji/image` 時執行 SVG 腳本。

## 第一階段：使用者自行掛載

- [x] 新增 Restream UserScript，觀察官方監控連結、自動開新分頁，提供暫停與手動重開。
- [x] 加入穩定等待、DOM 重繪去重與同頁重載的已處理紀錄。
- [ ] 在實際 Restream 開播驗證：尚未開播沒有連結、開播後連結出現、新分頁可登入對應 TikTok 帳號，以及自動暫停預覽、指標能送到 `/restream`。
- [ ] 取得 live_monitor 頁面聊天與統計的脫敏 DOM 樣本，驗證 `liveCenter.user.js` 相容性。
- [x] 檢查既有 liveCenter 指標解析：缺欄位回 null，不把空字串當 0；`audienceKind` 區分總觀看與頭號觀眾。程式與測試完成，實機資料仍待驗。
- [x] 驗證既有原生聊天與 UserScript 並用時的跨管道去重、無訊息期間取樣及斷線恢復。程式與測試完成，實機仍待驗。
- [ ] 對照實際斷播紀錄測試監控頁開啟前後差異；未有證據前不標示防斷播功能。

- [x] 提供可拖曳、可收合且記憶位置的小型面板，收合時仍顯示監控摘要。

## 第二階段：專用瀏覽器整合

- [ ] 提供選用設定，將 Restream show 與 TikTok 監控分頁納入同一專用瀏覽器工作階段。
- [x] 沿用正式登入流程與隔離設定，不複製或記錄 Cookie、token、密碼。專用 profile；`DIRECT_SIGNER_IMPORT_COOKIES` 仍是 opt-in 舊路徑。
- [x] 主動觀察監控連結出現／消失，以穩定 URL 與可見性判斷，不依賴雜湊 class。
- [ ] 建立每帳號／show 的分頁登記與跨分頁鎖，避免多個 Restream 視窗或多個助手重複開頁。
- [ ] 明確處理使用者手動關閉、瀏覽器重啟、SPA 導航、登入過期與連結長期殘留；不要無限重開分頁。
- [ ] 將狀態分成等待連結、已開監控頁、待登入、資料轉接中與資料過期；開頁成功不等於資料健康。
- [ ] 驗證背景分頁節流、休眠與資源用量；不要用反覆重載來掩蓋斷線。

## 驗收情境

- [x] 無連結時零開頁；持續出現才開一次；重繪或短暫移除不重複。
- [x] 非官方、隱藏或錯誤路徑的連結不觸發。
- [x] 暫停、手動開啟、開啟失敗、跨 show 導航和重新整理行為可預期。程式與測試完成，實機仍待驗。
- [ ] 專用瀏覽器能對應正確帳號，並確認聊天／統計抵達本機服務，而非只確認分頁存在。

## 程式碼整理：平台模組化與後續（2026-09-30 起）

### 已完成

- [x] Kick token 抽出 `ScriptLib/kick/tokens.cjs`（Server.js 與
  TikTok.js 共用）。
- [x] Odysee 抽出 `ScriptLib/odysee/chat.mjs`。
- [x] YouTube 抽出 `ScriptLib/youtube/tokens.cjs`（共用）與
  `ScriptLib/youtube/chat.mjs`。
- [x] Twitch SDK 生命週期抽出 `ScriptLib/twitch/client.mjs`。
- [x] 平台與核心模組補齊 JSDoc（deps typedef 與匯出函式）。
- [x] ESLint 導入並清乾淨（排除第三方 SDK／樣本、修 ESM
  sourceType、補 catch 日誌）。

### Twitch 後續（聊天與剪輯仍在 TikTok.js）

- [ ] Twitch 聊天事件處理（filter／翻譯／sendSocket／`G#Ad`／
  `G#clip` 指令）收進 `ScriptLib/twitch/chat.mjs`。
- [ ] 決定 `handleGAd`（贊助廣告）歸屬：收進 `twitch/chat.mjs`，
  或留在 TikTok.js 由 deps 注入。
- [ ] 剪輯（`craeteTwitchClip`／`resolveClipTitle`／`clip_history`）
  抽成 `ScriptLib/twitch/clips.mjs`。
- [ ] Twitch OAuth 路由（Server.js 的 `/twitch-oauth-*`）是否也集中。

### 自動剪輯時間準確性

- [ ] 實跑幾場直播，收集 `🎯 [AutoClip] 時間量測`（peak→請求延遲、
  峰值在片段第幾秒、涵蓋率）與 `/autoclip` 頁面數據。
- [ ] 依量測結果決定是否改用 `createClipFromVod`（以 `peakAt`
  指定 `vodOffset`）精準建成。
- [ ] 檢視 `createAfterDelay`（has_delay）只套用於手動剪輯是否合理。

### 其他尚未模組化的大塊（逐一評估）

- [ ] 贊助廣告系統（`handleGAd`／`sponsorAds`／`adTimers`）。
- [ ] AutoClip 接線（`AutoClipManager`、`pushAutoClipStats`、5 秒評估）。
- [ ] TikTok 原生連線（`connection`／事件處理）是否抽出。
- [ ] ESLint 保留但未使用的函式（`fetchAndSyncGifts`、
  `scanShadowRoots`、`updateInfo`、`sampleRunTarget`）處置。
