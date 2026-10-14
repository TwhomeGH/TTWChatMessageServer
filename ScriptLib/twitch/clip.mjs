/**
 * Twitch 剪輯：建立剪輯、查詢標題、時間量測與歷史記錄（clip_history.json）。
 *
 * `apiClient`／`tuser` 由 `twitch/client.mjs` 在啟動後才設定，因此以 getter 注入，
 * 於呼叫當下取值；其餘副作用（日誌、推播、socket）同樣以 deps 注入。
 */

const DEFAULT_ICON = "https://github.com/TwhomeGH/TTWChatMessageServer/blob/main/Emoji/Neuro2.png?raw=true";

/**
 * @typedef {Object} ClipService
 * @property {(title?: (string|null), icon?: string, source?: string, context?: (Object|null)) => Promise<Object|undefined>} createClip 建立剪輯並在成功／失敗時通知。
 * @property {(entry: {id: string, url: string, title?: (string|null), source?: string, timing?: (Object|null)}) => void} recordHistory 記錄一筆剪輯歷史。
 * @property {() => Array<Object>} loadHistory 讀取剪輯歷史。
 */

/**
 * 建立 Twitch 剪輯服務。
 * @param {Object} deps
 * @param {() => Object} deps.getApiClient 取得目前 Twitch ApiClient（live binding）。
 * @param {() => string} deps.getTuser 取得目前頻道 UserID（live binding）。
 * @param {{existsSync: Function, readFileSync: Function, writeFileSync: Function}} deps.fs 同步檔案 I/O。
 * @param {string} deps.file clip_history.json 路徑。
 * @param {(file: string, message: string, type?: string) => void} deps.writeLog 寫入日誌檔。
 * @param {(title: string, body: string, icon?: string, url?: string) => Promise<void>} deps.notify 推播通知。
 * @param {(user: string, message: string, img?: string, giftImg?: string, isMain?: boolean) => boolean} deps.sendSocketMessage 送出 socket 訊息。
 * @param {Console} [deps.logger=console]
 * @returns {ClipService}
 */
export function createClipService({ getApiClient, getTuser, fs, file, writeLog, notify, sendSocketMessage, logger = console }) {
    const { existsSync, readFileSync, writeFileSync } = fs;

    /**
     * 讀取 clip_history.json（相容純陣列或 {clips: []}）。
     * @returns {Array<Object>}
     */
    function loadHistory() {
        try {
            if (existsSync(file)) {
                const data = JSON.parse(readFileSync(file, 'utf-8'));
                if (Array.isArray(data)) return data;
                if (data && Array.isArray(data.clips)) return data.clips;
            }
        } catch (err) {
            logger.error('⚠️ 讀取 clip_history.json 失敗:', err.message);
        }
        return [];
    }

    /**
     * 寫入 clip_history.json。
     * @param {Array<Object>} clips
     * @returns {void}
     */
    function saveHistory(clips) {
        try {
            writeFileSync(file, JSON.stringify(clips, null, 2), 'utf-8');
        } catch (err) {
            logger.error('⚠️ 儲存 clip_history.json 失敗:', err.message);
        }
    }

    /**
     * 在歷史最前插入一筆剪輯（保留最近 200 筆）。
     * @param {{id: string, url: string, title?: (string|null), source?: string, timing?: (Object|null)}} entry
     * @returns {void}
     */
    function recordHistory({ id, url, title = null, source = 'manual', timing = null }) {
        const clips = loadHistory();
        clips.unshift({
            id,
            url,
            title: title || '',
            source,
            timing,
            createdAt: new Date().toISOString()
        });
        saveHistory(clips.slice(0, 200));
    }

    /**
     * 解析剪輯的實際標題：有指定直接用；否則查 API（重試 5 次），失敗則由網址 slug 擷取。
     * @param {string} clipId
     * @param {(string|null)} title
     * @returns {Promise<string>}
     */
    async function resolveTitle(clipId, title) {
        if (title) return title;
        for (let attempt = 1; attempt <= 5; attempt++) {
            try {
                const clip = await getApiClient().clips.getClipById(clipId);
                if (clip && clip.title) {
                    logger.log(`🏷️ 剪輯實際標題: ${clip.title}`);
                    return clip.title;
                }
            } catch (err) {
                logger.log(`⚠️ [剪輯] 取得標題重試 ${attempt}/5: ${err.message}`);
            }
            await new Promise(r => setTimeout(r, 2000));
        }
        const slugName = String(clipId).split('-')[0];
        return slugName && slugName !== String(clipId) ? slugName : '';
    }

    /**
     * 建立 Twitch 剪輯，並在成功或失敗時發送通知。
     * @param {string|null} [title=null] 剪輯標題；null 則不指定，使用當前直播標題。
     * @param {string} [icon=DEFAULT_ICON] 通知用的圖示 URL。
     * @param {string} [source='manual'] 來源（'manual'=G#clip 指令 / 'auto'=自動剪輯）。
     * @param {Object|null} [context=null] 自動剪輯的觸發脈絡（含 peakAt）。
     * @returns {Promise<{id: string, url: string, timing: Object}|undefined>}
     */
    function createClip(title = null, icon = DEFAULT_ICON, source = 'manual', context = null) {
        const requestedAt = Date.now();
        const apiClient = getApiClient();
        const tuser = getTuser();

        return apiClient.clips.createClip({
            channel: tuser,
            duration: 60,
            createAfterDelay: source !== 'auto',
            ...(title ? { title } : {})

        }).then(async (clipId) => {
            let confirmedClip = null;
            if (source === 'auto') {
                // A creation response is only a request acknowledgement; verify availability.
                for (let attempt = 0; attempt < 5; attempt++) {
                    confirmedClip = await apiClient.clips.getClipById(clipId);
                    if (confirmedClip) break;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                if (!confirmedClip) throw new Error(`剪輯 ${clipId} 尚未確認可用，請人工核對；不自動重送`);
            }
            const clipURL = `https://clips.twitch.tv/${clipId}`
            const finalTitle = await resolveTitle(clipId, title);
            const displayText = finalTitle ? `🎬 剪輯已建立「${finalTitle}」：${clipURL}` : `🎬 剪輯已建立：${clipURL}`

            logger.log("剪輯資訊", clipURL)

            // 量測：peak 與剪輯實際片段的時間差。VOD 可能尚未就緒，有界重試幾次。
            const timing = {
                peakAt: context?.peakAt ?? null,
                requestedAt,
                requestLagMs: context?.peakAt != null ? requestedAt - context.peakAt : null,
                verified: false
            };
            if (context) {
                for (let attempt = 1; attempt <= 3 && !timing.verified; attempt++) {
                    try {
                        const clip = confirmedClip;
                        if (clip) {
                            const [stream, video] = await Promise.all([
                                apiClient.streams.getStreamByUserId(tuser),
                                clip.videoId ? apiClient.videos.getVideoById(clip.videoId) : null
                            ]);
                            if (stream && video?.streamId === stream.id && clip.vodOffset != null && Number.isFinite(clip.duration)) {
                                const startAt = stream.startDate.getTime() + clip.vodOffset * 1000;
                                const endAt = startAt + clip.duration * 1000;
                                Object.assign(timing, {
                                    startAt, endAt, verified: true,
                                    peakOffsetMs: context.peakAt != null ? context.peakAt - startAt : null,
                                    coversPeak: context.peakAt >= startAt && context.peakAt <= endAt
                                });
                            }
                        }
                    } catch (err) {
                        logger.log(`[AutoClip] 時間核對第 ${attempt} 次失敗:`, err.message);
                    }
                    if (!timing.verified) await new Promise(resolve => setTimeout(resolve, 4000));
                }
                const secs = ms => ms == null ? 'n/a' : (ms / 1000).toFixed(1) + 's';
                const summary = timing.verified
                    ? `peak→請求 ${secs(timing.requestLagMs)}｜peak 位於片段第 ${secs(timing.peakOffsetMs)}｜片段長 ${secs(timing.endAt - timing.startAt)}｜涵蓋=${timing.coversPeak ? '是' : '否'}`
                    : `未驗證（VOD 未就緒或已關台）｜peak→請求 ${secs(timing.requestLagMs)}`;
                logger.log(`🎯 [AutoClip] 時間量測: ${summary}`);
                writeLog("Default", `[AutoClip] 時間量測: ${summary}`, "Twitch AutoClip");
                context.clipTiming = timing;
            }
            recordHistory({ id: clipId, url: clipURL, title: finalTitle, source, timing });
            logger.log(`📜 剪輯歷史已記錄 (來源: ${source})`);

            writeLog("Default", `[剪輯建立] ${displayText}`)
            notify("剪輯建立", displayText, icon)
            sendSocketMessage("剪輯建立", displayText, icon, '')
            return { id: clipId, url: clipURL, timing };

        }).catch(err => {
            const errMsg = `剪輯建立失敗: ${err.message} (status=${err.response?.status || 'N/A'})`

            logger.error(`❌ [G#clip] ${errMsg}`)

            writeLog("Default", `[${errMsg}]`, "Error")
            sendSocketMessage("剪輯建立", `❌ ${errMsg}`, icon, '')
            notify("剪輯建立失敗", errMsg, icon)
            if (source === 'auto') throw err;

        })
    }

    return { createClip, recordHistory, loadHistory };
}
