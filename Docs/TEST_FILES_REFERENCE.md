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
| ------ | --------- |
| `Test/translate_emoji.mjs` | 驗證翻譯前的純表情/純網址過濾（`extractTranslatableText`），不需連網 |
| `Test/img_regex.mjs` | G#Ad 頭像自動偵測的正規表示式（TikTok.js `handleGAd` 的 B 邏輯） |
| `Test/gad.mjs` | 模擬 G#Ad 完整解析流程（token 過濾 + B 自動偵測 + A 保留 + C 存已解析值） |

## X-Bogus 簽名測試

| 檔案 | 測試內容 |
| ------ | --------- |
| `Test/direct_signer.mjs` | 測試 Puppeteer 驅動的直接簽名器 — 注入 TikTok webmssdk、呼叫 u995、產生 X-Bogus |
| `Test/puppeteer.mjs` | Puppeteer SDK 注入驗證 — 檢查 byted_acrawler、__sdkN.u[995]、frontierSign |
| `Test/frontier.mjs` | 測試 byted_acrawler.frontierSign() 函數的可用性 |
| `Test/vm.mjs` | 測試在 Node.js VM sandbox 環境載入 TikTok SDK 執行簽名（替代 Puppeteer） |

## WebSocket 連線測試

| 檔案 | 測試內容 |
| ------ | --------- |
| `Test/ws.mjs` | 測試 WebSocket 連線到 webcast-ws 端點，含 X-Bogus 簽名驗證 |
| `Test/raw_ws.mjs` | 測試原生 WebSocket 到 webcast-ws.tiktok.com（不含簽名，檢查是否需要 X-Bogus） |
| `Test/raw_ws2.mjs` | 測試原生 WebSocket 到其他端點（im-ws-sg.tiktok.com），檢查 access_key 行為 |
| `Test/im_fetch.mjs` | 測試 WebSocket URL 參數建構，對照 library 的參數順序 |

## CDP 捕捉測試

| 檔案 | 測試內容 |
| ------ | --------- |
| `Test/capture.mjs` | 測試 Puppeteer 導航到直播頁，攔截 WebSocket constructor 取得真實 WS URL |

## 整合測試

| 檔案 | 測試內容 |
| ------ | --------- |
| `Test/integration.mjs` | 端到端測試：X-Bogus 簽名 → im/fetch API 呼叫 → WS URL 簽署 |

## UI 冒煙測試（需 Chrome／Edge，不在 `test:ci`）

| 檔案 | 測試內容 |
| ------ | --------- |
| `Test/config_login_ui.cjs` | 設定／登入頁深色主題、安全閘門、23 個欄位、桌面側欄／手機導覽、390px 無溢出、未儲存狀態、登入錯誤與成功；輸出 `output/playwright/config-desktop.png`、`config-mobile.png`、`login-desktop.png` |
| `Test/audience_ui.cjs` | 常客列表、分數組成、等級門檻、最近場次與手機寬度；輸出截圖 |
| `Test/monitor_audience_ui.cjs` | 監控聊天列的常客標記與「只看常客」篩選 |
| `Test/traffic_planner_ui.cjs` | 人流分類、批次補分類、預覽／套用／復原與手機寬度 |
| `Test/traffic_planner_collecting_ui.cjs` | 資料累積建議、時段分組提醒與一週計畫 UI |
| `Test/traffic_history_ui.cjs` | 開播時段排名、下一步指引、輔助時段與樣本不足狀態 |
| `Test/youtube_browser_ui.mjs` | 無 OAuth 時從頻道 `/live` discovery 後注入聊天 iframe |

截圖寫入 `output/playwright/`，該目錄已在 `.gitignore`，只作本機展示與版本比較。

## SDK 分析工具

| 檔案 | 測試內容 |
| ------ | --------- |
| `Test/check_sdk.mjs` | 分析 TikTok webmssdk 檔案結構，檢查 key 函數是否存在 |
| `Test/find_xgnarly.mjs` | 從 tiktok-signature/server.mjs 提取 encodeXGnarly 匯出函數 |
| `Test/tmp_check_cdn.mjs` | 從 TikTok CDN 下載最新 webmssdk.js，比對本地版本 |
| `Test/tmp_check_sdk.mjs` | 分析本地 SDK 檔案的版本號和關鍵函數 |

> **注意：** 這些腳本是開發過程中的產物，部分可能需要特定環境（如 Puppeteer、npm 套件）才能執行。如不需使用可直接刪除。
