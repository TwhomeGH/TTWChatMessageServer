const { database } = require('./TrafficRoutes.cjs');
const { TrafficPlanner } = require('./ScriptLib/traffic/planner.cjs');
const { createPlannerRoutes } = require('./ScriptLib/traffic/plannerRoutes.cjs');
const { notificationAvailability } = require('./ScriptLib/notify/targets.cjs');

/** 僅回報通道是否有設定，不將 URL／憑證暴露到人流頁。 */
function available() {
    return notificationAvailability(process.env);
}

/** 使用現有推播通道；限制網路逾時，不記錄可能含密鑰的 HTTP 錯誤。 */
async function send(channel, title, comment) {
    const { BarkChannel, NtfyChannel } = await import('./ScriptLib/notify/index.mjs');
    const axios = require('axios').create({ timeout: 10000 });
    const Channel = channel === 'bark' ? BarkChannel : NtfyChannel;
    const url = channel === 'bark' ? process.env.BARK_API : process.env.NTFY_API;
    const logger = { info() {}, error() {} };
    return new Channel({ url, axios, logger }).send({ title, comment });
}

const planner = new TrafficPlanner(database, { send, available });
const tick = () => planner.tick().catch(() => console.error('[Traffic] 開播提醒執行失敗，請檢查資料庫與通知設定'));
const timer = setInterval(tick, 60000);
timer.unref();
tick();

module.exports = { servePlanner: createPlannerRoutes(planner), planner };
