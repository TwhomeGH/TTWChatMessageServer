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
    const TEST_PREFS_KEY = 'ttw-monitor-test-prefs';

    let emojiMap = null;
    let emojiPattern = null;
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
        statusKey: 'monitor.reconnecting'
    };

    function fmtTime(ms) {
        const d = new Date(ms);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    const categoryLabel = name => t(`monitor.cat.${name}`, {}, name);

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
    }

    function clearTestPrefs() {
        clearTestPending();
        clearTestCooldown();
        try { localStorage.removeItem(TEST_PREFS_KEY); } catch { /* ignore */ }
        savedTestPrefs = null;
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
    }

    function append(entry) {
        state.entries.push(entry);
        if (state.entries.length > MAX_ENTRIES) {
            const removed = state.entries.shift();
            if (matches(removed) && rowsEl.firstElementChild) { rowsEl.firstElementChild.remove(); state.shown--; }
        }
        if (!matches(entry)) { updateCount(); return; }
        rowsEl.append(makeRow(entry));
        state.shown++;
        updateCount();
        if (state.autoscroll) scrollToBottom();
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
        all.addEventListener('click', () => { state.active.clear(); buildFilters(); renderAll(); });
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
                renderAll();
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
        renderAll();
    });
    clearEl.addEventListener('click', () => {
        state.entries = [];
        rowsEl.replaceChildren();
        state.shown = 0;
        updateCount();
    });
    autoscrollEl.addEventListener('change', () => {
        state.autoscroll = autoscrollEl.checked;
        if (state.autoscroll) scrollToBottom();
    });
    scrollEl.addEventListener('scroll', () => {
        if (state.autoscroll && !atBottom()) { state.autoscroll = false; autoscrollEl.checked = false; }
    });
    testAdd.addEventListener('click', addTestMessage);
    testSend.addEventListener('click', sendSocketTest);
    testClear.addEventListener('click', clearTestPrefs);
    testUser.addEventListener('input', saveTestPrefs);
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
        updateCount();
        setStatus(state.statusKey);
    });

    searchEl.placeholder = t('monitor.search', {}, '搜尋訊息…');
    autoscrollEl.checked = state.autoscroll;
    savedTestPrefs = loadTestPrefs();
    applyTestI18n();
    buildTestCategories();
    restoreTestPrefs();
    restoreTestCategory();
    updateAvatarPreview();
    updateCount();
    setStatus('monitor.reconnecting');

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
            audience: entry.audience && typeof entry.audience === 'object' ? entry.audience : undefined
        });
    };
})();
