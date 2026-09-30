import net from 'node:net';

// Newline-delimited JSON. Decode only complete frames so UTF-8 may span chunks.
/**
 * 將 newline-delimited JSON 的位元組流解析成物件；不足一行的部分保留到後續 chunk，
 * 因此可正確處理跨 chunk 的 UTF-8 多位元組字元。
 */
export class JsonLineReader {
    /**
     * @param {(value: Object) => void} onMessage 每解析出一則完整 JSON 物件時呼叫。
     * @param {number} [maxBytes=262144] 單一 frame 上限，超過即丟出錯誤。
     */
    constructor(onMessage, maxBytes = 256 * 1024) {
        this.onMessage = onMessage;
        this.maxBytes = maxBytes;
        this.buffer = Buffer.alloc(0);
    }
    /**
     * 餵入一段位元組；不足一行的部分會保留到後續呼叫。
     * @param {Buffer} chunk
     * @returns {void}
     * @throws {Error} frame 超過 maxBytes 時
     */
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

/**
 * 具背壓與有界佇列的 newline-delimited JSON TCP 傳輸層，內建重連、TTL 與停滯逾時。
 */
export class SocketTransport {
    /**
     * @param {Object} options
     * @param {string} options.host
     * @param {number} options.port
     * @param {boolean} [options.enabled=true]
     * @param {() => void} [options.onConnect=()=>{}]
     * @param {() => Object} [options.socketFactory] 建立 socket（預設 net.Socket）。
     * @param {number} [options.maxPending=200] 佇列筆數上限。
     * @param {number} [options.maxBytes=1048576] 佇列位元組上限。
     * @param {number} [options.ttl=30000] 佇列項目存活時間（ms）。
     * @param {number} [options.stallMs=15000] 連線／write 停滯逾時（ms）。
     * @param {number} [options.retryMs=15000] 重連基礎間隔（ms）。
     * @param {Console} [options.logger=console]
     */
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
    /**
     * 排入一則訊息；回傳 false 表示未啟用／已停止／單筆過大而被丟棄。
     * `audience` 與 `heartbeat` 會取代佇列中同型別項目，只保留最新。
     * @param {Object} payload
     * @returns {boolean}
     */
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
    /**
     * 建立連線；未啟用、已停止或已有連線時不做事。
     * @returns {void}
     */
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
    /**
     * 送出可選的最終訊息、排空佇列後關閉連線；受 timeoutMs 上限保護，不會永遠等待。
     * @param {Object} [finalPayload]
     * @param {number} [timeoutMs=2000]
     * @returns {Promise<void>}
     */
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
