// ==UserScript==
// @name         TikTok WS Relay
// @namespace    ws-bridge
// @version      1.3
// @description  Intercept webcast-ws URL, binary and text messages; relay to local Node server
// @author       debug
// @match        https://www.tiktok.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/ws-relay.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/ws-relay.user.js
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';
    const RELAY_HOST = 'http://127.0.0.1:3332';
    const installed = Symbol.for('ttw.ws-relay.installed');
    if (window[installed]) return;
    window[installed] = true;
    const OrigWS = window.WebSocket;
    let urlSent = false;

    function post(route, payload) {
        try {
            GM_xmlhttpRequest({
                method: 'POST', url: RELAY_HOST + route,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ platform: 'TikTok', transport: 'userscript', ...payload, time: Date.now() }),
                onerror: () => console.warn('[WS-Relay] Local relay request failed'),
            });
        } catch { console.warn('[WS-Relay] Local relay unavailable'); }
    }
    function relayBinary(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        post('/relay', { type: 'ws_message', data: btoa(binary), byteLength: bytes.length });
    }
    window.WebSocket = new Proxy(OrigWS, {
        construct(target, args, newTarget) {
            const ws = Reflect.construct(target, args, newTarget);
            if (!String(args[0] || '').includes('webcast-ws')) return ws;
            // Preserve the original URL-reporting feature; never log signed URLs.
            if (!urlSent) {
                urlSent = true;
                post('/relay-url', { type: 'ws_url', url: String(args[0]) });
            }
            // One listener per socket: onmessage and multiple page listeners
            // must not duplicate forwarding or change removeEventListener behavior.
            ws.addEventListener('message', event => {
                const data = event.data;
                if (typeof data === 'string') post('/relay', { type: 'ws_text', data });
                else if (data instanceof ArrayBuffer) relayBinary(data);
                else if (data instanceof Blob) data.arrayBuffer().then(relayBinary).catch(() => console.warn('[WS-Relay] Cannot read binary frame'));
            });
            return ws;
        }
    });
    console.log('[WS-Relay] Hook installed');
})();
