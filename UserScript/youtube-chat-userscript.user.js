// ==UserScript==
// @name         YouTube Chat to TTW Server
// @namespace    http://tampermonkey.net/
// @version      1.3
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
    const state = loadState()

    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STATE_KEY) || '{}')
            return { enabled: saved.enabled === true }
        } catch {
            return { enabled: false }
        }
    }

    function saveState() {
        try { localStorage.setItem(STATE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
    }

    /** 目前這頁的 video id：面板用來確認「你在哪一台」。 */
    function currentVideoId() {
        const params = new URLSearchParams(location.search)
        return params.get('v') || params.get('video_id') || ''
    }

    let lastBlockedLog = ''
    function logBlocked() {
        if (lastBlockedLog === 'disabled') return
        lastBlockedLog = 'disabled'
        log('未開啟轉接，不送出（按左下角面板開啟）')
    }

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
            logBlocked()
            return
        }
        flashSent(data.user, data.message)
        GM_xmlhttpRequest({
            method: 'POST',
            url: SERVER_URL,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(data),
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
#ttw-yt-panel .ttw-pill { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #1b2940; border: 1px solid #344663; border-radius: 999px; cursor: pointer; color: inherit; font: inherit; }
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

    function buildPanel() {
        if (document.getElementById('ttw-yt-panel')) return
        const style = document.createElement('style')
        style.textContent = PANEL_CSS
        document.head.append(style)

        const box = h('div', { id: 'ttw-yt-panel' }, [
            h('div', { class: 'ttw-flash', id: 'ttw-yt-flash' }),
            h('button', { class: 'ttw-pill', id: 'ttw-yt-pill', title: 'YouTube 轉接設定' }, [
                '🎯 ', h('span', { id: 'ttw-yt-pill-text', text: '轉接設定' })
            ]),
            h('div', { class: 'ttw-body', id: 'ttw-yt-body', hidden: true }, [
                h('div', { class: 'ttw-title', text: 'YouTube 轉接' }),
                h('label', { class: 'ttw-switch' }, [
                    h('input', { type: 'checkbox', id: 'ttw-yt-enabled' }),
                    h('span', { class: 'ttw-track' }),
                    h('span', { class: 'ttw-switch-text', text: '啟用轉接' })
                ]),
                h('div', { class: 'ttw-state', id: 'ttw-yt-state' }),
                h('div', { class: 'ttw-last', id: 'ttw-yt-last' }),
                h('div', { class: 'ttw-hint', text: 'YouTube 無法自動判斷是不是目標直播主，請自己確認這一台再開啟。設定自動存在此瀏覽器。' })
            ])
        ])
        document.body.append(box)

        const enabled = box.querySelector('#ttw-yt-enabled')
        enabled.checked = state.enabled
        box.querySelector('#ttw-yt-pill').onclick = () => {
            const body = box.querySelector('#ttw-yt-body')
            body.hidden = !body.hidden
        }
        enabled.onchange = () => { state.enabled = enabled.checked; saveState(); renderPanelState() }
        renderPanelState()
    }

    /** 更新面板狀態；收合的按鈕也會顯示摘要。 */
    function renderPanelState() {
        const el = document.getElementById('ttw-yt-state')
        if (!el) return
        const video = currentVideoId()
        const text = state.enabled
            ? '✅ 轉接中' + (video ? '：' + video : '')
            : '⏸ 未開啟轉接，不會送出'
        el.textContent = text
        el.className = 'ttw-state ' + (state.enabled ? 'on' : 'off')
        const pill = document.getElementById('ttw-yt-pill-text')
        if (pill) pill.textContent = state.enabled ? ('轉接中' + (video ? ' ' + video : '')) : '轉接已暫停'
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
