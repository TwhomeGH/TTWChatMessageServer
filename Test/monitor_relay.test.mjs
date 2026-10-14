// ScriptLib/socket/monitor-relay.mjs 的單元測試：驗證鏡像轉送、未連線與背壓上限。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitorRelay } from '../ScriptLib/socket/monitor-relay.mjs';

test('轉送 payload 且 callback 後可續送', () => {
    const sent = [];
    let release;
    const relay = createMonitorRelay({
        send: (message, callback) => { sent.push(message); release = callback; },
        isConnected: () => true
    });

    assert.equal(relay.forward({ category: 'chat', message: 'hi' }), true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'STREAM_MESSAGE');
    assert.equal(sent[0].data.message, 'hi');

    release();
    assert.equal(relay.forward({ category: 'gift' }), true);
    assert.equal(sent.length, 2);
});

test('未連線時不送出', () => {
    const sent = [];
    const relay = createMonitorRelay({ send: message => sent.push(message), isConnected: () => false });
    assert.equal(relay.forward({}), false);
    assert.equal(sent.length, 0);
});

test('達到 limit 後丟棄（背壓）', () => {
    const sent = [];
    const relay = createMonitorRelay({ limit: 2, send: message => sent.push(message), isConnected: () => true });
    assert.equal(relay.forward({}), true);
    assert.equal(relay.forward({}), true);
    assert.equal(relay.forward({}), false);
    assert.equal(sent.length, 2);
});
