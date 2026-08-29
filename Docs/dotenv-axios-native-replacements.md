# dotenv / axios 定位說明與原生替代方案

## 為什麼這兩個套件定位尷尬

Node.js 核心近年持續吸收第三方套件的主流功能，導致 `dotenv` 與 `axios` 這兩個
「過去幾乎必裝」的套件，在 Node 20+ 的環境下變成可有可無：

| 套件 | 用途 | Node 原生替代 | 進入核心的版本 |
|------|------|---------------|----------------|
| `dotenv` | 讀取 `.env` 檔案注入 `process.env` | `process.loadEnvFile()` | Node 20.6+ |
| `axios` | HTTP client | `fetch()` | Node 18+ |

本專案執行環境為 **Node 22**，兩個原生 API 皆已可用。

---

## dotenv → `process.loadEnvFile()`

### 目前狀態（已完成遷移）

`dotenv` 已從 `package.json` / `package-lock.json` / `yarn.lock` 移除，程式碼改為：

```js
// 舊寫法
const { config } = require('dotenv');
config(); // 讀取 .env

// 新寫法
process.loadEnvFile(".env"); // 讀取 .env
```

已替換的檔案：

- `Server.js` → `process.loadEnvFile(".env")`
- `TikTok.js` → `process.loadEnvFile(".env")`
- `TranslateTest.js` → `if (existsSync(".env")) process.loadEnvFile(".env")`
- `WebSocket.js` → 原本就整段註解，改註解為原生寫法

### 差異注意事項（重要）

`process.loadEnvFile()` **並非 dotenv 的完全等價替換**，行為上有兩個關鍵差異：

1. **檔案不存在時會拋錯**（`ENOENT`）

   ```js
   // dotenv：檔案不存在時靜默跳過，不報錯
   config();

   // loadEnvFile：檔案不存在會 throw，直接中止程式
   process.loadEnvFile(".env"); // → ENOENT: no such file...
   ```

   若某支程式可能「沒有 .env 也能跑」（例如只需環境變數已由系統注入），
   需要自己補保護：

   ```js
   const { existsSync } = require('fs');
   if (existsSync(".env")) process.loadEnvFile(".env");
   ```

   **本專案的取捨**：`Server.js` 與 `TikTok.js` 是主程式，沒有 `.env` 根本無法運作，
   刻意保留拋錯行為（fail-fast，立即暴露問題）。只有 `TranslateTest.js` 是測試腳本、
   參數多有預設值、可無 `.env` 執行，故加了 `existsSync` 守衛。

2. **不會覆蓋已存在的環境變數**

   ```js
   process.env.FOO = "fromShell";
   process.loadEnvFile(".env"); // 檔內 FOO=fromFile
   process.env.FOO;             // 仍為 "fromShell"（環境變數優先）
   ```

   這點與 dotenv 預設行為相同；需要覆蓋時 dotenv 可用
   `config({ override: true })`，而 `loadEnvFile` 在較新的 Node
   （21.7+）才有第二參數選項，本專案維持「不覆蓋」的預設即可。

### 其他 dotenv 殘留

- `Docs/patched-plugins/tiktok-live-connector/package.json` 仍宣告
  `dotenv: ^16.5.0` — 這是第三方 SDK 自己的依賴，不在本專案遷移範圍。
- `OtherTool/NetFix.py` 使用 Python 的 `dotenv` 套件 — 與 JS 生態無關。

---

## axios → 原生 `fetch()`

### 目前狀態（維持使用，暫不遷移）

`axios` **仍在依賴中**，TikTok.js 有 13 處、TranslateTest.js 有 4 處呼叫。
主要用途：翻譯 API（MyMemory / Google / Bing）、Bark 通知、Odysee、
YouTube Data API 等。

Node 18+ 的 `fetch()` 理論上可取代所有 axios 用法，但現階段 **不建議倉促替換**：

### 差異與保留理由

| 面向 | axios | 原生 `fetch()` |
|------|-------|----------------|
| 請求逾時 | `{ timeout: 10000 }` 一行搞定 | 需自行 `AbortController` + `AbortSignal.timeout()` |
| 查詢參數 | `params: {...}` 自動序列化 | 需自行 `URLSearchParams` |
| 回應資料 | `resp.data` | 需自行 `await resp.json()` |
| 錯誤處理 | 非 2xx 直接 reject，帶詳細錯誤 | 非 2xx **不** reject，需自己檢查 `resp.ok` |
| 重試 / 攔截器 | 內建 interceptor | 需自行封裝 |

範例對照（本專案最常見的翻譯呼叫）：

```js
// axios（現行）
const resp = await axios.get(TRANSLATE_API_URL, {
    params: { q: Chat, langpair: `${src}|${dst}` },
    timeout: 10000
});
const text = resp?.data?.responseData?.translatedText;

// fetch 等價寫法
const params = new URLSearchParams({ q: Chat, langpair: `${src}|${dst}` });
const resp = await fetch(`${TRANSLATE_API_URL}?${params}`, {
    signal: AbortSignal.timeout(10000)
});
if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
const data = await resp.json();
const text = data?.responseData?.translatedText;
```

### 決策

- **短期**：維持 axios。理由 — 專案內呼叫點多、格式未統一，
  且 axios 的 `timeout` + `params` + `resp.data` 讓每個呼叫點更簡短。
- **長期**：若未來有批次重構，可先在一個小型 helper 內封裝
  `fetch`（含 timeout / params / 錯誤檢查），逐個呼叫點替換，
  最後從 `package.json` 移除 axios。

---

## 參考

- Node.js `process.loadEnvFile` 文件：
  https://nodejs.org/api/process.html#processloadenvfilepath
- Node.js 原生 `fetch`（undici）：
  https://nodejs.org/api/globals.html#fetch
