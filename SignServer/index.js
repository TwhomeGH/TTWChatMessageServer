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

function pickMsg(msg) {
    if (!msg || typeof msg !== 'object') return '';
    for (const k of ['content', 'describe', 'label', 'action']) {
        const v = msg[k];
        if (v && typeof v === 'string') return v.substring(0, 80);
    }
    return '';
}

function formatMessage(msg) {
    const method = msg?.common?.method || msg?.method || '?';
    const details = [];

    const user =
        msg?.user?.nickname ||
        msg?.user?.uniqueId ||
        msg?.user?.displayId ||
        '';
    const content = msg?.content || '';

    switch (method) {
        case 'WebcastChatMessage':
            details.push(`user=${user} msg=${content.substring(0, 120)}`);
            break;
        case 'WebcastMemberMessage': {
            const count = msg.memberCount || '';
            details.push(`user=${user} count=${count}`);
            break;
        }
        case 'WebcastGiftMessage': {
            const gift = msg.gift?.name || msg.gift?.describe || '';
            const repeat = msg.repeatCount || msg.gift?.repeatCount || 1;
            details.push(`user=${user} gift=${gift} x${repeat}`);
            break;
        }
        case 'WebcastSocialMessage':
            details.push(`user=${user} action=${msg.action || 'follow'}`);
            break;
        case 'WebcastLikeMessage': {
            const count = msg.count || msg.likeCount || 0;
            details.push(`user=${user} likes=${count}`);
            break;
        }
        case 'WebcastRoomUserSeqMessage':
            details.push(`viewers=${msg.total || msg.totalUser || ''}`);
            break;
        case 'WebcastShareMessage':
            details.push(`user=${user} target=${msg.shareTarget || ''}`);
            break;
        case 'WebcastRoomMessage':
            if (content) details.push(`content=${content.substring(0, 120)}`);
            break;
        case 'WebcastLiveIntroMessage': {
            const desc = pickMsg(msg);
            if (desc) details.push(`desc=${desc}`);
            else details.push(`id=${msg.id || '?'}`);
            break;
        }
        case 'WebcastRoomPinMessage': {
            if (content) details.push(`content=${content.substring(0, 120)}`);
            else details.push('(pinned)');
            break;
        }
        case 'WebcastLiveGameIntroMessage': {
            const gameName = msg.gameName || msg.label || '';
            if (gameName) details.push(`game=${gameName}`);
            else details.push('(game)');
            break;
        }
        case 'WebcastInRoomBannerMessage':
            details.push('(banner)');
            break;
        case 'WebcastEnvelopeMessage': {
            const e = msg.envelopeInfo || msg;
            details.push(`diamonds=${e.diamondCount} people=${e.peopleCount} sender=${e.sendUserName || user || '?'}`);
            break;
        }
        case 'WebcastGoalMessage':
        case 'WebcastSubNotifyMessage': {
            const desc = pickMsg(msg);
            if (desc) details.push(desc);
            break;
        }
        case 'WebcastControlMessage':
            details.push(`action=${msg.action || '?'}`);
            break;
        default: {
            // fallback: show any useful field found
            const picked = pickMsg(msg);
            if (picked) details.push(picked);
            if (user) details.push(`user=${user}`);
            if (msg?.describe) details.push(`describe=${msg.describe}`);
            if (msg?.label) details.push(`label=${msg.label}`);
            if (msg?.action) details.push(`action=${msg.action}`);

            // show gift if present in any message shape
            if (msg?.gift?.name) {
                details.push(`gift=${msg.gift.name}`);
            }
            // show envelope fields
            if (msg?.envelopeInfo) {
                const e = msg.envelopeInfo;
                details.push(`diamonds=${e.diamondCount} people=${e.peopleCount}`);
            }

            // for complete silence, dump first key
            if (details.length === 0) {
                const keys = Object.keys(msg).filter(k => k !== 'common');
                if (keys.length > 0) details.push(`keys=${keys.slice(0, 5).join(',')}`);
            }
            break;
        }
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
