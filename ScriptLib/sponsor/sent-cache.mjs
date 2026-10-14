/**
 * 已送訊息快取（send_messages.json）：避免同一則訊息重複送出。
 *
 * 檔案只保存「這次執行新增」的訊息（`fresh`），載入時與歷史合併到 `sent` 供比對；
 * 過期（ttlMs）與超量（maxSize）會自動清除。
 */

/**
 * @typedef {Object} SentCache
 * @property {() => Promise<void>} load 由檔案載入歷史訊息。
 * @property {() => Promise<void>} save 把本次新增的訊息寫回檔案。
 * @property {(uniqueKey: string) => boolean} alreadySent 查詢並登記一則訊息（true = 曾送過）。
 */

/**
 * 建立已送訊息快取。
 * @param {Object} deps
 * @param {import('node:fs').promises} deps.fs 檔案 I/O（promises 版）。
 * @param {string} deps.file send_messages.json 路徑。
 * @param {number} [deps.ttlMs=300000] 保留時間（毫秒，預設 5 分鐘）。
 * @param {number} [deps.maxSize=1000] 最大筆數。
 * @param {Console} [deps.logger=console]
 * @returns {SentCache}
 */
export function createSentCache({ fs, file, ttlMs = 5 * 60 * 1000, maxSize = 1000, logger = console }) {
    let sent = {};
    let fresh = {};

    /**
     * 由 send_messages.json 載入歷史訊息（時間字串轉為毫秒）。
     * @returns {Promise<void>}
     */
    async function load() {
        try {
            const raw = await fs.readFile(file, "utf-8");
            if (!raw || raw.trim().length === 0) {
                logger.log("⚠️ send_messages.json 為空，初始化空物件");
                sent = {};
                return;
            }
            const data = JSON.parse(raw);
            sent = Object.fromEntries(
                Object.entries(data).map(([k, v]) => [k, new Date(v).getTime()])
            );
            logger.log(`✅ 載入 ${Object.keys(sent).length} 筆歷史訊息`);
        } catch (err) {
            if (err.code === 'ENOENT') {
                logger.log("⚠️ send_messages.json 不存在，初始化空物件");
                sent = {};
            } else {
                logger.error("❌ 載入 send_messages 失敗:", err);
            }
        }
    }

    /**
     * 把本次新增的訊息寫回 send_messages.json。
     * @returns {Promise<void>}
     */
    async function save() {
        try {
            const data = Object.fromEntries(
                Object.entries(fresh).map(([k, v]) => [k, new Date(v).toISOString()])
            );
            await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
            logger.log(`✅ 已儲存 ${Object.keys(sent).length} 筆 send_messages`);
        } catch (err) {
            logger.error("❌ 儲存 send_messages 失敗:", err);
        }
    }

    /**
     * 查詢並登記一則訊息；順便清理過期與超出上限者。
     * @param {string} uniqueKey
     * @returns {boolean} true = 曾送過（呼叫端應跳過）。
     */
    function alreadySent(uniqueKey) {
        const now = Date.now();

        for (const [key, ts] of Object.entries(sent)) {
            if (now - ts > ttlMs) {
                delete sent[key];
            }
        }

        if (sent[uniqueKey]) return true;

        sent[uniqueKey] = now;
        fresh[uniqueKey] = now;

        if (Object.keys(sent).length > maxSize) {
            const oldestKeys = Object.entries(sent)
                .sort((a, b) => a[1] - b[1])
                .slice(0, 100)
                .map(([k]) => k);
            oldestKeys.forEach(k => delete sent[k]);
        }

        return false;
    }

    return { load, save, alreadySent };
}
