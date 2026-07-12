// ==UserScript==
// @name         TikTok WS Relay
// @namespace    ws-bridge
// @version      1.0
// @description  Intercept webcast-ws messages and relay to local Node server
// @author       debug
// @match        https://www.tiktok.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const RELAY_HOST = 'http://127.0.0.1:3332';
    const RELAY_PATH = '/relay';

    // Hook WebSocket constructor to intercept webcast-ws
    const OrigWS = window.WebSocket;
    window.WebSocket = new Proxy(OrigWS, {
        construct(target, args) {
            const url = args[0] || '';
            const urlStr = typeof url === 'string' ? url : String(url);

            // Only intercept live chat WS
            if (!urlStr.includes('webcast-ws')) {
                return new target(...args);
            }

            console.log('[WS-Relay] Intercepted webcast-ws:', urlStr.substring(0, 200));
            const ws = new target(...args);
            const origAdd = ws.addEventListener;

            // Hook addEventListener to wrap message handler
            ws.addEventListener = function(type, handler, ...rest) {
                if (type === 'message') {
                    const wrappedHandler = function(event) {
                        let data = event.data;
                        // Forward raw protobuf to local server (non-blocking)
                        if (data instanceof ArrayBuffer || data instanceof Blob) {
                            if (data instanceof Blob) {
                                data.arrayBuffer().then(buf => {
                                    relayMessage(new Uint8Array(buf));
                                });
                            } else {
                                relayMessage(new Uint8Array(data));
                            }
                        } else if (typeof data === 'string') {
                            relayText(data);
                        }
                        // Call original handler
                        return handler.apply(this, arguments);
                    };
                    return origAdd.call(this, type, wrappedHandler, ...rest);
                }
                return origAdd.call(this, type, handler, ...rest);
            };

            // Restore WebSocket prototype methods
            ws.CONNECTING = 0;
            ws.OPEN = 1;
            ws.CLOSING = 2;
            ws.CLOSED = 3;

            return ws;
        }
    });
    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN = OrigWS.OPEN;
    window.WebSocket.CLOSING = OrigWS.CLOSING;
    window.WebSocket.CLOSED = OrigWS.CLOSED;

    function relayMessage(bytes) {
        // Convert Uint8Array to base64
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);

        GM_xmlhttpRequest({
            method: 'POST',
            url: RELAY_HOST + RELAY_PATH,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({
                type: 'ws_message',
                data: b64,
                byteLength: bytes.length,
                time: Date.now()
            }),
        });
    }

    function relayText(text) {
        GM_xmlhttpRequest({
            method: 'POST',
            url: RELAY_HOST + RELAY_PATH,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({
                type: 'ws_text',
                data: text,
                time: Date.now()
            }),
        });
    }

    console.log('[WS-Relay] Hook installed, waiting for webcast-ws...');
})();
