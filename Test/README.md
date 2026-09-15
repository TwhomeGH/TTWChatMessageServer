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

MessageStats 拆分新增 `message_stats_boundaries.test.mjs`，涵蓋相容匯出、時間有效範圍、跨管道窗口、ID 刷新期限、快取上限與 clear 重置。

## 核心 CI

.github/workflows/core-tests.yml 在 main 推送、所有 PR 與手動觸發時執行。
Windows 與 Linux 均測試 Node 24.x LTS 與 node（最新正式版），並以 check-latest 取得符合範圍的最新版本；Python 接收端使用 3.12。
setup-node 與 setup-python 使用 v6，其 Action 自身執行環境為 Node 24；這與測試用的 node-version 是不同設定。
本機先前通過的結果來自 Node 22.18.0，不能視為新版矩陣已通過；新版結果以 GitHub workflow 為準。
既有 CodeQL 負責安全分析，本 workflow 驗證功能與跨平台行為。

- npm run test:core：統計／去重、AutoClip 與圖表、Emoji、socket、userscript、靜態 CSS 路由。
- npm run test:startup：啟動決策、watcher 生命週期與 CSS 指紋／真實編譯。
- npm run check:css：檢查提交的 CSS 是否過期；失敗時執行 npm run build:css 並提交 CSS 與 manifest。
- npm run test:ci：依序執行上述三組 Node 檢查，任一步失敗即停止。
- python -B -m unittest discover -s Test -p socket_receiver_test.py：Python 接收端標準函式庫測試。

CI 使用 npm ci --ignore-scripts 安裝 lockfile 依賴，保留 devDependencies 的 Tailwind。
測試不使用登入憑證、不呼叫直播／剪輯服務；socket 整合案例僅使用本機連線。
Node 核心測試檔依序執行，降低計時器與 socket 壓力案例間的資源競爭；工作最多 15 分鐘。
手動診斷、真實平台連線與完整瀏覽器 UI 測試不屬於本清單。
新增核心測試需同步加入 package.json 的 test:core，CI 與本機共用清單。

workflow 推送後才有 GitHub 執行結果；若要強制合併前通過，需在儲存庫規則中設定四個 Core job 為必要檢查。

瀏覽器 session／控制台測試已納入 test:core；實際登入和直播收訊需另外在專用瀏覽器驗證，詳見 ../Docs/BROWSER.md。
