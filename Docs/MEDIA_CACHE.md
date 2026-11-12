# 圖片媒體快取（media）

## 目的

TikTok／Twitch 頭像、TikTok 禮物圖與贊助 overlay 圖片原本直接使用外部 CDN URL。這些 URL 可能：

- 過期或需要重新導向。
- 在 overlay 端重複下載。
- 因來源站限流或網路不穩而閃爍。

MediaCache 將圖片持久化到本機，訊息只傳本地 URL：

```text
外部圖片 URL
  → MediaCache.localUrl(url)
  → http://127.0.0.1:3332/media/<sha256>.<ext>
  → 第一次請求時下載並寫入本機
```

主服務綁定 `0.0.0.0:3332`；Media URL 預設使用目前私有 IPv4（優先 192.168.x.x），不再使用 `127.0.0.1`，讓同網域的其他機器能取得圖片。只有找不到私有 IPv4 時才退回 loopback。

## 檔案

- `ScriptLib/media/cache.cjs`：快取、下載、SSRF 檢查與供應。
- `MediaRoutes.cjs`：公開的 `GET /media/<sha256>[.<ext>]` 路由；副檔名只供客戶端分類，實際格式仍看 `Content-Type`。
- `cache/media/<sha256>.bin`：圖片位元組。
- `data/media.sqlite`：來源 URL、Content-Type、大小、ETag、存取時間與失敗次數。

`/media/` 只接受 hash（可帶 png／jpg／gif／webp／avif／bmp 副檔名），**不提供 `?url=` 任意抓取**。資料庫與圖片目錄已排除 Git。對外 URL 會依內容類型或來源副檔名產生 `.png`／`.jpg` 等後綴，讓依副檔名分類的客戶端也能辨識。

## 整合位置

- `SocketHub.sendMessage`：統一改寫 `img`／`giftImg`。
  - 涵蓋 TikTok 頭像與禮物圖。
  - Twitch `sendChat` 的頭像也走同一層。
  - YouTube／Odysee 頭像同理。
- `sendAdOverylayMessage`：改寫贊助 `iconURL` 與文字中的圖片 URL。
- Bark／ntfy 通知仍使用原始 URL，因為手機不一定能連到本機快取。

## Data URI

`img`、`giftImg`、`message` 內嵌圖片、`AdOverlay.iconURL`、贊助橫幅與通知圖片都接受 png／jpeg／webp／gif data URI。

- MediaCache 一般只處理 HTTP(S)；data URI 在 live 路徑原樣直傳，不抓取。只有 monitor 歷史會把 data URI materialize 成 content-addressed 本機檔。
- `ScriptLib/media/inline.cjs` 驗證格式、encoded 大小、數量與總量；不切片、不 fallback HTTP。
- 通知會移除 body 中的 data URI，且外部 Bark／ntfy 不帶 data URI icon。
- Live 顯示保留 inline；monitor 歷史會 materialize 成 `/media/<content-hash>.<ext>`，SQLite 只存本地 URL，不存 base64。
- inline 與歷史引用的 HTTP 圖片會 pin，一般 LRU 不會刪掉；歷史場次／訊息被修剪後才釋放引用。
- 表情映射中沒有圖片副檔名的 HTTP URL 會先轉進 MediaCache，輸出 `/media/<hash>.<ext>`；已有 `.png`／`.jpg` 等副檔名者維持遠端 URL。
- 舊的無副檔名 `/media/<hash>` 仍可讀取；Python overlay 也接受這種路徑，避免舊資料變回文字。
- Python overlay 已在 texture worker 本機解碼 png／jpeg／webp／gif data URI；日誌只記錄類型與長度。

## 檢視與手動測試

- `/monitor` 的「MediaCache 資源」面板可查看快取統計、搜尋、預覽、複製本地 `/media/<hash>.<ext>` 連結與開啟圖片。
- `GET /api/media`（需登入）支援 `page`、`pageSize`、`q`、`type`、`status`；只回傳 hash、host、型別、大小、時間與狀態，不暴露完整來源 URL。
- `GET /api/media/stats`（需登入）回傳總數、bytes、cached／failed／missing。
- `/monitor` 另有 Raw Socket 測試入口：`POST /api/socket/test` 經子程序直接送 `socketHub`，可選擇是否套用 MediaCache／emoji 正式轉換；不經 `/chat`、filter、dedup、traffic 或 AutoClip。

## 安全限制

- 僅接受 HTTP(S)，拒絕 `data:`、`blob:`、`file:` 與含帳密的 URL。
- 下載前解析 DNS，拒絕 loopback、private、link-local 與保留位址。
- 重新導向最多 3 次，每一跳都重新檢查。
- 只接受 raster 圖片：png／jpeg／gif／webp／avif／bmp；拒絕 SVG。
- 最大 8 MB、8 秒 timeout。
- 回應加上 `X-Content-Type-Options: nosniff` 與長效 immutable cache。
- 抓取失敗回 404，不把原始 URL 當 redirect 目標，避免公開路由被拿來探測內網。

DNS rebinding 仍是殘餘風險；若來源不需要任意主機，之後可加 host allowlist。

## 設定

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `MEDIA_BASE_URL` | 自動挑私有 LAN IPv4（例如 `http://192.168.0.102:3332`） | 回傳給 overlay 的本地 URL 前綴；有多張網卡或要反向代理時再覆寫 |
| `MEDIA_CACHE_MAX_MB` | `1024` | 非 pinned HTTP 快取容量上限 |
| `MEDIA_CACHE_DAYS` | `90` | 非 pinned HTTP 快取保留天數 |

主服務每小時 prune 一次；inline 與 monitor 歷史引用的檔案是 pinned，不會被一般 LRU 刪除。歷史修剪後會解除 HTTP pin，inline 則直接刪檔。

## 驗證

```bash
node --test Test/media_cache.test.cjs
npm run lint
```

## 手動重置

停止主服務與聊天子程序後，刪除：

- `data/media.sqlite*`
- `cache/media/`

下次收到圖片 URL 時會重新建立。
