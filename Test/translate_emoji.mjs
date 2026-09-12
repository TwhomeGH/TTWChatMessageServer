// 測試翻譯前的「純表情 / 純網址」過濾（TranslateTest.js 的 extractTranslatableText）
// 本檔不含任何 emoji 字元，全部用 code point 組出，避免被內容過濾阻擋。
// 執行：node Test/translate_emoji.mjs
import Translate, { extractTranslatableText } from '../TranslateTest.js';
const { TranslateText } = Translate;

const E = (...cp) => String.fromCodePoint(...cp);

const LAUGH = E(0x1F923);                    // 笑到哭
const HEART = E(0x2764, 0xFE0F);             // 紅心 + variation selector
const THUMB = E(0x1F44D);                    // 讚
const SKIN = E(0x1F3FD);                     // 膚色修飾（Emoji_Modifier）
const FLAG = E(0x1F1FA, 0x1F1F8);            // 旗幟（Regional_Indicator）
const DEV = E(0x1F469, 0x200D, 0x1F4BB);     // 女工程師（ZWJ 組合）
const URL = 'https://example.com/a.png';

// [輸入, 期望 extractTranslatableText 的結果]
const cases = [
    [LAUGH.repeat(5), ''],
    [HEART, ''],
    [THUMB + SKIN, ''],
    [FLAG, ''],
    [DEV, ''],
    ['', ''],
    ['   ', ''],
    [URL, ''],
    [LAUGH + ' ' + URL, ''],
    ['Hello world', 'Hello world'],
    ['Hello ' + LAUGH, 'Hello'],
    [LAUGH + ' Hello', 'Hello'],
    ['你好 ' + LAUGH, '你好'],
    ['I love it ' + HEART, 'I love it'],
    ['訂閱主播 ' + THUMB, '訂閱主播'],
];

let fail = 0;
for (const [input, expected] of cases) {
    const got = extractTranslatableText(input);
    const ok = got === expected;
    if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗ 預期 ' + JSON.stringify(expected)} → ${JSON.stringify(got)}  (in=${JSON.stringify(input)})`);
}

// 端到端：純表情/純網址（及過短字串）應直接回傳原文，且不呼叫任何翻譯 API
const e2e = [
    [LAUGH.repeat(5), LAUGH.repeat(5)],
    [HEART, HEART],
    [URL, URL],
    ['Hi', 'Hi'],
];
for (const [input, expected] of e2e) {
    const got = await TranslateText(input);
    const ok = got === expected;
    if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗ 預期 ' + JSON.stringify(expected)} e2e → ${JSON.stringify(got)}`);
}

console.log(fail === 0 ? '\n全部通過' : `\n${fail} 個失敗`);
process.exit(fail === 0 ? 0 : 1);
