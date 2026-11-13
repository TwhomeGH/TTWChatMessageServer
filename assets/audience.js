/**
 * 常客分析頁：列出觀眾聚合、等級與分數，點選單一觀眾可看完整計算與最近場次。
 * 所有資料來自 /api/audience；不顯示原始訊息。
 */
(async () => {
    'use strict';
    await window.TTWI18n.ready;
    const t = (key, params = {}, fallback) => window.TTWI18n.t('audience.' + key, params, fallback);
    const el = id => document.getElementById(id);
    const state = {
        page: 1, pageSize: 50, total: 0, platform: '', q: '', sort: 'score',
        tenures: new Set(), list: null, detail: null, timer: null,
        latestMerge: null,
        merge: { source: null, preview: null, timer: null, candidates: [] }
    };

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

    function userCell(user, tenure) {
        const wrap = document.createElement('span');
        wrap.className = 'audience-user';
        const initial = Array.from(String(user.displayName || '?').trim())[0] || '?';
        const avatar = document.createElement('span');
        avatar.className = `audience-avatar is-tenure-${tenure}`;
        avatar.textContent = initial.toUpperCase();
        avatar.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'audience-name';
        name.textContent = user.displayName;
        wrap.append(avatar, name);
        return wrap;
    }

    function levelCell(user) {
        const wrap = document.createElement('span');
        wrap.className = 'audience-level-cell';
        const badge = document.createElement('span');
        badge.className = `audience-level is-level-${user.level}`;
        badge.textContent = levelLabel(user.level);
        const score = document.createElement('span');
        score.className = 'audience-score';
        score.textContent = `· ${user.score}`;
        wrap.append(badge, score);
        return wrap;
    }

    function tenureCell(user, tenure) {
        const wrap = document.createElement('span');
        wrap.className = 'audience-tenure-cell';
        const badge = document.createElement('span');
        badge.className = `audience-tenure is-tenure-${tenure}`;
        badge.textContent = t('tenure.' + tenure, {}, tenure);
        const days = document.createElement('span');
        days.className = 'audience-days';
        days.textContent = `${user.tenureDays} ${t('unit.days', {}, 'd')}`;
        wrap.append(badge, days);
        return wrap;
    }

    function renderRows() {
        const data = state.list;
        const rows = el('audience-rows');
        if (!data) return;
        rows.replaceChildren(...data.users.map(user => {
            const tenure = tenureKey(user.tenureDays);
            const tr = document.createElement('tr');
            tr.className = `is-tenure-${tenure} is-level-${user.level}`;
            tr.tabIndex = 0;
            tr.addEventListener('click', () => loadDetails(user.platform, user.userKey));
            tr.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    loadDetails(user.platform, user.userKey);
                }
            });
            // 關係欄已顯示「新朋友」，標記欄不重複同一個 tenure 標籤。
            const labels = (user.labels || []).filter(label => !(label === 'newcomer' && tenure === 'newcomer'));
            const chips = labelChips(labels);
            if (!chips.childElementCount) {
                chips.textContent = '—';
                chips.classList.add('is-empty');
            }
            tr.append(
                cell(userCell(user, tenure)),
                cell(user.platform),
                cell(levelCell(user)),
                cell(tenureCell(user, tenure)),
                cell(`${user.activeStreams} / ${user.streak}`),
                cell(String(user.activeDays)),
                cell(`${user.messages} / ${user.gifts}`),
                cell(fmtDate(user.lastSeen)),
                cell(chips)
            );
            return tr;
        }));
        el('audience-empty').hidden = data.users.length > 0;
        el('audience-count').textContent = t('count', { count: data.total }, `${data.total}`);
        const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
        el('audience-page').textContent = t('page', { page: data.page, pages }, `${data.page} / ${pages}`);
        el('audience-prev').disabled = data.page <= 1;
        el('audience-next').disabled = data.page * data.pageSize >= data.total;
    }

    async function loadList() {
        const params = new URLSearchParams({
            platform: state.platform, q: state.q, sort: state.sort, page: String(state.page),
            tenures: [...state.tenures].join(',')
        });
        const response = await fetch('/api/audience?' + params, { cache: 'no-store' });
        if (response.status === 401) { location.href = '/'; return; }
        if (!response.ok) { el('audience-empty').hidden = false; el('audience-empty').textContent = t('loadError', {}, '載入失敗'); return; }
        state.list = await response.json();
        state.total = state.list.total;
        renderRows();
        void loadMergeStatus();
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

    async function loadMergeStatus() {
        const button = el('audience-undo');
        const status = el('audience-undo-status');
        const params = new URLSearchParams({ platform: state.platform || '' });
        try {
            const response = await fetch('/api/audience/merge/latest?' + params, { cache: 'no-store' });
            if (response.status === 401) return;
            const data = await response.json().catch(() => ({}));
            const latest = data.ok ? data.latest : null;
            state.latestMerge = latest;
            if (!latest) {
                button.hidden = true;
                status.textContent = '';
                return;
            }
            button.hidden = false;
            button.disabled = !latest.undoable;
            button.title = latest.undoable
                ? t('undo.ready', {
                    source: latest.source?.displayName || latest.source?.key || '',
                    target: latest.target?.displayName || latest.target?.key || ''
                }, '')
                : latest.reason || '';
            status.textContent = latest.undoable
                ? t('undo.available', { target: latest.target?.displayName || latest.target?.key || '' }, '')
                : latest.reason || '';
            status.style.color = latest.undoable ? '' : '#fca5a5';
        } catch {
            button.hidden = true;
            status.textContent = '';
        }
    }

    async function undoMerge() {
        const latest = state.latestMerge;
        if (!latest?.undoable) return;
        const message = t('undo.confirm', {
            source: latest.source?.displayName || latest.source?.key || '',
            target: latest.target?.displayName || latest.target?.key || ''
        }, '');
        if (!window.confirm(message)) return;
        const response = await fetch('/api/audience/merge/undo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: latest.platform, batchId: latest.id })
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) { location.href = '/'; return; }
        if (!response.ok) {
            el('audience-undo-status').textContent = data.error || t('undo.error', {}, '還原失敗。');
            el('audience-undo-status').style.color = '#fca5a5';
            return;
        }
        await loadList();
        if (state.detail) await loadDetails(state.detail.platform, state.detail.userKey);
    }

    function updateMergeTargetMeta() {
        const selected = el('audience-merge-target').value;
        const user = (state.merge.candidates || []).find(item => item.userKey === selected);
        const node = el('audience-merge-target-meta');
        if (!user) {
            node.textContent = '';
            return;
        }
        node.textContent = t('merge.targetMeta', {
            name: user.displayName,
            key: user.userKey,
            score: user.score,
            sessions: user.activeStreams,
            messages: user.messages
        }, `userKey: ${user.userKey}`);
    }

    function mergeStatus(message, error = false) {
        const node = el('audience-merge-status');
        node.textContent = message;
        node.style.color = error ? '#fca5a5' : '';
    }

    function mergeSourceText() {
        if (!state.merge.source) return '';
        return t('merge.source', {
            name: state.merge.source.displayName, key: state.merge.source.userKey
        }, state.merge.source.displayName);
    }

    function mergeSummaryColumn(title, summary, lifetime) {
        const column = document.createElement('div');
        column.className = 'audience-merge-column';
        const heading = document.createElement('h3');
        heading.textContent = title;
        column.append(heading);
        for (const [label, value] of [
            [t('merge.name', {}, '名稱'), summary?.displayName || '—'],
            [t('merge.sessions', {}, '出席場次'), summary?.activeStreams ?? '—'],
            [t('merge.messages', {}, '有效訊息'), summary?.messages ?? '—'],
            [t('merge.gifts', {}, '送禮'), summary?.gifts ?? '—'],
            [t('merge.firstSeen', {}, '首次出現'), fmtDate(lifetime?.firstSeen)],
            [t('merge.lastSeen', {}, '最後出現'), fmtDate(lifetime?.lastSeen)]
        ]) {
            const row = document.createElement('div');
            row.className = 'audience-merge-metric';
            const key = document.createElement('span');
            key.textContent = label;
            const valueNode = document.createElement('strong');
            valueNode.textContent = String(value);
            row.append(key, valueNode);
            column.append(row);
        }
        return column;
    }

    function renderMergePreview(data) {
        const box = el('audience-merge-preview');
        box.replaceChildren(
            mergeSummaryColumn(t('merge.sourceColumn', {}, '來源'), data.source?.summary, data.source?.lifetime),
            mergeSummaryColumn(t('merge.targetColumn', {}, '目標'), data.target?.summary, data.target?.lifetime),
            mergeSummaryColumn(t('merge.mergedColumn', {}, '合併後'), data.merged, {
                firstSeen: data.merged?.firstSeen, lastSeen: data.merged?.lastSeen
            })
        );
        const calculation = document.createElement('p');
        calculation.className = 'audience-merge-warning';
        calculation.textContent = t('merge.calculation', {
            overlap: data.overlapSessions,
            newSessions: data.newSessions,
            newDays: data.newDays
        }, '');
        box.append(calculation);
        const alias = document.createElement('p');
        alias.className = 'audience-merge-warning';
        alias.textContent = t('merge.alias', {
            source: data.alias?.source || data.source?.key || '',
            target: data.alias?.target || data.target?.key || ''
        }, '');
        box.append(alias);
        box.hidden = false;
        el('audience-merge-apply').disabled = false;
    }

    async function loadMergeCandidates(q = '') {
        if (!state.merge.source) return;
        const select = el('audience-merge-target');
        const previous = select.value;
        const loading = document.createElement('option');
        loading.textContent = t('merge.loading', {}, '載入中…');
        loading.disabled = true;
        select.replaceChildren(loading);
        const params = new URLSearchParams({
            platform: state.merge.source.platform, q, sort: 'recent', pageSize: '100'
        });
        const response = await fetch('/api/audience?' + params, { cache: 'no-store' });
        if (response.status === 401) { location.href = '/'; return; }
        if (!response.ok) {
            mergeStatus(t('merge.loadError', {}, '無法載入可合併的觀眾。'), true);
            return;
        }
        const data = await response.json();
        const users = (data.users || []).filter(user => user.userKey !== state.merge.source.userKey);
        state.merge.candidates = users;
        const options = [];
        if (!users.length) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = t('merge.noTargets', {}, '沒有其他可合併的觀眾。');
            empty.disabled = true;
            options.push(empty);
        }
        for (const user of users) {
            const option = document.createElement('option');
            option.value = user.userKey;
            option.textContent = `${user.displayName} · ${user.userKey} · ${user.score} 分`;
            options.push(option);
        }
        select.replaceChildren(...options);
        if (users.some(user => user.userKey === previous)) select.value = previous;
        el('audience-merge-preview').hidden = true;
        el('audience-merge-apply').disabled = true;
        state.merge.preview = null;
        updateMergeTargetMeta();
    }

    function openMergeDialog() {
        if (!state.detail) return;
        state.merge.source = {
            platform: state.detail.platform,
            userKey: state.detail.userKey,
            displayName: state.detail.displayName
        };
        state.merge.preview = null;
        el('audience-merge-source').textContent = mergeSourceText();
        el('audience-merge-search').value = '';
        el('audience-merge-preview').hidden = true;
        el('audience-merge-apply').disabled = true;
        mergeStatus('');
        const dialog = el('audience-merge-dialog');
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        loadMergeCandidates();
    }

    function closeMergeDialog() {
        const dialog = el('audience-merge-dialog');
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
        state.merge.source = null;
        state.merge.preview = null;
    }

    async function previewMerge() {
        if (!state.merge.source) return;
        const targetKey = el('audience-merge-target').value;
        if (!targetKey) {
            mergeStatus(t('merge.chooseTarget', {}, '請先選擇目標觀眾。'), true);
            return;
        }
        const params = new URLSearchParams({
            platform: state.merge.source.platform,
            source: state.merge.source.userKey,
            target: targetKey
        });
        const response = await fetch('/api/audience/merge/preview?' + params, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) { location.href = '/'; return; }
        if (!response.ok) {
            mergeStatus(data.error || t('merge.previewError', {}, '預覽失敗。'), true);
            return;
        }
        state.merge.preview = data;
        renderMergePreview(data);
        mergeStatus(t('merge.previewReady', {}, '預覽完成；確認後才會寫入。'));
    }

    async function applyMerge() {
        if (!state.merge.source || !state.merge.preview) return;
        const targetKey = el('audience-merge-target').value;
        if (!targetKey) return;
        el('audience-merge-apply').disabled = true;
        const response = await fetch('/api/audience/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                platform: state.merge.source.platform,
                sourceKey: state.merge.source.userKey,
                targetKey
            })
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) { location.href = '/'; return; }
        if (!response.ok) {
            mergeStatus(data.error || t('merge.applyError', {}, '合併失敗。'), true);
            el('audience-merge-apply').disabled = false;
            return;
        }
        closeMergeDialog();
        await loadList();
        await loadDetails(state.detail.platform, targetKey);
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
    const tenureButtons = [...document.querySelectorAll('.audience-tenure[data-tenure]')];
    const tenureAll = el('audience-tenure-all');
    function updateTenureLegend() {
        for (const button of tenureButtons) {
            button.setAttribute('aria-pressed', String(state.tenures.has(button.dataset.tenure)));
        }
        tenureAll.setAttribute('aria-pressed', String(state.tenures.size === 0));
    }
    for (const button of tenureButtons) {
        button.addEventListener('click', () => {
            const value = button.dataset.tenure;
            if (state.tenures.has(value)) state.tenures.delete(value);
            else state.tenures.add(value);
            updateTenureLegend();
            state.page = 1;
            loadList();
        });
    }
    tenureAll.addEventListener('click', () => {
        state.tenures.clear();
        updateTenureLegend();
        state.page = 1;
        loadList();
    });
    el('audience-prev').addEventListener('click', () => { if (state.page > 1) { state.page--; loadList(); } });
    el('audience-next').addEventListener('click', () => {
        if (state.page * state.pageSize < state.total) { state.page++; loadList(); }
    });
    el('audience-undo').addEventListener('click', undoMerge);
    el('audience-merge-open').addEventListener('click', openMergeDialog);
    el('audience-merge-cancel').addEventListener('click', closeMergeDialog);
    el('audience-merge-preview-button').addEventListener('click', previewMerge);
    el('audience-merge-apply').addEventListener('click', applyMerge);
    el('audience-merge-dialog').addEventListener('close', () => {
        state.merge.source = null;
        state.merge.preview = null;
    });
    el('audience-merge-target').addEventListener('change', () => {
        state.merge.preview = null;
        el('audience-merge-preview').hidden = true;
        el('audience-merge-apply').disabled = true;
        updateMergeTargetMeta();
        mergeStatus('');
    });
    el('audience-merge-search').addEventListener('input', () => {
        clearTimeout(state.merge.timer);
        state.merge.timer = setTimeout(() => loadMergeCandidates(el('audience-merge-search').value.trim()), 250);
    });
    document.addEventListener('languagechange', () => {
        el('audience-search').placeholder = t('search', {}, '搜尋觀眾…');
        el('audience-merge-source').textContent = mergeSourceText();
        updateMergeTargetMeta();
        if (state.list) renderRows();
        if (state.detail) renderDetails(state.detail);
        void loadMergeStatus();
    });

    el('audience-search').placeholder = t('search', {}, '搜尋觀眾…');
    const params = new URLSearchParams(location.search);
    state.platform = params.get('platform') || '';
    state.q = params.get('q') || '';
    state.sort = params.get('sort') || 'score';
    state.tenures = new Set((params.get('tenures') || '').split(',')
        .map(value => value.trim()).filter(value => ['newcomer', 'friend', 'oldFriend', 'veteran'].includes(value)));
    el('audience-platform').value = state.platform;
    el('audience-sort').value = state.sort;
    el('audience-search').value = state.q;
    updateTenureLegend();
    await loadList();
    const initialUser = params.get('user');
    if (initialUser && state.platform) await loadDetails(state.platform, initialUser);
})();
