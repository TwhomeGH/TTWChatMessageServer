(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const cards = $('diagCards');
    const recent = $('diagRecent');
    const summaryEl = $('diagSummary');
    const categoriesEl = $('diagCategories');
    const logsEl = $('diagLogs');
    const scrollEl = $('diagLogScroll');
    const emptyEl = $('diagEmpty');
    const moreEl = $('diagMore');
    const statusEl = $('diagStatus');
    const callout = $('diagCallout');
    const search = $('diagSearch');
    const severity = $('diagSeverity');
    const session = $('diagSession');
    const order = $('diagOrder');
    const range = $('diagRange');
    const customRange = $('diagCustomRange');
    const fromInput = $('diagFrom');
    const toInput = $('diagTo');
    const context = $('diagContext');
    const auto = $('diagAuto');
    const autoScroll = $('diagAutoScroll');
    const refresh = $('diagRefresh');
    const reset = $('diagReset');
    const socketEnabled = $('diagSocketEnabled');
    const socketApply = $('diagSocketApply');
    const socketStatus = $('diagSocketStatus');

    const state = {
        logs: [],
        summary: null,
        total: 0,
        hasMore: false,
        limit: 300,
        category: '',
        severity: '',
        session: '',
        query: '',
        order: 'desc',
        from: 0,
        to: 0,
        context: 0,
        stats: {},
        diagnostics: [],
        recentDiagnostics: [],
        lastReceived: null
    };
    let timer = null;
    let searchTimer = null;
    let loading = false;
    let socketDirty = false;

    function text(node, value) {
        node.textContent = value == null ? '' : String(value);
        return node;
    }

    /** 以目前搜尋字串標記文字；不把使用者輸入當 HTML 或正則表達式。 */
    function appendHighlighted(node, value, query) {
        const raw = value == null ? '' : String(value);
        const needle = String(query || '').trim().toLowerCase();
        if (!needle) {
            node.append(document.createTextNode(raw));
            return;
        }
        const haystack = raw.toLowerCase();
        let start = 0;
        let index = haystack.indexOf(needle);
        while (index !== -1) {
            if (index > start) node.append(document.createTextNode(raw.slice(start, index)));
            const mark = document.createElement('mark');
            mark.className = 'diag-highlight';
            mark.textContent = raw.slice(index, index + needle.length);
            node.append(mark);
            start = index + needle.length;
            index = haystack.indexOf(needle, start);
        }
        if (start < raw.length) node.append(document.createTextNode(raw.slice(start)));
    }

    function relative(ms) {
        if (!ms) return '尚無';
        const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (seconds < 60) return seconds + ' 秒前';
        if (seconds < 3600) return Math.floor(seconds / 60) + ' 分前';
        return Math.floor(seconds / 3600) + ' 小時前';
    }

    function formatDateTime(ms) {
        return new Date(ms).toLocaleString('zh-TW', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
    }

    function rangeLabel() {
        if (state.from && state.to) return `${formatDateTime(state.from)} ～ ${formatDateTime(state.to)}`;
        if (state.from) return `${formatDateTime(state.from)} 之後`;
        if (state.to) return `${formatDateTime(state.to)} 之前`;
        return '全部收到時間';
    }

    function showCallout(message, link) {
        callout.replaceChildren();
        callout.hidden = false;
        callout.append(document.createTextNode(message + ' '));
        if (link) {
            const a = document.createElement('a');
            a.href = link;
            a.className = 'text-blue-400 underline';
            a.textContent = '前往登入';
            callout.append(a);
        }
    }

    function hideCallout() {
        callout.hidden = true;
        callout.replaceChildren();
    }

    function card(label, value, kind) {
        const box = document.createElement('div');
        box.className = 'log-card';
        const labelNode = document.createElement('div');
        labelNode.className = 'log-card-label';
        text(labelNode, label);
        const valueNode = document.createElement('div');
        valueNode.className = 'log-card-value' + (kind ? ` is-${kind}` : '');
        text(valueNode, value);
        box.append(labelNode, valueNode);
        return box;
    }

    function renderSummary() {
        const summary = state.summary || {};
        summaryEl.replaceChildren(
            card('總筆數', summary.total ?? state.logs.length),
            card('資料時間範圍', summary.range || '無時間戳'),
            card('Session', (summary.sessions || []).length),
            card('警告', summary.warn ?? 0, 'warn'),
            card('錯誤', summary.error ?? 0, 'error')
        );
    }

    function renderCategories() {
        const categories = state.summary?.categories || [];
        const total = state.summary?.total ?? state.logs.length;
        categoriesEl.replaceChildren();
        const all = document.createElement('button');
        all.type = 'button';
        all.className = 'log-cat' + (state.category === '' ? ' active' : '');
        const allLabel = document.createElement('span');
        text(allLabel, '全部');
        const allCount = document.createElement('span');
        allCount.className = 'count';
        text(allCount, total);
        all.append(allLabel, allCount);
        all.addEventListener('click', () => {
            state.category = '';
            state.limit = 300;
            load();
        });
        categoriesEl.append(all);
        for (const item of categories) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'log-cat' + (state.category === item.name ? ' active' : '');
            const label = document.createElement('span');
            text(label, item.name);
            const count = document.createElement('span');
            count.className = 'count';
            text(count, item.count);
            button.append(label, count);
            button.addEventListener('click', () => {
                state.category = item.name;
                state.limit = 300;
                load();
            });
            categoriesEl.append(button);
        }
    }

    function renderSessions() {
        const selected = state.session;
        const sessions = state.summary?.sessions || [];
        session.replaceChildren();
        const all = document.createElement('option');
        all.value = '';
        text(all, '全部 Session');
        session.append(all);
        for (const id of sessions) {
            const option = document.createElement('option');
            option.value = id;
            text(option, id);
            session.append(option);
        }
        session.value = sessions.includes(selected) ? selected : '';
        if (session.value !== selected) state.session = session.value;
    }

    function renderCards() {
        cards.replaceChildren();
        const diagnostics = (state.diagnostics || []).filter(item => item.subsystem === 'logio');
        if (!diagnostics.length) {
            const empty = document.createElement('div');
            empty.className = 'diag-empty';
            empty.textContent = '尚無 logio 診斷。';
            cards.append(empty);
            return;
        }
        for (const item of diagnostics) {
            const box = document.createElement('div');
            box.className = 'mb-3';
            const title = document.createElement('div');
            title.className = 'text-sm text-gray-200';
            text(title, `${item.subsystem} · ${item.source}`);
            box.append(title);
            for (const [label, value] of [
                ['次數', item.count],
                ['最近錯誤', item.lastError || '（無）'],
                ['最後收到', relative(item.receivedAt)]
            ]) {
                const row = document.createElement('div');
                row.className = 'diag-metric';
                const key = document.createElement('span');
                key.className = 'text-gray-400';
                text(key, label);
                const val = document.createElement('span');
                val.className = 'text-right text-gray-200';
                text(val, value);
                row.append(key, val);
                box.append(row);
            }
            cards.append(box);
        }
    }

    function renderRecent() {
        recent.replaceChildren();
        const items = (state.recentDiagnostics || []).slice(0, 20);
        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'diag-empty';
            empty.textContent = '尚無資料。';
            recent.append(empty);
            return;
        }
        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'diag-log';
            const time = document.createElement('time');
            text(time, relative(item.receivedAt));
            const strong = document.createElement('strong');
            text(strong, `${item.subsystem}/${item.source}`);
            const p = document.createElement('p');
            text(p, `count=${item.count} ${item.lastError || ''}`);
            row.append(time, strong, p);
            recent.append(row);
        }
    }

    function severityBadge(level) {
        const badge = document.createElement('span');
        const labels = { error: '錯誤', warn: '警告', info: '一般' };
        badge.className = `log-level-badge log-level-${level || 'info'}`;
        text(badge, labels[level] || level || '一般');
        return badge;
    }

    function fieldsDetails(fields, query) {
        const keys = Object.keys(fields || {});
        if (!keys.length) return null;
        const details = document.createElement('details');
        details.className = 'log-fields';
        const summary = document.createElement('summary');
        text(summary, `${keys.length} 個欄位`);
        const pre = document.createElement('pre');
        appendHighlighted(pre, keys.map(key => `${key} = ${fields[key]}`).join('\n'), query);
        details.append(summary, pre);
        return details;
    }

    function renderRows() {
        const previousTop = scrollEl.scrollTop;
        logsEl.replaceChildren();
        // 排序由 API 的 order 參數決定；新到舊時最新在頂端，舊到新時最新在底部。
        for (const line of state.logs) {
            const contextLine = line.matched === false;
            const row = document.createElement('tr');
            row.className = `log-row is-${line.severity || 'info'}${contextLine ? ' is-context' : ''}`;
            const time = document.createElement('td');
            time.className = 'log-time';
            text(time, line.time || (line.receivedAt ? new Date(line.receivedAt).toLocaleString() : '—'));
            const category = document.createElement('td');
            category.className = 'log-category';
            appendHighlighted(category, line.category || line.title || 'Other', state.query);
            const level = document.createElement('td');
            level.className = 'log-level';
            level.append(severityBadge(line.severity));
            if (contextLine) {
                const badge = document.createElement('span');
                badge.className = 'diag-context-badge';
                badge.textContent = '上下文';
                level.append(badge);
            }
            const message = document.createElement('td');
            message.className = 'log-message';
            appendHighlighted(message, line.body || line.title || '', state.query);
            const fields = fieldsDetails(line.fields, state.query);
            if (fields) message.append(fields);
            row.append(time, category, level, message);
            logsEl.append(row);
        }
        emptyEl.hidden = state.logs.length !== 0;
        moreEl.hidden = !state.hasMore;
        moreEl.textContent = `載入更多（已顯示 ${state.logs.length} 筆，符合 ${state.total} 筆）`;
        if (autoScroll.checked) {
            requestAnimationFrame(() => {
                scrollEl.scrollTop = state.order === 'asc' ? scrollEl.scrollHeight : 0;
            });
        } else {
            requestAnimationFrame(() => { scrollEl.scrollTop = previousTop; });
        }
    }

    function renderStatus() {
        const filterBits = [];
        if (state.category) filterBits.push(`分類 ${state.category}`);
        if (state.severity) filterBits.push(`嚴重度 ${state.severity}`);
        if (state.session) filterBits.push(`Session ${state.session}`);
        if (state.query) filterBits.push(`搜尋 ${state.query}`);
        const stats = state.stats || {};
        const contextCount = state.logs.filter(line => line.matched === false).length;
        const orderLabel = state.order === 'asc' ? '收到時間 舊→新' : '收到時間 新→舊';
        statusEl.textContent = `${state.total} 筆符合 · 顯示 ${state.logs.length} 筆`
            + (contextCount ? `（上下文 ${contextCount} 筆）` : '')
            + (filterBits.length ? ` · ${filterBits.join(' · ')}` : '')
            + ` · 排序 ${orderLabel} · 收到範圍 ${rangeLabel()}`
            + ` · 緩衝 ${stats.bufferedLogs || 0} 則 · 最後收到：${relative(state.lastReceived)}`;
    }

    function render() {
        renderSummary();
        renderCategories();
        renderSessions();
        renderCards();
        renderRecent();
        renderRows();
        renderStatus();
    }

    async function load(more = false) {
        if (loading) return;
        loading = true;
        try {
            if (more) state.limit = Math.min(state.limit + 300, 2000);
            const params = new URLSearchParams({
                limit: String(state.limit),
                q: state.query,
                category: state.category,
                severity: state.severity,
                session: state.session,
                order: state.order,
                from: String(state.from),
                to: String(state.to),
                context: String(state.context)
            });
            const response = await fetch('/api/diagnostics?' + params, { cache: 'no-store' });
            if (response.status === 401) {
                auto.checked = false;
                schedule();
                showCallout('診斷資料需要主服務登入。', '/login?redirect=' + encodeURIComponent('/diagnostics'));
                return;
            }
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            if (!data.ok) throw new Error(data.error || '讀取失敗');
            hideCallout();
            state.logs = Array.isArray(data.logs) ? data.logs : [];
            state.summary = data.summary || null;
            state.total = Number.isFinite(Number(data.total)) ? Number(data.total) : state.logs.length;
            state.hasMore = data.hasMore === true;
            state.diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
            state.recentDiagnostics = Array.isArray(data.recentDiagnostics) ? data.recentDiagnostics : [];
            state.stats = data.stats || {};
            state.lastReceived = data.lastReceived || null;
            render();
        } catch (error) {
            showCallout('讀取診斷失敗：' + error.message, null);
        } finally {
            loading = false;
        }
    }

    function socketLabel(data) {
        const stateLabels = {
            off: '未啟用', connecting: '連線中', connected: '已連線', subscribed: '已訂閱',
            reconnecting: '重連中', error: '錯誤'
        };
        const configured = data.defaults?.configured !== false;
        const host = data.host || data.defaults?.host || '';
        const port = data.host ? data.port : (data.defaults?.port || 0);
        if (!host || !configured) {
            return '未設定連線目標：請設定 SOCKET_API（或 SOCKET_APIS 第一個端點），儲存後重啟主服務。';
        }
        const label = stateLabels[data.state] || data.state || '未知';
        const where = `${host}:${port}${data.defaults?.source ? `（${data.defaults.source}）` : ''}`;
        const extra = data.lastError ? ` · ${data.lastError}` : '';
        return `${where} · ${label}${data.subscribed ? '（外部事件）' : ''}${extra}`;
    }

    async function loadSocketStatus() {
        try {
            const response = await fetch('/api/diagnostics/socket', { cache: 'no-store' });
            if (response.status === 401) {
                socketStatus.textContent = '需要登入';
                return;
            }
            const data = await response.json();
            if (!response.ok || !data.ok) {
                socketStatus.textContent = data.error || ('HTTP ' + response.status);
                return;
            }
            if (!socketDirty) socketEnabled.checked = data.enabled === true;
            socketStatus.textContent = socketLabel(data);
        } catch (error) {
            socketStatus.textContent = '狀態讀取失敗：' + error.message;
        }
    }

    async function applySocketSubscription() {
        socketApply.disabled = true;
        try {
            const body = { enabled: socketEnabled.checked };
            const response = await fetch('/api/diagnostics/socket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json().catch(() => ({}));
            if (response.status === 401) {
                showCallout('Socket 訂閱需要主服務登入。', '/login?redirect=' + encodeURIComponent('/diagnostics'));
                return;
            }
            if (!response.ok || !data.ok) {
                socketStatus.textContent = data.error || ('HTTP ' + response.status);
                return;
            }
            socketDirty = false;
            socketEnabled.checked = data.enabled === true;
            socketStatus.textContent = socketLabel(data);
        } catch (error) {
            socketStatus.textContent = '套用失敗：' + error.message;
        } finally {
            socketApply.disabled = false;
        }
    }

    function schedule() {
        if (timer) clearInterval(timer);
        timer = null;
        if (!auto.checked) return;
        timer = setInterval(() => {
            if (document.visibilityState === 'visible') {
                load();
                loadSocketStatus();
            }
        }, 2000);
    }

    function resetFilters() {
        state.query = '';
        state.category = '';
        state.severity = '';
        state.session = '';
        state.order = 'desc';
        state.from = 0;
        state.to = 0;
        state.context = 0;
        state.limit = 300;
        search.value = '';
        severity.value = '';
        session.value = '';
        order.value = 'desc';
        range.value = 'all';
        customRange.hidden = true;
        fromInput.value = '';
        toInput.value = '';
        context.value = '0';
        load();
    }

    function applyCustomRange() {
        const from = fromInput.value ? new Date(fromInput.value).getTime() : 0;
        const to = toInput.value ? new Date(toInput.value).getTime() : 0;
        state.from = Number.isFinite(from) ? from : 0;
        state.to = Number.isFinite(to) ? to : 0;
        state.limit = 300;
        load();
    }

    search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.query = search.value.trim();
            state.limit = 300;
            load();
        }, 250);
    });
    severity.addEventListener('change', () => {
        state.severity = severity.value;
        state.limit = 300;
        load();
    });
    session.addEventListener('change', () => {
        state.session = session.value;
        state.limit = 300;
        load();
    });
    order.addEventListener('change', () => {
        state.order = order.value === 'asc' ? 'asc' : 'desc';
        state.limit = 300;
        load();
    });
    range.addEventListener('change', () => {
        if (range.value === 'custom') {
            customRange.hidden = false;
            applyCustomRange();
            return;
        }
        customRange.hidden = true;
        state.from = range.value === 'all' ? 0 : Date.now() - Number(range.value) * 60000;
        state.to = 0;
        state.limit = 300;
        load();
    });
    fromInput.addEventListener('change', applyCustomRange);
    toInput.addEventListener('change', applyCustomRange);
    context.addEventListener('change', () => {
        state.context = Math.max(0, Math.min(20, Number(context.value) || 0));
        state.limit = 300;
        load();
    });
    reset.addEventListener('click', resetFilters);
    refresh.addEventListener('click', () => {
        load();
        loadSocketStatus();
    });
    auto.addEventListener('change', schedule);
    autoScroll.addEventListener('change', () => {
        if (autoScroll.checked) {
            scrollEl.scrollTop = state.order === 'asc' ? scrollEl.scrollHeight : 0;
        }
    });
    moreEl.addEventListener('click', () => load(true));
    socketApply.addEventListener('click', applySocketSubscription);
    socketEnabled.addEventListener('change', () => { socketDirty = true; });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && auto.checked) {
            load();
            loadSocketStatus();
        }
    });

    schedule();
    load();
    loadSocketStatus();
})();
