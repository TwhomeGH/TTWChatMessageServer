/**
 * 提交一次 Twitch 剪輯請求，更新 pending、結果與成功／失敗計數。
 * 逾時不自動重送，避免遠端已成功但回應延遲時產生重複剪輯。
 * @param {object} state 管理器及建立剪輯回呼
 * @param {object} row 本次歷史紀錄（結果將原地更新）
 * @param {number} now 觸發時間，用於剪輯標題
 * @returns {Promise<void>} 請求完成且已記錄結果
 */
export function requestClip(state, row, now) {
    state.pending = true;
    row.status = 'pending';
    row.requestedAt = state.now();
    const title = state.titlePrefix ? `${state.titlePrefix} ${new Date(now).toLocaleString('zh-TW')}` : null;
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('剪輯請求逾時，結果待人工確認，不自動重送')), state.requestTimeoutMs);
    });
    return Promise.race([Promise.resolve().then(() => state.onCreateClip(title, row)), timeout]).then(result => {
        if (!result?.id) throw new Error('未取得剪輯 ID');
        state.totalClips++;
        row.status = 'success';
        row.completedAt = state.now();
        row.clip = result;
    }).catch(err => {
        state.failedClips++;
        row.status = 'failed';
        row.error = err.message;
        row.completedAt = state.now();
        state.log(`❌ [AutoClip] ${err.message}`);
    }).finally(() => {
        clearTimeout(timer);
        state.pending = false;
        Object.assign(row, { totalClips: state.totalClips, failedClips: state.failedClips, pending: false });
    });
}
