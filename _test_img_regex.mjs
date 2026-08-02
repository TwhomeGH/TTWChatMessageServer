// 測試 G#Ad 頭像自動偵測的正規表示式（TikTok.js handleGAd 的 B 邏輯）
const IMG_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[\w=&.,-]*)?$/i;

const cases = [
  // [輸入, 預期是否為圖片網址]
  ['https://github.com/TwhomeGH/TTWChatMessageServer/blob/main/Emoji/Neuro2.png?raw=true', true],
  ['https://example.com/logo.png', true],
  ['https://static-cdn.jtvnw.net/jtv_user_pictures/xx-profile_image-300x300.png', true],
  ['https://example.com/photo.JPG?x=1', true],
  ['https://example.com/shop', false],
  ['https://example.com/', false],
  ['訂閱主播', false],
  ['哈基米', false],
];

let fail = 0;
for (const [input, expected] of cases) {
  const got = IMG_URL_RE.test(input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗ 預期' + expected} ${got ? 'IMG' : 'text'} → ${input}`);
}
console.log(fail === 0 ? '\n全部通過' : `\n${fail} 個失敗`);
process.exit(fail === 0 ? 0 : 1);
