// 訊息分類（category）：socket 端點過濾（?filter=）與 WebUI 監控面板共用。
// 以 .cjs 匯出，讓 ESM（TikTok.js／ScriptLib 模組）以 default import 取用、
// 也讓 Server.js 以 require 取用，維持單一來源。
const MESSAGE_CATEGORIES = [
    'system',      // 連線／錯誤／系統訊息
    'chat',        // 聊天（含翻譯後內容）
    'member',      // 加入
    'follow',      // 追蹤
    'like',        // 點讚
    'gift',        // 禮物／打賞
    'share',       // 分享
    'emote',       // 表情
    'envelope',    // 寶箱
    'superfan',    // 鐵粉
    'subscribe',   // 訂閱／贈訂
    'clip',        // 剪輯
    'ad',          // 贊助廣告
    'audience',    // 觀眾數
    'summary',     // 頻率摘要
    'heartbeat'    // 心跳
];

/** 由分類名稱推導的大寫常數，方便程式碼以 CATEGORY.CHAT 取用。 */
const CATEGORY = Object.freeze(Object.fromEntries(
    MESSAGE_CATEGORIES.map(name => [name.toUpperCase(), name])
));

module.exports = { MESSAGE_CATEGORIES, CATEGORY };
