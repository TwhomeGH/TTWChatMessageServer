// 目前此檔不再使用，已合併到 TikTok.js 中
// 可以參考此檔的內容來撰寫新的測試按鈕功能，或直接在 TikTok.js 中新增相關功能

// import { createServer } from 'http';
// import { Socket } from 'net';

// import { config } from 'dotenv';

// config(); // 讀取 .env 檔案

// var isEnd=false


// // node 內建：process.argv
// // argv[0] = node 路徑 / user?
// // argv[1] = TikTok.js 路徑
// // argv[2] 開始才是你傳的參數

// const args = process.argv.slice(2)

// // 你要的後綴參數
// const keyword = args[0] || ''

// let isRepeat = args.includes('--repeat')
// let isDelay = args.includes('--delay')

// // ===== 設定開關 =====
// let enableDuplicateCheck = isRepeat;   // 是否啟用重複檢查
// let enableDelayCheck = isDelay;       // 是否延遲 2 秒檢查

// async function handleExit() {
  
//     isEnd=true

//     server.close((e) =>{
//         if(e) {
//             console.error("HTTP Server 關閉失敗:", e.message);
//         }
//     });


//     console.log("✅ 優雅退出完成");

//     process.exit(0);
// }


// process.stdin.on('data', async (data) => {
//     const msg = data.toString().trim();
//     if (msg === 'EXIT') {
//         console.log('[SYSTEM] Received EXIT command via stdin');
//         await handleExit(); // 可以完整 await
//     }
// });

// process.on("SIGINT", async () => {
//     await handleExit();
// });

// process.on("SIGTERM", async () => {
//     console.log("Received SIGTERM, exiting gracefully...");
//     await handleExit();
// });




// /**********************
//  * 🌐 HTTP Server
//  **********************/
// const server = createServer((req, res) => {

//    // ===============================
//    // 該區段已不再需要 已合併到TikTok.js/Server.js中
//    /**********************
//     * /chat 主入口
//     **********************/
// });

// server.listen(3001, () => {
//     console.log("🚀 HTTP Server 3001 啟動");
// });
