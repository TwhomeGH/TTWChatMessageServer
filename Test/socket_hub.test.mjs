import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageDedup } from '../ScriptLib/socket/dedup.mjs';
import { SocketEndpoint, parseSocketUrl } from '../ScriptLib/socket/endpoint.mjs';
import { SocketHub, createHub } from '../ScriptLib/socket/hub.mjs';

test('MessageDedup 只比對第一行原始文字，並受 TTL 與上限約束', () => {
    const dedup = new MessageDedup({ ttlMs: 60000, max: 2 });
    assert.equal(dedup.isDuplicate('a', 'hi'), false);
    dedup.add('a', 'hi');
    assert.equal(dedup.isDuplicate('a', 'hi'), true);
    assert.equal(dedup.isDuplicate('a', 'hi\n另一段翻譯'), true);   // 只比對第一行
    assert.equal(dedup.isDuplicate('b', 'hi'), false);
    dedup.add('b', 'x');
    dedup.add('c', 'y');            // 超過 max=2 丟最舊
    assert.equal(dedup.size, 2);
    assert.equal(dedup.isDuplicate('a', 'hi'), false);

    const expired = new MessageDedup({ ttlMs: 1 });
    expired.add('a', 'hi');
    return new Promise(resolve => setTimeout(() => {
        expired.add('b', 'x');        // 清理在 add 時觸發
        assert.equal(expired.isDuplicate('a', 'hi'), false);
        resolve();
    }, 5));
});

test('parseSocketUrl 解析 host/port 與預設埠', () => {
    assert.deepEqual(parseSocketUrl('tcp://192.168.0.5:9322'), { host: '192.168.0.5', port: 9322 });
    assert.deepEqual(parseSocketUrl('http://localhost:9000'), { host: 'localhost', port: 9000 });
    assert.deepEqual(parseSocketUrl('tcp://host'), { host: 'host', port: 9322 });
    assert.deepEqual(parseSocketUrl('tcp://[::1]:9322'), { host: '::1', port: 9322 });
});

test('SocketEndpoint 依 filter 決定接受的 category（空 = 全部）', () => {
    const all = new SocketEndpoint({ url: 'tcp://localhost:9322', enabled: true });
    assert.equal(all.accepts('chat'), true);
    assert.equal(all.accepts('system'), true);
    assert.equal(all.accepts(undefined), true);

    const filtered = new SocketEndpoint({ url: 'tcp://localhost:9322', enabled: true, filter: 'chat, gift' });
    assert.equal(filtered.accepts('chat'), true);
    assert.equal(filtered.accepts('gift'), true);
    assert.equal(filtered.accepts('system'), false);
    assert.equal(filtered.accepts(undefined), false);
});

function fakeEndpoint(name, accepts = () => true) {
    const sent = [];
    return { name, enabled: true, accepts, send: payload => sent.push(payload), sent };
}

test('SocketHub 依 category 扇出到接受該類別的端點', () => {
    const all = fakeEndpoint('all');
    const chatOnly = fakeEndpoint('chat', category => category === 'chat');
    const hub = new SocketHub({ endpoints: [all, chatOnly] });

    hub.send({ type: 'StreamMessage', category: 'chat', message: 'hi' });
    hub.send({ type: 'StreamMessage', category: 'system', message: 'bye' });
    assert.equal(all.sent.length, 2);
    assert.equal(chatOnly.sent.length, 1);
    assert.equal(chatOnly.sent[0].message, 'hi');
});

test('SocketHub.sendMessage 去重、套用 replaceEmojis 並帶上 category', () => {
    const endpoint = fakeEndpoint('all');
    const dedup = new MessageDedup();
    const hub = new SocketHub({ endpoints: [endpoint], dedup, replaceEmojis: text => text.replace(':)', '🙂') });

    assert.equal(hub.sendMessage('user', 'hello :)', { category: 'chat' }), true);
    assert.deepEqual(endpoint.sent[0], {
        type: 'StreamMessage', category: 'chat', user: 'user', message: 'hello 🙂',
        img: '', giftImg: '', isMain: true, userNum: 0, userList: []
    });

    // 已記錄的訊息（去重緩衝）會被擋下
    dedup.add('user', 'hello :)');
    assert.equal(hub.sendMessage('user', 'hello :)', { category: 'chat' }), false);
    assert.equal(endpoint.sent.length, 1);

    // dedupUser/dedupMessage 可覆寫比對依據，且無 category 時不帶該欄位
    assert.equal(hub.sendMessage('顯示名', '原文', { dedupUser: 'orig', dedupMessage: '原文' }), true);
    assert.equal('category' in endpoint.sent[1], false);
});

test('createHub：停用時無端點；啟用時建立單一端點', () => {
    assert.equal(createHub({ enabled: false }).enabled, false);
    const hub = createHub({ socketApi: 'tcp://localhost:9322', enabled: true });
    assert.equal(hub.enabled, true);
    assert.equal(hub.primary.enabled, true);
    assert.equal(hub.primary.accepts('chat'), true);
});
