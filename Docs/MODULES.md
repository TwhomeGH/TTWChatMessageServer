# 模組責任與維護方式

## 自動剪輯

| 檔案 | 責任 |
| --- | --- |
| AutoClip.js | 保留既有公開匯入路徑，轉出 AutoClipManager |
| AutoClipV2.mjs | 管理留言窗口、去重、暖機、持續熱度、冷卻與歷史生命週期 |
| ScriptLib/autoclip/metrics.mjs | 清理窗口、計算平台基準與貢獻分數、選出獨立達標的最高分 |
| ScriptLib/autoclip/evidence.mjs | 複製觸發當下證據，保留總數並限制明細為 200 則 |
| ScriptLib/autoclip/clipRequest.mjs | 提交剪輯請求、逾時處理、更新成功／失敗與 pending 狀態 |

熱度仍接受所有平台（含 Unknown），明確標記的測試訊息不計入；Twitch 是剪輯入口。
拆分不調整門檻、暖機、冷卻或去重規則。重置窗口也不清除冷卻、去重與累計結果。
calculateMetrics 會清理管理器的留言窗口，並非純函數；requestClip 原地更新歷史列。
證據模組複製留言與平台管道陣列，後續資料變動不應改寫觸發說明。

## 表情映射

| 檔案 | 責任 |
| --- | --- |
| EmojiStore.cjs | 共用 store、序列化修改、檔案監看與最後有效狀態 |
| ScriptLib/validate.js | 映射格式與圖片 URL 驗證、ValidationError |
| ScriptLib/revision.js | 穩定排序後計算版本指紋 |
| ScriptLib/fileOps.js | 讀檔與暫存檔原子替換 |
| EmojiRoutes.cjs | 路由分派、登入判定與統一錯誤回應 |
| ScriptLib/emoji/handlers.cjs | 管理／登入頁、取得映射、修改映射 |
| ScriptLib/emoji/http.cjs | JSON 回應及有大小上限的請求解析 |

EmojiStore 與其 .js 輔助檔使用 CommonJS 的 require/module.exports；
AutoClip 子模組使用 .mjs 的 import/export。不要只改全專案 type 設定，避免破壞既有混合模組。
新功能依責任加入對應資料夾，避免把業務函數集中進通用 utils。

## 回歸驗證

node --test Test/emoji_store.test.cjs Test/module_boundaries.test.cjs Test/autoclip_v2.test.mjs Test/message_source.test.mjs Test/message_stats.test.mjs

涵蓋熱載入、損壞檔案恢復、版本衝突、中文跨分段 JSON、相容入口，以及跨平台觸發／冷卻／失敗／逾時。

## 後續整理計畫（尚未拆分）

EmojiMap.js 已補齊公開函數註解，目前保留文字替換及舊版相容介面。
其 addEmoji/removeEmoji 只修改記憶體，saveEmojiMap 直接寫檔，與 store.change 的保護不同。
後續先盤點呼叫端，再統一持久化路徑，不能只更名就改變同步／非同步契約。

下一階段以 MessageStats.mjs 為優先，按責任拆分到 ScriptLib/messageStats/：

| 預定模組 | 範圍 | 必須維持的行為 |
| --- | --- | --- |
| time.mjs | messageTime 的時間解析 | 秒／毫秒／日期字串、無效時間回傳 null、未來時間容許範圍 |
| merge.mjs | mergeStatEntries 的快照合併 | 同留言計數取最大值而非加總、保留未知時間、最近 5 則按 key 去重 |
| dedup.mjs | 平台 ID 與跨管道去重狀態 | 平台與測試資料隔離、3 秒跨管道窗口、30 分鐘 ID 保存與 10000 筆上限 |
| MessageStats.mjs（既有入口） | record 流程、統計列與公開匯出 | 重複訊息仍補齊接收管道、不同人同文可計數、保留既有匯入路徑 |

執行順序：先補齊函數契約與時間邊界測試，再抽出時間／合併函數，最後整理有狀態的去重。
時間工具獨立後，AutoClip 可直接依賴它，避免只為解析時間而載入整個統計模組。
每一步沿用 message_stats、message_source 與 autoclip_v2 回歸測試；不在拆分時調整計分或去重政策。

測試可讀性規範與整理進度請參閱 [測試維護指南](../Test/README.md)。
