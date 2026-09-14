# `/chat` Userscript 轉接參數

本文件說明 `Server.js` 現行 HTTP 入口。平台分類與腳本版本見 [Userscript 來源說明](USERSCRIPT_SOURCES.md)，剪輯計算見 [自動剪輯說明](KEYWORD_AUTOCLIP_V2.md)。

## 入口與流程

```text
POST http://localhost:3332/chat
Content-Type: application/json

Userscript → Server.js → TikTok.js → Socket 顯示與自動剪輯統計
```

請依實際服務位址調整主機與連接埠，使用 `/chat`，不要加尾端斜線或查詢參數。本文是 JSON 聊天入口；`/relay`、`/relay-url` 的原始 WebSocket 轉接，以及顯示工具的 TCP Socket，都是不同介面。

## 聊天訊息 `StreamMessage`

下表是發送端應遵循的契約。目前入口沒有完整的欄位驗證；缺少必要資料即使得到 HTTP 200，也不代表能正常顯示或統計。

| 欄位 | 型別／預設 | 說明 |
|---|---|---|
| `type` | 字串，省略為 `StreamMessage` | 建議明確填入 `StreamMessage`。另一個支援類型是 `audience`。 |
| `user` | 字串，聊天必填 | 原始使用者顯示名稱。 |
| `message` | 非空字串，聊天必填 | 原始留言內容。 |
| `platform` | 字串，預設 `Unknown` | 支援 `TikTok`、`Twitch`、`Kick`、`Odysee`、`Youtube`，不分大小寫。缺少或無法辨識時歸為未知來源，仍可參與熱度。 |
| `transport` | 字串 | `/chat` 會強制設成 `userscript`，不能用它冒充 API 管道。 |
| `msgId` | 字串或 `null` | 平台原始訊息 ID；相容別名 `id`，兩者都有時優先使用非空 `msgId`。沒有就省略或填 `null`，不要自行產生假 ID。 |
| `userId` | 字串，可省略 | 可取得時提供平台原始使用者 ID。 |
| `sentAt` | Unix 秒／毫秒數值、數字字串、ISO 時間字串或 `null` | 平台發送時間；相容別名 `createTime`。沒有可靠時間就填 `null`。 |
| `observedAt` | 毫秒時間戳，可省略 | 瀏覽器觀察時間。目前不作為平台發送時間或熱度計算時間。 |
| `receivedAt` | 伺服器產生 | 入口會覆寫成伺服器接收時間，發送端不用設定。 |
| `isTest` | 布林，預設 `false` | 只有布林 `true` 標記合成測試資料；仍可顯示、記錄留言，但不參與自動剪輯熱度及觀眾更新。不要傳字串 `"true"`。 |
| `img` | URL 字串，可省略 | 顯示用圖片位址，不是圖片上傳介面。 |
| `giftImg` | URL 字串，可省略 | 相容顯示用禮物圖片，不會因此產生原生平台禮物事件。 |
| `userNum` | 有限且非負的數值，可省略 | 真實總觀眾數；只有知道總數才傳，不要用 `0` 代表未知。 |
| `audienceKind` | `total` 或 `top-fans`，可省略 | 總觀眾數建議明確標記 `total`；`top-fans` 會略過觀眾熱度更新。 |
| `userList` | 字串陣列，可省略 | 相容欄位，目前不據此更新總觀眾或自動剪輯熱度。 |
| `isMain` | 布林，相容欄位 | 目前聊天轉接送往 Socket 時固定使用 `true`，不採用輸入值切換。 |
| `heatEligible` | 伺服器衍生 | 由 `isTest` 決定，入口會覆寫；不要自行指定。 |

### 一般留言

```json
{
  "type": "StreamMessage",
  "platform": "TikTok",
  "transport": "userscript",
  "user": "觀眾甲",
  "message": "這段太精彩了！",
  "msgId": null,
  "sentAt": null
}
```

無法辨識原始平台時改填 `"platform": "Unknown"`，或省略平台欄位即可，**仍是有效留言**。`userscript` 是接收管道，不是平台名稱。所有未知來源共用未知來源統計組，系統不猜測它們各自來自哪個平台。

### 測試中心的合成留言

```json
{
  "type": "StreamMessage",
  "platform": "Unknown",
  "transport": "userscript",
  "isTest": true,
  "user": "測試使用者",
  "message": "這是一條測試訊息",
  "img": "",
  "giftImg": ""
}
```

`TestCenter.user.js` 使用此標記。沒有另外一份「排除平台清單」；未知來源不會被排除。測試 payload 即使附帶 `userNum` 也不會更新觀眾熱度。

## 觀眾更新 `audience`

此類型只更新觀眾數，不新增聊天留言，不需要 `user`／`message`。來源欄位和 `isTest` 規則與聊天相同。

```json
{
  "type": "audience",
  "platform": "TikTok",
  "transport": "userscript",
  "audienceKind": "total",
  "userNum": 300
}
```

頭號觀眾名單的長度不是總觀眾數，請標記如下；此筆不會更新觀眾熱度：

```json
{
  "type": "audience",
  "platform": "TikTok",
  "audienceKind": "top-fans",
  "userNum": 3,
  "userList": ["肉鬆", "松鼠", "瓜瓜"]
}
```

## 時間與去重

- 有效 `sentAt` 用作事件時間；無效或缺少時退回伺服器接收時間。時間解析接受西元 2000 年起、最遠至伺服器目前時間後 60 秒的值；通過解析不代表仍在自動剪輯的有效窗口內。
- 同平台、同原始訊息 ID 只統計一次，ID 暫存最多 10,000 筆／30 分鐘。測試訊息與一般訊息分開去重。
- API 與 Userscript 跨管道重複到達時，至少一邊缺少 ID，會以同平台、同使用者名稱（缺少時使用 ID）、同內容在 3 秒內出現作為備援去重。不同的已知訊息 ID 不合併。
- 此備援規則不會單憑同內容排除同管道的無 ID 留言；其他既有內容過濾與各平台去重仍可能生效。沒有原始 ID 時，無法保證辨識所有重連重播或延遲重複。
- 不要把重連時重新讀到的舊訊息填成新的平台發送時間。`observedAt` 可以更新，但不能拿來冒充 `sentAt`。
- 自動剪輯還會檢查時間窗口、洗頻限制、最低留言量、發言人數、暖機及冷卻。未知來源也適用；所有平台提供熱度，實際剪輯畫面仍取自 Twitch。

## Userscript 發送範例

在腳本標頭加入 `@grant GM_xmlhttpRequest` 與 `@connect localhost`；若改用其他主機，`@connect` 也要對應調整。此範例使用 Userscript 跨來源請求能力，不代表一般網頁的跨來源 `fetch` 一定可用。

```js
const payload = {
    type: 'StreamMessage',
    platform: 'Unknown', // 能辨識時改成真正的平台名稱
    transport: 'userscript',
    user: '觀眾甲',
    message: '這段太精彩了！',
    msgId: null,
    sentAt: null,
    observedAt: Date.now()
};

GM_xmlhttpRequest({
    method: 'POST',
    url: 'http://localhost:3332/chat',
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify(payload),
    onload: response => console.log(response.status, response.responseText),
    onerror: error => console.error('轉接請求失敗', error)
});
```

測試時請另加 `isTest: true`。一般真實留言省略此欄位即可。

## 回應與送達範圍

回應本文是純文字：

| HTTP 狀態 | 本文 | 意義 |
|---|---|---|
| `200` | `OK` | HTTP 入口完成處理，不是 Socket 送達或剪輯成功確認。下游仍可能去重或過濾。 |
| `200` | `Filtered` | 被入口的訊息過濾規則擋下。 |
| `400` | `Invalid JSON` | JSON 解析或此段處理發生例外；目前不提供細分錯誤碼。 |

聊天子程序未啟動時，入口可記錄聊天統計，但不會透過子程序送往 Socket 或計算自動剪輯；觀眾更新也不會暫存等待稍後重送。HTTP 200 不能作為子程序健康檢查。更新程式後應重新啟動伺服器與聊天子程序，並更新瀏覽器已安裝的腳本。
