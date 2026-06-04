# TTWChatMessageServer

## 簡介

`TTWChatMessageServer` 是一個聊天室訊息服務器，可對接 **TikTok**、**Twitch** 與 **Kick** 的直播聊天室訊息，支援以下功能：

- 即時接收聊天室訊息
- 支援禮物、關注、加入、分享等事件
- 可推送到 **Bark** 或 **Socket**
- 可透過簡單 HTTP 接口開關服務
- 可透過簡單 HTTP 接口快速修改BARK/SocketAPI配置

---

## 最近更新

新增 Socket 最多重試上限
在`env`文件裡設置 最大重試次數 `SOCKET_RETRY_MAX_COUNT` 預設 最多3次

新增了聊天室訊息翻譯功能
如果語言不是中文會自動使用`env`裡的配置的翻譯API 進行翻譯
暫時還提供設置 控制哪一種語言以外才翻譯
不過你也可以透過更正**TranslateTest.js** 
function isChinese() 的判斷條件 來更正那個你的母語

未來版本 會去補充更正此環節 讓他可由手動配置 目前暫時未處理

## 安裝與環境設定

### 1. 安裝依賴

```bash
npm install
```

### 2. 建立 .env 檔案

在 TikTok.js 目錄下建立 .env，可參考範例：

主要請以 `Docs/envExample` 裡的為準

```env
# Twitch 設定
CLIENT_ID=你的Twitch Client ID
CLIENT_SECRET=你的Twitch Client Secret

# EulerStream API 簽名API (TikTok用)
SIGN_API=你的簽名API

# TikTok 設定
TIKTOK_NAME=coffeelatte0709
SESSION_ID=你的TikTok sessionid
TT_TARGET_IDC=你的TikTok Target IDC

# 推送設定
BARK_API=https://api.day.app/你的BarkKey
SOCKET_API=http://192.168.0.195:9322

# Kick 設定（OAuth 選填，閱讀公開聊天不需設定）
KICK_CLIENT_ID=你的Kick Client ID
KICK_CLIENT_SECRET=你的Kick Client Secret
KICK_USER_NAME=你的Kick頻道名稱

# 禮物翻譯設定（可選）
TRANSLATE_API_URL=https://api.mymemory.translated.net/get
TRANSLATE_SOURCE_LANG=en
TRANSLATE_TARGET_LANG=zh-TW
GIFT_TRANSLATE_PREFILL_LIMIT=10
```

⚠️SESSION_ID / TT_TARGET_IDC 需要從已登入TikTok網頁Cookie裡取得

⚠️CLIENT_ID / CLIENT_SECRET 需從 Twitch 開發者平台取得

禮物翻譯補充：

- 收到禮物時，系統會優先讀取 `gift_map.json` 的對應翻譯。
- 如果禮物名稱尚未建立對應，會先加入 `gift_map.json`，再嘗試呼叫免費翻譯 API 補上翻譯。
- 啟動時 `fetchAvailableGifts()` 也會同步輸出 `gift_list.json`，並依照 `GIFT_TRANSLATE_PREFILL_LIMIT` 預先補一部分未翻譯的禮物名稱。
- 若你想手動修正翻譯結果，直接編輯 `gift_map.json` 即可，之後事件會優先使用你手動設定的內容。

### 3. 建立 tokens.json 範例

用於 Twitch OAuth，初始內容可為：

可參閱Docs/tokens.json

```json
{
  "accessToken": "",
  "refreshToken": "",
  "scope": [
    "bits:read",
    "channel:read:goals",
    "channel:read:redemptions",
    "channel:read:subscriptions",
    "chat:read",
    "clips:edit",
    "moderator:read:followers",
    "user:read:chat"
  ],
  "expiresIn": 0,
  "obtainmentTimestamp": 0
}
```

## 啟動服務

## 服務器預設運行在 Port 3332，提供 HTTP 控制介面

### 1. 查看使用說明

```bash
http://localhost:3332/help
```

### 2. 啟動聊天室訊息服務

```bash
http://localhost:3332/open?user=你的TikTok名&twitchUser=你的Twitch名&kickUser=你的Kick名&isSocket=1&isTwitch=1&isTK=1&isKick=1&isBark=1
```

參數說明：

| 參數 | 說明 |
| -- | -- |
| user | TikTok 用戶名稱（給 isTK 使用），若不設使用 .env 的值 |
| twitchUser | Twitch 用戶名稱（給 isTwitch 使用），若不設使用 .env 的值 |
| kickUser | Kick 頻道名稱（給 isKick 使用），若不設使用 .env 的值 |
| isTK=1 | 啟用 TikTok 直播聊天室 |
| isTwitch=1 | 啟用 Twitch 直播聊天室 |
| isKick=1 | 啟用 Kick 直播聊天室 |
| platforms=tiktok,twitch,kick | 自由組合平台（逗號分隔），例如 `twitch,kick`、`tiktok,twitch`、`tiktok,kick` |
| isBoth=1 | （已棄用，建議改用 `platforms=tiktok,twitch`） |
| isBark=1 | 啟用 Bark 推送通知 |
| isSocket=1 | 啟用 Socket 訊息推送 |

> [!WARNING]
> 補丁服務器 重複訊息檢查功能
> 已經直接合併到TikTok.js/Server.js裡
> 以下參數不再使用
>
> - isWeb 啟用備用UserScript監聽服務器
>
> - isDelay 啟用延遲2秒後檢查重複訊息
> - isRepeat 啟用重複訊息檢查

範例：

```bash
http://localhost:3332/open?user=coffeelatte0709&isTK=1&isBark=1
# 或指定 Twitch：
http://localhost:3332/open?twitchUser=coffeelatte0709&isTwitch=1&isBark=1
# 或指定 Kick：
http://localhost:3332/open?kickUser=你的頻道名&isKick=1&isBark=1
```

### 3. 關閉聊天室訊息服務

```bash
http://localhost:3332/close
```

會嘗試優雅關閉子進程，並發送最後一條訊息。

## Kick 聊天室整合

### 快速啟動（不需 OAuth）

Kick 公開聊天室可直接透過 WebSocket 讀取，不需任何授權：

```bash
http://localhost:3332/open?kickUser=你的頻道名&isKick=1&isSocket=1&isBark=1
```

### 支援的事件

| 事件 | 說明 |
|------|------|
| `ChatMessage` | 即時聊天訊息 |
| `Subscription` | 新訂閱 |
| `GiftedSubscriptions` | 贈送訂閱 |
| `UserBanned` | 用戶被封禁 |
| `UserUnbanned` | 用戶解封 |
| `StreamHost` | 主機轉播 |

### OAuth 設定（選填，發送訊息用）

如需發送訊息或存取私有 API，可設定 Kick OAuth：

1. 前往 [Kick Dev Portal](https://dev.kick.com/) 註冊應用程式
2. 設定 Redirect URI 為 `http://localhost:3332/get-kick-token`
3. 在 `.env` 填入 `KICK_CLIENT_ID` 與 `KICK_CLIENT_SECRET`
4. 瀏覽器開啟 Kick 授權 URL（由系統產生），授權完成後自動啟動聊天監聽

Token 會自動儲存至 `kick_tokens.json`，並在過期時自動刷新。

### 從 Browser 啟動

```bash
http://localhost:3332/open?kickUser=你的頻道名&isKick=1&isBark=1&isSocket=1
```

### Kick + Twitch + TikTok 同時運行

```bash
http://localhost:3332/open?user=你的TikTok名&twitchUser=你的Twitch名&kickUser=你的Kick名&isTK=1&isTwitch=1&isKick=1
```

### 注意事項

- Kick 公開聊天不需 OAuth，直接填入頻道名稱即可
- OAuth 僅用於發送訊息等進階功能
- `kick-wss` 套件負責底層 WebSocket 連接，自動重連

### kick-wss 修正版

原版 `kick-wss` 有兩個問題導致無法正常連接 Kick 聊天室：
1. `getChannelInfo` 缺少必要 HTTP headers（User-Agent、Referer、Origin），被 Cloudflare 阻擋（403）
2. `LEGACY_EVENT_MAPPING` 將 Pusher 事件名 `App\Events\ChatMessageEvent` 錯誤轉換為短名，導致 switch 比對失敗

修正後的完整套件請參閱 `Docs/kick-wss.zip`，解壓後可取代 `node_modules/kick-wss/`。

修改內容：
| 檔案 | 修改 |
|------|------|
| `dist/WebSocketManager.js` | 支援 `channelId` 選項，省略 API 呼叫 |
| `dist/WebSocketManager.js` | `_channelIdExplicit` 旗標正確判斷是否跳過 API |
| `dist/MessageParser.js` | 移除 `LEGACY_EVENT_MAPPING` 錯誤的正規化 |

## 其他功能

### 分支文件功能說明 

- [主服務器的其他功能說明 Service.md](./Service.md)

### 1. 查看服務狀態

- 一次性狀態查詢

```bash
http://localhost:3332/status
```

- 實時 SSE 狀態

```bash
http://localhost:3332/status/stream
```

預設根目錄就是SSE查詢 展示

```bash
http://localhost:3332/
```

- 訊息次數統計

```bash
http://localhost:3332/keyword
```

- 本地日誌查看

```url
http://localhost:3332/logViewer
```

> [!TIP]
> 用於統計重複訊息 以便屏蔽煩人廣告關鍵字用
>
> 或者做熱門關鍵字統計用
>

### **額外補充**

> [!WARNING]
> 記得修正目錄下 `keyword.html`
>
> 指向EventSource源到內網使用記得修
>
> [http://你自己的本地內網IP:3332/status/keyword](http://你自己的本地內網IP:3332/status/keyword)
>

![關鍵字統計畫面](Docs/Keyword2.png)

目前也加了 **複製按鈕** 方便快速複製添加

可以用此來判斷那些**廣告帳號**老是刷的**關鍵字**

以便後續加入封鎖關鍵字 或**自動禁言規則**裡

### 2. 修改環境變數

可快速修改 .env 的 BARK_API 與 SOCKET_API：

```bash
http://localhost:3332/config
```

表單提交後會立即更新 process.env，下一次 /open 將生效

現在已添加配置頁存取密碼 對應env的`CONFIG_KEY`進行密碼設置

# Config Editor 認證流程

## 入口
- 使用者訪問 `http://localhost:3332/config`
- 如果尚未登入，系統會自動導向至 `login.html`

## 登入
- 在 `login.html` 輸入密碼並送出
- 後端驗證成功後，會產生一組隨機 **Token**
- Token 透過 **Set-Cookie** 寫入瀏覽器 (`authToken`)
- Token 有效期為 **14 天**

## 使用
- 之後訪問 `/config` 時，瀏覽器會自動帶上 Cookie
- 後端檢查 Cookie 中的 Token 是否有效：
  - **有效** → 顯示 `config.html` 並填入環境變數
  - **無效或過期** → 導向回 `login.html`

## 登出
- 使用者在 `config.html` 點選「登出」按鈕
- 前端呼叫 `/logout`
- 後端回應 `Set-Cookie: authToken=; Max-Age=0`，清除 Cookie
- 使用者被導回 `login.html`

## Token 有效期
- 每次登入會生成一組新的 Token
- Token 有效期為 **14 天**
- 過期後需要重新登入
- 使用者也可以手動點選「登出」來清除 Cookie
- 

## 日誌與錯誤

所有運行日誌會在瀏覽器根目錄 SSE 頁面即時顯示，也會輸出到控制台

## 注意事項

1. 修改 .env 後，需要重新 /open 才能讓新設定生效
2. 本服務建議保持內網或私人環境使用
3. TikTok session 過期需重新抓取

## 訊息過濾系統 (MessageFilter)

`MessageFilter.js` 為統一的訊息過濾與統計模組，同時被 `TikTok.js` 與 `Server.js` 引用，提供三種過濾動作：

### 規則結構

```js
{
  name:   '規則說明',                    // 用於日誌辨識
  field:  'user' | 'message' | 'any',    // 檢查對象
  action: 'block' | 'replace' | 'delete', // 預設 'block'

  // block 模式：回傳 true 表示阻擋
  test: (value) => boolean,

  // replace / delete 模式：
  match:       /pattern/g,      // 要匹配的 pattern
  replacement: '取代文字'        // replace 專用，delete 強制為 ''
}
```

### 三種模式

| 模式 | 說明 | 使用時機 |
|------|------|----------|
| `block` | 完全阻擋該筆訊息 | 廣告帳號、無意義內容 |
| `replace` | 將匹配文字取代為指定內容 | 遮罩髒話、敏感詞 |
| `delete` | 刪除匹配文字，其餘保留 | 移除網址、特定關鍵字 |

### 匯出 API

| 函數 | 說明 |
|------|------|
| `addFilterRule(rule)` | 新增一條規則 |
| `addFilterRules(rules)` | 批量新增 |
| `processFilter({ user, message })` | 完整處理，回傳 `{ user, message, blocked, reason, field, modified }` |
| `checkFilter(input)` | 僅檢查是否阻擋（向後相容） |
| `isFiltered(input)` | `checkFilter` 的布林捷徑 |
| `getFilterRules()` | 取得當前所有規則 |
| `clearFilterRules()` | 清除所有規則 |

### 預設規則

模組啟動即載入以下預設規則：

**User block（廣告帳號）：**
- `user:廣告帳號-加LINE/加瀨` — 比對 `加LINE` / `加瀨` / `加line` 等關鍵字
- `user:廣告帳號-特殊組合字` — 含 LINE/瀨 + Unicode 組合裝飾字元
- `user:廣告帳號-臺幣/蚪幣` — 比對 `臺⃛幣⃛` / `蚪⃑.幣⃑` 模式
- `user:廣告帳號-過長中文比例異常` — 特殊字元數量 > 中文字數 2 倍

**Message block（無意義訊息）：**
- `msg:僅標點符號` — 純 `。，、．...` 等符號
- `msg:僅單一字元` — 單一符號如 `。` `？` `！`

### 自訂過濾規則範例

可在任意檔案（或直接在 `MessageFilter.js` 底部）加入：

```js
// replace 範例：遮罩髒話
addFilterRule({
  name: 'msg:遮罩髒話',
  field: 'message',
  action: 'replace',
  match: /他媽的|操你媽|幹你娘/g,
  replacement: '***',
});

// delete 範例：移除網址
addFilterRule({
  name: 'msg:刪除網址',
  field: 'message',
  action: 'delete',
  match: /https?:\/\/\S+/g,
});

// block 範例：阻擋全數字訊息
addFilterRule({
  name: 'msg:全數字',
  field: 'message',
  action: 'block',
  test: (m) => /^\d{6,}$/.test(m),
});
```

### 過濾流程

```
收到訊息(user, message)
       ↓
processFilter({ user, message })
       ↓
  ┌────┴────┐
  │ blocked │ ← true → ❌ 阻擋，不發送
  └────┬────┘
       │ false
       ↓
  ┌─────┴─────┐
  │ modified  │ ← true → 使用 fr.user / fr.message 取代原值
  └─────┬─────┘
       │ false → 保持原值
       ↓
    記錄統計 → 發送 Bark → 發送 Socket
```

---

## 補釘服務器 WebSocket.js

**補釘服務器** 是專門用來接收 **UserScript** 所轉發的直播頁面訊息。

當你透過 **Restream / Streamlabs** 等工具推流到 TikTok 時

在對應的管理後台中會出現一個 **TikTok Live Monitor** 入口 之類的。

點擊後會開啟官方的直播監聽頁面，
最終頁面實際運行於：

> [https://livecenter.tiktok.com/](https://livecenter.tiktok.com/)

在這個頁面中，你可以查看：

- 觀眾數
- 直播時長
- 禮物資訊
- 聊天室訊息（最重要）

## 運作原理

### UserScript 腳本運行於 livecenter.tiktok.com 頁面中

1. 直接監聽 DOM 內聊天室訊息的新增
2. 即時抓取頁面上實際渲染出的聊天內容
3. 將訊息轉送至補釘服務器（WebSocket.js）
4. 再由補釘服務器分發給你的本地應用或推流系統

### 為什麼這樣做？

這種方式從根本上解決了：

第三方 TikTok Live API / Library 可能漏訊息的問題

#### 因為

- 你抓的是「官方頁面實際顯示的內容」
- 只要頁面能看到，腳本就一定能抓到
- 不依賴非官方 WebSocket 協議
- 不會因為封包解析錯誤而漏訊

#### 簡單說

這是「基於官方直播頁面實際渲染結果」的資料來源
準確度最高，幾乎不會遺漏。

## 架構流程圖（邏輯層）

```txt
TikTok Live 推流
        ↓
livecenter.tiktok.com（官方頁面）
        ↓
UserScript 監聽 DOM 變化
        ↓
WebSocket.js 補釘服務器
        ↓
你的本地應用 / PiP 聊天室 / 直播系統
```

## 延伸說明

目前 **UserScript** 僅處理聊天室訊息（**Chat Messages**）

以下事件尚未納入處理範圍：

- 送禮事件（Gift）
- 使用者加入直播間（Join）
- 其他系統事件

### 目前架構定位

現階段，UserScript 的角色是：

作為輔助訊息來源（Fallback / Patch Layer）

主要用來彌補第三方 TikTok Live API
在實際使用中 偶爾出現聊天室訊息遺漏 的問題。

運作方式為：

- 第三方 TikTok Live API → 作為主要資料來源
- UserScript（監聽官方頁面 DOM） → 作為補強與校正來源

### 未來規劃

後續可考慮：

- 將送禮、加入等事件一併納入監聽
- 逐步完整遷移至「頁面監聽方案」
- 最終降低甚至完全移除對第三方 TikTok Live API 的依賴

## 其他指引

### 提交修改忽略

```shell
git update-index --assume-unchanged <file>
```

### 提交修改忽略回復

```shell
git update-index --no-assume-unchanged <file>
```


### 其他工具 **OtherTool**

這個資料夾是之前做的一些小工具

`Time.html` 是很早以前我用在OBS瀏覽器來源 用來顯示當前時間的附加件

`NetFix.py` 則是平時用來FFMPEG重新編碼壓縮用 的小工具

`live_engine` 用於給Window的聊天疊加層

`Gift.html` TaiwndCSS 商品卡排版設計嘗試

`Mask.py` 一個讓你用來擋不想讓觀眾看到的東西 黑框框可視化視頻編輯器


### live_engine 使用方式

依賴安裝

```shell
pip install PyQt6 PyOpenGL numpy pillow requests
```

疊加層配置 請從`live_engine/config.py` 處理

寬高配置在這裡設置

運行請先進入 live_engine目錄下 在運行 `main.py`

運行會在本地部署一個Socket Server PORT跟ReplyKIT項目是一樣的 在PORT `9322`



## 新更新 部分日誌會採用 `writeLog` 進行本地日誌紀錄

有一些訊息為了方便調試 確認參數 所以特別寫進 `Main_Log.log` `TikTokRun.log`



