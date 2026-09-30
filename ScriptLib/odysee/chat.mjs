// Odysee 直播聊天室整合：解析頻道 claim、檢查是否開播、透過 WebSocket 接收留言。
// 依賴一律由呼叫端以 deps 注入（DI），模組自己持有連線狀態；不直接碰主程式的全域。

/**
 * Odysee 聊天模組的依賴注入物件。
 * @typedef {Object} OdyseeChatDeps
 * @property {Object} axios axios 實例，用於 Odysee REST API。
 * @property {(file: string, message: string, type?: string) => void} writeLog 寫入執行日誌。
 * @property {(title: string, comment: string, icon?: string, url?: string) => void} bark 發送 Bark 通知。
 * @property {(text: string) => void} sendSystem 送出系統訊息（呼叫端自行帶入目前觀眾數／清單）。
 * @property {(user: string, message: string, img?: string) => void} sendChat 送出聊天訊息。
 * @property {(data: Object) => void} reportTraffic 回報人流事件。
 * @property {(fr: Object, meta: Object) => void} reportFiltered 回報被過濾的訊息。
 * @property {(message: {user: string, message: string}) => Object} filter 套用訊息過濾規則，回傳 {blocked, modified, user, message, reason}。
 * @property {(message: string, meta: Object) => boolean} recordHeat 記錄聊天熱度；回傳 false 表示略過此訊息。
 * @property {(text: string) => string} replaceEmojis 將表情短碼替換成圖片網址。
 * @property {(text: string) => Promise<string>} translate 翻譯文字。
 * @property {(count: number) => void} onViewerCount 回報觀眾數。
 */

const RESOLVE_URL = 'https://api.na-backend.odysee.com/api/v1/proxy?m=resolve';
const IS_LIVE_URL = 'https://api.odysee.live/livestream/is_live';

let odyseeWs = null;

async function resolveChannelClaimId(axios, channelName) {
    const cleanName = channelName.startsWith('@') ? channelName : `@${channelName}`;
    try {
        const res = await axios.post(RESOLVE_URL, {
            jsonrpc: '2.0',
            method: 'resolve',
            params: { urls: [`lbry://${cleanName}`] },
            id: 1,
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
        });
        const result = res.data?.result;
        if (!result) throw new Error('resolve 回傳空結果');
        const claim = Object.values(result)[0];
        if (!claim) throw new Error('無法解析頻道');
        return { claimId: claim.claim_id, channelName: claim.name || cleanName };
    } catch (err) {
        console.error('❌ Odysee resolve 失敗:', err.message || err);
        return null;
    }
}

async function checkIsLive(axios, claimId) {
    try {
        const res = await axios.post(IS_LIVE_URL,
            new URLSearchParams({ channel_claim_id: claimId }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 10000,
            });
        const data = res.data?.data;
        if (!data) return { live: false, viewerCount: 0 };
        return {
            live: data.Live === true,
            viewerCount: data.ViewerCount || 0,
            videoUrl: data.VideoURL || '',
            streamClaimId: data.ActiveClaim?.ClaimID || null,
            isProtected: data.ActiveClaim?.Protected || false,
        };
    } catch (err) {
        console.error('❌ Odysee is_live 檢查失敗:', err.message || err);
        return { live: false, viewerCount: 0 };
    }
}

function connect(claimId, channelName, deps) {
    const { writeLog, bark, sendSystem, sendChat, reportTraffic, reportFiltered, filter, recordHeat, replaceEmojis, translate, onViewerCount } = deps;
    const wsUrl = `wss://sockety.odysee.tv/ws/commentron?id=${claimId}&category=${encodeURIComponent(channelName)}&sub_category=viewer`;
    console.log(`🔌 Odysee WebSocket 連線: ${wsUrl}`);
    writeLog("Default", `Odysee WebSocket 連線: ${wsUrl}`, "Odysee");

    try {
        odyseeWs = new WebSocket(wsUrl);
    } catch (err) {
        console.error('❌ Odysee WebSocket 建立失敗:', err.message || err);
        return;
    }

    odyseeWs.onopen = () => {
        console.log('✅ Odysee WebSocket 已連線');
        writeLog("Default", "Odysee WebSocket 已連線", "Odysee");
        bark("Odysee 連線", `已連線 ${channelName}`, "");
        sendSystem(`Odysee 已連線 ${channelName}`);
    };

    odyseeWs.onmessage = (event) => {
        console.log('[Odysee RAW]', event.data.substring(0, 500));
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'delta' && msg.data?.comment) {
                const comment = msg.data.comment;
                const userName = comment.channel_name || comment.author || '未知';
                const message = comment.comment || '';
                const avatar = '';

                console.info(`[Odysee Chat] ${userName} : ${message}`);
                writeLog("Default", `${userName} : ${message}`, "Odysee Chat Original");
                reportTraffic({ platform: 'Odysee', eventType: 'chat', user: userName, message });

                const fr = filter({ user: userName, message });
                if (fr.blocked) {
                    reportFiltered(fr, { platform: 'Odysee', user: userName, message });
                    console.info('🚫 過濾器阻擋(Odysee):', userName, message, `(規則: ${fr.reason})`);
                    writeLog("Default", `過濾器阻擋(Odysee): ${userName} : ${message} (規則: ${fr.reason})`, "Filter");
                    return;
                }

                let tUser = fr.modified && fr.user ? fr.user : userName;
                let tMsg = fr.modified && fr.message ? fr.message : message;
                if (!tUser || !tMsg) {
                    console.info('⚠️ 過濾後(Odysee) nick/msg 為空，跳過:', userName, message);
                    return;
                }

                if (!recordHeat(tMsg, { platform: 'Odysee', user: userName })) return;

                bark(tUser, tMsg, avatar);

                // 表情取代必須在翻譯之前，避免 shortcode 被當成外文翻譯
                tMsg = replaceEmojis(tMsg);

                translate(tMsg).then(RES => {
                    let RESCHAT = `${tMsg}${tMsg == RES ? "" : `\n${RES}`}`;
                    if (RES.toLowerCase() != tMsg.toLowerCase()) {
                        bark(tUser, RES, avatar);
                    }
                    sendChat(tUser, RESCHAT, avatar);
                    writeLog("Default", `${tUser} : ${RESCHAT}`, "Odysee Chat");
                });
            } else if (msg.type === 'viewers') {
                const count = msg.data?.connected || msg.data?.viewerCount || msg.data?.count || 0;
                onViewerCount(Number(count));
            }
        } catch (err) {
            console.error('⚠️ Odysee 訊息解析錯誤:', err.message || err);
        }
    };

    odyseeWs.onerror = (err) => {
        console.error('⚠️ Odysee WebSocket 錯誤:', err.message || err);
        writeLog("Default", `Odysee WebSocket 錯誤: ${err.message || err}`, "Error");
    };

    odyseeWs.onclose = (event) => {
        console.log(`❌ Odysee WebSocket 斷線: code=${event.code} reason=${event.reason}`);
        writeLog("Default", `Odysee WebSocket 斷線: ${event.reason || '未知原因'}`, "Odysee");
        odyseeWs = null;
    };
}

/**
 * 啟動 Odysee 聊天：解析頻道 claim、檢查是否開播，連上 WebSocket 接收留言。
 * @param {string} channelName Odysee 頻道名稱（可帶或不帶開頭 @）。
 * @param {OdyseeChatDeps} deps
 * @returns {Promise<void>}
 */
export async function startOdyseeChat(channelName, deps) {
    const { writeLog, bark, sendSystem } = deps;

    if (!channelName) {
        console.log('⚠️ 未指定 Odysee 頻道名稱，跳過');
        writeLog("Default", "未指定 Odysee 頻道名稱", "Odysee");
        return;
    }

    console.log(`🎯 正在解析 Odysee 頻道: ${channelName}`);
    writeLog("Default", `正在解析 Odysee 頻道: ${channelName}`, "Odysee");

    const info = await resolveChannelClaimId(deps.axios, channelName);
    if (!info) {
        console.log('❌ 無法解析 Odysee 頻道，跳過');
        sendSystem("Odysee 頻道解析失敗");
        return;
    }
    console.log(`🔍 Odysee 頻道 claim ID: ${info.claimId}`);

    const liveInfo = await checkIsLive(deps.axios, info.claimId);
    if (!liveInfo.live) {
        console.log('📴 Odysee 頻道未開播，結束程序');
        writeLog("Default", "Odysee 頻道未開播", "Odysee");
        bark("Odysee 未開播", `${channelName} 目前沒有直播`, "");
        sendSystem(`Odysee ${channelName} 未開播`);
        return;
    }

    deps.onViewerCount(liveInfo.viewerCount);
    console.log(`📺 Odysee 直播中，觀眾數: ${liveInfo.viewerCount}`);

    const streamId = liveInfo.streamClaimId
        ? (liveInfo.isProtected
            ? liveInfo.streamClaimId.split('').reverse().join('')
            : liveInfo.streamClaimId)
        : null;
    if (!streamId) {
        console.log('❌ 無法取得直播串流 claim ID，跳過');
        return;
    }
    connect(streamId, info.channelName, deps);
}

/**
 * 關閉目前的 Odysee WebSocket（未連線時不做事）。
 * @param {{writeLog?: (file: string, message: string, type?: string) => void}} [deps] 可選；提供時用於記錄關閉失敗。
 * @returns {void}
 */
export function stopOdyseeChat(deps) {
    if (!odyseeWs) return;
    const writeLog = deps?.writeLog;
    try {
        odyseeWs.close();
    } catch (err) {
        if (writeLog) writeLog("Default", `Odysee WebSocket 關閉失敗: ${err.message || err}`, "Error");
        else console.warn('Odysee WebSocket 關閉失敗:', err?.message || err);
    }
    odyseeWs = null;
}
