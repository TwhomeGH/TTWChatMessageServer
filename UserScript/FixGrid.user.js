// ==UserScript==
// @name         Full Video Site Fix + Dark Mode + Dynamic SPA
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  修正影片列表、播放器、資訊面板、推薦影片排版；支援動態 DOM、SPA 換頁、深色模式、live-chat API 攔截
// @match        *://spklove.com/*
// @grant        GM_addStyle
// @run-at       document-start
//
// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/FixGrid.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/FixGrid.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 本來只是想安靜看某神秘網站
    // 結果排版太崩壞只好自己修
    // 於是誕生了這個 userscript
    // 有需要就拿去用吧 哈


    const PREFIX = '[Full Video Site Fix]';

    console.log(`${PREFIX} 啟動`);

    // =========================================================
    // 設定
    // =========================================================

    const SELECTORS = {
        videoGrid: '.video-grid',
        videoCard: '.home-video-card',
        videoThumb: '.home-video-thumb',
        videoInfo: '.home-video-info',

        player: '.video-player',
        playerVideo: '.video-player video',
        playerControls: '#playerControls',

        infoPanel: '.spk-video-info-panel',
        topbar: '.spk-video-topbar',
        title: '.spk-watch-title',
        metaBox: '.spk-video-meta-box',
        metaItem: '.spk-meta-item',

        sidebar: '#watchSidebar',
        recList: '.vx-rec-list',
        recItem: '.vx-rec-item',
        recThumb: '.vx-rec-thumb'
    };




    ;




    // =========================================================
    // CSS
    // =========================================================

    function injectCSS() {

        if (document.getElementById(
            'full-video-site-fix-style'
        )) {
            return;
        }

        GM_addStyle(`
            /* =====================================================
               全域
               ===================================================== */

            body .home-video-card a {
                text-decoration: none !important;
                color: inherit !important;
                display: block !important;
            }


            /* =====================================================
               Video Grid
               ===================================================== */

            body .video-grid {
                display: grid !important;

                grid-template-columns:
                    repeat(
                        auto-fill,
                        minmax(240px, 1fr)
                    ) !important;

                gap: 16px !important;

                align-items: stretch !important;
            }


            @media (max-width: 600px) {

                body .video-grid {
                    grid-template-columns:
                        1fr !important;
                }

            }


            @media (min-width: 601px) and (max-width: 900px) {

                body .video-grid {
                    grid-template-columns:
                        repeat(2, 1fr) !important;
                }

            }


            @media (min-width: 901px) {

                body .video-grid {
                    grid-template-columns:
                        repeat(
                            auto-fill,
                            minmax(240px, 1fr)
                        ) !important;
                }

            }

            
            /* =====================================================
                Home Page
                ===================================================== */

            body .spk-mascot-banner {
              width: 100%;
              max-height: 15%; /* 你要的高度限制 */
              overflow: hidden;  /* 防止超出容器 */
            }

            body .spk-mascot-banner-img {
              width: 100%;
              height: auto;
              aspect-ratio: auto;
              object-fit: fill; /* 保持完整顯示，不裁切 */
            }


            .media-row.video-row {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
              gap: 16px; /* 卡片間距 */
              padding: 16px;
            }

            .home-video-card {
              background: #5a5050;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 2px 6px rgba(0,0,0,0.1);
              display: flex;
              flex-direction: column;
            }

            .home-video-thumb {
              position: relative;
              aspect-ratio: 16 / 9; /* 固定比例 */
              overflow: hidden;
            }

            .home-video-thumb img {
              width: 100%;
              height: 100%;
              object-fit: cover; /* 填滿比例 */
              display: block;
            }

            .home-video-play {
              position: absolute;
              bottom: 8px;
              right: 8px;
              background: rgba(0,0,0,0.6);
              color: #fff;
              border-radius: 50%;
              padding: 6px;
            }

            .home-video-duration {
              position: absolute;
              top: 8px;
              right: 8px;
              background: rgba(0,0,0,0.6);
              color: #fff;
              font-size: 12px;
              padding: 2px 6px;
              border-radius: 4px;
            }

            .home-video-info {
              padding: 10px;
              flex: 1;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
            }

            .home-video-title {
              font-size: 14px;
              font-weight: bold;
              margin: 0 0 6px;
              line-height: 1.4;
            }

            .home-video-author {
              font-size: 12px;
              color: #e49898;
              margin: 0 0 8px;
            }

            .home-video-stats {
              display: flex;
              gap: 12px;
              font-size: 12px;
              color: #e49898;
            }


            /* 整個區塊 */
            .home-section {
              padding: 20px;
            }

            .home-section-head {
              margin-bottom: 12px;
            }

            /* 橫向捲動容器 */
            .home-scroll-box {
              position: relative;
              overflow: hidden;
            }

            .media-row.image-row {
              display: grid;
              grid-auto-flow: column;
              grid-auto-columns: minmax(160px, 1fr);
              gap: 16px;
              padding: 8px 0;
            }

            /* 單張卡片 */
            .home-image-card {
              background: #5a5050;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 2px 6px rgba(0,0,0,0.1);
            }

            /* 縮圖區塊 */
            .home-image-thumb {
              position: relative;
              aspect-ratio: 4 / 3; /* 固定比例 */
              overflow-x: auto;
              overflow-y: hidden;
            }

            .home-image-thumb img {
              width: 100%;
              height: 100%;
              object-fit: cover; /* 填滿比例 */
              display: block;
            }

            /* 疊層數量顯示 */
            .home-image-count {
              position: absolute;
              top: 8px;
              left: 8px;
              background: rgba(0,0,0,0.6);
              color: #fff;
              font-size: 12px;
              padding: 2px 6px;
              border-radius: 4px;
            }

            /* 喜歡按鈕 */
            .home-image-like {
              position: absolute;
              bottom: 8px;
              right: 8px;
              background: rgba(255,255,255,0.9);
              border: none;
              border-radius: 50%;
              padding: 6px;
              cursor: pointer;
              transition: background 0.2s;
            }

            .home-image-like:hover {
              background: rgba(255,0,0,0.2);
            }

            .home-image-like .fa-heart {
              color: #e74c3c;
            }


            // 大標題與副標題
            .home-section-head > div {
              display: flex;
              flex-direction: row; /* 正常左右排列 */
              align-items: baseline;
              gap: 8px;
            }

            .home-section-title {
              font-size: 20px;
              font-weight: bold;
              color: #f5a1a1;
              margin: 0;
              order: 1; /* 標題在前 */
            }

            .home-section-kicker {
              font-size: 14px;
              font-weight: 600;
              color: #fffcfc;
              order: 2; /* 副標題在後 */
            }


            /* =====================================================
                Manga Card
                ===================================================== */

            /* 整個橫向捲動區 */
            .home-scroll-box {
              position: relative;
              overflow-x: auto;
              overflow-y: hidden;
              scrollbar-width: thin;
              scrollbar-color: #aaa transparent;
              padding: 12px 0;
            }

            /* 橫向排列 */
            .media-row.manga-row {
              display: grid;
              grid-auto-flow: column;
              grid-auto-columns: minmax(180px, 1fr);
              gap: 16px;
            }

            /* 單張漫畫卡片 */
            .home-manga-card {
              background: #d1c1c1;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 2px 6px rgba(0,0,0,0.1);
              display: flex;
              flex-direction: column;
            }

            /* 縮圖區塊 */
            .home-manga-thumb {
              position: relative;
              aspect-ratio: 3 / 4; /* 固定比例，漫畫封面常用 */
              overflow: hidden;
            }

            .home-manga-thumb img {
              width: 100%;
              height: 100%;
              object-fit: cover;
              display: block;
            }


            /* 資訊區塊 */
            .home-manga-info {
              padding: 10px;
              flex: 1;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
            }

            .home-manga-title {
              font-size: 14px;
              font-weight: bold;
              margin: 0 0 6px;
              line-height: 1.4;
              color: #333;
            }

            /* meta 資訊 */
            .home-manga-meta {
              display: flex;
              align-items: center;
              gap: 10px;
              font-size: 12px;
              color: #555;
            }

            .home-manga-meta span {
              display: flex;
              align-items: center;
              gap: 4px;
            }

            .home-manga-flag img {
              width: 18px;
              height: auto;
              border-radius: 2px;
            }
            


          .manga-scroll-pages {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
            gap: 8px;
            justify-items: center;
          }

          .manga-page {
            width: 100%;
            object-fit: fill;        /* 填滿格子 */
            border-radius: 4px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          }


          /** =====================================================
           *  manga ended img
           * =====================================================
           */

          .manga-single-stage {
            display: flex;
            justify-content: center;
            align-items: center;
            background: #111;       /* 深色背景，突出漫畫 */
            min-height: 90vh;       /* 保證閱讀區塊高度 */
            overflow: hidden;       /* 避免圖片超出容器 */
          }

          .manga-single-image {
            max-width: 95%;         /* 不超過螢幕寬度 */
            max-height: 95vh;       /* 不超過螢幕高度 */
            object-fit: contain;    /* 保持比例顯示 */
            margin: auto;
            display: block;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          }



            /* =====================================================
                Video Card
                ===================================================== */

            body .video-grid .home-video-card {

                display: flex !important;

                flex-direction: column !important;

                height: 100% !important;

                background: #474242 !important;

                border-radius: 6px !important;

                overflow: hidden !important;

                box-shadow:
                    0 2px 6px
                    rgba(0, 0, 0, 0.15) !important;
            }


            /* =====================================================
               Thumbnail
               ===================================================== */

            body .home-video-thumb {

                position: relative !important;

                width: 100% !important;

                aspect-ratio: 16 / 9 !important;

                overflow: hidden !important;

                flex-shrink: 0 !important;
            }


            body .home-video-thumb img {

                width: 100% !important;

                height: 100% !important;

                object-fit: cover !important;

                display: block !important;
            }


            /* =====================================================
               Video Info
               ===================================================== */

            body .home-video-info {

                flex-grow: 1 !important;

                display: flex !important;

                flex-direction: column !important;

                justify-content: space-between !important;

                padding: 8px 12px !important;
            }


            /* =====================================================
               Player
               ===================================================== */

            body .video-player {

                position: relative !important;

                width: 100% !important;

                aspect-ratio: 16 / 9 !important;

                background: #000 !important;

                border-radius: 8px !important;

                overflow: hidden !important;

                max-height: 60vh !important;
            }


            body .video-player video {

                width: 100% !important;

                height: 100% !important;

                object-fit: contain !important;

                display: block !important;
            }


            /* =====================================================
               Player Controls
               ===================================================== */

            body #playerControls {

                position: absolute !important;

                bottom: 0 !important;

                left: 0 !important;

                right: 0 !important;

                display: flex !important;

                align-items: center !important;

                gap: 10px !important;

                padding: 8px 12px !important;

                background:
                    rgba(0, 0, 0, 0.6) !important;

                color: #fff !important;

                transition:
                    opacity 0.3s ease !important;

                opacity: 0 !important;
            }


            body .video-player:hover #playerControls {

                opacity: 1 !important;
            }


            /* =====================================================
               Info Panel
               ===================================================== */

            body .spk-video-info-panel {

                margin-top: 16px !important;

                background: #2a2323 !important;

                border-radius: 8px !important;

                padding: 16px !important;

                box-shadow:
                    0 2px 8px
                    rgba(0, 0, 0, 0.1) !important;
            }


            body .spk-video-topbar {

                display: flex !important;

                justify-content: space-between !important;

                align-items: center !important;

                margin-bottom: 12px !important;
            }


            body .spk-watch-title {

                font-size: 1.4rem !important;

                font-weight: bold !important;

                color: #f3d2d2 !important;

                margin: 0 !important;
            }


            body .spk-video-meta-box {

                display: grid !important;

                grid-template-columns:
                    repeat(
                        auto-fill,
                        minmax(140px, 1fr)
                    ) !important;

                gap: 8px !important;

                font-size: 0.9rem !important;

                color: #444 !important;
            }


            body .spk-meta-item {

                background: #fafafa !important;

                padding: 6px 8px !important;

                border-radius: 4px !important;
            }


            /* =====================================================
               Watch Sidebar
               ===================================================== */

            body #watchSidebar {

                margin-top: 20px !important;

                background:
                    rgba(255, 255, 255, 0.5) !important;

                border-radius: 8px !important;

                padding: 12px !important;

                box-shadow:
                    0 2px 8px
                    rgba(0, 0, 0, 0.1) !important;
            }


            /* =====================================================
               Recommendation List
               ===================================================== */

            body .vx-rec-list {

                display: flex !important;

                flex-direction: column !important;

                gap: 12px !important;
            }


            body .vx-rec-item {

                display: flex !important;

                gap: 10px !important;

                background:
                    rgba(222, 213, 213, 0.6) !important;

                border-radius: 6px !important;

                overflow: hidden !important;

                transition:
                    transform 0.2s ease,
                    box-shadow 0.2s ease !important;
            }


            body .vx-rec-item:hover {

                transform:
                    translateY(-2px) !important;

                box-shadow:
                    0 2px 6px
                    rgba(0, 0, 0, 0.15) !important;
            }


            body .vx-rec-thumb {

                flex:
                    0 0 120px !important;

                aspect-ratio:
                    16 / 9 !important;

                overflow:
                    hidden !important;

                border-radius:
                    6px !important;
            }


            body .vx-rec-thumb img {

                width:
                    100% !important;

                height:
                    100% !important;

                object-fit:
                    cover !important;

                display:
                    block !important;
            }


            /* =====================================================
               Dark Mode
               ===================================================== */

            body.dark-mode {

                background:
                    #121212 !important;

                color:
                    #e0e0e0 !important;
            }


            body.dark-mode
            .video-grid
            .home-video-card,

            body.dark-mode
            .spk-video-info-panel,

            body.dark-mode
            #watchSidebar {

                background:
                    #1e1e1e !important;

                color:
                    #e0e0e0 !important;

                box-shadow:
                    none !important;
            }


            body.dark-mode
            .spk-meta-item,

            body.dark-mode
            .vx-rec-item {

                background:
                    #2a2a2a !important;

                color:
                    #ccc !important;
            }


            body.dark-mode
            .vx-rec-item:hover {

                background:
                    #333 !important;
            }


            body.dark-mode
            #playerControls {

                background:
                    rgba(0, 0, 0, 0.7) !important;
            }


            /* =====================================================
               Dark Mode Button
               ===================================================== */

            #full-video-site-dark-toggle {

                position: fixed !important;

                bottom: 20px !important;

                right: 20px !important;

                z-index:
                    2147483647 !important;

                padding:
                    8px 12px !important;

                border-radius:
                    6px !important;

                border:
                    none !important;

                background:
                    #444 !important;

                color:
                    #fff !important;

                cursor:
                    pointer !important;

                box-shadow:
                    0 2px 6px
                    rgba(0, 0, 0, 0.3) !important;
            }
        `);

        console.log(`${PREFIX} CSS 已注入`);
    }


    // =========================================================
    // Body Ready
    // =========================================================

    function whenBodyReady(callback) {

        if (document.body) {

            callback();

            return;
        }


        const observer =
            new MutationObserver(() => {

                if (document.body) {

                    observer.disconnect();

                    callback();
                }

            });


        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );
    }


    // =========================================================
    // Dark Mode
    // =========================================================

    function setupDarkMode() {

        if (!document.body) {
            return;
        }


        const STORAGE_KEY =
            'fullVideoSiteDarkMode';


        const saved =
            localStorage.getItem(STORAGE_KEY);


        if (saved === 'true') {

            document.body.classList.add(
                'dark-mode'
            );
        }


        let button =
            document.getElementById(
                'full-video-site-dark-toggle'
            );


        if (!button) {

            button =
                document.createElement('button');

            button.id =
                'full-video-site-dark-toggle';

            button.type =
                'button';


            document.body.appendChild(
                button
            );
        }


        function updateButton() {

            const isDark =
                document.body.classList.contains(
                    'dark-mode'
                );


            button.textContent =
                isDark
                    ? '☀️ 淺色模式'
                    : '🌙 深色模式';
        }


        updateButton();


        if (
            !button.dataset.initialized
        ) {

            button.dataset.initialized =
                'true';


            button.addEventListener(
                'click',
                () => {

                    const isDark =
                        document.body.classList.toggle(
                            'dark-mode'
                        );


                    localStorage.setItem(
                        STORAGE_KEY,
                        String(isDark)
                    );


                    updateButton();

                }
            );
        }
    }


    // =========================================================
    // Fetch Override
    // =========================================================

    function setupFetchOverride() {

        if (
            window.__FULL_VIDEO_FETCH_HOOKED__
        ) {
            return;
        }


        const originalFetch =
            window.fetch;


        if (
            typeof originalFetch !==
            'function'
        ) {

            console.warn(
                `${PREFIX} window.fetch 不存在`
            );

            return;
        }


        window.__FULL_VIDEO_FETCH_HOOKED__ =
            true;


        window.fetch =
            async function (...args) {

                let url = '';


                try {

                    if (
                        typeof args[0] ===
                        'string'
                    ) {

                        url = args[0];

                    } else if (
                        args[0] &&
                        typeof args[0].url ===
                        'string'
                    ) {

                        url =
                            args[0].url;
                    }

                } catch (error) {

                    console.warn(
                        `${PREFIX} 讀取 fetch URL 失敗`,
                        error
                    );
                }


                if (
                    url.includes(
                        '/api/live-chat/messages'
                    )
                ) {

                    console.log(
                        `${PREFIX} 攔截 live-chat API`,
                        url
                    );


                    return new Response(

                        JSON.stringify({
                            ok: true,
                            messages: []
                        }),

                        {
                            status: 200,

                            headers: {
                                'Content-Type':
                                    'application/json'
                            }
                        }
                    );
                }


                return originalFetch.apply(
                    this,
                    args
                );
            };


        console.log(
            `${PREFIX} fetch override 已安裝`
        );
    }


    // =========================================================
    // DOM Debug
    // =========================================================

    function scanDOM() {

        const result = {};

        let foundSomething = false;


        for (
            const [name, selector]
            of Object.entries(SELECTORS)
        ) {

            const element =
                document.querySelector(
                    selector
                );


            result[name] =
                Boolean(element);


            if (element) {
                foundSomething = true;
            }
        }


        console.groupCollapsed(
            `${PREFIX} DOM 掃描`
        );


        for (
            const [name, found]
            of Object.entries(result)
        ) {

            console.log(
                `${found ? '✅' : '❌'} ${name}:`,
                SELECTORS[name]
            );
        }


        console.groupEnd();


        return foundSomething;
    }


    // =========================================================
    // Shadow DOM 掃描
    // =========================================================

    function scanShadowRoots(root) {

        if (!root) {
            return;
        }


        const elements =
            root.querySelectorAll('*');


        for (
            const element
            of elements
        ) {

            if (
                element.shadowRoot
            ) {

                console.log(
                    `${PREFIX} 發現 Shadow DOM:`,
                    element
                );


                for (
                    const selector
                    of Object.values(
                        SELECTORS
                    )
                ) {

                    if (
                        element.shadowRoot
                            .querySelector(
                                selector
                            )
                    ) {

                        console.log(
                            `${PREFIX} Shadow DOM 找到:`,
                            selector
                        );
                    }
                }


                scanShadowRoots(
                    element.shadowRoot
                );
            }
        }
    }


    // =========================================================
    // 動態 DOM Observer
    // =========================================================

    let scanTimer = null;


    function scheduleDOMScan() {

        if (scanTimer) {
            return;
        }


        scanTimer =
            setTimeout(() => {

                scanTimer = null;

                scanDOM();

            }, 100);
    }


    function setupDOMObserver() {

        const observer =
            new MutationObserver(
                (mutations) => {

                    let hasAddedNodes =
                        false;


                    for (
                        const mutation
                        of mutations
                    ) {

                        if (
                            mutation.addedNodes &&
                            mutation.addedNodes.length
                        ) {

                            hasAddedNodes =
                                true;

                            break;
                        }
                    }


                    if (
                        hasAddedNodes
                    ) {

                        scheduleDOMScan();
                        
                    }
                }
            );


        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );


        console.log(
            `${PREFIX} DOM Observer 已啟動`
        );
    }


    // =========================================================
    // SPA History Hook
    // =========================================================

    function setupSPAHook() {

        const originalPushState =
            history.pushState;


        const originalReplaceState =
            history.replaceState;


        function routeChanged() {

            console.log(
                `${PREFIX} SPA 路由變更:`,
                location.href
            );


            setTimeout(() => {

                scanDOM();

                if (document.body) {
                    setupDarkMode();
                }

            }, 100);
        }


        history.pushState =
            function (...args) {

                const result =
                    originalPushState.apply(
                        this,
                        args
                    );


                routeChanged();


                return result;
            };


        history.replaceState =
            function (...args) {

                const result =
                    originalReplaceState.apply(
                        this,
                        args
                    );


                routeChanged();


                return result;
            };


        window.addEventListener(
            'popstate',
            routeChanged
        );


        window.addEventListener(
            'hashchange',
            routeChanged
        );


        console.log(
            `${PREFIX} SPA Hook 已啟動`
        );
    }


    // =========================================================
    // iframe 監控
    // =========================================================

    function setupIframeDetection() {

        const observer =
            new MutationObserver(
                (mutations) => {

                    for (
                        const mutation
                        of mutations
                    ) {

                        for (
                            const node
                            of mutation.addedNodes
                        ) {

                            if (
                                node.nodeType !== 1
                            ) {
                                continue;
                            }


                            if (
                                node.tagName ===
                                'IFRAME'
                            ) {

                                console.log(
                                    `${PREFIX} 發現 iframe:`,
                                    node.src
                                );
                            }
                        }
                    }
                }
            );


        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );
    }


    // =========================================================
    // 初始化
    // =========================================================

    // CSS 立即注入
    injectCSS();


    // Fetch 儘早 Hook
    setupFetchOverride();


    // SPA
    setupSPAHook();


    // iframe
    setupIframeDetection();


;

    // Body 出現後
    whenBodyReady(() => {

        console.log(
            `${PREFIX} body 已準備完成`
        );


        setupDarkMode();


        scanDOM();


        setupDOMObserver();


        console.log(
            `${PREFIX} 初始化完成`
        );
    });



})();


