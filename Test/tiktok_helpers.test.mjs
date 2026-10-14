import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomStartTime, createStartTimeProbe } from '../ScriptLib/tiktok/viewers.mjs';
import { logRawEvent } from '../ScriptLib/tiktok/rawLog.mjs';
import { buildConnectionOptions } from '../ScriptLib/tiktok/signing.mjs';

const silent = { log() {}, warn() {}, error() {} };

test('roomStartTime：秒／毫秒自動判斷，缺漏或未來時間回 undefined', () => {
    const secs = 1700000000;
    assert.equal(roomStartTime({ data: { start_time: secs } }), new Date(secs * 1000).toISOString());

    const ms = 1700000000000;
    assert.equal(roomStartTime({ data: { create_time: ms } }), new Date(ms).toISOString());

    assert.equal(roomStartTime({ data: {} }), undefined);
    assert.equal(roomStartTime({ data: { start_time: Date.now() + 1e6 } }), undefined);
});

test('createStartTimeProbe：整程只探測一次', () => {
    const logs = [];
    const logger = { log: (...a) => logs.push(a) };
    const probe = createStartTimeProbe(logger);

    probe.probe({ data: { start_time: 1 } }, 'T');
    probe.probe({ data: { start_time: 2 } }, 'T2');

    assert.equal(logs.length, 1);
});

test('buildConnectionOptions：EulerStream、直連與無憑證', () => {
    const euler = buildConnectionOptions({ SIGN_API_KEY: 'k' }, silent);
    assert.equal(euler.mode, 'euler');
    assert.equal(euler.connOpts.signApiKey, 'k');

    const direct = buildConnectionOptions({ SESSION_ID: 's' }, silent);
    assert.equal(direct.mode, 'direct');
    assert.equal(direct.connOpts.session.cookie.value.sessionId, 's');

    const priority = buildConnectionOptions({ SIGN_API_KEY: 'k', SESSION_ID: 's', DIRECT_SIGNER_PRIORITY: '1' }, silent);
    assert.equal(priority.mode, 'direct');

    const none = buildConnectionOptions({}, silent);
    assert.equal(none.mode, 'none');
    assert.deepEqual(none.connOpts, {});
});

test('logRawEvent：無資料與欄位摘要', () => {
    const logs = [];
    const logger = { log: (...a) => logs.push(a.join(' ')) };

    logRawEvent('X', null, logger);
    assert.ok(logs[0].includes('(no data)'));

    logs.length = 0;
    logRawEvent('CHAT', { user: { nickname: 'A', id: 1 }, content: 'hi' }, logger);
    assert.ok(logs[0].includes('CHAT'));
    assert.ok(logs[0].includes('"nickname":"A"'));
});
