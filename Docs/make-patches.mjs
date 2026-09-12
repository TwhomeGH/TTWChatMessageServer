/**
 * 產生最小差異修補檔（patch）
 *
 * 從 npm 下載「已安裝版本」的原廠 tarball，與目前 node_modules/ 內的檔案做 diff，
 * 產生 unified diff 存到 Docs/patches/<套件>/<版本>.patch。
 *
 * 套用時機：當你修改完 node_modules 內的套件、想更新修補檔時執行。
 *   node Docs/make-patches.mjs
 *
 * 產生的 patch 可用 `git apply -p1` 從套件根目錄套用（見 apply-patches.mjs）。
 */

import { spawnSync } from 'child_process';
import {
    existsSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, cpSync, renameSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const NODE_MODULES = join(PROJECT_ROOT, 'node_modules');
const PATCHES_DIR = join(__dirname, 'patches');

// 需要維護修補的套件（tiktok-signature 執行期只用 javascript/ SDK，無需修補）
const PACKAGES = ['tiktok-live-connector', 'kick-wss'];

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 失敗:\n${r.stderr || r.stdout}`);
    return r.stdout || '';
}

function readVersion(pkg) {
    const p = join(NODE_MODULES, pkg, 'package.json');
    if (!existsSync(p)) throw new Error(`找不到 ${pkg}，請先 npm install`);
    return JSON.parse(readFileSync(p, 'utf8')).version;
}

function copyFiltered(src, dest) {
    cpSync(src, dest, {
        recursive: true,
        filter: (s) => !s.includes('.chrome-profile'),
    });
}

// 把 `a/pristine/x`、`b/installed/x` 正規化成 `a/x`、`b/x`，讓 patch 可用 -p1 套用
function normalizePaths(patch) {
    return patch
        .replace(/^diff --git a\/pristine\/(.*) b\/installed\/(.*)$/gm, 'diff --git a/$1 b/$2')
        .replace(/^--- a\/pristine\//gm, '--- a/')
        .replace(/^\+\+\+ b\/installed\//gm, '+++ b/');
}

let failures = 0;

for (const pkg of PACKAGES) {
    const version = readVersion(pkg);
    const installed = join(NODE_MODULES, pkg);
    const tmp = join(tmpdir(), `patchgen-${pkg}-${Date.now()}`);

    try {
        mkdirSync(tmp, { recursive: true });

        // 1. 下載原廠 tarball 並解開（Windows 需 shell 才能執行 npm.cmd）
        run('npm', ['pack', `${pkg}@${version}`, '--silent'], {
            cwd: tmp,
            stdio: 'pipe',
            shell: process.platform === 'win32',
        });
        const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
        if (!tgz) throw new Error('npm pack 未產生 tarball');
        run('tar', ['-xzf', join(tmp, tgz), '-C', tmp]);
        const pristine = join(tmp, 'package');
        if (!existsSync(pristine)) throw new Error('tarball 解壓後找不到 package/');
        rmSync(join(tmp, tgz), { force: true });
        renameSync(pristine, join(tmp, 'pristine'));

        // 2. 把目前 node_modules 內容複製到同層的 installed/
        copyFiltered(installed, join(tmp, 'installed'));

        // 3. 產生 diff（有差異時 git 回傳 exit code 1）
        const GIT_SAFE = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
        const r = spawnSync(
            'git',
            [...GIT_SAFE, 'diff', '--no-index', '--no-renames', '--binary', 'pristine', 'installed'],
            { cwd: tmp, encoding: 'utf8', maxBuffer: 1 << 28 }
        );
        if (r.error) throw r.error;
        if (r.status !== 0 && r.status !== 1) {
            throw new Error(`git diff 失敗 (exit ${r.status}):\n${r.stderr}`);
        }

        const patch = normalizePaths(r.stdout || '');
        if (!patch.trim()) {
            console.log(`ℹ️ ${pkg}@${version}：與原廠無差異，不產生 patch`);
            continue;
        }

        const outDir = join(PATCHES_DIR, pkg);
        mkdirSync(outDir, { recursive: true });
        const outFile = join(outDir, `${version}.patch`);
        writeFileSync(outFile, patch, 'utf8');
        console.log(`✅ ${pkg}@${version} -> ${outFile}（${patch.split('\n').length - 1} 行）`);
    } catch (e) {
        failures++;
        console.error(`❌ ${pkg}: ${e.message}`);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

console.log(failures === 0 ? '\n完成。' : `\n有 ${failures} 個套件失敗。`);
process.exit(failures === 0 ? 0 : 1);
