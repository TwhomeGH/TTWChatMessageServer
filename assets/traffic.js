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

    /**
     * 桶時間的顯示格式：粒度越粗、或範圍跨過一天，就越需要日期。
     * 只看 bucketMs 不夠——例如「全部」可能只有 15 分鐘的桶、卻橫跨 30 小時，
     * 那時只顯示 HH:MM 會分不出是哪一天。
     */
    function bucketLabel(value) {
        const date = new Date(value);
        const bucketMs = data?.bucketMs ?? 60000;
        const spanMs = (data?.now ?? value) - (data?.since ?? value);
        const pad = number => String(number).padStart(2, '0');
        const day = (date.getMonth() + 1) + '/' + date.getDate();
        if (bucketMs >= 86400000 || spanMs >= 3 * 86400000) return day;
        if (bucketMs >= 3600000 || spanMs >= 86400000) return day + ' ' + pad(date.getHours()) + ':00';
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

        // 沒有資料的桶鋪一層淡色底：讓「空窗」跟「線掉到 0」分得出來。
        const hasData = row => row.viewers !== null || row.joins > 0 || row.chats > 0;
        const step = (plot.right - plot.left) / Math.max(1, rows.length - 1);
        const half = rows.length > 1 ? step / 2 : 0;
        ctx.fillStyle = 'rgba(148, 163, 184, .12)';
        let emptyFrom = -1;
        for (let i = 0; i <= rows.length; i++) {
            const empty = i < rows.length && !hasData(rows[i]);
            if (empty && emptyFrom === -1) emptyFrom = i;
            if (!empty && emptyFrom !== -1) {
                const x0 = Math.max(plot.left, pointX(emptyFrom) - half);
                const x1 = Math.min(plot.right, pointX(i - 1) + half);
                ctx.fillRect(x0, plot.top, Math.max(1, x1 - x0), plot.bottom - plot.top);
                emptyFrom = -1;
            }
        }

        keys.forEach((key, index) => {
            ctx.strokeStyle = ['#60a5fa', '#34d399', '#fbbf24'][index] || '#fbbf24';
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

            // 每觀眾訊息量（則/分）：總訊息 ÷ 區間分鐘 ÷ 同區間的平均同時觀看。
            const rangeMin = Math.max(1, (data.now - data.since) / 60000);
            const chats = data.buckets.reduce((n, bucket) => n + bucket.chats, 0);
            const viewerSamples = data.buckets.filter(bucket => bucket.viewers !== null).map(bucket => bucket.viewers);
            const avgViewers = viewerSamples.length ? viewerSamples.reduce((a, b) => a + b, 0) / viewerSamples.length : null;
            const perViewerMsg = avgViewers ? (chats / rangeMin) / avgViewers : null;

            // 過濾攔截率：被擋訊息 ÷ 總訊息。廣告帳戶比例：被廣告規則擋過的帳號 ÷ 活躍發言人數。
            const blockedChats = data.buckets.reduce((n, bucket) => n + (bucket.blocked ?? 0), 0);
            const blockedRatio = chats ? blockedChats / chats : null;
            const adRatio = data.activeUsers ? (data.adUsers ?? 0) / data.activeUsers : null;

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
                  + ' · 攔截 ' + blockedChats + '/' + chats + ' 則'
                  + ' · 廣告帳號 ' + (data.adUsers ?? 0) + '/' + (data.activeUsers ?? 0) + ' 人'
                : '';

            const cards = [
                ['目前觀看', data.currentViewers ?? '—'],
                ['觀看淨增／分鐘', data.growth === null ? '—' : data.growth.toFixed(1)],
                // 沒有新鮮樣本時顯示 —：0 秒是「沒在成長」，跟「沒資料」不同。
                ['持續增長', data.currentViewers === null ? '—' : Math.round(data.growingMs / 1000) + ' 秒'],
                ['此範圍進房次數', data.buckets.reduce((n, bucket) => n + bucket.joins, 0)],
                ['活躍發言人數', (data.activeUsers ?? 0) + ' 人'],
                // 每觀眾訊息量：分子分母都是「同一區間」，不會有累積 vs 瞬時的基準不一致問題。
                ['每觀眾訊息', perViewerMsg === null ? '—' : perViewerMsg.toFixed(2) + ' 則/分'],
                ['過濾攔截率', blockedRatio === null ? '—' : (blockedRatio * 100).toFixed(1) + '%'],
                ['廣告帳戶比例', adRatio === null ? '—' : (adRatio * 100).toFixed(1) + '%']
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
            draw('arrivals', ['joins', 'chats', 'activeUsers']);
            renderDetails();
        } catch {
            el('status').textContent = '資料更新失敗；下方保留上次結果，非即時資料。';
        } finally {
            busy = false;
        }
    }

    // ── 清理統計：先預覽筆數，確定後才刪除（可選某一天或最近 N 小時）──
    /** 解析 HH:MM；不合法回傳 null。 */
    function parseTime(value) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(value || '');
        if (!match) return null;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (hours > 23 || minutes > 59) return null;
        return { hours, minutes };
    }

    /** 依「方式」算出要清理的時間範圍（毫秒）。 */
    function cleanRange() {
        const mode = el('clean-mode').value;
        if (mode === 'hours') {
            const hours = Math.min(720, Math.max(1, Number(el('clean-hours').value) || 6));
            return { from: Date.now() - hours * 3600000, to: Date.now() };
        }

        const value = el('clean-day').value;
        if (!value) return null;
        const [year, month, day] = value.split('-').map(Number);
        if (mode === 'day') {
            const from = new Date(year, month - 1, day).getTime();
            return { from, to: from + 86400000 };
        }

        // slot：某天的某段時間，起訖用 HH:MM。不自動跨午夜——寧可擋下來也不要誤刪一大段。
        const start = parseTime(el('clean-start').value);
        const end = parseTime(el('clean-end').value);
        if (!start || !end) return null;
        return {
            from: new Date(year, month - 1, day, start.hours, start.minutes).getTime(),
            to: new Date(year, month - 1, day, end.hours, end.minutes).getTime()
        };
    }

    /** 把主平台選單的選項鏡射到清理用的平台選單（只在使用者展開時同步）。 */
    function syncCleanPlatforms() {
        const target = el('clean-platform');
        const wanted = [...el('platform').options].map(option => ({ value: option.value, text: option.textContent }));
        if (!wanted.length) return;
        if (wanted.map(option => option.value).join() === [...target.options].map(option => option.value).join()) return;
        const keep = target.value;
        target.replaceChildren(...wanted.map(({ value, text }) => new Option(text, value)));
        if (wanted.some(option => option.value === keep)) target.value = keep;
    }

    async function cleanRequest(confirmDelete) {
        const status = el('clean-status');
        const range = cleanRange();
        if (!range) { status.textContent = '請先選日期與起訖時間。'; return; }
        if (range.to <= range.from) { status.textContent = '結束時間必須晚於開始時間。'; return; }
        status.textContent = confirmDelete ? '刪除中…' : '讀取中…';
        try {
            // 跟歷史區塊用同一個時區選單（預設系統時區、可手動更正）。
            const timezone = el('timezone')?.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
            const response = await fetch('/api/traffic/clear?timezone=' + encodeURIComponent(timezone), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform: el('clean-platform').value, from: range.from, to: range.to, confirm: confirmDelete })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
            const span = new Date(range.from).toLocaleString('zh-TW', { hour12: false }) + ' ~ ' +
                new Date(range.to).toLocaleString('zh-TW', { hour12: false });
            if (!confirmDelete) {
                const c = result.counts;
                status.textContent = span + '：分鐘彙總 ' + c.minutes + ' 筆、聊天事件 ' + c.events + ' 筆、發言者 ' + c.chatUsers + ' 筆、場次 ' + c.sessions + ' 筆。以下是即將刪除的內容：';
                renderCleanPreview(result.detail);
                el('clean-run').disabled = false;
                return;
            }
            const r = result.removed;
            status.textContent = '已刪除：分鐘彙總 ' + r.minutes + ' 筆、聊天事件 ' + r.events + ' 筆、發言者 ' + r.chatUsers + ' 筆、場次 ' + r.sessions + ' 筆（記憶體剩 ' + result.memoryEvents + ' 筆事件）。';
            el('clean-run').disabled = true;
            refresh();
            window.dispatchEvent(new Event('traffic-cleared'));   // 讓歷史區塊也跟著重讀
        } catch (error) {
            status.textContent = '失敗：' + error.message;
        }
    }

    /** 預覽明細：列出即將刪除的每日彙總、場次、發言最多的帳號與訊息樣本。 */
    function renderCleanPreview(detail) {
        const box = el('clean-preview-data');
        if (!detail) { box.replaceChildren(); return; }
        const nodes = [];
        const title = text => {
            const p = document.createElement('p');
            p.className = 'clean-title';
            p.textContent = text;
            return p;
        };
        const lines = values => {
            const p = document.createElement('p');
            p.className = 'clean-lines';
            p.textContent = values.join('\n');
            return p;
        };
        const localTime = value => new Date(value).toLocaleString('zh-TW', { hour12: false });

        if (detail.days?.length) {
            nodes.push(title('每日彙總（將被刪除）'));
            nodes.push(buildTable([['日期', '進房', '聊天', '取樣分鐘', '平均觀看'],
                ...detail.days.map(day => [day.day, day.joins, day.chats, day.observedMinutes,
                    day.averageViewers === null ? '—' : day.averageViewers.toFixed(1)])]));
        }
        if (detail.sessions?.length) {
            nodes.push(title('場次（' + detail.sessions.length + ' 筆）'));
            nodes.push(lines(detail.sessions.map(session =>
                (session.platform || '?') + ' ' + localTime(session.started) +
                (session.ended ? ' ~ ' + localTime(session.ended) : '（進行中）') +
                ' · 峰值 ' + (session.peak ?? '—') + ' · 聊天 ' + session.chats)));
        }
        if (detail.speakers?.length) {
            nodes.push(title('發言最多的帳號（則數 / 活躍分鐘 → 強度）'));
            nodes.push(lines(detail.speakers.map(speaker => {
                const chats = speaker.chats ?? 0;
                const minutes = speaker.activeMinutes ?? 0;
                return speaker.userId + '：' + chats + ' 則 / ' + minutes + ' 個活躍分鐘（' + (minutes ? (chats / minutes).toFixed(1) : '—') + ' 則/分）';
            })));
        }
        if (detail.samples?.length) {
            // traffic 只記錄發送者與時間、不存訊息內容（隱私與容量），所以這裡不會有文字。
            nodes.push(title('範圍內最早的 5 則訊息（只記錄發送者與時間，不含內容）'));
            nodes.push(lines(detail.samples.map(sample =>
                new Date(sample.time).toLocaleTimeString('zh-TW', { hour12: false }) + ' ' + sample.user +
                (sample.message ? '：' + sample.message : ''))));
        }
        box.replaceChildren(...nodes);
    }

    function setupCleanup() {
        const pad = number => String(number).padStart(2, '0');
        const iso = date => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
        const now = new Date();
        el('clean-day').value = iso(now);
        // 起訖預設「上一個整點 ~ 這個整點」，避免預設值本身就不合法。
        const hour = Math.min(22, now.getHours());
        el('clean-start').value = pad(hour) + ':00';
        el('clean-end').value = pad(hour + 1) + ':00';
        syncCleanPlatforms();
        el('cleanup').addEventListener('toggle', syncCleanPlatforms);
        el('clean-mode').onchange = () => {
            const mode = el('clean-mode').value;
            el('clean-day-label').hidden = mode === 'hours';
            el('clean-slot-label').hidden = mode !== 'slot';
            el('clean-hours-label').hidden = mode !== 'hours';
            el('clean-run').disabled = true;
            el('clean-status').textContent = '';
        };
        el('clean-preview').onclick = () => cleanRequest(false);
        el('clean-run').onclick = () => cleanRequest(true);
    }

    setupCleanup();

    for (const id of ['platform', 'range']) el(id).onchange = () => { selected = null; refresh(); };
    window.addEventListener('resize', () => {
        if (!data) return;
        draw('viewers', ['viewers']);
        draw('arrivals', ['joins', 'chats', 'activeUsers']);
    });
    refresh();
    setInterval(refresh, 5000);
})();
