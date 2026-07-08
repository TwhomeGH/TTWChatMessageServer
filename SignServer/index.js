import { RouteConfig, RoomIdRouteConfig } from 'tiktok-live-connector';
import { initDirectSigner, directSign } from './direct-signer.mjs';
import { SIGN_SERVER_CONFIG } from './config.js';

let signerReady = false;
let signerPromise = null;
let currentUsername = '';
let origSetupWebsocket = null; // saved in setupCustomSignServer

export function setStreamerName(name) {
    currentUsername = name;
    console.log(`[SignServer] Streamer set: ${name}`);
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

    // Override room ID fetching
    RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = true;
    RoomIdRouteConfig.skipFetchRoomInfoFromHtmlRoute = true;
    RoomIdRouteConfig.skipFetchRoomInfoFromApiLiveRoute = false;

    // Override HTTP request signing to use direct X-Bogus computation
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

    /**
     * CDP-based WebSocket proxy.
     */
    const origConnect = TikTokLiveConnection.prototype.connect;
    TikTokLiveConnection.prototype.connect = async function (roomId) {
        // Initialize the live page - this lets TikTok's JS handle the WS
        if (currentUsername) {
            console.log(`[SignServer] Initializing CDP live page for ${currentUsername}...`);
            const ready = await initLivePage(currentUsername);
            if (ready) {
                console.log('[SignServer] CDP live page ready, starting message poller');
                startMessagePoller(this);
            } else {
                console.warn('[SignServer] CDP live page init failed, falling through to normal flow');
            }
        }

        return origConnect.call(this, roomId);
    };

    // Override fetchSignedWebSocketFromProvider to use im/fetch/ API (signed with X-Bogus)
    // This gives us the REAL pushServer (correct region) and routeParams from TikTok itself.
    RouteConfig.fetchSignedWebSocketFromProvider = async ({ webClient, roomId, cursor: incomingCursor }) => {
        const cursor = incomingCursor || '0';
        let resolvedPushServer = pushServer;
        let resolvedRouteParams = {};
        let resolvedCursor = cursor;
        let resolvedInternalExt = '';

        try {
            const fetchParams = { room_id: roomId, cursor };
            const result = await webClient.getDeserializedObjectFromWebcastApi(
                'im/fetch/',
                fetchParams,
                'ProtoMessageFetchResult',
                true // signRequest = true (uses X-Bogus via our fetchWebcastSignatureFromProvider)
            );
            if (result) {
                if (result.pushServer) {
                    resolvedPushServer = result.pushServer;
                    console.log(`[SignServer] im/fetch/ pushServer: ${resolvedPushServer}`);
                } else {
                    console.log(`[SignServer] im/fetch/ no pushServer, keys: ${Object.keys(result).join(', ')}`);
                }
                if (result.routeParams) resolvedRouteParams = result.routeParams;
                if (result.cursor) resolvedCursor = result.cursor;
                if (result.internalExt) resolvedInternalExt = result.internalExt;
            }
        } catch (e) {
            const msg = e.message || e;
            console.warn(`[SignServer] im/fetch/ failed: ${msg}, using default pushServer`);
        }

        return {
            fetchResult: {
                cursor: resolvedCursor,
                internalExt: resolvedInternalExt,
                pushServer: resolvedPushServer,
                routeParams: resolvedRouteParams,
                needAck: false,
                messages: []
            },
            fetchResultCookieHeader: '',
            fetchResultRoomId: roomId
        };
    };

    // Override setupWebsocket to use the original library WebSocket
    // (which connects with cursor/room_id params, no X-Bogus needed for most regions)
    origSetupWebsocket = TikTokLiveConnection.prototype.setupWebsocket;
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
                        console.log(`[SignServer] CDP WS closed (code: ${msg.code})`);
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
