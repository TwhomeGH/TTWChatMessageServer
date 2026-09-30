# ESLint 檢查

- `npm run lint`：檢查專案 JavaScript。初次導入仍有既有問題與待補環境宣告，尚未作為 CI 通過門檻。
- `npm run lint:restream`：檢查 Restream UserScript 與對應測試，目前通過。

`eslint.config.mjs` 區分 Node CommonJS、ESM、assets 瀏覽器程式與 UserScript；UserScript 只加入使用中的 GM API，不宣告 Node 的 module／require。共用 i18n helper 的 CommonJS 匯出另作單檔例外。

排除第三方 patched-plugins、node_modules、測試產物、日誌、資料與快取。新增特殊執行環境應局部設定，不把所有環境的 globals 混合以消除警告。

2026-09-30 初次全專案掃描：116 個檔案、1,488 個 error、0 個 warning。這是導入時的檢查結果，不代表已確認同數量的執行期故障；需逐項判斷並修正。尚未執行全專案 --fix。

Restream UserScript 1.1.1 移除正式腳本中的 CommonJS 測試匯出，改由測試端擷取純函式，避免瀏覽器腳本引用 module。
