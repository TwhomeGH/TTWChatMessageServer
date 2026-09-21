(() => {
    const el = id => document.getElementById(id);
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
    let busy = false;

    // 時區預設跟隨系統，可手動更正（有些環境系統時區是錯的），選擇存在 localStorage。
    const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const TIMEZONE_KEY = 'ttw_traffic_timezone';
    const timezone = () => el('timezone')?.value || SYSTEM_TIMEZONE;

    /** 建立時區選單：系統時區在最前面並標示，其餘用瀏覽器支援的清單。 */
    function setupTimezone() {
        const select = el('timezone');
        if (!select) return;
        let supported = [];
        try { supported = Intl.supportedValuesOf('timeZone'); } catch { /* 舊瀏覽器沒有這個 API */ }
        // supportedValuesOf 不含 'UTC'，但那是常用選項，手動補在最前面並去重。
        const zones = [SYSTEM_TIMEZONE, 'UTC', ...supported].filter((zone, index, list) => list.indexOf(zone) === index);
        select.replaceChildren(...zones.map(zone => new Option(zone === SYSTEM_TIMEZONE ? zone + '（系統）' : zone, zone)));
        let saved = null;
        try { saved = localStorage.getItem(TIMEZONE_KEY); } catch { /* ignore */ }
        select.value = zones.includes(saved) ? saved : SYSTEM_TIMEZONE;
        select.onchange = () => {
            try { localStorage.setItem(TIMEZONE_KEY, select.value); } catch { /* ignore */ }
            refresh();
        };
    }

    const format = value => value == null ? '—' : value.toFixed(1);

    /** 用第一列當表頭建立表格（thead／tbody），其餘為資料列。 */
    function buildTable(rows) {
        const table = document.createElement('table');
        const [head, ...body] = rows;

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const value of head) {
            const th = document.createElement('th');
            th.textContent = value;
            headRow.append(th);
        }
        thead.append(headRow);
        table.append(thead);

        const tbody = document.createElement('tbody');
        for (const values of body) {
            const tr = document.createElement('tr');
            for (const value of values) {
                const td = document.createElement('td');
                td.textContent = value;
                tr.append(td);
            }
            tbody.append(tr);
        }
        table.append(tbody);
        return table;
    }

    /** 熱圖：完整星期×小時格子。缺資料顯示 —，不把未直播時段填成 0。 */
    function renderHeatmap(cells) {
        const byKey = new Map(cells.map(cell => [cell.key, cell]));
        const max = Math.max(1, ...cells.map(cell => cell.averageViewers || 0));

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const head = document.createElement('tr');
        for (const text of ['星期', ...Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))]) {
            const th = document.createElement('th');
            th.textContent = text;
            head.append(th);
        }
        thead.append(head);
        table.append(thead);

        const tbody = document.createElement('tbody');
        WEEKDAYS.forEach((day, index) => {
            const row = document.createElement('tr');
            const label = document.createElement('th');
            label.textContent = WEEKDAY_LABELS[index];
            row.append(label);

            for (let hour = 0; hour < 24; hour++) {
                const cell = byKey.get(day + ' ' + String(hour).padStart(2, '0'));
                const td = document.createElement('td');
                const button = document.createElement('button');
                button.textContent = format(cell?.averageViewers);
                if (cell?.averageViewers != null) {
                    button.style.background = 'rgba(37,99,235,' + (0.15 + 0.85 * cell.averageViewers / max) + ')';
                }
                button.onclick = () => {
                    el('history-detail').textContent = cell
                        ? day + ' ' + hour + ':00 · ' + cell.observedMinutes + ' 個有取樣分鐘／' +
                          cell.observedDays + ' 天 · 已記錄 ' + cell.joins + ' 次進房、' + cell.chats + ' 則聊天。'
                        : '沒有資料';
                };
                td.append(button);
                row.append(td);
            }
            tbody.append(row);
        });
        table.append(tbody);

        el('heatmap').replaceChildren(table);
    }

    /** 每日統計表。 */
    function renderDaily(daily) {
        el('daily').replaceChildren(buildTable([
            ['日期', '進房次數', '聊天事件', '有取樣分鐘', '平均觀看'],
            ...daily.map(row => [row.key, row.joins, row.chats, row.observedMinutes, format(row.averageViewers)])
        ]));
    }

    /** 每日成效表：互動指標跨場次相加，累計觸及人數取最大。 */
    function renderMetrics(metrics) {
        if (!metrics) return;

        el('metrics').replaceChildren(buildTable([
            ['日期', '鑽石', '送禮者', '新粉絲', '獲讚', '累計觀眾'],
            ...metrics.daily.map(row => [row.key, row.diamonds, row.gifters, row.newFollowers, row.likes, row.uniqueViewers])
        ]));
    }

    /**
     * 歷史時段排名：以「場次」為單位，取場次開場平均觀看。
     * 顯示中位數、平均與收縮平均；樣本不足的時段不列入排名。
     */
    function renderRanking(rankings) {
        if (!rankings) return;

        const enough = rankings.cells.filter(cell => !cell.insufficient);
        const rows = [['#', '時段', '場次', '中位數', '平均', '收縮平均']];

        enough.forEach((cell, index) => {
            rows.push([
                index + 1,
                cell.key,
                cell.n,
                format(cell.median),
                format(cell.mean),
                format(cell.shrunk)
            ]);
        });

        el('ranking').replaceChildren(buildTable(rows));

        el('ranking-note').textContent = enough.length
            ? '共 ' + rankings.sessionCount + ' 個場次、' + rankings.cells.length + ' 個時段；每個時段至少 ' +
              rankings.minSessions + ' 場且分布於至少 3 天才排名；需真實開播時間及開場 30 分鐘內至少 20 分鐘觀測。這是你的歷史觀察，不是平台推流規律。'
            : '目前沒有時段達到 ' + rankings.minSessions + ' 場及 3 天門檻，且需真實開播時間與至少 20 分鐘開場觀測（共 ' + rankings.sessionCount + ' 個場次），暫不排名。';
    }

    /** 重新抓取歷史並更新熱圖、每日統計與時段排名。 */
    async function refresh() {
        if (busy) return;
        busy = true;
        try {
            const res = await fetch(
                '/api/traffic/history?platform=' + encodeURIComponent(el('platform').value) +
                '&days=' + el('history-days').value +
                '&timezone=' + encodeURIComponent(timezone()),
                { cache: 'no-store' }
            );
            if (!res.ok) throw Error();
            const data = await res.json();

            el('history-status').textContent = (data.storageError ? data.storageError + ' · ' : '') +
                (data.platform || '尚無資料') + ' · ' + timezone() + ' · 自動保存 · ' +
                (data.rankings?.sessionCount ?? 0) + ' 個觀測場次';

            renderHeatmap(data.cells);
            renderDaily(data.daily);
            renderMetrics(data.metrics);
            renderRanking(data.rankings);
        } catch {
            el('history-status').textContent = '歷史讀取失敗，保留畫面不是最新資料。';
        } finally {
            busy = false;
        }
    }

    el('history-days').addEventListener('change', refresh);
    el('platform').addEventListener('change', refresh);
    window.addEventListener('traffic-cleared', refresh);   // 清理統計後立刻重讀歷史
    setupTimezone();
    refresh();
    setInterval(refresh, 60000);
})();
