# 表情映射管理與熱載入

登入後開啟 `/emoji`，可搜尋、新增、編輯、啟用／停用、恢復預設與刪除自訂代碼，並預覽圖片。
使用現有登入 cookie；未登入的 API 請求回傳 401。

## 檔案分工

- `emoji_map.json`：**出廠預設**，可提交、可隨版本更新；應用程式只讀，管理頁不會改寫。
- `emoji_map_local.json`：**本機覆寫**，不提交（`.gitignore`）；只保存與預設不同或自訂的部分。

預設檔維持簡單的「完整代碼 → 圖片 HTTP(S) 網址」：

```json
{
  "[laughcry]": "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f602.png"
}
```

本機覆寫使用 `url`／`enabled`，不用 `null`：

```json
{
  "version": 1,
  "emojis": {
    "[laughcry]": { "url": "https://example.com/laugh.png" },
    "coffeel2HAA": { "enabled": false },
    "myCustom": { "url": "https://example.com/custom.png" }
  }
}
```

- `url` 只覆寫網址；沒寫就沿用預設。
- `enabled` 只覆寫啟用狀態；沒寫就沿用預設（自訂預設為啟用）。
- 自訂代碼至少需要 `url`；可以有 `enabled:false`，保留設定但不出現在替換表。
- 實際聊天替換只使用「啟用且有網址」的項目；停用的預設仍保留原網址，方便恢復。
- 本機檔不存在時視為空覆寫；不需要先建立檔案。

## 合併與修改

- 預設項目預設啟用；本機 `url`／`enabled` 逐欄覆寫。
- 管理頁的「停用」會寫 `enabled:false`；「恢復預設」會移除該代碼的本機狀態。
- 刪除只適用自訂代碼；預設代碼請用停用，避免消失後無法恢復。
- 修改後只寫 `emoji_map_local.json`（原子替換）；`emoji_map.json` 永不經由管理頁修改。
- 預設更新時，只有真的被覆寫、停用或刪除的代碼會被本機狀態蓋住；其他預設會自然更新。

## 熱載入與錯誤

聊天程序啟動後每秒檢查預設與本機兩份檔案；網頁儲存或手動修改都會對後續新訊息生效，
已送出訊息不回溯更新。任一檔案 JSON 或欄位格式錯誤時，保留最後有效版本並在管理頁顯示錯誤，
修正後自動恢復。網頁按「重新載入」取得最新狀態；不會自動覆寫正在編輯的表單。

儲存使用暫存檔替換本機覆寫檔，並以「預設＋本機」的版本指紋檢查衝突；
兩個分頁先後修改時，過期的一方收到衝突提示，須重新載入再修改。

方括號等符號以普通文字匹配，代碼區分大小寫；重疊代碼優先匹配較長者。
替換不會再次處理剛插入的圖片網址。管理頁的縮圖由伺服器端快取路由 `/emoji/image?code=…` 供應；
停用項目也能預覽。首次向來源抓取後存於 `cache/emoji-images/`，之後由本機供應。
路由只接受映射表中既有的代碼，不接受任意網址。

## 管理 API

`GET /api/emoji` 回傳：

- `map`：實際啟用且可替換的 `{code:url}`。
- `entries`：所有項目（含停用）的 `code`、`url`、`enabled`、`source`（default／override／local）與是否為預設。
- `revision`：預設＋本機狀態的版本指紋。
- `error`：目前載入錯誤或 null。

`POST /api/emoji` 支援：

- `save`：新增／修改網址（會啟用）。
- `set-enabled`：切換啟用狀態。
- `reset`：移除本機狀態，恢復預設或刪除自訂。
- `delete`：只刪自訂；預設請使用停用。

改名不能蓋掉既有代碼；圖片網址只接受不含帳密的 HTTP(S) URL。

## 驗證

```bash
node --test Test/emoji_store.test.cjs
node Test/emoji_ui.cjs
```

測試涵蓋預設＋本機合併、覆寫、停用、恢復、自訂、預設檔不被修改、損壞本機檔保留上一版、
雙檔監看、版本衝突與既有單檔行為；UI 測試確認停用預設可見、可啟用且 POST 帶正確 revision。

## 後續

`data:image/...;base64` 尚未支援。之後會作為可選來源，依接收端能力決定是否替換；
不支援的聊天平台會保留原始代碼，不會送出 data URI。

SVG 具主動內容與腳本注入風險，不直接放行；若需要向量圖，應在伺服器端 rasterize 成 PNG／WebP 後再供應。
目前 `image_cache` 仍只檢查 `image/*`，後續需另外拒絕遠端 SVG 或 rasterize，避免直接開啟 `/emoji/image` 時執行腳本。
