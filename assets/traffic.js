(async () => {
    await window.TTWI18n.ready;
    const t = (key, params = {}) => window.TTWI18n.t('traffic.' + key, params);
    const el = id => document.getElementById(id);
    const locale = () => window.TTWI18n?.language || 'zh-TW';
    const timezone = () => el('timezone')?.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dateTime = value => new Date(value).toLocaleString(locale(), { timeZone: timezone(), hour12: false });
    const time = value => new Date(value).toLocaleTimeString(locale(), { timeZone: timezone(), hour12: false });
    let data = null;
    let busy = false, rerun = false;
    let selected = null;
    let hovered = null;
    let overview = null, focusWindow = null, focusRevision = 0, selectedRunFrom = null, dateDirty = false;

    const rendered = new Map();
    function changed(key, value) {
        const signature = JSON.stringify(value);
        if (rendered.get(key) === signature) return false;
        rendered.set(key, signature);
        return true;
    }
    function setText(node, value) {
        const text = String(value);
        if (node.textContent !== text) node.textContent = text;
    }
    function syncOptions(select, options) {
        const current = Array.from(select.options, option => [option.value, option.textContent]);
        if (JSON.stringify(current) !== JSON.stringify(options)) {
            select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
        }
    }
    function prepareCanvas(canvas, width, height, ratio) {
        const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.textAlign = 'left'; ctx.setLineDash([]);
        return ctx;
    }
    let pollTimer;
    function pollDelay(range, window, now) {
        return range === 'all' && window && window.to < now - 90000 ? 60000 : 5000;
    }
    function schedulePoll() {
        clearTimeout(pollTimer);
        if (!document.hidden) pollTimer = setTimeout(() => {
            refresh();
        }, pollDelay('all', focusWindow, Date.now()));
    }

    function chartIndex(offset, left, right, count) {
        return Math.max(0, Math.min(count - 1, Math.round((offset - left) / Math.max(1, right - left) * (count - 1))));
    }
    // eslint-disable-next-line no-unused-vars -- 預留取樣段跳轉用，目前未接上
    function sampleRunTarget(rows, current, direction) {
        const starts = rows.flatMap((row, i) => row.viewers != null && (i === 0 || rows[i - 1].viewers == null) ? [row.time] : []);
        return direction > 0 ? starts.find(time => current == null || time > current) ?? null
            : starts.findLast(time => current == null || time < current) ?? null;
    }
    function setAnalysisPending(message) {
        el('analysis-results').hidden=true;
        el('details').hidden=true;
        setText(el('analysis-status'),message);
        for(const button of el('analysis-controls').querySelectorAll('button'))button.disabled=true;
    }
    function chooseWindow(window) {
        dateDirty=false;setText(el('date-draft'),'');
        focusWindow = window; focusRevision++; selected = null; hovered = null;
        setAnalysisPending(t('design.loading',{from:dateTime(window.from),to:dateTime(window.to)}));
        refresh();
    }
    function chooseRun(index) {
        const run=overview?.runs?.[index];
        if(run){selectedRunFrom=run.from;chooseWindow({...run,runFrom:run.from});}
    }
    function adjacentRun(direction) {
        const runs = overview?.runs || [];
        const from = focusWindow?.from;
        return direction > 0 ? runs.findIndex(run => from == null || run.from > from)
            : runs.findLastIndex(run => from == null || run.from < from);
    }
    function boundedWindow(from, duration, start, end) {
        duration = Math.max(60000, Math.min(Math.round(duration/60000)*60000, end-start, 366*86400000));
        from = Math.max(start, Math.min(end-duration, Math.round(from/60000)*60000));
        return {from, to:Math.min(end,from+duration)};
    }
    function moveWindow(factor = 0, zoom = 1) {
        if (!overview || !focusWindow) return;
        const duration=focusWindow.to-focusWindow.from;
        chooseWindow(boundedWindow(focusWindow.from+duration*factor+duration*(1-zoom)/2,
            duration*zoom,overview.since,Math.ceil(overview.now/60000)*60000));
    }
    function zonedInput(timestamp, zone) {
        const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(timestamp);
        const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
        return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
    }
    // 拒絕不存在或重複的夏令時間，避免使用者輸入被默默移動一小時。
    function parseZonedInput(value, zone) {
        if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;
        const wall=Date.parse(value+'Z');if(!Number.isFinite(wall))return null;
        const candidates=new Set();
        for(const shift of [-86400000,0,86400000]) {
            const probe=wall+shift;
            const offset=Date.parse(zonedInput(probe,zone)+'Z')-probe;
            const candidate=wall-offset;
            if(zonedInput(candidate,zone)===value)candidates.add(candidate);
        }
        return candidates.size===1?[...candidates][0]:null;
    }
    let segmentPage=0, segmentSelection=null;
    const segmentPageSize=6;
    function renderSegments(runs) {
        const identity=overview.platform+':'+selectedRunFrom;
        if(identity!==segmentSelection) {
            segmentSelection=identity;
            const index=runs.findIndex(run=>run.from===selectedRunFrom);
            segmentPage=index<0?0:Math.floor((runs.length-1-index)/segmentPageSize);
        }
        const pages=Math.max(1,Math.ceil(runs.length/segmentPageSize));
        segmentPage=Math.max(0,Math.min(pages-1,segmentPage));
        const entries=runs.map((run,index)=>({run,index})).reverse().slice(segmentPage*segmentPageSize,(segmentPage+1)*segmentPageSize);
        setText(el('segments-page'),t('segments.page',{page:segmentPage+1,pages,count:runs.length}));
        el('segments-newer').disabled=segmentPage===0;
        el('segments-older').disabled=segmentPage===pages-1;
        if(!changed('segments',[overview.platform,entries,selectedRunFrom,locale(),timezone()]))return;
        const cards=entries.map(({run,index})=>{
            const button=document.createElement('button');button.type='button';button.className='segment-card';
            button.setAttribute('aria-pressed',String(run.from===selectedRunFrom));
            const date=document.createElement('strong');date.textContent=new Date(run.from).toLocaleDateString(locale(),{timeZone:timezone(),year:'numeric',month:'numeric',day:'numeric'});
            const period=document.createElement('span');period.textContent=dateTime(run.from)+' – '+dateTime(run.to);
            const minutes=document.createElement('span');minutes.textContent=t('segments.minutes',{count:run.minutes});
            button.append(date,period,minutes);button.onclick=()=>chooseRun(index);return button;
        });
        if(!cards.length){const message=document.createElement('p');message.textContent=t('noData');cards.push(message);}
        el('segment-cards').replaceChildren(...cards);
    }
    function drawOverview() {
        if(!overview)return;
        renderSegments(overview.runs || []);
        setText(el('date-zone'),t('design.zone',{zone:timezone()}));
    }

    function renderCharts() {
        if (!data) return;
        const empty=!data.buckets.some(row=>row.viewers!=null || row.joins>0 || row.chats>0);
        el('chart-empty').hidden=!empty;
        el('detail-charts').hidden=empty;
        el('empty-prev').disabled=!overview || adjacentRun(-1)<0;
        el('empty-next').disabled=!overview || adjacentRun(1)<0;
        draw('viewers', ['viewers', 'peak']);
        draw('arrivals', ['joins', 'chats', 'activeUsers']);
        const row = data.buckets.find(row => row.time === (selected ?? hovered));
        setText(el('chart-readout'), row ? t('chart.readout', {
            state: t(selected === null ? 'chart.hovered' : 'chart.pinned'),
            from: dateTime(Math.max(data.since,row.time)), to: dateTime(Math.min(data.chartUntil ?? data.now, row.time + data.bucketMs)),
            viewers: row.viewers == null ? t('noData') : Number(row.viewers.toFixed(2)),
            joins: row.joins, chats: row.chats, active: row.activeUsers
        }) : t('chart.hint'));
        el('chart-clear').disabled = selected === null;
        drawOverview();
    }
    function selectBucket(value) {
        if (!data) return;
        selected = value; hovered = null;
        renderCharts(); renderDetails();
    }

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
        const spanMs = (data?.chartUntil ?? data?.now ?? value) - (data?.since ?? value);
        const options = {timeZone: timezone(), hour12: false};
        if (spanMs >= 86400000) Object.assign(options, {month:'numeric', day:'numeric'});
        if (spanMs < 3 * 86400000) Object.assign(options, {hour:'2-digit', minute:'2-digit'});
        return new Intl.DateTimeFormat(locale(), options).format(value);
    }

    /** 進房明細：未選取桶時顯示最近 200 筆，選取時只顯示落在該桶範圍的事件。 */
    function renderDetails() {
        const bucketMs = data.bucketMs ?? 60000;
        if (!changed('details', [data.platform, data.since, data.chartUntil, data.events, bucketMs, selected, locale(), timezone()])) return;
        const rows = data.events
            .filter(event=>event.time>=data.since && event.time<(data.chartUntil??data.now))
            .filter(event => selected === null || (event.time >= selected && event.time < selected + bucketMs))
            .slice()
            .reverse();

        setText(el('detail-title'), selected === null
            ? t('detail.recent')
            : t('detail.selected', {time: dateTime(selected)}));

        if (!rows.length) {
            const note = document.createElement('p');
            note.className = 'text-gray-500 text-xs';
            note.textContent = selected === null
                ? t('detail.empty')
                : t('detail.emptyInterval');
            el('details').replaceChildren(note);
            return;
        }

        el('details').replaceChildren(buildTable([
            [t('time'), t('userId'), t('source'), t('evidence')],
            ...rows.map(event => [
                time(event.time),
                event.user || t('unspecified'),
                event.platform + ' / ' + event.transport,
                event.evidence === 'native' ? t('native') : t('declared')
            ])
        ]));
    }

        /** 共用桶時間繪製折線；缺值斷線，短線段與孤立樣本仍須清楚可見。 */
    let detailDrag=null, suppressChartClick=false;
    function draw(id, keys) {
        const canvas = el(id);
        const width = canvas.clientWidth;
        const height = canvas.clientHeight || 200;
        const ratio = window.devicePixelRatio || 1;
        const rate = id === 'arrivals' && el('chart-units')?.value === 'rate';
        const points = data.buckets.map(row => [row.time, ...keys.map(key => row[key]), row.viewers != null, row.joins > 0, row.chats > 0]);
        if (!changed(id, [data.platform, points, data.bucketMs, Math.floor(((data.chartUntil ?? data.now) - data.since)/86400000), width, height, ratio, rate, selected ?? hovered, locale(), timezone()])) return;
        const ctx = prepareCanvas(canvas, width, height, ratio);
        ctx.font = '11px sans-serif';

        const rows = data.buckets.map(row=>{
            const minutes=Math.max(1,(Math.min(data.chartUntil??data.now,row.time+data.bucketMs)-Math.max(data.since,row.time))/60000);
            return {...row, joins:rate?row.joins/minutes:row.joins,chats:rate?row.chats/minutes:row.chats,activeUsers:rate?null:row.activeUsers};
        });
        // 上下保留空間，避免 0／1 人的線與外框重疊。
        const max = Math.max(1, ...rows.flatMap(row => keys.map(key => row[key] ?? 0))) * 1.2;
        const plot = { left: 38, right: width - 10, top: 20, bottom: height - 30 };
        const baseline = plot.bottom - 6;

        // 圖表區間：鋪一層與卡片不同的底色再加外框，讓繪圖範圍看得出來。
        ctx.fillStyle = '#111827';
        ctx.fillRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
        ctx.strokeStyle = '#4b5563';
        ctx.lineWidth = 1;
        ctx.strokeRect(plot.left + 0.5, plot.top + 0.5, plot.right - plot.left - 1, plot.bottom - plot.top - 1);

        // 水平格線與左側刻度（0／50%／100%）。
        for (const level of [0, 0.5, 1]) {
            const y = baseline - level * (baseline - plot.top);
            ctx.strokeStyle = level === 0 ? '#4b5563' : '#374151';
            ctx.beginPath();
            ctx.moveTo(plot.left, y);
            ctx.lineTo(plot.right, y);
            ctx.stroke();
            ctx.fillStyle = '#9ca3af';
            ctx.fillText(String(Number((max * level).toFixed(1))), 2, y + 4);
        }

        const pointX = i => rows.length === 1 ? (plot.left + plot.right) / 2 : plot.left + i * (plot.right - plot.left) / Math.max(1, rows.length - 1);
        const pointY = value => baseline - value / max * (baseline - plot.top);

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
            ctx.lineWidth = 2;
            ctx.beginPath();
            let open = false;
            rows.forEach((row, i) => {
                if (row[key] == null) { open = false; return; }
                const x = pointX(i);
                const y = pointY(row[key]);
                // 單一桶也涵蓋完整時間區間，零值須呈現可見的水平線。
                if (rows.length === 1) { ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); }
                else if (open) ctx.lineTo(x, y); else ctx.moveTo(x, y);
                open = true;
            });
            ctx.stroke();
            // 每段的端點加上標記：只有一個樣本時 moveTo 不會畫出任何像素。
            ctx.fillStyle = ctx.strokeStyle;
            rows.forEach((row, i) => {
                if (row[key] == null) return;
                if (i > 0 && rows[i - 1][key] != null && i + 1 < rows.length && rows[i + 1][key] != null) return;
                ctx.beginPath();
                ctx.arc(pointX(i), pointY(row[key]), 3, 0, Math.PI * 2);
                ctx.fill();
            });
        });

        // 時間刻度：均勻取 5 個位置，格式隨桶寬改變。
        ctx.fillStyle = '#9ca3af';
        const ticks = rows.length <= 5
            ? rows.map((_, i) => i)
            : [0, 0.25, 0.5, 0.75, 1].map(fraction => Math.round(fraction * (rows.length - 1)));
        for (const i of [...new Set(ticks)]) {
            ctx.fillText(bucketLabel(Math.max(data.since ?? rows[i].time,rows[i].time)), Math.max(2, Math.min(width - 66, pointX(i))), height - 8);
        }

        const active = rows.findIndex(row => row.time === (selected ?? hovered));
        if (active >= 0) {
            ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(pointX(active), plot.top); ctx.lineTo(pointX(active), plot.bottom); ctx.stroke(); ctx.setLineDash([]);
        }
        canvas.setAttribute('aria-label', t(id === 'viewers' ? 'chart.viewersLabel' : 'chart.arrivalsLabel'));
        canvas.onpointermove = event => {
            if (detailDrag) { detailDrag.end=event.clientX; return; }
            if (selected !== null || !rows.length) return;
            const rect = canvas.getBoundingClientRect();
            const i = chartIndex(event.clientX - rect.left, plot.left, plot.right, rows.length);
            if (hovered !== rows[i].time) { hovered = rows[i].time; renderCharts(); }
        };
        canvas.onpointerleave = () => { if (selected === null) { hovered = null; renderCharts(); } };
        canvas.onclick = event => {
            if(suppressChartClick){suppressChartClick=false;return;}
            if (!rows.length) return;
            const rect = canvas.getBoundingClientRect();
            selectBucket(rows[chartIndex(event.clientX - rect.left, plot.left, plot.right, rows.length)].time);
        };
        canvas.onpointerdown=event=>{
            if(event.button!==0 || !focusWindow)return;
            suppressChartClick=false;
            detailDrag={start:event.clientX,end:event.clientX,window:{...focusWindow}};
            canvas.setPointerCapture(event.pointerId);
        };
        canvas.onpointercancel=()=>{detailDrag=null;};
        canvas.onpointerup=event=>{
            if(!detailDrag)return;
            const drag=detailDrag;detailDrag=null;
            if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
            const dx=event.clientX-drag.start;
            if(Math.abs(dx)<5)return;
            suppressChartClick=true;
            const duration=drag.window.to-drag.window.from;
            chooseWindow(boundedWindow(drag.window.from-dx/(plot.right-plot.left)*duration,duration,overview.since,Math.ceil(overview.now/60000)*60000));
        };
        canvas.onkeydown = event => {
            if (!['ArrowLeft','ArrowRight','Home','End','Escape'].includes(event.key) || !rows.length) return;
            event.preventDefault();
            if (event.key === 'Escape') { selectBucket(null); return; }
            const current = rows.findIndex(row => row.time === (selected ?? hovered));
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
                : current < 0 ? (event.key === 'ArrowLeft' ? rows.length - 1 : 0)
                : Math.max(0, Math.min(rows.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)));
            selectBucket(rows[next].time);
        };
    }

    /** 抓取即時視窗並更新狀態列、卡片與圖表。 */
    async function refresh() {
        clearTimeout(pollTimer);
        if (document.hidden) return;
        if (detailDrag) {schedulePoll();return;}
        if (busy) { rerun = true; return; }
        busy = true;
        const requestedPlatform = el('platform').value, requestedRange = 'all';
        const revision = focusRevision;
        try {
            const res = await fetch(
                '/api/traffic?platform=' + encodeURIComponent(requestedPlatform) + '&range=' + requestedRange,
                { cache: 'no-store' }
            );
            if (!res.ok) throw Error(t('readError'));
            const result = await res.json();
            if (document.hidden) return;
            if (requestedPlatform !== el('platform').value) { rerun = true; return; }
            if (revision !== focusRevision) { rerun = true; return; }

            let detail = result;
            if (requestedRange === 'all') {
                if (!Array.isArray(result.runs) || result.buckets.some(row=>row.observedMinutes == null)) throw Error(t('overview.restart'));
                overview = result;
                const runs = result.runs || [];
                if (!focusWindow) {
                    const latest = runs.at(-1);
                    focusWindow = latest ? {...latest, runFrom:latest.from} : null;
                    selectedRunFrom=latest?.from ?? null;
                } else if (focusWindow.runFrom != null && runs.some(run=>run.from===focusWindow.runFrom)) {
                    focusWindow = {...runs.find(run => run.from === focusWindow.runFrom), runFrom:focusWindow.runFrom};
                }
                if (focusWindow) {
                    const response = await fetch('/api/traffic?platform=' + encodeURIComponent(result.platform) + '&from=' + focusWindow.from + '&to=' + focusWindow.to, {cache:'no-store'});
                    if (!response.ok) throw Error(t('readError'));
                    detail = await response.json();
                    if (revision !== focusRevision || requestedPlatform !== el('platform').value) { rerun = true; return; }
                    // 舊服務未重啟時不可把近 30 分鐘誤當成歷史細節。
                    if (detail.since !== focusWindow.from || detail.chartUntil !== Math.min(focusWindow.to,detail.now) || !detail.chartSummary) throw Error(t('overview.restart'));
                }
            } else overview = null;

            data = detail;
            const summary = data.chartSummary;
            let windowText = requestedRange === 'all' && focusWindow && summary ? t('overview.summary', {
                from:dateTime(data.since), to:dateTime(data.chartUntil),
                average:summary.average == null ? '—' : summary.average.toFixed(2),
                peak:summary.peak == null ? '—' : summary.peak.toFixed(2), samples:summary.samples, minutes:data.bucketMs/60000
            }) : requestedRange === 'all' ? t('noData') : '';
            const previous = result.runs?.findLast(run => run.to < data.since);
            if (previous && requestedRange === 'all') windowText += ' ' + t('overview.gap', {hours:((data.since-previous.to)/3600000).toFixed(1)});

            setText(el('chart-window'), windowText);
            el('analysis-results').dataset.from=String(data.since);
            el('analysis-results').dataset.to=String(data.chartUntil);
            el('analysis-results').hidden=false;
            el('details').hidden=false;
            setText(el('analysis-status'),'');
            for(const button of el('analysis-controls').querySelectorAll('button'))button.disabled=!focusWindow;
            el('window-reset').disabled=!overview?.runs?.some(run=>run.from===selectedRunFrom);
            if(focusWindow && !dateDirty) {
                el('window-from').value=zonedInput(data.since,timezone());
                el('window-to').value=zonedInput(data.chartUntil,timezone());
            }
            syncOptions(el('platform'), data.platforms.map(platform => [platform, platform]));
            el('platform').value = data.platform || '';

            const diagnostics = data.diagnostics ?? {};
            const ago = value => value == null ? t('none') : t('secondsAgo', {seconds: Math.round((data.now - value) / 1000)});

            // 每觀眾訊息量（則/分）：總訊息 ÷ 區間分鐘 ÷ 同區間的平均同時觀看。
            const rangeMin = Math.max(1, ((data.chartUntil ?? data.now) - data.since) / 60000);
            const chats = data.buckets.reduce((n, bucket) => n + bucket.chats, 0);
            const viewerSamples = data.buckets.filter(bucket => bucket.viewers !== null).map(bucket => bucket.viewers);
            const observedMinutes = data.buckets.reduce((n,row)=>n+(row.observedMinutes??0),0);
            const avgViewers = summary?.average ?? (observedMinutes ? data.buckets.reduce((n,row)=>n+(row.viewers??0)*(row.observedMinutes??0),0)/observedMinutes : viewerSamples.length ? viewerSamples.reduce((a,b)=>a+b,0)/viewerSamples.length : null);
            setText(el('chart-quality'), t('window.quality',{observed:observedMinutes, missing:Math.max(0,Math.ceil(rangeMin)-observedMinutes), coverage:(100*observedMinutes/Math.max(1,Math.ceil(rangeMin))).toFixed(1)}));
            const perViewerMsg = avgViewers ? (chats / rangeMin) / avgViewers : null;

            // 過濾攔截率：被擋訊息 ÷ 總訊息。廣告帳戶比例：被廣告規則擋過的帳號 ÷ 活躍發言人數。
            const blockedChats = data.buckets.reduce((n, bucket) => n + (bucket.blocked ?? 0), 0);
            const blockedRatio = chats ? blockedChats / chats : null;
            const adRatio = data.activeUsers ? (data.adUsers ?? 0) / data.activeUsers : null;

            setText(el('status'), data.platform
                ? t('status.updated', {time: time(data.now), state: data.currentViewers === null ? t('status.stale') : t('status.viewers', {count:data.currentViewers, ago:ago(data.lastViewerAt)})})
                : t('status.empty'));
            setText(el('diagnostics'), data.platform ? t('diagnostics', {
                observed:diagnostics.observedBuckets ?? 0, total:diagnostics.totalBuckets ?? 0,
                native:ago(diagnostics.lastNativeViewerAt), backup:ago(diagnostics.lastDeclaredViewerAt),
                samples:diagnostics.viewerSamples ?? 0, events:diagnostics.memoryEvents ?? 0,
                blocked:blockedChats, chats, ads:data.adUsers ?? 0, active:data.activeUsers ?? 0
            }) : '');
            const observed = data.buckets.filter(bucket => bucket.viewers !== null);
            setText(el('viewer-summary'), observed.length ? t('summary', {
                count:observed.length, minutes:data.bucketMs / 60000,
                from:dateTime(observed[0].time), to:dateTime(observed.at(-1).time)
            }) : t('summary.empty'));

            const cards = [
                [t('averageBuckets'), avgViewers === null ? '—' : t('people', {count:avgViewers.toFixed(2)})],
                [t('joinsInRange'), data.buckets.reduce((n, bucket) => n + bucket.joins, 0)],
                [t('activeUsers'), t('people', {count:data.activeUsers ?? 0})],
                // 每觀眾訊息量：分子分母都是「同一區間」，不會有累積 vs 瞬時的基準不一致問題。
                [t('perViewer'), perViewerMsg === null ? '—' : t('messagesPerMinute', {count:perViewerMsg.toFixed(2)})],
                [t('blockedRatio'), blockedRatio === null ? '—' : (blockedRatio * 100).toFixed(1) + '%'],
                [t('adRatio'), adRatio === null ? '—' : (adRatio * 100).toFixed(1) + '%']
            ];
            cards.forEach(([name, value], index) => {
                const container = el('cards');
                let card = container.children[index];
                if (!card) {
                    card = document.createElement('div'); card.className = 'card';
                    const label = document.createElement('div'); label.className = 'label';
                    const amount = document.createElement('div'); amount.className = 'value';
                    card.append(label, amount); container.append(card);
                }
                setText(card.children[0], name);
                setText(card.children[1], value);
            });

            if (!data.buckets.some(row => row.time === selected)) selected = null;
            renderCharts();
            renderDetails();
        } catch (error) {
            setText(el('status'), t('updateError'));
            if(revision!==focusRevision){rerun=true;return;}
            setAnalysisPending(error.message === t('overview.restart') ? error.message : t('design.failed'));
        } finally {
            busy = false;
            if (rerun) { rerun = false; refresh(); } else schedulePoll();
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
            const to = Math.floor(Date.now()/60000)*60000;
            return { from: to - hours * 3600000, to };
        }

        const value = el('clean-day').value;
        if (!value) return null;
        const [year, month, day] = value.split('-').map(Number);
        if (mode === 'day') {
            const from = new Date(year, month - 1, day).getTime();
            return { from, to: new Date(year, month - 1, day + 1).getTime() };
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

    let cleanSelection = null, cleanGeneration = 0, lastCleanPreview = null;
    function invalidateClean() {
        cleanGeneration++; cleanSelection = null; lastCleanPreview = null;
        el('clean-run').disabled = true; el('clean-preview-data').replaceChildren();
    }
    async function cleanRequest(confirmDelete, page = 1, paging = false) {
        const status = el('clean-status');
        const generation = ++cleanGeneration;
        const range = (confirmDelete || paging) ? cleanSelection : cleanRange();
        if(confirmDelete && !cleanSelection) return;
        const selection = cleanSelection && (confirmDelete || paging) ? cleanSelection : {...range, platform:el('clean-platform').value};
        el('clean-run').disabled = true;
        if (!range) { status.textContent = t('clean.needDate'); return; }
        if (range.to <= range.from) { status.textContent = t('clean.invalidEnd'); return; }
        status.textContent = confirmDelete ? t('clean.deleting') : t('clean.loading');
        try {
            // 彙總時區固定在本次預覽；清理起訖由本機日期輸入換算。
            const timezone = selection.timezone || el('timezone')?.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
            selection.timezone = timezone;
            const response = await fetch('/api/traffic/clear?timezone=' + encodeURIComponent(timezone), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform: selection.platform, from: selection.from, to: selection.to, confirm: confirmDelete, page })
            });
            const result = await response.json();
            if(generation !== cleanGeneration) return;
            if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
            const span = new Date(range.from).toLocaleString(locale(), { hour12: false }) + ' ~ ' +
                new Date(range.to).toLocaleString(locale(), { hour12: false });
            if (!confirmDelete) {
                const c = result.counts;
                status.textContent = t('clean.previewCounts', {span, ...c});
                cleanSelection = selection;
                renderCleanPreview(result.detail);
                el('clean-run').disabled = false;
                return;
            }
            const r = result.removed;
            status.textContent = t('clean.removed', {...r, memory:result.memoryEvents});
            invalidateClean();
            refresh();
            window.dispatchEvent(new Event('traffic-cleared'));   // 讓歷史區塊也跟著重讀
        } catch (error) {
            if(generation === cleanGeneration) { invalidateClean(); status.textContent = t('clean.failed') + error.message; }
        }
    }

    /** 預覽明細：列出即將刪除的每日彙總、場次、發言最多的帳號與訊息樣本。 */
    function renderCleanPreview(detail) {
        lastCleanPreview = detail;
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
        const localTime = value => new Date(value).toLocaleString(locale(), { hour12: false });

        if (detail.days?.length) {
            nodes.push(title(t('clean.daily')));
            nodes.push(buildTable([[t('date'), t('joins'), t('chats'), t('sampleMinutes'), t('averageViewers')],
                ...detail.days.map(day => [day.day, day.joins, day.chats, day.observedMinutes,
                    day.averageViewers === null ? '—' : day.averageViewers.toFixed(1)])]));
        }
        if (detail.sessions?.length) {
            nodes.push(title(t('clean.sessionCount', {count:detail.sessions.length})));
            nodes.push(lines(detail.sessions.map(session =>
                (session.platform || '?') + ' ' + localTime(session.started) +
                (session.ended ? ' ~ ' + localTime(session.ended) : t('clean.ongoing')) +
                t('clean.sessionStats', {peak:session.peak ?? '—', chats:session.chats}))));
        }
        if (detail.speakers?.length) {
            nodes.push(title(t('clean.speakers')));
            const table=document.createElement('table');table.className='clean-events clean-speakers';
            const headings=[t('platform'),t('accountId'),t('messages'),t('activeMinutes'),t('perActiveMinute')];
            const caption=document.createElement('caption');caption.className='clean-visually-hidden';caption.textContent=t('clean.speakerStats');table.append(caption);
            const head=document.createElement('thead'),header=document.createElement('tr');
            for(const label of headings){const th=document.createElement('th');th.scope='col';th.textContent=label;header.append(th);}head.append(header);table.append(head);
            const body=document.createElement('tbody');
            for(const speaker of detail.speakers){
                const chats=speaker.chats??0,minutes=speaker.activeMinutes??0;
                const row=document.createElement('tr');
                [speaker.platform,speaker.userId,chats,minutes,minutes?(chats/minutes).toFixed(1):'—'].forEach((value,index)=>{
                    const td=document.createElement('td');td.dataset.label=headings[index];
                    const content=document.createElement('span');content.textContent=value;td.append(content);row.append(td);
                });body.append(row);
            }
            table.append(body);nodes.push(table);
        }
        if (detail.samples?.length) {
            // 顯示已保存的資料；未保存的訊息內容不假造補齊。
            nodes.push(title(t('clean.raw')));
            const table=document.createElement('table');table.className='clean-events';
            const caption=document.createElement('caption');caption.textContent=t('clean.rawDetail');caption.className='clean-visually-hidden';table.append(caption);
            const headings=[t('time'),t('transport'),t('event'),t('userId'),t('content')];
            const head=document.createElement('thead'),header=document.createElement('tr');
            for(const label of headings){const th=document.createElement('th');th.scope='col';th.textContent=label;header.append(th);}head.append(header);table.append(head);
            const body=document.createElement('tbody');
            const kinds={viewers:t('viewerCountLabel'),metrics:t('metricsLabel'),join:t('joinEvent'),chat:t('chatEvent'),filter:t('filterEvent')};
            for(const sample of detail.samples){
                const row=document.createElement('tr');
                const value=sample.viewers!=null?t('viewerCount', {count:sample.viewers}):sample.message || (sample.kind==='metrics'?t('clean.metricsHidden'):sample.kind==='join'?t('joined'):t('unsaved'));
                const values=[localTime(sample.time),sample.platform+(sample.transport?' / '+sample.transport:''),kinds[sample.kind]||sample.kind||t('unknownEvent'),sample.user||t('notApplicable'),value];
                values.forEach((text,index)=>{const td=document.createElement('td');td.dataset.label=headings[index];
                    if(index===2){const badge=document.createElement('span');badge.className='clean-event-kind';badge.textContent=text;td.append(badge);}else td.textContent=text;
                    row.append(td);
                });body.append(row);
            }
            table.append(body);nodes.push(table);
        }
        if(detail.pagination) {
            const {page,pageSize,totals}=detail.pagination;
            const pages=Math.max(1,...Object.values(totals).map(total=>Math.ceil(total/pageSize)));
            const names={days:t('daily'),sessions:t('sessions'),speakers:t('accounts'),samples:t('rawEvents')};
            const overview=document.createElement('div');overview.className='clean-preview-summary';
            for(const [key,total] of Object.entries(totals)){
                const card=document.createElement('div'),label=document.createElement('span'),count=document.createElement('strong'),range=document.createElement('small');
                label.textContent=names[key];count.textContent=t('clean.total', {count:total});
                range.textContent=t('clean.pageRange', {range:total>(page-1)*pageSize?((page-1)*pageSize+1)+'–'+Math.min(total,page*pageSize):'0'});
                card.append(label,count,range);overview.append(card);
            }
            // 僅在預覽上方提供分頁；頁碼與操作分組。
            const pagination = () => {
                const controls=document.createElement('nav');
                controls.className='clean-pagination';controls.setAttribute('aria-label',t('clean.pagination'));
                const info=document.createElement('div');info.className='clean-page-info';
                const current=document.createElement('strong');current.textContent=t('clean.page', {page,pages});
                const size=document.createElement('span');size.textContent=t('clean.pageSize', {count:pageSize});info.append(current,size);
                const actions=document.createElement('div');actions.className='clean-page-actions';
                for(const [label,target,disabled] of [[t('previous'),page-1,page<=1],[t('next'),page+1,page>=pages]]) {
                    const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=disabled;
                    button.onclick=async()=>{
                        box.setAttribute('aria-busy','true');
                        box.querySelectorAll('.clean-pagination button').forEach(b=>b.disabled=true);
                        await cleanRequest(false,target,true);
                        box.removeAttribute('aria-busy');
                        const top=box.querySelector('.clean-pagination');
                        if(top){top.tabIndex=-1;top.focus({preventScroll:true});top.scrollIntoView({block:'nearest',behavior:'auto'});}
                    };
                    actions.append(button);
                }
                controls.append(info,actions);return controls;
            };
            nodes.unshift(overview,pagination());
            nodes.push(title(t('clean.retention')));
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
            setText(el('clean-status'), '');
        };
        for(const id of ['clean-mode','clean-day','clean-start','clean-end','clean-hours','clean-platform','timezone']) el(id)?.addEventListener('input',invalidateClean);
        el('clean-preview').onclick = () => cleanRequest(false);
        el('clean-run').onclick = () => cleanRequest(true);
    }

    document.addEventListener('languagechange', () => {
        refresh();
        if (lastCleanPreview) renderCleanPreview(lastCleanPreview);
        setText(el('clean-status'), '');
    });
    setupCleanup();

    el('platform').onchange=()=>{
        selected=null;hovered=null;focusWindow=null;overview=null;selectedRunFrom=null;focusRevision++;
        setAnalysisPending(t('overview.loading'));el('segment-cards').replaceChildren();refresh();
    };
    el('timezone').addEventListener('change',()=>{
        dateDirty=false;setText(el('date-draft'),'');
        el('window-from').value='';el('window-to').value='';
        setText(el('date-zone'),t('design.zone',{zone:timezone()}));refresh();
    });
    el('chart-clear').onclick=()=>selectBucket(null);
    el('segments-newer').onclick=()=>{segmentPage--;drawOverview();};
    el('segments-older').onclick=()=>{segmentPage++;drawOverview();};
    el('empty-prev').onclick=()=>chooseRun(adjacentRun(-1));
    el('empty-next').onclick=()=>chooseRun(adjacentRun(1));
    el('chart-units').onchange=()=>renderCharts();
    el('window-left').onclick=()=>moveWindow(-.5);
    el('window-right').onclick=()=>moveWindow(.5);
    el('window-in').onclick=()=>moveWindow(0,.5);
    el('window-out').onclick=()=>moveWindow(0,2);
    el('window-reset').onclick=()=>chooseRun(overview?.runs?.findIndex(run=>run.from===selectedRunFrom));
    el('chart-latest').onclick=()=>chooseRun((overview?.runs?.length || 0)-1);
    for(const id of ['window-from','window-to'])el(id).oninput=()=>{dateDirty=true;setText(el('date-draft'),t('design.draft'));};
    el('date-form').onsubmit=event=>{
        event.preventDefault();
        const from=parseZonedInput(el('window-from').value,timezone());
        const to=parseZonedInput(el('window-to').value,timezone());
        if(from==null || to==null || from<0 || to<=from || to-from>366*86400000 || to>Date.now()) {
            setText(el('date-error'),t('design.invalid'));return;
        }
        setText(el('date-error'),'');chooseWindow({from,to});
    };
    window.addEventListener('resize', () => {
        if (!data) return;
        const empty=!data.buckets.some(row=>row.viewers!=null || row.joins>0 || row.chats>0);
        el('chart-empty').hidden=!empty;
        el('detail-charts').hidden=empty;
        el('empty-prev').disabled=!overview || adjacentRun(-1)<0;
        el('empty-next').disabled=!overview || adjacentRun(1)<0;
        draw('viewers', ['viewers', 'peak']);
        draw('arrivals', ['joins', 'chats', 'activeUsers']);
        drawOverview();
    });
    refresh();
    document.addEventListener('visibilitychange', () => {
        clearTimeout(pollTimer);
        if (!document.hidden) refresh();
    });
})();
