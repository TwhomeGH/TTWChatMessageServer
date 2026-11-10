(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const cards = $('diagCards');
    const recent = $('diagRecent');
    const logsEl = $('diagLogs');
    const statusEl = $('diagStatus');
    const callout = $('diagCallout');
    const search = $('diagSearch');
    const auto = $('diagAuto');
    const autoScroll = $('diagAutoScroll');
    const refresh = $('diagRefresh');
    const socketEnabled = $('diagSocketEnabled');
    const socketApply = $('diagSocketApply');
    const socketStatus = $('diagSocketStatus');
    let state = { logs: [], diagnostics: [], recentDiagnostics: [], stats: {}, lastReceived: null };
    let timer = null;
    let searchTimer = null;
    let loading = false;
    let socketDirty = false;

    function text(node, value) {
        node.textContent = value == null ? '' : String(value);
        return node;
    }

    function relative(ms) {
        if (!ms) return '尚無';
        const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (seconds < 60) return seconds + ' 秒前';
        if (seconds < 3600) return Math.floor(seconds / 60) + ' 分前';
        return Math.floor(seconds / 3600) + ' 小時前';
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

    function scrollLogsToLatest() {
        if (!autoScroll.checked) return;
        requestAnimationFrame(() => {
            logsEl.scrollTop = logsEl.scrollHeight;
        });
    }

    function renderLogs() {
        const previousTop = logsEl.scrollTop;
        logsEl.replaceChildren();
        const logs = state.logs || [];
        if (!logs.length) {
            const empty = document.createElement('div');
            empty.className = 'diag-empty';
            empty.textContent = '沒有符合的日誌。';
            logsEl.append(empty);
            return;
        }
        // store 回傳新到舊；畫面改成舊到新，最新保持在底部。
        for (const entry of [...logs].reverse()) {
            const row = document.createElement('div');
            row.className = 'diag-log';
            const time = document.createElement('time');
            text(time, entry.time || new Date(entry.receivedAt).toLocaleString());
            const strong = document.createElement('strong');
            text(strong, entry.title || 'log');
            const p = document.createElement('p');
            text(p, (entry.body || '').slice(0, 4000));
            row.append(time, strong, p);
            logsEl.append(row);
        }
        if (autoScroll.checked) {
            scrollLogsToLatest();
        } else {
            requestAnimationFrame(() => { logsEl.scrollTop = previousTop; });
        }
    }

    function render() {
        renderCards();
        renderRecent();
        renderLogs();
        const stats = state.stats || {};
        statusEl.textContent = `最後收到：${relative(state.lastReceived)} · 緩衝 ${stats.bufferedLogs || 0} 則 · 診斷 ${stats.bufferedDiagnostics || 0} 筆`;
    }

    function socketLabel(data) {
        const stateLabels = {
            off: '未啟用', connecting: '連線中', connected: '已連線', subscribed: '已訂閱',
            reconnecting: '重連中', error: '錯誤'
        };
        const label = stateLabels[data.state] || data.state || '未知';
        const where = data.host ? `${data.host}:${data.port}` : '未設定';
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
            // 使用者正在編輯時不要用輪詢結果蓋掉勾選狀態。
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
                showCallout('Socket 訂閱需要主服務登入。', '/login');
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

    async function load() {
        if (loading) return;
        loading = true;
        try {
            const query = search.value.trim();
            const response = await fetch('/api/diagnostics?limit=500' + (query ? '&q=' + encodeURIComponent(query) : ''), {
                cache: 'no-store'
            });
            if (response.status === 401) {
                auto.checked = false;
                schedule();
                showCallout('診斷資料需要主服務登入。', '/login');
                return;
            }
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            if (!data.ok) throw new Error(data.error || '讀取失敗');
            hideCallout();
            state = data;
            render();
        } catch (error) {
            showCallout('讀取診斷失敗：' + error.message, null);
        } finally {
            loading = false;
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

    search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(load, 250);
    });
    refresh.addEventListener('click', () => {
        load();
        loadSocketStatus();
    });
    auto.addEventListener('change', schedule);
    autoScroll.addEventListener('change', () => {
        if (autoScroll.checked) scrollLogsToLatest();
    });
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
