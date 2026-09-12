# 測試檔案參考

`Test/` 目錄包含開發過程中建立的測試與分析腳本，用於驗證 TikTok Live 連線機制、翻譯過濾與訊息解析等環節。

## 使用方式

所有腳本請**從專案根目錄**執行（部分腳本以 `node_modules/...` 相對路徑讀取 SDK）：

```bash
node Test/xxx.mjs
```

部分測試需要 Puppeteer / browser 環境，會自動啟動 headless Chrome。

## 翻譯與訊息過濾

| 檔案 | 測試內容 |
|------|---------|
| `Test/translate_emoji.mjs` | 驗證翻譯前的純表情/純網址過濾（`extractTranslatableText`），不需連網 |
| `Test/img_regex.mjs` | G#Ad 頭像自動偵測的正規表示式（TikTok.js `handleGAd` 的 B 邏輯） |
| `Test/gad.mjs` | 模擬 G#Ad 完整解析流程（token 過濾 + B 自動偵測 + A 保留 + C 存已解析值） |

## X-Bogus 簽名測試

| 檔案 | 測試內容 |
|------|---------|
| `Test/direct_signer.mjs` | 測試 Puppeteer 驅動的直接簽名器 — 注入 TikTok webmssdk、呼叫 u995、產生 X-Bogus |
| `Test/puppeteer.mjs` | Puppeteer SDK 注入驗證 — 檢查 byted_acrawler、__sdkN.u[995]、frontierSign |
| `Test/frontier.mjs` | 測試 byted_acrawler.frontierSign() 函數的可用性 |
| `Test/vm.mjs` | 測試在 Node.js VM sandbox 環境載入 TikTok SDK 執行簽名（替代 Puppeteer） |

## WebSocket 連線測試

| 檔案 | 測試內容 |
|------|---------|
| `Test/ws.mjs` | 測試 WebSocket 連線到 webcast-ws 端點，含 X-Bogus 簽名驗證 |
| `Test/raw_ws.mjs` | 測試原生 WebSocket 到 webcast-ws.tiktok.com（不含簽名，檢查是否需要 X-Bogus） |
| `Test/raw_ws2.mjs` | 測試原生 WebSocket 到其他端點（im-ws-sg.tiktok.com），檢查 access_key 行為 |
| `Test/im_fetch.mjs` | 測試 WebSocket URL 參數建構，對照 library 的參數順序 |

## CDP 捕捉測試

| 檔案 | 測試內容 |
|------|---------|
| `Test/capture.mjs` | 測試 Puppeteer 導航到直播頁，攔截 WebSocket constructor 取得真實 WS URL |

## 整合測試

| 檔案 | 測試內容 |
|------|---------|
| `Test/integration.mjs` | 端到端測試：X-Bogus 簽名 → im/fetch API 呼叫 → WS URL 簽署 |

## SDK 分析工具

| 檔案 | 測試內容 |
|------|---------|
| `Test/check_sdk.mjs` | 分析 TikTok webmssdk 檔案結構，檢查 key 函數是否存在 |
| `Test/find_xgnarly.mjs` | 從 tiktok-signature/server.mjs 提取 encodeXGnarly 匯出函數 |
| `Test/tmp_check_cdn.mjs` | 從 TikTok CDN 下載最新 webmssdk.js，比對本地版本 |
| `Test/tmp_check_sdk.mjs` | 分析本地 SDK 檔案的版本號和關鍵函數 |

> **注意：** 這些腳本是開發過程中的產物，部分可能需要特定環境（如 Puppeteer、npm 套件）才能執行。如不需使用可直接刪除。
