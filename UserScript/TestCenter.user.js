// ==UserScript==
// @name         TikTok Socket Test Button
// @namespace    pip-chat-test
// @version      1.6
// @description  Manual test button for local socket bridge (SPA safe)
// @match        https://livecenter.tiktok.com/*
// @match        https://*.bing.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *


// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/TestCenter.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/TestCenter.user.js

// ==/UserScript==

(function () {
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
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('設定 TTW 主服務位址', changeEndpoint);

    const BUTTON_ID = "socketTestBtn";

    function sendTestMessage() {
        const payload = {
            type: 'StreamMessage', platform: 'Unknown', transport: 'userscript', isTest: true,
            user: '測試使用者',
            message: '這是一條測試訊息 ' + new Date().toLocaleTimeString(),
            img: "https://github.com/TwhomeGH/TTWChatMessageServer/blob/main/Emoji/Neuro2.png?raw=true",
            giftImg: 'https://img.icons8.com/?size=100&id=124062&format=png&color=000000',
            isMain: true,
            userNum: 300, // 模擬頭號觀眾人數
            userList: ['肉鬆', '松鼠', '瓜瓜'] // 模擬頭號觀眾名字列表
        };

        const sendURL = `${ttwEndpoint()}/chat`;

        console.log("📤 發送測試訊息:", payload);

        GM_xmlhttpRequest({
            method: "POST",
            url: sendURL,
            data: JSON.stringify(payload),
            headers: {
                "Content-Type": "application/json"
            },
            onload: function (response) {
                console.log("✅ 發送成功:", response.status);
            },
            onerror: function (err) {
                console.error("❌ 發送失敗:", err);
            }
        });
    }

    function createTestButton() {
        // 避免重複生成
        if (document.getElementById(BUTTON_ID)) return;

        const btn = document.createElement("button");
        btn.id = BUTTON_ID;
        btn.innerText = "🧪 測試 Socket";
        btn.style.position = "fixed";
        btn.style.bottom = "40px";
        btn.style.right = "20px";
        btn.style.zIndex = "999999";
        btn.style.padding = "10px 16px";
        btn.style.background = "#ff2d55";
        btn.style.color = "#fff";
        btn.style.border = "none";
        btn.style.borderRadius = "8px";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "14px";
        btn.style.boxShadow = "0 4px 10px rgba(0,0,0,0.3)";
        btn.addEventListener("click", sendTestMessage);

        // 確保 body 已存在
        const appendBtn = () => {
            if (document.body) {
                document.body.appendChild(btn);
            } else {
                setTimeout(appendBtn, 500);
            }
        };
        appendBtn();
    }

    // SPA / 動態載入安全：監控 DOM 變化
    const observer = new MutationObserver(() => {
        createTestButton();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 初始呼叫一次
    setTimeout(createTestButton, 1000);

})();