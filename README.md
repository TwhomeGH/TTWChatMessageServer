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