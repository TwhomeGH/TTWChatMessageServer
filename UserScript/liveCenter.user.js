// ==UserScript==
// @name         TikTok Live Chat → Socket Bridge
// @namespace    pip-chat-bridge
// @version      1.18
// @description  Listen TikTok live chat and forward to socket server
// @author       Nuclear0709
// @match        https://livecenter.tiktok.com/*
// @run-at       document-idle

// @grant GM_xmlhttpRequest
// @grant GM_getValue
// @grant GM_setValue


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

    // 主播識別：live_monitor 頁面沒有可靠的帳號來源，讓使用者明確填寫；
    // 空值時不猜測，人流會留在「未分類」而不是被錯歸到別人身上。
    const BROADCASTER_KEY = 'ttw-livecenter-broadcaster';
    let broadcasterName = loadBroadcaster();

    /** 正規化主播識別：先去除空白，再去掉開頭 @，最後轉小寫。 */
    function normalizeBroadcaster(value) {
        return String(value || '').trim().replace(/^@/, '').trim().toLowerCase();
    }

    /** 讀取主播帳號設定；只保留帳號本體，去除 @ 與空白。 */
    function loadBroadcaster() {
        try {
            return normalizeBroadcaster(GM_getValue(BROADCASTER_KEY, ''));
        } catch { return ''; }
    }

    /** 目前設定的主播識別；未設定時回傳 undefined。 */
    function broadcasterId() { return broadcasterName || undefined; }

    // 已處理過的訊息集合
    const processedMessages = new WeakSet();
// 頁面刷新時聊天室會先補上舊訊息；觀察器啟動後短暫忽略新增節點，避免重播。
const HYDRATION_MS = 4000;
let hydrateUntil = 0;

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
    const payload = { type: 'audience', platform: 'TikTok', transport: 'userscript', broadcasterId: broadcasterId(), audienceKind: 'top-fans', userNum, userList };
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
        const normalized = text.trim().replace(/,/g, '');
        // 缺欄位、破折號或尚未辨識的縮寫不能當作零值／猜測數量。
        if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
        const value = Number(normalized);
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
        data: JSON.stringify({ type: 'metrics', platform: 'TikTok', transport: 'userscript', broadcasterId: broadcasterId(), observedAt: Date.now(), ...metrics }),
        headers: { "Content-Type": "application/json" },
        onerror: () => { /* ignore */ }
    });
}

function sendSocketMessage(user, message, img, giftImg, isMain = true,userNum = 0, userList = [], metadata = {}) {

    const payload = {
        ...metadata, platform: 'TikTok', transport: 'userscript', broadcasterId: broadcasterId(), observedAt: Date.now(), audienceKind: 'top-fans',
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
        if (Date.now() < hydrateUntil) { processedMessages.add(element); return; }
        processedMessages.add(element);

        console.log("📩 新訊息:", username, message);

        console.log(`已送出 ${username} ${message} ${avatarUrl} 人數:${users.length} ${users}`)
        sendSocketMessage(username, message, avatarUrl, null, true, users.length, users, { msgId: element.getAttribute('data-msg-id') || element.getAttribute('data-message-id') || element.id || null, sentAt: element.querySelector('time[datetime]')?.getAttribute('datetime') || null });
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



    /**********************
     * 👀 MutationObserver
     **********************/
    let observer = null;
    function startObserver() {
        // 先標記已存在的訊息，再忽略觀察器啟動後的短暫補齊期，避免刷新重播。
        document.querySelectorAll('[data-e2e="chat-message"]')
            .forEach(element => processedMessages.add(element));
        hydrateUntil = Date.now() + HYDRATION_MS;

        observer = new MutationObserver((mutations) => {
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
     * 🎛️ 啟動條件與監控面板
     **********************/
    // 只有官方 live_monitor 頁面會自動啟動；使用者偏好優先於自動判定。
    const MONITOR_PATH = '/live_monitor';
    const PREF_KEY = 'ttw-livecenter-enabled'; // 布林＝手動指定；'auto'＝依頁面自動
    const UI_KEY = 'ttw-livecenter-ui';

    /** 讀取使用者偏好：true／false 為手動指定，其餘（含未設定）一律視為自動。 */
    function readPreference() {
        const saved = GM_getValue(PREF_KEY, 'auto');
        return typeof saved === 'boolean' ? saved : null;
    }
    let preference = readPreference();

    let intervals = [];
    let running = false;

    /** 目前是否位於官方監控頁。 */
    function onMonitorPage() {
        return location.pathname === MONITOR_PATH || location.pathname.startsWith(MONITOR_PATH + '/');
    }

    /** 實際是否應執行：手動偏好優先，未指定時只在監控頁啟動。 */
    function shouldRun() {
        return preference === null ? onMonitorPage() : preference;
    }

    const host = document.createElement('div');
    host.id = 'ttw-livecenter-panel';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;max-width:calc(100vw - 32px)';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{font:13px/1.6 system-ui;color:#e5e7eb}section{background:#111827;border:1px solid #64748b;border-radius:10px;padding:12px;width:290px;max-width:calc(100vw - 58px);box-shadow:0 4px 20px #0006}strong{display:block}p{margin:6px 0}button{padding:6px 10px;background:#2563eb;border:0;border-radius:6px;color:white;cursor:pointer}button:disabled{opacity:.5;cursor:default}label{display:block;margin:8px 0}small{color:#cbd5e1}input{vertical-align:middle}input[type=text]{width:100%;box-sizing:border-box;margin-top:4px;padding:4px 6px;border:1px solid #475569;border-radius:6px;background:#0f172a;color:#e5e7eb}';
    const panel = document.createElement('section');
    const title = document.createElement('strong');
    title.textContent = 'TTW · TikTok 直播中控';
    const header = document.createElement('header');
    title.tabIndex = 0; title.setAttribute('role', 'button'); title.setAttribute('aria-label', '拖曳移動面板，或使用方向鍵');
    title.title = '拖曳移動；方向鍵每次移動 10px';
    const collapse = document.createElement('button'); collapse.type = 'button';
    const badge = document.createElement('span'); badge.className = 'badge';
    const body = document.createElement('div'); body.id = 'livecenter-body';
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    const label = document.createElement('label');
    const toggle = document.createElement('input'); toggle.type = 'checkbox';
    label.append(toggle, document.createTextNode(' 啟用聊天轉接'));
    const accountLabel = document.createElement('label');
    const accountInput = document.createElement('input');
    accountInput.type = 'text';
    accountInput.placeholder = '你的帳號（@ 可省略）';
    accountInput.value = broadcasterName;
    accountInput.setAttribute('aria-label', '主播帳號（用於人流歸屬）');
    accountInput.oninput = () => {
        broadcasterName = normalizeBroadcaster(accountInput.value);
        GM_setValue(BROADCASTER_KEY, broadcasterName);
    };
    accountLabel.append(document.createTextNode('主播帳號（選填） '), accountInput);
    const actions = document.createElement('div'); actions.className = 'actions';
    const autoBtn = document.createElement('button'); autoBtn.type = 'button'; autoBtn.textContent = '恢復自動';
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '重設位置';
    const note = document.createElement('small');
    note.textContent = '僅官方 live_monitor 頁面會自動啟動；其他頁面（如回放）預設不觀察，可用上方開關強制啟用。';
    header.append(title, collapse);
    actions.append(autoBtn, reset);
    body.append(status, label, accountLabel, actions, note);
    panel.append(header, badge, body);
    style.textContent += 'header{display:flex;align-items:center;gap:8px}header strong{flex:1;cursor:grab;touch-action:none;user-select:none;font-size:13px}header strong:active{cursor:grabbing}header button{background:#1b2940;padding:3px 8px}button:focus-visible,strong:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}.badge{display:block;color:#93c5fd;font-size:12px;margin-top:4px}.actions{display:flex;gap:8px;margin:8px 0}.actions button{font-size:12px}.actions button:last-child{background:#334155}[hidden]{display:none!important}section{box-sizing:border-box;width:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto}';
    root.append(style, panel);
    (document.body || document.documentElement).append(host);

    const savedUI = GM_getValue(UI_KEY, {});
    let collapsed = savedUI?.collapsed === true;
    let position = Number.isFinite(savedUI?.x) && Number.isFinite(savedUI?.y) ? { x: savedUI.x, y: savedUI.y } : null;
    let drag = null;
    function persistUI() { GM_setValue(UI_KEY, { ...position, collapsed }); }
    function place(x, y) {
        const rect = host.getBoundingClientRect();
        position = { x: Math.max(8, Math.min(Math.max(8, innerWidth - rect.width - 8), x)),
            y: Math.max(8, Math.min(Math.max(8, innerHeight - rect.height - 8), y)) };
        host.style.right = 'auto'; host.style.bottom = 'auto';
        const left = position.x + 'px', top = position.y + 'px';
        if (host.style.left !== left) host.style.left = left;
        if (host.style.top !== top) host.style.top = top;
    }
    function clampPanel() {
        if (host.hidden) return;
        const rect = host.getBoundingClientRect();
        place(position?.x ?? innerWidth - rect.width - 16, position?.y ?? innerHeight - rect.height - 16);
    }
    function setCollapsed(value) {
        collapsed = value; body.hidden = value;
        collapse.textContent = value ? '展開' : '收合';
        collapse.setAttribute('aria-expanded', String(!value));
        collapse.setAttribute('aria-controls', body.id);
        clampPanel();
    }
    collapse.onclick = () => { setCollapsed(!collapsed); persistUI(); };
    reset.onclick = () => { position = null; clampPanel(); persistUI(); };
    title.onpointerdown = event => {
        if (event.button !== 0) return;
        const rect = host.getBoundingClientRect();
        drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
        title.setPointerCapture(event.pointerId); event.preventDefault();
    };
    title.onpointermove = event => {
        if (drag?.id === event.pointerId) place(event.clientX - drag.x, event.clientY - drag.y);
    };
    const endDrag = event => {
        if (drag?.id !== event.pointerId) return;
        drag = null;
        if (title.hasPointerCapture(event.pointerId)) title.releasePointerCapture(event.pointerId);
        persistUI();
    };
    title.onpointerup = endDrag; title.onpointercancel = endDrag;
    title.onkeydown = event => {
        const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
        if (!delta) return;
        event.preventDefault(); const rect = host.getBoundingClientRect();
        place(rect.left + delta[0], rect.top + delta[1]); persistUI();
    };
    window.addEventListener('resize', () => { clampPanel(); persistUI(); });
    new ResizeObserver(clampPanel).observe(panel);
    setCollapsed(collapsed);

    function startMonitoring() {
        if (running) return;
        running = true;
        startObserver();
        intervals.push(setInterval(() => {
            const users = getTopFanUsers();
            console.log("頭號觀眾人數:", users.length);
            console.log("名字清單:", users);
        }, 5000)); // 每5秒更新一次頭號觀眾列表
        // 每 30 秒固定回報觀眾數與累計成效：只在收到聊天時才送會讓備用樣本太稀疏，
        // 聊天一安靜就超過伺服器的 90 秒新鮮度門檻。
        const report = () => {
            const users = getTopFanUsers();
            sendAudienceUpdate(users.length, users);
            sendMetrics();
        };
        report();
        intervals.push(setInterval(report, 30000));
        console.log("liveCenter 已啟動監控");
    }

    function stopMonitoring() {
        if (!running) return;
        running = false;
        observer?.disconnect(); observer = null;
        intervals.forEach(clearInterval); intervals = [];
        console.log("liveCenter 已停止監控");
    }

    /** 只更新面板文字與開關，不改變啟停狀態。 */
    function renderPanel() {
        const active = shouldRun();
        toggle.checked = active;
        autoBtn.disabled = preference === null;
        badge.textContent = active ? '監控中' : '未監控';
        if (active) {
            status.textContent = `正在觀察聊天室並回報（${preference === null ? '監控頁自動啟動' : '手動指定'}）。`;
        } else if (preference === false) {
            status.textContent = '已手動關閉，不會觀察或回報。';
        } else {
            status.textContent = '非監控頁，預設不觀察；可勾選上方開關強制啟用。';
        }
    }

    /** 依目前偏好／頁面套用啟停，並同步面板。 */
    function apply() {
        if (shouldRun()) startMonitoring(); else stopMonitoring();
        renderPanel();
    }

    toggle.onchange = () => { preference = toggle.checked; GM_setValue(PREF_KEY, preference); apply(); };
    autoBtn.onclick = () => { preference = null; GM_setValue(PREF_KEY, 'auto'); apply(); };

    // SPA 換頁時重新判定；僅在自動模式下需要檢查網址。
    let lastHref = location.href;
    setInterval(() => {
        if (preference !== null || location.href === lastHref) return;
        lastHref = location.href;
        apply();
    }, 1000);

    /**********************
     * 🚀 啟動
     **********************/
    renderPanel(); // 先顯示面板狀態，不必等頁面穩定
    const boot = () => apply();
    // 等頁面穩定後才開始觀察；若腳本執行時 load 已結束，直接延後啟動，避免永遠不觸發。
    if (document.readyState === 'complete') setTimeout(boot, 3000);
    else window.addEventListener('load', () => setTimeout(boot, 3000), { once: true });

    // 分頁從凍結/背景回到前景時，重新檢查並觸發頭號觀眾更新
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && running) {
            console.log('liveCenter 分頁回到前景，重新整理觀眾資料');
            const users = getTopFanUsers();
            sendAudienceUpdate(users.length, users);
        }
    });

})();
