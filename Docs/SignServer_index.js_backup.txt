import { RouteConfig, RoomIdRouteConfig, WebSocketConfigDefaults, TikTokLiveConnection } from 'tiktok-live-connector';
import { SIGN_SERVER_CONFIG } from './config.js';
import { initDirectSigner, directSign } from './direct-signer.mjs';

const { pushServer } = SIGN_SERVER_CONFIG;
let signerReady = false;
let signerPromise = null;

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
    // Start initializing the signer immediately (non-blocking)
    ensureSigner();

    // Override room ID fetching
    RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = true;
    RoomIdRouteConfig.skipFetchRoomInfoFromHtmlRoute = true;
    RoomIdRouteConfig.skipFetchRoomInfoFromApiLiveRoute = false;

    // Override HTTP request signing to use direct X-Bogus computation
    RouteConfig.fetchWebcastSignatureFromProvider = async ({ url, method, userAgent }) => {
        const ready = await ensureSigner();
        if (ready) {
            try {
                const result = await directSign(url);
                if (result.xBogus) {
                    return {
                        response: {
                            signedUrl: result.signedUrl,
                            userAgent,
                        }
                    };
                }
            } catch (e) {
                console.warn('[SignServer] sign failed:', e.message);
            }
        }
        console.warn('[SignServer] using unsigned URL');
        return { response: { signedUrl: url, userAgent } };
    };

    // Override WebSocket connection to sign the URL with X-Bogus
    const origSetupWebsocket = TikTokLiveConnection.prototype.setupWebsocket;
    TikTokLiveConnection.prototype.setupWebsocket = async function (wsUrl, wsParams, roomId) {
        const ready = await ensureSigner();
        if (ready) {
            try {
                const fullParams = {
                    ...WebSocketConfigDefaults.DEFAULT_WS_CLIENT_PARAMS,
                    ...wsParams,
                };
                const fullUrl = wsUrl + '?' +
                    new URLSearchParams(fullParams).toString() +
                    (WebSocketConfigDefaults.DEFAULT_WS_CLIENT_PARAMS_APPEND_PARAMETER || '');

                const result = await directSign(fullUrl);
                if (result.xBogus) {
                    wsParams['X-Bogus'] = result.xBogus;
                }
            } catch (e) {
                console.warn('[SignServer] WebSocket URL signing failed:', e.message);
            }
        }
        return origSetupWebsocket.call(this, wsUrl, wsParams, roomId);
    };

    // Override the WebSocket URL provider
    RouteConfig.fetchSignedWebSocketFromProvider = async ({ roomId, webClient, cursor: incomingCursor }) => {
        const cursor = incomingCursor || webClient.clientParams?.cursor || '0';

        const imFetchParams = {
            ...webClient.clientParams,
            room_id: roomId,
            cursor,
        };

        try {
            const fetchResult = await webClient.getDeserializedObjectFromWebcastApi(
                'im/fetch/',
                imFetchParams,
                'ProtoMessageFetchResult',
                true
            );

            return {
                fetchResult: {
                    cursor: fetchResult.cursor || cursor,
                    internalExt: fetchResult.internalExt || '',
                    pushServer: fetchResult.pushServer || pushServer,
                    routeParams: {},
                    needAck: fetchResult.needAck || false,
                    messages: fetchResult.messages || []
                },
                fetchResultCookieHeader: '',
                fetchResultRoomId: roomId
            };
        } catch (err) {
            console.warn('[SignServer] im/fetch/ failed:', err.message);
            return {
                fetchResult: {
                    cursor: '0',
                    internalExt: '',
                    pushServer,
                    routeParams: {},
                    needAck: false,
                    messages: []
                },
                fetchResultCookieHeader: '',
                fetchResultRoomId: roomId
            };
        }
    };
}
