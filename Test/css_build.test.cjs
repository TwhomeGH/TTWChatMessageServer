const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const { fingerprint,inspect,build }=require('../scripts/css-build.cjs');
function setup(t,real=false){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'ttw-css-test-'));
    for(const dir of ['scripts','styles','assets','node_modules/tailwindcss/lib'])fs.mkdirSync(path.join(root,dir),{recursive:true});
    fs.copyFileSync(path.join(__dirname,'../scripts/css-build.cjs'),path.join(root,'scripts/css-build.cjs'));
    fs.writeFileSync(path.join(root,'styles/app.css'),'@tailwind utilities;\n');
    fs.writeFileSync(path.join(root,'tailwind.config.cjs'),'module.exports={content:["./*.html"]};');
    fs.writeFileSync(path.join(root,'package.json'),'{"devDependencies":{"tailwindcss":"3.4.17"}}');
    fs.writeFileSync(path.join(root,'node_modules/tailwindcss/package.json'),'{"version":"3.4.17"}');
    fs.writeFileSync(path.join(root,'page.html'),'<div class="text-red-500">test</div>\n');
    const cli=real ? `require(${JSON.stringify(require.resolve('tailwindcss/lib/cli.js'))});` : "require('fs').writeFileSync(process.argv[process.argv.indexOf('-o')+1],'.test{}');";
    fs.writeFileSync(path.join(root,'node_modules/tailwindcss/lib/cli.js'),cli);
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    return root;
}
test('content fingerprints ignore mtimes, CRLF and runtime data but detect source edits',t=>{
    const root=setup(t);build(root);assert.equal(inspect(root).current,true);
    const page=path.join(root,'page.html');fs.utimesSync(page,new Date(0),new Date());
    fs.writeFileSync(page,fs.readFileSync(page,'utf8').replace(/\n/g,'\r\n'));
    fs.writeFileSync(path.join(root,'message_stats.json'),'{}');assert.equal(inspect(root).current,true);
    fs.appendFileSync(page,'<b class="flex"></b>');assert.equal(inspect(root).current,false);
});
test('file additions, deletions, config, styles and version affect fingerprints',t=>{
    const root=setup(t);const original=fingerprint(root);
    fs.writeFileSync(path.join(root,'extra.html'),'x');assert.notEqual(fingerprint(root),original);
    fs.unlinkSync(path.join(root,'extra.html'));assert.equal(fingerprint(root),original);
    for(const file of ['styles/app.css','tailwind.config.cjs','scripts/css-build.cjs']){
        const full=path.join(root,file),old=fs.readFileSync(full);fs.appendFileSync(full,'\n/* changed */');assert.notEqual(fingerprint(root),original);fs.writeFileSync(full,old);
    }
    fs.writeFileSync(path.join(root,'package.json'),'{"devDependencies":{"tailwindcss":"3.4.18"}}');assert.notEqual(fingerprint(root),original);
});
test('missing/corrupt manifest and modified output require a rebuild',t=>{
    const root=setup(t);assert.equal(inspect(root).current,false);build(root);
    fs.writeFileSync(path.join(root,'assets/app.css'),'corrupt');assert.equal(inspect(root).current,false);build(root);
    fs.writeFileSync(path.join(root,'assets/app.css.build.json'),'{');assert.equal(inspect(root).current,false);
});
test('failed builds preserve the previous CSS and manifest',t=>{
    const root=setup(t);build(root);
    const before=fs.readFileSync(path.join(root,'assets/app.css.build.json'),'utf8');
    fs.writeFileSync(path.join(root,'node_modules/tailwindcss/lib/cli.js'),'process.exit(2);');
    fs.appendFileSync(path.join(root,'page.html'),'changed');
    assert.throws(()=>build(root),/建置失敗/);
    assert.equal(fs.readFileSync(path.join(root,'assets/app.css.build.json'),'utf8'),before);
    assert.equal(fs.readFileSync(path.join(root,'assets/app.css'),'utf8'),'.test{}');
    assert.equal(inspect(root).current,false);
});
test('source changes during a build never receive a current manifest',t=>{
    const root=setup(t);
    fs.writeFileSync(path.join(root,'node_modules/tailwindcss/lib/cli.js'),"const fs=require('fs');fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],'.test{}');fs.appendFileSync('page.html','change');");
    assert.throws(()=>build(root),/來源變更/);assert.equal(inspect(root).current,false);
});

test('missing output, deleted HTML and compiler version mismatch are detected',t=>{
    const root=setup(t);build(root);
    fs.unlinkSync(path.join(root,'assets/app.css'));assert.equal(inspect(root).current,false);build(root);
    fs.unlinkSync(path.join(root,'page.html'));assert.equal(inspect(root).current,false);
    fs.writeFileSync(path.join(root,'node_modules/tailwindcss/package.json'),'{"version":"0.0.0"}');
    assert.throws(()=>build(root),/版本不同/);
});

test('watch rebuilds changed sources and updates the fingerprint',async t=>{
    const root=setup(t);build(root);
    const timer=require('../scripts/css-build.cjs').watch(root);
    t.after(()=>clearInterval(timer));
    fs.appendFileSync(path.join(root,'page.html'),'<p class="grid"></p>');
    const deadline=Date.now()+5000;
    while(!inspect(root).current && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(inspect(root).current,true);
});
test('real Tailwind build adds new utilities then reuses the matching fingerprint',t=>{
    const root=setup(t,true);build(root);assert.equal(inspect(root).current,true);
    assert.match(fs.readFileSync(path.join(root,'assets/app.css'),'utf8'),/\.text-red-500/);
    fs.appendFileSync(path.join(root,'page.html'),'<div class="grid-cols-7"></div>');
    assert.equal(inspect(root).current,false);build(root);
    assert.match(fs.readFileSync(path.join(root,'assets/app.css'),'utf8'),/\.grid-cols-7/);
    assert.equal(inspect(root).current,true);
});
