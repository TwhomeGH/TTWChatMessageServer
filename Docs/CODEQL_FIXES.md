# CodeQL 掃描告警修復紀錄

## 文件導覽

| 文件 | 適合誰 | 內容 |
|------|--------|------|
| 本文件 | 開發者/維護者 | CodeQL 告警清單、修復方式、哪些是誤報/無法修 |
| `SIGN_SERVER_CHANGELOG.md` | 開發者/維護者 | 簽名伺服器套件結構與架構演進 |

## 背景

GitHub CodeQL 掃描在 `main` 分支上回報了一批安全告警。本文件紀錄每個告警的
**性質**（真實漏洞 / 誤報 / 無法修改的第三方碼）與**處理方式**。

全部告警分兩類處理：

- **真實修正** — 直接改程式碼修掉問題
- **Suppression** — 程式碼無法改動（須與 TikTok 位元組相容 / 第三方 vendored SDK），
  加 `// codeql[rule-id]` 註解標記，並在 workflow 層排除檔案

---

## 真實修正（4 個）

### #30 — DOM 文字被當作 HTML 執行（High）

**位置**：`pushdiag.html`（`renderStreamVisibility()`）

**問題**：`flvEl.innerHTML = ...${getFlvUrl()}...` 把使用者輸入的 host 與 stream key
直接插入 innerHTML，可被注入 HTML/script（XSS）。

**修復**：改用 DOM API 建構 + `textContent`：

```js
const flvEl = document.getElementById('flvUrl');
const icon = document.createElement('i');
icon.className = streamRevealed ? 'fa-solid fa-eye mr-1' : 'fa-solid fa-eye-slash mr-1';
flvEl.textContent = '';
flvEl.appendChild(icon);
flvEl.appendChild(document.createTextNode(/* url 文字 */));
```

---

### #19 / #20 — 過度寬鬆的正則範圍（Medium）

**位置**：`OtherTool/live_engine/core/speech_filter.py`

**問題**：emoji 移除正則使用 `\u2600-\u26FF`（雜項符號）與 `\u2700-\u27BF`（裝飾符號）
兩個大範圍，會連帶刪除大量**不是 emoji** 的字元（如箭頭 →、磅符號 £、勾 ✓）。
Rule ID：`py/overly-large-range`。

**修復**：收窄為精確的 emoji 碼點清單（天氣、花色、交通、常用表情等）。
驗證結果：

| 輸入 | 輸出 |
|------|------|
| `hi 😀` | `hi` |
| `test☀more` | `testmore` |
| `a❤b` | `ab` |
| `→ arrow` | `→ arrow`（保留）|
| `price £ 5` | `price £ 5`（保留）|
| `✓ check` | `✓ check`（保留）|

14 個 `test_speech_filter.py` 測試全數通過。

---

### #1 — Socket 綁定所有網路介面（Medium）

**位置**：`OtherTool/live_engine/network/socket_server.py`

**問題**：`s.bind(("0.0.0.0", 9322))` 對所有介面開放，任何可連到此機的人都能連上
Socket server。

**修復**：改為可設定的 bind host，預設僅本機 loopback：

```python
host = os.environ.get("SOCKET_HOST", "127.0.0.1")
port = int(os.environ.get("SOCKET_PORT", "9322"))
s.bind((host, port))
```

- 需其他裝置連入時：`SOCKET_HOST=0.0.0.0`（所有介面）或指定特定 IP。
- 與 Node 端的 `SOCKET_API`（`TikTok.js` 讀取）對應，兩端設定一致。
- `live_engine/README.md` 已補上說明。

---

### #23 — 用環境值組 shell 指令（Medium）

**位置**：`Docs/zip-patches.mjs`

**問題**：`execSync(\`powershell -Command "Compress-Archive -Path '${srcDir}\\*'..."\`)`
把路徑字串直接插值進 shell 指令，若路徑含特殊字元可能被當成指令執行。
Rule ID：`js/shell-command-injection-from-environment`。

**修復**：改用 `spawnSync`，命令字串保持常數，路徑透過環境變數傳入：

```js
spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
  'Compress-Archive -Path "$env:PATCH_SRC\\*" -DestinationPath "$env:PATCH_DEST" -Force'],
  { env: { ...process.env, PATCH_SRC: srcDir, PATCH_DEST: zipPath } });
```

實測三個套件 ZIP 正常產出。

---

## Suppression（無法修改，需標記排除）

### #29/#28/#27/#26/#25/#24 — CSPRNG 產生偏斜隨機數（High）

**位置**：`SignServer/xgnarly.mjs` 與 `Docs/patched-plugins/tiktok-signature/xgnarly.mjs`（同內容兩份）

**問題**：

```js
for (const b of keyBytes) sum = (sum + b) % mod;   // keyBytes 來自 randomBytes(48)
for (const b of cipher) sum = (sum + b) % mod;
```

CodeQL 偵測到對 CSPRNG 輸出做 `% mod` 會產生偏斜。Rule ID：`js/biased-cryptographic-random`。

**為什麼不能修**：
- 這是決定金鑰插入位置的 **checksum**，不是安全隨機值，偏斜在此無安全影響。
- X-Gnarly 演算法必須與 TikTok 位元組相容，改動會使簽名失效。

**處理**：加 `// codeql[js/biased-cryptographic-random]` 註解 + workflow `paths-ignore`。

---

### #22 / #21 — 不安全隨機（High）

**位置**：`Docs/patched-plugins/tiktok-signature/javascript/webmssdk_5.1.3.js`（行 4277、3911）

**問題**：`Math.random()` 生成 userId / deviceId / sessionId。Rule ID：`js/insecure-randomness`。

**為什麼不能修**：這是 TikTok **第三方 vendored SDK**（webmssdk），deviceId/sessionId
用於設備指紋且需與真實瀏覽器行為一致，改動會破壞簽名相容。

**處理**：加 `// codeql[js/insecure-randomness]` 註解 + workflow `paths-ignore`。

---

## Workflow 層排除（.github/）

新增 advanced CodeQL workflow 並在 config 排除無法修改的檔案：

```
.github/
├── codeql/
│   └── config.yml                ← paths-ignore 排除 webmssdk / xgnarly
└── workflows/
    └── codeql.yml                ← advanced workflow（官方樣例，JS + Python + Go）
```

`config.yml` 的排除規則：

```yaml
paths-ignore:
  - '**/webmssdk*.js'
  - '**/xgnarly.mjs'
```

> **注意**：原本的掃描來自 GitHub **Default setup**（UI 自動）。加入 repo 內
> `codeql.yml` 後，GitHub 會自動停用 Default setup 改用這個進階 workflow，
> 但需 push 後下次分析才生效。

---

## 總結

| Alert | 嚴重度 | 性質 | 處理 |
|-------|--------|------|------|
| #30 | High | 真實 XSS | 改 DOM API |
| #19/#20 | Medium | 過度寬鬆正則 | 收窄 emoji 範圍 |
| #1 | Medium | 綁定所有介面 | 改可設定 host |
| #23 | Medium | shell 注入 | 改 spawnSync + env |
| #29-24 | High | 誤報/不可改（演算法） | suppression + 排除 |
| #22/#21 | High | 第三方 SDK 不可改 | suppression + 排除 |
