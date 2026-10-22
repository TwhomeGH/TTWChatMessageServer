// ==UserScript==
// @name         YouTube Chat to TTW Server
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  直接從 YouTube Studio 直播聊天室 DOM 抓訊息送到 TTW 伺服器（不耗 API quota；新增面板可手動開關轉接）
// @author       TTW
// @match        https://studio.youtube.com/live_chat*
// @match        https://www.youtube.com/live_chat*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @license      MIT


// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/youtube-chat-userscript.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/youtube-chat-userscript.user.js


// ==/UserScript==



(function () {
    'use strict'

    const SERVER_URL = 'http://localhost:3332/chat'
    const sentIds = new Set()
    const sentNodes = new WeakSet()
    let debug = true

    // ─────────────────────────────────────────────────────────────
    // 轉接開關：YouTube 這邊無法可靠判斷「是不是目標直播主」，
    // 所以改成使用者自己在面板上開／關。預設關閉（安全），要送再自己打開。
    // ─────────────────────────────────────────────────────────────
    const STATE_KEY = 'ttw_youtube_relay'

    /**
     * YouTube 頻道 ID（UC...）大小寫敏感，保留原樣；@handle 只作為舊資料 fallback。
     * @param {string} value 使用者輸入或頁面偵測值。
     * @returns {string} 正規化後的主播識別。
     */
    function normalizeBroadcaster(value) {
        const trimmed = String(value || '').trim().replace(/^@/, '').trim()
        return /^UC[\w-]{20,}$/.test(trimmed) ? trimmed : trimmed.toLowerCase()
    }

    /** 盡量從目前頁面或外層 Studio 頁面的 ytcfg／videoDetails 取得真正的頻道 ID。 */
    function detectChannelId() {
        const candidates = []
        try {
            candidates.push(window.ytcfg?.get?.('CHANNEL_ID'), window.ytInitialPlayerResponse?.videoDetails?.channelId)
        } catch { /* ignore */ }
        try {
            candidates.push(window.top?.ytcfg?.get?.('CHANNEL_ID'), window.top?.ytInitialPlayerResponse?.videoDetails?.channelId)
        } catch { /* ignore */ }
        return candidates.find(value => typeof value === 'string' && /^UC[\w-]{20,}$/.test(value)) || ''
    }

    const state = loadState()
    if (!state.broadcaster) {
        const detected = detectChannelId()
        if (detected) {
            state.broadcaster = detected
            saveState()
        }
    }
    // 舊版沒有 targetVideoId；不要沿用舊的 enabled 狀態，避免一升級就送到錯的聊天室。
    if (state.enabled && !state.targetVideoId) {
        state.enabled = false
        saveState()
    }

    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STATE_KEY) || '{}')
            return {
                enabled: saved.enabled === true,
                // 主播頻道 ID 只用於人流歸屬；未填時不猜測，維持未分類。
                broadcaster: normalizeBroadcaster(saved.broadcaster),
                // 轉接只對已鎖定的影片生效；避免開到別的聊天室仍用同一個主播送資料。
                targetVideoId: typeof saved.targetVideoId === 'string' ? saved.targetVideoId : '',
                autoFollow: saved.autoFollow === true,
            }
        } catch {
            return { enabled: false, broadcaster: '', targetVideoId: '', autoFollow: false }
        }
    }

    function saveState() {
        try { localStorage.setItem(STATE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
    }

    /** 從網址讀影片 ID：支援 ?v=、/video/{id}/livestreaming、/live/{id}。 */
    function videoIdFromUrl(url) {
        try {
            const parsed = new URL(url, location.href)
            const query = parsed.searchParams.get('v') || parsed.searchParams.get('video_id')
            if (query) return query
            const match = parsed.pathname.match(/\/(?:video|live)\/([A-Za-z0-9_-]{6,})(?:\/|$)/)
            return match ? match[1] : ''
        } catch {
            return ''
        }
    }

    /** 目前這頁的 video id；優先讀 iframe 自己的網址，再退回外層頁面。 */
    function currentVideoId() {
        let id = videoIdFromUrl(location.href)
        if (!id) {
            try { id = videoIdFromUrl(window.top.location.href) } catch { /* ignore */ }
        }
        if (!id) {
            try { id = videoIdFromUrl(document.referrer) } catch { /* ignore */ }
        }
        if (!id) {
            try { id = window.ytInitialPlayerResponse?.videoDetails?.videoId || '' } catch { /* ignore */ }
        }
        return id
    }

    /** 只有目前聊天室等於已鎖定影片時才允許送出。 */
    function isTargetChat(target = state.targetVideoId, current = currentVideoId()) {
        return Boolean(target) && Boolean(current) && target === current
    }

    /** 自動跟隨只用來判斷「同一頻道的新直播」；讀不到直播狀態時保守地不自動啟用。 */
    function isLiveVideo() {
        try {
            const flag = window.ytcfg?.get?.('IS_LIVE') ?? window.top?.ytcfg?.get?.('IS_LIVE')
            if (typeof flag === 'boolean') return flag
        } catch { /* ignore */ }
        try {
            const details = window.ytInitialPlayerResponse?.videoDetails || window.top?.ytInitialPlayerResponse?.videoDetails
            if (details && typeof details.isLive === 'boolean') return details.isLive
        } catch { /* ignore */ }
        return false
    }

    /** 若已開啟自動跟隨，且目前是同一個已設定頻道的直播，才更新目標並啟用。 */
    function maybeAutoFollow() {
        if (!state.autoFollow || !state.broadcaster) return false
        const current = currentVideoId()
        if (!current || current === state.targetVideoId) return false
        if (detectChannelId() !== state.broadcaster) return false
        if (!isLiveVideo()) return false
        state.targetVideoId = current
        state.enabled = true
        saveState()
        return true
    }

    /** 將目前聊天室設為唯一目標；手動開啟或按「鎖定此聊天室」都走這裡。 */
    function bindCurrentTarget() {
        const current = currentVideoId()
        const checkbox = document.getElementById('ttw-yt-enabled')
        if (!current) {
            state.enabled = false
            panelMessage = '讀不到影片 ID；請從含 v= 的聊天室網址開啟，或使用直播聊天室的彈出視窗。'
            if (checkbox) checkbox.checked = false
            saveState()
            renderPanelState()
            return false
        }
        panelMessage = ''
        state.targetVideoId = current
        state.enabled = true
        const detected = detectChannelId()
        if (detected) {
            state.broadcaster = detected
            const field = document.getElementById('ttw-yt-broadcaster')
            if (field) field.value = detected
        }
        if (checkbox) checkbox.checked = true
        saveState()
        renderPanelState()
        return true
    }

    let panelMessage = ''
    let lastBlockedLog = ''
    function logBlocked(reason = 'disabled') {
        if (lastBlockedLog === reason) return
        lastBlockedLog = reason
        log(reason === 'wrong-target'
            ? '目前聊天室不是已鎖定的目標，已暫停轉送'
            : '未開啟轉接，不送出（按左下角面板開啟）')
    }

    // 重新載入時只會自動接上同一個目標影片，或符合條件的同頻道新直播。
    maybeAutoFollow()

    function log(...args) {
        if (debug) console.log('[YT Userscript]', ...args)
    }

    function extractMsg(el) {
        // YouTube 聊天室訊息 DOM 結構
        const textEl = el.querySelector('#message, #message-content, [slot="message"], #message')
        const authorEl = el.querySelector('#author-name, #author-name, [slot="author-name"]')
        const imgEl = el.querySelector('img#author-photo, img[slot="photo"], img[src*="yt3"]')

        if (!textEl || !authorEl) return null

        const message = textEl.textContent.trim()
        const user = authorEl.textContent.trim()
        const avatar = imgEl ? imgEl.src : ''

        // 去重 ID（每則訊息只送一次）
        const uid = el.getAttribute('id') || null
        if (sentNodes.has(el)) return null
        sentNodes.add(el)
        if (sentIds.has(uid)) return null
        if (uid) sentIds.add(uid)
        if (sentIds.size > 10000) sentIds.delete(sentIds.values().next().value)

        return { type: 'StreamMessage', platform: 'Youtube', transport: 'userscript', msgId: uid, sentAt: el.querySelector('time[datetime]')?.getAttribute('datetime') || null, observedAt: Date.now(), user, message, img: avatar }
    }

    // 送出時浮出的小提示，讓使用者一眼看到剛剛送了什麼。
    let sentCount = 0
    let flashTimer = null

    function flashSent(user, message) {
        sentCount += 1
        const text = String(user || '') + (message ? '：' + message : '')
        const short = text.length > 36 ? text.slice(0, 36) + '…' : text
        const flash = document.getElementById('ttw-yt-flash')
        if (flash) {
            flash.textContent = '📤 聊天 ' + short
            flash.classList.add('show')
            clearTimeout(flashTimer)
            flashTimer = setTimeout(() => flash.classList.remove('show'), 2500)
        }
        const last = document.getElementById('ttw-yt-last')
        if (last) last.textContent = '最近轉送：' + short + '（本頁已送 ' + sentCount + ' 則）'
    }

    function send(data) {
        if (!state.enabled) {
            logBlocked('disabled')
            return
        }
        if (!isTargetChat()) {
            logBlocked('wrong-target')
            return
        }
        flashSent(data.user, data.message)
        const payload = { ...data, broadcasterId: state.broadcaster || undefined }
        GM_xmlhttpRequest({
            method: 'POST',
            url: SERVER_URL,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(payload),
            onload(r) {
                if (r.status !== 200) log('伺服器回傳', r.status)
            },
            onerror(e) {
                log('送出失敗', e)
            },
        })
    }

    // ─────────────────────────────────────────────────────────────
    // 小面板：手動開啟／關閉轉接（設定存在 localStorage）
    // ─────────────────────────────────────────────────────────────
    const PANEL_CSS = `
#ttw-yt-panel { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; font: 12px/1.5 system-ui, "Noto Sans TC", sans-serif; color: #e7edf7; }
  #ttw-yt-panel .ttw-pill { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #1b2940; border: 1px solid #344663; border-radius: 999px; cursor: grab; color: inherit; font: inherit; touch-action: none; user-select: none; }
  #ttw-yt-panel .ttw-pill:active { cursor: grabbing; }
  #ttw-yt-panel .ttw-bind { width: 100%; margin: 6px 0; padding: 6px 10px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font: inherit; cursor: pointer; }
  #ttw-yt-panel .ttw-bind:hover { background: #1d4ed8; }
#ttw-yt-panel .ttw-pill:hover { background: #24344f; }
#ttw-yt-panel .ttw-body { width: 232px; margin-top: 6px; padding: 10px 12px; background: #131c2b; border: 1px solid #344663; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
#ttw-yt-panel .ttw-title { font-weight: 700; margin-bottom: 6px; }
#ttw-yt-panel .ttw-switch { display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; user-select: none; }
#ttw-yt-panel .ttw-switch input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
#ttw-yt-panel .ttw-track { position: relative; flex: none; width: 34px; height: 18px; border-radius: 999px; background: #3b4a63; transition: background .15s ease; }
#ttw-yt-panel .ttw-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #cbd5e1; transition: transform .15s ease, background .15s ease; }
#ttw-yt-panel .ttw-switch input:checked + .ttw-track { background: #2563eb; }
#ttw-yt-panel .ttw-switch input:checked + .ttw-track::after { transform: translateX(16px); background: #fff; }
#ttw-yt-panel .ttw-switch input:focus-visible + .ttw-track { outline: 2px solid #60a5fa; outline-offset: 2px; }
#ttw-yt-panel .ttw-switch-text { color: #cbd5e1; }
#ttw-yt-panel .ttw-field { display: grid; gap: 4px; margin: 8px 0; color: #cbd5e1; }
#ttw-yt-panel .ttw-field input { width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid #344663; border-radius: 6px; background: #0d1524; color: #e7edf7; }
#ttw-yt-panel .ttw-state { margin-top: 6px; padding: 5px 8px; border-radius: 6px; background: #0d1524; overflow-wrap: anywhere; }
#ttw-yt-panel .ttw-state.on { color: #86efac; }
#ttw-yt-panel .ttw-state.off { color: #9ca3af; }
#ttw-yt-panel .ttw-last { margin-top: 6px; color: #94a3b8; overflow-wrap: anywhere; }
#ttw-yt-panel .ttw-hint { margin-top: 6px; color: #6b7280; }
#ttw-yt-panel .ttw-flash { max-width: 232px; max-height: 0; margin-bottom: 0; padding: 0 10px; overflow: hidden; background: #1b2940; border: 1px solid #344663; border-radius: 10px; color: #cbd5e1; opacity: 0; overflow-wrap: anywhere; transition: opacity .18s ease, max-height .18s ease, padding .18s ease, margin-bottom .18s ease; }
#ttw-yt-panel .ttw-flash.show { max-height: 72px; margin-bottom: 6px; padding: 6px 10px; opacity: 1; }
`

    /**
     * 用 DOM API 建立元素。YouTube 啟用 Trusted Types（`innerHTML` 會丟 TypeError），
     * 所以面板不能用 innerHTML 字串組，否則整個面板建不起來。
     */
    function h(tag, attrs = {}, children = []) {
        const node = document.createElement(tag)
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'class') node.className = value
            else if (key === 'text') node.textContent = value
            else if (value === true) node.setAttribute(key, '')
            else if (value !== false && value != null) node.setAttribute(key, value)
        }
        for (const child of [].concat(children)) node.append(child)
        return node
    }

    const PANEL_POSITION_KEY = 'ttw_youtube_relay_panel'
    let suppressPillClickUntil = 0

    function loadPanelPosition() {
        try {
            const saved = JSON.parse(localStorage.getItem(PANEL_POSITION_KEY) || 'null')
            if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) return saved
        } catch { /* ignore */ }
        return null
    }

    function savePanelPosition(panel) {
        try {
            const left = Number.parseFloat(panel.style.left)
            const top = Number.parseFloat(panel.style.top)
            if (Number.isFinite(left) && Number.isFinite(top)) {
                localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify({ left, top }))
            }
        } catch { /* ignore */ }
    }

    /** 夾在視窗內；面板展開後高度改變時也要重新夾一次。 */
    function clampPanel(panel) {
        if (!panel.style.top) return
        const left = Number.parseFloat(panel.style.left) || 8
        const top = Number.parseFloat(panel.style.top) || 8
        const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8)
        const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8)
        panel.style.left = Math.min(Math.max(8, left), maxLeft) + 'px'
        panel.style.top = Math.min(Math.max(8, top), maxTop) + 'px'
    }

    /** 拖動 pill 移動面板；沒有移動時仍保留原本的點擊開合。 */
    function makeDraggable(panel, handle) {
        let drag = null
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return
            const rect = panel.getBoundingClientRect()
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false }
            try { handle.setPointerCapture(event.pointerId) } catch { /* ignore */ }
        })
        handle.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return
            const dx = event.clientX - drag.x
            const dy = event.clientY - drag.y
            if (!drag.moved && Math.hypot(dx, dy) < 5) return
            drag.moved = true
            event.preventDefault()
            const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8)
            const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8)
            panel.style.left = Math.min(Math.max(8, drag.left + dx), maxLeft) + 'px'
            panel.style.top = Math.min(Math.max(8, drag.top + dy), maxTop) + 'px'
            panel.style.bottom = 'auto'
        })
        const finish = event => {
            if (!drag || event.pointerId !== drag.id) return
            const moved = drag.moved
            drag = null
            try { handle.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
            if (moved) {
                suppressPillClickUntil = Date.now() + 350
                savePanelPosition(panel)
            }
        }
        handle.addEventListener('pointerup', finish)
        handle.addEventListener('pointercancel', finish)
    }

    function buildPanel() {
        if (document.getElementById('ttw-yt-panel')) return
        const style = document.createElement('style')
        style.textContent = PANEL_CSS
        document.head.append(style)

        const box = h('div', { id: 'ttw-yt-panel' }, [
            h('div', { class: 'ttw-flash', id: 'ttw-yt-flash' }),
            h('button', { class: 'ttw-pill', id: 'ttw-yt-pill', title: 'YouTube 轉接設定（可拖曳移動）' }, [
                '🎯 ', h('span', { id: 'ttw-yt-pill-text', text: '轉接設定' })
            ]),
            h('div', { class: 'ttw-body', id: 'ttw-yt-body', hidden: true }, [
                h('div', { class: 'ttw-title', text: 'YouTube 轉接' }),
                h('label', { class: 'ttw-switch' }, [
                    h('input', { type: 'checkbox', id: 'ttw-yt-enabled' }),
                    h('span', { class: 'ttw-track' }),
                    h('span', { class: 'ttw-switch-text', text: '啟用轉接' })
                ]),
                h('label', { class: 'ttw-switch' }, [
                    h('input', { type: 'checkbox', id: 'ttw-yt-autofollow' }),
                    h('span', { class: 'ttw-track' }),
                    h('span', { class: 'ttw-switch-text', text: '自動跟隨此頻道的新直播' })
                ]),
                h('label', { class: 'ttw-field' }, [
                    h('span', { text: 'YouTube 頻道 ID（選填）' }),
                    h('input', { type: 'text', id: 'ttw-yt-broadcaster', placeholder: 'UC...（頻道 ID）' })
                ]),
                h('button', { class: 'ttw-bind', id: 'ttw-yt-bind', type: 'button', text: '鎖定此聊天室' }),
                h('div', { class: 'ttw-state', id: 'ttw-yt-state' }),
                h('div', { class: 'ttw-last', id: 'ttw-yt-last' }),
                h('div', { class: 'ttw-hint', text: '請填 UC 開頭的頻道 ID；會嘗試從頁面自動偵測，抓不到再手動貼上。啟用時會鎖定目前影片，開到別的聊天室會自動暫停；同一個影片重新整理會自動恢復。自動跟隨只會在相同頻道且確認直播中時接手新影片。' })
            ])
        ])
        document.body.append(box)
        const savedPosition = loadPanelPosition()
        if (savedPosition) {
            box.style.left = savedPosition.left + 'px'
            box.style.top = savedPosition.top + 'px'
            box.style.bottom = 'auto'
            clampPanel(box)
        }
        makeDraggable(box, box.querySelector('#ttw-yt-pill'))
        window.addEventListener('resize', () => clampPanel(box))

        const enabled = box.querySelector('#ttw-yt-enabled')
        enabled.checked = state.enabled
        const broadcaster = box.querySelector('#ttw-yt-broadcaster')
        broadcaster.value = state.broadcaster || ''
        broadcaster.oninput = () => {
            state.broadcaster = normalizeBroadcaster(broadcaster.value)
            saveState()
        }
        const autoFollow = box.querySelector('#ttw-yt-autofollow')
        autoFollow.checked = state.autoFollow
        autoFollow.onchange = () => {
            state.autoFollow = autoFollow.checked
            saveState()
            if (state.autoFollow) maybeAutoFollow()
            enabled.checked = state.enabled
            renderPanelState()
        }
        box.querySelector('#ttw-yt-bind').onclick = bindCurrentTarget
        box.querySelector('#ttw-yt-pill').onclick = () => {
            if (Date.now() < suppressPillClickUntil) return
            const body = box.querySelector('#ttw-yt-body')
            body.hidden = !body.hidden
            requestAnimationFrame(() => clampPanel(box))
        }
        enabled.onchange = () => {
            if (enabled.checked) {
                bindCurrentTarget()
            } else {
                state.enabled = false
                saveState()
                renderPanelState()
            }
        }
        renderPanelState()
    }

    /** 更新面板狀態；收合的按鈕也會顯示摘要。 */
    function renderPanelState() {
        const el = document.getElementById('ttw-yt-state')
        if (!el) return
        const current = currentVideoId()
        const target = state.targetVideoId
        const active = state.enabled && isTargetChat(target, current)
        let text
        if (panelMessage) text = '⚠️ ' + panelMessage
        else if (!state.enabled) text = '⏸ 未開啟轉接，不會送出'
        else if (!target) text = '⚠️ 未鎖定目標聊天室，已暫停；請按「鎖定此聊天室」'
        else if (!current) text = '⚠️ 讀不到 video ID，已暫停；請按「鎖定此聊天室」'
        else if (current !== target) text = '⛔ 已暫停：目前 ' + current + '，目標 ' + target
        else text = '✅ 轉接中：' + current
        el.textContent = text
        el.className = 'ttw-state ' + (active ? 'on' : 'off')
        const pill = document.getElementById('ttw-yt-pill-text')
        if (pill) pill.textContent = active ? ('轉接中 ' + (target || '')) : '轉接已暫停'
    }

    if (document.body) buildPanel()
    else document.addEventListener('DOMContentLoaded', buildPanel)
    // 聊天室是動態頁面，定期重畫狀態（video id 可能變）。
    setInterval(renderPanelState, 5000)

    function startObserving() {
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue
                    // 直接匹配或往下找聊天訊息元素
                    const selector =
                        'yt-live-chat-text-message-renderer,' +
                        'yt-live-chat-paid-message-renderer,' +
                        'yt-live-chat-legacy-paid-message-renderer,' +
                        'yt-live-chat-membership-item-renderer'
                    const items = node.matches?.(selector) ? [node] : node.querySelectorAll?.(selector) || []
                    for (const el of items) {
                        const data = extractMsg(el)
                        if (data) {
                            log('擷取:', data.user, '-', data.message.substring(0, 60))
                            send(data)
                        }
                    }
                }
            }
        })

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
        })

        log('✅ 觀察器已啟動，等待聊天訊息...')
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserving)
    } else {
        startObserving()
    }
})()
