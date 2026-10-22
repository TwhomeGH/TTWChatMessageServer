(async () => {
    await window.TTWI18n.ready;
    const t = (key, params = {}) => window.TTWI18n.t('traffic.plan.' + key, params);
    const el = id => document.getElementById('plan-' + id);
    let data, page = 1, busy = false, initialized = false, dirty = false, timer, bfPreview = null, bfBatch = null;
    const purposeValues = ['own', 'reference', 'test'];
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const node = (tag, text, className = '') => {
        const result = document.createElement(tag);
        if (text !== undefined) result.textContent = text;
        result.className = className;
        return result;
    };
    const date = time => new Intl.DateTimeFormat(window.TTWI18n.language, {
        timeZone: data.settings.timezone, dateStyle: 'medium', timeStyle: 'short'
    }).format(time);
    const weekday = index => new Intl.DateTimeFormat(window.TTWI18n.language, { weekday: 'short', timeZone: 'UTC' })
        .format(Date.UTC(2026, 0, 5 + index));
    const slot = key => {
        const [day, hour] = key.split(' ');
        return `${weekday(WEEKDAYS.indexOf(day))} ${hour}:00`;
    };

    /**
     * 建立具名稱的用途選單。
     * 單場可選擇沿用帳號設定；帳號預設尚未指定時顯示不可選的「待分類」狀態，
     * 避免把「未分類」誤當成另一個可儲存的用途。
     */
    function purposeSelect(value, inherit = false) {
        const select = node('select');
        select.setAttribute('aria-label', t('purpose'));
        if (inherit) select.add(new Option(t('inherit'), ''));
        if (!inherit && value === 'unknown') {
            const placeholder = new Option(t('unknown'), 'unknown');
            placeholder.disabled = true;
            select.add(placeholder);
        }
        for (const purpose of purposeValues) select.add(new Option(t(purpose), purpose));
        select.value = value ?? '';
        return select;
    }

    /** 送出一次管理 API 變更；共用 busy 避免同時修改。 */
    async function mutate(action, value) {
        if (busy) return null;
        busy = true;
        try {
            const response = await fetch('/api/traffic/planner', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, value })
            });
            const result = await response.json().catch(() => ({}));
            return { ok: response.ok, status: response.status, result };
        } catch { return { ok: false, status: 0, result: {} }; }
        finally { busy = false; }
    }

    let toastTimer;
    /** 在頁面底部顯示短暫訊息；success／error 使用不同左側色條。 */
    function toast(message, tone = 'info') {
        let box = document.getElementById('plan-toast');
        if (!box) {
            box = node('div', undefined, 'plan-toast');
            box.id = 'plan-toast';
            box.setAttribute('role', 'status');
            box.setAttribute('aria-live', 'polite');
            document.body.append(box);
        }
        box.className = `plan-toast ${tone}`;
        box.textContent = message;
        void box.offsetWidth;
        box.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => box.classList.remove('show'), tone === 'error' ? 6000 : 4000);
    }

    /** 所有變更均由使用者點擊後送出，成功後重新取得伺服器狀態。 */
    async function save(action, value) {
        const outcome = await mutate(action, value);
        if (!outcome) return;
        if (!outcome.ok) {
            const fields = ['channels', 'historyDays', 'maxPerWeek', 'weekdays', 'hours', 'timezone',
                'channelNotConfigured', 'collecting', 'target', 'action', 'slot'];
            const key = outcome.status === 403 ? 'originError'
                : fields.includes(outcome.result.field) ? 'error.' + outcome.result.field : 'saveError';
            const message = t(key);
            el('status').textContent = message;
            toast(message, 'error');
            return;
        }
        el('status').textContent = t('saved');
        dirty = false;
        if (action === 'settings') initialized = false;
        if (action === 'tests' || action === 'assign') page = 1;
        window.dispatchEvent(new Event('traffic-classified'));
        await refresh();
        if (action === 'settings') {
            toast(t('settingsSaved'), 'success');
        } else if (action.startsWith('collecting')) {
            toast(action === 'collectingAddSeries' ? t('collecting.seriesAdded') : t('saved'), 'success');
        }
    }

    function actionButton(label, action) {
        const button = node('button', label);
        button.type = 'button';
        button.onclick = action;
        return button;
    }

    function options(id, count, selected, label) {
        el(id).replaceChildren(...Array.from({ length: count }, (_, index) => {
            const wrapper = node('label');
            const input = node('input');
            input.type = 'checkbox';
            input.value = index;
            input.checked = selected.includes(index);
            wrapper.append(input, document.createTextNode(label(index)));
            return wrapper;
        }));
    }

    function renderSettings() {
        for (const channel of ['ntfy', 'bark']) {
            const detail = data.available.details?.[channel];
            const key = detail?.state === 'invalid' ? 'invalidTarget'
                : detail?.state === 'ready' && detail.mode === 'topic' ? 'configuredTopic'
                    : data.available[channel] ? 'configured' : 'notConfigured';
            el(channel + '-state').textContent = t(key);
        }
        if (initialized) return;
        const settings = data.settings;
        el('enabled').checked = settings.enabled;
        for (const channel of ['ntfy', 'bark']) el(channel).checked = settings.channels.includes(channel);
        el('zone').value = settings.timezone;
        el('history').value = settings.historyDays;
        el('limit').value = settings.maxPerWeek;
        options('days', 7, settings.weekdays, weekday);
        options('hours', 24, settings.hours, hour => String(hour).padStart(2, '0') + ':00');
        initialized = true;
    }

    /** 資料累積建議：以整點分組；每週計畫用一張緊湊表，多平台共用提醒。 */
    function collectingCard() {
        const suggestions = data.collecting || [];
        const targets = data.collectingTargets || [];
        if (!suggestions.length && !targets.length) return null;
        const card = node('article', undefined, 'plan-card plan-collecting');
        card.append(node('strong', t('collecting.title')));
        card.append(node('p', t('collecting.note', { days: data.settings.historyDays }), 'plan-muted'));
        const ready = data.settings.enabled && data.settings.channels.some(channel => data.available?.[channel]);
        const seriesReady = ready && data.capabilities?.collectingSeries === true;
        if (!ready) card.append(node('p', t('collecting.disabled'), 'plan-muted'));

        const dayNumber = time => {
            const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
                timeZone: data.settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit'
            }).formatToParts(time).map(part => [part.type, part.value]));
            return Math.floor(Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`) / 86400000);
        };
        const relativeDay = time => {
            if (!Number.isSafeInteger(time)) return null;
            const days = dayNumber(time) - dayNumber(data.now ?? Date.now());
            if (days < 0) return null;
            if (days === 0) return { text: t('collecting.today'), className: 'today' };
            if (days === 1) return { text: t('collecting.tomorrow'), className: 'tomorrow' };
            if (days === 2) return { text: t('collecting.dayAfter'), className: 'soon' };
            if (days <= 6) return { text: t('collecting.inDays', { count: days }), className: 'soon' };
            return null;
        };

        const hours = new Map();
        const ensureHour = hour => {
            if (!hours.has(hour)) hours.set(hour, { hour, items: [] });
            return hours.get(hour);
        };
        for (const item of suggestions) {
            const group = ensureHour(item.slot.split(' ')[1]);
            group.items.push({
                ...item,
                targeted: targets.some(target => target.slot === item.slot &&
                    target.platform === item.platform && target.broadcaster === item.broadcaster)
            });
        }
        for (const target of targets) {
            const group = ensureHour(target.slot.split(' ')[1]);
            if (!group.items.some(item => item.slot === target.slot &&
                item.platform === target.platform && item.broadcaster === target.broadcaster)) {
                group.items.push({ ...target, targetOnly: true });
            }
        }

        const ordered = [...hours.values()].sort((a, b) => Number(a.hour) - Number(b.hour));
        for (const group of ordered) {
            const hour = group.hour;
            const groupTargets = targets.filter(target => target.slot.endsWith(` ${hour}`));
            const slots = [...new Set(group.items.map(item => item.slot))]
                .sort((a, b) => WEEKDAYS.indexOf(a.split(' ')[0]) - WEEKDAYS.indexOf(b.split(' ')[0]));
            const platforms = [...new Set(group.items.map(item => item.platform))];

            const section = node('section', undefined, 'plan-hour');
            const head = node('div', undefined, 'plan-hour-head');
            head.append(node('strong', t(groupTargets.length ? 'collecting.weekPlan' : 'collecting.hourSuggestions', { hour: `${hour}:00` })));
            if (groupTargets.length) {
                head.append(node('span', t('collecting.daysCount', {
                    count: new Set(groupTargets.map(target => target.slot)).size
                }), 'plan-badge'));
            }
            section.append(head);
            section.append(node('p', t('collecting.windowHint'), 'plan-muted'));

            const wrap = node('div', undefined, 'table-wrap plan-hour-table');
            const table = node('table');
            const thead = node('thead');
            const headRow = node('tr');
            headRow.append(node('th', t('collecting.weekday')));
            for (const platform of platforms) headRow.append(node('th', platform));
            headRow.append(node('th', t('collecting.next')), node('th', t('collecting.actions')));
            thead.append(headRow);
            table.append(thead);
            const tbody = node('tbody');
            for (const slot of slots) {
                const slotTargets = targets.filter(target => target.slot === slot);
                const nextAt = slotTargets.map(target => target.nextAt)
                    .filter(Number.isSafeInteger).sort((a, b) => a - b)[0];
                const row = node('tr');
                const weekdayCell = node('th');
                weekdayCell.append(node('span', weekday(WEEKDAYS.indexOf(slot.split(' ')[0]))));
                const badge = relativeDay(nextAt);
                if (badge?.text) weekdayCell.append(node('span', badge.text, `plan-day-badge ${badge.className}`));
                row.append(weekdayCell);
                for (const platform of platforms) {
                    const item = group.items.find(entry => entry.slot === slot && entry.platform === platform);
                    const cell = node('td');
                    if (item) {
                        for (const type of item.startTypes ?? []) {
                            cell.append(node('span', t('collecting.startType.' + type), 'plan-confidence'));
                        }
                        cell.append(node('span', t('collecting.cell', {
                            sessions: item.n, minimum: item.minimum,
                            days: item.observedDays, minDays: item.minDays
                        })));
                        if (!item.n) cell.append(node('span', t('collecting.none'), 'plan-muted'));
                        if (item.lastStarted) {
                            cell.title = t('collecting.recent', {
                                date: date(item.lastStarted), mean: Number(item.mean).toFixed(1)
                            });
                        }
                    } else {
                        cell.textContent = '—';
                    }
                    row.append(cell);
                }
                row.append(node('td', nextAt ? date(nextAt) : '—'));
                const actions = node('td', undefined, 'plan-hour-actions');
                const slotItems = group.items.filter(item => item.slot === slot);
                const hasTarget = slotTargets.length > 0;
                if (hasTarget) {
                    actions.append(actionButton(t('collecting.remove'), () =>
                        save('collectingRemoveSlot', { slot })));
                }
                if (slotItems.some(item => !item.targetOnly && !item.targeted)) {
                    const add = actionButton(t(hasTarget ? 'collecting.addRest' : 'collecting.add'), () =>
                        save('collectingAddSlot', { slot }));
                    add.disabled = !ready;
                    actions.append(add);
                }
                row.append(actions);
                tbody.append(row);
            }
            table.append(tbody);
            wrap.append(table);
            section.append(wrap);

            const seed = group.items.find(item => !item.targetOnly);
            if (seed) {
                const seedDay = WEEKDAYS.indexOf(seed.slot.split(' ')[0]);
                const activeDays = new Set(groupTargets.map(target => WEEKDAYS.indexOf(target.slot.split(' ')[0])));
                const series = node('details', undefined, 'plan-series');
                series.append(node('summary', t('collecting.seriesOpen', { hour: `${hour}:00` })));
                series.append(node('p', t('collecting.seriesNote'), 'plan-series-note'));
                if (!data.capabilities?.collectingSeries) {
                    series.append(node('p', t('collecting.seriesNeedsRestart'), 'plan-series-note'));
                }
                const days = node('div', undefined, 'plan-series-days');
                for (const day of data.settings.weekdays) {
                    const label = node('label');
                    const input = node('input');
                    input.type = 'checkbox';
                    input.value = String(day);
                    input.checked = activeDays.size ? activeDays.has(day) : day === seedDay;
                    label.append(input, document.createTextNode(weekday(day)));
                    days.append(label);
                }
                series.append(days);
                const addSeries = actionButton(t('collecting.seriesAdd'), () => {
                    const selected = [...series.querySelectorAll('input:checked')].map(input => Number(input.value));
                    if (selected.length) save('collectingAddSeries', { slot: seed.slot, weekdays: selected });
                });
                addSeries.disabled = !seriesReady;
                series.append(addSeries);
                section.append(series);
            }
            card.append(section);
        }
        card.append(node('p', t('collecting.auto'), 'plan-muted'));
        return card;
    }

    function renderJobs() {
        const groups = new Map();
        for (const job of data.jobs.filter(job => job.kind !== 'collecting')) {
            if (!groups.has(job.startAt)) groups.set(job.startAt, []);
            groups.get(job.startAt).push(job);
        }
        const collecting = collectingCard();
        const cards = [];
        if (!data.settings.enabled) cards.push(node('p', t('disabled'), 'plan-muted'));
        if (collecting) cards.push(collecting);
        if (!groups.size && !collecting) cards.push(node('p', t('waiting'), 'plan-muted'));
        if (groups.size) cards.push(node('h4', t('formalTitle'), 'plan-section-title'));
        for (const [startAt, jobs] of groups) {
            const card = node('article', undefined, 'plan-card');
            card.append(node('strong', date(startAt)), node('p', t('notifyAt', { time: date(startAt - 30 * 60000) })));
            for (const job of jobs) {
                const kind = job.kind === 'collecting' ? `${t('collecting.job')} · ${slot(job.slot)} · ` : '';
                card.append(node('p', `${job.platform} / ${job.broadcaster} · ${kind}${t(job.status)}`));
            }
            for (const delivery of data.deliveries.filter(row => row.startAt === startAt)) {
                card.append(node('p', `${delivery.channel} · ${t(delivery.status)}`, 'plan-muted'));
            }
            if (jobs.some(job => job.status === 'planned')) card.append(actionButton(t('skip'), () => save('skip', startAt)));
            cards.push(card);
        }
        el('jobs').replaceChildren(...cards);
    }

    /** 打開分類區並捲到對應位置。 */
    function openClassification() {
        const details = document.getElementById('plan-classification');
        details.open = true;
        details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function openProfiles() {
        openClassification();
        el('profiles').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function focusReminder() {
        document.getElementById('plan-settings').scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('plan-enabled').focus({ preventScroll: true });
    }

    /** 分類完成度、帳號預設與提醒狀態；完成後才把重點轉到分析表。 */
    function renderHealth() {
        const counts = data.statusCounts ?? { all: 0, own: 0, reference: 0, test: 0, unclassified: 0 };
        const own = data.analyses.filter(analysis => analysis.purpose === 'own');
        const reference = data.analyses.filter(analysis => analysis.purpose === 'reference');
        const profiles = data.profiles.length;
        const complete = counts.all > 0 && counts.unclassified === 0 && own.length > 0;
        const state = counts.all === 0 ? 'empty' : !own.length ? 'noOwn' : complete ? 'complete' : 'incomplete';
        const card = node('article', undefined, `plan-card plan-health is-${state}`);
        const head = node('div', undefined, 'plan-health-head');
        head.append(node('strong', t('health.title')));
        head.append(node('span', t('health.' + state, { count: counts.unclassified }), `plan-health-badge is-${state}`));
        card.append(head);
        card.append(node('p', t('health.summary', counts), 'plan-muted'));

        const list = node('ul', undefined, 'plan-health-list');
        const comma = window.TTWI18n.language.startsWith('zh') ? '、' : ', ';
        const names = rows => rows.map(row => `${row.platform} / ${row.broadcaster}`).join(comma) || '—';
        list.append(node('li', t('health.ownList', { list: names(own) })));
        if (reference.length) list.append(node('li', t('health.refList', { list: names(reference) })));
        list.append(node('li', profiles ? t('health.profiles', { count: profiles }) : t('health.profilesMissing')));
        list.append(node('li', data.settings.enabled ? t('health.remindersOn') : t('health.remindersOff')));
        card.append(list);

        const actions = node('div', undefined, 'plan-fields plan-health-actions');
        if (!complete) actions.append(actionButton(t('health.goClassify'), openClassification));
        if (counts.all > 0 && !profiles) actions.append(actionButton(t('health.goProfiles'), openProfiles));
        if (!data.settings.enabled) actions.append(actionButton(t('health.goReminder'), focusReminder));
        if (actions.childElementCount) card.append(actions);
        el('health').replaceChildren(card);
    }

    /** 分析參考表：把每個主播的時段證據排成可掃描的表格。 */
    function renderAnalysisTable() {
        const target = el('analysis-table');
        const empty = el('analysis-empty');
        const evidence = document.getElementById('plan-analysis-evidence');
        const hasAnalyses = data.analyses.length > 0;
        empty.hidden = hasAnalyses;
        empty.textContent = t('classifyFirst');
        evidence.hidden = !hasAnalyses;
        if (!hasAnalyses) {
            target.hidden = true;
            target.replaceChildren();
            return;
        }
        target.hidden = false;
        const table = node('table');
        const thead = document.createElement('thead');
        const head = document.createElement('tr');
        for (const key of ['broadcaster', 'platform', 'purpose', 'slot', 'sessions', 'days', 'mean', 'score', 'confidence', 'state']) {
            head.append(node('th', t('analysis.col.' + key)));
        }
        thead.append(head);
        const tbody = document.createElement('tbody');
        for (const analysis of data.analyses) {
            for (const cell of analysis.rankings.cells) {
                const tr = document.createElement('tr');
                tr.append(
                    node('td', analysis.broadcaster),
                    node('td', analysis.platform),
                    node('td', t(analysis.purpose)),
                    node('td', slot(cell.key)),
                    node('td', String(cell.n)),
                    node('td', String(cell.observedDays)),
                    node('td', cell.mean.toFixed(1)),
                    node('td', cell.shrunk.toFixed(1)),
                    node('td', cell.confidence === 'exact'
                        ? t('analysis.confidence.exact')
                        : t('analysis.confidence.assisted')),
                    node('td', t(cell.insufficient ? 'partial' : 'qualified'))
                );
                tbody.append(tr);
            }
        }
        if (!tbody.childElementCount) {
            const tr = document.createElement('tr');
            const td = node('td', t('analysis.noSlots'));
            td.colSpan = 10;
            tr.append(td);
            tbody.append(tr);
        }
        table.append(thead, tbody);
        target.replaceChildren(table);
    }

    function renderAnalysis() {
        const ownSlots = new Set(data.analyses.filter(a => a.purpose === 'own').flatMap(a => a.rankings.cells.map(c => c.key)));
        const cards = data.analyses.map(analysis => {
            const card = node('article', undefined, 'plan-card');
            const ranking = analysis.rankings;
            card.append(node('strong', `${analysis.platform} / ${analysis.broadcaster} · ${t(analysis.purpose)}`));
            card.append(node('p', t('evidence', { days: data.settings.historyDays, total: ranking.totalSessions, usable: ranking.sessionCount })));
            card.append(node('p', t('excluded', ranking.excluded), 'plan-muted'));
            if (analysis.purpose === 'reference') {
                const shared = ranking.cells.filter(cell => ownSlots.has(cell.key)).map(cell => slot(cell.key));
                card.append(node('p', t('shared', { slots: shared.join('、') || '—' }), 'plan-muted'));
            }
            const list = node('ul');
            for (const cell of ranking.cells) list.append(node('li', t('slotEvidence', {
                slot: slot(cell.key), n: cell.n, days: cell.observedDays,
                mean: cell.mean.toFixed(1), score: cell.shrunk.toFixed(1), state: t(cell.insufficient ? 'partial' : 'qualified')
            })));
            card.append(list);
            return card;
        });
        el('analysis').replaceChildren(...(cards.length ? cards : [node('p', t('classifyFirst'))]));
    }

    function renderClassification() {
        el('profiles').replaceChildren(...data.profiles.map(profile => {
            const row = node('div', undefined, 'plan-fields');
            const select = purposeSelect(profile.purpose);
            row.append(node('strong', `${profile.platform} / ${profile.broadcaster}`), select,
                actionButton(t('saveDefault'), () => save('profile', {
                    ...profile, purpose: select.value === 'unknown' ? null : select.value
                })));
            if (profile.purpose !== 'unknown') {
                row.append(actionButton(t('clearDefault'), () => save('profile', { ...profile, purpose: null })));
            }
            return row;
        }));
        const platform = el('platform').value;
        const names = [...new Set([...data.platforms, platform].filter(Boolean))];
        el('platform').replaceChildren(new Option(t('all'), ''), ...names.sort().map(name => new Option(name, name)));
        el('platform').value = platform;
        el('sessions').replaceChildren(...data.sessions.rows.map(session => {
            const card = node('article', undefined, 'plan-card');
            card.append(node('strong', `${session.platform} · ${date(session.actualStarted ?? session.started)}`));
            card.append(node('p', `${t('purpose')}: ${t(session.effectivePurpose)} · #${session.id}`));
            const minutes = session.spanMs > 0 ? Math.round(session.spanMs / 60000) : null;
            card.append(node('p', t('sessionStats', {
                minutes: minutes == null ? '—' : String(minutes),
                average: session.averageViewers == null ? '—' : Number(session.averageViewers).toFixed(1),
                peak: session.peak == null ? '—' : String(Math.round(session.peak)),
                chats: session.chats ?? 0,
                joins: session.joins ?? 0,
                samples: session.sampleCount ?? 0
            }), 'plan-muted'));
            const broadcaster = node('input');
            broadcaster.value = session.broadcaster || '';
            broadcaster.maxLength = 100;
            broadcaster.placeholder = t('broadcaster');
            broadcaster.setAttribute('aria-label', t('broadcaster'));
            const purpose = purposeSelect(session.purpose, true);
            const controls = node('div', undefined, 'plan-fields');
            controls.append(broadcaster, purpose, actionButton(t('saveSession'), () => save('session', {
                id: session.id, broadcaster: broadcaster.value, purpose: purpose.value || null
            })));
            card.append(controls);
            return card;
        }));
        el('page').textContent = t('page', { page, total: Math.max(1, Math.ceil(data.sessions.total / 50)), sessions: data.sessions.total });
        el('counts').textContent = t('counts', data.sessions.counts);
        el('prev').disabled = page <= 1;
        el('next').disabled = page * 50 >= data.sessions.total;
        el('tests').disabled = !data.sessions.rows.some(row => row.effectivePurpose === 'unknown');
    }

    /** 目前補分類表單的篩選條件。 */
    function backfillFilter() {
        return {
            platform: el('bf-platform').value,
            status: el('bf-status').value,
            days: el('bf-days').value ? Number(el('bf-days').value) : null,
            completeOnly: el('bf-complete').checked
        };
    }

    /** 依目前選取的平台帶入 .env 的主播識別；只填入欄位，不會自動套用。 */
    function useEnvIdentity() {
        const platform = el('bf-platform').value;
        if (!platform) { el('bf-message').textContent = t('backfill.pickPlatform'); return; }
        const value = data.identities?.[platform];
        if (!value) {
            el('bf-message').textContent = t('backfill.noEnvIdentity', { platform });
            return;
        }
        el('bf-broadcaster').value = value;
        el('bf-message').textContent = platform === 'Twitch' && !/^\d+$/.test(value)
            ? t('backfill.twitchIdHint') : '';
        refreshApplyState();
    }

    /** 依欄位代碼顯示補分類的具體錯誤。 */
    function backfillErrorKey(field) {
        if (['broadcaster', 'purpose', 'days', 'completeOnly'].includes(field)) return 'backfill.error.' + field;
        if (field === 'tooMany') return 'backfill.tooMany';
        if (field === 'assignment') return 'backfill.assignment';
        return 'saveError';
    }

    /** 清除預覽結果；表單值保留。 */
    function invalidateBackfill() {
        bfPreview = null;
        el('bf-preview-data').replaceChildren();
        el('bf-apply').disabled = true;
        el('bf-apply').textContent = t('backfill.apply');
        el('bf-clear').hidden = true;
        el('bf-clear').disabled = true;
    }

    /** 目前勾選的預覽場次 id。 */
    function checkedBackfillIds() {
        return [...el('bf-preview-data').querySelectorAll('tbody input[type=checkbox]:checked')]
            .map(input => Number(input.value));
    }

    /** 依勾選數量與指派內容決定套用按鈕是否可用。 */
    function refreshApplyState() {
        const assigned = el('bf-broadcaster').value.trim() || el('bf-purpose').value;
        const selected = checkedBackfillIds().length;
        el('bf-apply').disabled = !bfPreview?.matched || bfPreview.tooMany || !assigned || !selected || busy;
        el('bf-clear').disabled = !selected;
        if (bfPreview?.rows) el('bf-apply').textContent = `${t('backfill.apply')} (${selected})`;
    }

    /** 顯示預覽數量與可勾選的場次明細；預設全選，讓批量補分類仍是一步。 */
    function renderBackfillPreview() {
        if (!bfPreview) { invalidateBackfill(); return; }
        if (!bfPreview.matched) {
            el('bf-preview-data').replaceChildren(node('p', t('backfill.previewNone'), 'plan-muted'));
            el('bf-clear').hidden = true;
            refreshApplyState();
            return;
        }
        const parts = [node('p', t('backfill.previewResult', {
            matched: bfPreview.matched, excluded: bfPreview.excludedIncomplete
        }), 'plan-muted')];
        if (bfPreview.truncated) parts.push(node('p', t('backfill.truncated'), 'plan-muted'));
        if (bfPreview.byPlatform.length) {
            parts.push(node('p', bfPreview.byPlatform.map(row => `${row.platform}：${row.n}`).join('、'), 'plan-muted'));
        }

        const wrap = node('div', undefined, 'table-wrap');
        const table = node('table');
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        const selectAll = node('input');
        selectAll.type = 'checkbox';
        selectAll.checked = true;
        selectAll.setAttribute('aria-label', t('backfill.selectAll'));
        const selectCell = document.createElement('th');
        selectCell.append(selectAll);
        headRow.append(selectCell);
        for (const key of ['when', 'platform', 'duration', 'viewers', 'chats', 'joins', 'samples', 'purpose']) {
            headRow.append(node('th', t('backfill.col.' + key)));
        }
        thead.append(headRow);

        const tbody = document.createElement('tbody');
        for (const row of bfPreview.rows) {
            const tr = document.createElement('tr');
            const checkCell = document.createElement('td');
            const check = node('input');
            check.type = 'checkbox';
            check.checked = true;
            check.value = String(row.id);
            check.setAttribute('aria-label', t('backfill.sample', {
                id: row.id, platform: row.platform,
                date: date(row.actualStarted ?? row.started), samples: row.sampleCount
            }));
            check.onchange = () => {
                const boxes = [...tbody.querySelectorAll('input[type=checkbox]')];
                const selected = boxes.filter(box => box.checked).length;
                selectAll.checked = selected === boxes.length;
                selectAll.indeterminate = selected > 0 && selected < boxes.length;
                refreshApplyState();
            };
            checkCell.append(check);
            const minutes = row.spanMs > 0 ? Math.round(row.spanMs / 60000) : null;
            const average = row.averageViewers == null ? '—' : Number(row.averageViewers).toFixed(1);
            const peak = row.peak == null ? '—' : String(Math.round(row.peak));
            tr.append(
                checkCell,
                node('td', date(row.actualStarted ?? row.started)),
                node('td', row.platform),
                node('td', minutes == null ? '—' : t('backfill.minutes', { minutes })),
                node('td', t('backfill.viewersValue', { average, peak })),
                node('td', String(row.chats ?? 0)),
                node('td', String(row.joins ?? 0)),
                node('td', String(row.sampleCount ?? 0)),
                node('td', t(row.effectivePurpose))
            );
            tbody.append(tr);
        }
        selectAll.onchange = () => {
            for (const input of tbody.querySelectorAll('input[type=checkbox]')) input.checked = selectAll.checked;
            selectAll.indeterminate = false;
            refreshApplyState();
        };
        const clearButton = el('bf-clear');
        clearButton.hidden = false;
        clearButton.onclick = () => {
            for (const input of tbody.querySelectorAll('input[type=checkbox]')) input.checked = false;
            selectAll.checked = false;
            selectAll.indeterminate = false;
            refreshApplyState();
        };
        table.append(thead, tbody);
        wrap.append(table);
        parts.push(wrap);
        el('bf-preview-data').replaceChildren(...parts);
        refreshApplyState();
    }

    /** 取得篩選預覽；不修改資料。 */
    async function previewBackfill() {
        const outcome = await mutate('backfillPreview', backfillFilter());
        if (!outcome) return;
        if (!outcome.ok) {
            el('bf-message').textContent = t(backfillErrorKey(outcome.result.field));
            return;
        }
        bfPreview = outcome.result;
        el('bf-message').textContent = bfPreview.tooMany ? t('backfill.tooMany') : '';
        renderBackfillPreview();
    }

    /** 套用預覽的批次；expected 讓伺服器拒絕過期預覽。 */
    async function applyBackfill() {
        if (!bfPreview?.matched) return;
        if (bfPreview.tooMany) {
            el('bf-message').textContent = t('backfill.tooMany');
            return;
        }
        const broadcaster = el('bf-broadcaster').value.trim();
        const purpose = el('bf-purpose').value;
        if (!broadcaster && !purpose) {
            el('bf-message').textContent = t('backfill.assignment');
            return;
        }
        const ids = checkedBackfillIds();
        if (!ids.length) {
            el('bf-message').textContent = t('backfill.selectNone');
            return;
        }
        const value = { ...bfPreview.filter, expected: ids.length, ids };
        if (broadcaster) value.broadcaster = broadcaster;
        if (purpose) value.purpose = purpose === 'clear' ? null : purpose;
        const outcome = await mutate('backfillApply', value);
        if (!outcome) return;
        if (!outcome.ok) {
            el('bf-message').textContent = outcome.status === 409
                ? t('backfill.changed') : t(backfillErrorKey(outcome.result.field));
            if (outcome.status === 409) invalidateBackfill();
            return;
        }
        el('bf-message').textContent = t('backfill.applied', {
            changed: outcome.result.changed, batch: outcome.result.batch
        });
        invalidateBackfill();
        await refresh();
    }

    /** 載入最近批次的明細，展開復原確認。 */
    async function showBatch() {
        if (!data.lastBatch) return;
        const outcome = await mutate('backfillBatch', { id: data.lastBatch.id, page: 1 });
        if (!outcome) return;
        if (!outcome.ok) { el('bf-message').textContent = t('saveError'); return; }
        bfBatch = outcome.result;
        renderBatch();
    }

    /** 顯示批次摘要、目前值與復原後值。 */
    function renderBatch() {
        if (!bfBatch) { hideBatch(); return; }
        const batch = bfBatch.batch;
        const fields = [
            batch.setBroadcaster ? t('backfill.field.broadcaster') : null,
            batch.setPurpose ? t('backfill.field.purpose') : null
        ].filter(Boolean).join(' / ') || '—';
        const statusLabel = batch.status === 'unclassified' ? t('unknown')
            : batch.status === 'all' ? t('allStatus') : t(batch.status);
        const parts = [node('p', t('backfill.batchSummary', {
            batch: batch.id, changed: batch.matched, date: date(batch.createdAt),
            platform: batch.platform || t('all'), status: statusLabel
        }), 'plan-muted')];
        parts.push(node('p', t('backfill.batchFields', { fields }), 'plan-muted'));
        if (bfBatch.total > bfBatch.rows.length) {
            parts.push(node('p', t('backfill.batchTruncated', { total: bfBatch.total }), 'plan-muted'));
        }

        const wrap = node('div', undefined, 'table-wrap');
        const table = node('table');
        const thead = document.createElement('thead');
        const head = document.createElement('tr');
        for (const key of ['session', 'platform', 'when', 'current', 'restore']) {
            head.append(node('th', t('backfill.col.' + key)));
        }
        thead.append(head);
        const tbody = document.createElement('tbody');
        for (const row of bfBatch.rows) {
            const deleted = row.platform == null;
            const purpose = value => value ? t(value) : t('inherit');
            const broadcaster = value => value || '—';
            const current = deleted ? t('backfill.deleted')
                : `${broadcaster(row.currentBroadcaster)} / ${purpose(row.currentPurpose)}`;
            const restoreBroadcaster = batch.setBroadcaster ? row.previousBroadcaster : row.currentBroadcaster;
            const restorePurpose = batch.setPurpose ? row.previousPurpose : row.currentPurpose;
            const restore = deleted ? t('backfill.deleted')
                : `${broadcaster(restoreBroadcaster)} / ${purpose(restorePurpose)}`;
            const tr = document.createElement('tr');
            tr.append(
                node('td', `#${row.session}`),
                node('td', row.platform || '—'),
                node('td', deleted ? '—' : date(row.actualStarted ?? row.started)),
                node('td', current),
                node('td', restore)
            );
            tbody.append(tr);
        }
        table.append(thead, tbody);
        wrap.append(table);
        parts.push(wrap);

        const actions = node('div', undefined, 'plan-fields plan-actions');
        const confirm = actionButton(t('backfill.confirmUndo'), () => undoBackfill());
        confirm.id = 'plan-bf-undo-confirm';
        const cancel = actionButton(t('backfill.cancelUndo'), () => hideBatch());
        cancel.className = 'plan-secondary';
        actions.append(confirm, cancel);
        parts.push(actions);

        const target = el('bf-batch');
        target.replaceChildren(...parts);
        target.hidden = false;
    }

    /** 收起復原確認，不變更資料。 */
    function hideBatch() {
        bfBatch = null;
        const target = el('bf-batch');
        target.hidden = true;
        target.replaceChildren();
    }

    /** 確定復原最近一次批次。 */
    async function undoBackfill() {
        if (!data.lastBatch) return;
        const outcome = await mutate('backfillUndo', { id: data.lastBatch.id });
        if (!outcome) return;
        if (!outcome.ok) { el('bf-message').textContent = t('saveError'); return; }
        el('bf-message').textContent = t('backfill.undone', { restored: outcome.result.restored });
        hideBatch();
        await refresh();
    }

    /** 更新補分類表單的平台、時間範圍、主播建議與最近批次，不重建輸入值。 */
    function renderBackfill() {
        const platform = el('bf-platform').value;
        const names = [...new Set([...data.platforms, platform].filter(Boolean))];
        el('bf-platform').replaceChildren(new Option(t('all'), ''), ...names.sort().map(name => new Option(name, name)));
        el('bf-platform').value = platform;

        const days = el('bf-days').value;
        el('bf-days').replaceChildren(
            new Option(t('backfill.allTime'), ''),
            ...[180, 90, 30, 7].map(value => new Option(t('backfill.recent', { days: value }), String(value)))
        );
        el('bf-days').value = days;

        el('bf-broadcaster').placeholder = t('backfill.broadcasterPlaceholder');
        el('bf-use-env').title = t('backfill.useEnvHint');
        const known = new Set(data.broadcasters.map(row => row.broadcaster));
        for (const profile of data.profiles) known.add(profile.broadcaster);
        el('bf-broadcasters').replaceChildren(...[...known].sort().map(name => new Option(name, name)));

        const last = data.lastBatch;
        if (bfBatch && (!last || bfBatch.batch.id !== last.id)) hideBatch();
        el('bf-undo').hidden = !last;
        el('bf-last').textContent = last
            ? t('backfill.last', { batch: last.id, changed: last.matched, platform: last.platform || t('all') })
            : '';
    }

    /** 更新遠端快照；自動輪詢不打斷正在編輯的表單。 */
    async function refresh() {
        clearTimeout(timer);
        if (busy) return;
        busy = true;
        try {
            const response = await fetch(`/api/traffic/planner?platform=${encodeURIComponent(el('platform').value)}&page=${page}&status=${encodeURIComponent(el('status-filter').value)}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('loadError');
            data = await response.json();
            renderSettings();
            renderJobs();
            renderHealth();
            renderAnalysis();
            renderAnalysisTable();
            renderClassification();
            renderBackfill();
        } catch { el('status').textContent = t('loadError'); }
        finally {
            busy = false;
            timer = setTimeout(poll, 60000);
        }
    }

    function poll() {
        if (document.hidden || dirty || document.getElementById('stream-planner').contains(document.activeElement)) {
            timer = setTimeout(poll, 60000);
        } else refresh();
    }

    el('settings').onsubmit = event => {
        event.preventDefault();
        const selected = id => [...el(id).querySelectorAll('input:checked')].map(input => Number(input.value));
        save('settings', {
            enabled: el('enabled').checked, channels: ['ntfy', 'bark'].filter(channel => el(channel).checked),
            timezone: el('zone').value, historyDays: Number(el('history').value), maxPerWeek: Number(el('limit').value),
            weekdays: selected('days'), hours: selected('hours')
        });
    };
    el('platform').onchange = () => { page = 1; refresh(); };
    el('status-filter').onchange = () => { page = 1; refresh(); };
    document.getElementById('stream-planner').addEventListener('input', event => {
        if (event.target !== el('platform') && event.target !== el('status-filter') &&
            !event.target.closest('#plan-backfill')) dirty = true;
    });
    el('prev').onclick = () => { page--; refresh(); };
    el('next').onclick = () => { page++; refresh(); };
    el('tests').onclick = () => save('tests', data.sessions.rows.filter(row => row.effectivePurpose === 'unknown').map(row => row.id));
    el('bf-preview').onclick = previewBackfill;
    el('bf-apply').onclick = applyBackfill;
    el('bf-undo').onclick = showBatch;
    el('bf-use-env').onclick = useEnvIdentity;
    for (const id of ['bf-platform', 'bf-status', 'bf-days', 'bf-complete']) el(id).onchange = invalidateBackfill;
    el('bf-broadcaster').oninput = refreshApplyState;
    el('bf-purpose').onchange = refreshApplyState;
    window.addEventListener('traffic-cleared', refresh);
    document.addEventListener('languagechange', refresh);
    refresh();
})();
