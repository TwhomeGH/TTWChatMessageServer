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

    // Mock WS + im/fetch/ polling for real-time messages
    const origSetup = TikTokLiveConnection.prototype.setupWebsocket;
    TikTokLiveConnection.prototype.setupWebsocket = async function (wsUrl, wsParams, roomId) {
        console.log('[SignServer] Mock WS + imFetch polling');
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

function formatMessage(msg) {
    const method = msg?.common?.method || msg?.method || '?';
    const details = [];

    // Chat message
    if (msg?.content) {
        const user = msg.user?.nickname || msg.user?.uniqueId || '';
        details.push(`user=${user} msg=${msg.content.substring(0, 100)}`);
    }
    // Member join
    if (method === 'WebcastMemberMessage') {
        const user = msg.user?.nickname || msg.user?.uniqueId || '';
        const count = msg.memberCount || '';
        details.push(`user=${user} count=${count}`);
    }
    // Gift
    if (method === 'WebcastGiftMessage') {
        const user = msg.user?.nickname || '';
        const gift = msg.gift?.name || msg.gift?.describe || '';
        const repeat = msg.repeatCount || msg.gift?.repeatCount || 1;
        details.push(`user=${user} gift=${gift} x${repeat}`);
    }
    // Follow
    if (method === 'WebcastSocialMessage') {
        const user = msg.user?.nickname || '';
        const action = msg.action || '';
        details.push(`user=${user} action=${action}`);
    }
    // Like
    if (method === 'WebcastLikeMessage') {
        const user = msg.user?.nickname || '';
        const count = msg.count || msg.likeCount || 0;
        details.push(`user=${user} likes=${count}`);
    }
    // Room user count
    if (method === 'WebcastRoomUserSeqMessage') {
        const viewerCount = msg.total || msg.totalUser || '';
        details.push(`viewers=${viewerCount}`);
    }
    // Share
    if (method === 'WebcastShareMessage') {
        const user = msg.user?.nickname || '';
        const target = msg.shareTarget || '';
        details.push(`user=${user} target=${target}`);
    }
    // Question / envelope / room message
    if (method === 'WebcastRoomMessage' && msg.content) {
        details.push(`content=${msg.content.substring(0, 80)}`);
    }
    // Envelope (diamond)
    if (msg?.envelopeInfo) {
        const e = msg.envelopeInfo;
        details.push(`diamonds=${e.diamondCount} people=${e.peopleCount} sender=${e.sendUserName || ''}`);
    }
    // Goal / subscription / super fan
    if (method === 'WebcastInRoomBannerMessage') {
        details.push('(banner)');
    }

    const detailStr = details.length > 0 ? ' | ' + details.join(' | ') : '';
    return method + detailStr;
}

function imFetchPollLoop(roomId, connection, mock) {
    let cursor = '0';
    let errCount = 0;
    let pollCount = 0;
    const poll = async () => {
        while (connection._wsClientInstance === mock) {
            try {
                const raw = await browserFetchSigned({ room_id: roomId, cursor });
                if (raw && raw.length > 0) {
                    const d = deserializeMessage('ProtoMessageFetchResult', Buffer.from(raw));
                    if (d) {
                        if (d.cursor) { cursor = d.cursor; errCount = 0; }
                        const msgs = d.messages || [];
                        if (msgs.length > 0) {
                            pollCount++;
                            for (const msg of msgs) {
                                console.log('[imFetch]', formatMessage(msg));
                                if (typeof connection._handleMessage === 'function') connection._handleMessage(msg);
                            }
                        }
                    }
                }
            } catch (e) {
                errCount++;
                if (errCount % 10 === 1) console.warn('[imFetch] err:', e.message);
                if (errCount > 30) { errCount = 0; await new Promise(r => setTimeout(r, 10000)); }
            }
            await new Promise(r => setTimeout(r, errCount > 5 ? 5000 : 2000));
        }
    };
    poll();
}
