/**
 * 套用 TikTok Live 插件修補
 *
 * 從 Docs/patched-plugins/ 複製修補檔案到 node_modules/ 對應位置。
 * 使用方式：
 *   node Docs/apply-patches.mjs
 *
 * 若要修改插件：編輯 Docs/patched-plugins/* 內的檔案，然後執行本腳本同步到 node_modules。
 */

import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PLUGINS_DIR = join(__dirname, 'patched-plugins');

const plugins = ['tiktok-signature', 'tiktok-live-connector', 'kick-wss'];

let totalCopied = 0;
let totalSkipped = 0;
let errors = [];

function copyRecursive(srcDir, destDir) {
  if (!existsSync(srcDir)) {
    errors.push(`❌ 找不到來源目錄: ${srcDir}`);
    return;
  }
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    // Skip hidden dirs and cache
    if (entry.isDirectory() && (entry.name.startsWith('.') || entry.name === '__pycache__' || entry.name === 'node_modules')) {
      continue;
    }
    // Skip browser profile cache when copying tiktok-signature
    if (srcDir.includes('tiktok-signature') && entry.isDirectory() && entry.name === '.chrome-profile') {
      continue;
    }

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
      totalCopied++;
    }
  }
}

for (const plugin of plugins) {
  const srcDir = join(PLUGINS_DIR, plugin);
  const destDir = join(PROJECT_ROOT, 'node_modules', plugin);
  console.log(`📦 ${plugin}...`);
  copyRecursive(srcDir, destDir);
}

console.log(`\n已複製 ${totalCopied} 個檔案`);
if (totalSkipped > 0) console.log(`略過 ${totalSkipped} 個快取/隱藏目錄`);
if (errors.length > 0) {
  console.log('錯誤：');
  for (const err of errors) console.log(`  ${err}`);
}
