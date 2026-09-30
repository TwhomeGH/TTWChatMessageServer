let pending = 0;
/**
 * 由原生聊天子程序以 IPC 回報一筆人流事件（僅在 process.send 可用且未積壓時送出）。
 * @param {Object} data 事件資料；會自動加上 transport: 'native'。
 * @returns {void}
 */
export function reportTraffic(data) {
    if (!process.connected || typeof process.send !== 'function' || pending >= 100) return;
    pending++;
    try { process.send({ type:'TRAFFIC_EVENT', data:{transport:'native', ...data} }, () => pending--); } catch { pending--; }
}
