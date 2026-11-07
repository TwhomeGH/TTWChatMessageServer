// ==UserScript==
// @name         TikTok Video Info Overlay
// @namespace    pip-chat-test
// @version      2.5
// @description  顯示 video 原始解析度與頁面顯示尺寸；提供可拖動的劇院模式切換
// @match        https://www.tiktok.com/*
// @grant        none

// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/videoTK.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/videoTK.user.js

// @run-at document-start

// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_ID = 'ttw-videotk-toggle';
    const POSITION_KEY = 'ttw-videotk-button-pos';
    const MAINTENANCE_MS = 300;
    const theater = { enabled: false, styles: new Map(), timer: null };
    let maintenanceTimer = null;
    let infoDiv = null;
    let lastVideo = null;
    let lastContainer = null;
    let overlayContainer = null;
    let lastText = '';
    let lastTop = null;
    let lastLeft = null;
    let overlayFrame = 0;
    let buttonDrag = null;
    let suppressClickUntil = 0;
    let resizeObserver = null;

    const isLivePath = () => /^\/@[^/]+\/live(?:\/|$)/i.test(location.pathname);

    function removeMeta() {
        document.querySelectorAll('meta[name="apple-itunes-app"]').forEach(meta => meta.remove());
    }

    function removeOpenAppBanner() {
        document.querySelector('[data-e2e="open-app-banner"]')?.remove();
    }

    /** 保存元素原始 inline style，關閉劇院模式時精確還原。 */
    function setTheaterStyle(element, property, value) {
        if (!element) return;
        let original = theater.styles.get(element);
        if (!original) {
            original = {};
            theater.styles.set(element, original);
        }
        if (!(property in original)) original[property] = element.style[property];
        if (element.style[property] !== value) element.style[property] = value;
    }

    function pruneDetachedStyles() {
        for (const element of theater.styles.keys()) {
            if (!element.isConnected) theater.styles.delete(element);
        }
    }

    function applyTheater() {
        if (!theater.enabled) return;
        pruneDetachedStyles();
        document.querySelectorAll('.tiktok-1w5o2is').forEach(element => {
            setTheaterStyle(element, 'display', 'none');
        });
        const chat = document.querySelector('[data-e2e="live-chat-container"]');
        if (chat) setTheaterStyle(chat.parentElement || chat, 'display', 'none');
        const liveContent = document.querySelector('[data-e2e="live-content-container"]');
        if (liveContent) setTheaterStyle(liveContent, 'width', '100%');
        const header = document.querySelector('[data-e2e="live-header-container"]');
        if (header) setTheaterStyle(header, 'display', 'none');
        const gift = document.querySelector('[data-e2e="gift-container"]');
        if (gift) setTheaterStyle(gift, 'display', 'none');
    }

    function restoreTheater() {
        for (const [element, properties] of theater.styles) {
            if (!element.isConnected) continue;
            for (const [property, value] of Object.entries(properties)) {
                element.style[property] = value;
            }
        }
        theater.styles.clear();
    }

    function updateButton() {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;
        button.setAttribute('aria-pressed', String(theater.enabled));
        button.title = theater.enabled ? '劇院模式：開（可拖曳）' : '劇院模式：關（可拖曳）';
        button.setAttribute('aria-label', theater.enabled ? '關閉劇院模式' : '開啟劇院模式');
        button.style.background = theater.enabled ? 'rgba(22,163,74,.9)' : 'rgba(0,0,0,.62)';
    }

    function setTheater(enabled) {
        if (theater.enabled === enabled) return;
        theater.enabled = enabled;
        if (enabled && !isLivePath()) {
            theater.enabled = false;
            updateButton();
            return;
        }
        if (enabled) {
            applyTheater();
            theater.timer = setInterval(applyTheater, 1000);
        } else {
            if (theater.timer) clearInterval(theater.timer);
            theater.timer = null;
            restoreTheater();
        }
        updateButton();
    }

    function clampButton(button) {
        if (!button.style.left || !button.style.top) return;
        const rect = button.getBoundingClientRect();
        const left = Math.min(Math.max(8, rect.left), Math.max(8, innerWidth - rect.width - 8));
        const top = Math.min(Math.max(8, rect.top), Math.max(8, innerHeight - rect.height - 8));
        button.style.left = left + 'px';
        button.style.top = top + 'px';
    }

    function loadButtonPosition(button) {
        try {
            const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
            if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
                button.style.left = saved.left + 'px';
                button.style.top = saved.top + 'px';
                button.style.right = 'auto';
                button.style.bottom = 'auto';
                clampButton(button);
            }
        } catch { /* ignore */ }
    }

    function saveButtonPosition(button) {
        try {
            const rect = button.getBoundingClientRect();
            localStorage.setItem(POSITION_KEY, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
        } catch { /* ignore */ }
    }

    function createButton() {
        if (document.getElementById(BUTTON_ID) || !document.body) return;
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = '⛶';
        button.style.cssText = [
            'position:fixed', 'right:16px', 'bottom:16px', 'width:36px', 'height:36px',
            'border:1px solid rgba(255,255,255,.28)', 'border-radius:10px',
            'background:rgba(0,0,0,.62)', 'color:#fff', 'font:18px/1 system-ui',
            'display:flex', 'align-items:center', 'justify-content:center',
            'cursor:pointer', 'z-index:99999', 'user-select:none', 'touch-action:none',
            'backdrop-filter:blur(4px)', 'padding:0'
        ].join(';');
        button.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            const rect = button.getBoundingClientRect();
            buttonDrag = {
                pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
                left: rect.left, top: rect.top, moved: false
            };
            button.setPointerCapture(event.pointerId);
        });
        button.addEventListener('pointermove', event => {
            if (!buttonDrag || buttonDrag.pointerId !== event.pointerId) return;
            const dx = event.clientX - buttonDrag.startX;
            const dy = event.clientY - buttonDrag.startY;
            if (Math.hypot(dx, dy) > 4) buttonDrag.moved = true;
            if (!buttonDrag.moved) return;
            button.style.left = (buttonDrag.left + dx) + 'px';
            button.style.top = (buttonDrag.top + dy) + 'px';
            button.style.right = 'auto';
            button.style.bottom = 'auto';
            clampButton(button);
        });
        button.addEventListener('pointerup', event => {
            if (!buttonDrag || buttonDrag.pointerId !== event.pointerId) return;
            const moved = buttonDrag.moved;
            buttonDrag = null;
            try { button.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
            if (moved) {
                suppressClickUntil = Date.now() + 400;
                saveButtonPosition(button);
            }
        });
        button.addEventListener('pointercancel', () => { buttonDrag = null; });
        button.addEventListener('click', event => {
            if (Date.now() < suppressClickUntil) {
                suppressClickUntil = 0;
                event.preventDefault();
                return;
            }
            setTheater(!theater.enabled);
        });
        document.body.append(button);
        loadButtonPosition(button);
        updateButton();
    }

    function createInfoDiv(container) {
        const div = document.createElement('div');
        div.style.cssText = [
            'position:absolute', 'top:0', 'left:0', 'background:rgba(0,0,0,.6)',
            'color:#fff', 'font:12px/1.4 system-ui', 'padding:4px 6px',
            'border-radius:4px', 'z-index:9999', 'pointer-events:none',
            'width:max-content', 'transform:translateZ(0)'
        ].join(';');
        container.append(div);
        return div;
    }

    function scheduleOverlayUpdate() {
        if (overlayFrame) return;
        overlayFrame = requestAnimationFrame(() => {
            overlayFrame = 0;
            updateOverlay();
        });
    }

    function updateOverlay() {
        const video = lastVideo;
        const container = lastContainer;
        if (!video || !container || !container.isConnected || !video.isConnected) return;
        if (!infoDiv || !infoDiv.isConnected) infoDiv = createInfoDiv(container);
        const rect = video.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const text = `Render: ${video.clientWidth}×${video.clientHeight} | Original: ${video.videoWidth}×${video.videoHeight}`;
        if (text !== lastText) {
            lastText = text;
            infoDiv.textContent = text;
        }
        const top = Math.round(rect.top - containerRect.top + 42);
        const left = Math.round(rect.right - containerRect.left - infoDiv.offsetWidth - 8);
        if (top !== lastTop) { lastTop = top; infoDiv.style.top = top + 'px'; }
        if (left !== lastLeft) { lastLeft = left; infoDiv.style.left = left + 'px'; }
    }

    function detachVideo() {
        if (resizeObserver) resizeObserver.disconnect();
        if (lastVideo) {
            lastVideo.removeEventListener('loadedmetadata', scheduleOverlayUpdate);
            lastVideo.removeEventListener('resize', scheduleOverlayUpdate);
        }
        if (overlayContainer) {
            overlayContainer.removeEventListener('scroll', scheduleOverlayUpdate);
        }
        if (infoDiv) infoDiv.remove();
        overlayContainer = null;
        infoDiv = null;
        lastVideo = null;
        lastContainer = null;
        lastText = '';
        lastTop = null;
        lastLeft = null;
    }

    function findVideo() {
        const container = document.querySelector('[data-e2e="live-room-content"]');
        const video = container?.querySelector('video');
        if (!video || !container) {
            if (lastVideo || infoDiv) detachVideo();
            return;
        }
        if (video !== lastVideo || container !== lastContainer) {
            detachVideo();
            lastVideo = video;
            lastContainer = container;
            overlayContainer = container;
            if (typeof ResizeObserver === 'function') {
                resizeObserver = new ResizeObserver(scheduleOverlayUpdate);
                resizeObserver.observe(video);
                resizeObserver.observe(container);
            }
            video.addEventListener('loadedmetadata', scheduleOverlayUpdate);
            video.addEventListener('resize', scheduleOverlayUpdate);
            container.addEventListener('scroll', scheduleOverlayUpdate, { passive: true });
        }
        scheduleOverlayUpdate();
    }

    function runMaintenance() {
        maintenanceTimer = null;
        removeMeta();
        removeOpenAppBanner();
        createButton();
        if (theater.enabled && !isLivePath()) setTheater(false);
        findVideo();
    }

    function scheduleMaintenance(delay = MAINTENANCE_MS) {
        if (maintenanceTimer) return;
        maintenanceTimer = setTimeout(runMaintenance, delay);
    }

    new MutationObserver(() => scheduleMaintenance()).observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    function init() {
        removeMeta();
        removeOpenAppBanner();
        createButton();
        findVideo();
        // 低頻補齊：SPA 換頁或元素被替換時才重新檢查，不使用永久 rAF。
        setInterval(() => {
            if (theater.enabled && !isLivePath()) {
                setTheater(false);
                return;
            }
            findVideo();
        }, 2000);
        window.addEventListener('resize', () => {
            const button = document.getElementById(BUTTON_ID);
            if (button) clampButton(button);
            scheduleOverlayUpdate();
        }, { passive: true });
    }

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });

})();
