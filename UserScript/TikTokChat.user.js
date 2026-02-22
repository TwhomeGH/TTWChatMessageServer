// ==UserScript==
// @name         TikTok Live Chat & Viewer Scraper
// @namespace    http://tampermonkey.net/
// @version      1.6
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
function watchEnterMessages(callback) {
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;

                const enterEls = [];

                if (node.matches?.('div[data-e2e="enter-message"]')) {
                    enterEls.push(node);
                }

                node.querySelectorAll?.('div[data-e2e="enter-message"]')
                    .forEach(el => enterEls.push(el));

                enterEls.forEach(el => {
                    const container = el.parentElement?.parentElement || el;

                    // 👉 等文字出現
                    waitForContent(el, text => {
                        callback(container, el, text);
                    });
                });
            });
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    return observer;
}

function waitForContent(el, callback) {
    // 先快檢
    if (hasContent(el)) {
        callback(el.textContent.trim());
        return;
    }

    const observer = new MutationObserver(() => {
        if (hasContent(el)) {
            observer.disconnect();
            callback(el.textContent.trim());
        }
    });

    observer.observe(el, {
        childList: true,
        characterData: true,
        subtree: true
    });

    // 安全釋放
    setTimeout(() => observer.disconnect(), 1500);
}

function hasContent(el) {
    if (!el) return false;

    // 有可見文字
    if (el.textContent.trim().length > 0) return true;

    // 或者已經有子元素
    if (el.children.length > 0) return true;

    return false;
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

    // 觀眾人數通常在一個包含 "觀眾人數" 字樣的元素中，裡面有多個 span 組成的數字
    function getViewerCount() {
        const container = Array.from(document.querySelectorAll('[data-e2e="live-chat-container"]'))
            .find(el => el.textContent.includes('觀眾人數'));


        if (!container) return null;

        const digits = container.querySelectorAll('.inline-flex.justify-center.w-9');

        console.log('找到觀眾人數容器:', container,digits);

        const number = Array.from(digits)
            .map(el => {
                //console.log('處理數字元素:', el, el.textContent);

                return el.textContent.trim();
    })
            .join('');

        if (number == null || number === '') return 0;

        return Number(number);
    }

    // 監控聊天室新訊息
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

    // 監控觀眾進入訊息
    function getNewEnterMessages(node) {
        // node 為新增的 chat message
        //console.log("Processing enter message node:", node);
    
        var nodeKey=node.querySelector('[data-e2e="enter-message"]')

        console.log("Checking enter message key element:", nodeKey);

        const userName = nodeKey.querySelector('[data-e2e="message-owner-name"]')?.innerText?.trim();
    
        // 精準抓訊息本身
        const text = nodeKey.querySelector('div.inline-flex.items-center.break-words.ltr\\:ml-4.rtl\\:mr-4')?.innerText?.trim();
        const avatar = 'https://img.icons8.com/?size=100&id=1090&format=png&color=355FFF'

        if (userName && text) {
            sendSocketMessage(userName, text, avatar, null, false);
            console.log("加入訊息送出:", { userName, text, avatar });
        }
    }


    setInterval(() => {
        const viewers = getViewerCount();
        console.log('觀眾人數:', viewers);
    }, 60000); // 每 60 秒更新一次觀眾列表

    setTimeout(() => {
        // 初次抓取觀眾列表
        console.log("Current viewers after 5s:", getViewers());
    
    // 監控聊天室新訊息
    onElementAdded('div[data-e2e="chat-message"]', getNewChatMessages);

    }, 5000);

    setTimeout(() => {
        // 監控觀眾進入訊息
        watchEnterMessages(getNewEnterMessages);
    }, 15000);

})();
