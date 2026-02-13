// ==UserScript==
// @name         TikTok Socket Test Button
// @namespace    pip-chat-test
// @version      1.1
// @description  Manual test button for local socket bridge (SPA safe)
// @match        https://livecenter.tiktok.com/*
// @match        https://*.bing.com/*
// @grant        GM_xmlhttpRequest


// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/TestCenter.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/TestCenter.user.js

// ==/UserScript==

(function () {
    'use strict';

    const HTTP_HOST = "192.168.0.102";
    const HTTP_PORT = 3332;
    const BUTTON_ID = "socketTestBtn";

    function sendTestMessage() {
        const payload = {
            type: 'StreamMessage',
            user: '測試使用者',
            message: '這是一條測試訊息 ' + new Date().toLocaleTimeString(),
            img: 'https://img.icons8.com/?size=100&id=124062&format=png&color=000000',
            giftImg: null,
            isMain: true
        };

        const sendURL = `http://${HTTP_HOST}:${HTTP_PORT}/chat`;

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
        btn.style.bottom = "20px";
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