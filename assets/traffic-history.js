(async () => {
    await window.TTWI18n.ready;
    const t = (key, params = {}) => window.TTWI18n.t('traffic.' + key, params);
    const el = id => document.getElementById(id);
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekday = index => new Intl.DateTimeFormat(window.TTWI18n.language, {weekday:'short', timeZone:'UTC'}).format(Date.UTC(2026, 0, 5 + index));
    const slotKeyLabel = key => {
        const [day, hour] = key.split(' ');
        return `${weekday(WEEKDAYS.indexOf(day))} ${hour}:00`;
    };
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

    const COMPARE_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c'];
    const compareEscape = value => String(value).replace(/[<>&"]/g, char => (
        { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char]
    ));
    function niceStep(value) {
        if (!Number.isFinite(value) || value <= 0) return 1;
        const power = Math.pow(10, Math.floor(Math.log10(value)));
        const normalized = value / power;
        const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
        return factor * power;
    }
    const tickText = (value, step) => step >= 1 ? String(Math.round(value)) : String(Number(value.toFixed(3)));
    const startTypeLabel = type => type === 'exact' ? t('ranking.startType.exact')
        : type === 'late' ? t('ranking.startType.late')
            : type === 'approx' ? t('ranking.startType.approx')
                : t('ranking.startType.estimated');

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

    /** 場次開場比較：以開播後 0–120 分鐘對齊，畫各場曲線與跨場中位數。 */
    function renderComparison(comparison) {
        const chart = el('compare-chart'), table = el('compare-table');
        const empty = el('compare-empty'), note = el('compare-note'), context = el('compare-context');
        const highlight = el('compare-highlight');
        const sessions = comparison?.sessions ?? [];
        if (!sessions.length) {
            chart.hidden = true;
            table.hidden = true;
            note.hidden = true;
            empty.hidden = false;
            context.textContent = '';
            highlight.textContent = '';
            return;
        }
        empty.hidden = true;
        const bucketMs = comparison.bucketMs ?? 300000;
        const windowMinutes = comparison.windowMinutes ?? 120;
        context.textContent = t('compare.context', {
            days: comparison.days,
            scope: comparison.scope === 'own' ? t('compare.scopeOwn') : t('compare.scopeAll'),
            limit: comparison.limit,
            window: windowMinutes
        });
        note.hidden = sessions.length > 1;

        const slots = comparison.slots ?? 0;
        const allPoints = [...sessions.flatMap(session => session.points ?? []), ...(comparison.median ?? [])]
            .filter(value => value != null);
        const maxValue = Math.max(1, ...allPoints);
        const step = niceStep(maxValue / 4);
        const top = Math.max(step, Math.ceil(maxValue / step) * step);
        const ticks = [];
        for (let i = 0; i * step <= top + step * 1e-9; i++) ticks.push(i * step);
        const width = 720, height = 270, left = 38, right = 12, topPad = 16, bottom = 38;
        const plotW = width - left - right, plotH = height - topPad - bottom;
        const x = index => slots <= 1 ? left + plotW / 2 : left + index * plotW / (slots - 1);
        const y = value => topPad + (1 - value / top) * plotH;
        const drawPath = points => {
            let d = '', open = false;
            points.forEach((value, index) => {
                if (value == null) { open = false; return; }
                d += (open ? 'L' : 'M') + x(index).toFixed(1) + ' ' + y(value).toFixed(1) + ' ';
                open = true;
            });
            return d.trim();
        };

        if (!allPoints.length) {
            chart.innerHTML = `<p class="text-gray-500 text-xs">${compareEscape(t('compare.noSamples'))}</p>`;
        } else {
            const grid = ticks.map(value => {
                const py = y(value).toFixed(1);
                return `<line x1="${left}" y1="${py}" x2="${width - right}" y2="${py}" stroke="${value === 0 ? '#4b5563' : '#374151'}" stroke-width="1"/>`
                    + `<text x="2" y="${Number(py) + 4}" fill="#9ca3af" font-size="11">${compareEscape(tickText(value, step))}</text>`;
            }).join('');
            const marks = [];
            for (let minute = 0; minute <= windowMinutes; minute += 30) {
                const index = Math.min(slots - 1, Math.round(minute / (bucketMs / 60000)));
                marks.push(`<text x="${x(index).toFixed(1)}" y="${height - 18}" fill="#9ca3af" font-size="11" text-anchor="middle">${minute}</text>`);
            }
            const axisTitle = `<text x="${left + plotW / 2}" y="${height - 4}" fill="#6b7280" font-size="10" text-anchor="middle">${compareEscape(t('compare.axis'))}</text>`;
            const lines = sessions.map((session, index) => (
                `<path d="${drawPath(session.points ?? [])}" fill="none" stroke="${COMPARE_COLORS[index % COMPARE_COLORS.length]}" stroke-width="1.5" opacity=".55"/>`
            )).join('');
            const median = sessions.length >= 3 && comparison.median?.some(value => value != null)
                ? `<path d="${drawPath(comparison.median)}" fill="none" stroke="#e5e7eb" stroke-width="3"/>` : '';
            let highest = null;
            const peakDots = sessions.map((session, index) => {
                let bestIndex = -1, bestValue = null;
                (session.points ?? []).forEach((value, position) => {
                    if (value != null && (bestValue === null || value > bestValue)) {
                        bestValue = value;
                        bestIndex = position;
                    }
                });
                if (bestIndex < 0) return '';
                if (highest === null || bestValue > highest.value) {
                    highest = { value: bestValue, session, index: bestIndex };
                }
                const title = `${format(bestValue)} · ${session.date} · `
                    + t('compare.elapsed', { minutes: Math.round(bestIndex * (bucketMs / 60000)) });
                return `<circle cx="${x(bestIndex).toFixed(1)}" cy="${y(bestValue).toFixed(1)}" r="3.5"`
                    + ` fill="${COMPARE_COLORS[index % COMPARE_COLORS.length]}" stroke="#111827" stroke-width="1.5">`
                    + `<title>${compareEscape(title)}</title></circle>`;
            }).join('');
            const legend = [
                median ? `<span><i style="background:#e5e7eb"></i>${compareEscape(t('compare.median'))}</span>` : '',
                ...sessions.map((session, index) => (
                    `<span><i style="background:${COMPARE_COLORS[index % COMPARE_COLORS.length]}"></i>${compareEscape(session.date)} ${compareEscape(session.localTime)}</span>`
                ))
            ].join('');
            chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${compareEscape(t('compare.title'))}">`
                + `<rect x="${left}" y="${topPad}" width="${plotW}" height="${plotH}" fill="#111827" stroke="#4b5563"/>`
                + grid + marks + axisTitle + lines + median + peakDots
                + `<line class="compare-cursor" x1="${left}" y1="${topPad}" x2="${left}" y2="${topPad + plotH}"`
                + ` stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3 3" opacity=".65" visibility="hidden"/>`
                + `</svg><div class="compare-legend">${legend}</div><div class="compare-tip" hidden></div>`;
            highlight.textContent = highest ? t('compare.highest', {
                value: format(highest.value),
                date: highest.session.date,
                minutes: Math.round(highest.index * (bucketMs / 60000))
            }) : '';
        }
        if (!allPoints.length) highlight.textContent = '';
        chart.hidden = false;

        if (allPoints.length) {
            const svg = chart.querySelector('svg');
            const tip = chart.querySelector('.compare-tip');
            const cursor = chart.querySelector('.compare-cursor');
            if (svg && tip && cursor) {
                const hideTip = () => {
                    tip.hidden = true;
                    cursor.setAttribute('visibility', 'hidden');
                };
                chart.onpointermove = event => {
                    const rect = svg.getBoundingClientRect();
                    if (event.clientX < rect.left || event.clientX > rect.right
                        || event.clientY < rect.top || event.clientY > rect.bottom) {
                        hideTip();
                        return;
                    }
                    const svgX = (event.clientX - rect.left) / rect.width * width;
                    const index = Math.max(0, Math.min(slots - 1, Math.round((svgX - left) / plotW * (slots - 1))));
                    const cx = x(index);
                    cursor.setAttribute('x1', cx);
                    cursor.setAttribute('x2', cx);
                    cursor.setAttribute('visibility', 'visible');
                    const rows = sessions.map((session, i) => (
                        `<div class="row"><i style="background:${COMPARE_COLORS[i % COMPARE_COLORS.length]}"></i>`
                        + `<span>${compareEscape(t('compare.sessionLabel', { date: session.date, time: session.localTime }))}</span>`
                        + `<b>${compareEscape(format(session.points?.[index]))}</b></div>`
                    ));
                    if (sessions.length >= 3 && comparison.median?.some(value => value != null)) {
                        rows.push(`<div class="row"><i style="background:#e5e7eb"></i><span>${compareEscape(t('compare.median'))}</span><b>${compareEscape(format(comparison.median[index]))}</b></div>`);
                    }
                    tip.innerHTML = `<strong>${compareEscape(t('compare.elapsed', { minutes: Math.round(index * (bucketMs / 60000)) }))}</strong>${rows.join('')}`;
                    tip.hidden = false;
                    const chartRect = chart.getBoundingClientRect();
                    const tipWidth = 230;
                    let leftPx = event.clientX - chartRect.left + 14;
                    if (leftPx + tipWidth > chartRect.width) leftPx = event.clientX - chartRect.left - tipWidth - 14;
                    tip.style.left = Math.max(4, leftPx) + 'px';
                    tip.style.top = Math.max(4, Math.min(chartRect.height - 170, event.clientY - chartRect.top + 10)) + 'px';
                };
                chart.onpointerleave = hideTip;
            }
        } else {
            chart.onpointermove = null;
            chart.onpointerleave = null;
        }

        updateTable('compare-table', [
            [t('compare.date'), t('compare.start'), t('compare.openingAverage'), t('compare.peak'),
                t('compare.low'), t('compare.peakAt'), t('compare.observed'), t('compare.confidence'), t('compare.state')],
            ...sessions.map(session => [
                `● ${session.date}`,
                session.localTime,
                format(session.openingAverage),
                format(session.peak),
                session.postPeakLow == null ? '—' : `${format(session.postPeakLow)}（${t('compare.elapsed', { minutes: session.postPeakLowMinute })}）`,
                session.peakMinute == null ? '—' : t('compare.elapsed', { minutes: session.peakMinute }),
                t('compare.minutes', { minutes: session.observedMinutes }),
                startTypeLabel(session.confidence),
                session.ended ? t('compare.ended') : t('compare.ongoing')
            ])
        ]);
        const tbody = table.querySelector('tbody');
        for (const [index, row] of [...(tbody?.rows ?? [])].entries()) {
            row.cells[0].style.color = COMPARE_COLORS[index % COMPARE_COLORS.length];
        }
        table.hidden = false;
    }

        /**
     * 歷史時段排名：以「場次」為單位，取場次開場平均觀看。
     * 資格只看資料量（場次／日期／開場觀測）；開播信心只作標示，不是門檻。
     * 顯示中位數、平均與收縮平均；樣本不足的時段列在進度表。
     */
    function renderRanking(rankings) {
        if (!rankings) return;

        const minSessions = rankings.minSessions ?? 3;
        const minDays = rankings.minDays ?? 3;
        const earlyMinutes = rankings.earlyMinutes ?? 30;
        const minObserved = rankings.minObservedMinutes ?? 20;
        const qualified = rankings.cells.filter(cell => !cell.insufficient);
        const incomplete = rankings.cells.filter(cell => cell.insufficient);
        const comparable = qualified.length >= 2;
        const excluded = rankings.excluded ?? { missingStart: rankings.unstarted || 0 };
        const startPlatform = rankings.platform;
        const slotLabel = key => {
            const [day, hour] = key.split(' ');
            return `${weekday(WEEKDAYS.indexOf(day))} ${hour}:00`;
        };
        const startType = cell => (cell.startTypes ?? [])
            .map(startTypeLabel).join(' + ') || t('ranking.confidence');
        const needOf = cell => Math.max(0, minSessions - cell.n, minDays - cell.observedDays);

        const rows = [['#', t('timeSlot'), t('ranking.confidence'), t('sessions'), t('median'), t('mean'), t('shrunk')]];
        qualified.forEach((cell, index) => {
            rows.push([
                comparable ? index + 1 : '—',
                slotLabel(cell.key),
                startType(cell),
                cell.n,
                format(cell.median),
                format(cell.mean),
                format(cell.shrunk)
            ]);
        });
        updateTable('ranking', rows);
        el('ranking').hidden = !qualified.length;

        // 2 場／2 日期先提供暫定觀察，但不進入排名。
        const provisional = incomplete.filter(cell => cell.n >= 2 && cell.observedDays >= 2)
            .sort((a, b) => b.mean - a.mean || a.key.localeCompare(b.key));
        updateTable('ranking-provisional', [
            [t('timeSlot'), t('ranking.confidence'), t('sessions'), t('ranking.provisionalDays'), t('mean'), t('median')],
            ...provisional.map(cell => [slotLabel(cell.key), startType(cell), cell.n, cell.observedDays, format(cell.mean), format(cell.median)])
        ]);
        el('ranking-provisional').hidden = !provisional.length;
        el('ranking-provisional-title').hidden = !provisional.length;
        el('ranking-provisional-note').hidden = !provisional.length;

        // 其餘未達標時段：直接顯示還差多少，讓使用者知道何時會達標。
        const progress = incomplete.filter(cell => !(cell.n >= 2 && cell.observedDays >= 2))
            .sort((a, b) => b.n - a.n || b.observedDays - a.observedDays ||
                (b.lastStarted || 0) - (a.lastStarted || 0) || a.key.localeCompare(b.key));
        updateTable('ranking-progress', [
            [t('timeSlot'), t('ranking.confidence'), t('sessions'), t('ranking.provisionalDays'), t('mean'), t('ranking.status')],
            ...progress.map(cell => [
                slotLabel(cell.key), startType(cell), cell.n, cell.observedDays, format(cell.mean),
                t('ranking.nextNeed', { count: needOf(cell) })
            ])
        ]);
        el('ranking-progress').hidden = !progress.length;
        el('ranking-progress-title').hidden = !progress.length;
        el('ranking-progress-note').hidden = !progress.length;

        const card = el('ranking-note');
        card.replaceChildren();
        const heading = document.createElement('strong');
        heading.textContent = t(comparable ? 'ranking.ready' : 'ranking.collecting');
        card.append(heading);

        const addTo = (container, text, className = '') => {
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            paragraph.className = className;
            container.append(paragraph);
            return paragraph;
        };

        // 先給「下一步」：用最接近達標的時段算出還要開幾場，再談規則細節。
        if (!comparable) {
            const candidates = incomplete.map(cell => {
                const needSessions = Math.max(0, minSessions - cell.n);
                const needDays = Math.max(0, minDays - cell.observedDays);
                return { cell, needSessions, needDays, need: Math.max(needSessions, needDays) };
            }).filter(item => item.need > 0)
                .sort((a, b) => a.need - b.need ||
                    b.cell.n - a.cell.n ||
                    b.cell.observedDays - a.cell.observedDays ||
                    (b.cell.lastStarted || 0) - (a.cell.lastStarted || 0) ||
                    a.cell.key.localeCompare(b.cell.key));

            const maxIncompleteN = incomplete.reduce((max, cell) => Math.max(max, cell.n), 0);
            const dispersed = qualified.length === 0 && incomplete.length >= 4 && maxIncompleteN <= 1;

            let headline;
            let actionText;
            let selected = [];
            if (dispersed) {
                headline = t('ranking.nextDispersed');
                actionText = t('ranking.nextDispersedAction', { slots: incomplete.length });
            } else if (qualified.length === 1) {
                const item = candidates[0];
                if (item) {
                    selected = [item];
                    headline = t('ranking.nextSecond', { sessions: item.need });
                    actionText = t('ranking.nextActionSecond', {
                        slot: slotLabel(item.cell.key), count: item.need
                    });
                } else {
                    headline = t('ranking.nextSecondSlot');
                    actionText = t('ranking.nextActionSecondSlot', {
                        minimum: minSessions, days: minDays
                    });
                }
            } else if (candidates.length) {
                selected = candidates.slice(0, 2);
                if (selected.length === 1) {
                    headline = t('ranking.nextOneSlot', { sessions: selected[0].need });
                    actionText = t('ranking.nextActionOne', {
                        slot: slotLabel(selected[0].cell.key), count: selected[0].need
                    });
                } else {
                    const total = selected.reduce((sum, item) => sum + item.need, 0);
                    headline = t('ranking.nextUnlock', { sessions: total });
                    actionText = t('ranking.nextActionTwo', {
                        slot1: slotLabel(selected[0].cell.key), count1: selected[0].need,
                        slot2: slotLabel(selected[1].cell.key), count2: selected[1].need
                    });
                }
            } else {
                headline = t('ranking.nextCollect');
                actionText = t('ranking.nextActionCollect', {
                    window: earlyMinutes, observed: minObserved
                });
            }

            const next = document.createElement('section');
            next.className = 'ranking-next';
            const head = document.createElement('div');
            head.className = 'ranking-next-head';
            const title = document.createElement('strong');
            title.textContent = headline;
            const badge = document.createElement('span');
            badge.className = 'ranking-next-badge';
            badge.textContent = t('ranking.nextBadge');
            head.append(title, badge);
            next.append(head);
            addTo(next, actionText, 'ranking-next-action');

            if (selected.length) {
                const list = document.createElement('div');
                list.className = 'ranking-slots';
                for (const item of selected) {
                    const row = document.createElement('div');
                    row.className = 'ranking-slot';
                    const name = document.createElement('span');
                    name.className = 'ranking-slot-name';
                    name.textContent = slotLabel(item.cell.key);
                    const progress = document.createElement('span');
                    progress.className = 'ranking-slot-progress';
                    progress.textContent = t('ranking.nextProgress', {
                        sessions: item.cell.n, minimum: minSessions,
                        days: item.cell.observedDays, minDays
                    });
                    const need = document.createElement('span');
                    need.className = 'ranking-need';
                    need.textContent = t('ranking.nextNeed', { count: item.need });
                    row.append(name, progress, need);
                    list.append(row);
                }
                next.append(list);
                const weeks = Math.max(...selected.map(item => item.need));
                addTo(next, t('ranking.nextWeeklyHint', { weeks }), 'ranking-next-hint');
                addTo(next, t('ranking.nextOtherSlotHint'), 'ranking-next-hint');
            }

            const tips = [];
            if (excluded.missingStart) tips.push(t('ranking.nextTipMissing', { count: excluded.missingStart }));
            if (excluded.insufficientCoverage) {
                tips.push(t(startPlatform === 'TikTok'
                    ? 'ranking.nextTipCoverageTikTok'
                    : 'ranking.nextTipCoverage', { count: excluded.insufficientCoverage }));
            }
            if (excluded.pending) tips.push(t('ranking.nextTipPending', { count: excluded.pending }));
            if (tips.length) {
                const list = document.createElement('ul');
                list.className = 'ranking-next-tips';
                for (const tip of tips) {
                    const item = document.createElement('li');
                    item.textContent = tip;
                    list.append(item);
                }
                next.append(list);
            }
            addTo(next, t('ranking.nextMinSlots'), 'ranking-next-min');
            card.append(next);
        }

        addTo(card, t('ranking.summary', {
            total: rankings.totalSessions ?? rankings.sessionCount + (rankings.unstarted || 0),
            usable: rankings.sessionCount, qualified: qualified.length
        }));
        if (rankings.scope === 'own') addTo(card, t('ranking.scopeOwn'));
        else if (rankings.scope === 'all') addTo(card, t('ranking.scopeAll'));

        const hasAssisted = [...qualified, ...incomplete].some(cell =>
            (cell.startTypes ?? []).some(type => type !== 'exact'));
        if (hasAssisted) addTo(card, t('ranking.confidenceNote'), 'ranking-confidence-note');
        addTo(card, t('ranking.longStreamNote'), 'ranking-long-stream');

        // 規則、排除原因收進摺疊區，避免一次塞滿畫面。
        const details = document.createElement('details');
        details.className = 'ranking-why';
        const why = document.createElement('summary');
        why.textContent = t('ranking.nextWhy');
        details.append(why);

        const criteria = document.createElement('ul');
        criteria.className = 'ranking-criteria';
        for (const line of t('ranking.criteria', {
            minimum: minSessions, days: minDays, observed: minObserved
        }).split('\n')) {
            if (!line.trim()) continue;
            const item = document.createElement('li');
            item.textContent = line;
            criteria.append(item);
        }
        details.append(criteria);
        addTo(details, t('ranking.slotBoundary'), 'ranking-slot-boundary');

        const reasons = document.createElement('ul');
        reasons.className = 'ranking-reasons';
        for (const reason of ['missingStart', 'pending', 'insufficientCoverage']) {
            if (!excluded[reason]) continue;
            const item = document.createElement('li');
            const key = reason === 'insufficientCoverage' && startPlatform === 'TikTok'
                ? 'ranking.insufficientCoverageTikTok' : `ranking.${reason}`;
            item.textContent = t(key, { count: excluded[reason] });
            reasons.append(item);
        }
        if (reasons.childElementCount) details.append(reasons);

        if (rankings.days < 15) addTo(details, t('ranking.shortRange'));
        if (!comparable) addTo(details, t('ranking.comparison'));
        addTo(details, t('ranking.caution'), 'ranking-caution');
        card.append(details);
    }

    /**
     * 每小時觀看軌：以每個日期的該小時平均再跨日期取中位數。
     * 長場次自然貢獻多個小時，也不需要開播時間；是觀看時段參考，不是開播排名。
     */
    function renderHourly(hourly) {
        const table = el('hourly'), empty = el('hourly-empty'), note = el('hourly-provisional');
        const context = el('hourly-context');
        const minDays = hourly?.minDays ?? 3;
        const qualified = hourly?.qualified ?? [];
        const provisional = hourly?.provisional ?? [];
        const rows = qualified.length ? qualified.slice(0, 8) : provisional.slice(0, 5);
        context.textContent = hourly?.days
            ? t('hourly.context', { days: hourly.days, minutes: hourly.minMinutesPerDate ?? 10 })
            : '';
        if (!rows.length) {
            table.hidden = true;
            empty.hidden = false;
            note.hidden = true;
            return;
        }
        empty.hidden = true;
        note.hidden = qualified.length > 0;
        if (!note.hidden) note.textContent = t('hourly.provisional', { days: minDays });
        const lastText = value => {
            if (!value) return '—';
            const options = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
            if (hourly?.timezone) options.timeZone = hourly.timezone;
            return new Date(value).toLocaleString(window.TTWI18n.language, options);
        };
        updateTable('hourly', [
            [t('hourly.slot'), t('hourly.median'), t('hourly.mean'), t('hourly.days'),
                t('hourly.minutes'), t('hourly.last')],
            ...rows.map(cell => [
                slotKeyLabel(cell.key),
                format(cell.median),
                format(cell.mean),
                cell.days,
                cell.observedMinutes,
                lastText(cell.lastAt)
            ])
        ]);
        table.hidden = false;
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
                t('history.status', {platform:data.platform || t('noData'), timezone:timezone(), sessions:data.rankings?.totalSessions ?? data.rankings?.sessionCount ?? 0}));

            const context = [data.platform, timezone(), window.TTWI18n.language];
            if (changed('heatmap', [context, data.cells])) renderHeatmap(data.cells);
            if (changed('daily', [context, data.daily])) renderDaily(data.daily);
            if (changed('metrics', [context, data.metrics])) renderMetrics(data.metrics);
            if (changed('compare', [context, data.comparison])) renderComparison(data.comparison);
            if (changed('ranking', [context, data.rankings])) renderRanking(data.rankings);
            if (changed('hourly', [context, data.hourly])) renderHourly(data.hourly);
        } catch (error) {
            console.error('[traffic] history refresh failed:', error);
            setText(el('history-status'), t('history.error'));
        } finally {
            busy = false;
            if (rerun) { rerun = false; refresh(); } else schedulePoll();
        }
    }

    el('history-days').addEventListener('change', refresh);
    el('platform').addEventListener('change', refresh);
    window.addEventListener('traffic-cleared', refresh);   // 清理統計後立刻重讀歷史
    window.addEventListener('traffic-classified', refresh);
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
