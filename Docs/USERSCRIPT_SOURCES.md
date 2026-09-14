# Userscript 平台與管道

撰寫或修改轉接腳本請先看獨立的 [/chat 入口與參數文件](CHAT_API.md)，包含聊天／觀眾範例、欄位型別、測試標記與 HTTP 回應。

平台和接收管道是兩個獨立欄位。平台白名單為 TikTok、Twitch、Kick、Odysee、Youtube；
名稱不分大小寫。缺少平台、舊值 Userscript 或無法辨識的值歸為 `Unknown`，
頁面顯示「未知來源」。未知來源仍是有效熱度統計組，套用相同的留言量、
發言人數、去重及洗頻門檻，不會只因無法辨識而被排除。

- `platform`：原始訊息平台，無法取得就不猜。
- `transport`：`api`（API／直連）或 `userscript`。`/chat` 入口強制標記為 userscript。
- `msgId`：平台原始訊息 ID；沒有就傳 null，不能用隨機數冒充平台 ID。
- `sentAt`：可取得的原始發送時間；沒有就傳 null。`observedAt` 是瀏覽器看見的時間，
  不會當成平台發送時間；伺服器另記錄 `receivedAt`。
- `isTest: true`：測試按鈕的合成資料，不參與自動剪輯。一般未知來源不帶此標記。
- `audienceKind: top-fans`：頭號觀眾名單大小不是總觀眾數，不納入觀眾熱度。

同平台相同 ID，跨管道只計一次；至少一邊沒有 ID 時，使用同平台、同使用者名稱、
同內容在 3 秒內跨管道出現的保守去重。不同真實 ID 不合併，同管道的無 ID 新留言
不會單憑同內容被此規則丟棄。沒有原始 ID 無法保證所有延遲情況下都能準確去重。
不同平台不因姓名或 ID 相同而互相排除。

keyword 同時顯示平台和接收管道；autoclip 平台貢獻列顯示最近觀察到的管道，
API＋Userscript 是同一個平台的兩個入口，不拆成兩份平台分數。
舊資料中的 Userscript 名稱只在畫面上標示為未知來源，不猜測或補造原始平台。

## 已更新版本

| 檔案 | 新版 |
|---|---|
| TikTokChat.user.js | 2.7 |
| liveCenter.user.js | 1.10 |
| youtube-chat-userscript.user.js | 1.1 |
| TestCenter.user.js | 1.5 |
| ws-relay.user.js | 1.1 |
| ws-relay.js | 1.2 |

聊天 DOM 沒有可靠 ID／時間欄位時保留 null。WS relay 附帶來源欄位，但仍維持原本
的原始資料轉接流程，沒有新增解碼功能。未修改功能的其他腳本不更動版本。

需要更新瀏覽器中安裝的腳本，並重新啟動伺服器與聊天程序。
自動剪輯預設為影子模式；正式執行條件見 [自動剪輯說明](KEYWORD_AUTOCLIP_V2.md)。
