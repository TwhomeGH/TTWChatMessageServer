(() => {
    'use strict';

    const el = id => document.getElementById(id);
    const PAGE_SIZE = 25;

    let rows = [];
    let page = 1;
    let source = null;

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
        const field = el('rule-field').value;
        const action = el('rule-action').value;
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

    /** 目前表單上的測試樣本（暱稱＋內容）。 */
    function sample() {
        return { user: el('rule-sample-user').value, message: el('rule-sample').value };
    }

    /** 候選規則對樣本的判定（依規則對象測暱稱與／或內容）。 */
    function candidateLines(rule, record) {
        const lines = [];
        if (rule.field === 'user' || rule.field === 'any') {
            lines.push('暱稱：' + outcomeText(applyRule(rule, record.user)));
        }
        if (rule.field === 'message' || rule.field === 'any') {
            const rows = record.message ? record.message.split('\n') : [];
            const hits = rows.filter(line => rule.test.test(line)).length;
            lines.push('內容：' + rows.length + ' 行，命中 ' + hits + ' 行');
        }
        return lines;
    }

    /** 把伺服器端「目前生效規則集」的結果寫成一句話。 */
    function actualText(result) {
        if (result.blocked) {
            const field = result.field === 'user' ? '暱稱' : '內容';
            return '⛔ 阻擋（' + (result.reason || '未命名規則') + '／' + field + '）';
        }
        if (!result.modified) return '不變';
        return '改為 → 暱稱「' + result.user + '」／內容「' + result.message + '」';
    }

    /** 用伺服器端「目前生效的規則集」測同一筆，顯示實際結果。 */
    async function checkActual(record) {
        const line = el('rule-actual-result');
        line.textContent = '檢查中…';
        try {
            const response = await fetch('/api/filter/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: record.user, message: record.message }),
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            line.textContent = actualText(await response.json());
        } catch (error) {
            line.textContent = '讀取失敗（' + error.message + '）';
        }
    }

    /** 從歷史挑一筆快速測試：帶入樣本後同時跑候選規則與目前生效規則。 */
    async function quickTest(record) {
        el('rule-sample-user').value = record.user || '';
        el('rule-sample').value = record.message || '';
        updateRulePreview();
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
        } catch (error) {
            status.textContent = '讀取失敗：' + error.message;
            box.replaceChildren();
        }
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
                body: JSON.stringify({ user: el('rule-sample-user').value, messages: lines, stepMs: 1000 }),
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();

            const blocked = data.results.filter(item => item.blocked).length;
            status.textContent = `${data.results.length} 則中 ${blocked} 則被攔、${data.summaries.length} 則摘要`;
            const rows = [['#', '訊息', '結果', '規則']];
            data.results.forEach((item, index) => rows.push([
                index + 1,
                item.message,
                item.blocked ? '⛔ 阻擋' : (item.output !== item.message ? '改寫 → ' + item.output : '放行'),
                item.reason || ''
            ]));
            for (const summary of data.summaries) rows.push(['—', '（摘要）' + summary.message, '', summary.rule]);
            box.replaceChildren(buildTable(rows));
        } catch (error) {
            status.textContent = '讀取失敗：' + error.message;
            box.replaceChildren();
        }
    }

    /** 更新樣本測試、歷史預覽與產生的片段。 */
    function updateRulePreview() {
        el('rule-snippet').textContent = buildSnippet() || '（先填正則）';

        const rule = currentRule();
        const result = el('rule-test-result');
        const history = el('rule-history');
        if (!rule) {
            el('rule-quick-result').textContent = '（先填正則）';
            el('rule-test-status').textContent = '';
            result.replaceChildren();
            history.replaceChildren();
            el('rule-history-status').textContent = '';
            return;
        }

        // 候選規則對樣本的判定（暱稱＋內容）。
        const record = sample();
        const candidate = candidateLines(rule, record);
        el('rule-quick-result').textContent = candidate.length ? candidate.join('\n') : '（先輸入暱稱或內容）';

        // 逐行標出內容命中片段。
        result.replaceChildren();
        const sampleRows = record.message ? record.message.split('\n') : [];
        el('rule-test-status').textContent = sampleRows.length ? '' : '（沒有內容可逐行標示）';
        for (const line of sampleRows) {
            const div = document.createElement('div');
            div.className = 'rule-line';
            div.append(highlight(line, rule.test));
            result.append(div);
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

    // 常用範本：一鍵填好表單，再用測試器確認。
    const PRESETS = {
        'rule-preset-ad': { name: 'user:廣告帳號-加LINE/加瀨', field: 'user', action: 'block', pattern: '加\\s*(LINE|line|ｌｉｎｅ|[瀨濑頼賴])', flags: 'i' },
        'rule-preset-obfuscate': { name: 'any:廣告-混淆字元', field: 'any', action: 'block', pattern: '[\\u2460-\\u24FF]|[\\u{1D400}-\\u{1D7FF}]', flags: 'u' },
        'rule-preset-emoji': { name: 'msg:純emoji洗頻', field: 'message', action: 'block', pattern: '^(?:[\\p{Extended_Pictographic}\\uFE0F\\u200D\\s]){3,}$', flags: 'u' },
        'rule-preset-emoji-run': { name: 'msg:大量 emoji', field: 'message', action: 'block', pattern: '(?:\\p{Extended_Pictographic}[\\uFE0F\\u200D\\u{1F3FB}-\\u{1F3FF}]*){5,}', flags: 'u' },
    };

    function applyPreset(id) {
        const preset = PRESETS[id];
        if (!preset) return;
        el('rule-name').value = preset.name;
        el('rule-field').value = preset.field;
        el('rule-action').value = preset.action;
        el('rule-pattern').value = preset.pattern;
        el('rule-flags').value = preset.flags;
        el('rule-replacement').value = '';
        updateRulePreview();
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
    for (const id of ['rule-field', 'rule-action']) el(id).onchange = updateRulePreview;
    for (const id of Object.keys(PRESETS)) el(id).onclick = () => applyPreset(id);
    el('rule-run-actual').onclick = () => checkActual(sample());
    el('sequence-run').onclick = runSequence;

    el('rule-copy').onclick = async () => {
        const snippet = buildSnippet();
        if (!snippet) return;
        try { await navigator.clipboard.writeText(snippet); el('rule-copy').textContent = '已複製'; }
        catch { el('rule-copy').textContent = '複製失敗'; }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { close(); el('connection').textContent = '暫停更新'; }
        else connect();
    });
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', connect);

    render();
    updateRulePreview();
    loadActiveRules();
    connect();
})();
