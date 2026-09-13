import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { SocketTransport, JsonLineReader } from '../SocketTransport.mjs';

const logger = { log() {}, warn() {} };
class FakeSocket extends EventEmitter {
    writes = [];
    destroyed = false;
    writable = true;
    setKeepAlive() {}
    setNoDelay() {}
    connect() {}
    write(line) { this.writes.push(JSON.parse(line)); return this.writable; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
    end() { this.destroy(); }
}
function setup(t, options = {}) {
    const sockets = [];
    const transport = new SocketTransport({ host: 'localhost', port: 9322, logger,
        socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
        ...options });
    t.after(() => transport.close(undefined, 5));
    transport.connect();
    return { transport, sockets, socket: sockets[0] };
}

test('fragmented frames preserve trailing JSON and every UTF-8 byte boundary', () => {
    const expected = [{ type: 'first' }, { type: '第二筆', message: '中文🙂' }];
    const bytes = Buffer.from(expected.map(JSON.stringify).join('\n') + '\n');
    for (let split = 1; split < bytes.length; split++) {
        const actual = [];
        const reader = new JsonLineReader(value => actual.push(value));
        reader.push(bytes.subarray(0, split));
        reader.push(bytes.subarray(split));
        assert.deepEqual(actual, expected);
    }
});
test('malformed frames recover; oversized complete and partial frames are rejected', () => {
    const actual = [];
    const reader = new JsonLineReader(value => actual.push(value), 20);
    reader.push(Buffer.from('bad\nnull\n[]\n{"ok":true}\n'));
    assert.deepEqual(actual, [{ ok: true }]);
    assert.throws(() => reader.push(Buffer.from('x'.repeat(21))), /too large/);
    assert.throws(() => new JsonLineReader(() => {}, 20).push(Buffer.from('x'.repeat(21) + '\n')), /too large/);
});
test('connecting does not write; backpressure waits for drain without duplicating accepted frame', t => {
    const { transport, socket } = setup(t);
    transport.send({ n: 1 });
    assert.equal(socket.writes.length, 0);
    socket.writable = false;
    socket.emit('connect');
    transport.send({ n: 2 });
    transport.send({ n: 3 });
    assert.deepEqual(socket.writes, [{ n: 1 }]);
    socket.writable = true;
    socket.emit('drain');
    assert.deepEqual(socket.writes, [{ n: 1 }, { n: 2 }, { n: 3 }]);
});
test('queue bounds, latest audience state, expiration, disabled transport', t => {
    const { transport, socket } = setup(t, { maxPending: 3, maxBytes: 150, ttl: 1000 });
    for (let n = 0; n < 1000; n++) transport.send({ type: 'audience', n });
    assert.equal(transport.queue.length, 1);
    assert.equal(JSON.parse(transport.queue[0].line).n, 999);
    for (let n = 0; n < 1000; n++) transport.send({ n });
    assert.equal(transport.queue.length, 3);
    assert.ok(transport.bytes <= 150);
    assert.equal(transport.send({ text: 'x'.repeat(151) }), false);
    transport.queue[0].at -= 2000;
    socket.emit('connect');
    assert.deepEqual(socket.writes, [{ n: 998 }, { n: 999 }]);
    const disabled = new SocketTransport({ enabled: false });
    assert.equal(disabled.send({ n: 1 }), false);
    assert.equal(disabled.queue.length, 0);
});
test('disconnect during backpressure retains only unsent frames and reconnects once', async t => {
    const { transport, socket, sockets } = setup(t, { retryMs: 5 });
    socket.emit('connect');
    socket.writable = false;
    transport.send({ n: 1 });
    transport.send({ n: 2 });
    transport.send({ n: 3 });
    socket.destroy();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(sockets.length, 2);
    transport.connect();
    assert.equal(sockets.length, 2);
    sockets[1].emit('connect');
    assert.deepEqual(sockets[1].writes, [{ n: 2 }, { n: 3 }]);
});
test('stalled writes time out, and shutdown never waits forever', async t => {
    const { transport, socket } = setup(t, { stallMs: 10 });
    socket.emit('connect');
    socket.writable = false;
    transport.send({ n: 1 });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(socket.destroyed, true);
    const second = setup(t);
    second.socket.emit('connect');
    second.socket.writable = false;
    second.transport.send({ n: 1 });
    second.transport.send({ n: 2 });
    await second.transport.close(undefined, 10);
    assert.equal(second.socket.destroyed, true);
    assert.equal(second.transport.send({ n: 3 }), false);
});
test('real TCP sends ordered JSON and answers fragmented keepalive', async t => {
    const actual = [];
    const peers = new Set();
    const server = net.createServer(socket => {
        peers.add(socket);
        const reader = new JsonLineReader(value => actual.push(value));
        socket.on('data', data => reader.push(data));
        socket.write('{"type":"keep');
        socket.write('alive"}\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const transport = new SocketTransport({ host: '127.0.0.1', port: server.address().port, logger });
    t.after(async () => {
        await transport.close(undefined, 50);
        for (const peer of peers) peer.destroy();
        await new Promise(resolve => server.close(resolve));
    });
    transport.send({ type: 'StreamMessage', message: '中文🙂' });
    transport.connect();
    const deadline = Date.now() + 2000;
    while (actual.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(actual, [{ type: 'StreamMessage', message: '中文🙂' }, { type: 'heartbeat' }]);
});

test('connection attempt times out and shutdown drains pending frames in order', async t => {
    const first = setup(t, { stallMs: 10 });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(first.socket.destroyed, true);
    const { transport, socket } = setup(t);
    socket.emit('connect');
    socket.writable = false;
    transport.send({ n: 1 });
    transport.send({ n: 2 });
    const closing = transport.close({ n: 3 }, 100);
    socket.writable = true;
    socket.emit('drain');
    await closing;
    assert.deepEqual(socket.writes, [{ n: 1 }, { n: 2 }, { n: 3 }]);
    assert.equal(socket.destroyed, true);
});

test('real slow TCP receiver bounds a burst and resumes after reading', async t => {
    let peer;
    const actual = [];
    const server = net.createServer(socket => {
        peer = socket;
        socket.pause();
        const reader = new JsonLineReader(value => actual.push(value.n));
        socket.on('data', data => reader.push(data));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let connected;
    const ready = new Promise(resolve => { connected = resolve; });
    const transport = new SocketTransport({ host: '127.0.0.1', port: server.address().port,
        logger, maxPending: 4, maxBytes: 512 * 1024, onConnect: connected });
    t.after(async () => {
        await transport.close(undefined, 50);
        peer?.destroy();
        await new Promise(resolve => server.close(resolve));
    });
    transport.connect();
    await ready;
    for (let n = 0; n < 1000; n++) transport.send({ n, text: 'x'.repeat(128 * 1024) });
    assert.equal(transport.blocked, true);
    assert.ok(transport.queue.length <= 4);
    assert.ok(transport.bytes <= 512 * 1024);
    assert.ok(transport.stats.dropped > 0);
    peer.resume();
    const deadline = Date.now() + 3000;
    while (!actual.includes(999) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(actual.at(-1), 999);
    assert.deepEqual(actual, [...new Set(actual)].sort((a, b) => a - b));
});
