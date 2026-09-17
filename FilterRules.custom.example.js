/**
 * 自訂訊息過濾規則（範本）
 *
 * 這個檔案是「使用者自己的規則」的起點：首次啟動時若 `FilterRules.custom.js` 不存在，
 * 會自動從本檔複製一份。之後你只改 `FilterRules.custom.js`，本檔可原樣保留。
 *
 * 建議流程：開 `/keyword` 頁面的「規則產生器與測試」→ 用表單與正則測試器確認命中 →
 * 按「複製」→ 把片段貼進下面陣列的 `export default [ ... ]` 裡 → 重啟主服務生效。
 *
 * 規則欄位（與 `MessageFilter.js` 相同）：
 *   name        規則名稱，會出現在日誌
 *   field       'user' | 'message' | 'any'，檢查對象
 *   action      'block' | 'replace' | 'delete'（預設 block）
 *
 *   block：            test: (value) => boolean，回傳 true 代表阻擋
 *   replace／delete：  match: /pattern/flags，replacement: '取代文字'（delete 固定刪除）
 *
 * 注意：`block` 的 `test` 是函式，所以這個檔案是「程式碼」而不是設定檔；貼上後請重啟主服務。
 */
export default [
    // ── 範例一：廣告帳號，帳號含「加 LINE／加瀨」（含簡體與全形）就阻擋 ──
    // { name: 'user:廣告帳號-加LINE/加瀨(含簡體)', field: 'user', action: 'block',
    //   test: (u) => /加\s*(LINE|line|ｌｉｎｅ|[瀨濑頼賴])/i.test(u) },

    // ── 範例二：純 emoji 洗頻（≥3 個 emoji、且完全沒有文字）就阻擋 ──
    // 可能誤擋觀眾純用 emoji 的反應，確定要再啟用。
    // { name: 'msg:純emoji洗頻', field: 'message', action: 'block',
    //   test: (m) => {
    //     const rest = m.replace(/[\p{Extended_Pictographic}\uFE0F\u200D\s]/gu, '');
    //     return rest === '' && (m.match(/\p{Extended_Pictographic}/gu) || []).length >= 3;
    //   } },

    // ── 範例三：把特定廣告詞改寫成無害字串（replace）──
    // { name: 'msg:改寫廣告詞', field: 'message', action: 'replace',
    //   match: /加我微信\s*\w+/g, replacement: '[廣告]' },

    // ↓↓↓ 你的規則加在下面（記得每條之間用逗號分隔）↓↓↓

];
