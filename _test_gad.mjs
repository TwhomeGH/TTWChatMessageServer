// 模擬 G#Ad 完整解析流程（TikTok.js handleGAd 的 token 過濾 + B 自動偵測 + A 保留 + C 存已解析值）
// 用法：node _test_gad.mjs

const IMG_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[\w=&.,-]*)?$/i;

function parseGAd(messageText, iconFallback) {
  let iconURL = messageText.includes("icon=") ? messageText.split("icon=")[1].split(" ")[0] : null;
  let res = messageText.split(" ");

  const useTTS = messageText.toLowerCase().includes("tts");
  let overlayUser = 'chatterName';
  const userValue = messageText.includes("user=") ? messageText.split("user=")[1].split(" ")[0] : null;
  if (userValue) overlayUser = userValue;

  let intervalMinutes = 0;
  const rawInterval = messageText.includes("interval=") ? parseInt(messageText.split("interval=")[1].split(" ")[0]) : 0;
  if (!isNaN(rawInterval) && rawInterval > 0) intervalMinutes = Math.max(15, rawInterval);

  res = res.filter(e => { const l = e.toLowerCase(); return l !== "tts" && l !== "usetts"; });
  for (const key of ['icon=', 'user=', 'interval=', 'id=']) {
    const idx = res.findIndex(e => e.startsWith(key));
    if (idx !== -1) res.splice(idx, 1);
  }
  res.shift(); // 去掉 G#Ad

  // B: 無 icon= 時自動偵測圖片網址當頭像，並從文字移除
  if (!iconURL) {
    const imgIdx = res.findIndex(t => IMG_URL_RE.test(t));
    if (imgIdx !== -1) { iconURL = res[imgIdx]; res.splice(imgIdx, 1); }
  }
  const displayIcon = iconURL || iconFallback;
  const lastMsg = res.join(" ");

  return { iconURL, displayIcon, lastMsg, overlayUser, useTTS, intervalMinutes };
}

let fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${got}${ok ? '' : ' （預期 ' + expected + '）'}`);
}

// 案例 1：用戶實際場景 — 文字內貼圖片網址 → 自動當頭像並從文字移除
{
  const r = parseGAd('G#Ad 訂閱主播 哈基米  https://github.com/TwhomeGH/TTWChatMessageServer/blob/main/Emoji/Neuro2.png?raw=true', 'twitch-avatar');
  check('case1 lastMsg', r.lastMsg, '訂閱主播 哈基米 ');
  check('case1 iconURL', r.iconURL, 'https://github.com/TwhomeGH/TTWChatMessageServer/blob/main/Emoji/Neuro2.png?raw=true');
  check('case1 displayIcon', r.displayIcon, r.iconURL);
}

// 案例 2：明確 icon= 參數優先，文字中圖片網址不被移除
{
  const r = parseGAd('G#Ad 歡迎光臨 https://example.com/banner.png icon=https://example.com/logo.png', 'twitch-avatar');
  check('case2 iconURL (icon= 優先)', r.iconURL, 'https://example.com/logo.png');
  check('case2 lastMsg 保留文字網址', r.lastMsg, '歡迎光臨 https://example.com/banner.png');
}

// 案例 3：都沒給 → 回退 Twitch 頭貼
{
  const r = parseGAd('G#Ad 歡迎來我的頻道逛逛！', 'twitch-avatar');
  check('case3 iconURL null', r.iconURL, null);
  check('case3 displayIcon fallback', r.displayIcon, 'twitch-avatar');
  check('case3 lastMsg', r.lastMsg, '歡迎來我的頻道逛逛！');
}

// 案例 4：A — 更新時沒帶 icon 保留舊頭像；C — 有帶則存已解析值
{
  let ad = { iconURL: 'https://example.com/old-logo.png' };
  const rNoIcon = parseGAd('G#Ad 新優惠訊息！ id=0', 'twitch-avatar');
  ad.iconURL = rNoIcon.iconURL ? rNoIcon.displayIcon : (ad.iconURL || rNoIcon.displayIcon);
  check('case4 保留舊頭像', ad.iconURL, 'https://example.com/old-logo.png');

  let ad2 = { iconURL: null };
  const rNewIcon = parseGAd('G#Ad 更新！ icon=https://example.com/new.png', 'twitch-avatar');
  ad2.iconURL = rNewIcon.iconURL ? rNewIcon.displayIcon : (ad2.iconURL || rNewIcon.displayIcon);
  check('case4 更新頭像', ad2.iconURL, 'https://example.com/new.png');
}

console.log(fail === 0 ? '\n全部通過' : `\n${fail} 個失敗`);
process.exit(fail === 0 ? 0 : 1);
