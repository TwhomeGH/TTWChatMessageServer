// ==UserScript==
// @name         TikTok Live Chat & Viewer Scraper
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  抓取 TikTok 直播聊天室訊息與觀眾列表 JSON（聊天改為抓頭像）
// @author       Nuclear0709
// @match        *://www.tiktok.com/*
// @grant        GM_xmlhttpRequest

// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/TikTokChat.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/TikTokChat.user.js

// ==/UserScript==

(function() {
    'use strict';

    const HTTP_HOST = "192.168.0.102";
    const HTTP_PORT = 3332;

    // 只發送一次的訊息 Set
    const sentMessages = new WeakSet();

    function sendSocketMessage(user, message, img, giftImg, isMain = true) {
        const payload = { type: 'StreamMessage', user, message, img, giftImg, isMain };
        const sendURL = `http://${HTTP_HOST}:${HTTP_PORT}/chat`;

        console.log("sendTo", sendURL, payload);

        GM_xmlhttpRequest({
            method: "POST",
            url: sendURL,
            data: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            onerror: (err) => console.error("GM_xmlhttpRequest error:", err),
            onload: (res) => console.log("GM_xmlhttpRequest success:", res.status)
        });
    }

    function onElementAdded(selector, callback) {
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && node.matches(selector)) callback(node);
                    if (node.nodeType === 1) node.querySelectorAll(selector).forEach(el => callback(el));
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return observer;
    }

    function getViewers() {
        const viewers = [];
        document.querySelectorAll('[data-e2e="live-chat-container"] .flex.items-center.cursor-pointer').forEach(el => {
            const rank = el.querySelector('div.w-22')?.innerText?.trim();
            const name = el.querySelector('.flex-auto')?.innerText?.trim();
            const giftCount = el.querySelector('.flex-shrink-0.align-middle')?.innerText?.trim();
            if (name) viewers.push({ rank, name, giftCount });
        });
        return viewers;
    }

    function getNewChatMessages(node) {
        // node 為新增的 chat message
        if (sentMessages.has(node)) return;

        const userName = node.querySelector('[data-e2e="message-owner-name"]')?.innerText?.trim();
        
        // 精準抓訊息本身
        const text = node.querySelector('div.w-full.break-words.align-middle.cursor-pointer')?.innerText?.trim();

        const avatar = node.querySelector('div[class*="avatar"] img, img[class*="ImgAvatar"]')?.src
            || node.querySelector('img')?.src;

        if (userName && text) {
            sendSocketMessage(userName, text, avatar, null, true);
            sentMessages.add(node);
            console.log("New message sent:", { userName, text, avatar });
        }
    }

    function getNewEnterMessages(node) {
        // node 為新增的 chat message
        if (sentMessages.has(node)) return;

        const userName = node.querySelector('[data-e2e="message-owner-name"]')?.innerText?.trim();
    
        // 精準抓訊息本身
        const text = node.querySelector('div.w-full.break-words.align-middle.cursor-pointer')?.innerText?.trim();

        const avatar = 'https://img.icons8.com/?size=100&id=60989&format=png&color=000000'

        if (userName && text) {
            sendSocketMessage(userName, text, avatar, null, true);
            sentMessages.add(node);
            console.log("New Enter message sent:", { userName, text, avatar });
        }
    }

    // 初次抓取觀眾列表
    console.log("Current viewers:", getViewers());

    // 監控聊天室新訊息
    onElementAdded('div[data-e2e="chat-message"]', getNewChatMessages);

    // 監控觀眾進入訊息
    onElementAdded('div[data-e2e="enter-message"]', getNewEnterMessages);

})();
