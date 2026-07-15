// ==UserScript==
// @name         TikTok Live Chat → Socket Bridge
// @namespace    pip-chat-bridge
// @version      1.8
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

    // 已處理過的訊息集合
    const processedMessages = new Set();

    var FailCount = 0;
    const MaxFail = 5;

    // 定時重置 FailCount
    setInterval(() => {
        if (FailCount > 0) {
            FailCount = 0;
            console.log("liveCenter FailCount 已重置為 0");
        }
    }, 30000);

function sendAudienceUpdate(userNum, userList) {
    const payload = { type: 'audience', userNum, userList };
    const sendURL = `http://${HTTP_HOST}:${HTTP_PORT}/chat`;
    GM_xmlhttpRequest({
        method: "POST", url: sendURL, data: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        onerror: () => { /* ignore */ }
    });
}

function sendSocketMessage(user, message, img, giftImg, isMain = true,userNum = 0, userList = []) {

    const payload = {
        type: 'StreamMessage',
        user,
        message,
        img,
        giftImg,
        isMain,
        userNum,
        userList
    };

    if (FailCount > MaxFail) {
        console.log("liveCenter 訊息服務器未運作，等待30秒後自動恢復")
        return;
    }

    const sendURL = `http://${HTTP_HOST}:${HTTP_PORT}/chat`

    console.log("sendTo",sendURL)

    GM_xmlhttpRequest({
    method: "POST",
    url: sendURL,
    data: JSON.stringify(payload),
    headers: {
        "Content-Type": "application/json"
    },
    onerror: (err) => {
        FailCount += 1;
        console.error("liveCenter GM_xmlhttpRequest error:", err, "DATA", payload);
    },
    onload: (res) => {
        console.log("liveCenter GM_xmlhttpRequest success:", res.status);
        FailCount = 0;
    }
});


}

    /**********************
     * 💬 處理聊天室節點
     **********************/
    function handleChatMessage(element) {
        if (!element.matches('[data-e2e="chat-message"]')) return;

        const avatar = element.querySelector('img');
        const avatarUrl = avatar?.src || "";

        const nameElement = element.querySelector('[data-e2e="message-owner-name"]');
        const username = nameElement?.textContent?.trim() || "";

        const messageElement = element.querySelector('.css-wz5k0l');
        const message = messageElement?.textContent?.trim() || "";

        const users = getTopFanUsers();

        console.log("頭號觀眾人數:", users.length);
        console.log("名字清單:", users);

        if (!username || !message) return;

        // 使用 user+message 作為去重鍵值，避免不同使用者相同內容被誤殺
        const uniqueKey = `${username}:${message}`;
        if (processedMessages.has(uniqueKey)) return;
        processedMessages.add(uniqueKey);

        console.log("📩 新訊息:", username, message);

        console.log("等待0.8秒後送出")
        setTimeout( ()=>{
            console.log(`已送出 ${username} ${message} ${avatarUrl} 人數:${users.length} ${users}`)
            sendSocketMessage(username, message, avatarUrl, null, true, users.length, users);
            sendAudienceUpdate(users.length, users);
        },800)
    }


    function findTopLabel() {
    const xpath = "//div[contains(text(),'頭號觀眾')]";
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue;
}

function getTopFanUsers() {
    const topLabel = findTopLabel();
    if (!topLabel) return [];

    // 往外找到父容器
    const container = topLabel.parentElement.parentElement;
    if (!container) return [];

    // 精準抓「名字區塊」：只找有文字的 div，不要抓全部
    const nameDivs = container.querySelectorAll('div.css-192a2f3');
    const names = Array.from(nameDivs).map(div => div.textContent.trim());

    // 去重複
    const uniqueNames = [...new Set(names)];

    return uniqueNames;
}

    const users = getTopFanUsers();
    console.log("頭號觀眾人數:", users.length);
    console.log("名字清單:", users);



    /**********************
     * 👀 MutationObserver
     **********************/
    function startObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;

                    // 只處理一次
                    if (node.matches('[data-e2e="chat-message"]')) {
                        handleChatMessage(node);
                    } else {
                        node.querySelectorAll?.('[data-e2e="chat-message"]')
                            .forEach(handleChatMessage);
                    }
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
        setTimeout(() => {
            startObserver();
            setInterval(() => {
                const users = getTopFanUsers();
                console.log("頭號觀眾人數:", users.length);
                console.log("名字清單:", users);
            }, 5000); // 每5秒更新一次頭號觀眾列表

        }, 3000); // 等頁面穩定
    });

})();