import { RouteConfig, RoomIdRouteConfig, TikTokLiveConnection, deserializeMessage } from 'tiktok-live-connector';
import { initDirectSigner, directSign, signWsUrl, browserFetchSigned, resetFetchPage } from './direct-signer.mjs';
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

export function waitForSigner() {
    if (!hasDirectSignCreds()) return Promise.resolve(true);
    if (hasEulerKey() && process.env.DIRECT_SIGNER_PRIORITY !== '1') return Promise.resolve(true);
    return ensureSigner();
}

function hasDirectSignCreds() {
    return !!(process.env.TIKTOK_COOKIES || process.env.SESSION_ID);
}

function hasEulerKey() {
    return !!(process.env.SIGN_API_KEY || process.env.SIGN_API);
}

export async function setupCustomSignServer() {
    const useDirect = hasDirectSignCreds();
    const eulerAvail = hasEulerKey();

    if (!useDirect) {
        console.log('[SignServer] No TIKTOK_COOKIES or SESSION_ID — using EulerStream (native signer).');
        return;
    }

    // Both direct creds and EulerStream key present — prefer EulerStream since it's working
    if (eulerAvail && process.env.DIRECT_SIGNER_PRIORITY !== '1') {
        console.log('[SignServer] Both TIKTOK_COOKIES and SIGN_API_KEY found — using EulerStream (set DIRECT_SIGNER_PRIORITY=1 to force direct signer)');
        return;
    }

    console.log('[SignServer] TIKTOK_COOKIES/SESSION_ID found — using direct signer.');
    await ensureSigner();

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

    // Mock WS + imFetch polling (stable path)
    console.log('[SignServer] Using imFetch polling for messages');
    const origSetup = TikTokLiveConnection.prototype.setupWebsocket;
    TikTokLiveConnection.prototype.setupWebsocket = async function (wsUrl, wsParams, roomId) {
        // Try real WS if signer is ready
        if (signerReady) {
            try {
                const signed = await signWsUrl(wsUrl);
                if (signed?.signedUrl) {
                    console.log('[SignServer] Creating signed WS...');
                    const ws = new WebSocket(signed.signedUrl);
                    const ready = new Promise((resolve, reject) => {
                        ws.onopen = () => { console.log('[SignServer] WS connected'); resolve(); };
                        ws.onerror = (e) => { reject(new Error('WS error: ' + (e?.message || 'unknown'))); };
                        setTimeout(() => reject(new Error('WS timeout')), 10000);
                    });
                    await ready;
                    ws.onclose = (ev) => console.log('[SignServer] WS closed:', ev.code, ev.reason || '');
                    ws.onerror = () => {};
                    this._wsClientProvider = () => ws;
                    return origSetup.call(this, signed.signedUrl, wsParams, roomId);
                }
            } catch (e) {
                console.warn('[SignServer] Real WS failed:', e.message);
            }
        }

        // Fallback: mock WS + imFetch polling
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
    if (d?.type && d?.data && typeof d.data === 'object' && !Array.isArray(d.data)) {
        method = d.type;
        d = d.data;
    }

    const user = d?.user?.nickname || d?.user?.uniqueId || d?.user?.displayId || '';
    const content = (typeof d?.content === 'string') ? d.content.substring(0, 40) : '';
    const viewers = d?.total || d?.totalUser || '';
    const memberCount = d?.memberCount || '';
    const likes = d?.count || d?.likeCount || '';

    const parts = [];
    if (user) parts.push(`u=${user.substring(0, 16)}`);
    if (content) parts.push(`msg=${content}`);
    if (viewers) parts.push(`viewers=${viewers}`);
    if (memberCount) parts.push(`mem=${memberCount}`);
    if (likes) parts.push(`likes=${likes}`);
    if (parts.length === 0) parts.push('(no content)');

    return method + ' | ' + parts.join(' ');
}

function imFetchPollLoop(roomId, connection, mock) {
    let cursor = '0';
    let errCount = 0;
    let silentCount = 0;
    let consecErrors = 0;

    const poll = async () => {
        while (connection._wsClientInstance === mock) {
            // Pause if too long without messages (10+ silent polls)
            if (silentCount >= 10) {
                console.log('[imFetch] No messages for a while, pausing polling');
                await new Promise(r => setTimeout(r, 120000));
                silentCount = 0;
                continue;
            }

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
                            // Log first few messages
                            for (const msg of msgs.slice(0, 5)) {
                                console.log('[imFetch]', fmt(msg));
                            }
                            mock.emit('protoMessageFetchResult', d);
                        } else {
                            silentCount++;
                        }
                    }
                }
            } catch (e) {
                errCount++;
                consecErrors++;
                if (errCount % 10 === 1) console.warn('[imFetch] err:', e.message);
                if (consecErrors >= 2) {
                    console.warn('[imFetch] 2 consecutive errors, resetting fetch page');
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

            // Adaptive interval: 10s active → 120s idle
            const elapsed = Date.now() - start;
            let wait;
            if (errCount > 0) {
                wait = 60000;
            } else if (silentCount > 3) {
                wait = Math.min(15000 + (silentCount - 3) * 10000, 120000);
            } else {
                wait = 10000;
            }
            wait = Math.max(1, wait - elapsed);
            await new Promise(r => setTimeout(r, wait));
        }
    };
    poll();
}
