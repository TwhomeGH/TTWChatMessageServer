(async () => {
    await window.TTWI18n.ready;
    const t = (key, params = {}) => window.TTWI18n.t('traffic.' + key, params);
    const el = id => document.getElementById(id);
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekday = index => new Intl.DateTimeFormat(window.TTWI18n.language, {weekday:'short', timeZone:'UTC'}).format(Date.UTC(2026, 0, 5 + index));
    let busy = false, rerun = false, pollTimer, selectedCell = null;
    const rendered = new Map();
    function changed(key, value) {
        const signature = JSON.stringify(value);
        if (rendered.get(key) === signature) return false;
        rendered.set(key, signature); return true;
    }
    function setText(node, value) {
        const text = String(value);
        if (node.textContent !== text) node.textContent = text;
    }
    function schedulePoll() {
        clearTimeout(pollTimer);
        if (!document.hidden) pollTimer = setTimeout(refresh,60000);
    }
    // 保留 table、列與儲存格；新增或刪除列時才調整 DOM。
    function updateTable(id, rows) {
        const box = el(id);
        let table = box.querySelector('table');
        if (!table) { box.append(buildTable(rows)); return; }
        const header = table.tHead.rows[0];
        rows[0].forEach((value,index)=>setText(header.cells[index],value));
        const body = table.tBodies[0];
        rows.slice(1).forEach((values,index)=>{
            const row = body.rows[index] || body.insertRow();
            values.forEach((value,column)=>setText(row.cells[column] || row.insertCell(),value));
        });
        while(body.rows.length > rows.length-1) body.deleteRow(body.rows.length-1);
    }

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
        select.replaceChildren(...zones.map(zone => new Option(zone === SYSTEM_TIMEZONE ? zone + t('system') : zone, zone)));
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
        let table = el('heatmap').querySelector('table');
        if (!table) {
            table = buildTable([[t('weekday'), ...Array.from({length:24},(_,hour)=>hour)],
                ...WEEKDAYS.map((_,index)=>[weekday(index),...Array(24).fill('')])]);
            for(const row of table.tBodies[0].rows) for(let hour=0;hour<24;hour++) {
                row.cells[hour+1].append(document.createElement('button'));
            }
            el('heatmap').append(table);
        }
        setText(table.tHead.rows[0].cells[0],t('weekday'));
        const describe = (index,hour) => {
            const cell = byKey.get(WEEKDAYS[index] + ' ' + String(hour).padStart(2,'0'));
            setText(el('history-detail'), cell ? t('history.cell', {
                day:weekday(index), hour, minutes:cell.observedMinutes, days:cell.observedDays, joins:cell.joins, chats:cell.chats
            }) : t('noData'));
        };
        WEEKDAYS.forEach((day,index)=>{
            const row = table.tBodies[0].rows[index];
            setText(row.cells[0],weekday(index));
            for(let hour=0;hour<24;hour++) {
                const cell = byKey.get(day+' '+String(hour).padStart(2,'0'));
                const button = row.cells[hour+1].firstElementChild;
                setText(button,format(cell?.averageViewers));
                const color = cell?.averageViewers != null ? 'rgba(37,99,235,'+(0.15+0.85*cell.averageViewers/max)+')' : '';
                if(button.dataset.color !== color) { button.style.background=color; button.dataset.color=color; }
                button.onclick=()=>{selectedCell=[index,hour];describe(index,hour);};
            }
        });
        if(selectedCell) describe(...selectedCell);
    }

    /** 每日統計表。 */
    function renderDaily(daily) {
        updateTable('daily', [
            [t('date'), t('joinCount'), t('chatCount'), t('observedMinutes'), t('averageViewers')],
            ...daily.map(row => [row.key, row.joins, row.chats, row.observedMinutes, format(row.averageViewers)])
        ]);
    }

    /** 每日成效表：互動指標跨場次相加，累計觸及人數取最大。 */
    function renderMetrics(metrics) {
        if (!metrics) return;

        updateTable('metrics', [
            [t('date'), t('diamonds'), t('gifters'), t('followers'), t('likes'), t('uniqueViewers')],
            ...metrics.daily.map(row => [row.key, row.diamonds, row.gifters, row.newFollowers, row.likes, row.uniqueViewers])
        ]);
    }

    /**
     * 歷史時段排名：以「場次」為單位，取場次開場平均觀看。
     * 顯示中位數、平均與收縮平均；樣本不足的時段不列入排名。
     */
    function renderRanking(rankings) {
        if (!rankings) return;

        const enough = rankings.cells.filter(cell => !cell.insufficient);
        const rows = [['#', t('timeSlot'), t('sessions'), t('median'), t('mean'), t('shrunk')]];

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

        updateTable('ranking', rows);

        setText(el('ranking-note'), t(enough.length ? 'ranking.note' : 'ranking.insufficient', {
            sessions:rankings.sessionCount, cells:rankings.cells.length, minimum:rankings.minSessions
        }));
    }

    /** 重新抓取歷史並更新熱圖、每日統計與時段排名。 */
    async function refresh() {
        clearTimeout(pollTimer);
        if (document.hidden) return;
        if (busy) { rerun = true; return; }
        busy = true;
        const requestedPlatform = el('platform').value, requestedDays = el('history-days').value, requestedTimezone = timezone();
        try {
            const res = await fetch(
                '/api/traffic/history?platform=' + encodeURIComponent(requestedPlatform) +
                '&days=' + requestedDays +
                '&timezone=' + encodeURIComponent(requestedTimezone),
                { cache: 'no-store' }
            );
            if (!res.ok) throw Error();
            const data = await res.json();
            if (document.hidden) return;
            if (requestedPlatform !== el('platform').value || requestedDays !== el('history-days').value || requestedTimezone !== timezone()) { rerun = true; return; }

            setText(el('history-status'), (data.storageError ? data.storageError + ' · ' : '') +
                t('history.status', {platform:data.platform || t('noData'), timezone:timezone(), sessions:data.rankings?.sessionCount ?? 0}));

            const context = [data.platform, timezone(), window.TTWI18n.language];
            if (changed('heatmap', [context, data.cells])) renderHeatmap(data.cells);
            if (changed('daily', [context, data.daily])) renderDaily(data.daily);
            if (changed('metrics', [context, data.metrics])) renderMetrics(data.metrics);
            if (changed('ranking', [context, data.rankings])) renderRanking(data.rankings);
        } catch {
            setText(el('history-status'), t('history.error'));
        } finally {
            busy = false;
            if (rerun) { rerun = false; refresh(); } else schedulePoll();
        }
    }

    el('history-days').addEventListener('change', refresh);
    el('platform').addEventListener('change', refresh);
    window.addEventListener('traffic-cleared', refresh);   // 清理統計後立刻重讀歷史
    document.addEventListener('languagechange', () => {
        for (const option of el('timezone').options) option.textContent = option.value === SYSTEM_TIMEZONE ? option.value + t('system') : option.value;
        refresh();
    });
    setupTimezone();
    refresh();
    document.addEventListener('visibilitychange', () => {
        clearTimeout(pollTimer);
        if (!document.hidden) refresh();
    });
})();
