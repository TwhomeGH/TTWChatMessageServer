const path = require('node:path');
const { spawn } = require('node:child_process');
const css = require('./css-build.cjs');

const root = path.resolve(__dirname, '..');
function launchPlan({ dev, cssCurrent, compilerExists }) {
    if ((dev || !cssCurrent) && !compilerExists) {
        throw new Error('CSS 缺少、過期或無法驗證。請執行 npm install；正式環境請帶入與來源一致的 assets/app.css 與 app.css.build.json。');
    }
    return { build: dev || !cssCurrent, watch: dev };
}

function start() {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--dev')) throw new Error('使用 npm start，或 npm run dev；不支援其他啟動參數。');
    process.chdir(root);
    const plan = launchPlan({ dev: args.includes('--dev'), cssCurrent: css.inspect(root).current, compilerExists: css.hasCompiler(root) });
    if (plan.build) {
        console.log('[啟動] 正在建置 CSS…');
        css.build(root);
    }
    let watcher;
    const stopWatcher = () => { if (watcher && watcher.exitCode === null && !watcher.killed) watcher.kill(); };
    if (plan.watch) {
        watcher = spawn(process.execPath, [path.join(root, 'scripts/css-build.cjs'), '--watch'], { cwd: root, stdio: 'inherit' });
        process.once('exit', stopWatcher);
        watcher.once('error', error => console.error('[CSS] 監看無法啟動：'+error.message));
        watcher.once('exit', (code, signal) => {
            if (!watcher.killed) console.error(`[CSS] 監看已停止（${code ?? signal}）；服務仍運行，請修正問題後重新啟動 npm run dev。`);
        });
    }
    console.log(plan.watch
        ? '[開發模式] CSS 自動重建；修改 HTML／CSS 後重新整理瀏覽器。後端修改請 Ctrl+C 後重開。'
        : '[一般模式] CSS 指紋已驗證，使用最新樣式。');
    console.log('[啟動] http://localhost:3332 · Ctrl+C 結束服務');
    try {
        // Run the server in this process, retaining its SIGINT/SIGTERM cleanup.
        require(path.join(root, 'Server.js'));
    } catch (error) {
        stopWatcher();
        throw error;
    }
}

if (require.main === module) {
    try { start(); } catch (error) { console.error('[啟動失敗] '+error.message); process.exitCode = 1; }
}
module.exports = { launchPlan };
