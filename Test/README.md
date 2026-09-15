# 測試維護指南

## 撰寫方式

- 案例名稱描述情境與預期結果；新增或整理的案例優先使用中文。
- 每行保留一個主要操作，將準備、操作與斷言以空行分組。
- 註解說明資料為何特殊、等待的原因與要防止的回歸，不逐行翻譯程式。
- 輔助函數交代回傳資料、副作用與清理方式；只在確實重複時抽成共用工具。
- 測試用檔案放在獨立暫存資料夾，計時器及替換的共用狀態在結束時清理或還原。
- 重構測試時保留原有斷言與覆蓋範圍，不以刪除失敗案例讓測試通過。

## 本輪已整理

| 檔案 | 涵蓋行為 |
| --- | --- |
| emoji_store.test.cjs | 持久化修改、版本衝突、損壞恢復、熱載入、字面替換、API 登入 |
| message_stats.test.mjs | 舊快照合併、平台 ID 去重、最近明細上限、訊息時間 |
| module_boundaries.test.cjs | UTF-8 分段、請求解析限制、AutoClip 相容入口 |

執行本輪測試及相鄰來源回歸：

node --test Test/emoji_store.test.cjs Test/message_stats.test.mjs Test/module_boundaries.test.cjs Test/message_source.test.mjs

## 後續整理順序（尚未完成）

1. autoclip_v2.test.mjs、message_source.test.mjs：展開暖機／時間推進與事件資料，註明去重與觸發情境。
2. css_build.test.cjs、start.test.cjs：解釋假建置器、真實建置與程序生命週期的差別。
3. ws_relay.test.cjs、userscript_source.test.mjs：展開 VM 模擬環境與事件接線。
4. 其餘 *.test.*：逐檔檢查圖表資料、socket 模擬及時間邊界，按實際問題整理。

Test 目錄也包含手動診斷與外部服務腳本，不能把整個目錄的所有檔案視為單元測試一起執行。
本指南不改變這些腳本的執行方式；後續需先盤點用途與外部依賴再分類。
