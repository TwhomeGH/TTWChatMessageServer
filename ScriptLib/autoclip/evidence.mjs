/**
 * 複製觸發當下實際計分的留言與平台統計，避免後續流量改寫歷史。
 * 明細最多保留 200 則；total 仍代表整個窗口的有效留言數。
 * @param {object} state 管理器狀態
 * @param {object} stats 本次計分結果
 * @param {number} now 觸發時間（毫秒）
 * @returns {object} 可存入歷史紀錄的證據快照
 */
export function captureEvidence(state, stats, now) {
    return {
        windowStart: now - state.rateMs,
        windowEnd: now,
        total: state.messages.length,
        uniqueUsers: stats.uniqueUsers,
        platforms: stats.platforms.map(p => ({ ...p, transports: [...p.transports] })),
        sourcePlatform: stats.sourcePlatform,
        minMessages: state.minMessages,
        minUsers: state.minUsers,
        threshold: state.scoreThreshold,
        messageRatio: stats.messageRatio,
        maxPerUser: state.maxPerUser,
        truncated: state.messages.length > 200,
        messages: state.messages.slice(-200)
            .map(m => ({ ...m }))
            .sort((a, b) => a.t - b.t)
    };
}
