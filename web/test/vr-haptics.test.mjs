import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/haptics';export * from './src/vr/settings';export * from './src/vr/cockpit';export * from './src/vr/shifter';export * from './src/vr/math';export * from './src/vr/drivers';export * from './src/input/gamepad';export * from './src/input/proto';export * from './src/audio/shift-click';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const motor=()=>{const calls=[],pad={hapticActuators:[{pulse:(a,d)=>{calls.push([a,d]);return Promise.resolve(true);}}]};return {calls,pad};};
test('native engine/load gradient uses each installed engine; road impacts retain the full range',()=>{
  const r=V.engineRumble;near(r(850,850,7500,0),.025);near(r(7500,850,7500,1),.305);
  assert.ok(r(4200,850,7500,1)>r(4200,850,7500,0));assert.ok(r(4200,850,9000,1)<r(4200,850,7500,1));
  near(r(10000,850,7500,5),r(7500,850,7500,1));near(r(4200,850,7500,NaN),r(4200,850,7500,0));
  for(const args of [[NaN,850,7500,1],[0,850,7500,1],[4000,0,7500,1],[4000,850,850,1],[4000,850,Infinity,1]])assert.equal(r(...args),0);
  near(V.mixRumble(1,.3),1);assert.ok(V.mixRumble(.2,.3)>.2);near(V.mixRumble(0,.3),.3);
});
test('clicks survive background renewals; motor output stops on loss and never moves to a new controller',()=>{
  const h=new V.ControllerHaptics(),a=motor(),b=motor();h.update(0,[a.pad,b.pad],[.1,.1]);
  h.kick(1,.95,28,10);h.update(10,[a.pad,b.pad],[.1,.1]);near(b.calls.at(-1)[0],.955);assert.equal(b.calls.at(-1)[1],28);
  h.update(25,[a.pad,b.pad],[.1,.1]);assert.equal(b.calls.length,2);h.update(39,[a.pad,b.pad],[.1,.1]);assert.deepEqual(b.calls.at(-1),[.1,100]);
  h.update(50,[a.pad,b.pad],[1,.1]);assert.deepEqual(a.calls.at(-1),[1,100]);
  h.kick(1,.95,28,60);const other=motor();h.update(61,[a.pad,other.pad],[0,0]);assert.deepEqual(b.calls.at(-1),[0,0]);assert.equal(other.calls.length,0);
  h.update(80,[a.pad,other.pad],[.2,.2]);h.stop();assert.deepEqual(a.calls.at(-1),[0,0]);assert.deepEqual(other.calls.at(-1),[0,0]);
  const count=other.calls.length;h.stop();assert.equal(other.calls.length,count);
  h.update(100,[{},null],[1,1]);h.stop();assert.equal(V.canPulse({}),false);
});
test('only the shifting hand clicks on confirmed engagement; sound and click switches are independent',t=>{
  let now=100,sounds=0; t.mock.method(performance,'now',()=>now);
  const a=motor(),b=motor(),sources=[a,b].map(m=>({gamepad:{...m.pad,axes:[0,0,0,0],buttons:Array.from({length:6},()=>({value:0}))}}));
  const c=new V.Cockpit(V.vrSettings({NFSU2_VR_SHIFT_SOUND:'1',NFSU2_VR_GRIP_FEEDBACK:'1'}),null,undefined,undefined,()=>sounds++);
  const scene={projection:V.identity(),view:V.identity(),cars:[],local:{model:'350Z',matrix:V.identity()},cockpit:true,gearbox:{epoch:1,count:6,manual:true,ready:true},telemetry:{time:1,gear:2,rpm:3000,throttle:.5,brake:0,dt:.016,speed:1},feedback:{idle:850,limit:7500,road:0}};
  c.update(scene);const matrix=V.identity();matrix.set(c.shifter.knob('350Z'),12);
  const frame=()=>{now+=16;scene.telemetry.time++;c.update(scene);c.track({time:now,hands:[null,{matrix,source:sources[1]}],sources});};
  frame();sources[1].gamepad.buttons[1].value=1;frame();matrix[14]+=.06;frame();matrix[14]+=.06;frame();
  assert.equal(c.shiftRequest,3);assert.equal(sounds,0);assert.equal(b.calls.some(v=>v[0]>=.95),false);
  scene.telemetry.gear=1;frame();scene.telemetry.gear=3;frame();assert.equal(sounds,1);assert.ok(b.calls.some(v=>v[0]>=.95&&v[1]===28));assert.equal(a.calls.some(v=>v[0]>=.95),false);
  const clickCount=b.calls.filter(v=>v[0]>=.95).length;c.settings.shiftClick=false;
  matrix[14]-=.06;frame();scene.telemetry.gear=1;frame();matrix[14]-=.06;frame();scene.telemetry.gear=2;frame();
  assert.equal(sounds,2);assert.equal(b.calls.filter(v=>v[0]>=.95).length,clickCount);
  c.settings.shiftClick=true;c.settings.shiftSound=false;matrix[14]+=.06;frame();scene.telemetry.gear=1;frame();matrix[14]-=.06;frame();scene.telemetry.gear=2;frame();
  assert.equal(sounds,2);assert.ok(b.calls.filter(v=>v[0]>=.95).length>clickCount,'same gear re-engagement still clicks');
  assert.equal(a.calls.some(v=>v[0]>0),false,'unoccupied hand has no engine rumble');
  c.settings.gripFeedback=false;frame();assert.ok(a.calls.some(v=>v[0]>0));
  c.settings.engineRumble=false;scene.feedback.road=.6;frame();near(a.calls.at(-1)[0],.6);near(b.calls.at(-1)[0],.6);
  now+=40;frame();near(b.calls.at(-1)[0],.6);
  c.track(null);assert.deepEqual(a.calls.at(-1),[0,0]);assert.equal(c.feedback,null);
});
test('stick steering layers engine, road and contact feedback in both hands without grip poses',t=>{
  let now=100;t.mock.method(performance,'now',()=>now);
  const a=motor(),b=motor(),sources=[a,b].map(m=>({gamepad:{...m.pad,axes:[0,0,.4,0],buttons:Array.from({length:6},()=>({value:0}))}}));
  const c=new V.Cockpit(V.vrSettings({}),null);
  const scene={projection:V.identity(),view:V.identity(),cars:[],local:{model:'350Z',matrix:V.identity()},cockpit:true,gearbox:{epoch:1,count:6,manual:false,ready:true},telemetry:{time:1,gear:2,rpm:4200,throttle:.7,brake:0,dt:.016,speed:1},feedback:{idle:850,limit:7500,road:.2}};
  const frame=()=>{now+=60;scene.telemetry.time++;c.update(scene);c.track({time:now,hands:[null,null],sources});};
  const engine=V.engineRumble(4200,850,7500,.7);
  frame();assert.ok(c.controls.steer>0);
  for(const m of [a,b])near(m.calls.at(-1)[0],V.mixRumble(.2,engine));
  scene.feedback.road=.8;frame();for(const m of [a,b])near(m.calls.at(-1)[0],V.mixRumble(.8,engine));
  c.settings.gripFeedback=true;frame();for(const m of [a,b])near(m.calls.at(-1)[0],.8);
  c.settings.gripFeedback=false;c.settings.engineRumble=false;frame();near(a.calls.at(-1)[0],.8);
  c.settings.haptics=false;frame();for(const m of [a,b])assert.deepEqual(m.calls.at(-1),[0,0]);
  c.destroy();
});

test('scene v3 adds engine limits and bounded road levels while retaining older scene readers',()=>{
  const b=new SharedArrayBuffer(12288),p=V.SCENE_OFFSET,l=p+6352;
  new Uint32Array(b,p,4).set([0x3152564e,1,0,3]);new Float32Array(b,p+16,16).set(V.identity());new Float32Array(b,p+144,16).set(V.identity());
  new Float32Array(b,l+16,16).set(V.identity());new Uint32Array(b,l+96,1)[0]=2;new Float32Array(b,p+6528,3).set([850,7500,.5]);
  assert.deepEqual(V.readDriverScene(b,0,b.byteLength).feedback,{idle:850,limit:7500,road:.5});assert.equal(V.readDriverScene(b,0,p+6543),null);
  new Float32Array(b,p+6528,3).set([0,0,.8]);near(V.readDriverScene(b,0,b.byteLength).feedback.road,.8);
  new Float32Array(b,p+6528,3)[2]=2;assert.equal(V.readDriverScene(b,0,b.byteLength).feedback,undefined);
  new Uint32Array(b,p+12,1)[0]=2;assert.ok(V.readDriverScene(b,0,p+6528));
});
test('VR output claims rumble capability, returns to the ordinary pad and discards stale mailbox effects',t=>{
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),doc=globalThis.document,et=new EventTarget(),events=['addEventListener','removeEventListener','dispatchEvent'],old=events.map(k=>globalThis[k]);let now=100;
  events.forEach(k=>globalThis[k]=et[k].bind(et));globalThis.document={hidden:false,visibilityState:'visible'};t.mock.method(performance,'now',()=>now);
  const calls=[],pad={id:'Xbox Controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({value:0})),vibrationActuator:{playEffect:(type,p)=>{calls.push(p);return Promise.resolve();},reset:()=>Promise.resolve()}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>[pad]}});
  const b=new SharedArrayBuffer(V.IM_BYTES),h=new Int32Array(b),poller=new V.PadPoller(h,new Uint8Array(b),0,()=>{},()=>{});
  try {
    poller.setFeedback({controllers:true,rumble:true,engine:.3,road:.2});poller.setSpatial({steer:0,throttle:0,brake:0,buttons:0});assert.equal(h[V.IM_PAD_RUMBLE],1);assert.equal(calls.length,0);
    h[V.IM_RUMBLE_SEQ]=1;h[V.IM_RUMBLE_STRONG]=65535;poller.poll();now+=251;poller.poll();assert.equal(calls.length,0,'old effect is not replayed on handover');
    poller.setFeedback({controllers:false,rumble:true,engine:.3,road:.2});poller.setSpatial(null);near(calls.at(-1).strongMagnitude,.44);near(calls.at(-1).weakMagnitude,.44);
    now+=60;poller.setFeedback(null);h[V.IM_RUMBLE_SEQ]++;h[V.IM_RUMBLE_STRONG]=32768;h[V.IM_RUMBLE_WEAK]=10000;poller.poll();near(calls.at(-1).strongMagnitude,32768/65535);near(calls.at(-1).weakMagnitude,10000/65535);
  } finally {poller.dispose();events.forEach((k,i)=>globalThis[k]=old[i]);globalThis.document=doc;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
});
test('the native sound has a bounded 20-ms decay, shares the audio output and stops on replacement',()=>{
  const nodes=[];let pcm;
  const context={createBuffer:(channels,n,rate)=>{assert.equal(channels,1);assert.equal(n/rate,.02);pcm=new Float32Array(n);return {getChannelData:()=>pcm};},createBufferSource:()=>{const n={connect:v=>{n.output=v;},disconnect:()=>{n.disconnected=true;},start:()=>{n.started=true;},stop:()=>{n.stopped=true;}};nodes.push(n);return n;}};
  const click=new V.ShiftClickSound(),output={};click.play(context,output);assert.equal(nodes[0].output,output);assert.ok(nodes[0].started);assert.ok(pcm.every(Number.isFinite));assert.ok(Math.max(...pcm.map(Math.abs))<.086);
  const rms=p=>Math.sqrt(p.reduce((s,v)=>s+v*v,0)/p.length);assert.ok(rms(pcm.slice(0,240))>10*rms(pcm.slice(720)));assert.equal(pcm[0],0);
  click.play(context,output);assert.ok(nodes[0].stopped&&nodes[0].disconnected);click.stop();assert.ok(nodes[1].stopped&&nodes[1].disconnected);
});
