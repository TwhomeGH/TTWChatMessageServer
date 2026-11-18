/**
 * 系統日誌搜尋頁：讀取持久化 SQLite 日誌的摘要與分頁列表。
 * 只透過 /api/logs 與 /api/logs/summary 查詢，不直接讀取檔案。
 */
(() => {
    'use strict';

    const state = {
        category: '',
        query: '',
        level: '',
        session: '',
        beforeId: null,
        total: 0,
        shown: 0,
        loading: false,
        requestSeq: 0
    };
    const $ = id => document.getElementById(id);
    const rowsEl = $('logRows');
    let searchTimer = 0;

    function text(tag, value) {
        const node = document.createElement(tag);
        node.textContent = value == null ? '' : String(value);
        return node;
    }

    function fmtTime(ms) {
        const date = new Date(Number(ms));
        if (!Number.isFinite(date.getTime())) return '—';
        return date.toLocaleString('zh-TW', { hour12: false });
    }

    function fmtRange(range) {
        if (!range?.from || !range?.to) return '尚無資料';
        return `${fmtTime(range.from)} – ${fmtTime(range.to)}`;
    }

    function card(label, value, tone = '') {
        const box = document.createElement('div');
        box.className = 'log-card';
        box.appendChild(text('div', label)).className = 'log-card-label';
        const valueNode = text('div', value);
        valueNode.className = 'log-card-value' + (tone ? ' is-' + tone : '');
        box.appendChild(valueNode);
        return box;
    }

    function renderSummary(summary) {
        $('logMeta').textContent = `共 ${summary.total} 筆 · ${fmtRange(summary.range)}`;
        const levelCount = name => summary.levels.find(item => item.name === name)?.count || 0;
        $('logCards').replaceChildren(
            card('總筆數', summary.total),
            card('時間範圍', fmtRange(summary.range)),
            card('Session', summary.sessions.length),
            card('警告', levelCount('warn'), 'warn'),
            card('錯誤', levelCount('error'), 'error')
        );

        const categories = $('logCategories');
        categories.replaceChildren();
        const all = document.createElement('button');
        all.type = 'button';
        all.className = 'log-cat' + (state.category === '' ? ' active' : '');
        all.append(text('span', '全部'), text('span', String(summary.total)));
        all.lastElementChild.className = 'count';
        all.addEventListener('click', () => { state.category = ''; state.beforeId = null; load(); });
        categories.appendChild(all);
        for (const item of summary.categories) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'log-cat' + (state.category === item.name ? ' active' : '');
            button.append(text('span', item.name), text('span', String(item.count)));
            button.lastElementChild.className = 'count';
            button.addEventListener('click', () => {
                state.category = item.name;
                state.beforeId = null;
                load();
            });
            categories.appendChild(button);
        }

        const session = $('logSession');
        const current = state.session;
        session.replaceChildren(new Option('全部 Session', ''));
        for (const id of summary.sessions) session.appendChild(new Option(id, id));
        session.value = current;
    }

    function makeRow(row) {
        const tr = document.createElement('tr');
        tr.className = 'log-row is-' + (row.level || 'info');

        const time = text('td', fmtTime(row.at));
        time.className = 'log-time';
        const level = document.createElement('td');
        level.className = 'log-level';
        const badge = text('span', row.level || 'info');
        badge.className = 'log-level-badge log-level-' + (row.level || 'info');
        level.appendChild(badge);
        const category = text('td', row.category || 'other');
        category.className = 'log-category';
        const source = text('td', row.source || 'main');
        source.className = 'log-source';
        const message = document.createElement('td');
        message.className = 'log-message';
        message.appendChild(text('div', row.message));
        if (row.fields && Object.keys(row.fields).length) {
            const details = document.createElement('details');
            details.className = 'log-fields';
            details.appendChild(text('summary', `${Object.keys(row.fields).length} 個欄位`));
            const pre = text('pre', Object.entries(row.fields)
                .map(([key, value]) => `${key} = ${typeof value === 'object' ? JSON.stringify(value) : value}`)
                .join('\n'));
            details.appendChild(pre);
            message.appendChild(details);
        }
        tr.append(time, level, category, source, message);
        return tr;
    }

    async function loadSummary() {
        const response = await fetch('/api/logs/summary', { cache: 'no-store' });
        if (!response.ok) throw new Error(`摘要讀取失敗（HTTP ${response.status}）`);
        renderSummary(await response.json());
    }

    async function load(append = false) {
        // 篩選切換時允許新請求取代舊請求；只有最後一個請求能更新畫面。
        const requestSeq = ++state.requestSeq;
        state.loading = true;
        $('logMore').disabled = true;
        if (!append) {
            state.beforeId = null;
            state.shown = 0;
            rowsEl.replaceChildren();
            $('logEmpty').hidden = true;
            $('logStatus').textContent = '載入中…';
        }
        const params = new URLSearchParams({
            category: state.category,
            q: state.query,
            level: state.level,
            session: state.session,
            limit: '100'
        });
        if (append && state.beforeId) params.set('beforeId', String(state.beforeId));
        try {
            const response = await fetch('/api/logs?' + params, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (requestSeq !== state.requestSeq) return;
            if (!response.ok) throw new Error(payload.error || `讀取失敗（HTTP ${response.status}）`);
            const fragment = document.createDocumentFragment();
            for (const row of payload.rows || []) fragment.appendChild(makeRow(row));
            rowsEl.appendChild(fragment);
            state.total = payload.total || 0;
            state.shown += (payload.rows || []).length;
            state.beforeId = payload.nextBeforeId || null;
            $('logEmpty').hidden = state.shown !== 0;
            $('logMore').hidden = !payload.hasMore;
            $('logMore').textContent = `載入更多（目前 ${state.shown} / ${state.total}）`;
            $('logStatus').textContent = `${state.total} 筆符合 · 顯示 ${state.shown} 筆`
                + (state.category ? ` · 分類 ${state.category}` : '')
                + (state.level ? ` · 等級 ${state.level}` : '');
        } catch (error) {
            if (requestSeq === state.requestSeq) $('logStatus').textContent = error.message;
        } finally {
            if (requestSeq === state.requestSeq) {
                state.loading = false;
                $('logMore').disabled = false;
            }
        }
    }

    function scheduleSearch() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.query = $('logSearch').value.trim();
            state.beforeId = null;
            load();
        }, 220);
    }

    $('logSearch').addEventListener('input', scheduleSearch);
    $('logLevel').addEventListener('change', () => {
        state.level = $('logLevel').value;
        state.beforeId = null;
        load();
    });
    $('logSession').addEventListener('change', () => {
        state.session = $('logSession').value;
        state.beforeId = null;
        load();
    });
    $('logMore').addEventListener('click', () => load(true));
    $('logReset').addEventListener('click', () => {
        state.category = '';
        state.query = '';
        state.level = '';
        state.session = '';
        state.beforeId = null;
        $('logSearch').value = '';
        $('logLevel').value = '';
        $('logSession').value = '';
        loadSummary().catch(error => { $('logStatus').textContent = error.message; });
        load();
    });

    (async () => {
        try {
            await loadSummary();
            await load();
        } catch (error) {
            $('logStatus').textContent = error.message;
        }
    })();
})();
