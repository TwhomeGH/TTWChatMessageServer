const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../UserScript/restream-monitor.user.js'), 'utf8');
// 測試端擷取純函式；正式 UserScript 不混入 CommonJS 匯出或測試分支。
const start = source.indexOf('    const STABLE_MS =');
const end = source.indexOf('    if (window.top !== window.self', start);
assert.ok(start >= 0 && end > start, '找不到純函式測試區段');
const context = vm.createContext({ URL });
vm.runInContext(source.slice(start, end), context);
const { monitorUrl, observe } = context;
const url='https://livecenter.tiktok.com/live_monitor?apply_mode=11';
test('只接受官方 HTTPS live_monitor 連結，不綁 Restream 雜湊 class',()=>{
    assert.equal(monitorUrl(url),url);
    for(const value of ['javascript:alert(1)','https://livecenter.tiktok.com.evil.test/live_monitor','https://evil.test/live_monitor','http://livecenter.tiktok.com/live_monitor','https://user@livecenter.tiktok.com/live_monitor','https://livecenter.tiktok.com:444/live_monitor'])assert.equal(monitorUrl(value),null);
});
test('連結穩定出現後才開啟，同一輪重繪及短暫消失不重複',()=>{
    const state={};
    assert.equal(observe(state,null,0),false);
    assert.equal(observe(state,url,1000),false);
    assert.equal(observe(state,url,3999),false);
    assert.equal(observe(state,url,4000),true);
    state.opened=true;
    assert.equal(observe(state,url,5000),false);
    observe(state,null,6000);
    assert.equal(observe(state,url,7000),false);
    assert.equal(observe(state,url,11000),false);
});
test('連續消失60秒才解除本輪去重；初次開頁不誤判開播',()=>{
    const state={opened:true};
    observe(state,null,0);observe(state,null,59999);assert.equal(state.opened,true);
    observe(state,null,60000);assert.equal(state.opened,false);
    assert.equal(observe(state,url,61000),false);
    assert.equal(observe(state,url,64000),true);
    const restored={opened:true};
    observe(restored,url,0);assert.equal(observe(restored,url,4000),false);
});
