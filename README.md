# TTWChatMessageServer 

## 簡介

`TTWChatMessageServer` 是一個聊天室訊息服務器，可對接 **TikTok** 與 **Twitch** 的直播聊天室訊息，支援以下功能：  

- 即時接收聊天室訊息  
- 支援禮物、關注、加入、分享等事件  
- 可推送到 **Bark** 或 **Socket**  
- 可透過簡單 HTTP 接口開關服務
- 可透過簡單 HTTP 接口快速修改BARK/SocketAPI配置

---

## 安裝與環境設定

### 1. 安裝依賴
```bash
npm install
```

### 2. 建立 .env 檔案

在 TikTok.js 目錄下建立 .env，可參考範例：

或者參考Docs/envExample


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
```

⚠️SESSION_ID / TT_TARGET_IDC 需要從已登入TikTok網頁Cookie裡取得

⚠️CLIENT_ID / CLIENT_SECRET 需從 Twitch 開發者平台取得

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

# 啟動服務

## 服務器預設運行在 Port 3332，提供 HTTP 控制介面。


### 1. 查看使用說明

```bash
http://localhost:3332/help
```

### 2. 啟動聊天室訊息服務

```bash
http://localhost:3332/open?isSocket=1&isTwitch=1&isTK=1&isBark=1
```

參數說明：

| 參數 | 說明 |
| -- | -- |
| user | TikTok 或 Twitch 用戶名稱，若不設預設使用 .env 的值 |
| isTK=1 | 啟用 TikTok 直播聊天室 |
| isTwitch=1 | 啟用 Twitch 直播聊天室 |
| isBoth=1 | 同時啟用 TikTok + Twitch |
| isBark=1 | 啟用 Bark 推送通知 |
| isSocket=1 | 啟用 Socket 訊息推送 |

> [!WARNING]
> 補丁服務器 重複訊息檢查功能
>
> 已經直接合併到TikTok.js/Server.js裡

以下參數不再使用
- isWeb 啟用備用UserScript監聽服務器
- isDelay 啟用延遲2秒後檢查重複訊息
- isRepeat 啟用重複訊息檢查

範例：

```bash
http://localhost:3332/open?user=coffeelatte0709&isTK=1&isBark=1
```

### 3. 關閉聊天室訊息服務

```bash
http://localhost:3332/close
```

會嘗試優雅關閉子進程，並發送最後一條訊息。

## 其他功能

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


### 2. 修改環境變數

可快速修改 .env 的 BARK_API 與 SOCKET_API：

```bash
http://localhost:3332/config
```

表單提交後會立即更新 process.env，下一次 /open 將生效


## 日誌與錯誤

所有運行日誌會在瀏覽器根目錄 SSE 頁面即時顯示，也會輸出到控制台

## 注意事項

1.	修改 .env 後，需要重新 /open 才能讓新設定生效

2.	本服務適合內網或私人環境使用，未加密認證

3.	TikTok session 過期需重新抓取



## 補釘服務器 WebSocket.js

**補釘服務器** 是專門用來接收 **UserScript** 所轉發的直播頁面訊息。

當你透過 **Restream / Streamlabs** 等工具推流到 TikTok 時

在對應的管理後台中會出現一個 **TikTok Live Monitor** 入口 之類的。

點擊後會開啟官方的直播監聽頁面，
最終頁面實際運行於：

> https://livecenter.tiktok.com/

在這個頁面中，你可以查看：

- 觀眾數
-	直播時長
-	禮物資訊
-	聊天室訊息（最重要）


## 運作原理


### UserScript 腳本運行於 livecenter.tiktok.com 頁面中：

1.	直接監聽 DOM 內聊天室訊息的新增

2.	即時抓取頁面上實際渲染出的聊天內容

3.	將訊息轉送至補釘服務器（WebSocket.js）

4.	再由補釘服務器分發給你的本地應用或推流系統

### 為什麼這樣做？

  這種方式從根本上解決了：

  第三方 TikTok Live API / Library 可能漏訊息的問題

#### 因為：

  -	你抓的是「官方頁面實際顯示的內容」
  -	只要頁面能看到，腳本就一定能抓到
  -	不依賴非官方 WebSocket 協議
  -	不會因為封包解析錯誤而漏訊

#### 簡單說：

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

  -	送禮事件（Gift）
  -	使用者加入直播間（Join）
  -	其他系統事件


### 目前架構定位

  現階段，UserScript 的角色是：

  作為輔助訊息來源（Fallback / Patch Layer）

  主要用來彌補第三方 TikTok Live API
  在實際使用中 偶爾出現聊天室訊息遺漏 的問題。

  運作方式為：
  
  -	第三方 TikTok Live API → 作為主要資料來源
  -	UserScript（監聽官方頁面 DOM） → 作為補強與校正來源


### 未來規劃

  後續可考慮：

  -	將送禮、加入等事件一併納入監聽
  -	逐步完整遷移至「頁面監聽方案」
  -	最終降低甚至完全移除對第三方 TikTok Live API 的依賴


## 其他指引

### 提交修改忽略

```shell
git update-index --assume-unchanged <file>
```

### 提交修改忽略回復

```shell
git update-index --no-assume-unchanged <file>
```