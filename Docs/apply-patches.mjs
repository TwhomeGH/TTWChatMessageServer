/**
 * 套用最小差異修補（patch）
 *
 * 依「已安裝版本」尋找 Docs/patches/<套件>/<版本>.patch，用 `git apply` 從套件根目錄套用。
 * 若已安裝版本與 patch 不符、或檔案內容已變動，會明確報錯而不是硬蓋。
 *
 * 用法：
 *   node Docs/apply-patches.mjs            # 套用（已套用則略過）
 *   node Docs/apply-patches.mjs --check    # 只檢查，不修改
 *   node Docs/apply-patches.mjs --revert   # 還原
 *
 * 修改套件後要更新 patch：
 *   node Docs/make-patches.mjs
 *
 * 註：node_modules 被 .gitignore 忽略，`git apply` 預設會「Skipped patch」，
 *     因此這裡用一個空的暫時 repo（GIT_DIR）搭配指向套件目錄的 GIT_WORK_TREE 繞過忽略規則。
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const NODE_MODULES = join(PROJECT_ROOT, 'node_modules');
const PATCHES_DIR = join(__dirname, 'patches');

// 需要維護修補的套件（tiktok-signature 執行期只用 javascript/ SDK，無需修補）
const PACKAGES = ['tiktok-live-connector', 'kick-wss'];

const args = process.argv.slice(2);
const MODE = args.includes('--revert') ? 'revert' : args.includes('--check') ? 'check' : 'apply';

// 建立空的暫時 git repo，用來避開 node_modules 的 gitignore 規則
const TMP_REPO = mkdtempSync(join(tmpdir(), 'apply-patches-'));
const TMP_GIT_DIR = join(TMP_REPO, '.git');
{
    const init = spawnSync('git', ['init', '-q'], { cwd: TMP_REPO, encoding: 'utf8' });
    if (init.error || init.status !== 0) {
        console.error('❌ 需要 git 才能套用 patch：', init.error?.message || init.stderr);
        process.exit(1);
    }
}
process.on('exit', () => {
    try { rmSync(TMP_REPO, { recursive: true, force: true }); } catch { /* ignore */ }
});

function gitApply(pkgDir, patchFile, extra) {
    return spawnSync(
        'git',
        ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false',
            'apply', '-p1', '--whitespace=nowarn', ...extra, '--', patchFile],
        {
            cwd: pkgDir,
            encoding: 'utf8',
            env: { ...process.env, GIT_DIR: TMP_GIT_DIR, GIT_WORK_TREE: pkgDir },
        }
    );
}

let failures = 0;

for (const pkg of PACKAGES) {
    const pkgDir = join(NODE_MODULES, pkg);
    if (!existsSync(pkgDir)) {
        console.error(`❌ ${pkg} 未安裝，請先 npm install`);
        failures++;
        continue;
    }

    const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
    const patchFile = join(PATCHES_DIR, pkg, `${version}.patch`);
    if (!existsSync(patchFile)) {
        console.error(`❌ ${pkg}@${version} 找不到對應的 patch：${patchFile}`);
        console.error('   已安裝版本與 patch 不符，請確認版本或執行 node Docs/make-patches.mjs 重新產生。');
        failures++;
        continue;
    }

    const canApply = gitApply(pkgDir, patchFile, ['--check']).status === 0;
    const canRevert = gitApply(pkgDir, patchFile, ['--check', '-R']).status === 0;

    if (MODE === 'check') {
        if (canApply) console.log(`✅ ${pkg}@${version} 可套用`);
        else if (canRevert) console.log(`ℹ️ ${pkg}@${version} 已套用`);
        else {
            console.error(`❌ ${pkg}@${version} 無法套用（版本或內容不符）`);
            failures++;
        }
        continue;
    }

    if (MODE === 'revert') {
        if (!canRevert) {
            console.error(`❌ ${pkg}@${version} 無法還原（可能尚未套用）`);
            failures++;
            continue;
        }
        const r = gitApply(pkgDir, patchFile, ['-R']);
        if (r.status === 0) console.log(`↩️ ${pkg}@${version} 已還原`);
        else {
            console.error(`❌ ${pkg} 還原失敗:\n${r.stderr}`);
            failures++;
        }
        continue;
    }

    // MODE === 'apply'
    if (canApply) {
        const r = gitApply(pkgDir, patchFile, []);
        if (r.status === 0) console.log(`✅ ${pkg}@${version} 已套用`);
        else {
            console.error(`❌ ${pkg} 套用失敗:\n${r.stderr}`);
            failures++;
        }
    } else if (canRevert) {
        console.log(`ℹ️ ${pkg}@${version} 已是修補後狀態，略過`);
    } else {
        console.error(`❌ ${pkg}@${version} patch 無法套用（版本不符或檔案已變動）`);
        console.error('   若手動改過 node_modules，請先還原或重新執行 node Docs/make-patches.mjs。');
        failures++;
    }
}

console.log(failures === 0 ? '\n完成。' : `\n有 ${failures} 個套件失敗。`);
process.exit(failures === 0 ? 0 : 1);
