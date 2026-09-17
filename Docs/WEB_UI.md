# 網頁樣式建置與版面盤點

## 靜態 CSS

一般啟動使用 `npm start`，排版開發使用 `npm run dev`；模式差異見 [啟動說明](STARTUP.md)。

主服務的 Tailwind 頁面（含 `/traffic`）改用 `/assets/app.css`。以 Tailwind 4.3.3（`@tailwindcss/cli`）編譯既有 class，
瀏覽器不再載入 Tailwind Play CDN。keyword 原本即為獨立 CSS，保持原本的樣式方式。
Chart.js、播放器與圖示仍有外部依賴。

```sh
npm install
npm run build:css
# 編輯頁面時持續建置
npm run watch:css
```

來源為 `styles/app.css`；v4 以 `@import "tailwindcss" source(none)` 關閉自動掃描，
再由 `@source "../*.html"` 指定根目錄 HTML（原本由 `tailwind.config.cjs` 指定，該檔已移除），
包含 HTML 內 JavaScript 的完整 class 字串。新增 class 後需重新建置，
不要使用 `bg-${color}-500` 這類拼接名稱；改用完整 class 對照表。
建置輸出的 `assets/app.css` 與 `assets/app.css.build.json` 應與頁面一同交付；
啟動時指紋一致就不需現場編譯，不一致才重建，詳見 [啟動說明](STARTUP.md)。
指紋只涵蓋會影響 CSS 產出的來源：根目錄 HTML、`styles/`、建置腳本與建置版本；前端 `assets/*.js` 不影響 CSS，因此不列入（改前端 JS 不需重建）。
本專案只用 npm：`yarn.lock` 已移除並列入 `.gitignore`，`package-lock.json` 是唯一鎖檔。

各頁面專用的樣式放在 `assets/<page>.css`（`app.css`、`keyword.css`、`autoclip.css`、`pushdiag.css`、`sponsor.css`、`traffic.css`），由 `WebAssets.cjs` 白名單提供，HTML 只留結構、不再內嵌 `<style>`；這些獨立樣式表不是 Tailwind 產物，**不列入建置指紋**。

`WebAssets.cjs` 只公開明確列出的 CSS，支援 GET／HEAD，回傳正確 MIME，
使用 `no-cache` 避免更新後繼續使用舊樣式。升級後需重啟 Server.js，讓新資源路由生效。

## 本次版面檢查與處理

| 頁面 | 已處理／保留 | 後續較值得改造的項目 |
|---|---|---|
| 主控台 `/` | 本機樣式；日誌區改用動態視窗高度與可縮排內容 | 將啟動控制與即時日誌分成清楚區塊 |
| `/autoclip` | 保留平台卡片、圖表分頁、時間範圍、群組與右側證據；遷移本機樣式 | 密集資料下的操作回饋，避免再增加常駐資訊 |
| `/clips` | 補 viewport；標題導覽換行；每筆操作按鈕可換行 | 搜尋、篩選與大量紀錄分頁 |
| `/sponsor` | 標題導覽換行；卡片與設定列在手機可堆疊／換行 | 將建立、審核與播放狀態分區 |
| `/config` | 補 viewport；內容改為頂端自然流動；可用寬度擴大；安全彈窗可捲動 | 依平台／通知／剪輯分組，長表單導覽 |
| `/login` | 補 viewport、手機邊距與鍵盤焦點樣式 | 保持單一登入目的，無需大型改造 |
| 更新完成頁 | 補 viewport、手機邊距與鍵盤焦點樣式 | 保持簡短結果與下一步入口 |
| `/logViewer` | 工具列換行；內容高度使用動態視窗單位，日誌區內捲動 | 檔案篩選、搜尋與更新狀態 |
| `/pushdiag` | 原有響應式分區保留；共用焦點與操作尺寸；本機樣式 | 將進階細節收合，保留診斷摘要 |
| `/keyword` | 原有手機版、分頁與表格內捲動保留；內嵌樣式與腳本抽成 `assets/keyword.css`、`assets/keyword.js`，新增「規則產生器與測試」（正則測試＋歷史預覽＋快速測試＋目前生效規則） | 平台篩選與最近紀錄的密度控制 |
| `/traffic` | 重構為卡片＋雙圖並排＋可捲動表格；表格加表頭、斑馬紋與 hover；自訂選單樣式；動態產生的卡片與表格改用純 CSS（不依賴 Tailwind 掃描） | 場次成效納入排名（v2） |

後續項目為盤點建議，尚未實作。`OtherTool` 的獨立顯示頁與第三方套件範例不屬於主服務操作頁，
不套用管理介面的通用版面，避免影響直播顯示用途。

## 共用規則與驗證

- 大螢幕保留可讀內容寬度；手機允許自然捲動，不用固定高度裁掉內容。
- 表格與日誌可在自身區域捲動；工具列、導覽與操作按鈕依寬度換行。
- 保留暗色監控頁與亮色設定／登入頁，避免遷移時混淆既有使用情境。
- 執行 `node --test Test/web_assets.test.cjs Test/autoclip_chart.test.mjs` 驗證資源路由與圖表邏輯。
- 版面使用獨立測試資料預覽，勿為了測試啟動聊天或送出真實剪輯、通知。

流程依據：[Tailwind CLI 靜態建置](https://tailwindcss.com/docs/installation/tailwind-cli)、
[偵測來源檔案與完整 class 名稱限制](https://tailwindcss.com/docs/detecting-classes-in-source-files)。
