/**
 * 跨平台觀眾數收斂。
 *
 * 目的：把「暫時取不到」與「真的是 0 人」分開，避免 socket／UI 人數閃 0 或忽高忽低。
 * - 只接受有限非負數（或可轉成數字的字串）；undefined、NaN、負數一律忽略，保留上次已知值。
 * - 前一值大於 0 時，單次 0 先暫緩；持續 `confirmMs` 後仍為 0 才確認歸零。
 * - 平台明確離線（關台／斷線）時用 `reset()` 立即歸零。
 */

const DEFAULT_CONFIRM_MS = 60000;

/**
 * @typedef {Object} ViewerCountsOptions
 * @property {() => number} [now=Date.now] 時間來源（測試可注入）。
 * @property {number} [confirmMs=60000] 0 值需要持續多久才確認（毫秒）。
 * @property {(platform: string) => boolean} [include] 合併時要納入的平台；預設全部納入。
 */

/**
 * 建立跨平台觀眾數狀態。
 *
 * @param {ViewerCountsOptions} [options]
 * @returns {{
 *   set: (platform: string, raw: unknown, options?: {at?: number, force?: boolean}) => boolean,
 *   reset: (platform: string, options?: {at?: number}) => boolean,
 *   get: (platform: string) => number,
 *   combined: () => number,
 *   snapshot: () => Record<string, {value: number, at: number}>
 * }}
 */
export function createViewerCounts({ now = Date.now, confirmMs = DEFAULT_CONFIRM_MS, include = () => true } = {}) {
    /** @type {Map<string, {value: number, at: number, pendingZeroAt: (number|null)}>} */
    const state = new Map();

    /**
     * 取得（必要時建立）平台狀態。
     * @param {string} platform
     * @returns {{value: number, at: number, pendingZeroAt: (number|null)}}
     */
    function entryFor(platform) {
        let entry = state.get(platform);
        if (!entry) {
            entry = { value: 0, at: 0, pendingZeroAt: null };
            state.set(platform, entry);
        }
        return entry;
    }

    /**
     * 寫入平台觀眾數。
     * 無效值直接忽略；單次 0 需持續 `confirmMs` 才會真的歸零。
     *
     * @param {string} platform 平台名稱。
     * @param {unknown} raw 觀眾人數（原生事件可能是字串）。
     * @param {{at?: number, force?: boolean}} [options] `force` 可跳過 0 確認（明確離線用）。
     * @returns {boolean} 顯示值是否改變。
     */
    function set(platform, raw, { at = now(), force = false } = {}) {
        if (typeof raw === 'string') {
            if (raw.trim() === '') return false;
        } else if (typeof raw !== 'number') {
            return false;
        }

        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) return false;

        const entry = entryFor(platform);
        const previous = entry.value;

        // 正值突然變 0：先保留舊值，等下一次（或超過確認時間）仍為 0 才接受。
        if (!force && value === 0 && previous > 0) {
            if (entry.pendingZeroAt === null) {
                entry.pendingZeroAt = at;
                return false;
            }
            if (at - entry.pendingZeroAt < confirmMs) return false;
        }

        entry.value = value;
        entry.at = at;
        entry.pendingZeroAt = null;
        return value !== previous;
    }

    /**
     * 明確離線時強制歸零。
     *
     * @param {string} platform
     * @param {{at?: number}} [options]
     * @returns {boolean} 顯示值是否改變。
     */
    function reset(platform, { at = now() } = {}) {
        const entry = entryFor(platform);
        const changed = entry.value !== 0;
        entry.value = 0;
        entry.at = at;
        entry.pendingZeroAt = null;
        return changed;
    }

    /**
     * 取得平台目前觀眾數（未知平台回 0）。
     * @param {string} platform
     * @returns {number}
     */
    function get(platform) {
        return state.get(platform)?.value ?? 0;
    }

    /**
     * 合併所有納入平台的觀眾數。
     * @returns {number}
     */
    function combined() {
        let total = 0;
        for (const [platform, entry] of state) {
            if (include(platform)) total += entry.value;
        }
        return total;
    }

    /**
     * 取得各平台快照（不含 pending 狀態）。
     * @returns {Record<string, {value: number, at: number}>}
     */
    function snapshot() {
        const out = {};
        for (const [platform, entry] of state) {
            out[platform] = { value: entry.value, at: entry.at };
        }
        return out;
    }

    return { set, reset, get, combined, snapshot };
}
