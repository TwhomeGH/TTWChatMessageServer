/**
 * 常客分析頁：列出觀眾聚合、等級與分數，點選單一觀眾可看完整計算與最近場次。
 * 所有資料來自 /api/audience；不顯示原始訊息。
 */
(async () => {
    'use strict';
    await window.TTWI18n.ready;
    const t = (key, params = {}, fallback) => window.TTWI18n.t('audience.' + key, params, fallback);
    const el = id => document.getElementById(id);
    const state = { page: 1, pageSize: 50, total: 0, platform: '', q: '', sort: 'score', list: null, detail: null, timer: null };

    const fmtDate = value => Number.isFinite(Number(value))
        ? new Date(Number(value)).toLocaleString(window.TTWI18n.language, { dateStyle: 'medium', timeStyle: 'short' })
        : '—';
    const tenureKey = days => days < 7 ? 'newcomer' : days < 90 ? 'friend' : days < 365 ? 'oldFriend' : 'veteran';
    const levelLabel = level => t('level.' + level, {}, `L${level}`);
    const gateLabel = gate => t('gate.' + ({
        'streak>=6': 'streak6', 'activeStreams>=10': 'sessions10',
        'streak>=3': 'streak3', 'activeStreams>=3': 'sessions3'
    }[gate] || 'none'), {}, gate);

    function cell(content, className = '') {
        const td = document.createElement('td');
        td.className = className;
        if (content instanceof Node) td.append(content);
        else td.textContent = String(content ?? '—');
        return td;
    }

    function labelChips(labels) {
        const wrap = document.createElement('span');
        wrap.className = 'audience-labels';
        for (const label of labels || []) {
            const chip = document.createElement('span');
            chip.className = `audience-chip is-${label}`;
            chip.textContent = t('label.' + label, {}, label);
            wrap.append(chip);
        }
        return wrap;
    }

    function renderRows() {
        const data = state.list;
        const rows = el('audience-rows');
        if (!data) return;
        rows.replaceChildren(...data.users.map(user => {
            const tr = document.createElement('tr');
            tr.tabIndex = 0;
            tr.addEventListener('click', () => loadDetails(user.platform, user.userKey));
            tr.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    loadDetails(user.platform, user.userKey);
                }
            });
            tr.append(
                cell(user.displayName),
                cell(user.platform),
                cell(`${levelLabel(user.level)} · ${user.score}`),
                cell(`${t('tenure.' + tenureKey(user.tenureDays), {}, '—')} · ${user.tenureDays} ${t('unit.days', {}, 'd')}`),
                cell(`${user.activeStreams} / ${user.streak}`),
                cell(String(user.activeDays)),
                cell(`${user.messages} / ${user.gifts}`),
                cell(fmtDate(user.lastSeen)),
                cell(labelChips(user.labels))
            );
            return tr;
        }));
        el('audience-empty').hidden = data.users.length > 0;
        el('audience-count').textContent = t('count', { count: data.total }, `${data.total}`);
        el('audience-page').textContent = t('page', {
            page: data.page, total: Math.max(1, Math.ceil(data.total / data.pageSize))
        }, `${data.page}`);
        el('audience-prev').disabled = data.page <= 1;
        el('audience-next').disabled = data.page * data.pageSize >= data.total;
    }

    async function loadList() {
        const params = new URLSearchParams({
            platform: state.platform, q: state.q, sort: state.sort, page: String(state.page)
        });
        const response = await fetch('/api/audience?' + params, { cache: 'no-store' });
        if (response.status === 401) { location.href = '/'; return; }
        if (!response.ok) { el('audience-empty').hidden = false; el('audience-empty').textContent = t('loadError', {}, '載入失敗'); return; }
        state.list = await response.json();
        state.total = state.list.total;
        renderRows();
    }

    function renderDetails(data) {
        el('audience-detail-name').textContent = data.displayName;
        el('audience-detail-level').textContent = `${levelLabel(data.level)} · ${data.score}`;
        el('audience-detail-level').className = `audience-level is-level-${data.level}`;
        el('audience-detail-meta').textContent = t('meta', {
            platform: data.platform,
            tenure: `${t('tenure.' + tenureKey(data.tenureDays), {}, '—')} ${data.tenureDays} ${t('unit.days', {}, 'd')}`,
            first: fmtDate(data.firstSeen), last: fmtDate(data.lastSeen)
        }, '');

        const stats = [
            ['sessions', data.activeStreams], ['streak', data.streak], ['days', data.activeDays],
            ['messages', data.messages], ['gifts', data.gifts], ['giftStreams', data.giftStreams]
        ];
        el('audience-detail-stats').replaceChildren(...stats.map(([key, value]) => {
            const card = document.createElement('div');
            card.className = 'audience-stat';
            const label = document.createElement('span');
            label.textContent = t('stats.' + key, {}, key);
            const strong = document.createElement('strong');
            strong.textContent = String(value);
            card.append(label, strong);
            return card;
        }));

        const components = [
            ['attendance', data.activeStreams, 20, 35, data.components.attendance],
            ['consecutive', data.streak, 8, 25, data.components.consecutive],
            ['breadth', data.activeDays, 15, 15, data.components.breadth],
            ['interaction', data.messages, 100, 15, data.components.interaction],
            ['support', data.gifts, 10, 10, data.components.support]
        ];
        el('audience-breakdown').replaceChildren(...components.map(([key, value, cap, weight, points]) => {
            const tr = document.createElement('tr');
            tr.append(
                cell(t('breakdown.' + key, {}, key)),
                cell(String(value)),
                cell(String(cap)),
                cell(String(weight)),
                cell(Number(points).toFixed(2))
            );
            return tr;
        }));
        el('audience-formula').textContent = t('formula', { total: data.score }, '');

        el('audience-levels').replaceChildren(...(data.levels || []).map(level => {
            const tr = document.createElement('tr');
            if (level.level === data.level) tr.className = 'is-current';
            tr.append(
                cell(levelLabel(level.level)),
                cell(String(level.minScore)),
                cell(gateLabel(level.gate))
            );
            return tr;
        }));

        el('audience-recent').replaceChildren(...(data.recent || []).map(row => {
            const tr = document.createElement('tr');
            tr.append(
                cell('#' + row.session),
                cell(row.day || '—'),
                cell(String(row.messages)),
                cell(String(row.gifts)),
                cell(String(row.joins)),
                cell(fmtDate(row.last_seen))
            );
            return tr;
        }));
        el('audience-detail').hidden = false;
        el('audience-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function loadDetails(platform, userKey) {
        const params = new URLSearchParams({ platform, user: userKey });
        const response = await fetch('/api/audience/user?' + params, { cache: 'no-store' });
        if (response.status === 401) { location.href = '/'; return; }
        if (!response.ok) return;
        state.detail = await response.json();
        renderDetails(state.detail);
        history.replaceState(null, '', '?platform=' + encodeURIComponent(platform) + '&user=' + encodeURIComponent(userKey));
    }

    el('audience-search').addEventListener('input', () => {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => {
            state.q = el('audience-search').value.trim();
            state.page = 1;
            loadList();
        }, 250);
    });
    el('audience-platform').addEventListener('change', () => {
        state.platform = el('audience-platform').value;
        state.page = 1;
        loadList();
    });
    el('audience-sort').addEventListener('change', () => {
        state.sort = el('audience-sort').value;
        state.page = 1;
        loadList();
    });
    el('audience-prev').addEventListener('click', () => { if (state.page > 1) { state.page--; loadList(); } });
    el('audience-next').addEventListener('click', () => {
        if (state.page * state.pageSize < state.total) { state.page++; loadList(); }
    });
    document.addEventListener('languagechange', () => {
        el('audience-search').placeholder = t('search', {}, '搜尋觀眾…');
        if (state.list) renderRows();
        if (state.detail) renderDetails(state.detail);
    });

    el('audience-search').placeholder = t('search', {}, '搜尋觀眾…');
    const params = new URLSearchParams(location.search);
    state.platform = params.get('platform') || '';
    state.q = params.get('q') || '';
    state.sort = params.get('sort') || 'score';
    el('audience-platform').value = state.platform;
    el('audience-sort').value = state.sort;
    el('audience-search').value = state.q;
    await loadList();
    const initialUser = params.get('user');
    if (initialUser && state.platform) await loadDetails(state.platform, initialUser);
})();
