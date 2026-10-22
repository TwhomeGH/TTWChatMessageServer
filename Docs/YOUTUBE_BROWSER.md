# YouTube 無 OAuth 的專用瀏覽器 fallback

`liveChatMessages.list` 需要 OAuth；只用 API Key 會在聊天室輪詢得到 403。當 OAuth 失效或沒有授權時，程式可以改用專用瀏覽器開啟**實際觀看頁**，從頁面的聊天室 iframe 讀取訊息。

## 行為

- 觸發條件：啟動時只有 API Key（沒有 bearer token），或原生聊天室輪詢遇到 401／403。
- 先用 API Key 解析目前直播的 `videoId`，再用專用瀏覽器開啟
  `https://www.youtube.com/watch?v=<videoId>`。
- 在頁面的 `/live_chat` iframe（沒有 iframe 時在主頁面）注入 relay，監聽
  `yt-live-chat-text-message-renderer`；訊息透過 Puppeteer binding 回到 Node，
  不依賴 `GM_xmlhttpRequest` 或瀏覽器 CORS。
- 瀏覽器訊息和原生 API 走同一條管線：主播歸屬、過濾、表情、翻譯、
  AutoClip、人流統計與 `sendChat`。
- 觀眾數仍由 API Key 的 `videos.list` 每 60 秒更新。
- 404／410（聊天室已結束）不啟動瀏覽器；停止直播或關閉程式時會關閉瀏覽器。

## 設定

```dotenv
YOUTUBE_BROWSER_FALLBACK=1
YOUTUBE_BROWSER_HEADLESS=1
YOUTUBE_BROWSER_PROFILE=data/youtube-browser-profile
# YOUTUBE_BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

- `YOUTUBE_BROWSER_FALLBACK=0` 可完全停用。
- 未設定 `YOUTUBE_BROWSER_PATH` 時會依序找 Chrome、Edge、Chromium；
  也可以用 `CHROME_PATH`。
- `YOUTUBE_BROWSER_PROFILE` 是**專用** profile；不要指向日常 Chrome profile，
  避免與已開啟的瀏覽器搶 lock。整個資料夾已在 `.gitignore` 排除。

### 第一次登入／同意

YouTube 可能需要登入、cookie 同意或聊天室驗證。第一次可設定
`YOUTUBE_BROWSER_HEADLESS=0`，讓專用瀏覽器顯示出來，手動完成後再改回 `1`。
登入狀態會留在專用 profile；程式不讀取或記錄密碼。

## 限制

- 依賴 YouTube 的 DOM 與聊天室 iframe；YouTube 改版可能讓 relay 失效。
- Headless 可能被 YouTube 判定為非一般瀏覽器；遇到空白頁或沒有聊天室時改用 headed。
- 沒有 OAuth 時無法使用原生 super chat／會員事件的完整欄位；瀏覽器 relay 以文字訊息為主。
- 專用瀏覽器比 API 輪詢耗資源；只作為沒有 OAuth 的 fallback。
- 讀不到聊天室時會記錄一次原因並停止，不會無限重開瀏覽器。

## 驗證

`Test/youtube_browser_ui.mjs` 用本地 watch 頁＋聊天 iframe 啟動 headless Chrome，
確認 relay 能收到既有與後續訊息；找不到瀏覽器時測試會 skip。
