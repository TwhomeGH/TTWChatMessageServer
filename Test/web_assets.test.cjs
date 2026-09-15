const test = require('node:test');
const assert = require('node:assert/strict');
const { serveWebAsset } = require('../WebAssets.cjs');

function request(url, method='GET') {
    return new Promise(resolve => {
        const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){resolve({...this,body});}};
        if(!serveWebAsset({url,method},response))resolve(null);
    });
}
test('CSS asset is available with proper type and contains built utilities', async()=>{
    const res=await request('/assets/app.css?v=test');
    assert.equal(res.status,200);
    assert.match(res.headers['Content-Type'],/^text\/css/);
    assert.ok(res.body.toString().includes('.hidden'));
    assert.ok(res.body.toString().includes('.config-page'));
    assert.equal((await request('/assets/app.css','HEAD')).body,undefined);
});
test('only the explicit stylesheet is exposed',async()=>{
    assert.equal(await request('/assets/../.env'),null);
    assert.equal(await request('/assets/other.css'),null);
    assert.equal((await request('/assets/app.css','POST')).status,405);
});
