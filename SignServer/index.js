import { RouteConfig, RoomIdRouteConfig, TikTokLiveConnection, deserializeMessage } from 'tiktok-live-connector';
import { initDirectSigner, directSign, browserFetchSigned } from './direct-signer.mjs';
import { EventEmitter } from 'events';

let signerReady = false;
let signerPromise = null;

export function setStreamerName(name) {}

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

export function waitForSigner() { return ensureSigner(); }

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
                if (result.xBogus) return { response: { signedUrl: result.signedUrl } };
            } catch (e) { console.warn('[SignServer] sign failed:', e.message); }
        }
        return { response: { signedUrl: url } };
    };

    RouteConfig.fetchSignedWebSocketFromProvider = async ({ roomId, cursor: incomingCursor }) => {
        const cursor = incomingCursor || '0';
        try {
            const rawBytes = await browserFetchSigned({ room_id: roomId, cursor });
            if (rawBytes && rawBytes.length > 0) {
                const decoded = deserializeMessage('ProtoMessageFetchResult', Buffer.from(rawBytes));
                if (decoded) {
                    return {
                        fetchResult: {
                            cursor: decoded.cursor || cursor,
                            internalExt: decoded.internalExt || '',
                            pushServer: 'wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/',
                            routeParams: decoded.routeParams || {},
                            needAck: false,
                            messages: decoded.messages || []
                        },
                        fetchResultCookieHeader: '',
                        fetchResultRoomId: roomId
                    };
                }
            }
        } catch (e) { console.warn('[SignServer] im/fetch failed:', e.message); }
        return {
            fetchResult: {
                cursor, internalExt: '',
                pushServer: 'wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/',
                routeParams: {}, needAck: false, messages: []
            },
            fetchResultCookieHeader: '', fetchResultRoomId: roomId
        };
    };

    const origSetupWebsocket = TikTokLiveConnection.prototype.setupWebsocket;
    TikTokLiveConnection.prototype.setupWebsocket = async function (wsUrl, wsParams, roomId) {
        console.log('[SignServer] Mock WS for room', roomId);
        const mock = new EventEmitter();
        mock.readyState = 1;
        Object.assign(mock, {
            CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, seqId: 1,
            close: (code) => { mock.readyState = 3; mock.emit('close', code || 1000, 'closed'); },
            send: () => {},
            ping: () => {}, terminate: () => mock.close(), switchRooms: () => {},
        });
        this._wsClientProvider = () => {
            setImmediate(() => {
                mock.emit('open');
                // Start im/fetch/ polling loop
                startPolling(roomId, this);
            });
            return mock;
        };
        return origSetupWebsocket.call(this, wsUrl, wsParams, roomId);
    };
}

function startPolling(roomId, connection) {
    let running = true;
    let cursor = '0';
    let pollCount = 0;
    let errCount = 0;
    console.log('[imFetch] Polling started for', roomId);
    const poll = async () => {
        while (running) {
            try {
                const rawBytes = await browserFetchSigned({ room_id: roomId, cursor });
                pollCount++;
                errCount = 0;
                if (rawBytes && rawBytes.length > 0) {
                    const decoded = deserializeMessage('ProtoMessageFetchResult', Buffer.from(rawBytes));
                    if (decoded) {
                        if (decoded.cursor) cursor = decoded.cursor;
                        const msgs = decoded.messages || [];
                        if (msgs.length > 0) {
                            const types = [...new Set(msgs.map(m => m?.common?.method || m?.method || '?'))];
                            console.log('[imFetch]', pollCount, msgs.length, 'types:', types.slice(0,5).join(','));
                            if (typeof connection.processProtoMessageFetchResult === 'function') {
                                await connection.processProtoMessageFetchResult(decoded);
                            }
                        }
                    }
                }
            } catch (e) {
                errCount++;
                if (errCount % 10 === 1) console.warn('[imFetch] Error:', e.message);
                if (errCount > 30) {
                    console.warn('[imFetch] Restarting after 30 errors...');
                    errCount = 0;
                    await new Promise(r => setTimeout(r, 10000));
                }
            }
            await new Promise(r => setTimeout(r, errCount > 5 ? 5000 : 2000));
        }
    };
    poll();
}
