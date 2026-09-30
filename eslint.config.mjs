import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["**/node_modules/**", "Docs/patched-plugins/**", "output/**", ".playwright-cli/**", "logs/**", "data/**", "cache/**"] },
  { files: ["**/*.{js,mjs,cjs}"], extends: [js.configs.recommended] },
  {
    files: ["**/*.{js,cjs}"], ignores: ["assets/**", "UserScript/**"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  { files: ["**/*.mjs"], languageOptions: { sourceType: "module", globals: globals.node } },
  { files: ["assets/**/*.js"], languageOptions: { sourceType: "script", globals: globals.browser } },
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
