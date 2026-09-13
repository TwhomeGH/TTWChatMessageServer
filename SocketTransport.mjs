import net from 'node:net';

// Newline-delimited JSON. Decode only complete frames so UTF-8 may span chunks.
export class JsonLineReader {
    constructor(onMessage, maxBytes = 256 * 1024) {
        this.onMessage = onMessage;
        this.maxBytes = maxBytes;
        this.buffer = Buffer.alloc(0);
    }
    push(chunk) {
        let start = 0;
        while (start < chunk.length) {
            const end = chunk.indexOf(10, start);
            const piece = chunk.subarray(start, end < 0 ? chunk.length : end);
            if (this.buffer.length + piece.length > this.maxBytes) throw new Error('Socket frame too large');
            this.buffer = Buffer.concat([this.buffer, piece]);
            if (end < 0) return;
            const line = this.buffer.toString('utf8').trim();
            this.buffer = Buffer.alloc(0);
            if (line) {
                let value;
                try { value = JSON.parse(line); } catch { start = end + 1; continue; }
                if (value && typeof value === 'object' && !Array.isArray(value)) this.onMessage(value);
            }
            start = end + 1;
        }
    }
}

export class SocketTransport {
    constructor({ host, port, enabled = true, onConnect = () => {},
        socketFactory = () => new net.Socket(), maxPending = 200,
        maxBytes = 1024 * 1024, ttl = 30000, stallMs = 15000,
        retryMs = 15000, logger = console }) {
        Object.assign(this, { host, port, enabled, onConnect, socketFactory,
            maxPending, maxBytes, ttl, stallMs, retryMs, logger });
        this.queue = [];
        this.bytes = 0;
        this.connected = false;
        this.blocked = false;
        this.stopped = false;
        this.retries = 0;
        this.stats = { dropped: 0, reconnects: 0 };
        this.lastLog = 0;
    }
    drop(index = 0) {
        const [item] = this.queue.splice(index, 1);
        if (item) { this.bytes -= item.bytes; this.stats.dropped++; }
    }
    report() {
        if (Date.now() - this.lastLog < 10000) return;
        this.lastLog = Date.now();
        this.logger.warn(`[Socket] queued=${this.queue.length} bytes=${this.bytes} dropped=${this.stats.dropped} reconnects=${this.stats.reconnects}`);
    }
    send(payload) {
        if (!this.enabled || this.stopped) return false;
        const line = JSON.stringify(payload) + '\n';
        const bytes = Buffer.byteLength(line);
        if (bytes > Math.min(this.maxBytes, 256 * 1024)) {
            this.stats.dropped++; this.report(); return false;
        }
        this.expire();
        if (payload.type === 'audience' || payload.type === 'heartbeat') {
            const index = this.queue.findIndex(item => item.type === payload.type);
            if (index >= 0) this.drop(index);
        }
        while (this.queue.length >= this.maxPending || this.bytes + bytes > this.maxBytes) this.drop();
        this.queue.push({ line, bytes, type: payload.type, at: Date.now() });
        this.bytes += bytes;
        this.flush();
        if (this.queue.length || this.stats.dropped) this.report();
        return true;
    }
    expire() {
        while (this.queue.length && Date.now() - this.queue[0].at >= this.ttl) this.drop();
    }
    flush() {
        this.expire();
        const socket = this.socket;
        if (!this.connected || this.blocked || !socket || socket.destroyed) return;
        while (this.queue.length) {
            const item = this.queue[0];
            let writable;
            try { writable = socket.write(item.line); }
            catch { socket.destroy(); return; }
            // write(false) already accepted this frame. Never enqueue it again.
            this.queue.shift();
            this.bytes -= item.bytes;
            if (!writable) {
                this.blocked = true;
                this.stallTimer = setTimeout(() => socket.destroy(), this.stallMs);
                break;
            }
        }
    }
    connect() {
        if (!this.enabled || this.stopped || (this.socket && !this.socket.destroyed)) return;
        clearTimeout(this.retryTimer);
        const socket = this.socket = this.socketFactory();
        this.connected = false;
        this.blocked = false;
        const reader = new JsonLineReader(message => {
            if (message.type === 'keepalive') this.send({ type: 'heartbeat' });
        });
        this.connectTimer = setTimeout(() => socket.destroy(), this.stallMs);
        socket.setKeepAlive(true, 10000);
        socket.setNoDelay(true);
        socket.on('connect', () => {
            clearTimeout(this.connectTimer);
            this.connected = true;
            this.retries = 0;
            this.logger.log('✅ TCP Socket connected');
            this.flush();
            this.onConnect();
        });
        socket.on('data', chunk => {
            try { reader.push(chunk); }
            catch (err) { this.logger.warn(`[Socket] ${err.message}`); socket.destroy(); }
        });
        socket.on('drain', () => {
            clearTimeout(this.stallTimer);
            this.blocked = false;
            this.flush();
        });
        socket.on('error', err => {
            this.logger.warn(`[Socket] ${err.message}`);
            socket.destroy();
        });
        socket.on('close', () => {
            clearTimeout(this.connectTimer);
            clearTimeout(this.stallTimer);
            this.connected = false;
            this.blocked = false;
            if (this.stopped) return;
            this.retries++;
            this.stats.reconnects++;
            this.report();
            const delay = Math.min(this.retryMs + Math.max(0, this.retries - 10) * 5000, 300000);
            this.retryTimer = setTimeout(() => this.connect(), delay);
        });
        socket.connect(this.port, this.host);
    }
    async close(finalPayload, timeoutMs = 2000) {
        if (finalPayload && this.connected) this.send(finalPayload);
        this.stopped = true;
        clearTimeout(this.retryTimer);
        clearTimeout(this.connectTimer);
        const socket = this.socket;
        if (socket && !socket.destroyed) {
            await new Promise(resolve => {
                const timer = setTimeout(() => { socket.destroy(); resolve(); }, timeoutMs);
                socket.once('close', () => { clearTimeout(timer); resolve(); });
                // Drain our queue before sending FIN; timeout bounds a slow peer.
                const finish = () => {
                    if (!this.queue.length) socket.end();
                };
                socket.on('drain', finish);
                finish();
            });
        }
        clearTimeout(this.stallTimer);
        this.queue = [];
        this.bytes = 0;
    }
}
