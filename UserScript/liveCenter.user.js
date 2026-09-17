// ==UserScript==
// @name         TikTok Live Chat → Socket Bridge
// @namespace    pip-chat-bridge
// @version      1.12
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
    const processedMessages = new WeakSet();

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
    const payload = { type: 'audience', platform: 'TikTok', transport: 'userscript', audienceKind: 'top-fans', userNum, userList };
    const sendURL = `http://${HTTP_HOST}:${HTTP_PORT}/chat`;
    GM_xmlhttpRequest({
        method: "POST", url: sendURL, data: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        onerror: () => { /* ignore */ }
    });
}

/**
 * 讀中控台「直播指標」的累計成效。
 * 用文字定位（不綁會變的雜湊 class），取標籤隔壁 span 的數字。
 */
function readMetrics() {
    const pick = label => {
        const node = [...document.querySelectorAll('div')]
            .find(el => el.childElementCount === 0 && el.textContent.trim() === label);
        const text = node?.parentElement?.querySelector('span')?.textContent ?? '';
        const value = Number(text.replace(/[^\d.]/g, ''));
        return Number.isFinite(value) ? value : null;
    };
    return {
        diamonds: pick('鑽石數量'),
        uniqueViewers: pick('觀眾總數'),
        gifters: pick('送禮者'),
        newFollowers: pick('新粉絲'),
        likes: pick('獲讚')
    };
}

/** 每 30 秒送一次累計成效，讓伺服器記錄場次成果。 */
function sendMetrics() {
    const metrics = readMetrics();
    if (Object.values(metrics).every(value => value === null)) return;
    GM_xmlhttpRequest({
        method: "POST",
        url: `http://${HTTP_HOST}:${HTTP_PORT}/chat`,
        data: JSON.stringify({ type: 'metrics', platform: 'TikTok', transport: 'userscript', observedAt: Date.now(), ...metrics }),
        headers: { "Content-Type": "application/json" },
        onerror: () => { /* ignore */ }
    });
}

function sendSocketMessage(user, message, img, giftImg, isMain = true,userNum = 0, userList = [], metadata = {}) {

    const payload = {
        ...metadata, platform: 'TikTok', transport: 'userscript', observedAt: Date.now(), audienceKind: 'top-fans',
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

        // 同一 DOM 節點只處理一次，新節點的相同留言仍可傳送。
        if (processedMessages.has(element)) return;
        processedMessages.add(element);

        console.log("📩 新訊息:", username, message);

        console.log(`已送出 ${username} ${message} ${avatarUrl} 人數:${users.length} ${users}`)
        sendSocketMessage(username, message, avatarUrl, null, true, users.length, users, { msgId: element.getAttribute('data-msg-id') || element.getAttribute('data-message-id') || null, sentAt: element.querySelector('time[datetime]')?.getAttribute('datetime') || null });
        sendAudienceUpdate(users.length, users);
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
            // 每 30 秒固定回報觀眾數與累計成效：只在收到聊天時才送會讓備用樣本太稀疏，
            // 聊天一安靜就超過伺服器的 90 秒新鮮度門檻。
            const report = () => {
                const users = getTopFanUsers();
                sendAudienceUpdate(users.length, users);
                sendMetrics();
            };
            report();
            setInterval(report, 30000);

        }, 3000); // 等頁面穩定
    });

    // 分頁從凍結/背景回到前景時，重新檢查並觸發頭號觀眾更新
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('liveCenter 分頁回到前景，重新整理觀眾資料');
            const users = getTopFanUsers();
            sendAudienceUpdate(users.length, users);
        }
    });

})();