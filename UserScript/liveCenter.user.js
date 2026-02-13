// ==UserScript==
// @name         TikTok Live Chat → Socket Bridge
// @namespace    pip-chat-bridge
// @version      1.0
// @description  Listen TikTok live chat and forward to socket server
// @author       Nuclear0709
// @match        https://livecenter.tiktok.com/*
// @grant GM_xmlhttpRequest


// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/liveCenter.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/liveCenter.user.js

// ==/UserScript==

(function () {
    'use strict';

    /**********************
     * 🔌 Socket 設定
     **********************/
    const HTTP_HOST = "127.0.0.1";
    const HTTP_PORT = 3332;




function sendSocketMessage(user, message, img, giftImg, isMain = true) {

    const payload = {
        type: 'StreamMessage',
        user,
        message,
        img,
        giftImg,
        isMain
    };


    const sendURL = `http://${HTTP_HOST}:${HTTP_PORT}/chat`

    console.log("sendTo",sendURL)

    GM_xmlhttpRequest({
    method: "POST",
    url: sendURL,
    data: JSON.stringify(payload),
    headers: {
        "Content-Type": "application/json"
    }
});


}

    /**********************
     * 💬 處理聊天室節點
     **********************/
    function handleChatMessage(element) {
        if (!element.matches('[data-e2e="chat-message"]')) return;

        // 頭像
        const avatar = element.querySelector('img');
        const avatarUrl = avatar?.src || "";

        // 使用者名稱
        const nameElement = element.querySelector('[data-e2e="message-owner-name"]');
        const username = nameElement?.textContent?.trim() || "";

        // 訊息內容
        const messageElement = element.querySelector('.css-wz5k0l');
        const message = messageElement?.textContent?.trim() || "";

        if (!username || !message) return;

        console.log("📩 新訊息:", username, message);

        sendSocketMessage(username, message, avatarUrl, null, true);
    }

    /**********************
     * 👀 MutationObserver
     **********************/
    function startObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;

                    // 如果新增的是 chat-message
                    handleChatMessage(node);

                    // 或裡面包含 chat-message
                    node.querySelectorAll?.('[data-e2e="chat-message"]')
                        .forEach(handleChatMessage);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log("👀 已開始監聽聊天室");
    }

    /**********************
     * 🚀 啟動
     **********************/
    window.addEventListener("load", () => {
        setTimeout(startObserver, 3000); // 等頁面穩定
    });

})();