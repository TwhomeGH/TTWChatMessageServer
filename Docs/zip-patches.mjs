/**
 * 自動產生修補套件 ZIP
 *
 * 從 Docs/patched-plugins/ 目錄打包成 Docs/*_patched_v2.zip
 * 使用方式：node Docs/zip-patches.mjs
 */

import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const PLUGINS_DIR = join(__dirname, 'patched-plugins');

const packages = ['tiktok-signature', 'tiktok-live-connector', 'kick-wss'];

for (const pkg of packages) {
  const srcDir = join(PLUGINS_DIR, pkg);
  const zipPath = join(__dirname, `${pkg}_patched_v2.zip`);

  if (!existsSync(srcDir)) {
    console.error(`❌ 找不到 ${srcDir}`);
    continue;
  }

  // Remove old zip if exists
  if (existsSync(zipPath)) rmSync(zipPath);

  try {
    execSync(
      `powershell -Command "Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipPath}' -Force"`,
      { stdio: 'pipe' }
    );
    console.log(`✅ ${pkg}_patched_v2.zip`);
  } catch (e) {
    console.error(`❌ ${pkg}: ${e.message}`);
  }
}

console.log('\n完成。');
