import { promises as fs } from 'fs';
import path from 'path';
import emojiStoreModule from './EmojiStore.cjs';

const EMOJI_MAP_FILE = path.resolve('./emoji_map.json');
let emojiMap = {};
let activeStore = emojiStoreModule.store;
let stopWatching;

/**
 * 切換使用中的映射檔、載入內容並啟動每秒監看；先停止前一次監看。
 * 同一 store 載入失敗時保留最後有效內容；切換到新檔案則使用新實例。
 * 載入錯誤會記錄到主控台，仍啟動監看以便檔案修正後恢復。
 * @param {string} filePath 映射 JSON 路徑，預設相對於工作目錄。
 * @returns {Promise<void>}
 */
export async function loadEmojiMap(filePath = EMOJI_MAP_FILE) {
    stopWatching?.();
    activeStore = path.resolve(filePath) === emojiStoreModule.store.file ? emojiStoreModule.store : new emojiStoreModule.EmojiStore(path.resolve(filePath));
    try { await activeStore.load(); } catch (error) { console.error('表情映射載入失敗，保留上一版：',error.message); }
    stopWatching=activeStore.watch();
    emojiMap=activeStore.snapshot().map;
}

/**
 * 使用目前映射快照，將訊息中的表情代碼替換成圖片網址。
 * 代碼以字面值比對（包含 []），長代碼優先；單次替換不再處理插入的網址。
 * @param {*} text 原始訊息；空值或非字串直接原樣回傳。
 * @returns {*} 替換後的字串，或原始非字串值。
 */
export function replaceEmojis(text) {
    if (!text || typeof text !== 'string') return text;
    emojiMap=activeStore.snapshot().map;
    const codes=Object.keys(emojiMap).sort((a,b)=>b.length-a.length);
    if(!codes.length)return text;
    const escaped=codes.map(code=>code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    return text.replace(new RegExp(escaped.join('|'),'g'),code=>emojiMap[code]);
}

/**
 * 取得目前映射的淺拷貝；修改回傳物件不會改動 store。
 * @returns {Object<string, string>} 表情代碼與圖片網址。
 */
export function getEmojiMap() {
    return activeStore.snapshot().map;
}

/**
 * 舊版相容介面：新增或覆蓋記憶體中的代碼，不驗證網址、不立即寫檔。
 * 尚未儲存的修改可能被下一次檔案監看覆蓋；管理頁使用 store.change。
 * @param {string} code 完整表情代碼。
 * @param {string} url 圖片網址。
 * @returns {void}
 */
export function addEmoji(code, url) {
    Object.defineProperty(activeStore.map,code,{value:url,writable:true,enumerable:true,configurable:true});
}

/**
 * 舊版相容介面：只從記憶體移除代碼，不立即寫檔；不存在時不做變更。
 * 尚未儲存的修改可能被下一次檔案監看覆蓋；管理頁使用 store.change。
 * @param {string} code 要移除的完整代碼。
 * @returns {void}
 */
export function removeEmoji(code) {
    delete activeStore.map[code];
}

/**
 * 舊版相容介面：按代碼排序後，直接把目前快照寫到指定檔案。
 * 不含版本衝突檢查、驗證或原子替換；不會切換目前監看的檔案。
 * 管理頁的持久化修改使用 store.change，避免繞過一致性保護。
 * @param {string} filePath 輸出路徑，預設相對於工作目錄。
 * @returns {Promise<void>}
 * @throws {Error} 檔案寫入失敗時向呼叫端傳遞錯誤。
 */
export async function saveEmojiMap(filePath = EMOJI_MAP_FILE) {
    emojiMap=activeStore.snapshot().map;
    const sorted = Object.fromEntries(
        Object.entries(emojiMap).sort(([a], [b]) => a.localeCompare(b))
    );
    await fs.writeFile(filePath, JSON.stringify(sorted, null, 4), 'utf-8');
}

export default {
    loadEmojiMap,
    replaceEmojis,
    getEmojiMap,
    addEmoji,
    removeEmoji,
    saveEmojiMap,
};
