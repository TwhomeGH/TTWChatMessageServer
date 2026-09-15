// ScriptLib/revision.js
const { createHash } = require('node:crypto');

/**
 * 計算對應表的版本雜湊
 * - 先將 entries 排序，確保一致性
 * - 再用 SHA256 產生雜湊字串
 * @param {Object} map - emoji 對應表
 * @returns {string} SHA256 雜湊值
 */
function revision(map) {
    const sortedEntries = Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b));
    const json = JSON.stringify(sortedEntries);
    return createHash('sha256').update(json).digest('hex');
}

module.exports = { revision };
