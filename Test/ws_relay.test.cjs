const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../UserScript/ws-relay.user.js'),'utf8');
test('merged relay forwards URL, binary and text exactly once per socket event',async()=>{
    const calls=[];
    class WS extends EventTarget {
        static OPEN=1;
        emit(data){const event=new Event('message');event.data=data;this.dispatchEvent(event);this.onmessage?.(event);}
    }
    const context={window:{WebSocket:WS},GM_xmlhttpRequest:r=>calls.push({url:r.url,...JSON.parse(r.data)}),ArrayBuffer,Uint8Array,Blob,console:{log(){},warn(){}},btoa:s=>Buffer.from(s,'binary').toString('base64')};
    vm.createContext(context);vm.runInContext(source,context);vm.runInContext(source,context);
    const normal=new context.window.WebSocket('wss://example.com');normal.emit('ignore');assert.equal(calls.length,0);
    const socket=new context.window.WebSocket('wss://webcast-ws.example.com/?signature=test');
    let handled=0;const handler=()=>handled++;
    socket.addEventListener('message',handler);socket.addEventListener('message',()=>handled++);socket.onmessage=()=>handled++;
    socket.emit('hello');assert.equal(handled,3);assert.equal(calls.filter(c=>c.type==='ws_text').length,1);
    socket.removeEventListener('message',handler);socket.emit(new Uint8Array([1,2,255]).buffer);
    assert.equal(handled,5);assert.equal(calls.find(c=>c.type==='ws_message').data,'AQL/');
    socket.emit(new Blob(['abc']));await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls.filter(c=>c.type==='ws_message').length,2);
    new context.window.WebSocket('wss://webcast-ws.example.com/reconnect');assert.equal(calls.filter(c=>c.type==='ws_url').length,1);
    assert.equal(context.window.WebSocket.OPEN,1);assert.ok(socket instanceof WS);
    assert.ok(calls.every(c=>c.platform==='TikTok'&&c.transport==='userscript'));
});
test('update metadata points to the canonical relay script',()=>{
    for(const key of ['updateURL','downloadURL'])assert.match(source,new RegExp('@'+key+'\\s+https://raw\\.githubusercontent\\.com/TwhomeGH/TTWChatMessageServer/main/UserScript/ws-relay\\.user\\.js'));
    assert.match(source,/@version\s+1\.3/);
});
