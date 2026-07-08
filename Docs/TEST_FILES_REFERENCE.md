# 測試檔案參考

本目錄包含開發過程中建立的測試腳本，用於驗證 TikTok Live 連線機制的各個環節。

## X-Bogus 簽名測試

| 檔案 | 測試內容 |
|------|---------|
| `_test_direct_signer.mjs` | 測試 Puppeteer 驅動的直接簽名器 — 注入 TikTok webmssdk、呼叫 u995、產生 X-Bogus |
| `_test_puppeteer.mjs` | Puppeteer SDK 注入驗證 — 檢查 byted_acrawler、__sdkN.u[995]、frontierSign |
| `_test_frontier.mjs` | 測試 byted_acrawler.frontierSign() 函數的可用性 |
| `_test_vm.mjs` | 測試在 Node.js VM sandbox 環境載入 TikTok SDK 執行簽名（替代 Puppeteer） |

## WebSocket 連線測試

| 檔案 | 測試內容 |
|------|---------|
| `_test_ws.mjs` | 測試 WebSocket 連線到 webcast-ws 端點，含 X-Bogus 簽名驗證 |
| `_test_raw_ws.mjs` | 測試原生 WebSocket 到 webcast-ws.tiktok.com（不含簽名，檢查是否需要 X-Bogus） |
| `_test_raw_ws2.mjs` | 測試原生 WebSocket 到其他端點（im-ws-sg.tiktok.com），檢查 access_key 行為 |
| `_test_im_fetch.mjs` | 測試 WebSocket URL 參數建構，對照 library 的參數順序 |

## CDP 捕捉測試

| 檔案 | 測試內容 |
|------|---------|
| `_test_capture.mjs` | 測試 Puppeteer 導航到直播頁，攔截 WebSocket constructor 取得真實 WS URL |

## 整合測試

| 檔案 | 測試內容 |
|------|---------|
| `_test_integration.mjs` | 端到端測試：X-Bogus 簽名 → im/fetch API 呼叫 → WS URL 簽署 |

## SDK 分析工具

| 檔案 | 測試內容 |
|------|---------|
| `_check_sdk.mjs` | 分析 TikTok webmssdk 檔案結構，檢查 key 函數是否存在 |
| `_find_xgnarly.mjs` | 從 tiktok-signature/server.mjs 提取 encodeXGnarly 匯出函數 |
| `_tmp_check_cdn.mjs` | 從 TikTok CDN 下載最新 webmssdk.js，比對本地版本 |
| `_tmp_check_sdk.mjs` | 分析本地 SDK 檔案的版本號和關鍵函數 |

## 使用方式

```bash
node _test_xxx.mjs
```

部分測試需要 Puppeteer/browser 環境，會自動啟動 headless Chrome。

> **注意：** 這些測試檔案是開發過程中的產物，部分可能需要特定環境（如 Puppeteer、npm 套件）才能執行。如不需使用可直接刪除。
