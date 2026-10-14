/**
 * 贊助廣告資料（sponsor_ads.json）的載入、儲存與查詢。
 *
 * `state` 為單一物件；呼叫端取得其參照（`store.state`）即可就地修改，不需重新指派。
 */

/**
 * @typedef {Object} SponsorStore
 * @property {() => void} load 由 sponsor_ads.json 載入（就地更新 state）。
 * @property {() => void} save 將目前 state 寫回 sponsor_ads.json。
 * @property {(userId: string, displayName: string) => Object} getOrCreate 取得贊助者資料，不存在時建立。
 * @property {{settings: Object, users: Object}} state 目前資料。
 */

/**
 * 建立贊助廣告資料存放區。
 * @param {Object} deps
 * @param {{existsSync: Function, readFileSync: Function, writeFileSync: Function}} deps.fs 同步檔案 I/O。
 * @param {string} deps.file sponsor_ads.json 路徑。
 * @param {Console} [deps.logger=console]
 * @returns {SponsorStore}
 */
export function createSponsorStore({ fs, file, logger = console }) {
    const { existsSync, readFileSync, writeFileSync } = fs;
    const state = { settings: { reviewMode: 'none' }, users: {} };

    /**
     * 由 sponsor_ads.json 載入；相容舊版（頂層直接是 users 對照表）。
     * 一律就地更新 state，讓呼叫端持有的參照保持一致。
     * @returns {void}
     */
    function load() {
        try {
            if (existsSync(file)) {
                const data = JSON.parse(readFileSync(file, 'utf-8'));
                if (!data.settings && !data.users) {
                    state.settings = { reviewMode: 'none' };
                    state.users = data;
                    save();
                } else {
                    state.settings = data.settings || { reviewMode: 'none' };
                    state.users = data.users || {};
                }
                logger.log(`📂 已載入贊助廣告資料 (${Object.keys(state.users).length} 位贊助者)`);
            } else {
                state.settings = { reviewMode: 'none' };
                state.users = {};
            }
        } catch (err) {
            logger.error('⚠️ 載入贊助廣告資料失敗:', err.message);
            state.settings = { reviewMode: 'none' };
            state.users = {};
        }
    }

    /**
     * 將目前狀態寫回 sponsor_ads.json。
     * @returns {void}
     */
    function save() {
        try {
            writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
        } catch (err) {
            logger.error('⚠️ 儲存贊助廣告資料失敗:', err.message);
        }
    }

    /**
     * 取得贊助者資料，不存在時建立。
     * @param {string} userId
     * @param {string} displayName
     * @returns {{userId: string, displayName: string, ads: Array<Object>}}
     */
    function getOrCreate(userId, displayName) {
        if (!state.users[userId]) {
            state.users[userId] = {
                userId,
                displayName,
                ads: []
            };
        } else {
            state.users[userId].displayName = displayName;
        }
        return state.users[userId];
    }

    return { load, save, getOrCreate, state };
}
