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

    /** 桶時間的顯示格式：範圍越長、粒度越粗。 */
    function bucketLabel(value) {
        const date = new Date(value);
        const bucketMs = data?.bucketMs ?? 60000;
        const pad = number => String(number).padStart(2, '0');
        if (bucketMs >= 86400000) return (date.getMonth() + 1) + '/' + date.getDate();
        if (bucketMs >= 3600000) return (date.getMonth() + 1) + '/' + date.getDate() + ' ' + pad(date.getHours()) + ':00';
        return pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    /** 進房明細：未選取桶時顯示最近 200 筆，選取時只顯示落在該桶範圍的事件。 */
    function renderDetails() {
        const bucketMs = data.bucketMs ?? 60000;
        const rows = data.events
            .filter(event => selected === null || (event.time >= selected && event.time < selected + bucketMs))
            .slice()
            .reverse();

        el('detail-title').textContent = selected === null
            ? '最近進房事件（最多 200 筆）'
            : bucketLabel(selected) + ' 進房明細';

        if (!rows.length) {
            const note = document.createElement('p');
            note.className = 'text-gray-500 text-xs';
            note.textContent = selected === null
                ? '目前沒有進房事件（不是所有平台都提供；原生只有 TikTok 有 MEMBER 事件）。'
                : '這個時間區間沒有進房事件。';
            el('details').replaceChildren(note);
            return;
        }

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

        // 時間刻度：均勻取 5 個位置，格式隨桶寬改變。
        ctx.fillStyle = '#9ca3af';
        const ticks = rows.length <= 5
            ? rows.map((_, i) => i)
            : [0, 0.25, 0.5, 0.75, 1].map(fraction => Math.round(fraction * (rows.length - 1)));
        for (const i of [...new Set(ticks)]) {
            ctx.fillText(bucketLabel(rows[i].time), Math.max(2, Math.min(width - 66, pointX(i))), height - 8);
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
                '/api/traffic?platform=' + encodeURIComponent(el('platform').value) + '&range=' + el('range').value,
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

            const diagnostics = data.diagnostics ?? {};
            const ago = value => value == null ? '無' : Math.round((data.now - value) / 1000) + ' 秒前';

            el('status').textContent = data.platform
                ? '更新 ' + time(data.now) + ' · ' + (data.currentViewers === null
                    ? '目前沒有新鮮的觀看取樣（超過 90 秒）'
                    : '觀看數 ' + data.currentViewers + '（' + ago(data.lastViewerAt) + '）')
                : '尚未收到人流資料';

            // 診斷列：直接指出哪一條觀看來源斷了，免得只看到「—」卻找不到原因。
            el('diagnostics').textContent = data.platform
                ? '觀看取樣：範圍內 ' + (diagnostics.observedBuckets ?? 0) + '/' + (diagnostics.totalBuckets ?? 0) + ' 格有值'
                  + ' · 最近原生 ' + ago(diagnostics.lastNativeViewerAt)
                  + '、備用 ' + ago(diagnostics.lastDeclaredViewerAt)
                  + '（記憶體 ' + (diagnostics.viewerSamples ?? 0) + ' 筆樣本／' + (diagnostics.memoryEvents ?? 0) + ' 筆事件）'
                : '';

            const cards = [
                ['目前觀看', data.currentViewers ?? '—'],
                ['觀看淨增／分鐘', data.growth === null ? '—' : data.growth.toFixed(1)],
                // 沒有新鮮樣本時顯示 —：0 秒是「沒在成長」，跟「沒資料」不同。
                ['持續增長', data.currentViewers === null ? '—' : Math.round(data.growingMs / 1000) + ' 秒'],
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

    for (const id of ['platform', 'range']) el(id).onchange = () => { selected = null; refresh(); };
    window.addEventListener('resize', () => {
        if (!data) return;
        draw('viewers', ['viewers']);
        draw('arrivals', ['joins', 'chats']);
    });
    refresh();
    setInterval(refresh, 5000);
})();
