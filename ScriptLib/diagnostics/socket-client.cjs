const net = require('node:net');

const MAX_LINE = 4 * 1024 * 1024;

/**
 * 訂閱 ReplyKit SocketServer 的外部日誌／帶外 diagnostic。
 * 只送 subscribeExternalLogs，不送 extension 專用訊息，維持外部工具角色。
 */
class DiagnosticsSocketClient {
    constructor({ store, reconnectMs = 3000, logger = console } = {}) {
        this.store = store;
        this.reconnectMs = reconnectMs;
        this.logger = logger;
        this.socket = null;
        this.buffer = '';
        this.retryTimer = null;
        this.host = '';
        this.port = 0;
        this.enabled = false;
        this.subscribed = false;
        this.state = 'off';
        this.lastError = '';
        this.lastMessageAt = null;
        this.attempts = 0;
    }

    snapshot() {
        return {
            enabled: this.enabled,
            host: this.host,
            port: this.port,
            state: this.state,
            subscribed: this.subscribed,
            lastError: this.lastError,
            lastMessageAt: this.lastMessageAt,
            attempts: this.attempts
        };
    }

    clearRetry() {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
    }

    send(payload) {
        if (!this.socket || this.socket.destroyed || !this.socket.writable) return false;
        try {
            this.socket.write(JSON.stringify(payload) + '\n');
            return true;
        } catch (error) {
            this.lastError = error.message;
            return false;
        }
    }

    subscribe(enabled) {
        return this.send({ type: 'subscribeExternalLogs', enabled: enabled === true });
    }

    start(host, port) {
        const nextHost = String(host || '').trim();
        const nextPort = Number(port) || 0;
        if (!nextHost || nextPort < 1 || nextPort > 65535) {
            this.lastError = '需要有效的 host 與 port';
            this.enabled = false;
            this.state = 'error';
            return false;
        }
        const sameTarget = this.host === nextHost && this.port === nextPort;
        this.host = nextHost;
        this.port = nextPort;
        this.enabled = true;
        this.attempts = 0;
        this.lastError = '';
        // 已建立同一條連線時只重新訂閱，不重連。
        if (sameTarget && this.socket && !this.socket.destroyed && this.socket.writable) {
            this.subscribe(true);
            if (!this.subscribed) this.state = 'connected';
            return true;
        }
        this.closeSocket();
        this.connect();
        return true;
    }

    unsubscribe() {
        this.enabled = false;
        this.subscribed = false;
        this.clearRetry();
        this.subscribe(false);
        this.state = this.socket && !this.socket.destroyed ? 'connected' : 'off';
    }

    stop() {
        this.enabled = false;
        this.subscribed = false;
        this.clearRetry();
        this.subscribe(false);
        this.closeSocket();
        this.state = 'off';
    }

    closeSocket() {
        if (!this.socket) return;
        const socket = this.socket;
        this.socket = null;
        try { socket.destroy(); } catch { /* ignore */ }
    }

    connect() {
        if (!this.enabled) return;
        this.clearRetry();
        this.state = 'connecting';
        this.attempts += 1;
        const socket = net.createConnection({ host: this.host, port: this.port });
        this.socket = socket;
        socket.setNoDelay(true);
        socket.setEncoding('utf8');
        socket.on('connect', () => {
            this.state = 'connected';
            this.lastError = '';
            this.buffer = '';
            if (this.enabled) this.subscribe(true);
        });
        socket.on('data', chunk => this.onData(chunk));
        socket.on('error', error => {
            this.lastError = error.message;
        });
        socket.on('close', () => {
            if (this.socket !== socket) return;
            this.socket = null;
            this.subscribed = false;
            if (!this.enabled) {
                this.state = 'off';
                return;
            }
            this.state = 'reconnecting';
            this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                this.connect();
            }, this.reconnectMs);
        });
    }

    onData(chunk) {
        this.buffer += chunk;
        if (this.buffer.length > MAX_LINE) {
            this.buffer = '';
            this.lastError = '單行資料過大，已重置緩衝';
            return;
        }
        let index;
        while ((index = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, index).trim();
            this.buffer = this.buffer.slice(index + 1);
            if (line) this.onLine(line);
        }
    }

    onLine(line) {
        let data;
        try { data = JSON.parse(line); } catch {
            this.lastError = '收到非 JSON 資料';
            return;
        }
        if (!data || typeof data !== 'object') return;
        if (data.type === 'externalLogSubscription') {
            this.subscribed = data.enabled === true;
            this.state = this.subscribed ? 'subscribed' : 'connected';
            this.lastMessageAt = Date.now();
            return;
        }
        if (data.type === 'externalLogBatch') {
            if (Array.isArray(data.entries)) this.store.ingestLogs({ logs: data.entries });
            this.lastMessageAt = Date.now();
            return;
        }
        if (data.type === 'diagnostic') {
            this.store.ingestDiagnostic(data);
            this.lastMessageAt = Date.now();
        }
        // 其他 type 忽略，不中斷連線。
    }
}

module.exports = { DiagnosticsSocketClient };
