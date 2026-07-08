import { RouteConfig, RoomIdRouteConfig } from 'tiktok-live-connector';
import { initDirectSigner, directSign, signWebSocketForUser, closeDirectSigner } from './direct-signer.mjs';

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

    // Skip Euler Stream — use TikTok API directly
    RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = true;
    RoomIdRouteConfig.skipFetchRoomInfoFromHtmlRoute = true;
    RoomIdRouteConfig.skipFetchRoomInfoFromApiLiveRoute = false;

    // X-Bogus signing for HTTP API requests
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

    // WebSocket URL resolver: local im/fetch/ → CDP fallback
    RouteConfig.fetchSignedWebSocketFromProvider = async ({ webClient, roomId, cursor: incomingCursor }) => {
        const cursor = incomingCursor || '0';
        let result = null;
        let fromCache = false;

        // Step 1: Try local im/fetch/ with X-Bogus
        try {
            const fetchParams = { room_id: roomId, cursor };
            result = await webClient.getDeserializedObjectFromWebcastApi(
                'im/fetch/',
                fetchParams,
                'ProtoMessageFetchResult',
                true
            );
            if (result?.pushServer) {
                console.log(`[SignServer] Local im/fetch/ OK: ${result.pushServer}`);
            }
        } catch (e) {
            console.warn(`[SignServer] Local im/fetch/ failed: ${e.message?.substring(0, 60)}`);
        }

        // Step 2: If local failed, try CDP capture from live page
        if (!result?.pushServer && currentUsername) {
            console.log('[SignServer] Falling back to CDP WS capture...');
            try {
                const wsInfo = await signWebSocketForUser(currentUsername);
                if (wsInfo) {
                    result = {
                        cursor: '0',
                        internalExt: '',
                        pushServer: wsInfo.pushServer,
                        routeParams: wsInfo.routeParams,
                        needAck: false,
                        messages: []
                    };
                    console.log(`[SignServer] CDP captured pushServer: ${wsInfo.pushServer}`);
                }
            } catch (e2) {
                console.warn(`[SignServer] CDP fallback also failed: ${e2.message?.substring(0, 60)}`);
            }
        }

        // Step 3: Return whatever we got (or defaults)
        return {
            fetchResult: result || {
                cursor,
                internalExt: '',
                pushServer: 'wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/',
                routeParams: {},
                needAck: false,
                messages: []
            },
            fetchResultCookieHeader: '',
            fetchResultRoomId: roomId
        };
    };
}
