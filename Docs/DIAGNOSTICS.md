# 應用診斷（/diagnostics）

## 目的

集中查看外部應用（目前是 ReplyKit）的診斷與日誌，用於排查錄影、推流、擴展或 log I/O 問題。資料只是暫存，不是正式 log 檔。

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

ReplyKit 的 SocketServer 預設 port `9322`。連線目標只在環境變數設定一次：

```text
DIAGNOSTICS_SOCKET_HOST=192.168.0.242
DIAGNOSTICS_SOCKET_PORT=9322
# 可選：主服務啟動時自動訂閱
DIAGNOSTICS_SOCKET_ENABLED=1
```

`/diagnostics` 只保留「訂閱外部事件」開關，不再要求填 host／port。TTWChat 會：

1. 第一次啟用時建立 TCP 連線到設定的 host／port。
2. 在既有連線上送 `{"type":"subscribeExternalLogs","enabled":true}`。
3. 接收 `externalLogSubscription`、`externalLogBatch`、`diagnostic`。
4. 取消時只送 `enabled:false`，保留連線；再次啟用直接在同一條連線重新訂閱。
5. 已啟用時若連線斷開，自動重連並重新訂閱。

TTWChat 只送訂閱訊息，不送 `log`／`logbatch`／`videoHealth`／`audioHealth`／`reconnectStatus` 等 extension 專用訊息，因此維持外部工具角色。

## Log I/O 是什麼

頁面上的 **Log I/O** 卡片專指 `type:"diagnostic"`、`subsystem:"logio"` 的摘要，也就是應用程式**寫入 log 檔失敗**的次數與最後錯誤，不是 socket 外部日誌。

Socket 外部日誌會出現在下方「應用日誌」，與 HTTP log bridge 合併顯示。

## 邊界

- 只存在記憶體：logs 最多 2000、diagnostic 最多 100。
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
