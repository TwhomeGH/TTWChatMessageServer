(() => {
    const el = id => document.getElementById(id);
    const time = value => new Date(value).toLocaleTimeString();
    let data = null;
    let busy = false;
    let selected = null;

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

    /** 進房明細：未選取分鐘時顯示最近 200 筆，選取時只顯示該分鐘。 */
    function renderDetails() {
        const rows = data.events
            .filter(event => selected === null || Math.floor(event.time / 60000) * 60000 === selected)
            .slice()
            .reverse();

        el('detail-title').textContent = selected === null
            ? '最近進房事件（最多 200 筆）'
            : time(selected) + ' 進房明細';

        el('details').replaceChildren(buildTable([
            ['時間', '使用者／ID', '來源', '辨識'],
            ...rows.map(event => [
                time(event.time),
                event.user || '未提供',
                event.platform + ' / ' + event.transport,
                event.evidence === 'native' ? '原生事件' : '來源明確標記'
            ])
        ]));
    }

        /** 共用桶時間繪製折線；觀看數缺值處斷線，不補零、也不畫每筆圓點。 */
    function draw(id, keys) {
        const canvas = el(id);
        const width = canvas.clientWidth;
        const height = canvas.clientHeight || 200;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = width * ratio;
        canvas.height = height * ratio;

        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        ctx.font = '11px sans-serif';

        const rows = data.buckets;
        const max = Math.max(1, ...rows.flatMap(row => keys.map(key => row[key] ?? 0)));
        const plot = { left: 38, right: width - 10, top: 20, bottom: height - 30 };

        // 圖表區間：鋪一層與卡片不同的底色再加外框，讓繪圖範圍看得出來。
        ctx.fillStyle = '#111827';
        ctx.fillRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
        ctx.strokeStyle = '#4b5563';
        ctx.lineWidth = 1;
        ctx.strokeRect(plot.left + 0.5, plot.top + 0.5, plot.right - plot.left - 1, plot.bottom - plot.top - 1);

        // 水平格線與左側刻度（0／50%／100%）。
        for (const level of [0, 0.5, 1]) {
            const y = plot.bottom - level * (plot.bottom - plot.top);
            ctx.strokeStyle = level === 0 ? '#4b5563' : '#374151';
            ctx.beginPath();
            ctx.moveTo(plot.left, y);
            ctx.lineTo(plot.right, y);
            ctx.stroke();
            ctx.fillStyle = '#9ca3af';
            ctx.fillText(String(Math.round(max * level)), 2, y + 4);
        }

        const pointX = i => plot.left + i * (plot.right - plot.left) / Math.max(1, rows.length - 1);
        const pointY = value => plot.bottom - value / max * (plot.bottom - plot.top);

        keys.forEach((key, index) => {
            ctx.strokeStyle = index ? '#34d399' : '#60a5fa';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let open = false;
            rows.forEach((row, i) => {
                if (row[key] === null) { open = false; return; }
                const x = pointX(i);
                const y = pointY(row[key]);
                if (open) ctx.lineTo(x, y); else ctx.moveTo(x, y);
                open = true;
            });
            ctx.stroke();
        });

        ctx.fillStyle = '#9ca3af';
        for (const i of [0, Math.floor((rows.length - 1) / 2), rows.length - 1]) {
            ctx.fillText(time(rows[i].time), Math.max(0, Math.min(width - 70, pointX(i))), height - 8);
        }

        canvas.onclick = event => {
            const i = Math.round((event.offsetX - plot.left) / (plot.right - plot.left) * (rows.length - 1));
            selected = rows[Math.max(0, Math.min(rows.length - 1, i))].time;
            renderDetails();
        };
    }

    /** 抓取即時視窗並更新狀態列、卡片與圖表。 */
    async function refresh() {
        if (busy) return;
        busy = true;
        try {
            const res = await fetch(
                '/api/traffic?platform=' + encodeURIComponent(el('platform').value) + '&minutes=' + el('minutes').value,
                { cache: 'no-store' }
            );
            if (!res.ok) throw Error('讀取失敗');
            data = await res.json();

            el('platform').replaceChildren(...data.platforms.map(platform => {
                const option = document.createElement('option');
                option.value = platform;
                option.textContent = platform;
                return option;
            }));
            el('platform').value = data.platform || '';

            el('status').textContent = data.platform
                ? '更新 ' + time(data.now) + ' · ' + (data.currentViewers === null ? '觀看數缺漏或已超過 90 秒' : '觀看數更新 ' + time(data.lastViewerAt))
                : '尚未收到人流資料';

            const cards = [
                ['目前觀看', data.currentViewers ?? '—'],
                ['觀看淨增／分鐘', data.growth === null ? '—' : data.growth.toFixed(1)],
                ['持續增長', Math.round(data.growingMs / 1000) + ' 秒'],
                ['此範圍進房次數', data.buckets.reduce((n, bucket) => n + bucket.joins, 0)]
            ];
            el('cards').replaceChildren(...cards.map(([name, value]) => {
                const card = document.createElement('div');
                card.className = 'card';
                const label = document.createElement('div');
                label.className = 'label';
                label.textContent = name;
                const amount = document.createElement('div');
                amount.className = 'value';
                amount.textContent = value;
                card.append(label, amount);
                return card;
            }));

            draw('viewers', ['viewers']);
            draw('arrivals', ['joins', 'chats']);
            renderDetails();
        } catch {
            el('status').textContent = '資料更新失敗；下方保留上次結果，非即時資料。';
        } finally {
            busy = false;
        }
    }

    for (const id of ['platform', 'minutes']) el(id).onchange = () => { selected = null; refresh(); };
    window.addEventListener('resize', () => {
        if (!data) return;
        draw('viewers', ['viewers']);
        draw('arrivals', ['joins', 'chats']);
    });
    refresh();
    setInterval(refresh, 5000);
})();
