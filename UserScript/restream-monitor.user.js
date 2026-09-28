// ==UserScript==
// @name         Restream → TikTok Live Monitor 助手
// @namespace    ttw-restream-monitor
// @version      1.1.0
// @description  觀察 Restream 的 TikTok Live Monitor 連結，出現後開啟監控分頁，避免重複開啟。
// @match        https://app.restream.io/*
// @run-at       document-idle
// @noframes
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';
    const STABLE_MS = 3000;
    const ABSENT_MS = 60000;
    function monitorUrl(raw) {
        try {
            const url = new URL(raw);
            return url.protocol === 'https:' && url.hostname === 'livecenter.tiktok.com'
                && !url.port && !url.username && !url.password && url.pathname === '/live_monitor' ? url.href : null;
        } catch { return null; }
    }
    // 連結持續出現 3 秒才觸發；消失 60 秒才允許下一次自動開啟。
    // 這是 DOM 可用性，不是開播／斷播狀態判斷。
    function observe(state, url, now) {
        if (!url) {
            state.since = null;
            if (state.absentSince == null) state.absentSince = now;
            if (now - state.absentSince >= ABSENT_MS) state.opened = false;
            return false;
        }
        state.absentSince = null;
        if (state.url !== url || state.since == null) state.since = now;
        state.url = url;
        return !state.opened && now - state.since >= STABLE_MS;
    }
    if (typeof window === 'undefined' && typeof module !== 'undefined') {
        module.exports = { monitorUrl, observe }; return;
    }
    if (window.top !== window.self || document.getElementById('ttw-restream-monitor')) return;

    const preference = 'ttw-restream-monitor-enabled';
    let enabled = GM_getValue(preference, true) === true;
    let show = '', state = {}, currentUrl = null, tab = null, lastSaved = '', timer = null;
    let failure = '', lastStatus = '';
    const host = document.createElement('div');
    host.id = 'ttw-restream-monitor';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;max-width:calc(100vw - 32px)';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{font:13px/1.6 system-ui;color:#e5e7eb}section{background:#111827;border:1px solid #64748b;border-radius:10px;padding:12px;width:290px;max-width:calc(100vw - 58px);box-shadow:0 4px 20px #0006}strong{display:block}p{margin:6px 0}button{padding:6px 10px;background:#2563eb;border:0;border-radius:6px;color:white;cursor:pointer}button:disabled{opacity:.5;cursor:default}label{display:block;margin:8px 0}small{color:#cbd5e1}input{vertical-align:middle}';
    const panel = document.createElement('section');
    const title = document.createElement('strong'); title.textContent = 'TTW · TikTok 監控助手';
    const header = document.createElement('header');
    title.tabIndex = 0; title.setAttribute('role', 'button'); title.setAttribute('aria-label', '拖曳移動面板，或使用方向鍵');
    title.title = '拖曳移動；方向鍵每次移動 10px';
    const collapse = document.createElement('button'); collapse.type = 'button';
    const badge = document.createElement('span'); badge.className = 'badge';
    const body = document.createElement('div'); body.id = 'monitor-body';
    const actions = document.createElement('div'); actions.className = 'actions';
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '重設位置';
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    const label = document.createElement('label');
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = enabled;
    label.append(toggle, document.createTextNode(' 偵測到連結後自動開啟'));
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '手動開啟監控頁';
    const note = document.createElement('small');
    note.textContent = '需登入對應 TikTok 帳號並安裝 liveCenter.user.js 才能轉接資料。此助手不保證防止斷播。';
    header.append(title, collapse);
    actions.append(button, reset);
    body.append(status, label, actions, note);
    panel.append(header, badge, body);
    style.textContent += 'header{display:flex;align-items:center;gap:8px}header strong{flex:1;cursor:grab;touch-action:none;user-select:none;font-size:13px}header strong:active{cursor:grabbing}header button{background:#1b2940;padding:3px 8px}button:focus-visible,strong:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}.badge{display:block;color:#93c5fd;font-size:12px;margin-top:4px}.actions{display:flex;gap:8px;margin:8px 0}.actions button{font-size:12px}.actions button:last-child{background:#334155}[hidden]{display:none!important}section{box-sizing:border-box;width:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto}';
    root.append(style, panel); document.body.append(host);
    const uiKey = 'ttw-restream-monitor-ui';
    const savedUI = GM_getValue(uiKey, {});
    let collapsed = savedUI?.collapsed === true;
    let position = Number.isFinite(savedUI?.x) && Number.isFinite(savedUI?.y) ? { x: savedUI.x, y: savedUI.y } : null;
    let drag = null;
    function persistUI() { GM_setValue(uiKey, { ...position, collapsed }); }
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
    function save() {
        const serialized = JSON.stringify(state);
        if (serialized === lastSaved) return;
        try { sessionStorage.setItem('ttw-monitor:' + show, serialized); lastSaved = serialized; } catch { /* 此頁生命週期內仍去重 */ }
    }
    function openMonitor() {
        if (!currentUrl) return;
        try {
            // 本助手仍持有的分頁保持開啟時沿用，不自動關閉或重新整理它。
            if (!tab || tab.closed !== false) {
                tab = GM_openInTab(currentUrl, { active: false, insert: true, setParent: true });
                if (!tab) throw new Error('未取得分頁控制物件');
            }
            state.opened = true; failure = ''; save();
        } catch {
            // 失敗後不每秒重試，交由手動按鈕或下一次連結出現重試。
            state.opened = true; failure = '開啟失敗，請使用手動按鈕重試，或檢查腳本管理器權限。'; save();
        }
    }
    function visible(anchor) {
        const css = getComputedStyle(anchor);
        return anchor.getClientRects().length > 0 && css.display !== 'none' && css.visibility !== 'hidden'
            && !anchor.closest('[hidden],[aria-hidden="true"]');
    }
    function scan() {
        const path = location.pathname.match(/^\/shows\/([^/]+)\/?$/);
        if (host.hidden !== !path) host.hidden = !path;
        if (!path) { show = ''; return; }
        if (show !== path[1]) {
            show = path[1]; lastSaved = ''; failure = '';
            let saved;
            try { saved = JSON.parse(sessionStorage.getItem('ttw-monitor:' + show)); } catch { /* ignore */ }
            state = { opened: saved?.opened === true, url: null, since: null,
                absentSince: Number.isFinite(saved?.absentSince) ? saved.absentSince : null };
        }
        currentUrl = null;
        for (const anchor of document.querySelectorAll('a[href]')) {
            const url = monitorUrl(anchor.href);
            if (url && visible(anchor)) { currentUrl = url; break; }
        }
        const ready = observe(state, currentUrl, Date.now());
        if (enabled && ready) openMonitor();
        if (!currentUrl) failure = '';
        save(); button.disabled = !currentUrl;
        const message = failure || (!currentUrl ? '等待 Restream 顯示 TikTok Live Monitor 連結。'
            : !enabled ? '自動開啟已暫停；可使用手動按鈕。'
            : state.opened ? '本次已處理；關閉監控頁後可手動再開，不會自動反覆開頁。'
            : '已找到監控連結，等待穩定後開啟…');
        const summary = failure ? '開啟失敗' : !enabled ? '自動開啟已暫停' : !currentUrl ? '等待監控連結' : state.opened ? '本次連結已處理' : '已偵測，等待開啟';
        if (badge.textContent !== summary) badge.textContent = summary;
        if (message !== lastStatus) { status.textContent = message; lastStatus = message; }
    }
    toggle.onchange = () => { enabled = toggle.checked; GM_setValue(preference, enabled); scan(); };
    button.onclick = () => { scan(); openMonitor(); scan(); };
    new MutationObserver(() => {
        if (timer !== null) return;
        timer = setTimeout(() => { timer = null; scan(); }, 250);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'hidden', 'aria-hidden', 'style', 'class'] });
    // 同時處理 SPA 導航與沒有 DOM 變動的穩定等待；不碰 Restream 的開播控制。
    setInterval(scan, 1000);
    scan();
})();
