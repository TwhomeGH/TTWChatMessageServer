(() => {
    'use strict';

    const el = id => document.getElementById(id);
    const PAGE_SIZE = 25;

    let rows = [];
    let page = 1;
    let source = null;
    let activeRuleNames = new Set();   // 目前生效的規則名稱（用來提示候選規則是否已生效）
    let customFileContent = null;      // 快取的自訂規則檔內容（「顯示要貼在哪裡」用）

    const sourceLabel = platform => (platform === 'Unknown' || platform === 'Userscript') ? '未知來源' : platform;
    const transportLabel = transport => transport === 'userscript' ? 'Userscript' : transport === 'api' ? 'API／直連' : '未記錄';
    const time = value => value == null ? '未知' : new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

    /** 建立一格 <td>（可選 class）並附加到該列。 */
    function cell(tr, text, className) {
        const td = document.createElement('td');
        td.textContent = text;
        if (className) td.className = className;
        tr.append(td);
        return td;
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

    /** 在 tbody 放一列「尚無資料」，橫跨 span 欄。 */
    function emptyRow(body, span) {
        const tr = document.createElement('tr');
        const td = cell(tr, '尚無資料', 'empty');
        td.colSpan = span;
        body.append(tr);
    }

    // ===== 統計列表 =====

    function render() {
        const query = el('search').value.trim().toLowerCase();
        const sort = el('sort').value;
        const filtered = rows
            .filter(row => row.message.toLowerCase().includes(query))
            .sort((a, b) => sort === 'firstSeen'
                ? (a.firstSeen ?? Infinity) - (b.firstSeen ?? Infinity)
                : (b[sort] ?? 0) - (a[sort] ?? 0));
        const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        page = Math.min(page, pages);

        el('summary').textContent = filtered.length + ' 種留言 · ' + rows.reduce((n, row) => n + row.count, 0) + ' 次累計';

        const body = el('all');
        body.replaceChildren();
        for (const row of filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
            const tr = document.createElement('tr');
            cell(tr, row.message);
            cell(tr, row.count);
            cell(tr, time(row.firstSeen), 'time');
            cell(tr, time(row.lastSeen), 'time');
            cell(tr, (row.platforms || []).map(sourceLabel).join(' / ') || '未知來源');
            cell(tr, (row.transports || []).map(transportLabel).join('＋') || '未記錄');

            const actions = cell(tr, '');
            const copy = document.createElement('button');
            copy.textContent = '複製';
            copy.onclick = async () => {
                try { await navigator.clipboard.writeText(row.message); copy.textContent = '已複製'; }
                catch { copy.textContent = '複製失敗'; }
            };
            const use = document.createElement('button');
            use.textContent = '快速測試';
            use.onclick = () => {
                const user = (row.recent || []).find(event => event.user)?.user || '';
                quickTest({ message: row.message, user });
                el('rule-quick-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
            };
            actions.append(copy, use);
            body.append(tr);
        }
        if (!filtered.length) emptyRow(body, 7);

        el('page').textContent = page + ' / ' + pages;
        el('prev').disabled = page <= 1;
        el('next').disabled = page >= pages;

        el('top10').replaceChildren();
        for (const [index, row] of [...rows].sort((a, b) => b.count - a.count).slice(0, 10).entries()) {
            const item = document.createElement('div');
            item.className = 'top-item';
            const count = document.createElement('strong');
            count.textContent = row.count;
            const text = document.createElement('div');
            text.textContent = (index + 1) + '. ' + row.message;
            const date = document.createElement('p');
            date.textContent = '最近 ' + time(row.lastSeen);
            item.append(count, text, date);
            el('top10').append(item);
        }

        const recent = el('recent');
        recent.replaceChildren();
        const events = filtered
            .flatMap(row => (row.recent || []).map(event => ({ ...event, message: row.message })))
            .sort((a, b) => b.receivedAt - a.receivedAt)
            .slice(0, 200);
        for (const event of events) {
            const tr = document.createElement('tr');
            cell(tr, event.message);
            cell(tr, time(event.sentAt ?? event.receivedAt), 'time');
            cell(tr, event.sentAt == null ? '接收時間' : '平台時間');
            cell(tr, event.user || '未知');
            cell(tr, sourceLabel(event.platform) || '未知來源');
            cell(tr, transportLabel(event.transport) + (event.isTest ? '（測試）' : ''));

            const quick = document.createElement('button');
            quick.textContent = '快速測試';
            quick.onclick = () => {
                quickTest({ message: event.message, user: event.user });
                el('rule-quick-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
            };
            cell(tr, '').append(quick);
            recent.append(tr);
        }
        if (!events.length) emptyRow(recent, 7);
    }

    // ===== 規則產生器與測試 =====

    /**
     * 依目前表單組出可貼進 FilterRules.custom.js 的片段。
     * 正則直接以字面值輸出，所以要把 `/` 與換行轉義。
     */
    function buildSnippet() {
        const name = el('rule-name').value.trim() || '自訂規則';
        const action = el('rule-action').value;

        if (action === 'throttle') {
            const similarity = el('rule-similarity').value;
            const onExceed = el('rule-onexceed').value;
            const marker = el('rule-marker').value.replace(/'/g, "\\'");
            return [
                `{ name: '${name}', action: 'throttle',`,
                `  scope: '${el('rule-scope').value}', windowMs: ${(Number(el('rule-window').value) || 10) * 1000}, max: ${Number(el('rule-max').value) || 0},`,
                `  similarity: '${similarity}',${similarity === 'normalized' ? ` distance: ${Number(el('rule-distance').value) || 0},` : ''}`,
                `  onExceed: '${onExceed}'${onExceed === 'marker' ? `, marker: '${marker || '（×{n}）'}'` : ''} },`
            ].join('\n');
        }

        const field = el('rule-field').value;
        const pattern = el('rule-pattern').value.replace(/\//g, '\\/').replace(/\n/g, '\\n');
        const flags = el('rule-flags').value.trim();
        if (!pattern) return '';

        if (action === 'block') {
            return `{ name: '${name}', field: '${field}', action: 'block',\n  test: (v) => /${pattern}/${flags}.test(v) },`;
        }
        const replacement = action === 'replace'
            ? `, replacement: '${el('rule-replacement').value.replace(/'/g, "\\'")}'`
            : '';
        return `{ name: '${name}', field: '${field}', action: '${action}',\n  match: /${pattern}/${flags}${replacement} },`;
    }

    /** 把符合的片段用 <mark> 標出；零長度命中要中斷，避免無限迴圈。 */
    function highlight(text, regex) {
        const fragment = document.createDocumentFragment();
        const global = new RegExp(regex.source, regex.flags.replace(/[gy]/g, '') + 'g');
        let last = 0;
        for (const match of text.matchAll(global)) {
            if (match.index > last) fragment.append(text.slice(last, match.index));
            const mark = document.createElement('mark');
            mark.textContent = match[0];
            fragment.append(mark);
            last = match.index + match[0].length;
            if (match[0] === '') break;
        }
        fragment.append(text.slice(last));
        return fragment;
    }

    /** 讀表單並編譯正則；語法錯誤時顯示訊息並回傳 null。 */
    function currentRule() {
        if (el('rule-action').value === 'throttle') return null;   // 頻率規則沒有單筆正則
        const pattern = el('rule-pattern').value;
        if (!pattern) return null;
        const flags = el('rule-flags').value;
        try {
            return {
                test: new RegExp(pattern, flags.replace(/[gy]/g, '')), // 去掉 g/y，test() 才不會有 lastIndex 狀態
                match: new RegExp(pattern, flags),                      // 取代時沿用使用者旗標（含 g）
                action: el('rule-action').value,
                field: el('rule-field').value,
                replacement: el('rule-replacement').value,
            };
        } catch (error) {
            el('rule-test-status').textContent = '正則語法錯誤：' + error.message;
            return null;
        }
    }

    /** 套用目前規則到一個值，回傳 { matched, blocked, result }。 */
    function applyRule(rule, value) {
        if (!value || !rule.test.test(value)) return { matched: false };
        if (rule.action === 'block') return { matched: true, blocked: true };
        return { matched: true, result: value.replace(rule.match, rule.action === 'delete' ? '' : rule.replacement) };
    }

    /** 把一個判定寫成一句話（不含欄位名，由呼叫端加）。 */
    function outcomeText(outcome) {
        if (!outcome.matched) return '不變';
        if (outcome.blocked) return '⛔ 阻擋';
        return '改為「' + outcome.result + '」';
    }

    /** 逐段標出註解、字串與數字（極簡上色；不解析語法）。 */
    function appendTokens(parent, line) {
        const pattern = /(\/\/.*$)|('[^']*'|"[^"]*")|(\b\d+\b)/g;
        let last = 0;
        for (const match of line.matchAll(pattern)) {
            if (match.index > last) parent.append(line.slice(last, match.index));
            const span = document.createElement('span');
            span.className = match[1] ? 'js-comment' : match[2] ? 'js-string' : 'js-number';
            span.textContent = match[0];
            parent.append(span);
            last = match.index + match[0].length;
        }
        parent.append(line.slice(last));
    }

    /** 極簡 JS 上色：整行註解、插入標記、字串與數字各自一色。 */
    function highlightJs(text) {
        const fragment = document.createDocumentFragment();
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            const span = document.createElement('span');
            if (line.includes('↓↓↓') || line.includes('↑↑↑')) {
                span.className = 'js-marker';
                span.textContent = line;
            } else if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                span.className = 'js-comment';
                span.textContent = line;
            } else {
                appendTokens(span, line);
            }
            fragment.append(span, '\n');
        }
        return fragment;
    }

    /** 目前表單上的測試樣本（暱稱＋內容）。 */
    function sample() {
        return { user: el('rule-sample-user').value, message: el('rule-sample').value };
    }

    /** 候選規則要顯示的樣本列：`[標籤, 原始值, 判定]`。 */
    function candidateRows(rule, record) {
        const rows = [];
        if (rule.field === 'user' || rule.field === 'any') {
            rows.push(['暱稱', record.user, applyRule(rule, record.user)]);
        }
        if (rule.field === 'message' || rule.field === 'any') {
            (record.message ? record.message.split('\n') : []).forEach((line, index) => {
                rows.push(['內容 ' + (index + 1), line, applyRule(rule, line)]);
            });
        }
        return rows;
    }

    /** 右下角短暫提示：讓使用者知道按鈕有反應，以及測試結果。 */
    function toast(text, ms = 2600) {
        let box = document.getElementById('toast');
        if (!box) {
            box = document.createElement('div');
            box.id = 'toast';
            document.body.append(box);
        }
        box.textContent = text;
        box.classList.add('show');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => box.classList.remove('show'), ms);
    }

    /** 建立「樣本／原始（命中處標色）／結果」表格。 */
    function buildOutcomeTable(rows, rule) {
        const table = document.createElement('table');
        const head = document.createElement('tr');
        for (const text of ['樣本', '原始（命中處標色）', '結果']) {
            const th = document.createElement('th');
            th.textContent = text;
            head.append(th);
        }
        table.append(head);

        for (const [label, original, outcome] of rows) {
            const tr = document.createElement('tr');
            cell(tr, label);
            const source = document.createElement('td');
            source.append(highlight(original || '（空）', rule.test));
            tr.append(source);
            cell(tr, outcomeText(outcome));
            table.append(tr);
        }
        return table;
    }

    /** 把伺服器端「目前生效規則集」的結果寫成一句話。 */
    function actualText(result) {
        if (result.blocked) {
            const field = result.field === 'user' ? '暱稱' : result.field === 'message' ? '內容' : '頻率';
            return '⛔ 阻擋（規則：' + (result.reason || '未命名') + '／對象：' + field + '）';
        }
        if (!result.modified) return '不變';
        return '改為 → 暱稱「' + result.user + '」／內容「' + result.message + '」';
    }

    /** 用伺服器端「目前生效的規則集」測同一筆，顯示實際結果。 */
    async function checkActual(record) {
        const line = el('rule-actual-result');
        const original = '原始：暱稱「' + (record.user || '') + '」／內容「' + (record.message || '') + '」\n';
        line.textContent = original + '結果：檢查中…';
        try {
            const response = await fetch('/api/filter/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: record.user, message: record.message }),
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const text = actualText(await response.json());
            line.textContent = original + '結果：' + text;
            toast('目前生效規則：' + text);
        } catch (error) {
            line.textContent = original + '結果：讀取失敗（' + error.message + '）';
            toast('測試失敗：' + error.message);
        }
    }

    /** 從歷史挑一筆快速測試：帶入樣本後同時跑候選規則與目前生效規則。 */
    async function quickTest(record) {
        el('rule-sample-user').value = record.user || '';
        el('rule-sample').value = record.message || '';
        updateRulePreview();

        // 立刻給回饋，避免使用者以為「點了沒反應」。
        const rule = currentRule();
        if (!rule) {
            toast('已帶入樣本，但還沒填正則，無法測候選規則。');
        } else {
            const rows = candidateRows(rule, sample());
            const blocked = rows.filter(row => row[2].blocked).length;
            toast('已帶入樣本並測試（候選規則）：' + (rows.length
                ? rows.length + ' 筆樣本' + (blocked ? '，' + blocked + ' 筆會阻擋' : '，都不會被擋')
                : '沒有樣本'));
        }

        await checkActual(record);
    }

    /** 讀取並列出目前生效的規則（名稱／對象／動作）。 */
    async function loadActiveRules() {
        const status = el('rule-active-status');
        const box = el('rule-active');
        try {
            const response = await fetch('/api/filter/rules', { cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const { rules } = await response.json();
            activeRuleNames = new Set(rules.map(rule => rule.name));
            status.textContent = '共 ' + rules.length + ' 條（內建 + 自訂，合併後依序套用；block 會中斷，replace/delete 會改值）';

            const table = document.createElement('table');
            const head = document.createElement('tr');
            for (const text of ['規則名稱', '對象', '動作', '說明']) {
                const th = document.createElement('th');
                th.textContent = text;
                head.append(th);
            }
            table.append(head);
            for (const rule of rules) {
                const tr = document.createElement('tr');
                cell(tr, rule.name);
                cell(tr, rule.field ?? '');
                cell(tr, rule.action);
                cell(tr, rule.detail ?? '');
                table.append(tr);
            }
            box.replaceChildren(table);
            updateSnippetState();
        } catch (error) {
            status.textContent = '讀取失敗：' + error.message;
            box.replaceChildren();
        }
    }

    /** 複製文字到剪貼簿，按鈕文字暫時改成結果。 */
    async function copyText(text, button) {
        const label = button.textContent;
        try {
            await navigator.clipboard.writeText(text);
            button.textContent = '已複製';
            toast('已複製到剪貼簿');
        } catch {
            button.textContent = '複製失敗';
            toast('複製失敗（瀏覽器未授權剪貼簿）');
        }
        setTimeout(() => { button.textContent = label; }, 1600);
    }

    /**
     * 產生「貼在哪裡」的參考：檔尾最後幾行 + 片段貼上後的位置。
     * 只給視覺引導，不提供整檔覆蓋（避免覆蓋錯或語法錯誤的風險）。
     */
    function insertSnippet(content, snippet) {
        const tail = content.match(/\]\s*;?\s*$/);   // 檔尾的 `];`
        const head = tail ? content.slice(0, tail.index) : content;
        const end = tail ? content.slice(tail.index) : '];';

        const headLines = head.split('\n');
        const context = headLines.slice(-8).join('\n').replace(/\s*$/, '\n');
        const omitted = headLines.length > 8 ? '    // …（前面略）\n' : '';
        const block = snippet.split('\n').map(line => '    ' + line).join('\n');

        return [
            omitted + context,
            '    // ✏️ 片段貼在這裡（就在這行下面）↓↓↓',
            block,
            '    // ↑↑↑ 片段結束 ↑↑↑',
            '',
            end
        ].join('\n');
    }

    /** 依目前片段重畫「貼在哪裡」引導（已顯示時，規則變動會即時跟著更新）。 */
    function renderInsert() {
        const snippet = buildSnippet();
        if (!snippet || customFileContent === null) return;
        el('rule-insert-content').replaceChildren(highlightJs(insertSnippet(customFileContent, snippet)));
        el('rule-insert').hidden = false;
        el('rule-show-insert').textContent = '隱藏貼上位置';
    }

    /** 讀使用者的 FilterRules.custom.js（首次讀取後快取），顯示/隱藏「貼在哪裡」引導。 */
    async function showInsert() {
        const box = el('rule-insert');
        // 由使用者自己控制開關：顯示中再按一次就收起，不會自動隱藏。
        if (!box.hidden) {
            box.hidden = true;
            el('rule-show-insert').textContent = '顯示要貼在哪裡';
            return;
        }

        if (!buildSnippet()) { toast('先填好規則，再按「顯示要貼在哪裡」。'); return; }

        try {
            if (customFileContent === null) {
                const response = await fetch('/api/filter/custom', { cache: 'no-store' });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                customFileContent = data.content || 'export default [\n];\n';
                el('rule-insert-path').textContent = data.path || 'FilterRules.custom.js';
            }
            renderInsert();
            toast('已標出片段要貼的位置（只複製上面的片段即可）');
        } catch (error) {
            box.hidden = true;
            toast('讀取自訂規則檔失敗：' + error.message);
        }
    }

    /** 提示產生的規則是否已在「目前生效清單」裡（比對規則名稱）。 */
    function updateSnippetState() {
        const state = el('rule-active-state');
        const name = el('rule-name').value.trim();
        if (!name) { state.textContent = ''; return; }
        state.textContent = activeRuleNames.has(name)
            ? '✅「' + name + '」已在目前生效清單裡'
            : '⚠️「' + name + '」目前未生效——按「複製片段」貼到 FilterRules.custom.js 的 export default [ ... ] 後重啟主服務（比對規則名稱）。';
    }

    /** 用目前生效的規則跑一串訊息，看頻率規則的實際行為（模擬每 1 秒一則）。 */
    async function runSequence() {
        const status = el('sequence-status');
        const box = el('sequence-result');
        const lines = el('sequence-lines').value.split('\n').map(line => line.trim()).filter(Boolean);
        if (!lines.length) {
            status.textContent = '先貼上至少一則訊息。';
            box.replaceChildren();
            return;
        }

        status.textContent = '執行中…';
        try {
            const response = await fetch('/api/filter/sequence', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: el('sequence-user').value || el('rule-sample-user').value, messages: lines, stepMs: 1000, rule: candidateThrottleRule() }),
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();

            const blocked = data.results.filter(item => item.blocked).length;
            const rewritten = data.results.filter(item => !item.blocked && item.output !== item.message).length;
            status.textContent = `${data.results.length} 則中 ${blocked} 則被攔、${rewritten} 則改寫、${data.summaries.length} 則摘要（每則間隔 1 秒；摘要在爆量結束後才送）`;

            // 時間欄：相對第一則的偏移，讓「摘要不是即時」看得出來。
            const start = data.results.length ? data.results[0].time : Date.now();
            const at = value => '+' + ((value - start) / 1000).toFixed(1) + 's';
            const rows = [['#', '時間', '訊息', '結果', '規則']];
            data.results.forEach((item, index) => rows.push([
                index + 1,
                at(item.time),
                item.message,
                item.blocked ? '⛔ 阻擋' : (item.output !== item.message ? '改寫 → ' + item.output : '放行'),
                item.reason || ''
            ]));
            for (const summary of data.summaries) rows.push([
                '—',
                summary.at ? at(summary.at) : '—',
                '🗒️ ' + summary.message,
                '摘要（爆量結束後，輪詢最多再 +5 秒）',
                summary.rule
            ]);
            box.replaceChildren(buildTable(rows));
        } catch (error) {
            status.textContent = '讀取失敗：' + error.message;
            box.replaceChildren();
        }
    }

    /** 更新候選規則的「每筆樣本套用後」表格、歷史預覽與產生的片段。 */
    function updateRulePreview() {
        el('rule-snippet').replaceChildren(highlightJs(buildSnippet() || '（先填正則）'));
        updateSnippetState();
        if (!el('rule-insert').hidden) renderInsert();   // 已顯示時跟著更新，不自動隱藏

        const rule = currentRule();
        const box = el('rule-test-result');
        const history = el('rule-history');
        if (!rule) {
            el('rule-test-status').textContent = el('rule-action').value === 'throttle'
                ? '（throttle 是跨訊息的頻率規則，沒有單筆正則；請用下方 ④ 序列測試）'
                : '';
            box.replaceChildren();
            history.replaceChildren();
            el('rule-history-status').textContent = '';
            return;
        }

        // 候選規則：列出每筆樣本「原始 → 結果」。
        const record = sample();
        const rows = candidateRows(rule, record);

        if (!rows.length) {
            el('rule-test-status').textContent = '先輸入暱稱或內容。';
            box.replaceChildren();
        } else {
            const blocked = rows.filter(row => row[2].blocked).length;
            el('rule-test-status').textContent = rows.length + ' 筆樣本' + (blocked ? '，其中 ' + blocked + ' 筆會被阻擋' : '');
            box.replaceChildren(buildOutcomeTable(rows, rule));
        }

        // 歷史預覽：對目前載入的統計跑一次，先看會不會誤殺。
        const matched = [];
        for (const row of rows) {
            const where = [];
            if (rule.field === 'message' || rule.field === 'any') {
                if (rule.test.test(row.message)) where.push('內容');
            }
            if (rule.field === 'user' || rule.field === 'any') {
                const users = [...new Set((row.recent || []).map(event => event.user).filter(Boolean))];
                if (users.some(user => rule.test.test(user))) where.push('暱稱');
            }
            if (where.length) matched.push({ message: row.message, count: row.count, where: where.join('＋') });
        }

        el('rule-history-status').textContent = matched.length
            ? `命中 ${matched.length} 種留言（依目前載入的統計）`
            : '目前統計中沒有命中';

        history.replaceChildren();
        const table = document.createElement('table');
        const head = document.createElement('tr');
        for (const text of ['訊息內容', '次數', '命中欄位']) {
            const th = document.createElement('th');
            th.textContent = text;
            head.append(th);
        }
        table.append(head);
        for (const item of matched.slice(0, 50)) {
            const tr = document.createElement('tr');
            cell(tr, item.message);
            cell(tr, item.count);
            cell(tr, item.where);
            table.append(tr);
        }
        history.append(table);
    }

    /** 依動作切換表單：throttle 顯示頻率欄位，其餘顯示正則欄位。 */
    function syncRuleForm() {
        const throttle = el('rule-action').value === 'throttle';
        el('rule-throttle-fields').hidden = !throttle;
        for (const id of ['rule-pattern-label', 'rule-flags-label', 'rule-replacement-label']) el(id).hidden = throttle;
        el('rule-field').closest('label').hidden = throttle;
        updateRulePreview();
    }

    /** 若 ① 目前是 throttle 規則，回傳它（序列測試會把它接在線上規則後一起跑）。 */
    function candidateThrottleRule() {
        if (el('rule-action').value !== 'throttle') return null;
        return {
            name: el('rule-name').value.trim() || '候選 throttle',
            action: 'throttle',
            scope: el('rule-scope').value,
            windowMs: (Number(el('rule-window').value) || 10) * 1000,
            max: Number(el('rule-max').value) || 0,
            similarity: el('rule-similarity').value,
            distance: Number(el('rule-distance').value) || 0,
            onExceed: el('rule-onexceed').value,
            marker: el('rule-marker').value || '（×{n}）'
        };
    }

    // 常用範本：一鍵填好表單，再用測試器確認。
    const PRESETS = {
        'rule-preset-ad': { name: 'user:廣告帳號-加LINE/加瀨', field: 'user', action: 'block', pattern: '加\\s*(LINE|line|ｌｉｎｅ|[瀨濑頼賴])', flags: 'i', sampleUser: '加賴看片88' },
        'rule-preset-obfuscate': { name: 'any:廣告-混淆字元', field: 'any', action: 'block', pattern: '[\\u2460-\\u24FF]|[\\u{1D400}-\\u{1D7FF}]', flags: 'u', sampleUser: '✔️1OOO薹=⑨萬钭＋濑：@TR55' },
        'rule-preset-emoji': { name: 'msg:純emoji洗頻', field: 'message', action: 'block', pattern: '^(?:[\\p{Extended_Pictographic}\\uFE0F\\u200D\\s]){3,}$', flags: 'u', sampleMessage: '😌😌😌😌😉' },
        'rule-preset-emoji-run': { name: 'msg:大量 emoji', field: 'message', action: 'block', pattern: '(?:\\p{Extended_Pictographic}[\\uFE0F\\u200D\\u{1F3FB}-\\u{1F3FF}]*){5,}', flags: 'u', sampleMessage: '😌😌😌😌😉\n😄😄' },
        'rule-preset-buyme': { name: 'msg:廣告-補幣/按我頭像', field: 'message', action: 'block', pattern: '補[幣币]|按我頭像', flags: '', sampleMessage: '補幣中，按我頭像' },
        'rule-preset-url': { name: 'msg:刪除網址', field: 'message', action: 'delete', pattern: 'https?://\\S+', flags: 'g', sampleMessage: '來看我直播 https://example.com/abc 謝謝' },
        'rule-preset-profanity': { name: 'msg:遮罩髒話', field: 'message', action: 'replace', pattern: '他媽的|操你媽|幹你娘', flags: 'g', replacement: '***', sampleMessage: '他媽的這也太扯' },
    };

    function applyPreset(id) {
        const preset = PRESETS[id];
        if (!preset) return;
        el('rule-name').value = preset.name;
        el('rule-field').value = preset.field;
        el('rule-action').value = preset.action;
        el('rule-pattern').value = preset.pattern;
        el('rule-flags').value = preset.flags;
        el('rule-replacement').value = preset.replacement ?? '';
        // 一併帶入示範樣本，按下去就能看到「原始 → 結果」。
        el('rule-sample-user').value = preset.sampleUser ?? '';
        el('rule-sample').value = preset.sampleMessage ?? '';
        syncRuleForm();
    }

    // 序列測試的快速範例：會設定 ① 的 throttle 規則並帶入序列，按下去直接跑。
    const SEQUENCE_PRESETS = {
        'seq-preset-spam': {
            rule: { scope: 'user', windowSec: 10, max: 3, similarity: 'normalized', distance: 2, onExceed: 'drop' },
            lines: ['😛😛😛😛😛', '😂😂😂😂😂', '😁😁😁😁😁', '😅😅😅😅😅', '😄😄😄😄😄']
        },
        'seq-preset-drift': {
            rule: { scope: 'user', windowSec: 10, max: 3, similarity: 'normalized', distance: 2, onExceed: 'drop' },
            lines: ['哈囉大家好', '哈囉大家好', '哈囉大家好', '哈囉大家好呀', '哈囉大家好']
        },
        'seq-preset-marker': {
            rule: { scope: 'user', windowSec: 10, max: 2, similarity: 'normalized', distance: 1, onExceed: 'marker', marker: '{text}（×{n}）' },
            lines: ['SPAM', 'SPAM', 'SPAM', 'SPAM']
        },
        'seq-preset-summarize': {
            rule: { scope: 'user', windowSec: 10, max: 2, similarity: 'normalized', distance: 0, onExceed: 'summarize' },
            lines: ['SPAM', 'SPAM', 'SPAM', 'SPAM', 'SPAM']
        },
    };

    /** 套用序列範例：設定 throttle 規則 + 帶入序列，並立刻跑一次。 */
    function applySequencePreset(id) {
        const preset = SEQUENCE_PRESETS[id];
        if (!preset) return;
        el('rule-name').value = 'throttle:' + id.replace('seq-preset-', '');
        el('rule-action').value = 'throttle';
        el('rule-scope').value = preset.rule.scope;
        el('rule-window').value = preset.rule.windowSec;
        el('rule-max').value = preset.rule.max;
        el('rule-similarity').value = preset.rule.similarity;
        el('rule-distance').value = preset.rule.distance ?? 2;
        el('rule-onexceed').value = preset.rule.onExceed;
        el('rule-marker').value = preset.rule.marker ?? '';
        // 示範用一般暱稱，避免 any 類規則（例如混淆字元）把整個序列都擋掉而看不出頻率效果。
        el('sequence-user').value = 'demo_user';
        el('sequence-lines').value = preset.lines.join('\n');
        syncRuleForm();
        runSequence();
    }

    // ===== 即時連線 =====

    function connect() {
        if (source || document.hidden) return;
        source = new EventSource('/status/keyword');
        source.onopen = () => el('connection').textContent = '即時更新中';
        source.onerror = () => el('connection').textContent = '連線中斷，重試中';
        source.onmessage = event => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'all' && Array.isArray(message.data)) {
                    rows = message.data;
                    render();
                    updateRulePreview();
                }
            } catch { el('connection').textContent = '資料格式錯誤'; }
        };
    }

    function close() {
        source?.close();
        source = null;
    }

    // ===== 事件綁定 =====

    el('search').oninput = el('sort').onchange = () => { page = 1; render(); };
    el('prev').onclick = () => { page--; render(); };
    el('next').onclick = () => { page++; render(); };

    el('clearBtn').onclick = async () => {
        if (!confirm('確定清空留言統計與最近紀錄？')) return;
        el('clearBtn').disabled = true;
        try {
            const response = await fetch('/keyword/clear', { method: 'POST' });
            const data = await response.json();
            if (!data.success) throw new Error(data.error || '清空失敗');
            rows = [];
            page = 1;
            render();
            updateRulePreview();
        } catch (error) { alert(error.message); }
        finally { el('clearBtn').disabled = false; }
    };

    for (const id of ['rule-name', 'rule-pattern', 'rule-flags', 'rule-replacement', 'rule-sample', 'rule-sample-user']) {
        el(id).oninput = updateRulePreview;
    }
    el('rule-field').onchange = updateRulePreview;
    el('rule-action').onchange = syncRuleForm;
    for (const id of Object.keys(PRESETS)) el(id).onclick = () => applyPreset(id);
    for (const id of Object.keys(SEQUENCE_PRESETS)) el(id).onclick = () => applySequencePreset(id);
    el('rule-run-actual').onclick = () => checkActual(sample());
    el('sequence-run').onclick = runSequence;

    el('rule-copy').onclick = () => {
        const snippet = buildSnippet();
        if (snippet) copyText(snippet, el('rule-copy'));
    };
    el('rule-show-insert').onclick = showInsert;

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { close(); el('connection').textContent = '暫停更新'; }
        else connect();
    });
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', connect);

    render();
    syncRuleForm();
    loadActiveRules();
    connect();
})();
