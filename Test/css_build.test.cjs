const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const { fingerprint,inspect,build }=require('../scripts/css-build.cjs');
const VERSION='4.3.3';
const FAKE_CLI="import fs from 'node:fs';\nfs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],'.test{}');\n";
function setup(t,real=false){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'ttw-css-test-'));
    for(const dir of ['scripts','styles','assets'])fs.mkdirSync(path.join(root,dir),{recursive:true});
    fs.copyFileSync(path.join(__dirname,'../scripts/css-build.cjs'),path.join(root,'scripts/css-build.cjs'));
    fs.writeFileSync(path.join(root,'styles/app.css'),'@import "tailwindcss" source(none);\n@source "../*.html";\n');
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({devDependencies:{'@tailwindcss/cli':VERSION,tailwindcss:VERSION}}));
    if(real){
        fs.symlinkSync(path.join(__dirname,'../node_modules'),path.join(root,'node_modules'),'junction');
    }else{
        for(const dir of ['node_modules/tailwindcss','node_modules/@tailwindcss/cli/dist'])fs.mkdirSync(path.join(root,dir),{recursive:true});
        fs.writeFileSync(path.join(root,'node_modules/tailwindcss/package.json'),JSON.stringify({version:VERSION}));
        fs.writeFileSync(path.join(root,'node_modules/@tailwindcss/cli/package.json'),JSON.stringify({version:VERSION,bin:{tailwindcss:'./dist/index.mjs'}}));
        fs.writeFileSync(path.join(root,'node_modules/@tailwindcss/cli/dist/index.mjs'),FAKE_CLI);
    }
    fs.writeFileSync(path.join(root,'page.html'),'<div class="text-red-500">test</div>\n');
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
test('file additions, deletions, styles and versions affect fingerprints',t=>{
    const root=setup(t);const original=fingerprint(root);
    fs.writeFileSync(path.join(root,'extra.html'),'x');assert.notEqual(fingerprint(root),original);
    fs.unlinkSync(path.join(root,'extra.html'));assert.equal(fingerprint(root),original);
    for(const file of ['styles/app.css','scripts/css-build.cjs']){
        const full=path.join(root,file),old=fs.readFileSync(full);fs.appendFileSync(full,'\n/* changed */');assert.notEqual(fingerprint(root),original);fs.writeFileSync(full,old);
    }
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({devDependencies:{'@tailwindcss/cli':VERSION,tailwindcss:'4.3.4'}}));assert.notEqual(fingerprint(root),original);
});
test('front-end JS does not affect the CSS fingerprint (Tailwind scans HTML only)',t=>{
    const root=setup(t);const original=fingerprint(root);
    fs.writeFileSync(path.join(root,'assets/traffic.js'),'console.log(1);');
    assert.equal(fingerprint(root),original);
    fs.writeFileSync(path.join(root,'assets/traffic.js'),'console.log(2);');
    assert.equal(fingerprint(root),original);
});

test('missing/corrupt manifest and modified output require a rebuild',t=>{
    const root=setup(t);assert.equal(inspect(root).current,false);build(root);
    fs.writeFileSync(path.join(root,'assets/app.css'),'corrupt');assert.equal(inspect(root).current,false);build(root);
    fs.writeFileSync(path.join(root,'assets/app.css.build.json'),'{');assert.equal(inspect(root).current,false);
});
test('failed builds preserve the previous CSS and manifest',t=>{
    const root=setup(t);build(root);
    const before=fs.readFileSync(path.join(root,'assets/app.css.build.json'),'utf8');
    fs.writeFileSync(path.join(root,'node_modules/@tailwindcss/cli/dist/index.mjs'),'process.exit(2);');
    fs.appendFileSync(path.join(root,'page.html'),'changed');
    assert.throws(()=>build(root),/建置失敗/);
    assert.equal(fs.readFileSync(path.join(root,'assets/app.css.build.json'),'utf8'),before);
    assert.equal(fs.readFileSync(path.join(root,'assets/app.css'),'utf8'),'.test{}');
    assert.equal(inspect(root).current,false);
});
test('source changes during a build never receive a current manifest',t=>{
    const root=setup(t);
    fs.writeFileSync(path.join(root,'node_modules/@tailwindcss/cli/dist/index.mjs'),"import fs from 'node:fs';\nfs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],'.test{}');\nfs.appendFileSync('page.html','change');\n");
    assert.throws(()=>build(root),/來源變更/);assert.equal(inspect(root).current,false);
});

test('missing output, deleted HTML and compiler version mismatch are detected',t=>{
    const root=setup(t);build(root);
    fs.unlinkSync(path.join(root,'assets/app.css'));assert.equal(inspect(root).current,false);build(root);
    fs.unlinkSync(path.join(root,'page.html'));assert.equal(inspect(root).current,false);
    fs.writeFileSync(path.join(root,'node_modules/tailwindcss/package.json'),'{"version":"0.0.0"}');
    assert.throws(()=>build(root),/版本不同/);
});

test('missing CLI package is reported as an installation problem',t=>{
    const root=setup(t);
    fs.rmSync(path.join(root,'node_modules/@tailwindcss/cli'),{recursive:true,force:true});
    assert.throws(()=>build(root),/npm install/);
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
