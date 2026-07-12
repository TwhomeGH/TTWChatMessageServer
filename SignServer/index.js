import { RouteConfig, RoomIdRouteConfig, TikTokLiveConnection, deserializeMessage } from 'tiktok-live-connector';
import { initDirectSigner, directSign, browserFetchSigned, resetFetchPage } from './direct-signer.mjs';
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

    const useImFetch = process.env.ENABLE_IMFETCH !== '0';
    if (useImFetch) console.log('[SignServer] im/fetch enabled (ENABLE_IMFETCH=0 to disable)');
    RouteConfig.fetchSignedWebSocketFromProvider = async ({ roomId, cursor: incomingCursor }) => {
        const cursor = incomingCursor || '0';
        if (!useImFetch) {
            return {
                fetchResult: {
                    cursor, internalExt: '',
                    pushServer: 'wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/',
                    routeParams: {}, needAck: false, messages: []
                },
                fetchResultCookieHeader: '', fetchResultRoomId: roomId
            };
        }
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
                        fetchResultCookieHeader: '', fetchResultRoomId: roomId
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

    // Mock WS + imFetch polling (TikTok's live messages come via HTTP, not WS)
    console.log('[SignServer] Using imFetch polling for messages');
    const origSetup = TikTokLiveConnection.prototype.setupWebsocket;
    TikTokLiveConnection.prototype.setupWebsocket = async function (wsUrl, wsParams, roomId) {
        const mock = new EventEmitter();
        mock.readyState = 1;
        Object.assign(mock, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, seqId: 1,
            close: (code) => { mock.readyState = 3; mock.emit('close', code || 1000); },
            send: () => {}, ping: () => {}, terminate: () => mock.close(), switchRooms: () => {},
        });
        this._wsClientProvider = () => {
            setImmediate(() => { mock.emit('open'); imFetchPollLoop(roomId, this, mock); });
            return mock;
        };
        return origSetup.call(this, wsUrl, wsParams, roomId);
    };
}

function fmt(msg) {
    let d = msg?.decodedData || msg;
    let method = msg?.common?.method || msg?.method || d?.common?.method || d?.method || '?';

    // decodedData wraps the real payload in { type, data }
    // data can be the full object (expanded) or a key summary string
    if (d?.type && d?.data && typeof d.data === 'object' && !Array.isArray(d.data)) {
        method = d.type;
        d = d.data;
    }

    const clone = {};
    for (const [k, v] of Object.entries(d)) {
        if (k === 'common' || k === 'payload' || k === 'signature') continue;
        if (typeof v === 'string') {
            clone[k] = v.length > 80 ? v.substring(0, 80) + '...' : v;
        } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
            clone[k] = v;
        } else if (Array.isArray(v)) {
            clone[k] = `[${v.length} items]`;
        } else if (typeof v === 'object') {
            if (k === 'user' && v) {
                clone[k] = {
                    nickname: v.nickname || v.uniqueId || v.displayId || '?',
                    id: v.id || '?',
                };
            } else if (v && Object.keys(v).length <= 4) {
                clone[k] = v;
            } else {
                clone[k] = `{${Object.keys(v).slice(0, 8).join(',')}}`;
            }
        }
    }

    const json = Object.keys(clone).length > 0 ? JSON.stringify(clone) : '(empty)';
    return method + ' | ' + json;
}

function imFetchPollLoop(roomId, connection, mock) {
    let cursor = '0';
    let errCount = 0;
    let silentCount = 0;
    let consecErrors = 0;

    const poll = async () => {
        while (connection._wsClientInstance === mock) {
            const start = Date.now();
            try {
                const raw = await browserFetchSigned({ room_id: roomId, cursor });
                if (raw && raw.length > 0) {
                    const d = deserializeMessage('ProtoMessageFetchResult', Buffer.from(raw));
                    if (d) {
                        if (d.cursor) { cursor = d.cursor; }
                        const msgs = d.messages || [];
                        if (msgs.length > 0) {
                            errCount = 0;
                            silentCount = 0;
                            consecErrors = 0;
                            for (const msg of msgs) {
                                console.log('[imFetch]', fmt(msg));
                                // Library routes by msg.method (e.g. "WebcastChatMessage")
                                // If msg has method at top-level, pass it as-is.
                                // Otherwise try decodedData, then inner data.
                                const pass = msg?.method ? msg : (msg?.decodedData?.type ? msg.decodedData : msg);
                                if (typeof connection._handleMessage === 'function') connection._handleMessage(pass);
                            }
                        } else {
                            silentCount++;
                        }
                    }
                }
            } catch (e) {
                errCount++;
                consecErrors++;
                if (errCount % 10 === 1) console.warn('[imFetch] err:', e.message);
                // Health check: reset fetchPage on 3 consecutive errors
                if (consecErrors >= 3) {
                    console.warn('[imFetch] 3 consecutive errors, resetting fetch page');
                    resetFetchPage();
                    consecErrors = 0;
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                }
                if (errCount > 5) {
                    await new Promise(r => setTimeout(r, 30000));
                    continue;
                }
            }

            // Adaptive interval: 5s active → 60s idle
            const elapsed = Date.now() - start;
            let wait;
            if (errCount > 0) {
                wait = 30000;
            } else if (silentCount > 5) {
                wait = Math.min(10000 + (silentCount - 5) * 5000, 60000);
            } else {
                wait = 5000;
            }
            wait = Math.max(1, wait - elapsed);
            await new Promise(r => setTimeout(r, wait));
        }
    };
    poll();
}
