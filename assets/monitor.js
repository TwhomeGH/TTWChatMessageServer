/**
 * 直播訊息監控面板：訂閱 /status/stream/messages（子程序鏡像的 socket payload），
 * 以聊天室列顯示時間／平台／分類／使用者／內容，提供分類篩選、搜尋、自動捲動與清除。
 * 分類清單由 /api/message-categories 取得（單一來源 ScriptLib/messages/categories.cjs）。
 */
(function () {
    'use strict';
    const i18n = window.TTWI18n;
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

    function matches(entry) {
        if (state.active.size && !state.active.has(entry.category || 'system')) return false;
        if (!state.query) return true;
        const haystack = `${entry.user || ''} ${entry.message || ''}`.toLowerCase();
        return haystack.includes(state.query);
    }

    function makeRow(entry) {
        const row = document.createElement('div');
        row.className = 'mon-row flex items-start gap-2 px-3 py-1 border-b border-gray-800/60 hover:bg-gray-900/50';

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

        const body = document.createElement('span');
        body.className = 'mon-body flex-1 min-w-0';
        if (entry.img) {
            const avatar = document.createElement('img');
            avatar.className = 'mon-avatar inline-block w-5 h-5 rounded-full align-middle mr-1.5';
            avatar.loading = 'lazy';
            avatar.src = entry.img;
            avatar.onerror = () => avatar.remove();
            body.append(avatar);
        }
        const user = document.createElement('span');
        user.className = 'mon-user font-semibold text-gray-100';
        user.textContent = `${entry.user ?? ''} `;
        const message = document.createElement('span');
        message.className = 'mon-msg text-gray-300 whitespace-pre-wrap break-words';
        message.textContent = String(entry.message ?? '');
        body.append(user, message);

        row.append(time, platform, chip, body);
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
    document.addEventListener('languagechange', () => {
        searchEl.placeholder = t('monitor.search', {}, '搜尋訊息…');
        buildFilters();
        updateCount();
        setStatus(state.statusKey);
    });

    searchEl.placeholder = t('monitor.search', {}, '搜尋訊息…');
    autoscrollEl.checked = state.autoscroll;
    updateCount();
    setStatus('monitor.reconnecting');

    fetch('/api/message-categories')
        .then(response => response.json())
        .then(data => {
            state.categories = Array.isArray(data.categories) ? data.categories : [];
            buildFilters();
            renderAll();
        })
        .catch(() => buildFilters());

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
            img: typeof entry.img === 'string' ? entry.img : ''
        });
    };
})();
