# 系統日誌搜尋（/logs）

## 目的

`/log` 是即時 Console，只保留記憶體最近 200 行；`/logs` 讀取持久化的結構化日誌，供重啟後追查與分類搜尋。

- `/log`：即時 SSE、最新訊息
- `/logs`：SQLite 歷史搜尋
- `/logViewer`：原始 `Main_Log.log`／`TikTokRun.log` 檔案 fallback
- `/diagnostics`：外部 ReplyKit 診斷，不混入 TTW 系統日誌

## 資料來源

主服務的 `pushLog()` 同步寫入：

```text
console 記憶體（200 行）
  → LogStore（data/logs.sqlite）
  → SSE /status/stream/logs
```

`writeLog()` 仍會寫原始文字檔；原始檔不變，`/logs` 只保存結構化副本。

## 欄位

```text
at           Unix ms
level        error / warn / info / debug
category     tiktok / twitch / socket / autoclip / traffic ... 
source       main / child / signer / userscript
session_id   對應 monitor 場次（若有）
message      原始日誌文字
fields       JSON（目前保留；後續可放錯誤細節）
```

`level` 是嚴重度，`category` 是排查主題，兩者分開。例如 `[OUT] [AutoClip] ...`：

```text
level=debug
category=autoclip
source=child
```

分類與等級由 `ScriptLib/logs/classify.cjs` 依 tag／文字推斷，無法判斷時為 `other`。

## 保留策略

```env
LOG_RETENTION_DAYS=14
LOG_MAX_ROWS=200000
```

- 啟動與每小時 prune
- 先刪除超過天數的資料，再保留最新 `LOG_MAX_ROWS` 筆
- 原始 log 檔的保留策略不變

## API

需要主服務登入。

```text
GET /api/logs/summary?from=&to=
GET /api/logs?category=&level=&session=&q=&from=&to=&beforeId=&limit=
```

`summary` 回傳：

```json
{
  "total": 123,
  "range": { "from": 0, "to": 0 },
  "categories": [{ "name": "socket", "count": 20 }],
  "levels": [{ "name": "error", "count": 3 }],
  "sessions": ["m_..."]
}
```

列表以 `id DESC` 回傳，`beforeId` 做 keyset 分頁；不使用深 offset。

## 頁面

`/logs` 提供：

- 左側分類與數量
- 總筆數、時間範圍、Session、警告、錯誤摘要卡
- 關鍵字搜尋
- 等級、Session、分類篩選
- 欄位展開、載入更多

## 限制

- Phase 1 只保存**部署後**的新日誌；既有 raw log 檔案尚未自動回填。
- 搜尋使用 `LIKE`；資料量再大時可改 FTS5。
- 日誌可能包含敏感主機資訊，因此 `/logs` 與 API 需要登入。

## 驗證

```bash
node --test Test/log_store.test.cjs Test/log_routes.test.cjs
node Test/log_explorer_ui.cjs
npm run lint
npm run check:css
```
