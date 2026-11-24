# API 參考

`/api-docs/typedoc/` 是 TypeDoc 從 JSDoc 產生的程式碼 API 參考，由 changelogkit 靜態站掛載。

## 產生

```bash
npm run docs:api
```

輸出：

```text
build/api/
```

`build/` 是產物目錄，已列入 `.gitignore`，不要提交。

## changelogkit 掛載

`.changelog.toml`：

```toml
[[tool.changelog.api]]
id = "typedoc"
title = "API 參考"
kind = "typedoc"
html = "build/api"
mount = "typedoc"
embed = true
```

先產生 API，再匯出：

```bash
npm run docs:api
changelogkit export _site --branch main
```

changelogkit 會把 `build/api` 複製到 `_site/api-docs/typedoc/`，並在網站導覽加入「API 參考」。`build/api` 不可放在 `_site` 內，否則匯出前的清理會刪掉產物。

## TypeDoc 設定

- `typedoc.json`：入口、輸出目錄、驗證開關
- `tsconfig.typedoc.json`：`allowJs`、`checkJs:false`、CommonJS／ESM 混合設定

目前入口包含：

```text
ScriptLib/**/*.cjs
ScriptLib/**/*.mjs
Server.js
TikTok.js
```

JSDoc 的 `@param`、`@returns`、`@typedef` 會顯示在站上；沒有標註的私有實作仍可能出現在 TypeDoc 的模組頁面，這是 `excludeNotDocumented: false` 的結果。

## GitHub Pages

`.github/workflows/pages.yml` 會在匯出前：

1. `npm ci --ignore-scripts`
2. `npm run docs:api`
3. `changelogkit export _site --branch main`

因此 Pages 上的 API 參考和變更歷史使用同一份建置流程。

## 限制

- 這是程式碼 API 參考，不是 HTTP OpenAPI 文件；`/chat`、`/api/*` 的 HTTP 契約仍以 `Docs/CHAT_API.md`、`Docs/LOGS.md` 等文件為準。
- TypeDoc 需要 `typedoc` 與 `typescript` 開發相依；只部署網站時仍要安裝 devDependencies。
