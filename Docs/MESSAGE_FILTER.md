# 訊息過濾系統（MessageFilter）

`MessageFilter.js` 是統一的訊息過濾與統計模組，同時被 `TikTok.js`（原生連線）與 `Server.js`（`/chat` 轉接）引用。
本文件說明**所有支援的規則模式**、完整欄位、預設規則、自訂方式與測試工具。

> [!IMPORTANT]
> **規則在兩個行程各跑一次**：原生聊天在 `TikTok.js`、`/chat` 轉接在 `Server.js`。
> `throttle`（頻率）的狀態因此**每個行程各一份**，兩邊都會各自送出摘要。
> 修改規則後**必須重啟主服務**：`block` 的 `test` 是函式，無法用設定檔熱套用。

---

## 一、四種動作總覽

| 動作 | 判斷方式 | 有狀態 | 用途 | 需要呼叫端配合 |
|---|---|---|---|---|
| `block` | 單筆 `test(value) => boolean` | 否 | 廣告帳號、無意義內容 | 否 |
| `replace` | 單筆 `match` 取代成 `replacement` | 否 | 遮罩髒話、改寫廣告詞 | 否 |
| `delete` | 單筆 `match` 刪除（＝取代成空字串） | 否 | 移除網址、特定字詞 | 否 |
| `throttle` | **跨訊息**的頻率＋相似度 | **是** | 洗頻、與上一則差異不大的重複訊息 | `summarize` 需要（見下） |

處理順序就是規則陣列的順序：`block` 命中會**立即中斷**；`replace`/`delete`/`throttle` 會**改值**後繼續。

---

## 二、單筆規則（`block` / `replace` / `delete`）

### 規則結構

```js
{
  name:   '規則說明',                        // 用於日誌辨識
  field:  'user' | 'message' | 'any',        // 檢查對象
  action: 'block' | 'replace' | 'delete',    // 預設 'block'

  // block 模式：回傳 true 表示阻擋
  test: (value) => boolean,

  // replace / delete 模式：
  match:       /pattern/g,   // 要匹配的 pattern
  replacement: '取代文字'     // replace 專用；delete 強制為 ''
}
```

`field` 的意義：`user` 只看暱稱、`message` 只看內容、`any` 兩者都看。

### 範例

```js
// block：廣告帳號（暱稱含「加 LINE／加瀨」，含簡繁與全形）
addFilterRule({
  name: 'user:廣告帳號-加LINE/加瀨',
  field: 'user',
  action: 'block',
  test: (u) => /加\s*(LINE|line|ｌｉｎｅ|[瀨濑頼賴])/i.test(u),
});

// block：內容出現圈號／數學粗體（混淆字元）
addFilterRule({
  name: 'any:廣告-混淆字元',
  field: 'any',
  action: 'block',
  test: (v) => /[\u2460-\u24FF]|[\u{1D400}-\u{1D7FF}]/u.test(v),
});

// replace：遮罩髒話
addFilterRule({
  name: 'msg:遮罩髒話',
  field: 'message',
  action: 'replace',
  match: /他媽的|操你媽|幹你娘/g,
  replacement: '***',
});

// delete：移除網址
addFilterRule({
  name: 'msg:刪除網址',
  field: 'message',
  action: 'delete',
  match: /https?:\/\/\S+/g,
});

// block：只含單一符號
addFilterRule({
  name: 'msg:僅單一字元',
  field: 'message',
  action: 'block',
  test: (m) => { const t = m.trim(); return t.length <= 1 && /[。.？?!！~～]/.test(t); },
});
```

---

## 三、頻率規則（`throttle`）

單筆規則無法處理「短時間一直刷」與「與上一則差異不大」。`throttle` 會為每條規則維護**群組**（同一人／同一內容的一串相似訊息），超過門檻就處置。

### 完整欄位

```js
{
  name: 'throttle:重複洗頻',
  action: 'throttle',

  scope: 'user',            // user：同一人｜content：同內容跨人
  windowMs: 10000,          // 觀察窗（毫秒）
  max: 3,                   // 窗內允許幾則；第 max+1 則起處置

  similarity: 'normalized', // off｜exact｜normalized
  distance: 2,              // normalized 時允許的編輯距離（Levenshtein）

  onExceed: 'drop',         // drop｜marker｜summarize
  marker: '（×{n}）',        // marker 用；整串「取代」原訊息，{text}＝原文、{n}＝次數
  summary: '連續 {n} 則相似訊息（已省略）：{sample}', // summarize 用
}
```

### `similarity`：怎麼算「相似」

| 值 | 比對方式 |
|---|---|
| `off` | 不看內容，**純頻率**（同一人在窗內送太多就處置） |
| `exact` | 原文完全相同 |
| `normalized` | 先**去掉 emoji、變體選擇符、ZWJ、膚色修飾、標點、符號、空白**再轉小寫，然後算編輯距離 ≤ `distance` |

`normalized` 是處理 emoji 洗頻的關鍵：`😛😛😛😛😛`、`😂😂😂😂😂`、`😌😌😌😌😉` 正規化後**都是空字串** → 視為同一群。

群組以「**上一則**」為比較基準（符合「與上一則差異不大」）。這代表連續微改的訊息會被鏈在一起；`max` 是唯一的剎車，覺得太寬就把 `distance` 調小或 `max` 調低。

### `onExceed`：超過門檻怎麼處置

假設 `max: 3`，同一人連續送 5 則相似訊息：

**`drop`（丟棄）** — 超量的完全不顯示
```
😌😌😌😌😉
😌😌😌😌😌
😌😌😌😌
（後 2 則不出現）
```

**`marker`（改寫）** — 超量的整串取代成模板（原文要不要留由模板決定）
```
😌😌😌😌😉
😌😌😌😌😌
😌😌😌😌
（×4）
（×5）
```
若 `marker: '{text}（×{n}）'` 則會變成 `😌😌😌😌😉（×4）`、`😌😌😌😌😌（×5）`。

**`summarize`（摘要）** — 超量的不顯示，**爆量結束後**補一則摘要（最多延遲 5 秒）
```
😌😌😌😌😉
😌😌😌😌😌
😌😌😌😌
（…最多 5 秒後…）
😌😌😌😌😌 連續 2 則相似訊息（已省略）：😌😌😌😌😌
```

### 範例

```js
// 同一人 10 秒內第 4 則「正規化後相同」就丟掉
addFilterRule({
  name: 'throttle:重複洗頻',
  action: 'throttle',
  scope: 'user',
  windowMs: 10000,
  max: 3,
  similarity: 'normalized',
  distance: 2,
  onExceed: 'drop',
});

// 同內容跨人（很多人一起刷同一句）→ 第 2 則起改寫成短標記
addFilterRule({
  name: 'throttle:同內容跨人',
  action: 'throttle',
  scope: 'content',
  windowMs: 30000,
  max: 2,
  similarity: 'normalized',
  distance: 0,
  onExceed: 'marker',
  marker: '{text}（×{n}）',
});

// 純頻率：同一人 10 秒內第 6 則起，爆量結束後補一則摘要
addFilterRule({
  name: 'throttle:洗頻摘要',
  action: 'throttle',
  scope: 'user',
  windowMs: 10000,
  max: 5,
  similarity: 'off',
  onExceed: 'summarize',
  summary: '{sample}（連續 {n} 則已省略）',
});
```

### `summarize` 的摘要怎麼送出

摘要需要呼叫端定時取出：

```js
// TikTok.js 每 5 秒檢查一次，直接顯示
for (const summary of takeThrottleSummaries()) {
    sendSocketMessage(summary.user || '系統', summary.message, '', '', false, CacheUserNum, CacheUserList);
}
```

`Server.js`（`/chat` 轉接路徑的狀態）則把摘要轉給 `TikTok.js` 以 `type: 'ThrottleSummary'` 顯示（**不再過濾**，避免摘要本身被同一條規則攔下）。
`drop`／`marker` 不需要這一步。

---

## 四、預設規則（模組啟動即載入）

**廣告帳號（`user`／`any`）**
- `user:廣告帳號-加LINE/加瀨` — `加LINE` / `加瀨` / `加line`（含簡體 `濑`、異體 `頼/賴`、全形）
- `any:廣告-混淆字元` — 圈號 `①-⑳`、數學粗體 `𝗔-𝟵`；用 `any` 是**預先**涵蓋「廣告改把帳號名塞進留言內容」的可能（尚未觀察到，目前是 emoji 洗頻）
- `user:廣告帳號-特殊組合字` — 含 LINE/瀨 + Unicode 組合裝飾字元
- `user:廣告帳號-臺幣/蚪幣` — `臺⃛幣⃛` / `蚪⃑.幣⃑` 模式
- `user:廣告帳號-過長中文比例異常` — 特殊字元數量 > 中文字數 2 倍

**訊息（`message`）**
- `msg:僅單一字元` — 單一符號如 `。` `？` `！`
- `msg:大量 emoji` — 連續 5 個以上 emoji（門檻可調）
- `msg:廣告-補幣/按我頭像` — 補幣類廣告直接阻擋

**其他**
- `user:刪除特殊符號`、`any:刪除控制字元`、`any:刪除過多空白`（delete/replace）
- `msg:遮罩髒話`、`msg:刪除網址`、`msg:刪除色情詞彙`

---

## 五、自訂規則檔（`FilterRules.custom.js`）

不想改 `MessageFilter.js` 的話，把自訂規則放進 `FilterRules.custom.js`（**不進版控**）：

- 首次啟動若該檔不存在，會自動從 `FilterRules.custom.example.js` 複製一份範本。
- 格式為 `export default [ ...規則 ]`；載入時會驗證格式（欄位／動作／必要參數），不合法的規則會被略過、其餘照常生效。
- 修改後需**重啟主服務**。

```js
export default [
  { name: 'user:廣告帳號-加LINE/加瀨', field: 'user', action: 'block',
    test: (u) => /加\s*(LINE|line|ｌｉｎｅ|[瀨濑頼賴])/i.test(u) },

  { name: 'throttle:重複洗頻', action: 'throttle',
    scope: 'user', windowMs: 10000, max: 3,
    similarity: 'normalized', distance: 2, onExceed: 'drop' },
];
```

### `/keyword` 的「規則產生器與測試」

- **規則產生器**：選對象與動作、填正則與旗標 → 即時產生可貼上的片段。
- **測試**：手動貼**暱稱**與**內容**（可多行），或在統計表格按「快速測試」帶入紀錄。候選規則即時試算（瀏覽器與 Node 同為 V8 引擎，行為一致）。
- **目前生效規則**：按「測目前生效規則」打 `POST /api/filter/check`，回報被哪一條規則阻擋、或最後被改寫成什麼。
- **歷史預覽**：對目前載入的統計跑一次。注意歷史的**留言是過濾後**的值、**暱稱是原始**值，所以帳號規則的預覽準、內容規則僅供參考。
- **頻率／序列測試**：用**目前生效的規則**跑一串訊息（每行一則、模擬每 1 秒一則），列出每則「放行／改寫／阻擋＋規則」與摘要。
- **目前生效的規則**：列出內建＋自訂合併後的規則（名稱／對象／動作／說明）。

---

## 六、匯出 API

| 函數 | 說明 |
|------|------|
| `addFilterRule(rule)` | 新增一條規則 |
| `addFilterRules(rules)` | 批量新增 |
| `processFilter({ user, message }, now?, state?)` | 完整處理，回傳 `{ user, message, blocked, reason, field, modified }` |
| `checkFilter(input)` | 僅檢查是否阻擋（向後相容） |
| `isFiltered(input)` | `checkFilter` 的布林捷徑 |
| `getFilterRules()` | 取得當前所有規則（複本） |
| `clearFilterRules()` | 清除所有規則與頻率狀態 |
| `takeThrottleSummaries(now?, state?)` | 取出「爆量已結束」的摘要（`summarize` 用） |
| `simulateSequence({ user, messages, stepMs }, now?)` | 隔離狀態的序列模擬，回傳 `{ results, summaries }` |

## 七、統計 API（訊息次數統計）

| 函數 | 說明 |
|------|------|
| `recordMessageStat(message)` | 累加一則訊息的出現次數 |
| `getTopMessages(limit)` | 取得出現次數最高的前 N 筆（預設 10） |
| `getAllMessageStatsSorted()` | 取得全部統計，依次數由高到低排序 |
| `mergeStats(entries)` | 以 **max-merge** 併入外部快照（只增不減） |
| `saveStatsToFile(filePath)` | 將統計寫入檔案（預設 `./message_stats.json`） |
| `loadStatsFromFile(filePath)` | 從檔案載入統計進記憶體 |
| `clearStats()` | 清空所有統計（記憶體） |

> [!NOTE]
> **統計統一由 Server.js 管理**：它是 `message_stats.json` 的唯一寫入者，寫入時與現有檔案做 max-merge；TikTok.js 退出時只把快照以 `{ type: "all", data }` 回傳併入。`/keyword` 的「清空統計」（POST `/keyword/clear`）會清空記憶體、檔案並通知 TikTok.js。

---

## 八、過濾流程

```
收到訊息(user, message)
       ↓
processFilter({ user, message })
       ↓
  ┌────┴────┐
  │ blocked │ ← true → ❌ 阻擋，不發送
  └────┬────┘
       │ false
       ↓
  ┌─────┴─────┐
  │ modified  │ ← true → 使用 fr.user / fr.message 取代原值
  └─────┬─────┘
       │ false → 保持原值
       ↓
    記錄統計 → 發送 Bark → 發送 Socket
```

`throttle` 在流程中與其他規則一起依序套用；`drop`/`summarize` 等同 `block`（`reason` 為規則名稱），`marker` 等同 `modified`。

## 九、相關檔案

| 檔案 | 角色 |
|---|---|
| `MessageFilter.js` | 規則引擎與統計 |
| `FilterRules.custom.js` | 使用者自訂規則（不進版控，首次從範本複製） |
| `FilterRules.custom.example.js` | 自訂規則範本 |
| `MessageStats.mjs` | 訊息次數統計 |
| `assets/keyword.js`／`keyword.html` | `/keyword` 規則產生器與測試 |
| `Test/message_filter.test.mjs` | 規則與頻率引擎測試 |
