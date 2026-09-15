const ID_TTL_MS = 30 * 60 * 1000;
const CROSS_SOURCE_WINDOW_MS = 3000;
const MAX_ENTRIES = 10000;

/** 按 Map 插入順序淘汰舊項目，限制記憶體用量。 */
function trimCache(cache) {
    while (cache.size > MAX_ENTRIES) {
        cache.delete(cache.keys().next().value);
    }
}

/**
 * 判斷並記錄去重狀態；不修改留言統計列。
 * 同平台 ID 保存 30 分鐘；缺少 ID 的跨管道事件以平台／測試標記／使用者／內容比對。
 * 重複 ID 會刷新保存時間；跨管道重複不刷新原事件的 3 秒窗口。
 * @param {object} caches 含 ids 與 crossSource 兩個 Map，由 MessageStats 擁有
 * @param {object} event 已正規化的平台、管道、ID、key、使用者與內容
 * @param {number} now 本次接收時鐘（毫秒）
 * @returns {boolean} true 表示重複，呼叫端只應補齊管道資訊
 */
export function isDuplicate(caches, event, now) {
    const { ids, crossSource } = caches;
    const { platform, transport, isTest, id, key, user, message } = event;
    for (const [cachedKey, at] of ids) {
        if (now - at < ID_TTL_MS) break;
        ids.delete(cachedKey);
    }

    const fingerprint = JSON.stringify([platform, isTest, user, message]);
    const previous = crossSource.get(fingerprint);
    const crossDuplicate = previous && previous.transport !== transport
        && now - previous.at <= CROSS_SOURCE_WINDOW_MS
        && (!id || !previous.id || id === previous.id);

    if ((id && ids.has(key)) || crossDuplicate) {
        if (id) {
            ids.delete(key);
            ids.set(key, now);
        }
        trimCache(ids);
        return true;
    }

    crossSource.delete(fingerprint);
    crossSource.set(fingerprint, { transport, id, at: now });
    trimCache(crossSource);
    if (id) ids.set(key, now);
    trimCache(ids);
    return false;
}
