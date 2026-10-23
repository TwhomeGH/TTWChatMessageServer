# 持久化專用瀏覽器

## 啟動與查看

1. 安裝本機 Chrome 或 Edge，執行 npm install。
2. 執行 npm start，登入主服務後開啟 http://127.0.0.1:3332/browser。
3. 按「啟動專用瀏覽器」，在可見視窗登入 TikTok、完成網站驗證。
4. .env 設定 DIRECT_SIGNER_ENABLED=1 後重新啟動主服務／聊天子程序，載入新設定。若同時有 EulerStream key，仍優先使用 EulerStream；要指定本機簽名器請加 DIRECT_SIGNER_PRIORITY=1。

控制台提供分頁標題、去除查詢參數的網址及「顯示此分頁」；顯示操作會還原最小化視窗。
視窗可最小化到工作列，目前沒有系統托盤／PyQt6 介面。關閉瀏覽器視窗會中斷連線，重新啟動後下一次簽名請求會重試。
控制台的「已連線」僅代表 CDP 可達，不能證明已登入或簽名成功；登入、驗證與實際頁面請直接查看瀏覽器。

## 設定

| 環境變數 | 用途 |
| --- | --- |
| DIRECT_SIGNER_ENABLED=1 | 不必提供 Cookie 字串，即可啟用持久化瀏覽器簽名 |
| DIRECT_SIGNER_PRIORITY=1 | 同時有 EulerStream key 時優先本機簽名 |
| BROWSER_EXECUTABLE | 自訂 Chrome／Edge 執行檔完整路徑 |
| BROWSER_DEBUG_URL | 預設 http://127.0.0.1:9222，僅接受本機 HTTP 位址 |
| DIRECT_SIGNER_IMPORT_COOKIES=1 | 明確使用舊 TIKTOK_COOKIES／SESSION_ID 匯入；預設不覆蓋瀏覽器 Cookie |

Windows profile 固定保存在 LOCALAPPDATA/TTWChatMessageServer/browser-profile，其他系統使用 ~/.local/share/TTWChatMessageServer/browser-profile。
不使用日常 Chrome profile，也不把 Cookie 存進專案；Chrome 136 起遠端偵錯要求非預設資料目錄。
控制台沿用主服務的監聽位址與登入驗證，寫入操作另驗證相同 Origin。瀏覽器 CDP 仍只限本機。CDP 可控制已登入瀏覽器，不要轉發偵錯埠到網際網路或區網。
若自行提供 CDP 瀏覽器，控制台顯示的 profile 路徑是啟動器設定，不能證明外部程序實際使用的資料夾。

## TikTok 聊天來源（無 EulerStream 時）

`TIKTOK_CHAT_SOURCE` 控制聊天從哪裡來：

| 值 | 行為 |
| --- | --- |
| `auto` | 有 `SIGN_API_KEY`／`TIKTOK_COOKIES`／`SESSION_ID`／`DIRECT_SIGNER_ENABLED=1` 時用原生；否則用專用瀏覽器 |
| `native` | 強制原生 TikTok 連線，需要可用的簽名設定 |
| `browser` | 不啟動原生 TikTok 聊天；由**程式的專用瀏覽器**（不是日常 Edge）開啟 `tiktok.com/@handle/live`，TikTokChat userscript 送到 `/chat` |
| `manual` | 不啟動原生、也不開程式瀏覽器；只等你自己在 Edge／Tampermonkey 的 TikTokChat userscript 送到 `/chat` |

- `browser` 模式不需要 EulerStream；請在**同一個專用瀏覽器 profile** 安裝一次 Tampermonkey 與 `UserScript/TikTokChat.user.js`。這個 profile 由程式管理，**不是**你的日常 Edge。
- runtime 啟動 TikTok 且來源為 browser 時，主服務會在專用瀏覽器開啟（或重用）直播分頁；不要另外開 Edge 掛同一支腳本，否則會有兩份來源。
- `manual` 才是自己用 Edge／Tampermonkey：程式不開瀏覽器，只收 `/chat`。選 manual 時請確認 Edge 那支腳本已開啟；不要同時再選 browser。
- browser／manual 都沒有可靠的 TikTok 觀眾數，AutoStop 也會停用（瀏覽器端沒有可信的直播結束訊號）。
- 聊天訊息仍會經 `/chat` 進入 TikTok 子程序、過濾、翻譯、AutoClip 與 socket。

## 生命週期與模組

- ScriptLib/browser/config.cjs：本機端點及專用 profile。
- controller.cjs：尋找瀏覽器、啟動可見視窗、分頁摘要及視窗還原。
- routes.cjs：本機管理 HTTP 入口。
- session.mjs：合併連線請求、追蹤自有分頁、關閉時斷線。
- BrowserRoutes.cjs、OtherTool/browser/index.html：主服務 /browser 控制台。

聊天服務不再下載或自行啟動瀏覽器，不覆寫 User-Agent／平台，也不阻擋圖片和樣式。
停止服務會關閉該程序建立的工作頁、disconnect，保留瀏覽器與使用者登入頁；強制終止程序可能留下工作頁。
連線或 SDK 初始化失敗冷卻 10 秒，後續請求可重試；不自動通過網站驗證。
瀏覽器 Cookie 只在本機瀏覽器請求中自然使用；這次沒有將 Cookie 自動匯出到 Node 的其他網路請求。

## 依賴遷移與驗證

已移除 tiktok-signature、puppeteer-extra-plugin-stealth 及完整 puppeteer，改用 puppeteer-core 25.11.0。
原本使用的 SDK 原樣保存在 SignServer/sdk，來源與 SHA-256 見該目錄的 manifest.json。
新依賴鏈不再包含 extract-zip；不要以舊文件的「無法移除 Puppeteer」判斷目前狀態。
更新依賴後若使用專案修補，執行 node Docs/apply-patches.mjs；npm／Yarn 重裝可能覆蓋 node_modules 的 patch。

npm run test:ci 包含瀏覽器模擬測試；這些測試不啟動瀏覽器、不登入 TikTok。
驗收實機功能需確認視窗還原、登入保留、服務重啟、自有分頁清理，以及 SDK 初始化和直播收訊。

管理 API：GET /api/browser/status、POST /api/browser/start、POST /api/browser/show，全部需有效主服務登入 Cookie。
舊 scripts/browser.cjs 只顯示遷移提示，不再監聽 3333；BROWSER_PANEL_PORT 已停用。
既有服務需重新啟動才能載入新增路由。此管理頁控制的是伺服器所在電腦的瀏覽器視窗。
