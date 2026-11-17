import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {WebSocket,WebSocketServer} from 'ws';
const code=(await esbuild.build({stdin:{contents:`export {attachNet} from './src/net/index';export * as P from './src/net/proto';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const {attachNet,P}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
globalThis.WebSocket=WebSocket;
const tick=(ms=10)=>new Promise(r=>setTimeout(r,ms)),until=async(fn)=>{const end=Date.now()+5000;while(!fn()){if(Date.now()>end)throw Error('connection did not settle');await tick();}};
async function setup(t){
  const srv=createServer((_q,r)=>r.end()),wss=new WebSocketServer({server:srv}),hellos=[],sockets=[],logs=[];
  wss.on('connection',ws=>{sockets.push(ws);ws.on('message',data=>{const m=JSON.parse(String(data));if(m.t==='hello'){hellos.push(m);ws.send(JSON.stringify({t:'welcome',vip:0x0a4d0105,mask:'255.255.0.0',token:'t'.repeat(32),bundle:1}));}});});
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));globalThis.location=new URL(`http://127.0.0.1:${srv.address().port}`);
  const pages=Math.ceil(2*P.NET_MAILBOX_BYTES/65536)+1,memory=new WebAssembly.Memory({initial:pages,maximum:pages,shared:true});
  const box=ptr=>{const w=new Int32Array(memory.buffer,ptr,P.NET_HDR_BYTES/4);Object.assign(w,{[P.W_MAGIC]:P.NET_MAGIC,[P.W_VERSION]:P.NET_VERSION,[P.W_HDR_BYTES]:P.NET_HDR_BYTES,[P.W_SLOT_BYTES]:P.NET_SLOT_BYTES,[P.W_TX_SLOTS]:P.NET_TX_SLOTS,[P.W_RX_SLOTS]:P.NET_RX_SLOTS,[P.W_TX_OFF]:P.NET_HDR_BYTES,[P.W_RX_OFF]:P.NET_HDR_BYTES+P.NET_TX_SLOTS*P.NET_SLOT_BYTES});return {ptr,size:P.NET_MAILBOX_BYTES,w};};
  const boxes={4:box(0),7:box(P.NET_MAILBOX_BYTES)};boxes[4].w[P.W_WANT]=1;
  const proc={memory,exited:new Promise(()=>{}),registered:k=>Promise.resolve(boxes[k])},link=attachNet(proc,{name:'First',id:'same-device',waitMs:10,log:s=>logs.push(s)});
  t.after(async()=>{link.close();for(const ws of sockets)ws.terminate();wss.close();await new Promise(r=>srv.close(r));});await until(()=>link.state==='online');return {link,hellos,sockets,logs,boxes};
}
test('profile reconnect changes name/token, preserves device identity and remains off across activity events',async t=>{
  const {link,hellos,logs,boxes}=await setup(t);assert.equal(await link.profile(null),true);link.setAway(true);link.setAway(false);await tick(60);assert.equal(hellos.length,1);assert.equal(link.state,'away');
  const claim='a'.repeat(43);assert.equal(await link.profile({name:'Second',claim}),true);await until(()=>hellos.length===2&&link.state==='online');
  assert.equal(hellos[1].name,'Second');assert.equal(hellos[1].claim,claim);assert.equal(hellos[1].id,hellos[0].id);assert.equal(hellos[1].token,undefined,'resume token cannot retain the old identity');assert.ok(logs.every(s=>!s.includes(claim)));
  link.setAway(true);assert.equal(await link.profile({name:'Third'}),true);await tick(60);assert.equal(hellos.length,2);link.setAway(false);await until(()=>hellos.length===3&&link.state==='online');assert.equal(hellos[2].name,'Third');assert.equal(hellos[2].claim,undefined);
  for(const bad of [{name:'Ab'},{name:'Valid\n'},{name:'Valid',claim:'no'},{name:'Valid',claim:' '.repeat(43)}])assert.equal(await link.profile(bad),false);
  boxes[7].w[P.W_WANT]=1;assert.equal(await link.profile({name:'Fourth'}),false);assert.equal(await link.profile(null),false);assert.equal(link.state,'online');
});
test('profile switching cannot clear kicks, bans, permanent offline choice or a pending forced rename',async t=>{
  for(const code of [4001,4003,4004])await t.test(String(code),async t=>{
    const {link,sockets,hellos}=await setup(t);sockets[0].close(code);await until(()=>link.state==='away');
    assert.equal(await link.profile({name:'Another'}),false);assert.equal(await link.profile(null),false);link.setAway(false);await tick(40);assert.equal(hellos.length,1);
    if(code===4004){link.rename('Allowed');await until(()=>hellos.length===2&&link.state==='online');assert.equal(hellos[1].name,'Allowed');}
  });
  await t.test('offline choice',async t=>{const {link,hellos}=await setup(t);link.goOffline();assert.equal(await link.profile({name:'Another'}),false);await tick(40);assert.equal(hellos.length,1);});
});
