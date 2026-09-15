# 運行狀態頁

執行 npm start 後，可開啟 /runtime 或由主控台導覽進入。
/open（保留原 query 啟動参数）與 /close 都回傳同一個頁面，移除固定 5 秒跳轉與純文字回應。
頁面將網址替換為 /runtime，重新整理不會再觸發啟停，每 2 秒讀取 GET /api/runtime。

顯示已停止、啟動中、程序執行中、停止中與失敗狀態，附 PID、啟用平台、運行時間及退出 code／signal。
程序執行中只表示作業系統已建立程序，登入與收訊需查看日誌。停止超過 15 秒會提示等待，不會假裝已退出或自動強殺。
重複停止不重送 EXIT，啟動已執行程序也只回傳狀態頁。停止中不可直接再次啟動。

/runtime 與 /api/runtime 沿用原啟停／日誌端點的公開存取範圍，只回傳程序摘要，不提供環境變數、完整啟動 query 或日誌。
原 /status 純文字及 /status/stream 日誌介面保持相容；需要純文字的外部工具可改查 /status。

驗證：node --test Test/runtime_state.test.cjs；測試使用假程序，不啟動直播或通知。
