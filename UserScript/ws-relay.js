// ==UserScript==
// @name         TikTok WS Relay
// @namespace    ws-bridge
// @version      1.1
// @description  Intercept webcast-ws URL + messages, relay to local Node server
// @author       debug
// @match        https://www.tiktok.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const RELAY_HOST = 'http://127.0.0.1:3332';

    const OrigWS = window.WebSocket;
    let wsCreated = false;

    window.WebSocket = new Proxy(OrigWS, {
        construct(target, args) {
            const url = args[0] || '';
            const urlStr = typeof url === 'string' ? url : String(url);

            if (!urlStr.includes('webcast-ws')) {
                return new target(...args);
            }

            console.log('[WS-Relay] Captured webcast-ws URL');
            // Send the signed WS URL to server once
            if (!wsCreated) {
                wsCreated = true;
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: RELAY_HOST + '/relay-url',
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({
                        type: 'ws_url',
                        url: urlStr.substring(0, 1000),
                        time: Date.now()
                    }),
                });
            }

            const ws = new target(...args);
            const origAdd = ws.addEventListener;

            ws.addEventListener = function(type, handler, ...rest) {
                if (type === 'message') {
                    const wrapped = function(event) {
                        const data = event.data;
                        if (data instanceof ArrayBuffer || data instanceof Blob) {
                            const p = data instanceof Blob ? data.arrayBuffer() : Promise.resolve(data);
                            p.then(buf => {
                                const bytes = new Uint8Array(buf);
                                let binary = '';
                                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                                GM_xmlhttpRequest({
                                    method: 'POST',
                                    url: RELAY_HOST + '/relay',
                                    headers: { 'Content-Type': 'application/json' },
                                    data: JSON.stringify({
                                        type: 'ws_message',
                                        data: btoa(binary),
                                        byteLength: bytes.length,
                                        time: Date.now()
                                    }),
                                });
                            });
                        }
                        handler.apply(this, arguments);
                    };
                    return origAdd.call(this, type, wrapped, ...rest);
                }
                return origAdd.call(this, type, handler, ...rest);
            };

            ws.CONNECTING = 0; ws.OPEN = 1; ws.CLOSING = 2; ws.CLOSED = 3;
            return ws;
        }
    });
    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN = OrigWS.OPEN;
    window.WebSocket.CLOSING = OrigWS.CLOSING;
    window.WebSocket.CLOSED = OrigWS.CLOSED;

    console.log('[WS-Relay] Hook installed');
})();
