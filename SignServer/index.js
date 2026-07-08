import { RouteConfig, RoomIdRouteConfig, TikTokLiveConnection } from 'tiktok-live-connector';
import { initDirectSigner, directSign, initLivePage, pollLiveMessages, sendLiveMessage, closeLivePage, isLiveWsReady } from './direct-signer.mjs';
import { EventEmitter } from 'events';

let signerReady = false;
let signerPromise = null;
let currentUsername = '';

export function setStreamerName(name) {
    currentUsername = name;
}

async function ensureSigner() {
    if (signerReady) return true;
    if (signerPromise) return signerPromise;
    signerPromise = (async () => {
        try {
            signerReady = await initDirectSigner();
            if (signerReady) console.log('[SignServer] Signer ready');
            return signerReady;
        } catch (e) {
            console.error('[SignServer] Signer init failed:', e.message);
            return false;
        }
    })();
    return signerPromise;
}

export function waitForSigner() {
    return ensureSigner();
}

export async function setupCustomSignServer() {
    ensureSigner();

    RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = true;
    RoomIdRouteConfig.skipFetchRoomInfoFromHtmlRoute = true;
    RoomIdRouteConfig.skipFetchRoomInfoFromApiLiveRoute = false;

    RouteConfig.fetchWebcastSignatureFromProvider = async ({ url }) => {
        const ready = await ensureSigner();
        if (ready) {
            try {
                const result = await directSign(url);
                if (result.xBogus) {
                    return { response: { signedUrl: result.signedUrl } };
                }
            } catch (e) {
                console.warn('[SignServer] sign failed:', e.message);
            }
        }
        return { response: { signedUrl: url } };
    };

    // connect override: start CDP live page, then original connect
    const origConnect = TikTokLiveConnection.prototype.connect;
    TikTokLiveConnection.prototype.connect = async function (roomId) {
        if (currentUsername) {
            console.log(`[SignServer] Initializing CDP live page for ${currentUsername}...`);
            const cdpReady = await initLivePage(currentUsername);
            if (cdpReady) {
                console.log('[SignServer] CDP live page ready, starting message poller');
                startMessagePoller(this);
            } else {
                console.warn('[SignServer] CDP init failed, using fallback');
            }
        }
        return origConnect.call(this, roomId);
    };

    // setupWebsocket override: CDP mock WS or fallback
    const origSetupWebsocket = TikTokLiveConnection.prototype.setupWebsocket;
    TikTokLiveConnection.prototype.setupWebsocket = async function (wsUrl, wsParams, roomId) {
        if (isLiveWsReady()) {
            console.log(`[SignServer] CDP proxy WS (pushServer: ${wsUrl?.substring(0, 60)}...)`);
            const mockWs = new EventEmitter();
            mockWs.readyState = 1;
            mockWs.CONNECTING = 0;
            mockWs.OPEN = 1;
            mockWs.CLOSING = 2;
            mockWs.CLOSED = 3;
            mockWs.close = () => {
                mockWs.readyState = 3;
                mockWs.emit('close', 1000, 'CDP proxy closed');
            };
            mockWs.send = (data) => {
                sendLiveMessage(data);
            };
            this._wsClientInstance = mockWs;
            process.nextTick(() => mockWs.emit('open'));
        } else {
            console.log('[SignServer] CDP not ready, using original WS');
            return origSetupWebsocket.call(this, wsUrl, wsParams, roomId);
        }
    };
}

function startMessagePoller(connection) {
    let running = true;
    let consecutiveErrors = 0;
    const poll = async () => {
        while (running) {
            try {
                const messages = await pollLiveMessages();
                consecutiveErrors = 0;
                for (const msg of messages) {
                    if (msg.type === 'message') {
                        const data = msg.data instanceof Uint8Array
                            ? Buffer.from(msg.data)
                            : Buffer.from(msg.data || '');
                        if (data.length > 0 && connection._wsClientInstance) {
                            connection._wsClientInstance.emit('message', data);
                        }
                    } else if (msg.type === 'close') {
                        console.warn(`[SignServer] CDP WS closed (code: ${msg.code})`);
                        running = false;
                        if (connection._wsClientInstance) {
                            connection._wsClientInstance.emit('close', msg.code, 'CDP WS closed');
                        }
                    }
                }
            } catch (e) {
                consecutiveErrors++;
                if (consecutiveErrors > 10) {
                    console.error('[SignServer] Too many poll errors, stopping');
                    running = false;
                }
            }
            await new Promise(r => setTimeout(r, 50));
        }
    };
    poll();
}
