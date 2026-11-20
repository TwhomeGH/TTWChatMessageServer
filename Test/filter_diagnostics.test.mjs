import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilterDiagnostics } from '../ScriptLib/filters/diagnostics.mjs';
import { processFilter, getFilterDiagnostics } from '../MessageFilter.js';

test('過濾器診斷分開 passed／blocked／modified，且不保存訊息本文', () => {
    let now = 100;
    const diagnostics = createFilterDiagnostics({ recentLimit: 2, now: () => now++ });
    diagnostics.record({ user: 'Alice', message: 'secret message' }, { blocked: false, modified: false });
    diagnostics.record({ user: 'Bob', message: 'spam text' }, { blocked: true, reason: 'msg:廣告', field: 'message', ad: true });
    diagnostics.record({ user: 'Cara', message: 'masked' }, { blocked: false, modified: true });

    const snapshot = diagnostics.snapshot();
    assert.equal(snapshot.evaluated, 3);
    assert.equal(snapshot.passed, 1);
    assert.equal(snapshot.blocked, 1);
    assert.equal(snapshot.modified, 1);
    assert.equal(snapshot.adBlocked, 1);
    assert.equal(snapshot.byReason['msg:廣告'], 1);
    assert.equal(snapshot.byField.message, 1);
    assert.equal(snapshot.recent.length, 2);
    assert.equal(snapshot.recent[0].user, 'Bob');
    assert.equal('message' in snapshot.recent[0], false);
    assert.equal(snapshot.recent[0].length, 9);
});

test('過濾器診斷列出規則與 throttle 活動群組', () => {
    const throttleRule = {
        name: 'msg:洗頻', action: 'throttle', field: 'message', scope: 'user',
        windowMs: 1000, max: 2, onExceed: 'summarize'
    };
    const blockRule = { name: 'msg:廣告', action: 'block', field: 'message' };
    const state = new Map([[throttleRule, [
        { count: 3, pending: 2, time: 500 },
        { count: 1, pending: 0, time: 600 }
    ]]]);
    const diagnostics = createFilterDiagnostics({ now: () => 1000 });
    const snapshot = diagnostics.snapshot({ rules: [blockRule, throttleRule], throttleState: state });
    assert.equal(snapshot.rules.length, 2);
    assert.equal(snapshot.rules[1].throttle.max, 2);
    assert.equal(snapshot.throttle.length, 1);
    assert.equal(snapshot.throttle[0].activeGroups, 2);
    assert.equal(snapshot.throttle[0].pending, 2);
    assert.equal(snapshot.throttle[0].oldestAt, 500);
});

test('processFilter 會更新全域過濾器診斷', () => {
    const before = getFilterDiagnostics();
    const result = processFilter({ user: 'u', message: '補幣' });
    const after = getFilterDiagnostics();
    assert.equal(result.blocked, true);
    assert.ok(after.evaluated >= before.evaluated + 1);
    assert.ok(after.blocked >= before.blocked + 1);
    assert.ok(after.byReason['msg:廣告-補幣/按我頭像'] >= 1);
});
