import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFilter, processFilter, validateFilterRules } from '../MessageFilter.js';

// 廣告帳號：含簡繁變體與混淆字元（圈號、數學粗體）都要擋下。
test('廣告帳號：簡繁變體與混淆字元', () => {
    assert.equal(checkFilter({ user: '加LINE' }).filtered, true);
    assert.equal(checkFilter({ user: '加 瀨' }).filtered, true);
    assert.equal(checkFilter({ user: '加濑' }).filtered, true);
    assert.equal(checkFilter({ user: '✔️1OOO薹=⑨萬钭＋濑：@TR55' }).reason, 'user:廣告帳號-混淆字元');
    assert.equal(checkFilter({ user: 'normal_user' }).filtered, false);
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
