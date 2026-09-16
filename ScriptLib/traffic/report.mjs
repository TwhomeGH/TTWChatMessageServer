let pending = 0;
export function reportTraffic(data) {
    if (!process.connected || typeof process.send !== 'function' || pending >= 100) return;
    pending++;
    try { process.send({ type:'TRAFFIC_EVENT', data:{transport:'native', ...data} }, () => pending--); } catch { pending--; }
}
