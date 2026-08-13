// ==UserScript==
// @name         Full Video Site Fix + Dark Mode + Override
// @namespace    http://tampermonkey.net/
// @version      4.6
// @description  修正 video-grid + 播放器頁面排版，資訊面板、推薦影片美化，圖片比例修正，深色模式切換並記住偏好，覆蓋 refreshLiveChatUnread
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-start


// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/FixGrid.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/FixGrid.user.js

// ==/UserScript==

(function () {
  'use strict';

  // 本來只是想安靜看某神秘網站
  // 結果排版太崩壞只好自己修
  // 於是誕生了這個 userscript
  // 有需要就拿去用吧 哈

  const injectCSS = () => {
    GM_addStyle(`


          body .home-video-card a {
            text-decoration: none !important; /* 移除底線 */
            color: inherit !important;        /* 保持原本文字顏色 */
            display: block;                   /* 讓整個卡片可點擊 */
            background: #685353 !important; /* 設定背景顏色 */
          }

          /* ========== video-grid (首頁影片列表) ========== */
          body .video-grid, .video-grid {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)) !important;
            gap: 16px !important;
            align-items: stretch !important;
          }
          @media (max-width: 600px) {
            body .video-grid { grid-template-columns: 1fr !important; }
          }
          @media (min-width: 601px) and (max-width: 900px) {
            body .video-grid { grid-template-columns: repeat(2, 1fr) !important; }
          }
          @media (min-width: 901px) {
            body .video-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)) !important; }
          }
          body .video-grid .home-video-card {
            display: flex !important;
            flex-direction: column !important;
            height: 100% !important;
            background: #fff;
            border-radius: 6px;
            overflow: hidden;
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          }
          body .home-video-thumb {
            position: relative;
            width: 100%;
            aspect-ratio: 16 / 9;
            overflow: hidden;
            flex-shrink: 0;
          }
          body .home-video-thumb img {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            display: block !important;
          }
          body .home-video-info {
            flex-grow: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            padding: 8px 12px;
          }

          /* ========== 播放器主區域 ========== */
          .video-player {
            position: relative !important;
            width: 100% !important;
            aspect-ratio: 16 / 9 !important;
            background: #000 !important;
            border-radius: 8px !important;
            overflow: hidden !important;
             /* 關鍵修正 */
            max-height: 60vh; /* 限制最大高度為視窗高度的 80% */

          }

          .video-player video {
            width: 100% !important;
            height: 100% !important;
            object-fit: contain !important;
            display: block !important;
          }
          #playerControls {
            position: absolute !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
            padding: 8px 12px !important;
            background: rgba(0,0,0,0.6) !important;
            color: #fff !important;
            transition: opacity 0.3s ease;
            opacity: 0 !important;
          }
          .video-player:hover #playerControls {
            opacity: 1 !important;
          }

          /* ========== 資訊面板 ========== */
          .spk-video-info-panel {
            margin-top: 16px !important;
            background: #2a2323 !important;
            border-radius: 8px !important;
            padding: 16px !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .spk-video-topbar {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            margin-bottom: 12px !important;
          }
          .spk-watch-title {
            font-size: 1.4rem !important;
            font-weight: bold !important;
            color: #f3d2d2 !important;
            margin: 0 !important;
          }
          .spk-video-meta-box {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) !important;
            gap: 8px !important;
            font-size: 0.9rem !important;
            color: #444 !important;
          }
          .spk-meta-item {
            background: #fafafa !important;
            padding: 6px 8px !important;
            border-radius: 4px !important;
          }

          /* ========== 側邊推薦影片 ========== */
          #watchSidebar {
            margin-top: 20px !important;
            background: rgba(255,255,255,0.5) !important;
            border-radius: 8px !important;
            padding: 12px !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .vx-rec-list {
            display: flex !important;
            flex-direction: column !important;
            gap: 12px !important;
          }
          .vx-rec-item {
            display: flex !important;
            gap: 10px !important;
            background: rgb(222,213,213,0.6) !important;
            border-radius: 6px !important;
            overflow: hidden !important;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
          }
          .vx-rec-item:hover {
            transform: translateY(-2px);
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          }
          .vx-rec-thumb {
            flex: 0 0 120px !important;
            aspect-ratio: 16 / 9 !important;
            overflow: hidden !important;
            border-radius: 6px !important;
          }
          .vx-rec-thumb img {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            display: block !important;
          }

          /* ========== 深色模式 ========== */
          body.dark-mode {
            background: #121212 !important;
            color: #e0e0e0 !important;
          }
          body.dark-mode .video-grid .home-video-card,
          body.dark-mode .spk-video-info-panel,
          body.dark-mode #watchSidebar {
            background: #1e1e1e !important;
            color: #e0e0e0 !important;
            box-shadow: none !important;
          }
          body.dark-mode .spk-meta-item,
          body.dark-mode .vx-rec-item {
            background: #2a2a2a !important;
            color: #ccc !important;
          }
          body.dark-mode .vx-rec-item:hover {
            background: #333 !important;
          }
          body.dark-mode #playerControls {
            background: rgba(0,0,0,0.7) !important;
          }
        `);
  };

  injectCSS();

  // 深色模式切換按鈕 + 記住偏好
  const toggleButton = document.createElement("button");
  toggleButton.textContent = localStorage.getItem("darkMode") === "true" ? "☀️ 淺色模式" : "🌙 深色模式";
  if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark-mode");
  }
  Object.assign(toggleButton.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "9999",
    padding: "8px 12px",
    borderRadius: "6px",
    border: "none",
    background: "#444",
    color: "#fff",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(0,0,0,0.3)"
  });
  // 深色模式切換按鈕 + 記住偏好
  toggleButton.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    const isDark = document.body.classList.contains("dark-mode");
    toggleButton.textContent = isDark ? "☀️ 淺色模式" : "🌙 深色模式";
    localStorage.setItem("darkMode", isDark);
  });
  document.body.appendChild(toggleButton);



  const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        if (typeof args[0] === "string" && args[0].includes("/api/live-chat/messages")) {
            console.log("[Userscript] 攔截到 live-chat API，已阻止");
            return new Response(JSON.stringify({ ok: true, messages: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch.apply(this, args);
    };



  // 監聽 DOM 變化，確保動態載入也能套用 CSS 與函數覆蓋
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if ([...m.addedNodes].some(node =>
        node.nodeType === 1 && (
          node.classList?.contains("video-grid") ||
          node.classList?.contains("watch-page") ||
          node.classList?.contains("spk-video-info-panel") ||
          node.id === "watchSidebar"
        )
      )) {
        injectCSS();
        overrideRefresh();
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();

