const test = require('node:test');
const assert = require('node:assert/strict');
const { launchPlan } = require('../scripts/start.cjs');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

function fixture(t, compiler, server) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'ttw-start-test-'));
    fs.mkdirSync(path.join(root,'scripts'));
    fs.mkdirSync(path.join(root,'node_modules/tailwindcss'),{recursive:true});
    fs.mkdirSync(path.join(root,'node_modules/@tailwindcss/cli/dist'),{recursive:true});
    fs.copyFileSync(path.join(__dirname,'../scripts/start.cjs'),path.join(root,'scripts/start.cjs'));
    fs.writeFileSync(path.join(root,'node_modules/@tailwindcss/cli/dist/index.mjs'),compiler);
    fs.copyFileSync(path.join(__dirname,'../scripts/css-build.cjs'),path.join(root,'scripts/css-build.cjs'));
    fs.mkdirSync(path.join(root,'styles'));
    fs.writeFileSync(path.join(root,'styles/app.css'),'@import "tailwindcss" source(none);\n@source "../*.html";\n');
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({devDependencies:{'@tailwindcss/cli':'4.3.3',tailwindcss:'4.3.3'}}));
    fs.writeFileSync(path.join(root,'node_modules/tailwindcss/package.json'),'{"version":"4.3.3"}');
    fs.writeFileSync(path.join(root,'node_modules/@tailwindcss/cli/package.json'),'{"version":"4.3.3","bin":{"tailwindcss":"./dist/index.mjs"}}');
    fs.writeFileSync(path.join(root,'Server.js'),server);
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    return root;
}
function run(root,args=['--dev']) {
    return new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[path.join(root,'scripts/start.cjs'),...args],{stdio:['ignore','pipe','pipe']});
        let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
        const timer=setTimeout(()=>{child.kill();reject(new Error('Fixture startup timed out'));},10000);
        child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve({code,output});});
    });
}

test('normal startup can use shipped CSS without development dependencies', () => {
    assert.deepEqual(launchPlan({dev:false,cssCurrent:true,compilerExists:false}),{build:false,watch:false});
});
test('missing CSS builds before normal startup when compiler is installed', () => {
    assert.deepEqual(launchPlan({dev:false,cssCurrent:false,compilerExists:true}),{build:true,watch:false});
});
test('development mode always builds first and enables watching', () => {
    assert.deepEqual(launchPlan({dev:true,cssCurrent:true,compilerExists:true}),{build:true,watch:true});
});
test('required builds fail early with installation instructions', () => {
    for(const dev of [false,true])assert.throws(()=>launchPlan({dev,cssCurrent:false,compilerExists:false}),/npm install/);
    assert.throws(()=>launchPlan({dev:true,cssCurrent:true,compilerExists:false}),/npm install/);
});

test('failed build does not load the server',async t=>{
    const root=fixture(t,'process.exit(2);',"console.log('SERVER_LOADED');");
    const result=await run(root);
    assert.equal(result.code,1);
    assert.match(result.output,/CSS 建置失敗/);
    assert.doesNotMatch(result.output,/SERVER_LOADED/);
});

test('dev builds before server loading and watcher ends with the server',async t=>{
    const root=fixture(t,
        "import fs from 'node:fs';\nfs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],'.built{}');\nfs.writeFileSync('built','ok');\n",
        "const fs=require('fs');if(!fs.existsSync('built'))throw Error('CSS not ready');setTimeout(()=>process.exit(0),500);");
    const result=await run(root);
    assert.equal(result.code,0);assert.match(result.output,/監看中/);
    // close resolves only after the inherited watcher output pipes close too.
});

test('normal startup skips compiler when fingerprint is current, but blocks stale CSS without tools',async t=>{
    const root=fixture(t,"import fs from 'node:fs';\nfs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],'.test{}');\n","console.log('SERVER_LOADED');");
    require('../scripts/css-build.cjs').build(root);
    fs.unlinkSync(path.join(root,'node_modules/@tailwindcss/cli/dist/index.mjs'));
    const current=await run(root,[]);assert.equal(current.code,0);assert.match(current.output,/SERVER_LOADED/);
    fs.writeFileSync(path.join(root,'new.html'),'<div class="flex"></div>');
    const stale=await run(root,[]);assert.equal(stale.code,1);assert.doesNotMatch(stale.output,/SERVER_LOADED/);assert.match(stale.output,/npm install/);
});
