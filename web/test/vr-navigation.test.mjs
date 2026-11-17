import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/navigation';export * from './src/vr/driving';export * from './src/vr/cinema';export * from './src/vr/math';export * from './src/input/proto';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const sources=()=>['left','right'].map(handedness=>({handedness,gamepad:{buttons:Array.from({length:6},()=>({value:0})),axes:[0,0,0,0]}}));
function setup(){const n=new V.NavigationInput(),s=sources();let time=0;const sample=(driving=true,dt=16)=>n.sample({time:time+=dt,sources:s,hands:[null,null]},driving);return {n,s,sample};}

test('short menu flicks cross guest polls with native thresholds and one dominant direction',()=>{
  const {s,sample}=setup();sample(false);
  s[0].gamepad.axes[3]=-.36;assert.equal(sample(false).pad.buttons,1<<V.PAD_DUP);
  s[0].gamepad.axes[3]=0;assert.equal(sample(false,16).pad.buttons,1<<V.PAD_DUP);
  assert.equal(sample(false,84).pad.buttons,0);
  s[1].gamepad.axes[2]=.4;s[1].gamepad.axes[3]=.4;
  assert.equal(sample(false).pad.buttons,1<<V.PAD_DDOWN);
  s[1].gamepad.axes[3]=.3;s[1].gamepad.axes[2]=.3;
  assert.equal(sample(false,120).pad.buttons,1<<V.PAD_DDOWN,'hysteresis holds through stick wobble');
  s[0].gamepad.axes[2]=-.8;
  assert.equal(sample(false).pad.buttons,1<<V.PAD_DLEFT,'strongest stick wins instead of combining directions');
});
test('Y tap downshifts on release; holding Y opens pause once without a shift or a menu button leak',()=>{
  const {s,sample}=setup();sample();s[0].gamepad.buttons[5].value=1;
  assert.equal(sample().shift,0);sample(true,80);s[0].gamepad.buttons[5].value=0;
  assert.equal(sample().shift,1);assert.equal(sample(true,99).shift,1);assert.equal(sample(true,1).shift,0);
  s[0].gamepad.buttons[5].value=1;sample();sample(true,200);sample(true,200);sample(true,200);
  assert.equal(sample(true,50).pause,1<<V.PAD_START);assert.equal(sample(false).pad.buttons,0);
  assert.equal(sample(false,200).pause,0);assert.equal(sample(false).pad.buttons,0);
  s[0].gamepad.buttons[5].value=0;sample(false);s[0].gamepad.buttons[5].value=1;
  assert.equal(sample(false).pad.buttons,1<<V.PAD_Y);
});
test('driving to menu requires released faces and centred sticks; menus never send pedals',()=>{
  const {s,sample}=setup();sample();s[1].gamepad.buttons[0].value=1;s[1].gamepad.buttons[4].value=1;s[1].gamepad.axes[3]=1;
  assert.deepEqual(sample(false).pad,{steer:0,throttle:0,brake:0,buttons:0});
  s[1].gamepad.buttons[4].value=0;s[1].gamepad.axes[3]=0;sample(false);
  s[1].gamepad.buttons[4].value=1;s[1].gamepad.axes[3]=-1;
  assert.equal(sample(false).pad.buttons,(1<<V.PAD_A)|(1<<V.PAD_DUP));
  s[1].gamepad.axes[2]=1;s[1].gamepad.axes[3]=.8;
  assert.equal(sample(false).pad.buttons,(1<<V.PAD_A)|(1<<V.PAD_DRIGHT));
  assert.equal(sample(false,251).pad.buttons,0,'stalled tracking cannot continue held menu input');
});
test('tracking and controller changes cancel a pending pause; a held Y on entry cannot pause',()=>{
  const {n,s,sample}=setup();s[0].gamepad.buttons[5].value=1;
  for(let i=0;i<8;i++)assert.equal(sample(true,100).pause,0);
  s[0].gamepad.buttons[5].value=0;sample();s[0].gamepad.buttons[5].value=1;sample();sample(true,200);
  n.sample(null,false);for(let i=0;i<8;i++)assert.equal(sample(true,100).pause,0);
  s[0].gamepad.buttons[5].value=0;sample();s[0].gamepad.buttons[5].value=1;sample();s[0]={...s[0]};
  for(let i=0;i<8;i++)assert.equal(sample(true,100).pause,0);
});
test('the recenter chord needs both sources, a fresh release, and one complete chord per action',()=>{
  const c=new V.RecenterChord(),s=sources();s.forEach(p=>p.gamepad.buttons[3].value=1);assert.equal(c.sample(s),false);
  s.forEach(p=>p.gamepad.buttons[3].value=0);assert.equal(c.sample(s),false);
  s[0].gamepad.buttons[3].value=1;assert.equal(c.sample(s),false);s[1].gamepad.buttons[3].value=1;assert.equal(c.sample(s),true);assert.equal(c.sample(s),false);
  s[0]={...s[0]};assert.equal(c.sample(s),false);c.reset();assert.equal(c.sample(s),false);
});
test('cinema dimensions preserve aspect, depth and seat calibration',()=>{
  const m=V.cinemaMatrix(1280,800,.12,.2);assert.ok(Math.abs(m[0]/m[5]-1.6)<1e-6);assert.ok(Math.abs(m[13]-.12)<1e-6);assert.ok(Math.abs(m[14]+3.2)<1e-6);
  const view=V.identity();view[13]=-.12;view[14]=.2;const p=V.multiply(view,m);assert.ok(Math.abs(p[13])<1e-6);assert.ok(Math.abs(p[14]+3)<1e-6);
});

test('camera clicks pulse on release, rear view is held only outside, and recenter consumes both clicks',()=>{
  const n=new V.NavigationInput(),s=sources();let now=0;
  const sample=(cockpit=true,dt=16)=>n.sample({time:now+=dt,sources:s,hands:[null,null]},true,cockpit).view;
  sample();s[1].gamepad.buttons[3].value=1;assert.equal(sample(),0);
  s[1].gamepad.buttons[3].value=0;assert.equal(sample(),1<<V.PAD_Y);
  assert.equal(sample(true,99),1<<V.PAD_Y);assert.equal(sample(true,1),0);
  s[0].gamepad.buttons[3].value=1;assert.equal(sample(),0);assert.equal(sample(false),1<<V.PAD_B);
  s[1].gamepad.buttons[3].value=1;assert.equal(sample(false),0);
  s[1].gamepad.buttons[3].value=0;assert.equal(sample(false),0,'one held chord half cannot look back');
  s[1].gamepad.buttons[3].value=1;assert.equal(sample(false),0);
  s.forEach(p=>p.gamepad.buttons[3].value=0);assert.equal(sample(false),0);
  s[1].gamepad.buttons[3].value=1;sample(false);s[1].gamepad.buttons[3].value=0;assert.equal(sample(false),1<<V.PAD_Y);
});

test('camera clicks held through entry, a tracking gap, replacement or a menu cannot advance',()=>{
  const n=new V.NavigationInput(),s=sources();let time=0;
  const sample=(driving=true,dt=16)=>n.sample({time:time+=dt,sources:s,hands:[null,null]},driving,false).view;
  s[1].gamepad.buttons[3].value=1;sample();s[1].gamepad.buttons[3].value=0;assert.equal(sample(),0);
  for(const reset of [()=>sample(true,251),()=>n.sample(null,true),()=>{s[1]={...s[1]};sample();},()=>sample(false)]){
    sample();s[1].gamepad.buttons[3].value=1;sample();reset();sample();
    s[1].gamepad.buttons[3].value=0;assert.equal(sample(),0);
  }
});

test('replay B taps toggle once, holds reach Back, and the click advances once on release',()=>{
  const n=new V.ReplayInput(),s=sources();let time=0;
  const sample=(dt=16,epoch=7)=>n.sample({time:time+=dt,sources:s,hands:[null,null]},epoch);
  sample();s[1].gamepad.buttons[5].value=1;assert.equal(sample().pad.buttons,0);
  s[1].gamepad.buttons[5].value=0;assert.equal(sample().timeline,true);assert.equal(sample().timeline,false);
  s[1].gamepad.buttons[5].value=1;sample();sample(200);sample(200);assert.equal(sample(100).pad.buttons,1<<V.PAD_B);
  s[1].gamepad.buttons[5].value=0;assert.equal(sample().timeline,false);
  s[1].gamepad.buttons[3].value=1;assert.equal(sample().camera,false);s[1].gamepad.buttons[3].value=0;
  assert.equal(sample().camera,true);assert.equal(sample().camera,false);
  s[1].gamepad.buttons[3].value=1;sample();s[0].gamepad.buttons[3].value=1;sample();
  s[1].gamepad.buttons[3].value=0;assert.equal(sample().camera,false);s[0].gamepad.buttons[3].value=0;assert.equal(sample().camera,false);
  for(const reset of [()=>sample(251),()=>n.sample(null,7),()=>sample(16,8),()=>{s[1]={...s[1]};sample();}]){
    sample();s[1].gamepad.buttons[3].value=s[1].gamepad.buttons[5].value=1;sample();reset();sample();
    s[1].gamepad.buttons[3].value=s[1].gamepad.buttons[5].value=0;const action=sample();assert.equal(action.camera,false);assert.equal(action.timeline,false);
  }
});
