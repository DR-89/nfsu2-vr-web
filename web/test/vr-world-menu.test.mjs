import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/world-menu';export * from './src/vr/settings-menu';export * from './src/vr/settings';export * from './src/input/proto';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const bit=n=>1<<n;
function setup(select){
  const state={room:'',name:'Driver'},sent=[];
  const deps={read:()=>({...state}),select:async room=>{sent.push(room);if(select)return select(room);state.room=room;return 'Joined.';}};
  const menu=new V.WorldMenu(deps);let now=0;
  return {menu,state,sent,deps,tick(keys=0,dt=16){return menu.sample(now+=dt,{buttons:keys,steer:0,throttle:0,brake:0});},tap(key){this.tick(bit(key));this.tick();},own(){menu.row=menu.rooms.length;this.tap(V.PAD_A);},type(bank,key){menu.keyboard.bank=bank;menu.keyboard.key=key;this.tap(V.PAD_A);}};
}

test('world changes serialize, holding a button never repeats, pending work can finish after Back',async()=>{
  let done;const a=setup(()=>new Promise(resolve=>{done=resolve;}));a.menu.show();
  a.tick(bit(V.PAD_A));assert.deepEqual(a.sent,[]);a.tick();a.menu.row=2;a.tick(bit(V.PAD_A));
  assert.deepEqual(a.sent,['World 2']);assert.equal(a.menu.busy,true);
  a.tick(bit(V.PAD_A),600);a.tick();a.tap(V.PAD_A);assert.equal(a.sent.length,1);
  a.tap(V.PAD_B);assert.equal(a.menu.open,false);a.menu.show();a.tick();a.tap(V.PAD_A);assert.equal(a.sent.length,1);
  done('Joined.');await new Promise(resolve=>setImmediate(resolve));assert.equal(a.menu.notice,'Joined.');assert.equal(a.menu.busy,false);
  a.menu.destroy();assert.equal(a.menu.open,false);
});

test('world keyboard supports case and Latin, validates before saving, cancels without mutation and empty means public',async()=>{
  const a=setup();a.menu.show();a.tick();a.own();a.type(0,0);a.type(1,1);a.type(3,9); // AbÉ
  a.type(0,39);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(a.sent,['AbÉ']);
  a.tick();a.own();a.type(0,38);a.tap(V.PAD_B);assert.deepEqual(a.sent,['AbÉ']);assert.equal(a.menu.open,true);
  a.tick();a.own();for(let i=0;i<3;i++)a.type(0,38);
  // A room is at most 63 UTF-8 bytes, even when the keyboard holds 63 letters.
  for(let i=0;i<32;i++)a.type(3,0);
  a.type(0,39);assert.equal(a.sent.length,1);assert.equal(a.menu.keyboard.active,true);
  for(let i=0;i<32;i++)a.type(0,38);a.type(0,39);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(a.sent,['AbÉ','']);
  a.tick();a.own();a.type(0,0);a.type(2,0);a.type(2,28); // 'A #', illegal settings comment
  a.type(0,39);assert.equal(a.sent.length,2);a.menu.destroy();assert.equal(a.menu.keyboard.shown(),'');
});

test('live website room changes retain selected actions and removed room requires a fresh release',()=>{
  const a=setup();a.menu.show();a.tick();a.menu.row=a.menu.rooms.length+1;a.state.room='My world';a.tap(V.PAD_A);
  assert.equal(a.menu.open,false,'Back remains Back when the own-world row appears');assert.deepEqual(a.sent,[]);
  a.menu.show();a.tick();assert.equal(a.menu.row,5);a.state.room='World 1';a.tick(bit(V.PAD_A));a.tick(bit(V.PAD_A));assert.deepEqual(a.sent,[]);
  a.tick();a.tap(V.PAD_A);assert.deepEqual(a.sent,['']);
});

test('tracking loss and long gaps require button release; async errors and teardown do not escape',async()=>{
  const a=setup(async()=>{throw Error('failed');});a.menu.show();a.tick();a.menu.sample(null,{buttons:bit(V.PAD_A)});
  a.tick(bit(V.PAD_A));a.tick();a.tick(bit(V.PAD_A),300);assert.deepEqual(a.sent,[]);
  a.tick();a.tap(V.PAD_A);await new Promise(resolve=>setImmediate(resolve));assert.equal(a.menu.busy,false);assert.match(a.menu.notice,/Not saved/);
  let done;const b=setup(()=>new Promise(resolve=>{done=resolve;}));b.menu.show();b.tick();b.tap(V.PAD_A);b.menu.destroy();done('late');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(b.menu.notice,'');assert.equal(b.menu.busy,false);
});

test('World submenu owns B through release and returns to the parent settings',()=>{
  const a=setup(),menu=new V.SettingsMenu(V.vrSettings({}),()=>{},()=>{},undefined,a.deps);let now=0;
  const tick=(keys=0,available=true)=>menu.sample(now+=16,available,{buttons:keys,steer:0,throttle:0,brake:0},'350Z');
  tick();tick(bit(V.PAD_X));tick();menu.row=menu.fields.length+3;tick(bit(V.PAD_A));tick();
  assert.equal(menu.worlds.open,true);tick(bit(V.PAD_B));tick(bit(V.PAD_B));assert.equal(menu.worlds.open,false);assert.equal(menu.open,true);
  tick();tick(bit(V.PAD_A));tick();assert.equal(menu.worlds.open,true);tick(0,false);assert.equal(menu.worlds.open,false);assert.equal(menu.open,false);
  menu.destroy();
});
