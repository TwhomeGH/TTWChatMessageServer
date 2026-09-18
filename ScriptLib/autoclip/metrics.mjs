const MINUTE = 60000;

/** 計算基準中位數；尚無樣本時回傳 0。 */
const median = values => {
    const a = [...values].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : 0;
};

/**
 * 清除過期留言並計算各平台相對熱度。
 * 各平台各自通過人數／留言門檻後，取最高分；不加總跨平台分數。
 * @param {object} state 管理器的窗口、基準樣本及設定
 * @param {number} now 評估時間（毫秒）
 * @returns {object} 平台明細、總分及冷卻統計
 */
export function calculateMetrics(state, now) {
    state.messages = state.messages.filter(m => m.t >= now - state.rateMs && m.t <= now + 3000);
    const recent = state.samples.filter(s => s.t >= now - state.baselineMs && s.t < now - state.rateMs);
    const names = new Set([...state.platformViewers.keys(), ...state.messages.map(m => m.platform)]);
    const platforms = [...names].map(platform => {
        const messages = state.messages.filter(m => m.platform === platform);
        const v = state.platformViewers.get(platform);
        const viewers = v && now - v.at <= state.staleMs ? v.viewers : 0;
        const baseViewers = median(recent.map(s => s.platforms?.find(p => p.platform === platform)?.viewers || 0));
        const baseMsgRate = median(recent.map(s => s.platforms?.find(p => p.platform === platform)?.msgRate || 0));
        const msgRate = messages.length / (state.rateMs / MINUTE);
        const messageRatio = msgRate / Math.max(baseMsgRate, state.floorMsgPerMin);
        const uniqueUsers = new Set(messages.map(m => m.user)).size;
        // 同一個人最多發了幾則：用來分辨「很多人各一則」與「一個人洗頻」。
        const perUser = new Map();
        for (const m of messages) perUser.set(m.user, (perUser.get(m.user) || 0) + 1);
        const topUserMsgs = perUser.size ? Math.max(...perUser.values()) : 0;
        // 使用平台自己的基準，不以原始觀眾規模加權。
        const score = state.wMsg * Math.min(10, messageRatio)
            + state.wViewers * Math.min(2, viewers / Math.max(baseViewers, state.floorViewers));
        const transports = [...(state.sourceActivity.get(platform) || new Map())]
            .filter(([, at]) => now - at <= state.staleMs).map(([transport]) => transport);
        return { platform, transports, viewers, baseViewers, msgRate, baseMsgRate, messageRatio,
            windowMsgs: messages.length, uniqueUsers, topUserMsgs, score,
            eligible: messages.length >= state.minMessages && uniqueUsers >= state.minUsers
                && messageRatio >= (state.minMessageRatio ?? 1.5) };
    });
    // 取獨立達標的最高分，避免安靜平台稀釋其他平台的突增。
    const winner = platforms.filter(p => p.eligible).sort((a, b) => b.score - a.score)[0];
    for (const p of platforms) p.contribution = p === winner ? p.score : 0;
    const sum = key => platforms.reduce((n, p) => n + p[key], 0);
    // 跨平台彙總的「同一個人最多幾則」（user key 已含平台，不會跨平台合併）。
    const perUserAll = new Map();
    for (const m of state.messages) perUserAll.set(m.user, (perUserAll.get(m.user) || 0) + 1);
    return { viewers: sum('viewers'), msgRate: sum('msgRate'), baseViewers: sum('baseViewers'), baseMsgRate: sum('baseMsgRate'),
        platforms, sourcePlatform: winner?.platform || null,
        sampleCount: recent.length, windowMsgs: state.messages.length,
        uniqueUsers: new Set(state.messages.map(m => m.user)).size,
        topUserMsgs: perUserAll.size ? Math.max(...perUserAll.values()) : 0,
        messageRatio: winner?.messageRatio || 0, score: winner?.score || 0,
        totalClips: state.totalClips, totalTriggers: state.totalTriggers, failedClips: state.failedClips,
        shadowTriggers: state.shadowTriggers, pending: state.pending,
        cooldownLeftMin: state.lastClipAt === null ? 0 : Math.max(0, (state.lastClipAt + state.cooldownMs - now) / MINUTE) };
}

