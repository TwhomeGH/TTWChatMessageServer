# Restream / TikTok Live Monitor 後續規劃

## 第一階段：使用者自行掛載

- [x] 新增 Restream UserScript，觀察官方監控連結、自動開新分頁，提供暫停與手動重開。
- [x] 加入穩定等待、DOM 重繪去重與同頁重載的已處理紀錄。
- [ ] 在實際 Restream 開播驗證：尚未開播沒有連結、開播後連結出現、新分頁可登入對應 TikTok 帳號。
- [ ] 取得 live_monitor 頁面聊天與統計的脫敏 DOM 樣本，驗證 `liveCenter.user.js` 相容性。
- [ ] 檢查既有 liveCenter 指標解析：缺欄位應為 null，不能把空字串當作 0；區分總觀看、頭號觀眾、累計觸及。
- [ ] 驗證既有原生聊天與 UserScript 並用時的跨管道去重、無訊息期間取樣及斷線恢復。
- [ ] 對照實際斷播紀錄測試監控頁開啟前後差異；未有證據前不標示防斷播功能。

- [x] 提供可拖曳、可收合且記憶位置的小型面板，收合時仍顯示監控摘要。

## 第二階段：專用瀏覽器整合

- [ ] 提供選用設定，將 Restream show 與 TikTok 監控分頁納入同一專用瀏覽器工作階段。
- [ ] 沿用正式登入流程與隔離設定，不複製或記錄 Cookie、token、密碼。
- [ ] 主動觀察監控連結出現／消失，以穩定 URL 與可見性判斷，不依賴雜湊 class。
- [ ] 建立每帳號／show 的分頁登記與跨分頁鎖，避免多個 Restream 視窗或多個助手重複開頁。
- [ ] 明確處理使用者手動關閉、瀏覽器重啟、SPA 導航、登入過期與連結長期殘留；不要無限重開分頁。
- [ ] 將狀態分成等待連結、已開監控頁、待登入、資料轉接中與資料過期；開頁成功不等於資料健康。
- [ ] 驗證背景分頁節流、休眠與資源用量；不要用反覆重載來掩蓋斷線。

## 驗收情境

- 無連結時零開頁；持續出現才開一次；重繪或短暫移除不重複。
- 非官方、隱藏或錯誤路徑的連結不觸發。
- 暫停、手動開啟、開啟失敗、跨 show 導航和重新整理行為可預期。
- 專用瀏覽器能對應正確帳號，並確認聊天／統計抵達本機服務，而非只確認分頁存在。

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
