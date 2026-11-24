# 應用診斷（/diagnostics）

## 目的

集中查看外部應用（目前是 ReplyKit）的診斷與日誌，用於排查錄影、推流、擴展或 log I/O 問題。資料只是暫存，不是正式 log 檔。

## 觀測頁

`/diagnostics` 不是把 body 原樣列出，而是像 `/logs` 一樣做結構化分析：

- 左側分類：依 tag 或 title 統計，可點擊篩選。
- 摘要卡：總筆數、時間範圍、Session、警告、錯誤。
- 表格：時間、分類、嚴重度、內容；`key=value` 會收進可展開的欄位。
- 工具列：搜尋、嚴重度、Session、清除篩選、自動更新、自動滾到最新、載入更多。
- 原始 `body` 仍保留，不做破壞性改寫；未知分類顯示原始 title 或 `Other`。

JSON 只結構化外層；`body` 本身仍是字串。因此解析採 **structured-first**：

```json
{
  "logs": [{
    "time": "2026/11/25 10:00:00",
    "title": "ReplyKit",
    "body": "capture started",
    "category": "Capture",
    "severity": "info",
    "session": "abc12345",
    "fields": { "fps": "60" }
  }]
}
```

有提供 `category`／`severity`／`session`／`fields` 時直接使用，不再猜測。只有舊版 sender 只送 `time`／`title`／`body` 時，才用 `ScriptLib/diagnostics/parse.cjs` 的文字 fallback：

```text
category  第一個 [Tag]，沒有 tag 時用 title
severity  error／warn／info；failed=0、lastError=none 不當成 error
session   session=... 或 sessionId=...
fields    短 key=value（value 上限 160 字）
```

這些解析只用於顯示與搜尋，不會寫入 log 檔、SQLite、聊天或 traffic。

## 兩種來源

### HTTP log bridge

與 ReplyKit `LogServer.js` 相容，POST 到：

```text
http://<TTWChat主機>:3332/post
```

接受：

```json
{ "logs": [{ "time": "...", "title": "ReplyKit", "body": "..." }] }
```

單一 log 物件或陣列也接受。若設定 `DIAGNOSTICS_TOKEN`：

```text
http://<TTWChat主機>:3332/post?token=<token>
```

或使用 `x-diagnostics-token`／`Authorization: Bearer <token>`。

### Socket 外部事件訂閱

連線目標沿用聊天輸出的 Socket 設定，不另外維護一份 host／port：

```text
# 聊天輸出與診斷訂閱共用同一個 ReplyKit SocketServer
SOCKET_API=http://192.168.0.159:9322
# 只有 SOCKET_API 為空時，才取 SOCKET_APIS 的第一個可用端點

# 可選：主服務啟動時自動訂閱
DIAGNOSTICS_SOCKET_ENABLED=1
```

`/diagnostics` 只保留「訂閱外部事件」開關，不再要求填 host／port。狀態列會顯示目前解析到的目標與來源（`SOCKET_API`／`SOCKET_APIS`）；若未設定，會提示補上 `SOCKET_API` 並重啟。TTWChat 會：

1. 第一次啟用時建立 TCP 連線到 `SOCKET_API` 解析出的 host／port。
2. 在既有連線上送 `{"type":"subscribeExternalLogs","enabled":true}`。
3. 接收 `externalLogSubscription`、`externalLogBatch`、`diagnostic`。
4. 取消時只送 `enabled:false`，保留連線；再次啟用直接在同一條連線重新訂閱。
5. 已啟用時若連線斷開，自動重連並重新訂閱。

TTWChat 只送訂閱訊息，不送 `log`／`logbatch`／`videoHealth`／`audioHealth`／`reconnectStatus` 等 extension 專用訊息，因此維持外部工具角色。

## API

需要主服務登入：

```text
GET /api/diagnostics?limit=300&q=&category=&severity=&session=
```

回傳 `logs`（最新在前）、`total`（符合篩選筆數）、`hasMore`、`summary`（全量摘要）以及既有的 `diagnostics`／`recentDiagnostics`。`summary` 不隨篩選改變，讓分類與總覽保持穩定；表格由前端反轉成舊到新，最新保持在底部。

## Log I/O 是什麼

頁面上的 **Log I/O** 卡片專指 `type:"diagnostic"`、`subsystem:"logio"` 的摘要，也就是應用程式**寫入 log 檔失敗**的次數與最後錯誤，不是 socket 外部日誌。

Socket 外部日誌會出現在下方「應用日誌」，與 HTTP log bridge 合併顯示。

## 邊界

- 只存在記憶體：logs 最多 2000、diagnostic 最多 100。
- 解析是顯示層輔助，不會把 body 改寫成新的 log；未知格式仍保留原文。
- 不寫 log 檔、SQLite、聊天、traffic、AutoClip 或通知。
- 未知 socket `type` 忽略，不中斷連線。
- `/diagnostics` 需要主服務登入；`/post` 只有選填 token，請勿直接暴露到不可信網路。
- Socket 角色識別不是身份驗證。

## 驗證

```bash
node --test Test/diagnostics.test.cjs
node Test/diagnostics_ui.cjs
npm run lint
```
