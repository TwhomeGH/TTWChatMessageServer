// ==UserScript==
// @name         TikTok WS Relay
// @namespace    ws-bridge
// @version      1.4
// @description  Intercept webcast-ws URL, binary and text messages; relay to local Node server
// @author       debug
// @match        https://www.tiktok.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/ws-relay.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/ws-relay.user.js
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';
    const ENDPOINT_KEY = 'ttw-main-endpoint';
    const DEFAULT_ENDPOINT = 'http://127.0.0.1:3332';

    function normalizeEndpoint(value) {
        let raw = String(value || '').trim();
        if (!raw || raw.length > 500) return null;
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'http://' + raw;
        let url;
        try { url = new URL(raw); } catch { return null; }
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
        if (url.username || url.password || url.search || url.hash) return null;
        const path = url.pathname.replace(/\/+$/, '');
        return url.origin + (path && path !== '/' ? path : '');
    }

    function ttwEndpoint() {
        try {
            return normalizeEndpoint(GM_getValue(ENDPOINT_KEY, DEFAULT_ENDPOINT)) || DEFAULT_ENDPOINT;
        } catch { return DEFAULT_ENDPOINT; }
    }

    function saveEndpoint(value) {
        const normalized = normalizeEndpoint(value);
        if (!normalized) return null;
        try { GM_setValue(ENDPOINT_KEY, normalized); } catch { /* ignore */ }
        return normalized;
    }

    function changeEndpoint() {
        const value = window.prompt('TTW 主服務位址', ttwEndpoint());
        if (value === null) return;
        const saved = saveEndpoint(value);
        if (!saved) { window.alert('格式無效：請輸入 http://host:port 或 host:port'); return; }
        window.alert('已儲存：' + saved);
    }

    const installed = Symbol.for('ttw.ws-relay.installed');
    if (window[installed]) return;
    window[installed] = true;
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('設定 TTW 主服務位址', changeEndpoint);
    const OrigWS = window.WebSocket;
    let urlSent = false;

    function post(route, payload) {
        try {
            GM_xmlhttpRequest({
                method: 'POST', url: ttwEndpoint() + route,
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
