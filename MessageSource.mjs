const platforms = new Map([
    ['tiktok', 'TikTok'], ['twitch', 'Twitch'], ['kick', 'Kick'],
    ['odysee', 'Odysee'], ['youtube', 'Youtube']
]);
/**
 * 將平台名稱（不分大小寫、允許前後空白）正規化為固定名稱。
 * @param {string} value
 * @returns {'TikTok'|'Twitch'|'Kick'|'Odysee'|'Youtube'|'Unknown'}
 */
export function normalizePlatform(value) {
    return typeof value === 'string' ? platforms.get(value.trim().toLowerCase()) || 'Unknown' : 'Unknown';
}
/**
 * 由事件 metadata 與 ingress 推導來源描述。
 * @param {Object} [meta] 事件 metadata（platform、transport、isTest 等）。
 * @param {string|null} [ingress] 來源管道；'userscript' 代表 userscript 轉接。
 * @returns {{platform: string, transport: 'userscript'|'api', isTest: boolean, heatEligible: boolean}}
 */
export function normalizeSource(meta = {}, ingress = null) {
    const platform = normalizePlatform(meta.platform);
    const transport = ingress === 'userscript' || meta.transport === 'userscript' ? 'userscript' : 'api';
    const isTest = meta.isTest === true;
    return { platform, transport, isTest, heatEligible: !isTest };
}
