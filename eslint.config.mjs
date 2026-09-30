import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

// 專案混用模組格式：ScriptLib 的 .cjs 與 Server.js 是 CommonJS，
// 其餘根目錄與 SignServer 的 .js 是 ESM（由 Node 動態 import 載入）。
const esmFiles = [
  "AutoClip.js",
  "EmojiMap.js",
  "FilterRules.custom.js",
  "FilterRules.custom.example.js",
  "MessageFilter.js",
  "TikTok.js",
  "TranslateTest.js",
  "OtherTool/FixMD_Table.js",
  "SignServer/config.js",
  "SignServer/index.js",
];

export default defineConfig([
  // SignServer/sdk 是第三方壓縮 SDK、Docs/*.js 是打包參考樣本，皆不屬於本專案原始碼。
  { ignores: ["**/node_modules/**", "Docs/patched-plugins/**", "Docs/*.js", "SignServer/sdk/**", "output/**", ".playwright-cli/**", "logs/**", "data/**", "cache/**"] },
  { files: ["**/*.{js,mjs,cjs}"], extends: [js.configs.recommended] },
  // 允許以 _ 開頭明確標示「刻意不使用」，並忽略解構時為了排除某欄位而取出的 rest 兄弟。
  { files: ["**/*.{js,mjs,cjs}"], rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }] } },
  { files: ["**/*.{js,cjs}"], ignores: ["assets/**", "UserScript/**"], languageOptions: { sourceType: "commonjs", globals: globals.node } },
  { files: esmFiles, languageOptions: { sourceType: "module", globals: globals.node } },
  { files: ["**/*.mjs"], languageOptions: { sourceType: "module", globals: globals.node } },
  // Puppeteer 腳本在 page.evaluate 內執行瀏覽器程式碼；assets 另外使用 Chart.js。
  { files: ["SignServer/direct-signer.mjs", "Test/capture.mjs", "Test/puppeteer.mjs", "Test/frontier.mjs"], languageOptions: { globals: globals.browser } },
  { files: ["assets/**/*.js"], languageOptions: { sourceType: "script", globals: { ...globals.browser, Chart: "readonly" } } },
  // Shared translation helpers are deliberately usable in Node tests as well.
  { files: ["assets/i18n.js"], languageOptions: { globals: { module: "readonly" } } },
  {
    files: ["UserScript/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, GM_getValue: "readonly", GM_setValue: "readonly",
        GM_openInTab: "readonly", GM_xmlhttpRequest: "readonly", GM_addStyle: "readonly" },
    },
  },
]);
