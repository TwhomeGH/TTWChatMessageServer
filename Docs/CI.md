# CI（GitHub Actions）

## 流程

| Workflow | 觸發 | 內容 |
| --- | --- | --- |
| `.github/workflows/core-tests.yml` | push main、PR、手動 | Ubuntu／Windows × Node 24／latest 的 core、startup、CSS 與 Python socket 測試 |
| `.github/workflows/pages.yml` | push main、手動 | TypeDoc API、changelogkit 匯出與 GitHub Pages 部署 |
| `.github/workflows/codeql.yml` | 依 GitHub 設定 | CodeQL 掃描 |

## Action runtime

GitHub Actions 的 JavaScript action 必須使用 Node 24 runtime，避免 Node 20 淘汰警告與強制升級：

| Action | 版本 | Runtime |
| --- | --- | --- |
| `actions/cache` | v5 | node24 |
| `actions/github-script` | v8 | node24 |
| `actions/checkout` | v5／v7 | node24 |
| `actions/setup-node` | v6 | node24 |
| `actions/setup-python` | v6／v7 | node24 |
| `actions/configure-pages` | v6 | node24 |
| `actions/deploy-pages` | v5 | node24 |

`actions/cache@v5` 與 `actions/github-script@v8` 需要 Actions Runner `2.327.1` 以上；GitHub-hosted runner 已符合。

## 依賴快取

CI 不使用每次重新下載的 `npm ci` 當唯一來源；分成兩層：

1. `actions/setup-node` 的 `cache: npm`：保留 npm tarball 快取。
2. `actions/cache` 的 `node_modules`：key 包含作業系統、CPU 架構、解析後的 Node 版本、`package-lock.json` 與 `package.json`。
   - 精確命中時跳過 `npm ci`。
   - 未命中時執行 `npm ci --prefer-offline`，成功後由 Actions 儲存新的 `node_modules`。
   - 因此只有套件清單或 Node 版本真的改變時才會重新安裝。

Pages 的 `changelogkit` 另用 pip 快取；`key` 帶 `github.run_id`，每次執行仍可保存最新 wheel，`restore-keys` 接續前一次。

## 快取失效與清理

快取是 branch 範圍，PR 可讀取預設分支快取。下列情況會自然失效：

- `package-lock.json` 或 `package.json` 變更
- Node 版本變更（key 使用 `setup-node` 解析後的版本，不是 `24.x` 字串）
- 作業系統或架構不同
- Actions 快取超過保存期限或被容量淘汰

若快取內容損壞，到 GitHub **Actions → Caches** 刪除對應 key 後重跑；不要用 `npm ci --force` 當常態修法。

## 驗證 workflow 語法

```bash
python -c "import yaml, pathlib; [yaml.safe_load(pathlib.Path(p).read_text(encoding='utf-8')) for p in ['.github/workflows/core-tests.yml','.github/workflows/pages.yml']]; print('YAML OK')"
```
