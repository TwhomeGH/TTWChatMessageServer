# 修補（Patch）系統

本專案對第三方套件的修改改以**最小差異 patch** 維護，套用在**對應版本**的原廠套件上。
不再以整檔複製方式覆蓋 `node_modules`。

## 目錄結構

```
Docs/
├── patches/
│   ├── tiktok-live-connector/
│   │   └── 2.4.0.patch          ← 依版本命名
│   └── kick-wss/
│       └── 1.0.5.patch
├── apply-patches.mjs            ← 套用 / 檢查 / 還原
└── make-patches.mjs             ← 從 node_modules 重新產生 patch
```

## 使用方式

```bash
node Docs/apply-patches.mjs            # 套用（已套用則略過）
node Docs/apply-patches.mjs --check    # 只檢查目前狀態
node Docs/apply-patches.mjs --revert   # 還原為原廠
```

## 目前修補內容

| 套件 | 版本 | 檔案 | 內容 |
|------|------|------|------|
| `tiktok-live-connector` | 2.4.0 | `dist/lib-YL2P_UWg.js` | ① WebSocket `unexpected-response` 除錯 log（印出 HTTP status/body）② 將 `sessionId`/`ttTargetIdc` 帶入 Euler `fetchWebcastURL` 呼叫 |
| `kick-wss` | 1.0.5 | `dist/MessageParser.js`、`dist/WebSocketManager.js`、`dist/types.d.ts` | 保留 Pusher `sender` 原始欄位（`...data.sender`）、可由外部指定 `channelId`、型別補充 |

> `tiktok-signature` **不需要 patch**：執行期只讀取 `javascript/webmssdk_*.js`（與原廠相同），
> `server.mjs` / `xgnarly.mjs` 並未被任何執行期程式 import。

## 新增或更新修補

1. 安裝對應版本：`npm install <套件>@<版本>`
2. 直接編輯 `node_modules/<套件>/` 內的檔案
3. 重新產生 patch：
   ```bash
   node Docs/make-patches.mjs
   ```
   腳本會從 npm 下載原廠 tarball，與 `node_modules` 內容做 diff，寫入
   `Docs/patches/<套件>/<版本>.patch`。
4. 驗證：
   ```bash
   node Docs/apply-patches.mjs --check
   ```

## 設計重點

- **版本鎖定**：patch 檔名即版本。`apply-patches.mjs` 會讀取 `node_modules/<套件>/package.json` 的版本，
  找不到對應 patch 就報錯，不會亂套。
- **不硬蓋**：使用 `git apply`，context 必須完全吻合；若 `node_modules` 被手動改過會套用失敗並提示。
- **冪等**：已套用會顯示「已套用」並略過；`--revert` 可完整還原。
- **繞過 gitignore**：`node_modules` 被 `.gitignore` 忽略，`git apply` 預設會 `Skipped patch`。
  因此 `apply-patches.mjs` 使用一個空的暫時 `GIT_DIR` 搭配指向套件目錄的 `GIT_WORK_TREE`。

## 退役（保留供歷史參考）

- `Docs/patched-plugins/`：舊的整檔複製來源，已棄用。
- `Docs/*_patched_v2.zip` 與 `Docs/zip-patches.mjs`：舊的打包流程，已棄用。
