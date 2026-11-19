import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocketAlertPolicy } from '../ScriptLib/socket/alert.mjs';

const logger = { warn() {} };
const success = [{ channel: 'bark', ok: true }];

function setup({ threshold = 3, repeatMs = 60000, channels = () => ['bark'] } = {}) {
    let current = 1000000;
    let channelGetter = channels;
    const calls = [];
    const policy = createSocketAlertPolicy({
        notify: (title, comment) => { calls.push({ title, comment }); return Promise.resolve(success); },
        channels: () => channelGetter(), threshold, repeatMs, logger, now: () => current
    });
    return { policy, calls, advance: ms => { current += ms; }, setChannels: value => { channelGetter = value; } };
}

test('連續失敗達門檻才通知，並依重複間隔抑制', () => {
    const { policy, calls, advance } = setup({ threshold: 3, repeatMs: 60000 });
    for (let retries = 1; retries <= 2; retries++) policy.failure({ host: '192.168.0.159', port: 9322, retries });
    assert.equal(calls.length, 0);
    policy.failure({ host: '192.168.0.159', port: 9322, retries: 3, queued: 4, dropped: 9, reconnects: 17 });
    assert.equal(calls.length, 1);
    assert.match(calls[0].title, /Socket/);
    assert.match(calls[0].comment, /192\.168\.0\.159:9322/);
    assert.match(calls[0].comment, /4 則/);

    policy.failure({ host: '192.168.0.159', port: 9322, retries: 4 });
    assert.equal(calls.length, 1, '重複間隔內不應再通知');
    advance(60000);
    policy.failure({ host: '192.168.0.159', port: 9322, retries: 5 });
    assert.equal(calls.length, 2);
});

test('沒有其他通道時不通知；通道啟用後下一次失敗即可提醒', () => {
    const { policy, calls, setChannels } = setup({ threshold: 2, channels: () => [] });
    policy.failure({ host: 'h', port: 1, retries: 5 });
    assert.equal(calls.length, 0);
    setChannels(() => ['ntfy']);
    policy.failure({ host: 'h', port: 1, retries: 6 });
    assert.equal(calls.length, 1);
});

test('recovery 清除單一端點狀態；其他端點互不影響', () => {
    const { policy, calls } = setup({ threshold: 2 });
    policy.failure({ host: 'a', port: 1, retries: 2 });
    policy.failure({ host: 'b', port: 2, retries: 2 });
    assert.equal(calls.length, 2);
    policy.recovery({ host: 'a', port: 1 });
    policy.failure({ host: 'a', port: 1, retries: 2 });
    assert.equal(calls.length, 3, '恢復後重新離線應重新通知');
    policy.recovery({ host: 'b', port: 2 });
    policy.failure({ host: 'b', port: 2, retries: 1 });
    assert.equal(calls.length, 3, '新一輪未達門檻不通知');
});

test('repeatMs=0 時同一次離線只通知一次', () => {
    const { policy, calls, advance } = setup({ threshold: 1, repeatMs: 0 });
    policy.failure({ host: 'h', port: 1, retries: 1 });
    advance(86400000);
    policy.failure({ host: 'h', port: 1, retries: 2 });
    assert.equal(calls.length, 1);
    policy.recovery({ host: 'h', port: 1 });
    policy.failure({ host: 'h', port: 1, retries: 1 });
    assert.equal(calls.length, 2);
});
