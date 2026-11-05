// ==UserScript==
// @name         Restream → TikTok Live Monitor 助手
// @namespace    ttw-restream-monitor
// @version      1.3.0
// @description  觀察 Restream 的 TikTok Live Monitor 連結，出現後開啟監控分頁；可自動暫停預覽避免多餘播放。
// @match        https://app.restream.io/*
// @run-at       document-idle
// @noframes
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

(function () {
    'use strict';
    const ENDPOINT_KEY = 'ttw-main-endpoint';
    const DEFAULT_ENDPOINT = 'http://127.0.0.1:3332';

    function normalizeEndpoint(value) {
        let raw = String(value || '').trim();
        if (!raw || raw.length > 500) return null;
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'http://' + raw;
        let url;
        try { url = new URL(raw); } catch { return null; }
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
        if (url.username || url.password || url.search || url.hash) return null;
        const path = url.pathname.replace(/\/+$/, '');
        return url.origin + (path && path !== '/' ? path : '');
    }

    function ttwEndpoint() {
        try {
            return normalizeEndpoint(GM_getValue(ENDPOINT_KEY, DEFAULT_ENDPOINT)) || DEFAULT_ENDPOINT;
        } catch { return DEFAULT_ENDPOINT; }
    }

    function saveEndpoint(value) {
        const normalized = normalizeEndpoint(value);
        if (!normalized) return null;
        try { GM_setValue(ENDPOINT_KEY, normalized); } catch { /* ignore */ }
        return normalized;
    }

    function changeEndpoint() {
        const value = window.prompt('TTW 主服務位址', ttwEndpoint());
        if (value === null) return;
        const saved = saveEndpoint(value);
        if (!saved) { window.alert('格式無效：請輸入 http://host:port 或 host:port'); return; }
        window.alert('已儲存：' + saved);
    }
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('設定 TTW 主服務位址', changeEndpoint);

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
    /** 由預覽按鈕文字判斷目前動作；只接受 Restream 的 Play/Pause Preview。 */
    function previewLabel(text) {
        const value = String(text || '').trim();
        if (/^Pause Preview$/i.test(value)) return 'pause';
        if (/^Play Preview$/i.test(value)) return 'play';
        return null;
    }
    /** 只有開啟、使用者未手動操作、尚未嘗試且預覽正在播放時才自動暫停。 */
    function shouldAutoPause({ enabled, userInteracted, attempted, playing }) {
        return enabled === true && userInteracted !== true && attempted !== true && playing === true;
    }
    function normalizeHealth(value) {
        const text = String(value || '').trim().slice(0, 40);
        return text || null;
    }
    function parseResolution(value) {
        const text = String(value || '').trim();
        return /^\d{2,5}x\d{2,5}$/i.test(text) ? text.toLowerCase() : null;
    }
    function parseBitrateKbps(value) {
        const match = String(value || '').trim().match(/^([\d.]+)\s*(Kbps|Mbps|bps)$/i);
        if (!match) return null;
        const number = Number(match[1]);
        if (!Number.isFinite(number) || number < 0) return null;
        const unit = match[2].toLowerCase();
        return unit === 'mbps' ? number * 1000 : unit === 'bps' ? number / 1000 : number;
    }
    function parseFps(value) {
        const match = String(value || '').trim().match(/^([\d.]+)\s*fps$/i);
        const number = Number(match?.[1]);
        return Number.isFinite(number) && number >= 0 ? number : null;
    }
    function parseKeyframeSec(value) {
        const match = String(value || '').trim().match(/^([\d.]+)\s*(?:sec|s)$/i);
        const number = Number(match?.[1]);
        return Number.isFinite(number) && number >= 0 ? number : null;
    }
    if (window.top !== window.self || document.getElementById('ttw-restream-monitor')) return;

    const preference = 'ttw-restream-monitor-enabled';
    const pausePreference = 'ttw-restream-monitor-pause-preview';
    let enabled = GM_getValue(preference, true) === true;
    let autoPause = GM_getValue(pausePreference, true) === true;
    let show = '', state = {}, currentUrl = null, tab = null, lastSaved = '', timer = null;
    let failure = '', lastStatus = '', previewStatusText = '', healthStatusText = '';
    let onShowPage = false, autoPauseAttempted = false, userInteracted = false;
    let lastHealthAt = 0, lastHealthKey = '', healthNotice = '';
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
    const pauseLabel = document.createElement('label');
    const pauseToggle = document.createElement('input'); pauseToggle.type = 'checkbox'; pauseToggle.checked = autoPause;
    pauseLabel.append(pauseToggle, document.createTextNode(' 自動暫停預覽（避免多餘播放）'));
    const endpointLabel = document.createElement('label');
    const endpointInput = document.createElement('input');
    endpointInput.type = 'text';
    endpointInput.value = ttwEndpoint();
    endpointInput.placeholder = DEFAULT_ENDPOINT;
    endpointInput.setAttribute('aria-label', 'TTW 主服務位址');
    endpointInput.onchange = () => {
        const saved = saveEndpoint(endpointInput.value);
        if (!saved) {
            endpointInput.value = ttwEndpoint();
            endpointStatus.textContent = '主服務位址格式無效';
            return;
        }
        endpointInput.value = saved;
        endpointStatus.textContent = '已儲存主服務位址';
    };
    endpointLabel.append(document.createTextNode('主服務位址 '), endpointInput);
    const endpointStatus = document.createElement('small');
    const previewStatus = document.createElement('small'); previewStatus.className = 'preview'; previewStatus.setAttribute('role', 'status');
    const healthStatus = document.createElement('small'); healthStatus.className = 'health'; healthStatus.setAttribute('role', 'status');
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '手動開啟監控頁';
    const testEndpointBtn = document.createElement('button'); testEndpointBtn.type = 'button'; testEndpointBtn.textContent = '測試主服務';
    const healthPageBtn = document.createElement('button'); healthPageBtn.type = 'button'; healthPageBtn.textContent = '指標頁';
    const note = document.createElement('small');
    note.textContent = '需登入對應 TikTok 帳號並安裝 liveCenter.user.js 才能轉接資料。此助手不保證防止斷播；自動暫停只作用於 Restream 預覽，不會停止直播。主服務位址也可從腳本管理器選單修改。';
    header.append(title, collapse);
    actions.append(testEndpointBtn, healthPageBtn, button, reset);
    body.append(status, label, pauseLabel, endpointLabel, actions, endpointStatus, previewStatus, healthStatus, note);
    panel.append(header, badge, body);
    style.textContent += 'header{display:flex;align-items:center;gap:8px}header strong{flex:1;cursor:grab;touch-action:none;user-select:none;font-size:13px}header strong:active{cursor:grabbing}header button{background:#1b2940;padding:3px 8px}button:focus-visible,strong:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}.badge{display:block;color:#93c5fd;font-size:12px;margin-top:4px}.actions{display:flex;gap:8px;margin:8px 0}.actions button{font-size:12px}.actions button:last-child{background:#334155}.preview,.health{display:block;margin-top:6px;color:#93c5fd}input[type=text]{width:100%;box-sizing:border-box;margin-top:4px;padding:4px 6px;border:1px solid #475569;border-radius:6px;background:#0f172a;color:#e5e7eb}[hidden]{display:none!important}section{box-sizing:border-box;width:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto}';
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
    function setPreviewStatus(text) {
        if (text === previewStatusText) return;
        previewStatusText = text;
        previewStatus.textContent = text;
    }
    function previewControl() {
        return [...document.querySelectorAll('button')].find(node => {
            const label = node.getAttribute('aria-label') || '';
            return previewLabel(node.textContent) !== null || /^(play|pause) preview$/i.test(label.trim());
        }) || null;
    }
    function previewAction(control) {
        if (!control) return null;
        return previewLabel(control.textContent) || previewLabel(control.getAttribute?.('aria-label'));
    }
    function previewVideo(control) {
        let node = control;
        for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
            const video = node.querySelector('video');
            if (video) return video;
        }
        const videos = [...document.querySelectorAll('video')].filter(video => video.getClientRects().length > 0);
        return videos.length === 1 ? videos[0] : null;
    }
    function isPreviewInteraction(target) {
        if (!(target instanceof Element)) return false;
        const button = target.closest('button');
        if (button && previewAction(button) !== null) return true;
        return Boolean(target.closest('video'));
    }
    function pausePreview(control, video) {
        if (control && previewAction(control) === 'pause') control.click();
        else if (video && !video.paused) video.pause();
    }
    function maybePausePreview() {
        if (!onShowPage) { setPreviewStatus(''); return; }
        const control = previewControl();
        if (!control) { setPreviewStatus(''); return; }
        const video = previewVideo(control);
        const playing = video ? !video.paused : previewAction(control) === 'pause';
        if (!playing) {
            setPreviewStatus(autoPauseAttempted ? '預覽已自動暫停' : '');
            return;
        }
        if (!shouldAutoPause({ enabled: autoPause, userInteracted, attempted: autoPauseAttempted, playing })) {
            if (userInteracted || autoPauseAttempted) setPreviewStatus('');
            return;
        }
        autoPauseAttempted = true;
        pausePreview(control, video);
        setPreviewStatus('預覽已自動暫停');
    }
    function setHealthStatus(text) {
        if (text === healthStatusText) return;
        healthStatusText = text;
        healthStatus.textContent = text;
    }
    function metricText(label) {
        const title = [...document.querySelectorAll('div')]
            .find(node => node.childElementCount === 0 && node.textContent.trim() === label);
        const holder = title?.parentElement;
        const value = holder?.querySelector('[class*="value-"]') || title?.previousElementSibling;
        return value?.textContent?.trim() || '';
    }
    function readHealthMetrics() {
        return {
            health: normalizeHealth(metricText('Health')),
            resolution: parseResolution(metricText('Resolution')),
            bitrateKbps: parseBitrateKbps(metricText('Bitrate')),
            fps: parseFps(metricText('Frame rate')),
            keyframeSec: parseKeyframeSec(metricText('Keyframe interval'))
        };
    }
    function healthSummary(values) {
        const parts = [];
        if (values.health) parts.push('Health ' + values.health);
        if (values.resolution) parts.push(values.resolution);
        if (values.bitrateKbps != null) parts.push(values.bitrateKbps + ' Kbps');
        if (values.fps != null) parts.push(values.fps + ' fps');
        if (values.keyframeSec != null) parts.push('Keyframe ' + values.keyframeSec + 's');
        return parts.length ? parts.join(' · ') : '找不到 Health / Bitrate 指標';
    }
    function sendHealth() {
        if (!onShowPage || !show) { setHealthStatus(''); return; }
        const values = readHealthMetrics();
        const summary = healthSummary(values);
        if (Object.values(values).every(value => value === null)) {
            setHealthStatus('指標：' + summary);
            return;
        }
        const now = Date.now();
        const key = JSON.stringify([show, values]);
        if (key === lastHealthKey && now - lastHealthAt < 60000) {
            setHealthStatus('指標：' + summary + (healthNotice ? ' · ' + healthNotice : ''));
            return;
        }
        lastHealthKey = key;
        lastHealthAt = now;
        healthNotice = '';
        setHealthStatus('指標：' + summary + ' · 送出中…');
        GM_xmlhttpRequest({
            method: 'POST',
            url: `${ttwEndpoint()}/restream/metrics`,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({
                type: 'restream-health', transport: 'userscript', showId: show,
                capturedAt: now, values,
                sourceUrl: location.origin + location.pathname
            }),
            timeout: 5000,
            onload: res => {
                healthNotice = (res.status === 200 ? '已送出' : 'HTTP ' + res.status) + ' ' + new Date().toLocaleTimeString();
                setHealthStatus('指標：' + summary + ' · ' + healthNotice);
            },
            onerror: () => { healthNotice = '傳送失敗'; setHealthStatus('指標：' + summary + ' · ' + healthNotice); },
            ontimeout: () => { healthNotice = '傳送逾時'; setHealthStatus('指標：' + summary + ' · ' + healthNotice); }
        });
    }
    function scan() {
        const path = location.pathname.match(/^\/shows\/([^/]+)\/?$/);
        onShowPage = Boolean(path);
        if (host.hidden !== !path) host.hidden = !path;
        if (!path) { show = ''; setPreviewStatus(''); setHealthStatus(''); return; }
        if (show !== path[1]) {
            show = path[1]; lastSaved = ''; failure = '';
            autoPauseAttempted = false; userInteracted = false; setPreviewStatus('');
            lastHealthAt = 0; lastHealthKey = ''; healthNotice = ''; setHealthStatus('');
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
        maybePausePreview();
        sendHealth();
        const message = failure || (!currentUrl ? '等待 Restream 顯示 TikTok Live Monitor 連結。'
            : !enabled ? '自動開啟已暫停；可使用手動按鈕。'
            : state.opened ? '本次已處理；關閉監控頁後可手動再開，不會自動反覆開頁。'
            : '已找到監控連結，等待穩定後開啟…');
        const summary = failure ? '開啟失敗' : !enabled ? '自動開啟已暫停' : !currentUrl ? '等待監控連結' : state.opened ? '本次連結已處理' : '已偵測，等待開啟';
        if (badge.textContent !== summary) badge.textContent = summary;
        if (message !== lastStatus) { status.textContent = message; lastStatus = message; }
    }
    function testEndpoint(target) {
        target.textContent = '測試中…';
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${ttwEndpoint()}/ping`,
            timeout: 5000,
            onload: res => { target.textContent = res.status === 200 ? '主服務連線正常' : '主服務回應 HTTP ' + res.status; },
            onerror: () => { target.textContent = '主服務連線失敗'; },
            ontimeout: () => { target.textContent = '主服務連線逾時'; }
        });
    }
    toggle.onchange = () => { enabled = toggle.checked; GM_setValue(preference, enabled); scan(); };
    testEndpointBtn.onclick = () => testEndpoint(endpointStatus);
    healthPageBtn.onclick = () => {
        const url = `${ttwEndpoint()}/restream`;
        if (typeof GM_openInTab === 'function') GM_openInTab(url, { active: true, insert: true });
        else window.open(url, '_blank', 'noopener');
    };
    pauseToggle.onchange = () => {
        autoPause = pauseToggle.checked; GM_setValue(pausePreference, autoPause);
        autoPauseAttempted = false; userInteracted = false; setPreviewStatus('');
        scan();
    };
    const markUserPreview = () => { userInteracted = true; setPreviewStatus(''); };
    document.addEventListener('pointerdown', event => {
        if (event.isTrusted && isPreviewInteraction(event.target)) markUserPreview();
    }, true);
    document.addEventListener('click', event => {
        if (event.isTrusted && isPreviewInteraction(event.target)) markUserPreview();
    }, true);
    document.addEventListener('keydown', event => {
        if (event.isTrusted && (event.key === ' ' || event.key === 'Enter') && isPreviewInteraction(event.target)) markUserPreview();
    }, true);
    document.addEventListener('play', event => {
        if (!(event.target instanceof HTMLVideoElement)) return;
        maybePausePreview();
    }, true);
    button.onclick = () => { scan(); openMonitor(); scan(); };
    new MutationObserver(() => {
        if (timer !== null) return;
        timer = setTimeout(() => { timer = null; scan(); }, 250);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'hidden', 'aria-hidden', 'style', 'class'] });
    // 同時處理 SPA 導航與沒有 DOM 變動的穩定等待；不碰 Restream 的開播控制。
    setInterval(scan, 1000);
    scan();
})();
