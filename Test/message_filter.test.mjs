import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFilter, processFilter, validateFilterRules, addFilterRule, clearFilterRules, simulateSequence } from '../MessageFilter.js';

// 廣告帳號：含簡繁變體與混淆字元（圈號、數學粗體）都要擋下。
test('廣告帳號：簡繁變體與混淆字元', () => {
    assert.equal(checkFilter({ user: '加LINE' }).filtered, true);
    assert.equal(checkFilter({ user: '加 瀨' }).filtered, true);
    assert.equal(checkFilter({ user: '加濑' }).filtered, true);
    assert.equal(checkFilter({ user: '✔️1OOO薹=⑨萬钭＋濑：@TR55' }).reason, 'any:廣告-混淆字元');
    assert.equal(checkFilter({ user: 'normal_user' }).filtered, false);
});

// 混淆字元與大量 emoji 都要涵蓋「內容」欄位（只檢查暱稱會漏；也預先涵蓋帳號名塞內容的情境）。
test('混淆字元與大量 emoji 在內容也會被擋', () => {
    const embedded = '😌😌😌😌😉\n✔️1OOO薹=⑨萬钭＋濑：@tw77';
    assert.equal(checkFilter({ user: '你好', message: embedded }).filtered, true);
    assert.equal(checkFilter({ user: 'a', message: '😂😂😂😂😂' }).reason, 'msg:大量 emoji');
    assert.equal(checkFilter({ user: 'a', message: '哈哈😄😄' }).filtered, false);
});

// 補幣／按我頭像的廣告直接阻擋，不再改寫成梗（改寫等於變相洗版）。
test('廣告訊息直接阻擋', () => {
    assert.equal(processFilter({ user: 'a', message: '補幣中，按我頭像' }).blocked, true);
    assert.equal(processFilter({ user: 'a', message: '補币中，按我頭像' }).reason, 'msg:廣告-補幣/按我頭像');
});

// delete 會改值。
test('內容處理：delete 會改值', () => {
    const cleaned = processFilter({ user: 'a✔️b', message: 'hi' });
    assert.equal(cleaned.user, 'ab');
});

// 自訂規則檔的驗證：欄位與動作不合法、缺少 test/match 的一律剔除。
test('validateFilterRules 只留下格式正確的規則', () => {
    const rules = validateFilterRules([
        { name: 'ok', field: 'message', action: 'block', test: () => true },
        { name: 'ok2', field: 'user', action: 'delete', match: /x/g },
        { name: 'bad-field', field: 'nope', action: 'block', test: () => true },
        { name: 'bad-block', field: 'message', action: 'block' },
        { name: 'bad-replace', field: 'message', action: 'replace' },
        null,
    ]);
    assert.deepEqual(rules.map(rule => rule.name), ['ok', 'ok2']);
});

// 頻率控制：drop／marker／summarize 三種處置、編輯距離、跨人與視窗。
// 這個測試會 clearFilterRules()，所以放在最後，避免影響前面的內建規則測試。
test('頻率控制：三種處置、編輯距離、跨人與視窗', () => {
    const base = { action: 'throttle', scope: 'user', windowMs: 10000, max: 2, similarity: 'normalized', distance: 1, onExceed: 'drop' };

    // drop：第 3 則起被擋（'HELL0' 與 'HELLO' 編輯距離 1，算同一群）
    clearFilterRules();
    addFilterRule({ ...base, name: 'test:drop' });
    assert.deepEqual(simulateSequence({ user: 'u1', messages: ['HELLO', 'HELL0', 'HELLO'], stepMs: 1000 }).results.map(r => r.blocked), [false, false, true]);
    // 間隔超過視窗就不算同一群
    assert.deepEqual(simulateSequence({ user: 'u2', messages: ['GAP', 'GAP', 'GAP'], stepMs: 20000 }).results.map(r => r.blocked), [false, false, false]);

    // marker：第 3 則起整串取代成標記（預設只留標記）
    clearFilterRules();
    addFilterRule({ ...base, name: 'test:marker', onExceed: 'marker', marker: '（×{n}）' });
    const marker = simulateSequence({ user: 'u3', messages: ['SPAM', 'SPAM', 'SPAM'], stepMs: 1000 });
    assert.equal(marker.results[2].blocked, false);
    assert.equal(marker.results[2].output, '（×3）');

    // marker 用 {text} 可保留原文
    clearFilterRules();
    addFilterRule({ ...base, name: 'test:marker-text', onExceed: 'marker', marker: '{text}（×{n}）' });
    const withText = simulateSequence({ user: 'u5', messages: ['SPAM', 'SPAM', 'SPAM'], stepMs: 1000 });
    assert.equal(withText.results[2].output, 'SPAM（×3）');

    // summarize：第 3 則起擋掉，爆量結束後補一則摘要
    clearFilterRules();
    addFilterRule({ ...base, name: 'test:summarize', onExceed: 'summarize' });
    const summarize = simulateSequence({ user: 'u4', messages: ['X', 'X', 'X', 'X'], stepMs: 1000 });
    assert.deepEqual(summarize.results.map(r => r.blocked), [false, false, true, true]);
    assert.equal(summarize.summaries.length, 1);
    assert.equal(summarize.summaries[0].count, 2);

    // 跨人：scope=content 時不同人打同一句算同一群
    clearFilterRules();
    addFilterRule({ ...base, name: 'test:content', scope: 'content', max: 1 });
    const cross = simulateSequence({ messages: [{ user: 'a', message: 'SAME' }, { user: 'b', message: 'SAME' }, { user: 'c', message: 'SAME' }], stepMs: 1000 });
    assert.deepEqual(cross.results.map(r => r.blocked), [false, true, true]);
});
