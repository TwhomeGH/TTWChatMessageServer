/**
 * TikTok 開播時間解析與房資探測。
 *
 * 開播時間只採房資實際提供的欄位（`start_time`／`create_time` 等），找不到回 `undefined`，
 * 不以首次接收時間代替（符合 traffic 的 `actualStarted` 規則）。
 */

/**
 * 從房間資訊取真實開播時間；TikTok room/info 以秒為單位。
 * @param {Object} roomInfo 房資（`{data: {...}}` 或直接物件）。
 * @returns {(string|undefined)} ISO 時間字串；無法判定時 undefined。
 */
export function roomStartTime(roomInfo) {
    const data = roomInfo?.data ?? roomInfo ?? {};
    const candidates = [data.start_time, data.create_time, data.startTime, data.createTime, data.room_info?.start_time];
    for (const value of candidates) {
        let ms = Number(value);
        if (!Number.isFinite(ms) || ms <= 0) continue;
        if (ms < 1e11) ms *= 1000;              // 秒 → 毫秒
        if (ms <= Date.now()) return new Date(ms).toISOString();
    }
    return undefined;
}

/**
 * 建立「整個程式只印一次」的房資探測器（用來確認房資實際提供哪些開播時間欄位，
 * 欄位名可能隨 TikTok 改版）。
 * @param {Console} [logger=console]
 * @returns {{probe: (roomInfo: Object, startedAt?: string) => void}}
 */
export function createStartTimeProbe(logger = console) {
    let logged = false;

    /**
     * @param {Object} roomInfo
     * @param {(string|undefined)} startedAt
     * @returns {void}
     */
    function probe(roomInfo, startedAt) {
        if (logged) return;
        logged = true;
        const data = roomInfo?.data ?? {};
        const sample = ['start_time', 'create_time', 'startTime', 'createTime', 'finish_time', 'status', 'id']
            .map(key => `${key}=${data[key] ?? '∅'}`).join(' ');
        logger.log(`🕒 TikTok 開播時間探測：${startedAt ?? '未取得'}｜${sample}`);
        if (!startedAt) logger.log('🕒 TikTok 房資欄位：', Object.keys(data).join(','));
    }

    return { probe };
}
