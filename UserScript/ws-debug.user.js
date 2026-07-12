// ==UserScript==
// @name         TikTok WS Debugger
// @namespace    ws-hook
// @version      1.0
// @description  Intercept WebSocket construction and log URL + call stack
// @author       debug
// @match        https://www.tiktok.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const OrigWS = window.WebSocket;
    window.WebSocket = new Proxy(OrigWS, {
        construct(target, args) {
            const url = args[0] || '';
            const logMsg = {
                type: 'ws_created',
                url: typeof url === 'string' ? url.substring(0, 500) : String(url),
                stack: new Error().stack,
                time: Date.now()
            };
            console.log('[WS-DEBUG]', JSON.stringify(logMsg, null, 2));
            return new target(...args);
        }
    });
    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN = OrigWS.OPEN;
    window.WebSocket.CLOSING = OrigWS.CLOSING;
    window.WebSocket.CLOSED = OrigWS.CLOSED;

    console.log('[WS-DEBUG] Hook installed, waiting for WS connections...');
})();
