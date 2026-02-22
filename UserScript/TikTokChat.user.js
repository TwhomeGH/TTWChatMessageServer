// ==UserScript==
// @name         TikTok Live Chat & Viewer Scraper
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  抓取 TikTok 直播聊天室訊息與觀眾列表 JSON（聊天改為抓頭像）
// @author       Nuclear0709
// @match        *://www.tiktok.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-end

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

    // 監控 DOM 新增元素的工具函式
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

    // 監控 DOM 變化的工具函式（包含屬性、文字等變化）
    function onElementChanged(selector, callback, options = {}) {
    const {
        attributes = true,
        characterData = true,
        childList = true,
        subtree = true,
        attributeFilter = null
    } = options;

    const observer = new MutationObserver(mutations => {
        const triggered = new Set();

        for (const mutation of mutations) {
            let target = mutation.target;

            // 找到符合 selector 的最近祖先（包含自己）
            if (target.nodeType === 3) target = target.parentElement; // text node
            if (!target) continue;

            const el = target.matches?.(selector)
                ? target
                : target.closest?.(selector);

            if (el && !triggered.has(el)) {
                triggered.add(el);
                callback(el, mutation);
            }
        }
    });

    observer.observe(document.body, {
        attributes,
        characterData,
        childList,
        subtree,
        attributeFilter
    });

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

    setInterval(() => {
        const currentViewers = getViewers();
        console.log("Current viewers:", currentViewers);
    }, 5000); // 每 5 秒更新一次觀眾列表

    setTimeout(() => {
        // 初次抓取觀眾列表
        console.log("Current viewers after 5s:", getViewers());
    
    // 監控聊天室新訊息
    onElementAdded('div[data-e2e="chat-message"]', getNewChatMessages);

    // 監控觀眾進入訊息
    onElementChanged('div[data-e2e="enter-message"]', getNewEnterMessages);
    }, 5000);

})();
