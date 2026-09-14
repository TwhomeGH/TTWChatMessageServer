const platforms = new Map([
    ['tiktok', 'TikTok'], ['twitch', 'Twitch'], ['kick', 'Kick'],
    ['odysee', 'Odysee'], ['youtube', 'Youtube']
]);
export function normalizePlatform(value) {
    return typeof value === 'string' ? platforms.get(value.trim().toLowerCase()) || 'Unknown' : 'Unknown';
}
export function normalizeSource(meta = {}, ingress = null) {
    const platform = normalizePlatform(meta.platform);
    const transport = ingress === 'userscript' || meta.transport === 'userscript' ? 'userscript' : 'api';
    const isTest = meta.isTest === true;
    return { platform, transport, isTest, heatEligible: !isTest };
}
