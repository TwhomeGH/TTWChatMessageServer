/**
 * 直播訊息監控面板：訂閱 /status/stream/messages（子程序鏡像的 socket payload），
 * 以聊天室列顯示時間／平台／分類／使用者／內容，提供分類篩選、搜尋、自動捲動與清除。
 * 分類清單由 /api/message-categories 取得（單一來源 ScriptLib/messages/categories.cjs）。
 */
(async function () {
    'use strict';
    const i18n = window.TTWI18n;
    if (i18n?.ready) await i18n.ready;
    const t = (key, params, fallback) => (i18n ? i18n.t(key, params, fallback) : (fallback ?? key));

    const MAX_ENTRIES = 1000;
    const PLATFORM_LABELS = {
        tiktok: 'TikTok', twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube', odysee: 'Odysee', system: 'SYS'
    };
    // 分類 → 章節點顏色（Tailwind，需在原始碼中為字面字串才會被編譯）。
    const CATEGORY_STYLES = {
        system: 'bg-gray-700 text-gray-300',
        chat: 'bg-green-900/60 text-green-300',
        member: 'bg-blue-900/60 text-blue-300',
        follow: 'bg-indigo-900/60 text-indigo-300',
        like: 'bg-pink-900/60 text-pink-300',
        gift: 'bg-amber-900/60 text-amber-300',
        share: 'bg-cyan-900/60 text-cyan-300',
        emote: 'bg-teal-900/60 text-teal-300',
        envelope: 'bg-red-900/60 text-red-300',
        superfan: 'bg-purple-900/60 text-purple-300',
        subscribe: 'bg-fuchsia-900/60 text-fuchsia-300',
        clip: 'bg-orange-900/60 text-orange-300',
        ad: 'bg-yellow-900/60 text-yellow-300',
        audience: 'bg-slate-700 text-slate-300',
        summary: 'bg-lime-900/60 text-lime-300',
        heartbeat: 'bg-gray-800 text-gray-400'
    };

    const rowsEl = document.getElementById('monRows');
    const scrollEl = document.getElementById('monScroll');
    const searchEl = document.getElementById('monSearch');
    const filtersEl = document.getElementById('monFilters');
    const autoscrollEl = document.getElementById('monAutoscroll');
    const clearEl = document.getElementById('monClear');
    const countEl = document.getElementById('monCount');
    const statusEl = document.getElementById('monStatus');
    const jumpLatestEl = document.getElementById('monJumpLatest');
    const sessionEl = document.getElementById('monSession');
    const sessionViewersEl = document.getElementById('monSessionViewers');
    const sessionJoinsEl = document.getElementById('monSessionJoins');
    const sessionLikesEl = document.getElementById('monSessionLikes');
    const sessionFollowsEl = document.getElementById('monSessionFollows');
    const sessionSubscriptionsEl = document.getElementById('monSessionSubscriptions');
    const sessionGiftsEl = document.getElementById('monSessionGifts');
    const sessionChatsEl = document.getElementById('monSessionChats');
    const modeLiveEl = document.getElementById('monModeLive');
    const modeHistoryEl = document.getElementById('monModeHistory');
    const historyBarEl = document.getElementById('monHistoryBar');
    const historySessionEl = document.getElementById('monHistorySession');
    const historyPrevEl = document.getElementById('monHistoryPrev');
    const historyNextEl = document.getElementById('monHistoryNext');
    const historyPageEl = document.getElementById('monHistoryPage');
    const historyTotalEl = document.getElementById('monHistoryTotal');
    const testUser = document.getElementById('monTestUser');
    const testAvatar = document.getElementById('monTestAvatar');
    const testAvatarPick = document.getElementById('monTestAvatarPick');
    const testAvatarPreview = document.getElementById('monTestAvatarPreview');
    const testAvatarPreviewStatus = document.getElementById('monTestAvatarPreviewStatus');
    const testPlatform = document.getElementById('monTestPlatform');
    const testCategory = document.getElementById('monTestCategory');
    const testMessage = document.getElementById('monTestMessage');
    const testSocket = document.getElementById('monTestSocket');
    const testNotify = document.getElementById('monTestNotify');
    const testAdd = document.getElementById('monTestAdd');
    const testSend = document.getElementById('monTestSend');
    const testClear = document.getElementById('monTestClear');
    const testStatus = document.getElementById('monTestStatus');
    const mediaPanel = document.getElementById('monMediaPanel');
    const mediaSearch = document.getElementById('monMediaSearch');
    const mediaType = document.getElementById('monMediaType');
    const mediaStatusFilter = document.getElementById('monMediaStatus');
    const mediaRefresh = document.getElementById('monMediaRefresh');
    const mediaStats = document.getElementById('monMediaStats');
    const mediaRows = document.getElementById('monMediaRows');
    const mediaPage = document.getElementById('monMediaPage');
    const mediaPrev = document.getElementById('monMediaPrev');
    const mediaNext = document.getElementById('monMediaNext');
    const mediaStatusText = document.getElementById('monMediaStatusText');
    const rawType = document.getElementById('monRawType');
    const rawUser = document.getElementById('monRawUser');
    const rawCategory = document.getElementById('monRawCategory');
    const rawMessage = document.getElementById('monRawMessage');
    const rawImage = document.getElementById('monRawImage');
    const rawImagePick = document.getElementById('monRawImagePick');
    const rawImagePreview = document.getElementById('monRawImagePreview');
    const rawImagePreviewStatus = document.getElementById('monRawImagePreviewStatus');
    const rawGift = document.getElementById('monRawGift');
    const rawNormalize = document.getElementById('monRawNormalize');
    const rawIsMain = document.getElementById('monRawIsMain');
    const rawSend = document.getElementById('monRawSend');
    const rawStatus = document.getElementById('monRawStatus');
    const TEST_PREFS_KEY = 'ttw-monitor-test-prefs';
    const RAW_PREFS_KEY = 'ttw-monitor-raw-prefs';

    let emojiMap = null;
    let emojiPattern = null;
    let rawMediaItems = [];
    let savedTestPrefs = null;
    let pendingTestId = null;
    let pendingTestTimer = null;
    let testCooldownTimer = null;

    const state = {
        entries: [],
        categories: [],
        active: new Set(),
        query: '',
        autoscroll: true,
        shown: 0,
        unseen: 0,
        session: null,
        mode: 'live',
        history: { sessions: [], sessionId: '', session: null, page: 1, pages: 1, total: 0, messages: [], loading: false },
        media: { page: 1, pages: 1, total: 0, items: [], q: '', type: '', status: '', loading: false, loaded: false },
        statusKey: 'monitor.reconnecting'
    };
    let lastUserScrollIntent = 0;

    function fmtTime(ms) {
        const d = new Date(ms);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    const categoryLabel = name => t(`monitor.cat.${name}`, {}, name);

    /** 顯示子程序維護的本場累計；缺少欄位視為 0。 */
    function updateSession() {
        const session = state.mode === 'history' ? state.history.session : state.session;
        if (!session) { sessionEl.hidden = true; return; }
        const count = value => Math.max(0, Number(value) || 0);
        sessionEl.hidden = false;
        sessionViewersEl.textContent = String(count(session.peakViewers));
        sessionJoinsEl.textContent = String(count(session.joins));
        sessionLikesEl.textContent = String(count(session.likes));
        sessionFollowsEl.textContent = String(count(session.follows));
        sessionSubscriptionsEl.textContent = String(count(session.subscriptions));
        sessionGiftsEl.textContent = String(count(session.gifts));
        sessionChatsEl.textContent = String(count(session.chats));
    }

    function setHistoryStatus(text, error = false) {
        statusEl.textContent = text;
        statusEl.className = 'text-xs ' + (error ? 'text-red-400' : 'text-yellow-400');
    }

    function historySessionLabel(session) {
        const date = new Date(session.startedAt).toLocaleString(window.TTWI18n.language,
            { dateStyle: 'medium', timeStyle: 'short' });
        const platforms = (session.platforms || []).join(' / ') || '—';
        return t('monitor.history.sessionLabel', {
            date, platforms, count: session.messageCount
        }, `${date} · ${platforms} · ${session.messageCount}`);
    }

    function renderHistory() {
        const history = state.history;
        const fragment = document.createDocumentFragment();
        if (history.messages.length) {
            for (const entry of history.messages) fragment.append(makeRow(entry));
        } else {
            const empty = document.createElement('div');
            empty.className = 'mon-history-empty';
            empty.textContent = t('monitor.history.empty', {}, '這個場次沒有符合的訊息。');
            fragment.append(empty);
        }
        rowsEl.replaceChildren(fragment);
        historySessionEl.value = history.sessionId;
        historyPageEl.textContent = t('monitor.history.page', { page: history.page, pages: history.pages },
            `第 ${history.page} / ${history.pages} 頁`);
        historyTotalEl.textContent = t('monitor.history.total', { total: history.total }, `共 ${history.total} 則`);
        historyPrevEl.disabled = history.page <= 1;
        historyNextEl.disabled = history.page >= history.pages;
        countEl.textContent = t('monitor.count', {
            shown: history.messages.length, total: history.total
        }, `${history.messages.length} / ${history.total}`);
        jumpLatestEl.hidden = true;
        updateSession();
        setHistoryStatus(t('monitor.history.status', {}, '歷史模式'));
    }

    function clearHistoryRows() {
        rowsEl.replaceChildren();
        countEl.textContent = '';
        historyPageEl.textContent = '';
        historyTotalEl.textContent = '';
        historyPrevEl.disabled = true;
        historyNextEl.disabled = true;
        state.history.session = null;
        updateSession();
    }

    async function loadHistoryMessages(page = 1) {
        const history = state.history;
        if (!history.sessionId || history.loading) return;
        history.loading = true;
        try {
            const categories = [...state.active].join(',');
            const params = new URLSearchParams({
                session: history.sessionId, page: String(page), pageSize: '200',
                q: state.query, categories
            });
            const response = await fetch('/api/monitor/messages?' + params, { cache: 'no-store' });
            if (response.status === 401) {
                clearHistoryRows();
                setHistoryStatus(t('monitor.history.login', {}, '歷史需要主服務登入。'), true);
                return;
            }
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.error || 'HTTP ' + response.status);
            state.history = {
                ...history,
                sessionId: data.session.id, session: data.session, page: data.page, pages: data.pages,
                total: data.total, messages: data.messages || [], loading: false
            };
            renderHistory();
        } catch (error) {
            setHistoryStatus(t('monitor.history.loadError', { error: error.message },
                '歷史載入失敗：' + error.message), true);
        } finally {
            state.history.loading = false;
        }
    }

    async function loadHistorySessions() {
        setHistoryStatus(t('monitor.history.status', {}, '歷史模式'));
        try {
            const response = await fetch('/api/monitor/sessions', { cache: 'no-store' });
            if (response.status === 401) {
                clearHistoryRows();
                setHistoryStatus(t('monitor.history.login', {}, '歷史需要主服務登入。'), true);
                return;
            }
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.error || 'HTTP ' + response.status);
            const sessions = data.sessions || [];
            state.history.sessions = sessions;
            historySessionEl.replaceChildren(...sessions.map(session => {
                const option = document.createElement('option');
                option.value = session.id;
                option.textContent = historySessionLabel(session);
                return option;
            }));
            historySessionEl.disabled = sessions.length === 0;
            if (!sessions.length) {
                state.history = {
                    ...state.history, sessionId: '', session: null, page: 1, pages: 1, total: 0, messages: []
                };
                clearHistoryRows();
                updateSession();
                setHistoryStatus(t('monitor.history.noSessions', {}, '尚無歷史場次。'));
                return;
            }
            const selected = sessions.some(session => session.id === state.history.sessionId)
                ? state.history.sessionId : sessions[0].id;
            state.history.sessionId = selected;
            state.history.session = sessions.find(session => session.id === selected) || null;
            historySessionEl.value = selected;
            await loadHistoryMessages(1);
        } catch (error) {
            setHistoryStatus(t('monitor.history.loadError', { error: error.message },
                '歷史載入失敗：' + error.message), true);
        }
    }

    function setMode(mode) {
        if (state.mode === mode) return;
        state.mode = mode;
        const live = mode === 'live';
        modeLiveEl.classList.toggle('is-active', live);
        modeHistoryEl.classList.toggle('is-active', !live);
        historyBarEl.hidden = live;
        autoscrollEl.disabled = !live;
        clearEl.disabled = !live;
        if (live) {
            renderAll();
            updateSession();
            updateJump();
            setStatus(state.statusKey);
        } else {
            jumpLatestEl.hidden = true;
            loadHistorySessions();
        }
    }

    function refreshView() {
        if (state.mode === 'history') loadHistoryMessages(1);
        else renderAll();
    }

    /** 建立與 EmojiMap 相同的字面匹配規則（長代碼優先）。 */
    function buildEmojiPattern(map) {
        const codes = Object.keys(map || {}).sort((a, b) => b.length - a.length);
        if (!codes.length) return null;
        const escaped = codes.map(code => code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(escaped.join('|'), 'g');
    }

    /** 把測試文字拆成文字片段與 emoji 對應；只做一次替換。 */
    function emojiParts(text) {
        const value = String(text ?? '');
        if (!emojiPattern) return [value];
        const parts = [];
        let last = 0;
        for (const match of value.matchAll(emojiPattern)) {
            if (match.index > last) parts.push(value.slice(last, match.index));
            parts.push({ code: match[0], url: emojiMap[match[0]] });
            last = match.index + match[0].length;
        }
        if (last < value.length) parts.push(value.slice(last));
        return parts;
    }

    function setTestStatus(text) {
        testStatus.textContent = text;
    }

    function validAvatar(value) {
        try {
            const url = new URL(value);
            return ['http:', 'https:'].includes(url.protocol);
        } catch { return false; }
    }

    function isImageSource(value) {
        return /^https?:\/\//i.test(value) || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value);
    }

    function updateRawImagePreview() {
        const value = rawImage.value.trim();
        if (!value) {
            rawImagePreview.hidden = true;
            rawImagePreview.removeAttribute('src');
            rawImagePreviewStatus.textContent = '';
            return;
        }
        if (!isImageSource(value)) {
            rawImagePreview.hidden = true;
            rawImagePreviewStatus.textContent = t('monitor.test.avatarPreviewInvalid', {}, '需為 HTTP(S) URL 或 data URI。');
            return;
        }
        rawImagePreview.hidden = false;
        rawImagePreviewStatus.textContent = '';
        rawImagePreview.onerror = () => {
            rawImagePreview.hidden = true;
            rawImagePreviewStatus.textContent = t('monitor.test.avatarPreviewError', {}, '圖片無法載入。');
        };
        rawImagePreview.onload = () => {
            rawImagePreview.hidden = false;
            rawImagePreviewStatus.textContent = '';
        };
        rawImagePreview.src = value;
    }

    function updateAvatarPreview() {
        const value = testAvatar.value.trim();
        if (!value) {
            testAvatarPreview.hidden = true;
            testAvatarPreview.removeAttribute('src');
            testAvatarPreviewStatus.textContent = '';
            return;
        }
        if (!validAvatar(value)) {
            testAvatarPreview.hidden = true;
            testAvatarPreviewStatus.textContent = t('monitor.test.avatarPreviewInvalid', {}, '頭貼需為 HTTP(S) URL。');
            return;
        }
        testAvatarPreview.hidden = false;
        testAvatarPreviewStatus.textContent = '';
        testAvatarPreview.onerror = () => {
            testAvatarPreview.hidden = true;
            testAvatarPreviewStatus.textContent = t('monitor.test.avatarPreviewError', {}, '圖片無法載入。');
        };
        testAvatarPreview.onload = () => {
            testAvatarPreview.hidden = false;
            testAvatarPreviewStatus.textContent = '';
        };
        testAvatarPreview.src = value;
    }

    function loadTestPrefs() {
        try {
            const data = JSON.parse(localStorage.getItem(TEST_PREFS_KEY) || 'null');
            return data && typeof data === 'object' ? data : null;
        } catch { return null; }
    }

    function saveTestPrefs() {
        try {
            localStorage.setItem(TEST_PREFS_KEY, JSON.stringify({
                user: testUser.value,
                avatar: testAvatar.value.trim(),
                platform: testPlatform.value,
                category: testCategory.value,
                socket: testSocket.checked,
                notify: testNotify.checked
            }));
        } catch { /* 無痕模式或儲存額度不足時不影響測試 */ }
    }

    function loadRawPrefs() {
        try {
            const data = JSON.parse(localStorage.getItem(RAW_PREFS_KEY) || 'null');
            return data && typeof data === 'object' ? data : null;
        } catch { return null; }
    }

    function saveRawPrefs() {
        try {
            localStorage.setItem(RAW_PREFS_KEY, JSON.stringify({
                user: rawUser.value,
                image: rawImage.value,
                gift: rawGift.value
            }));
        } catch { /* ignore */ }
    }

    function restoreRawPrefs() {
        const saved = loadRawPrefs();
        if (!saved) return;
        if (typeof saved.user === 'string') rawUser.value = saved.user;
        if (typeof saved.image === 'string') rawImage.value = saved.image;
        if (typeof saved.gift === 'string') rawGift.value = saved.gift;
    }

    function restoreTestPrefs() {
        if (!savedTestPrefs) return;
        if (typeof savedTestPrefs.user === 'string') testUser.value = savedTestPrefs.user;
        if (validAvatar(savedTestPrefs.avatar)) testAvatar.value = savedTestPrefs.avatar;
        if ([...testPlatform.options].some(option => option.value === savedTestPrefs.platform)) {
            testPlatform.value = savedTestPrefs.platform;
        }
        if (typeof savedTestPrefs.socket === 'boolean') testSocket.checked = savedTestPrefs.socket;
        if (typeof savedTestPrefs.notify === 'boolean') testNotify.checked = savedTestPrefs.notify;
    }

    function restoreTestCategory() {
        if (!savedTestPrefs?.category) return;
        if ([...testCategory.options].some(option => option.value === savedTestPrefs.category)) {
            testCategory.value = savedTestPrefs.category;
        }
    }

    function buildAvatarOptions() {
        const byUrl = new Map();
        for (const [code, url] of Object.entries(emojiMap || {}).sort(([a], [b]) => a.localeCompare(b))) {
            if (typeof url === 'string' && !byUrl.has(url)) byUrl.set(url, code);
        }
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = t('monitor.test.avatarPickEmpty', {}, '—');
        const options = [empty];
        for (const [url, code] of byUrl) {
            const option = document.createElement('option');
            option.value = url;
            option.textContent = code;
            options.push(option);
        }
        testAvatarPick.replaceChildren(...options);
        testAvatarPick.disabled = byUrl.size === 0;
        if (byUrl.has(testAvatar.value)) testAvatarPick.value = testAvatar.value;
        buildRawImageOptions();
    }

    function buildRawImageOptions() {
        const previous = rawImagePick.value;
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = t('monitor.test.avatarPickEmpty', {}, '—');
        const options = [empty];
        if (rawMediaItems.length) {
            const group = document.createElement('optgroup');
            group.label = 'MediaCache';
            for (const item of rawMediaItems) {
                const option = document.createElement('option');
                option.value = item.localUrl;
                option.textContent = `${item.hash.slice(0, 10)} · ${item.host || item.contentType || 'media'}`;
                group.append(option);
            }
            options.push(group);
        }
        const emojiByUrl = new Map();
        for (const [code, url] of Object.entries(emojiMap || {}).sort(([a], [b]) => a.localeCompare(b))) {
            if (typeof url === 'string' && !emojiByUrl.has(url)) emojiByUrl.set(url, code);
        }
        if (emojiByUrl.size) {
            const group = document.createElement('optgroup');
            group.label = 'emoji';
            for (const [url, code] of emojiByUrl) {
                const option = document.createElement('option');
                option.value = url;
                option.textContent = code;
                group.append(option);
            }
            options.push(group);
        }
        rawImagePick.replaceChildren(...options);
        rawImagePick.disabled = options.length <= 1;
        if (options.some(option => option.value === previous)) rawImagePick.value = previous;
    }

    async function loadRawMediaOptions() {
        try {
            const response = await fetch('/api/media?pageSize=200&status=cached', { cache: 'no-store' });
            if (!response.ok) return;
            const data = await response.json();
            rawMediaItems = data.ok && Array.isArray(data.items) ? data.items : [];
            buildRawImageOptions();
        } catch { /* 無登入或 API 不可用時只顯示 emoji */ }
    }

    function clearTestPrefs() {
        clearTestPending();
        clearTestCooldown();
        try { localStorage.removeItem(TEST_PREFS_KEY); } catch { /* ignore */ }
        try { localStorage.removeItem(RAW_PREFS_KEY); } catch { /* ignore */ }
        savedTestPrefs = null;
        rawUser.value = '';
        rawImage.value = '';
        rawGift.value = '';
        rawImagePick.value = '';
        testUser.value = '';
        testAvatar.value = '';
        testAvatarPick.value = '';
        testMessage.value = '';
        testPlatform.value = 'tiktok';
        testCategory.value = [...testCategory.options].some(option => option.value === 'chat')
            ? 'chat' : (testCategory.options[0]?.value || '');
        testSocket.checked = true;
        testNotify.checked = false;
        updateAvatarPreview();
        updateRawImagePreview();
        setTestStatus(t('monitor.test.cleared', {}, '已清除測試設定。'));
    }

    function applyTestI18n() {
        testUser.placeholder = t('monitor.test.userPlaceholder', {}, '測試使用者');
        testAvatar.placeholder = t('monitor.test.avatarPlaceholder', {}, 'https://…');
        testMessage.placeholder = t('monitor.test.messagePlaceholder', {}, '哈囉 [laughcry] 測試');
    }

    function buildTestCategories() {
        const previous = testCategory.value;
        const names = state.categories.length ? state.categories : ['chat'];
        testCategory.replaceChildren(...names.map(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = categoryLabel(name);
            return option;
        }));
        testCategory.value = names.includes(previous) ? previous : (names.includes('chat') ? 'chat' : names[0]);
    }

    function addTestMessage() {
        const message = testMessage.value;
        if (!message.trim()) {
            setTestStatus(t('monitor.test.empty', {}, '請先輸入訊息。'));
            return;
        }
        const avatar = testAvatar.value.trim();
        if (avatar && !validAvatar(avatar)) {
            setTestStatus(t('monitor.test.invalidAvatar', {}, '頭貼需為 HTTP(S) URL。'));
            return;
        }
        saveTestPrefs();
        append({
            t: Date.now(),
            category: testCategory.value || 'chat',
            platform: testPlatform.value || 'unknown',
            user: testUser.value.trim() || t('monitor.test.userDefault', {}, '測試使用者'),
            message,
            img: avatar,
            test: true
        });
        setTestStatus(t('monitor.test.added', {}, '已加入本機預覽；不會送出。'));
    }

    function clearTestPending() {
        if (pendingTestTimer) clearTimeout(pendingTestTimer);
        pendingTestTimer = null;
        pendingTestId = null;
        testSend.disabled = false;
        rawSend.disabled = false;
    }

    function clearTestCooldown() {
        if (testCooldownTimer) clearInterval(testCooldownTimer);
        testCooldownTimer = null;
    }

    function channelLabel(name) {
        return name === 'bark' ? 'Bark' : name === 'ntfy' ? 'ntfy' : name;
    }

    function describeNotify(notify) {
        if (!notify || notify.status === 'skipped') return '';
        const channels = Array.isArray(notify.channels)
            ? notify.channels.map(item => ({ name: channelLabel(item.name), ok: item.ok === true }))
            : [];
        const ok = channels.filter(item => item.ok).map(item => item.name);
        const failed = channels.filter(item => !item.ok).map(item => item.name);
        if (notify.status === 'nochannels') return t('monitor.test.notifyNoChannels', {}, '未啟用通知通道');
        if (notify.status === 'sent') return t('monitor.test.notifySent', { channels: ok.join(', ') || '—' }, `已送出（${ok.join(', ') || '—'}）`);
        if (notify.status === 'partial') return t('monitor.test.notifyPartial', { ok: ok.join(', ') || '—', failed: failed.join(', ') || '—' }, `部分成功（${ok.join(', ') || '—'}；失敗：${failed.join(', ') || '—'}）`);
        return t('monitor.test.notifyFailed', { channels: failed.join(', ') || channels.map(item => item.name).join(', ') || '—' }, `失敗（${failed.join(', ') || '—'}）`);
    }

    function startTestCooldown(remainingMs, duplicate, notifyText = '') {
        clearTestCooldown();
        const until = Date.now() + Math.max(0, Number(remainingMs) || 0);
        const key = duplicate ? 'monitor.test.resultDuplicate' : 'monitor.test.resultSent';
        const suffix = notifyText ? ` · ${t('monitor.test.notifyLabel', {}, '通知')}：${notifyText}` : '';
        const render = () => {
            const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
            if (seconds <= 0) {
                clearTestCooldown();
                setTestStatus(t('monitor.test.cooldownDone', {}, '去重冷卻結束，可再次送出。') + suffix);
                return;
            }
            setTestStatus(t(key, { seconds }, duplicate ? `重複；去重保護剩 ${seconds} 秒` : `已送出；去重保護剩 ${seconds} 秒`) + suffix);
        };
        render();
        if (Date.now() < until) testCooldownTimer = setInterval(render, 1000);
    }

    function handleTestResult(result) {
        if (!result || result.testId !== pendingTestId) return;
        clearTestPending();
        if (result.mode === 'raw') {
            const endpoints = Number(result.endpoints) || 0;
            if (result.status === 'sent') {
                setRawStatus(t('monitor.raw.sent', { endpoints }, `已送出（${endpoints} 個端點）。`));
            } else if (result.status === 'noendpoints') {
                setRawStatus(t('monitor.raw.noendpoints', {}, '沒有啟用中的 Socket 端點。'), true);
            } else if (result.status === 'offline') {
                setRawStatus(t('monitor.raw.offline', {}, 'TikTok 子程序未運行。'), true);
            } else {
                setRawStatus(t('monitor.raw.error', { error: result.status || 'unknown' },
                    'Raw Socket 失敗：' + (result.status || 'unknown')), true);
            }
            return;
        }
        const notifyText = describeNotify(result.notify);
        const suffix = notifyText ? ` · ${t('monitor.test.notifyLabel', {}, '通知')}：${notifyText}` : '';
        switch (result.status) {
            case 'sent':
            case 'duplicate':
                startTestCooldown(result.remainingMs, result.status === 'duplicate', notifyText);
                break;
            case 'filtered':
                setTestStatus(t('monitor.test.resultFiltered', {}, '被過濾，未送 socket。') + suffix);
                break;
            case 'ignored':
                setTestStatus(t('monitor.test.resultIgnored', {}, '未進入聊天統計（可能重複或未達條件）。') + suffix);
                break;
            case 'offline':
                setTestStatus(t('monitor.test.resultOffline', {}, 'TikTok 子程序未運行，未送 socket。') + suffix);
                break;
            case 'skipped':
                setTestStatus(t('monitor.test.socketSkipped', {}, 'Socket：未選') + suffix);
                break;
            default:
                setTestStatus(t('monitor.test.resultUnknown', { status: result.status }, '未知結果：' + result.status) + suffix);
        }
    }

    function setRawStatus(text, error = false) {
        rawStatus.textContent = text;
        rawStatus.className = 'text-xs ' + (error ? 'text-red-400' : 'text-green-400');
    }

    function rawPayload() {
        const type = rawType.value === 'AdOverlay' ? 'AdOverlay' : 'StreamMessage';
        const user = rawUser.value.trim() || t('monitor.test.userDefault', {}, '測試使用者');
        const message = rawMessage.value;
        if (type === 'AdOverlay') {
            return {
                type, category: rawCategory.value.trim() || 'ad', user, text: message,
                iconURL: rawGift.value.trim() || rawImage.value.trim(), useTTS: false
            };
        }
        return {
            type, category: rawCategory.value.trim() || 'chat', platform: 'unknown', user,
            message, img: rawImage.value.trim(), giftImg: rawGift.value.trim(),
            isMain: rawIsMain.checked
        };
    }

    async function sendRawSocketTest() {
        const testId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        pendingTestId = testId;
        rawSend.disabled = true;
        setRawStatus(t('monitor.raw.waiting', {}, '等待 Raw Socket 結果…'));
        pendingTestTimer = setTimeout(() => {
            if (!pendingTestId) return;
            clearTestPending();
            setRawStatus(t('monitor.test.resultTimeout', {}, '未收到處理結果；子程序或結果 SSE 可能中斷。'), true);
        }, 5000);
        try {
            const response = await fetch('/api/socket/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    testId,
                    normalize: rawNormalize.checked,
                    payload: rawPayload()
                })
            });
            if (response.status === 401) {
                clearTestPending();
                setRawStatus(t('monitor.raw.login', {}, 'Raw Socket 測試需要主服務登入。'), true);
                return;
            }
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                const offline = response.status === 409;
                clearTestPending();
                setRawStatus(offline
                    ? t('monitor.raw.offline', {}, 'TikTok 子程序未運行。')
                    : t('monitor.raw.error', { error: data.error || ('HTTP ' + response.status) },
                        'Raw Socket 失敗：' + (data.error || ('HTTP ' + response.status))), true);
            }
        } catch (error) {
            if (pendingTestId === testId) {
                clearTestPending();
                setRawStatus(t('monitor.raw.error', { error: error.message },
                    'Raw Socket 失敗：' + error.message), true);
            }
        }
    }

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value < 1024) return value + ' B';
        if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
        return (value / 1024 / 1024).toFixed(1) + ' MiB';
    }

    function setMediaStatus(text, error = false) {
        mediaStatusText.textContent = text;
        mediaStatusText.className = error ? 'text-xs text-red-400' : 'text-xs text-gray-400';
    }

    function copyButtonFeedback(button, label, error = false) {
        if (!button) return;
        clearTimeout(button._copyFeedbackTimer);
        button.textContent = label;
        button.style.color = error ? '#fca5a5' : '#86efac';
        button.style.borderColor = error ? '#b91c1c' : '#15803d';
        button._copyFeedbackTimer = setTimeout(() => {
            button.textContent = t('monitor.media.copy', {}, '複製連結');
            button.style.color = '';
            button.style.borderColor = '';
        }, 1500);
    }

    function copyWithExecCommand(value) {
        const previous = document.activeElement;
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.append(area);
        try {
            area.focus();
            area.select();
            area.setSelectionRange(0, area.value.length);
            return document.execCommand('copy');
        } finally {
            area.remove();
            if (previous && typeof previous.focus === 'function') previous.focus();
        }
    }

    async function copyText(value) {
        // 只有 secure context（HTTPS／localhost）才有正確的 Clipboard API。
        if (window.isSecureContext && navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(value);
                return 'clipboard';
            } catch { /* 權限被拒時再試 fallback */ }
        }
        // 非 secure context 直接同步 fallback，避免 await 消耗使用者手勢。
        if (copyWithExecCommand(value)) return 'fallback';
        throw new Error('copy-unavailable');
    }

    async function copyMediaLink(link, button = null) {
        try {
            const method = await copyText(link);
            copyButtonFeedback(button, t('monitor.media.copiedShort', {}, '已複製'));
            setMediaStatus(method === 'clipboard'
                ? t('monitor.media.copiedClipboard', {}, '已複製（Clipboard API）。')
                : t('monitor.media.copiedFallback', {}, '已複製（瀏覽器 fallback）。'));
        } catch {
            copyButtonFeedback(button, t('monitor.media.copyFailedShort', {}, '複製失敗'), true);
            setMediaStatus(t('monitor.media.copyManual', {}, '自動複製失敗，請手動複製。'), true);
            window.prompt(t('monitor.media.copyManualPrompt', {}, '請手動複製以下連結：'), link);
        }
    }

    function mediaStatusLabel(status) {
        if (status === 'cached') return t('monitor.media.cached', {}, '已快取');
        if (status === 'failed') return t('monitor.media.failed', {}, '失敗過');
        return t('monitor.media.missing', {}, '缺少檔案');
    }

    function renderMedia() {
        const media = state.media;
        mediaRows.replaceChildren();
        if (!media.items.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 8;
            td.className = 'text-gray-400';
            td.textContent = t('monitor.media.empty', {}, '沒有符合的媒體。');
            tr.append(td);
            mediaRows.append(tr);
        }
        for (const item of media.items) {
            const tr = document.createElement('tr');
            const preview = document.createElement('td');
            const image = document.createElement('img');
            image.src = item.localUrl;
            image.loading = 'lazy';
            image.alt = '';
            image.addEventListener('error', () => { image.hidden = true; });
            preview.append(image);
            const hash = document.createElement('td');
            const code = document.createElement('code');
            code.textContent = item.hash.slice(0, 12) + '…';
            code.title = item.hash;
            hash.append(code);
            const type = document.createElement('td');
            type.textContent = item.contentType || '—';
            const size = document.createElement('td');
            size.textContent = formatBytes(item.byteSize);
            const host = document.createElement('td');
            host.textContent = item.host || '—';
            const accessed = document.createElement('td');
            accessed.textContent = item.lastAccess ? new Date(item.lastAccess).toLocaleString(window.TTWI18n.language) : '—';
            const status = document.createElement('td');
            status.textContent = mediaStatusLabel(item.status);
            const actions = document.createElement('td');
            const copy = document.createElement('button');
            copy.type = 'button';
            copy.textContent = t('monitor.media.copy', {}, '複製連結');
            copy.addEventListener('click', () => copyMediaLink(item.localUrl, copy));
            const open = document.createElement('a');
            open.href = item.localUrl;
            open.target = '_blank';
            open.rel = 'noopener';
            open.textContent = t('monitor.media.open', {}, '開啟');
            actions.append(copy, ' ', open);
            tr.append(preview, hash, type, size, host, accessed, status, actions);
            mediaRows.append(tr);
        }
        const stats = media.stats || {};
        mediaStats.textContent = `${stats.total || 0} · ${formatBytes(stats.bytes)} · cached ${stats.cached || 0} · failed ${stats.failed || 0} · missing ${stats.missing || 0}`;
        mediaPage.textContent = t('monitor.history.page', { page: media.page, pages: media.pages },
            `第 ${media.page} / ${media.pages} 頁`);
        mediaPrev.disabled = media.page <= 1;
        mediaNext.disabled = media.page >= media.pages;
        setMediaStatus(`${t('monitor.media.title', {}, 'MediaCache 資源')} · ${media.total}`);
    }

    async function loadMedia() {
        if (state.media.loading) return;
        state.media.loading = true;
        try {
            const params = new URLSearchParams({
                page: String(state.media.page), pageSize: '50',
                q: state.media.q, type: state.media.type, status: state.media.status
            });
            const response = await fetch('/api/media?' + params, { cache: 'no-store' });
            if (response.status === 401) {
                mediaRows.replaceChildren();
                setMediaStatus(t('monitor.media.login', {}, 'MediaCache 需要主服務登入。'), true);
                return;
            }
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.error || ('HTTP ' + response.status));
            state.media = {
                ...state.media, page: data.page, pages: data.pages, total: data.total,
                items: data.items || [], stats: data.stats || {}, loading: false, loaded: true
            };
            renderMedia();
        } catch (error) {
            setMediaStatus(t('monitor.media.error', { error: error.message }, '讀取失敗：' + error.message), true);
        } finally {
            state.media.loading = false;
        }
    }

    async function sendSocketTest() {
        const message = testMessage.value;
        if (!message.trim()) {
            setTestStatus(t('monitor.test.empty', {}, '請先輸入訊息。'));
            return;
        }
        const avatar = testAvatar.value.trim();
        if (avatar && !validAvatar(avatar)) {
            setTestStatus(t('monitor.test.invalidAvatar', {}, '頭貼需為 HTTP(S) URL。'));
            return;
        }
        const dispatch = { socket: testSocket.checked, notify: testNotify.checked };
        if (!dispatch.socket && !dispatch.notify) {
            setTestStatus(t('monitor.test.targetRequired', {}, '請至少選擇 Socket 或通知。'));
            return;
        }
        if (!window.confirm(t('monitor.test.confirmSend', {}, '會依勾選目標派發；通知會送到已啟用的 Bark／ntfy。確定？'))) return;
        saveTestPrefs();
        clearTestCooldown();
        const testId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        pendingTestId = testId;
        testSend.disabled = true;
        setTestStatus(t('monitor.test.waiting', {}, '等待處理結果…'));
        pendingTestTimer = setTimeout(() => {
            if (!pendingTestId) return;
            clearTestPending();
            setTestStatus(t('monitor.test.resultTimeout', {}, '未收到處理結果；子程序或結果 SSE 可能中斷。'));
        }, dispatch.notify ? 15000 : 5000);
        try {
            let runtime = null;
            try { runtime = await fetch('/api/runtime').then(response => response.ok ? response.json() : null); } catch { /* 檢查失敗仍嘗試送出 */ }
            if (runtime && runtime.running === false) {
                if (pendingTestId === testId) {
                    clearTestPending();
                    setTestStatus(t('monitor.test.runtimeOff', {}, 'TikTok 子程序未運行，請先啟動。'));
                }
                return;
            }
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'StreamMessage', platform: testPlatform.value || 'unknown',
                    transport: 'userscript', isTest: true, testId, testDispatch: dispatch,
                    user: testUser.value.trim() || t('monitor.test.userDefault', {}, '測試使用者'),
                    message, img: avatar, observedAt: Date.now()
                })
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
        } catch (error) {
            if (pendingTestId === testId) {
                clearTestPending();
                setTestStatus(t('monitor.test.sendFailed', { error: error.message }, '送出失敗：' + error.message));
            }
        }
    }

    function matches(entry) {
        if (state.active.size && !state.active.has(entry.category || 'system')) return false;
        if (!state.query) return true;
        const haystack = `${entry.user || ''} ${entry.message || ''}`.toLowerCase();
        return haystack.includes(state.query);
    }

    function makeRow(entry) {
        const row = document.createElement('div');
        row.className = 'mon-row flex items-start gap-2 px-3 py-1 border-b border-gray-800/60 hover:bg-gray-900/50';
        if (entry.test) row.classList.add('mon-test');

        const time = document.createElement('span');
        time.className = 'mon-time shrink-0 text-gray-500 select-none';
        time.textContent = fmtTime(entry.t);

        const platform = document.createElement('span');
        platform.className = 'mon-platform shrink-0 text-[11px] leading-5 px-1.5 rounded bg-gray-800 text-gray-400';
        platform.textContent = PLATFORM_LABELS[entry.platform] || entry.platform || '—';

        const category = entry.category || 'system';
        const chip = document.createElement('span');
        chip.className = `mon-cat shrink-0 text-[11px] leading-5 px-1.5 rounded ${CATEGORY_STYLES[category] || CATEGORY_STYLES.system}`;
        chip.textContent = categoryLabel(category);

        const testBadge = document.createElement('span');
        testBadge.className = 'mon-test-badge shrink-0';
        testBadge.textContent = t('monitor.test.badge', {}, '測試');

        const body = document.createElement('span');
        body.className = 'mon-body flex-1 min-w-0';
        if (entry.img) {
            const avatar = document.createElement('img');
            avatar.className = 'mon-avatar inline-block w-5 h-5 rounded-full align-middle mr-1.5';
            avatar.loading = 'lazy';
            avatar.referrerPolicy = 'no-referrer';
            avatar.src = entry.img;
            avatar.onerror = () => avatar.remove();
            body.append(avatar);
        }
        const user = document.createElement('span');
        user.className = 'mon-user font-semibold text-gray-100';
        user.textContent = `${entry.user ?? ''} `;
        const tags = document.createElement('span');
        tags.className = 'mon-tags';
        for (const label of (entry.audience?.labels || []).slice(0, 2)) {
            const tag = document.createElement('span');
            tag.className = `mon-tag mon-tag-${label}`;
            tag.textContent = t(`monitor.audience.${label}`, {}, label);
            tags.append(tag);
        }
        if (entry.audience) {
            tags.title = t('monitor.audience.tooltip', {
                sessions: entry.audience.sessions, streak: entry.audience.streak,
                messages: entry.audience.messages, gifts: entry.audience.gifts
            }, '');
        }
        const message = document.createElement('span');
        message.className = 'mon-msg text-gray-300 whitespace-pre-wrap break-words';
        if (entry.test) {
            for (const part of emojiParts(entry.message)) {
                if (typeof part === 'string') {
                    message.append(document.createTextNode(part));
                    continue;
                }
                const emoji = document.createElement('img');
                emoji.className = 'mon-emoji';
                emoji.alt = part.code;
                emoji.title = `${part.code} → ${part.url}`;
                emoji.referrerPolicy = 'no-referrer';
                emoji.onerror = () => emoji.replaceWith(document.createTextNode(part.code));
                emoji.src = part.url;
                message.append(emoji);
            }
        } else {
            message.textContent = String(entry.message ?? '');
        }
        body.append(user);
        if (tags.childElementCount) body.append(tags);
        body.append(message);

        row.append(time, platform, ...(entry.test ? [testBadge] : []), chip, body);
        return row;
    }

    function updateCount() {
        countEl.textContent = t('monitor.count', { shown: state.shown, total: state.entries.length }, `${state.shown} / ${state.entries.length}`);
    }

    const atBottom = () => scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 8;
    const scrollToBottom = () => { scrollEl.scrollTop = scrollEl.scrollHeight; };

    function updateJump() {
        const hidden = state.autoscroll || state.unseen <= 0;
        jumpLatestEl.hidden = hidden;
        if (!hidden) jumpLatestEl.textContent = t('monitor.newMessages', { count: state.unseen }, `${state.unseen} 則新訊息 ↓`);
    }

    function renderAll() {
        const fragment = document.createDocumentFragment();
        state.shown = 0;
        for (const entry of state.entries) {
            if (!matches(entry)) continue;
            fragment.append(makeRow(entry));
            state.shown++;
        }
        rowsEl.replaceChildren(fragment);
        updateCount();
        if (state.autoscroll) scrollToBottom();
        updateJump();
    }

    function append(entry) {
        state.entries.push(entry);
        if (entry.session && typeof entry.session === 'object') {
            state.session = entry.session;
            updateSession();
        }
        if (state.entries.length > MAX_ENTRIES) {
            const removed = state.entries.shift();
            if (state.mode === 'live' && matches(removed) && rowsEl.firstElementChild) {
                rowsEl.firstElementChild.remove();
                state.shown--;
            }
        }
        if (state.mode !== 'live') return;
        if (!matches(entry)) { updateCount(); return; }
        rowsEl.append(makeRow(entry));
        state.shown++;
        updateCount();
        if (state.autoscroll) {
            scrollToBottom();
        } else {
            state.unseen++;
            updateJump();
        }
    }

    function buildFilters() {
        const fragment = document.createDocumentFragment();
        const allActive = state.active.size === 0;
        const all = document.createElement('button');
        all.type = 'button';
        all.textContent = t('monitor.filter.all', {}, '全部');
        all.setAttribute('aria-pressed', String(allActive));
        all.className = allActive
            ? 'mon-filter px-2 py-1 rounded border border-transparent bg-blue-600 text-white'
            : 'mon-filter px-2 py-1 rounded border border-gray-700 bg-gray-900 text-gray-400';
        all.addEventListener('click', () => { state.active.clear(); buildFilters(); refreshView(); });
        fragment.append(all);

        for (const name of state.categories) {
            const on = state.active.has(name);
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = categoryLabel(name);
            button.setAttribute('aria-pressed', String(on));
            button.className = on
                ? 'mon-filter px-2 py-1 rounded border border-transparent bg-blue-600 text-white'
                : 'mon-filter px-2 py-1 rounded border border-gray-700 bg-gray-900 text-gray-400';
            button.addEventListener('click', () => {
                if (state.active.has(name)) state.active.delete(name);
                else state.active.add(name);
                buildFilters();
                refreshView();
            });
            fragment.append(button);
        }
        filtersEl.replaceChildren(fragment);
    }

    function setStatus(key) {
        state.statusKey = key;
        statusEl.textContent = t(key, {}, key);
        statusEl.className = 'text-xs ' + (key === 'monitor.connected' ? 'text-green-400' : 'text-yellow-400');
    }

    searchEl.addEventListener('input', () => {
        state.query = searchEl.value.trim().toLowerCase();
        if (state.mode === 'history') {
            clearTimeout(state.history.timer);
            state.history.timer = setTimeout(() => loadHistoryMessages(1), 250);
        } else {
            renderAll();
        }
    });
    clearEl.addEventListener('click', () => {
        state.entries = [];
        rowsEl.replaceChildren();
        state.shown = 0;
        state.unseen = 0;
        updateCount();
        updateJump();
    });
    autoscrollEl.addEventListener('change', () => {
        state.autoscroll = autoscrollEl.checked;
        if (state.autoscroll) {
            state.unseen = 0;
            scrollToBottom();
        }
        updateJump();
    });
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
        scrollEl.addEventListener(type, () => { lastUserScrollIntent = Date.now(); }, { passive: true });
    }
    scrollEl.addEventListener('scroll', () => {
        if (state.mode !== 'live') return;
        if (state.autoscroll) {
            if (atBottom()) return;
            if (Date.now() - lastUserScrollIntent < 600) {
                state.autoscroll = false;
                autoscrollEl.checked = false;
                updateJump();
                return;
            }
            // 圖片載入或列高變化造成的位移，持續貼底。
            scrollToBottom();
            return;
        }
        if (state.unseen > 0 && atBottom()) {
            state.unseen = 0;
            updateJump();
        }
    });
    jumpLatestEl.addEventListener('click', () => {
        state.autoscroll = true;
        autoscrollEl.checked = true;
        state.unseen = 0;
        updateJump();
        scrollToBottom();
    });
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => {
            if (state.mode === 'live' && state.autoscroll) scrollToBottom();
        }).observe(rowsEl);
    }
    modeLiveEl.addEventListener('click', () => setMode('live'));
    modeHistoryEl.addEventListener('click', () => setMode('history'));
    historySessionEl.addEventListener('change', () => {
        state.history.sessionId = historySessionEl.value;
        loadHistoryMessages(1);
    });
    historyPrevEl.addEventListener('click', () => {
        if (state.history.page > 1) loadHistoryMessages(state.history.page - 1);
    });
    historyNextEl.addEventListener('click', () => {
        if (state.history.page < state.history.pages) loadHistoryMessages(state.history.page + 1);
    });
    mediaPanel.addEventListener('toggle', () => {
        if (mediaPanel.open && !state.media.loaded) loadMedia();
    });
    mediaSearch.addEventListener('input', () => {
        clearTimeout(state.media.timer);
        state.media.timer = setTimeout(() => {
            state.media.q = mediaSearch.value.trim().toLowerCase();
            state.media.page = 1;
            loadMedia();
        }, 250);
    });
    mediaType.addEventListener('change', () => {
        state.media.type = mediaType.value;
        state.media.page = 1;
        loadMedia();
    });
    mediaStatusFilter.addEventListener('change', () => {
        state.media.status = mediaStatusFilter.value;
        state.media.page = 1;
        loadMedia();
    });
    mediaRefresh.addEventListener('click', () => loadMedia());
    mediaPrev.addEventListener('click', () => {
        if (state.media.page > 1) { state.media.page--; loadMedia(); }
    });
    mediaNext.addEventListener('click', () => {
        if (state.media.page < state.media.pages) { state.media.page++; loadMedia(); }
    });
    rawType.addEventListener('change', () => {
        rawCategory.value = rawType.value === 'AdOverlay' ? 'ad' : 'chat';
        rawIsMain.disabled = rawType.value === 'AdOverlay';
    });
    rawImagePick.addEventListener('change', () => {
        if (!rawImagePick.value) return;
        rawImage.value = rawImagePick.value;
        if (rawType.value === 'AdOverlay') rawGift.value = rawImagePick.value;
        saveRawPrefs();
        updateRawImagePreview();
    });
    rawImage.addEventListener('input', () => {
        saveRawPrefs();
        updateRawImagePreview();
    });
    rawGift.addEventListener('input', saveRawPrefs);
    rawSend.addEventListener('click', sendRawSocketTest);

    testAdd.addEventListener('click', addTestMessage);
    testSend.addEventListener('click', sendSocketTest);
    testClear.addEventListener('click', clearTestPrefs);
    testUser.addEventListener('input', saveTestPrefs);
    rawUser.addEventListener('input', saveRawPrefs);
    testAvatar.addEventListener('input', () => { saveTestPrefs(); updateAvatarPreview(); });
    testPlatform.addEventListener('change', saveTestPrefs);
    testCategory.addEventListener('change', saveTestPrefs);
    testSocket.addEventListener('change', saveTestPrefs);
    testNotify.addEventListener('change', saveTestPrefs);
    testAvatarPick.addEventListener('change', () => {
        if (!testAvatarPick.value) return;
        testAvatar.value = testAvatarPick.value;
        saveTestPrefs();
        updateAvatarPreview();
        setTestStatus(t('monitor.test.avatarApplied', {}, '已套用 emoji 頭貼。'));
    });
    document.addEventListener('languagechange', () => {
        searchEl.placeholder = t('monitor.search', {}, '搜尋訊息…');
        applyTestI18n();
        buildFilters();
        buildTestCategories();
        buildAvatarOptions();
        updateAvatarPreview();
        updateRawImagePreview();
        if (state.media.loaded) renderMedia();
        if (state.mode === 'history') {
            loadHistorySessions();
        } else {
            updateCount();
            updateJump();
            setStatus(state.statusKey);
        }
    });

    searchEl.placeholder = t('monitor.search', {}, '搜尋訊息…');
    autoscrollEl.checked = state.autoscroll;
    savedTestPrefs = loadTestPrefs();
    applyTestI18n();
    buildTestCategories();
    restoreTestPrefs();
    restoreRawPrefs();
    restoreTestCategory();
    updateAvatarPreview();
    updateCount();
    updateJump();
    historyBarEl.hidden = true;
    setStatus('monitor.reconnecting');

    updateRawImagePreview();
    loadRawMediaOptions();
    fetch('/api/emoji/preview')
        .then(response => response.ok ? response.json() : null)
        .then(data => {
            if (!data?.success || !data.map || typeof data.map !== 'object') return;
            emojiMap = data.map;
            emojiPattern = buildEmojiPattern(emojiMap);
            buildAvatarOptions();
            renderAll();
        })
        .catch(() => buildAvatarOptions());

    fetch('/api/message-categories')
        .then(response => response.json())
        .then(data => {
            state.categories = Array.isArray(data.categories) ? data.categories : [];
            buildFilters();
            buildTestCategories();
            restoreTestCategory();
            renderAll();
        })
        .catch(() => { buildFilters(); buildTestCategories(); restoreTestCategory(); });

    const testResultSource = new EventSource('/status/stream/test-results');
    testResultSource.onmessage = event => {
        try { handleTestResult(JSON.parse(event.data)); } catch { /* ignore malformed result */ }
    };

    const source = new EventSource('/status/stream/messages');
    source.onopen = () => setStatus('monitor.connected');
    source.onerror = () => setStatus('monitor.reconnecting');
    source.onmessage = event => {
        let entry;
        try { entry = JSON.parse(event.data); } catch { return; }
        if (!entry || typeof entry.message !== 'string') return;
        append({
            t: Number(entry.t) || Date.now(),
            category: typeof entry.category === 'string' ? entry.category : 'system',
            platform: typeof entry.platform === 'string' ? entry.platform : undefined,
            user: typeof entry.user === 'string' ? entry.user : '',
            message: entry.message,
            img: typeof entry.img === 'string' ? entry.img : '',
            audience: entry.audience && typeof entry.audience === 'object' ? entry.audience : undefined,
            session: entry.session && typeof entry.session === 'object' ? entry.session : undefined
        });
    };
})();
