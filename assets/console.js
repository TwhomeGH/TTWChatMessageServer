/**
 * 系統日誌面板：訂閱 /status/stream/logs 的結構化日誌（{ t, level, text }），
 * 依時間與類型分欄顯示，提供類型篩選、文字搜尋、自動捲動與清除畫面。
 * 伺服器端的 /status/stream 純文字串流維持不變，供外部工具相容使用。
 */
(function () {
    'use strict';
    const i18n = window.TTWI18n;
    const t = (key, params, fallback) => (i18n ? i18n.t(key, params, fallback) : (fallback ?? key));

    const LEVELS = [
        { key: 'error', code: 'ERR', labelKey: 'console.filter.error', accent: 'border-l-red-500', badge: 'bg-red-900/70 text-red-300' },
        { key: 'out', code: 'OUT', labelKey: 'console.filter.out', accent: 'border-l-gray-600', badge: 'bg-gray-700 text-gray-300' },
        { key: 'system', code: 'SYS', labelKey: 'console.filter.system', accent: 'border-l-blue-500', badge: 'bg-blue-900/70 text-blue-300' },
        { key: 'metrics', code: 'MET', labelKey: 'console.filter.metrics', accent: 'border-l-purple-500', badge: 'bg-purple-900/70 text-purple-300' },
        { key: 'info', code: 'INF', labelKey: 'console.filter.info', accent: 'border-l-green-600', badge: 'bg-green-900/60 text-green-300' }
    ];
    const LEVEL_BY_KEY = new Map(LEVELS.map(level => [level.key, level]));
    const MAX_ENTRIES = 2000;

    const rowsEl = document.getElementById('logRows');
    const scrollEl = document.getElementById('logScroll');
    const searchEl = document.getElementById('logSearch');
    const filtersEl = document.getElementById('logFilters');
    const autoscrollEl = document.getElementById('logAutoscroll');
    const clearEl = document.getElementById('logClear');
    const countEl = document.getElementById('logCount');
    const statusEl = document.getElementById('logStatus');

    const state = {
        entries: [],
        active: new Set(LEVELS.map(level => level.key)),
        query: '',
        autoscroll: true,
        shown: 0,
        statusKey: 'console.reconnecting'
    };

    const levelOf = entry => LEVEL_BY_KEY.get(entry.level) || LEVEL_BY_KEY.get('info');

    function fmtTime(ms) {
        const d = new Date(ms);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function matches(entry) {
        if (!state.active.has(entry.level)) return false;
        return !state.query || entry.text.toLowerCase().includes(state.query);
    }

    function makeRow(entry) {
        const level = levelOf(entry);
        const row = document.createElement('div');
        row.className = `log-row flex items-start gap-2 px-3 py-0.5 border-b border-gray-800/60 border-l-2 ${level.accent} hover:bg-gray-900/50`;
        const time = document.createElement('span');
        time.className = 'log-time shrink-0 text-gray-500 select-none';
        time.textContent = fmtTime(entry.t);
        const badge = document.createElement('span');
        badge.className = `log-badge shrink-0 text-[11px] leading-5 px-1.5 rounded ${level.badge}`;
        badge.textContent = level.code;
        const message = document.createElement('span');
        message.className = 'log-msg flex-1 whitespace-pre-wrap break-words';
        message.textContent = entry.text;
        row.append(time, badge, message);
        return row;
    }

    function updateCount() {
        countEl.textContent = t('console.count', { shown: state.shown, total: state.entries.length }, `${state.shown} / ${state.entries.length}`);
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
            // DOM 順序與 entries 相同，最舊的顯示列就是第一個子節點。
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
        for (const level of LEVELS) {
            const on = state.active.has(level.key);
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = t(level.labelKey, {}, level.key);
            button.setAttribute('aria-pressed', String(on));
            button.className = on
                ? 'log-filter px-2 py-1 rounded border border-transparent bg-blue-600 text-white'
                : 'log-filter px-2 py-1 rounded border border-gray-700 bg-gray-900 text-gray-400';
            button.addEventListener('click', () => {
                if (state.active.has(level.key)) state.active.delete(level.key);
                else state.active.add(level.key);
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
        statusEl.className = 'text-xs ' + (key === 'console.connected' ? 'text-green-400' : 'text-yellow-400');
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
        if (state.autoscroll && !atBottom()) {
            state.autoscroll = false;
            autoscrollEl.checked = false;
        }
    });
    document.addEventListener('languagechange', () => {
        searchEl.placeholder = t('console.search', {}, '搜尋日誌…');
        buildFilters();
        updateCount();
        setStatus(state.statusKey);
    });

    searchEl.placeholder = t('console.search', {}, '搜尋日誌…');
    autoscrollEl.checked = state.autoscroll;
    buildFilters();
    updateCount();
    setStatus('console.reconnecting');

    const source = new EventSource('/status/stream/logs');
    source.onopen = () => setStatus('console.connected');
    source.onerror = () => setStatus('console.reconnecting');
    source.onmessage = event => {
        let entry;
        try { entry = JSON.parse(event.data); } catch { return; }
        if (!entry || typeof entry.text !== 'string') return;
        append({
            t: Number(entry.t) || Date.now(),
            level: typeof entry.level === 'string' ? entry.level : 'info',
            text: entry.text
        });
    };
})();
