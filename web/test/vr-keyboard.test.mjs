import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/keyboard';export * from './src/input/proto';export * from './src/app/textentry';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const K=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const bit=n=>1<<n;
function setup(entry={max:7,kind:6,text:''}){
  let now=0,e=entry;const sent=[],keyboard=new K.ControllerKeyboard(chars=>{
    sent.push(chars);for(const c of chars)if(c===8)e.text=e.text.slice(0,-1);else if(c>=32&&K.takes(e.kind,String.fromCharCode(c)))e.text=K.fit(e.text+String.fromCharCode(c),e.kind,e.max);
  });
  return {keyboard,sent,get entry(){return e;},set entry(v){e=v;},sample(keys=0,dt=16){return keyboard.sample(now+=dt,e,{buttons:keys,steer:0,throttle:0,brake:0});},tap(key){this.sample(bit(key));this.sample();}};
}
test('opening and held buttons never type into a new field; all input belongs to the keyboard',()=>{
  const a=setup();assert.equal(a.sample(bit(K.PAD_A)),true);a.sample(bit(K.PAD_A));assert.equal(a.sent.length,0);
  a.sample();a.sample(bit(K.PAD_A));a.sample(bit(K.PAD_A));assert.deepEqual(a.sent,[[65]]);a.sample();
  a.tap(K.PAD_DRIGHT);a.tap(K.PAD_A);assert.equal(a.entry.text,'AB');
  a.keyboard.key=38;a.tap(K.PAD_A);assert.equal(a.entry.text,'A');
  a.keyboard.key=39;a.tap(K.PAD_A);assert.deepEqual(a.sent.at(-1),[0,13]);
  a.sample(bit(K.PAD_B));assert.deepEqual(a.sent.at(-1),[27]);
  a.entry=null;assert.equal(a.sample(bit(K.PAD_B)),true);assert.equal(a.sample(),false);assert.equal(a.keyboard.active,false);
  assert.equal(a.keyboard.shown(),'');
});
test('original character kinds, all banks and length limits remain authoritative',()=>{
  const a=setup({max:2,kind:6,text:'A'});a.sample();a.keyboard.key=36;
  a.tap(K.PAD_A);assert.equal(a.entry.text,'A','underscore refused by the PC profile field');
  a.tap(K.PAD_X);assert.equal(a.keyboard.bank,1);a.keyboard.key=1;a.tap(K.PAD_A);assert.equal(a.entry.text,'Ab');
  a.tap(K.PAD_A);assert.equal(a.entry.text,'Ab','a full name stays bounded');
  a.tap(K.PAD_X);assert.equal(a.keyboard.bank,0,'banks with no accepted character are skipped');
  const b=setup({max:40,kind:0,text:''});b.sample();
  for(let i=0;i<3;i++)b.tap(K.PAD_X);assert.equal(b.keyboard.bank,3);b.tap(K.PAD_A);assert.equal(b.sent.at(-1)[0],0xc0);
  b.tap(K.PAD_X);b.tap(K.PAD_A);assert.equal(b.sent.at(-1)[0],0xe0);
  assert.ok(K.KEY_BANKS.every(s=>s.length<=38));
  for(let kind=0;kind<=6;kind++)for(const bank of K.KEY_BANKS)for(const ch of bank){
    if(K.takes(kind,ch))assert.equal(K.fit(ch,kind,1),ch);
  }
});
test('passwords follow retail kind 5, reveal only while Y is held and clear on tracking loss',()=>{
  const a=setup({max:32,kind:5,text:'Private9'});a.sample();assert.equal(a.keyboard.shown(),'••••••••');
  a.sample(bit(K.PAD_Y));assert.equal(a.keyboard.shown(),'Private9');a.sample();assert.equal(a.keyboard.shown(),'••••••••');
  a.keyboard.sample(null,a.entry,null);assert.equal(a.keyboard.shown(),'');assert.equal(a.keyboard.active,false);
  a.sample(bit(K.PAD_A));assert.equal(a.sent.length,0);a.sample();a.tap(K.PAD_A);assert.equal(a.entry.text,'Private9A');
  a.keyboard.destroy();assert.equal(a.keyboard.shown(),'');assert.equal(a.keyboard.active,false);
});
test('the canvas contains masked passwords, redraws on release and clears revealed pixels on tracking loss',t=>{
  const drawn=[],canvas={width:0,height:0,getContext:()=>({fillRect(){},fillText(text){drawn.push(text);}})};
  const old=globalThis.document;globalThis.document={createElement:()=>canvas};t.after(()=>{globalThis.document=old;});
  const a=setup({max:16,kind:5,text:'Secret9'});a.sample();
  a.keyboard.overlay(0,0);assert.ok(drawn.includes('•••••••'));assert.ok(!drawn.includes('Secret9'));
  drawn.length=0;a.sample(bit(K.PAD_Y));a.keyboard.overlay(0,0);assert.ok(drawn.includes('Secret9'));
  drawn.length=0;a.sample();a.keyboard.overlay(0,0);assert.ok(!drawn.includes('Secret9'));assert.ok(drawn.includes('•••••••'));
  a.sample(bit(K.PAD_Y));a.keyboard.overlay(0,0);a.keyboard.sample(null,null,null);assert.equal(canvas.width,0);assert.equal(a.keyboard.overlay(0,0),null);
});
test('field changes and tracking gaps release/rearm; navigation repeats without repeating mutations',()=>{
  const a=setup();a.sample();a.sample(bit(K.PAD_DRIGHT));
  for(let i=0;i<25;i++)a.sample(bit(K.PAD_DRIGHT));assert.equal(a.keyboard.key,2);
  a.sample(bit(K.PAD_A),1000);assert.equal(a.sent.length,0);a.sample();a.tap(K.PAD_A);assert.equal(a.entry.text,'C');
  a.entry={max:12,kind:0,text:'room'};a.sample(bit(K.PAD_A));assert.equal(a.keyboard.key,0);assert.equal(a.entry.text,'room');
  a.sample();a.tap(K.PAD_A);assert.equal(a.entry.text,'roomA');
  a.entry={max:255,kind:0,text:'x'.repeat(96),length:255};a.sample();assert.equal(a.keyboard.allowed(0),false);assert.equal(a.keyboard.allowed(38),true);
  assert.equal(a.keyboard.shown(),'x'.repeat(96)+'…');
  a.entry={max:999,kind:0,text:'bad'};a.sample();assert.equal(a.keyboard.active,false);
});
