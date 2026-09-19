// ==UserScript==
// @name         TikTok Live Chat & Viewer Scraper
// @namespace    http://tampermonkey.net/
// @version      2.8
// @description  抓取 TikTok 直播聊天室訊息與觀眾列表 JSON（聊天改為抓頭像；新增目標直播間鎖定，避免亂逛誤送）
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

    // ─────────────────────────────────────────────────────────────
    // 目標直播間鎖定：只有「目前頁面 /@帳號/live」等於設定值時才發送，
    // 避免使用者隨便逛別台時把訊息誤送進 /chat。設定存在 localStorage。
    // ─────────────────────────────────────────────────────────────
    const TARGET_KEY = 'ttw_target_room';
    const target = loadTarget();

    /** 讀取設定；沒設定過預設「啟用但沒有目標」（等於不發送，安全預設）。 */
    function loadTarget() {
        try {
            const saved = JSON.parse(localStorage.getItem(TARGET_KEY) || '{}');
            return { enabled: saved.enabled !== false, handle: String(saved.handle || '').replace(/^@/, '').trim() };
        } catch {
            return { enabled: true, handle: '' };
        }
    }

    function saveTarget() {
        try { localStorage.setItem(TARGET_KEY, JSON.stringify(target)); } catch { /* ignore */ }
    }

    /** 目前頁面的直播間帳號；不是直播間頁面回傳空字串。 */
    function currentHandle() {
        const match = location.pathname.match(/^\/@([^/]+)\/live/i);
        return match ? match[1].toLowerCase() : '';
    }

    /** 是否允許發送（啟用中、已填目標、且目前頁面就是該直播間）。 */
    function canSend() {
        const wanted = target.handle.toLowerCase();
        if (!target.enabled || !wanted) return false;
        return currentHandle() === wanted;
    }

    // 被擋下時只印一次，避免每則訊息都洗版。
    let lastBlockedLog = '';
    function blockedReason() {
        if (!target.enabled) return '已停用';
        if (!target.handle) return '尚未設定目標直播間';
        return '目前頁面不是 @' + target.handle;
    }
    function logBlocked() {
        const reason = blockedReason();
        if (reason === lastBlockedLog) return;
        lastBlockedLog = reason;
        console.log('[TikTok轉接] 不發送：' + reason);
    }

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
        if (!canSend()) { logBlocked(); return; }
        const payload = { type: 'audience', platform: 'TikTok', transport: 'userscript', audienceKind: 'total', userNum: View, userList: ViewUserList };
        const sendURL = `http://${HTTP_HOST}:${HTTP_PORT}/chat`;
        GM_xmlhttpRequest({
            method: "POST", url: sendURL, data: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            onerror: () => { /* ignore */ }
        });
    }

    function sendSocketMessage(user, message, img, giftImg, isMain = true,userNum,userList=null, metadata={}) {
        if (!canSend()) { logBlocked(); return; }
        flashSent(sentKind(isMain, giftImg), user, message);
        const payload = { ...metadata, platform: 'TikTok', transport: 'userscript', observedAt: Date.now(), type: 'StreamMessage', user, message, img, giftImg, isMain ,userNum,userList};

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
            sendSocketMessage(userName, text, avatar, null, true, View, null, { msgId: node.getAttribute('data-msg-id') || node.getAttribute('data-message-id') || null, sentAt: node.querySelector('time[datetime]')?.getAttribute('datetime') || null });
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


    // ─────────────────────────────────────────────────────────────
    // 小面板：填目標直播間 + 啟用/停用（改動即自動存 localStorage）
    // ─────────────────────────────────────────────────────────────
    const PANEL_CSS = `
#ttw-panel { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; font: 12px/1.5 system-ui, "Noto Sans TC", sans-serif; color: #e7edf7; }
#ttw-panel .ttw-pill { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #1b2940; border: 1px solid #344663; border-radius: 999px; cursor: pointer; color: inherit; font: inherit; }
#ttw-panel .ttw-pill:hover { background: #24344f; }
#ttw-panel .ttw-body { width: 232px; margin-top: 6px; padding: 10px 12px; background: #131c2b; border: 1px solid #344663; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
#ttw-panel .ttw-title { font-weight: 700; margin-bottom: 6px; }
#ttw-panel .ttw-field { display: flex; align-items: center; gap: 4px; margin: 6px 0; }
#ttw-panel .ttw-field span { color: #9ca3af; }
#ttw-panel input[type=text] { flex: 1; min-width: 0; padding: 4px 6px; background: #0d1524; border: 1px solid #344663; border-radius: 6px; color: #e7edf7; font: inherit; }
#ttw-panel .ttw-switch { display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; user-select: none; }
#ttw-panel .ttw-switch input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
#ttw-panel .ttw-track { position: relative; flex: none; width: 34px; height: 18px; border-radius: 999px; background: #3b4a63; transition: background .15s ease; }
#ttw-panel .ttw-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #cbd5e1; transition: transform .15s ease, background .15s ease; }
#ttw-panel .ttw-switch input:checked + .ttw-track { background: #2563eb; }
#ttw-panel .ttw-switch input:checked + .ttw-track::after { transform: translateX(16px); background: #fff; }
#ttw-panel .ttw-switch input:focus-visible + .ttw-track { outline: 2px solid #60a5fa; outline-offset: 2px; }
#ttw-panel .ttw-switch-text { color: #cbd5e1; }
#ttw-panel .ttw-state { margin-top: 6px; padding: 5px 8px; border-radius: 6px; background: #0d1524; overflow-wrap: anywhere; }
#ttw-panel .ttw-state.on { color: #86efac; }
#ttw-panel .ttw-state.warn { color: #fbbf24; }
#ttw-panel .ttw-state.off { color: #9ca3af; }
#ttw-panel .ttw-hint { margin-top: 6px; color: #6b7280; }
#ttw-panel .ttw-last { margin-top: 6px; color: #94a3b8; overflow-wrap: anywhere; }
#ttw-panel .ttw-flash { max-width: 232px; max-height: 0; margin-bottom: 0; padding: 0 10px; overflow: hidden; background: #1b2940; border: 1px solid #344663; border-radius: 10px; color: #cbd5e1; opacity: 0; overflow-wrap: anywhere; transition: opacity .18s ease, max-height .18s ease, padding .18s ease, margin-bottom .18s ease; }
#ttw-panel .ttw-flash.show { max-height: 72px; margin-bottom: 6px; padding: 6px 10px; opacity: 1; }
`;

    // 最近轉送提示：讓使用者一眼看到剛剛送了什麼（聊天／加入／送禮）。
    let sentCount = 0;
    let flashTimer = null;

    /** 依參數判斷種類：有禮物圖＝送禮，isMain=false 是進房訊息，其餘是聊天。 */
    function sentKind(isMain, giftImg) {
        return giftImg ? '送禮' : (isMain ? '聊天' : '加入');
    }

    function flashSent(kind, user, message) {
        sentCount += 1;
        const text = String(user || '') + (message ? '：' + message : '');
        const short = text.length > 36 ? text.slice(0, 36) + '…' : text;
        const flash = document.getElementById('ttw-flash');
        if (flash) {
            flash.textContent = '📤 ' + kind + ' ' + short;
            flash.classList.add('show');
            clearTimeout(flashTimer);
            flashTimer = setTimeout(() => flash.classList.remove('show'), 2500);
        }
        const last = document.getElementById('ttw-last');
        if (last) last.textContent = '最近轉送：' + kind + ' ' + short + '（本頁已送 ' + sentCount + ' 則）';
    }

    function buildPanel() {
        if (document.getElementById('ttw-panel')) return;
        const style = document.createElement('style');
        style.textContent = PANEL_CSS;
        document.head.append(style);

        const box = document.createElement('div');
        box.id = 'ttw-panel';
        box.innerHTML = `
            <div class="ttw-flash" id="ttw-flash"></div>
            <button class="ttw-pill" id="ttw-pill" title="TikTok 轉接設定">🎯 <span id="ttw-pill-text">轉接設定</span></button>
            <div class="ttw-body" id="ttw-body" hidden>
              <div class="ttw-title">目標直播間</div>
              <div class="ttw-field"><span>@</span><input type="text" id="ttw-handle" placeholder="a0936931" autocomplete="off"></div>
              <label class="ttw-switch"><input type="checkbox" id="ttw-enabled"><span class="ttw-track"></span><span class="ttw-switch-text">啟用轉接</span></label>
              <div class="ttw-state" id="ttw-state"></div>
              <div class="ttw-last" id="ttw-last"></div>
              <div class="ttw-hint">只有這個直播間才會發送，避免亂逛別台誤送。設定自動存在此瀏覽器。</div>
            </div>`;
        document.body.append(box);

        const input = box.querySelector('#ttw-handle');
        const enabled = box.querySelector('#ttw-enabled');
        input.value = target.handle;
        enabled.checked = target.enabled;
        box.querySelector('#ttw-pill').onclick = () => {
            const body = box.querySelector('#ttw-body');
            body.hidden = !body.hidden;
        };
        input.oninput = () => { target.handle = input.value.replace(/^@/, '').trim(); saveTarget(); renderPanelState(); };
        enabled.onchange = () => { target.enabled = enabled.checked; saveTarget(); renderPanelState(); };
        renderPanelState();
    }

    /** 更新面板狀態（目前頁面 vs 目標），收合的按鈕也會顯示摘要。 */
    function renderPanelState() {
        const state = document.getElementById('ttw-state');
        if (!state) return;
        const here = currentHandle();
        const wanted = target.handle.toLowerCase();
        let text, cls;
        if (!target.enabled) { text = '⏸ 已停用，不會發送'; cls = 'off'; }
        else if (!wanted) { text = '⚠️ 還沒填目標，不會發送'; cls = 'warn'; }
        else if (here === wanted) { text = '✅ 發送中：@' + here; cls = 'on'; }
        else if (!here) { text = '⏸ 目前不是直播間頁面（目標 @' + target.handle + '）'; cls = 'off'; }
        else { text = '🚫 目前是 @' + here + '，目標是 @' + target.handle + '，不發送'; cls = 'off'; }
        state.textContent = text;
        state.className = 'ttw-state ' + cls;
        const pill = document.getElementById('ttw-pill-text');
        if (pill) pill.textContent = cls === 'on' ? '轉接中 @' + here : (cls === 'warn' ? '轉接未設定' : '轉接已暫停');
    }

    if (document.body) buildPanel();
    else document.addEventListener('DOMContentLoaded', buildPanel);
    // TikTok 是 SPA，換頁不會重載；定期重畫狀態，發送判斷則每次都讀當前網址。
    setInterval(renderPanelState, 5000);

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
