// ==UserScript==
// @name         YouTube Chat to TTW Server
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  直接從 YouTube Studio 直播聊天室 DOM 抓訊息送到 TTW 伺服器（不耗 API quota）
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
    let debug = true

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
        const uid = el.getAttribute('id') || `${user}:${message}:${Date.now()}`
        if (sentIds.has(uid)) return null
        sentIds.add(uid)
        if (sentIds.size > 10000) sentIds.clear()

        return { user, message, img: avatar }
    }

    function send(data) {
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
