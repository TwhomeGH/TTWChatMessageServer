# 運行狀態頁

執行 npm start 後，可開啟 /runtime 或由主控台導覽進入。
/open（保留原 query 啟動参数）與 /close 都回傳同一個頁面，移除固定 5 秒跳轉與純文字回應。
頁面將網址替換為 /runtime，重新整理不會再觸發啟停，每 2 秒讀取 GET /api/runtime。

顯示已停止、啟動中、程序執行中、停止中與失敗狀態，附 PID、啟用平台、運行時間及退出 code／signal。
程序執行中只表示作業系統已建立程序，登入與收訊需查看日誌。停止先送 EXIT 讓子程序優雅收尾；超過 15 秒仍未退出會強制終止（SIGKILL），子程序本身也在 8 秒後硬性退出。這是為了避免子程序卡在收尾（網路或 Puppeteer）而永遠停在停止中、讓之後的啟動永遠回 409。強制終止會寫入日誌。
重複停止不重送 EXIT，啟動已執行程序也只回傳狀態頁。停止中不可直接再次啟動。/close 與關機走同一段有界停止邏輯。

頁面使用狀態卡、指標格線、聊天來源卡與啟動選項卡；桌面寬度較寬，手機改成單欄。`GET /api/runtime` 除程序摘要外會附上 `sources`（TikTok／YouTube 的 configured／effective 模式），不包含環境變數值、認證或完整啟動 query。TikTok `auto` 會依簽名設定解析成 native／browser；YouTube `auto` 表示依 OAuth 決定，頁面以「自動」顯示。

重新檢查、啟動、停止與恢復預設會顯示右下角 toast；手動重新整理顯示「狀態已更新」，停止不再直接換頁，而是送出 `POST /close` 後留在原頁更新狀態。狀態查詢失敗只提示一次，避免自動輪詢洗版。

/runtime 與 /api/runtime 沿用原啟停／日誌端點的公開存取範圍，只回傳程序摘要，不提供環境變數、完整啟動 query 或日誌。
原 /status 純文字及 /status/stream 日誌介面保持相容；需要純文字的外部工具可改查 /status。

驗證：node --test Test/runtime_state.test.cjs Test/platform_manager.test.mjs Test/auto_stop.test.mjs；測試使用假程序，不啟動直播或通知。`node Test/runtime_ui.cjs` 使用 mock API 檢查來源卡、加開平台、toast、390px 寬度並輸出 `output/playwright/runtime-desktop.png`、`runtime-mobile.png`（需 Chrome／Edge，不在 `test:ci`）。

## 可視化啟動

在 /runtime 的「啟動選項」勾選 TikTok、Twitch、Kick、Odysee、YouTube 或 Socket、Bark、ntfy。平台勾選後顯示帳號／頻道欄位；留空沿用服務现有設定。帳號與開關存在此來源 localStorage 的 ttw.runtime.options，頁面不儲存 Token。預設全部不勾選，至少選一項才能啟動。「恢復預設」清空已記憶的選項與帳號。

按「啟動服務」透過 POST /api/runtime/start 送出 JSON，原頁顯示程序狀態。執行中或停止中鎖定選單；跨分頁重複啟動會回傳 409。GET /api/runtime/options 提供後端白名單。JSON 啟動要求必須來自相同 Origin。原 /open query 入口維持相容，共用同一程序啟動函數。

### 執行中加開平台

程序執行中可在「執行中加開平台」按鈕加開尚未啟用的平台，不需停止再啟動，monitor 場次、本場統計與觀眾數會延續。流程是 `POST /api/runtime/platforms`（JSON `{ "platform": "tiktok" | "twitch" | "kick" | "youtube" | "odysee" }`）→ 主服務以 IPC `ADD_PLATFORM` 通知既有子程序 → 子程序只啟動該平台並回報 `PLATFORM_STATE`。

- 同一平台在本次執行中只啟動一次；重複請求回 409 `PLATFORM_ALREADY_RUNNING`。
- 加開失敗會保留平台狀態與錯誤，允許再次嘗試；失敗不會中斷既有平台。
- TikTok browser／manual 模式加開時仍由既有來源設定決定是否開啟專用瀏覽器；不建立第二個原生連線。
- Kick、Odysee、YouTube 沒有可靠的直播結束訊號，加開後會停用自動停止，避免誤停既有平台。
- 目前只支援「加開」，不支援執行中移除單一平台；需要移除時仍停止整個子程序。
- 加開 Twitch 時 AutoClip 不會在事後補建；AutoClip 仍以啟動時是否已啟用 Twitch 為準。

Socket 使用既有 SOCKET_API 設定（可再用 SOCKET_APIS 加開多個端點，每端點可用 `?filter=類別` 只收指定分類）；Bark 與 ntfy 使用既有通知設定（BARK_API／NTFY_API）。「開啟設定」只導向設定頁。程序啟動成功不代表各平台已完成登入。

## 直播訊息監控面板

`/monitor`（別名 `/messages`）以 SSE 訂閱 `/status/stream/messages`，顯示子程序鏡像回主服務的每則 socket 訊息（時間／平台／分類／使用者／內容），可依分類（清單來自 `/api/message-categories`）與關鍵字篩選。此頁**不需要連線任何 socket 端點**：子程序每送出一則訊息都會鏡像回主服務（`ScriptLib/socket/monitor-relay.mjs`，具背壓上限）。

自動捲動以使用者意圖區分：圖片載入或列高變化會持續貼底，只有在 wheel／touch／拖曳／鍵盤主動往上時才暫停；離開底部後累計新訊息並顯示右下角「N 則新訊息 ↓」，點擊即回到最新。

工具列會顯示子程序維護的本場加入／點讚／聊天累計。數字隨 socket payload 的 `session` metadata 更新；點讚以原始 `data.count` 累加，因此與每位使用者的 60 秒顯示計數不同。點讚的 Bark／ntfy 通知會像加入事件一樣合併 3 秒，monitor 仍保留逐筆點讚列。

應用診斷（ReplyKit／外部 HTTP log bridge 與帶外 logio）顯示在 `/diagnostics`；可另外訂閱 ReplyKit SocketServer 的 external logs（沿用 `SOCKET_API` 目標），只存在記憶體，不寫 log／SQLite／聊天歷史。詳見 `Docs/DIAGNOSTICS.md`。

圖片（TikTok／Twitch 頭像、禮物圖與贊助 overlay 圖片）由 MediaCache 持久化到 `cache/media/` 與 `data/media.sqlite`，訊息改傳 `MEDIA_BASE_URL/media/<hash>.<ext>`；詳見 `Docs/MEDIA_CACHE.md`。

歷史訊息保存在 `data/monitor.sqlite`（`sessions`／`messages`）。每次 TikTok 子程序啟動是一場；預設保留最近 10 場、14 天、每場最多 20,000 則，可用 `MONITOR_HISTORY_DAYS`／`MONITOR_HISTORY_SESSIONS`／`MONITOR_HISTORY_MAX_MESSAGES` 調整。測試訊息與 `isTest` 不寫入；歷史 API 需要主服務登入，即時 SSE 仍維持原本公開行為。

monitor 工具列的「即時／歷史」切換會在歷史模式列出最近場次、支援搜尋／分類篩選與分頁；切回即時會恢復背景持續累積的 SSE 訊息。歷史查詢 API 為 `GET /api/monitor/sessions` 與 `GET /api/monitor/messages?session=…&page=…&q=…&categories=…`。

「測試訊息（本機預覽）」可輸入使用者、頭貼 URL、平台、分類與訊息；只加入目前頁面，不會送到 `/chat`、平台、filter、AutoClip 或統計。emoji 代碼由公開唯讀的 `/api/emoji/preview` 取得目前映射後在瀏覽器解析，停用或不存在的代碼保留原文。測試列有「測試」badge，重新整理或清除畫面即消失。

頭貼可手動輸入 HTTP(S) URL，或從目前 emoji map 的 active 項目中選取（同一 URL 只列一次）；選取後表單旁會即時顯示頭貼預覽，載入失敗會提示。使用者名稱、頭貼、平台與分類會保存在瀏覽器 `localStorage`（`ttw-monitor-test-prefs`），重新整理後還原；測試訊息本文不保存。「清除測試設定」會移除這組偏好。

另有「送 socket 測試」：確認後檢查 `/api/runtime`，再以 `isTest:true` POST `/chat`；需要 TikTok 子程序，會經過 filter／去重並可能被阻擋。頁面不會樂觀新增本機列，必須等 SSE 回顯；測試訊息仍由子程序處理，不直接偽造監控資料。

測試訊息帶 `testId`；子程序處理後經 IPC 回報 `sent`／`duplicate`／`filtered`／`ignored`／`offline`，主服務再推到 `/status/stream/test-results`。`duplicate` 會附上實際剩餘的 dedup 保護時間，monitor 顯示倒數；`sent` 也會從送出後開始顯示 60 秒保護。沒有結果時 5 秒（有勾選通知時 15 秒）後提示，不把 HTTP 200 當成已送達。

測試表單可勾選派發目標：

- `Socket`：是否送 SocketHub／overlay 並佔用去重。
- `通知`：是否呼叫已啟用的 Bark／ntfy；預設關閉，避免誤發。
- 結果會分開顯示 socket 狀態與通知通道（例如 `Bark` 成功、`ntfy` 失敗）；通知通道的逐項結果來自主服務轉回的 `TEST_RESULT`。

## 啟停日誌中的統計摘要

子程序在停止時仍回傳完整關鍵字快照供主服務快取與保存；主控台只顯示一行，例如 `[OUT] 關鍵字統計已同步 (完整快照，123 種留言)`。平時 `top10` 亦使用筆數摘要，不再重複列印原始 JSON 與解析後物件，也不將 `recent` 使用者／聊天明細複製進日誌。完整資料仍由關鍵字頁面使用，並未刪除統計。

Signer 關閉、優雅退出、退出碼及錯誤仍保留。格式錯誤的統計不覆蓋快取，解析錯誤訊息限制長度，避免異常輸出再次淹沒日誌。

## 子程序例外與啟動失敗

TikTok.js 的 `uncaughtException`／`unhandledRejection` 一律印出完整 stack（非 Error 的丟出值也能安全轉字串），不再只印訊息。

以 `startupComplete` 旗標區分階段，該旗標在頂層初始化最後一行才設 `true`：

- 啟動階段例外（旗標仍為 `false`）：視為致命。因為 ESM 頂層 `await` 一旦 reject，後續頂層程式不會再執行（例如 `connectSocket()` 沒跑到），程序會停在半初始化狀態——socket 只排隊不連線、`reconnects` 永遠是 0。此時印出「啟動階段致命錯誤」與 socket 診斷（`connected`／`queued`／`reconnects`），送 Bark 後 `exit 1`（附 5 秒硬性逾時）。
- 執行期例外（旗標為 `true`）：維持盡力而為，記錄、通知後繼續運作。

啟動階段最常見的原因是頂層 `await` 失敗，例如模組用錯 `fs`（見 [模組責任](MODULES.md)）、缺少必要環境變數或憑證。
