(() => {
    const el = id => document.getElementById(id);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
    let busy = false;

    const format = value => value == null ? '—' : value.toFixed(1);

    /** 熱圖：完整星期×小時格子。缺資料顯示 —，不把未直播時段填成 0。 */
    function renderHeatmap(cells) {
        const byKey = new Map(cells.map(cell => [cell.key, cell]));
        const max = Math.max(1, ...cells.map(cell => cell.averageViewers || 0));

        const table = document.createElement('table');
        const head = document.createElement('tr');
        for (const text of ['星期', ...Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))]) {
            const th = document.createElement('th');
            th.textContent = text;
            head.append(th);
        }
        table.append(head);

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
                button.style.cssText = 'min-width:44px;padding:6px;border-radius:4px';
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
            table.append(row);
        });

        el('heatmap').replaceChildren(table);
    }

    /** 每日統計表。 */
    function renderDaily(daily) {
        const table = document.createElement('table');
        const rows = [
            ['日期', '進房次數', '聊天事件', '有取樣分鐘', '平均觀看'],
            ...daily.map(row => [row.key, row.joins, row.chats, row.observedMinutes, format(row.averageViewers)])
        ];
        for (const values of rows) {
            const tr = document.createElement('tr');
            for (const value of values) {
                const td = document.createElement('td');
                td.textContent = value;
                tr.append(td);
            }
            table.append(tr);
        }
        el('daily').replaceChildren(table);
    }

    /** 每日成效表：互動指標跨場次相加，累計觸及人數取最大。 */
    function renderMetrics(metrics) {
        if (!metrics) return;

        const table = document.createElement('table');
        const rows = [
            ['日期', '鑽石', '送禮者', '新粉絲', '獲讚', '累計觀眾'],
            ...metrics.daily.map(row => [row.key, row.diamonds, row.gifters, row.newFollowers, row.likes, row.uniqueViewers])
        ];
        for (const values of rows) {
            const tr = document.createElement('tr');
            for (const value of values) {
                const td = document.createElement('td');
                td.textContent = value;
                tr.append(td);
            }
            table.append(tr);
        }
        el('metrics').replaceChildren(table);
    }

    /**
     * 歷史時段排名：以「場次」為單位，取場次開場平均觀看。
     * 顯示中位數、平均與收縮平均；樣本不足的時段不列入排名。
     */
    function renderRanking(rankings) {
        if (!rankings) return;

        const enough = rankings.cells.filter(cell => !cell.insufficient);
        const table = document.createElement('table');
        const rows = [['#', '時段', '場次', '中位數', '平均', '收縮平均', '95% 區間']];

        enough.forEach((cell, index) => {
            rows.push([
                index + 1,
                cell.key,
                cell.n,
                format(cell.median),
                format(cell.mean),
                format(cell.shrunk),
                cell.ci95 == null ? '—' : '±' + cell.ci95.toFixed(1)
            ]);
        });

        for (const values of rows) {
            const tr = document.createElement('tr');
            for (const value of values) {
                const td = document.createElement('td');
                td.textContent = value;
                tr.append(td);
            }
            table.append(tr);
        }
        el('ranking').replaceChildren(table);

        el('ranking-note').textContent = enough.length
            ? '共 ' + rankings.sessionCount + ' 個場次、' + rankings.cells.length + ' 個時段；每個時段至少 ' +
              rankings.minSessions + ' 場才排名。這是你的歷史觀察，不是平台推流規律。'
            : '目前沒有時段達到 ' + rankings.minSessions + ' 場門檻（共 ' + rankings.sessionCount + ' 個場次），暫不排名。';
    }

    /** 重新抓取歷史並更新熱圖、每日統計與時段排名。 */
    async function refresh() {
        if (busy) return;
        busy = true;
        try {
            const res = await fetch(
                '/api/traffic/history?platform=' + encodeURIComponent(el('platform').value) +
                '&days=' + el('history-days').value +
                '&timezone=' + encodeURIComponent(timezone),
                { cache: 'no-store' }
            );
            if (!res.ok) throw Error();
            const data = await res.json();

            el('history-status').textContent = (data.storageError ? data.storageError + ' · ' : '') +
                (data.platform || '尚無資料') + ' · ' + timezone + ' · 自動保存 · ' +
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
    refresh();
    setInterval(refresh, 60000);
})();
