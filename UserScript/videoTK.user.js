// ==UserScript==
// @name         TikTok Video Info Overlay (Dual)
// @namespace    pip-chat-test
// @version      1.3
// @description  顯示 video 原始解析度和頁面顯示尺寸，既掛 body 也掛 live-room-content
// @match        https://www.tiktok.com/*
// @grant        none


// @updateURL    https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/videoTK.user.js
// @downloadURL  https://raw.githubusercontent.com/TwhomeGH/TTWChatMessageServer/main/UserScript/videoTK.user.js

// @run-at document-start

// ==/UserScript==



(function() {
    'use strict';
    
    
    
    const removeMeta = () => {
    document
      .querySelectorAll('meta[name="apple-itunes-app"]')
      .forEach(m => m.remove());
  };

  removeMeta();

  new MutationObserver(removeMeta).observe(document.documentElement, {
    childList: true,
    subtree: true
  });

    let infoDiv = null;       // 原本掛 body 的
    let infoDivLive = null;   // 新增掛 live-room-content 的
    let lastVideo = null;

    function createInfoDiv() {
        const div = document.createElement("div");
        div.style.position = "fixed";
        div.style.backgroundColor = "rgba(0,0,0,0.6)";
        div.style.color = "white";
        div.style.fontSize = "12px";
        div.style.padding = "4px 6px";
        div.style.borderRadius = "4px";
        div.style.zIndex = 9999;
        div.style.pointerEvents = "none";
        return div;
    }

    

    function updateInfo(video) {
        if (!infoDiv) {
            infoDiv = createInfoDiv();
            document.body.appendChild(infoDiv);
        }

        const rect = video.getBoundingClientRect();
        const renderedWidth = video.clientWidth;
        const renderedHeight = video.clientHeight;
        const originalWidth = video.videoWidth;
        const originalHeight = video.videoHeight;

        infoDiv.textContent = `Render: ${renderedWidth}×${renderedHeight} | Original: ${originalWidth}×${originalHeight}`;
        infoDiv.style.top = `${rect.top + 2}px`;
        infoDiv.style.left = `${rect.right - infoDiv.offsetWidth - 8}px`;
    }

    function createInfoDivLive(container) {
    const div = document.createElement("div");
    div.style.position = "absolute"; // 相對於 container
    div.style.top = "0px";
    div.style.left = "0px";
    div.style.backgroundColor = "rgba(0,0,0,0.6)";
    div.style.color = "white";
    div.style.fontSize = "12px";
    div.style.padding = "4px 6px";
    div.style.borderRadius = "4px";
    div.style.zIndex = 9999;
    div.style.pointerEvents = "none"; // 不阻塞點擊
    div.style.width = "max-content";
    div.style.transform = "translateZ(0)"; // 提升渲染層
    container.appendChild(div);
    return div;
}

function updateInfoLive(video, container) {
    if (!infoDivLive) {
        infoDivLive = createInfoDivLive(container);
    }

    const rect = video.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const renderedWidth = video.clientWidth;
    const renderedHeight = video.clientHeight;
    const originalWidth = video.videoWidth;
    const originalHeight = video.videoHeight;

    infoDivLive.textContent = `Render: ${renderedWidth}×${renderedHeight} | Original: ${originalWidth}×${originalHeight}`;

    // 絕對定位相對於 container
    infoDivLive.style.top = `${rect.top - containerRect.top + 42}px`;
    infoDivLive.style.left = `${rect.right - containerRect.left - infoDivLive.offsetWidth - 8}px`;
}
    function checkVideo() {
        const container = document.querySelector('[data-e2e="live-room-content"]');
        const video = document.querySelector("video");
        if (!video) return;
        
        if (video !== lastVideo) {
            if (infoDiv) infoDiv.remove();
            if (infoDivLive) infoDivLive.remove();
            infoDiv = null;
            infoDivLive = null;
            lastVideo = video;
            
        }

        if (video.videoWidth && video.videoHeight) {
            video.muted = false;
            video.volume = 1;

            updateInfo(video);

            if (container) {
                
                                // 從 body 移除
                if (document.body.contains(infoDiv)) {
                    document.body.removeChild(infoDiv);
                }
                updateInfoLive(video, container);
                
            }
        }
    }
    
        
    
    function createFloatingButton() {
    if (document.getElementById('my-floating-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'my-floating-btn';
    btn.textContent = 'OFF'; // 預設狀態文字

    let enabled = false; // 👉 toggle 狀態

    // 樣式
    btn.style.position = 'fixed';
    btn.style.right = '16px';
    btn.style.bottom = '16px';
    btn.style.width = '48px';
    btn.style.height = '48px';
    btn.style.borderRadius = '50%';
    btn.style.background = 'rgba(0,0,0,0.6)';
    btn.style.color = '#fff';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.fontSize = '14px';
    btn.style.cursor = 'pointer';
    btn.style.zIndex = 99999;
    btn.style.userSelect = 'none';
    btn.style.backdropFilter = 'blur(4px)';

    btn.addEventListener('click', () => {
        enabled = !enabled; // 🔁 切換狀態

        // UI 顯示狀態（可改）
        btn.textContent = enabled ? 'ON' : 'OFF';
        btn.style.background = enabled
            ? 'rgba(0,150,0,0.7)'
            : 'rgba(0,0,0,0.6)';

        if (enabled) {
            // =========================
            // 👉 ON 狀態邏輯放這裡
            // 例如：
            // expandLiveContent();
            // showInfoDivLive();
            // =========================


            //隱藏
            document.querySelectorAll('.tiktok-1w5o2is').forEach(el => {
                el.style.display = 'none';
            });
            
            
            // 選取 live-chat-container 元素
            const chatContainer = document.querySelector('[data-e2e="live-chat-container"]');
            
            if (chatContainer) {
                // 取得父元素
                const parent = chatContainer.parentElement;
                
                if (parent) {
                    // 隱藏父元素（包含 chatContainer 和它下面所有內容）
                    parent.style.display = 'none';
                } else {
                    // 沒有父元素就隱藏自己
                    chatContainer.style.display = 'none';
                }
            }
            
            const liveContent = document.querySelector('[data-e2e="live-content-container"]');

            if (liveContent) {
                liveContent.style.width = '100%';
            }
            
            
            //live-header-container
            //data-e2e="live-header-container"
            //隱藏用戶名關注分享常駐橫幅（全螢幕左右排版移除後（右下on/off開關）
            const UserContent = document.querySelector('[data-e2e="live-header-container"]');
            
            if (UserContent) {
                UserContent.style.display="none"
            }
            
        } else {
            // =========================
            // 👉 OFF 狀態邏輯放這裡
            // 例如：
            // restoreLiveContent();
            // hideInfoDivLive();
            // =========================


             //復原
            document.querySelectorAll('.tiktok-1w5o2is').forEach(el => {
                el.style.display = 'block';
            });

        // 選取 live-chat-container 元素 復原
        const chatContainer = document.querySelector('[data-e2e="live-chat-container"]');
        
        if (chatContainer) {
            // 取得父元素
            const parent = chatContainer.parentElement;
            
            if (parent) {
                // 隱藏父元素（包含 chatContainer 和它下面所有內容）
                parent.style.display = 'flex';
            } else {
                // 沒有父元素就隱藏自己
                chatContainer.style.display = 'flex';
            }
        }
        //復原右邊
        const liveContent = document.querySelector('[data-e2e="live-content-container"]');
        
        if (liveContent) {
            liveContent.style.width = 'calc(100% - 327px)';
        }
        
        //live-header-container
        //data-e2e="live-header-container"
        //隱藏用戶名關注分享常駐橫幅（全螢幕左右排版移除後（右下on/off開關）
        const UserContent = document.querySelector('[data-e2e="live-header-container"]');
        
        if (UserContent) {
            UserContent.style.display="block"
        }
        
        }
    });

    document.body.appendChild(btn);
}


function hiddenGift() {
    
    //data-e2e="gift-container"
    //隱藏禮物
    const GiftContent = document.querySelector('[data-e2e="gift-container"]');
    
    if (GiftContent) {
        GiftContent.style.display="none"
        console.log("隱藏禮物🎁")
    }
    
}

function removeOpenAppBanner() {
    const banner = document.querySelector('[data-e2e="open-app-banner"]');
    if (banner) {
        banner.remove();
    }
}


  
    removeOpenAppBanner()
    
    setInterval(checkVideo, 200);
    setTimeout(()=>{
        createFloatingButton()
        hiddenGift()
        removeOpenAppBanner()
      }  , 1000);
    
    
})();