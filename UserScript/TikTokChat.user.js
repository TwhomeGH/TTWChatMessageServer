// ==UserScript==
// @name         TikTok Live Chat & Viewer Scraper
// @namespace    http://tampermonkey.net/
// @version      2.5
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
    var View = 0
    var ViewUserList = []
    var FailCount = 0
    let MaxFail = 5

    // 定時重置 FailCount，避免伺服器短暫重啟後永久停發
    setInterval(() => {
        if (FailCount > 0) {
            FailCount = 0;
            console.log("FailCount 已重置為 0");
        }
    }, 30000);

    function sendAudienceUpdate() {
        const payload = { type: 'audience', userNum: View, userList: ViewUserList };
        const sendURL = `http://${HTTP_HOST}:${HTTP_PORT}/chat`;
        GM_xmlhttpRequest({
            method: "POST", url: sendURL, data: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            onerror: () => { /* ignore */ }
        });
    }

    function sendSocketMessage(user, message, img, giftImg, isMain = true,userNum,userList=null) {
        const payload = { type: 'StreamMessage', user, message, img, giftImg, isMain ,userNum,userList};

        const sendURL = `http://${HTTP_HOST}:${HTTP_PORT}/chat`;

        console.log("sendTo", sendURL, payload);

        if (FailCount > MaxFail) {
            console.log("訊息服務器 未運作停止發送，等待 30 秒後自動恢復")
            return;
        }

            GM_xmlhttpRequest({
            method: "POST",
            url: sendURL,
            data: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            onerror: (err) => {
                FailCount+=1
                console.error("GM_xmlhttpRequest error:", err,"DATA",payload,"URL",sendURL)
                
            },
            onload: (res) => {
                console.log("GM_xmlhttpRequest success:", res.status);
                // 成功時重置計數器
                FailCount = 0;
            }
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


        if (!container) return 0;

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
        if (sentMessages.has(node)) return;

        const userName = node.querySelector('[data-e2e="message-owner-name"]')?.innerText?.trim();
        const text = node.querySelector('div.w-full.break-words.align-middle')?.innerText?.trim();
        const avatar = node.querySelector('div[class*="avatar"] img, img[class*="ImgAvatar"]')?.src
            || node.querySelector('img')?.src;

        if (userName && text) {
            sendSocketMessage(userName, text, avatar, null, true, View);
            sentMessages.add(node);
            console.log("New message sent:", { userName, text, avatar });
        }
    }

    // 監控送禮訊息（無 data-e2e，但有禮物圖 + 用戶名）
    function watchGiftMessages(callback) {
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;

                    // 直接找到沒有 data-e2e 且包含禮物圖的容器
                    const containers = [];
                    if (node.matches?.('div.relative.flex.py-4.px-12') &&
                        !node.hasAttribute('data-e2e') &&
                        node.querySelector('span.w-\\[20px\\].h-\\[20px\\] img')) {
                        containers.push(node);
                    }
                    node.querySelectorAll?.('div.relative.flex.py-4.px-12:not([data-e2e])')
                        .forEach(el => {
                            if (el.querySelector('span.w-\\[20px\\].h-\\[20px\\] img')) {
                                containers.push(el);
                            }
                        });

                    containers.forEach(el => {
                        if (!sentMessages.has(el)) callback(el);
                    });
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return observer;
    }

    function getNewGiftMessages(container) {
        const userName = container.querySelector('[data-e2e="message-owner-name"]')?.innerText?.trim();
        if (!userName) return;

        const giftImgEl = container.querySelector('span.w-\\[20px\\].h-\\[20px\\] img, span.w-\\[20px\\] img');
        if (!giftImgEl) return;

        const giftImg = giftImgEl.src;
        const giftName = container.querySelector('span.break-words.ltr\\:ml-4.rtl\\:mr-4')?.innerText?.trim() || '';
        const fullText = container.textContent;
        const qtyMatch = fullText.match(/×\s*(\d+)/);
        const quantity = qtyMatch ? qtyMatch[1] : '1';
        const message = `送出 ${giftName} × ${quantity}`;

        sendSocketMessage(userName, message, null, giftImg, true, View);
        sentMessages.add(container);
        console.log("Gift message sent:", { userName, giftName, quantity, giftImg });
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
            sendSocketMessage(userName, text, avatar, null, false,View);
            console.log("加入訊息送出:", { userName, text, avatar });
        }
    }


    setInterval(() => {
        const viewers = getViewerCount();
        console.log('觀眾人數:', viewers);
        View = viewers
        sendAudienceUpdate();

    }, 15000); // 每 15 秒更新一次觀眾列表

    setTimeout(() => {
        // 初次抓取觀眾列表
        console.log("Current viewers after 5s:", getViewers());
    
    // 監控聊天室新訊息
    onElementAdded('div[data-e2e="chat-message"]', getNewChatMessages);
    // 監控送禮訊息
    watchGiftMessages(getNewGiftMessages);

    }, 5000);

    setTimeout(() => {
        // 監控觀眾進入訊息
        watchEnterMessages(getNewEnterMessages);
    }, 15000);

})();
