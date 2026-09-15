const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const args = ['-c', 'tailwind.config.cjs', '-i', 'styles/app.css', '--minify'];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function fingerprint(root = ROOT) {
    const files = fs.readdirSync(root).filter(name => name.endsWith('.html'));
    function walk(dir) {
        for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
            const name = dir+'/'+item.name;
            if (item.isDirectory()) walk(name);
            else files.push(name);
        }
    }
    walk('styles');
    files.push('tailwind.config.cjs', 'scripts/css-build.cjs');
    if (fs.existsSync(path.join(root, 'package-lock.json'))) files.push('package-lock.json');
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies?.tailwindcss;
    if (!version) throw new Error('package.json 未指定 Tailwind 建置版本');
    const inputs = files.sort().map(file => [file, hash(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'))]);
    return hash(JSON.stringify({ schema: 1, args, version, inputs }));
}
function inspect(root = ROOT) {
    const inputHash = fingerprint(root);
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/app.css.build.json'), 'utf8'));
        const output = fs.readFileSync(path.join(root, 'assets/app.css'));
        return { current: manifest.schema === 1 && manifest.inputHash === inputHash && manifest.outputHash === hash(output), inputHash };
    } catch { return { current: false, inputHash }; }
}
function build(root = ROOT) {
    const before = fingerprint(root);
    const compiler = path.join(root, 'node_modules/tailwindcss/lib/cli.js');
    if (!fs.existsSync(compiler)) throw new Error('CSS 需要更新，但缺少建置工具。請執行 npm install，再執行 npm run build:css。');
    const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies.tailwindcss;
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/tailwindcss/package.json'), 'utf8')).version;
    if (expected !== installed) throw new Error('Tailwind 安裝版本與指定版本不同，請執行 npm install。');
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    const temporary = path.join(root, 'assets', `.app-${process.pid}-${crypto.randomUUID()}.css`);
    const manifestTemporary = temporary+'.json';
    try {
        const result = spawnSync(process.execPath, [compiler, ...args, '-o', temporary], { cwd: root, stdio: 'inherit' });
        if (result.error || result.status !== 0) throw new Error('CSS 建置失敗，保留原有樣式與指紋。'+(result.error?.message || ''));
        const output = fs.readFileSync(temporary);
        if (!output.length) throw new Error('CSS 建置產出為空');
        if (fingerprint(root) !== before) throw new Error('建置期間來源變更，請重試；未更新建置指紋。');
        const manifest = { schema: 1, inputHash: before, outputHash: hash(output) };
        fs.writeFileSync(manifestTemporary, JSON.stringify(manifest, null, 2)+'\n');
        fs.renameSync(temporary, path.join(root, 'assets/app.css'));
        fs.renameSync(manifestTemporary, path.join(root, 'assets/app.css.build.json'));
        console.log('[CSS] 建置完成，指紋已更新。');
    } finally {
        for (const file of [temporary, manifestTemporary]) if (fs.existsSync(file)) fs.unlinkSync(file);
    }
}
function watch(root = ROOT) {
    console.log('[CSS] 監看中（HTML、styles、建置設定與版本）。');
    let attempted;
    const check = () => {
        try {
            const state = inspect(root);
            if (state.current) { attempted = undefined; return; }
            if (state.inputHash === attempted) return;
            attempted = state.inputHash;
            build(root);
            attempted = undefined;
        } catch (error) { console.error('[CSS] '+error.message); }
    };
    check();
    return setInterval(check, 750);
}
if (require.main === module) {
    try {
        if (process.argv.includes('--watch')) watch();
        else if (process.argv.includes('--check')) {
            const state = inspect(); console.log(state.current ? 'CSS 指紋一致' : 'CSS 需要重新建置'); process.exitCode = state.current ? 0 : 1;
        } else build();
    } catch (error) { console.error('[CSS] '+error.message); process.exitCode = 1; }
}
module.exports = { fingerprint, inspect, build, watch };
