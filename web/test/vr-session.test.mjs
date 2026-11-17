import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
const code = (await esbuild.build({
  stdin: { contents: `export * from './src/vr/session'; export * from './src/vr/webgl-bridge'; export * from './src/vr/launch';`, resolveDir: new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), loader: 'ts' },
  bundle: true, format: 'esm', write: false,
})).outputFiles[0].text;
const { ImmersiveSession, WebGLXRBridge, poseFromMatrix, VRLaunch } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const ident = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
function setup(t, space = Promise.resolve({}), size=96, version=1, direct=false, rate=90) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  new Uint32Array(memory.buffer, 64, 2).set([0x3152564e, version]);
  const listeners = new Map();
  let draw;
  const calls = [], session = {
    visibilityState: 'visible', inputSources: [],
    addEventListener(type, fn) { const list=listeners.get(type)??[];list.push(fn);listeners.set(type,list); }, requestReferenceSpace() { return space; },
    requestAnimationFrame(fn) { draw = fn; return 1; }, cancelAnimationFrame() {},
    updateRenderState(state) { calls.push(state); }, async end() { for (const fn of (listeners.get('end')??[]).splice(0)) fn(); },
    visibility(state) { this.visibilityState=state;for(const fn of listeners.get('visibilitychange')??[])fn(); },
  };
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { xr: {
    requestSession(mode, opts) { calls.push({ mode, ...opts }); return Promise.resolve(session); },
  } } });
  const original = WebGLXRBridge.create, prepare = WebGLXRBridge.prepare;
  WebGLXRBridge.prepare = async () => { calls.push('graphics-ready'); return {}; };
  WebGLXRBridge.create = async (_, device, scale) => { calls.push({bridgeScale:scale});return { viewport:()=>({x:0,y:0,width:1600,height:1800}),destroy() { calls.push('bridge-destroyed'); } }; };
  t.after(() => { WebGLXRBridge.create = original; WebGLXRBridge.prepare = prepare; if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; });
  const vr = new ImmersiveSession({ memory, registered: async () => ({ ptr: 64, size }) }, {limits:{maxTextureDimension2D:4096}}, () => {}, direct, rate);
  t.after(() => vr.detach());
  return { vr, memory, calls, session, frame(viewer, pose = null) { draw(1, { session, getViewerPose: () => viewer, getPose: () => pose }); } };
}

test('headset requests supported 90 Hz and keeps its nominal rate through missed frames and session end',async t=>{
  const {vr,session}=setup(t);
  session.frameRate=72;session.supportedFrameRates=new Float32Array([72,90,120]);
  const rates=[];session.updateTargetFrameRate=async hz=>{rates.push(hz);session.frameRate=hz;};
  await Promise.resolve();assert.equal(vr.refreshRate,0);await vr.enter();
  assert.deepEqual(rates,[90]);assert.equal(vr.refreshRate,90);
  await vr.exit();assert.equal(vr.refreshRate,0);
});

test('XR visibility owns game focus during setup, system menus and exit, without waiting for frames',async t=>{
  let release;const {vr,session,frame,memory}=setup(t,new Promise(r=>release=r));
  const focus=[],tracking=[];vr.onVisibility=v=>focus.push(v);vr.onTracking=f=>tracking.push(f);
  await Promise.resolve();const opening=vr.enter();await Promise.resolve();
  assert.equal(vr.active,false);assert.equal(vr.visibility,true);assert.deepEqual(focus,[true]);
  session.visibility('visible-blurred');assert.equal(vr.visibility,false);assert.equal(focus.at(-1),false);
  release({});await opening;session.visibility('visible');
  const viewer={transform:{matrix:ident()},views:['left','right'].map(eye=>({eye,projectionMatrix:ident(),transform:{matrix:ident()}}))};
  frame(viewer);vr.gearCommand=77;assert.equal(vr.renderEyes.length,2);
  session.visibility('hidden');assert.equal(focus.at(-1),false);assert.equal(vr.renderEyes.length,0);assert.equal(tracking.at(-1),null);
  assert.equal(new Uint32Array(memory.buffer,64,24)[3],0);assert.equal(vr.gearCommand,0);
  session.visibility('visible');assert.equal(focus.at(-1),true);await vr.exit();assert.equal(vr.visibility,null);assert.equal(focus.at(-1),null);
  const n=focus.length;session.visibility('visible');assert.equal(focus.length,n,'ended sessions cannot regain focus');
});

test('refresh-rate rejection retains a usable session and an unsupported rate is never requested',async t=>{
  const {vr,session}=setup(t);session.frameRate=72;session.supportedFrameRates=new Float32Array([72,90]);
  session.updateTargetFrameRate=async()=>{throw Error('runtime busy');};
  await Promise.resolve();await vr.enter();assert.equal(vr.active,true);assert.equal(vr.refreshRate,72);
  await vr.exit();session.supportedFrameRates=new Float32Array([72]);
  session.updateTargetFrameRate=async()=>assert.fail('unsupported request');
  await vr.enter();assert.equal(vr.refreshRate,72);
});

test('ending XR releases an entry waiting for a refresh-rate request',async t=>{
  const {vr,session}=setup(t);session.frameRate=72;session.supportedFrameRates=new Float32Array([72,90]);
  session.updateTargetFrameRate=()=>new Promise(()=>{});
  await Promise.resolve();const entering=vr.enter();await Promise.resolve();await session.end();
  await entering;assert.equal(vr.active,false);assert.equal(vr.refreshRate,0);
});

test('120 FPS requests a supported 120 Hz headset and falls back to supported 90 Hz',async t=>{
  const {vr,session}=setup(t,Promise.resolve({}),96,1,false,120),requested=[];
  session.frameRate=90;session.supportedFrameRates=new Float32Array([72,90,120]);
  session.updateTargetFrameRate=async rate=>{requested.push(rate);session.frameRate=rate;};
  await Promise.resolve();await vr.enter();assert.deepEqual(requested,[120]);assert.equal(vr.refreshRate,120);
  await vr.exit();session.frameRate=72;session.supportedFrameRates=new Float32Array([72,90]);
  await vr.enter();assert.deepEqual(requested,[120,90]);assert.equal(vr.refreshRate,90);
});

test('Auto preserves a headset already configured at 120 Hz',async t=>{
  const {vr,session}=setup(t);session.frameRate=120;session.supportedFrameRates=new Float32Array([72,90,120]);
  session.updateTargetFrameRate=async()=>assert.fail('must not lower a configured headset rate');
  await Promise.resolve();await vr.enter();assert.equal(vr.refreshRate,120);
});

test('prelaunch resolution reaches an already requested session and changes only on VR re-entry',async t=>{
  const {vr,calls}=setup(t);vr.settings.renderScale=.75;
  const launch=new VRLaunch();await launch.ready;await launch.connect(vr);
  assert.equal(calls.find(c=>c.bridgeScale)?.bridgeScale,.75);
  assert.deepEqual(vr.eyeSize({xrView:{}}),{width:1600,height:1800},'render size follows the actual browser viewport');
  vr.settings.renderScale=1.5;
  assert.equal(calls.filter(c=>c.bridgeScale).length,1,'live settings do not rebuild an active layer');
  await vr.exit();await vr.enter();assert.equal(calls.filter(c=>c.bridgeScale).at(-1).bridgeScale,1);
});

test('WebGPU layers receive the selected scale and eye targets respect actual sizes and GPU limits',async t=>{
  const {vr,calls,frame}=setup(t,Promise.resolve({}),96,1,true),old=globalThis.XRGPUBinding;
  globalThis.XRGPUBinding=class {
    getPreferredColorFormat(){return 'bgra8unorm';}
    createProjectionLayer(options){calls.push({projection:options});return {destroy(){}};}
    getViewSubImage(_,view){return {viewport:{x:0,y:0,width:view.eye==='left'?2000:2100,height:2200}};}
  };
  t.after(()=>{if(old===undefined)delete globalThis.XRGPUBinding;else globalThis.XRGPUBinding=old;});
  vr.settings.renderScale=1.25;await Promise.resolve();await vr.enter();
  assert.deepEqual(calls[0].requiredFeatures,['webgpu']);assert.equal(calls.find(c=>c.projection).projection.scaleFactor,1);
  let sizes;vr.onFrame=()=>sizes=vr.frame.eyes.map(eye=>vr.eyeSize(eye));
  frame({transform:{matrix:ident()},views:['left','right'].map(eye=>({eye,projectionMatrix:ident(),transform:{matrix:ident()}}))});
  assert.deepEqual(sizes,[{width:2500,height:2750},{width:2625,height:2750}]);
  assert.deepEqual(vr.eyeSize({image:{viewport:{width:8000,height:6000}}}),{width:4096,height:3072});
  assert.equal(vr.eyeSize({image:{viewport:{width:0,height:0}}}),null);
});

test('offscreen eyes retain copied optics only and expire on lost tracking, recenter and exit',async t=>{
  const {vr,frame,session}=setup(t);await Promise.resolve();await vr.enter();
  const projection=ident(),matrix=ident(),viewer={transform:{matrix},views:['left','right'].map(eye=>({eye,projectionMatrix:projection,transform:{matrix}}))};
  frame(viewer);assert.equal(vr.frame,null);assert.equal(vr.inFrame,false);assert.equal(vr.renderEyes.length,2);
  const saved=vr.renderEyes[0].projection[0];projection[0]=9;assert.equal(vr.renderEyes[0].projection[0],saved);
  assert.deepEqual(Object.keys(vr.renderEyes[0]).sort(),['height','projection','view','width']);
  frame(null);assert.equal(vr.renderEyes.length,0);frame(viewer);vr.recenter();assert.equal(vr.renderEyes.length,0);
  frame(viewer);session.visibilityState='hidden';frame(viewer);assert.equal(vr.renderEyes.length,0);
  session.visibilityState='visible';frame(viewer);await vr.exit();assert.equal(vr.renderEyes.length,0);
});

test('render pixels report runtime viewports and GPU caps once per change, retaining the active layer scale',async t=>{
  const {vr,frame}=setup(t);await Promise.resolve();vr.settings.renderScale=1.25;await vr.enter();
  let width=2000,height=2400;vr.bridge.viewport=()=>({x:0,y:0,width,height});
  const reports=[];vr.onResolution=p=>reports.push(p);
  const viewer={transform:{matrix:ident()},views:['left','right'].map(eye=>({eye,projectionMatrix:ident(),transform:{matrix:ident()}}))};
  frame(viewer);assert.equal(reports.length,1);assert.equal(reports[0].scale,1.25);assert.equal(reports[0].layerScale,1);
  assert.deepEqual(reports[0].eyes[0],{eye:'left',width:2500,height:3000,viewportWidth:2000,viewportHeight:2400});
  frame(viewer);vr.settings.renderScale=2;frame(viewer);assert.equal(reports.length,1,'no per-frame persistence and no relabeling of the active layer');
  width=8000;height=6000;frame(viewer);assert.equal(reports.length,2);assert.equal(reports[1].scale,1.25);
  assert.deepEqual(reports[1].eyes[1],{eye:'right',width:4096,height:3072,viewportWidth:8000,viewportHeight:6000});
  await vr.exit();assert.equal(reports.at(-1),null);
});
test('optical rear requests have their own heartbeat and never activate head tracking or gear ownership',async t=>{
  const {vr,memory}=setup(t,Promise.resolve({}),120);await Promise.resolve();
  const u=new Uint32Array(memory.buffer,64,30),f=new Float32Array(memory.buffer,64,30),d=new Float64Array(memory.buffer,64,15);
  u[23]=0x1234;d[2]=42;vr.mirrorCapture={car:0x10000,origin:[.1,.2,-.6]};
  assert.equal(u[3],0);assert.equal(u[23],0x1234);assert.equal(d[2],42);assert.equal(u[27],0x10000);assert.ok(Math.abs(f[26]+.6)<1e-6);assert.ok(d[14]>42);assert.equal(u[2],2);
  vr.mirrorCapture=null;assert.equal(u[27],0);assert.equal(u[2],4);vr.detach();vr.mirrorCapture={car:0x20000,origin:[0,0,0]};assert.equal(u[27],0);
});

test('version 4 car limits queue, remain independent of tracking, and accept Auto and zero',async t=>{
  const {vr,memory}=setup(t,Promise.resolve({}),4272,4);vr.carLimit(64);await Promise.resolve();
  const u=new Uint32Array(memory.buffer,64,1068),i=new Int32Array(memory.buffer,64,1068);
  assert.equal(u[1066],1);assert.equal(i[1067],64);assert.equal(u[2]&1,0);assert.equal(u[3],0);
  vr.stanceSettings('v1|350Z:35,0,0,0,110',true);vr.gameSettings(2,true,true,true);
  u[23]=0x1234;u[30]=9;new Float64Array(memory.buffer,64+16,1)[0]=42;
  const before=u.slice(),seq=u[2];vr.carLimit(64);
  for(const bad of [65,-2,1.5,NaN,Infinity])vr.carLimit(bad);
  assert.deepEqual(u,before);vr.carLimit(-1);assert.equal(i[1067],-1);assert.equal(u[1066],2);
  vr.carLimit(0);assert.equal(i[1067],0);assert.equal(u[1066],3);assert.equal(u[2],seq+4);
  assert.deepEqual(u.slice(3,1066),before.slice(3,1066),'tracking, replay and other settings remain intact');
  u[1066]=0xffffffff;vr.carLimit(6);assert.equal(u[1066],1,'zero revision stays reserved');
  vr.detach();const stopped=u.slice();vr.carLimit(8);assert.deepEqual(u,stopped);
});

for(const [size,version] of [[4264,3],[4272,3],[160,2]])test(`legacy mailbox ${version}/${size} never receives car limits`,async t=>{
  const {vr,memory}=setup(t,Promise.resolve({}),size,version);await Promise.resolve();
  const tail=new Uint8Array(memory.buffer,64+4264,8);tail.fill(77);vr.carLimit(64);
  assert.equal(tail.every(n=>n===77),true);
});

test('version 3 stance updates queue before registration and preserve tracking and old controls',async t=>{
  const {vr,memory}=setup(t,Promise.resolve({}),4264,3);vr.stanceSettings('v1|350Z:35,0,0,0,110',true);await Promise.resolve();
  const u=new Uint32Array(memory.buffer,64,42),bytes=new Uint8Array(memory.buffer,64+168,4096),text=()=>new TextDecoder().decode(bytes.slice()).split('\0')[0];
  assert.equal(u[40],1);assert.equal(u[41],1);assert.equal(text(),'v1|350Z:35,0,0,0,110');assert.equal(u[2]&1,0);assert.equal(u[3],0);assert.equal(u[23],0);
  const seq=u[2];vr.stanceSettings(text(),true);assert.equal(u[2],seq);vr.stanceSettings('bad',false);assert.equal(u[2],seq);
  vr.gameSettings(2,true,true,true);assert.equal(u[34],1);assert.equal(u[40],1);assert.equal(text(),'v1|350Z:35,0,0,0,110');
  vr.stanceSettings('v1',false);assert.equal(u[40],2);assert.equal(u[41],0);assert.equal(text(),'v1');assert.equal(bytes.slice(3).some(Boolean),false);
  vr.detach();vr.stanceSettings('v1',true);assert.equal(u[40],2);
});

test('legacy mailboxes never receive the stance extension even with excess reserved memory',async t=>{
  const {vr,memory}=setup(t,Promise.resolve({}),160,2);await Promise.resolve();const bytes=new Uint8Array(memory.buffer,64+160,4104);bytes.fill(77);
  vr.stanceSettings('v1',true);assert.equal(bytes.every(n=>n===77),true);
});

test('replay actions bind to the live viewer and preserve its runtime-owned epoch',async t=>{
  const {vr,memory}=setup(t,Promise.resolve({}),136);await Promise.resolve();await vr.enter();
  const u=new Uint32Array(memory.buffer,64,34),d=new Float64Array(memory.buffer,64+16,1);d[0]=42;u[30]=7;
  assert.equal(vr.replayEpoch,7);vr.replayAction(6,true,true);assert.equal(u[32],0);
  vr.replayAction(7,true,false);vr.replayAction(7,true,true);
  assert.deepEqual(Array.from(u.slice(30)),[7,7,2,1]);assert.equal(u[2]&1,0);assert.equal(d[0],42);
  u[30]=8;vr.replayAction(7,true,true);assert.equal(u[32],2);
  await vr.exit();assert.equal(vr.replayEpoch,0);vr.replayAction(8,true,true);assert.equal(u[32],2);
});

test('controller buttons survive a lost hand pose and recenter releases driving contacts', async t => {
  const {vr,session,frame}=setup(t),events=[];
  vr.onTracking=f=>events.push(f);
  await Promise.resolve();await vr.enter();
  const source={handedness:'right',gripSpace:{},get targetRaySpace(){assert.fail('cockpit hands do not request a controller ray');},gamepad:{buttons:[{value:.8}]}};
  session.inputSources=[source];
  const viewer={transform:{matrix:ident()},views:[]};
  frame(viewer,{transform:{matrix:ident()}});assert.ok(events.at(-1).hands[1]);
  frame(viewer);assert.equal(events.at(-1).hands[1],null);assert.equal(events.at(-1).sources[1],source);
  vr.recenter();assert.equal(events.at(-1),null);
  session.visibilityState='hidden';frame(viewer);assert.equal(events.at(-1),null);
});
test('XR starts from the click, resets tracking on loss, and ends into desktop mode', async t => {
  const { vr, memory, calls, session, frame } = setup(t);
  await Promise.resolve();
  const entering = vr.enter();
  assert.equal(calls[0].mode, 'immersive-vr', 'no await before requestSession');
  assert.deepEqual(calls[0].requiredFeatures, [], 'regular adapter uses the WebGL bridge');
  await entering;
  assert.equal(vr.active, true);
  const viewer = { transform: { matrix: ident() }, views: [] };
  vr.onTracking=f=>{vr.gearCommand=f?0x785:0;};
  frame(viewer);
  assert.equal(new Uint32Array(memory.buffer, 64, 24)[3], 1);
  assert.equal(new Uint32Array(memory.buffer, 64, 24)[23], 0x785, 'same-frame shift command is inside the pose seqlock');
  const u=new Uint32Array(memory.buffer,64,24),at=new Float64Array(memory.buffer,64+16,1)[0],seq=u[2];
  vr.gearCommand=0;
  assert.equal(u[23],0,'lever ownership yields before the pad publishes its shift edge');
  assert.equal(u[2],seq+2);assert.equal(u[2]&1,0);
  assert.equal(new Float64Array(memory.buffer,64+16,1)[0],at,'command publication does not extend head tracking');
  frame(null);
  assert.equal(new Uint32Array(memory.buffer, 64, 24)[3], 0);
  assert.equal(new Uint32Array(memory.buffer, 64, 24)[23], 0);
  await session.end(); assert.equal(vr.active, false); assert.equal(vr.bridge, null);
  assert.ok(calls.includes('bridge-destroyed'));
});

test('two stick clicks recenter once, release contacts and discard the old pose for that frame',async t=>{
  const {vr,memory,session,frame}=setup(t),events=[],pictures=[];
  await Promise.resolve();await vr.enter();vr.onTracking=f=>events.push(f);vr.onFrame=()=>pictures.push(1);
  const sources=['left','right'].map(handedness=>({handedness,gamepad:{buttons:Array.from({length:6},()=>({value:0}))}}));session.inputSources=sources;
  const viewer={transform:{matrix:ident()},views:[]};frame(viewer);
  viewer.transform.matrix[12]=.25;frame(viewer);assert.equal(events.at(-1).head[12],.25);
  sources.forEach(s=>s.gamepad.buttons[3].value=1);frame(viewer);assert.equal(events.at(-1),null);assert.equal(pictures.length,2);
  assert.equal(new Uint32Array(memory.buffer,64,24)[3],0);
  frame(viewer);assert.equal(events.at(-1).head[12],0);assert.equal(pictures.length,3);
  frame(viewer);assert.equal(events.at(-1).head[12],0);assert.equal(pictures.length,4);
  vr.onTracking=f=>{if(f)vr.recenter();};frame(viewer);assert.equal(pictures.length,4,'recenter from a menu callback cannot publish the old pose');
});
test('VR entry changes the camera session id; recenter and tracking loss preserve it',async t=>{
  const {vr,memory,frame,session}=setup(t);await Promise.resolve();
  const u=new Uint32Array(memory.buffer,64,24),viewer={transform:{matrix:ident()},views:[]};
  await vr.enter();frame(viewer);const first=u[3];assert.ok(first);
  frame(null);assert.equal(u[3],0);frame(viewer);assert.equal(u[3],first);
  vr.recenter();assert.equal(u[3],0);frame(viewer);assert.equal(u[3],first);
  session.visibility('hidden');assert.equal(u[3],0);session.visibility('visible');frame(viewer);assert.equal(u[3],first);
  await vr.exit();assert.equal(u[3],0);await vr.enter();frame(viewer);assert.ok(u[3]&&u[3]!==first);
});

test('ending XR during reference-space setup cannot resurrect the session', async t => {
  let resolve; const space = new Promise(r => { resolve = r; });
  const { vr, session } = setup(t, space);
  await Promise.resolve(); const entering = vr.enter(); await Promise.resolve();
  await session.end(); resolve({}); await entering;
  assert.equal(vr.active, false); assert.equal(vr.bridge, null);
});
test('detaching during bridge setup disposes the late bridge', async t => {
  const { vr, calls } = setup(t);
  let resolve; WebGLXRBridge.create = () => new Promise(r => { resolve = r; });
  await Promise.resolve(); const entering = vr.enter();
  await Promise.resolve(); await Promise.resolve();
  vr.detach(); resolve({ destroy() { calls.push('late-destroyed'); } }); await entering;
  assert.equal(vr.active, false); assert.ok(calls.includes('late-destroyed'));
});
test('head and hand rotations remain normalized at 180 degrees', () => {
  const m = ident(); m[0] = -1; m[10] = -1;
  const p = poseFromMatrix(m);
  assert.ok(p.q.every(Number.isFinite)); assert.equal(Math.abs(p.q[1]), 1);
});
test('the start-page VR click requests XR before loading and transfers it without another request', async t => {
  const { vr, calls, session } = setup(t);
  const launch = new VRLaunch();
  assert.equal(calls[0].mode, 'immersive-vr', 'request made synchronously in the click');
  await launch.ready;
  await launch.connect(vr);
  assert.equal(vr.active, true);
  assert.equal(calls.filter(c => c.mode === 'immersive-vr').length, 1);
  launch.cancel(); assert.equal(vr.active, true, 'renderer owns the transferred session');
  await session.end(); assert.equal(vr.active, false);
});

test('game startup waits for the headset GPU switch before allocating its renderer', async t => {
  const { vr, calls } = setup(t);
  let finish, started = false;
  WebGLXRBridge.prepare = () => new Promise(resolve => { finish = resolve; });
  const launch = new VRLaunch(line => calls.push(line));
  const startup = launch.ready.then(() => { started = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(started, false, 'no renderer may exist during the GPU switch');
  finish({}); await startup;
  assert.equal(started, true);
  assert.ok(calls.includes('[vr] presentation GPU ready before game renderer'));
  await launch.connect(vr);
  assert.equal(vr.active, true);
});

test('failed headset graphics preparation ends XR and prevents game startup', async t => {
  const { session } = setup(t);
  let ended = 0;
  const end = session.end; session.end = async () => { ended++; await end(); };
  WebGLXRBridge.prepare = async () => { throw new Error('GPU switch failed'); };
  const launch = new VRLaunch();
  await assert.rejects(launch.ready, /GPU switch failed/);
  launch.cancel();
  assert.equal(ended, 1);
});

test('cancelling while graphics preparation waits releases XR immediately', async t => {
  const { session } = setup(t);
  let finish, ended = 0;
  const end = session.end; session.end = async () => { ended++; await end(); };
  WebGLXRBridge.prepare = () => new Promise(resolve => { finish = resolve; });
  const launch = new VRLaunch();
  await Promise.resolve();
  launch.cancel(); launch.cancel();
  assert.equal(ended, 1);
  finish({});
  await assert.rejects(launch.ready, /launch ended/);
  assert.equal(ended, 1);
});
test('a failed game start closes XR, including a late permission answer', async t => {
  const { session } = setup(t);
  let resolve, ended = 0;
  session.end = async () => { ended++; };
  navigator.xr.requestSession = () => new Promise(r => { resolve = r; });
  const launch = new VRLaunch(); launch.cancel(); launch.cancel();
  resolve(session); await launch.ready; await Promise.resolve();
  assert.equal(ended, 1);
  await assert.rejects(launch.connect({ enter() { assert.fail('cancelled launch must not enter'); } }));
});
test('a renderer that ends before its VR mailbox arrives releases the adopted headset', async t => {
  const { session } = setup(t); let ended = 0;
  const end = session.end; session.end = async () => { ended++; await end(); };
  const vr = new ImmersiveSession({ registered: () => new Promise(() => {}) }, {}, () => {});
  const entering = vr.enter(session);
  vr.detach(); await entering;
  assert.equal(ended, 1); assert.equal(vr.active, false);
});


test('live game settings queue before registration, work without XR and keep tracking/replay ownership untouched',async t=>{
  const {vr,memory}=setup(t,Promise.resolve({}),160,2);vr.gameSettings(2,true);await Promise.resolve();
  const u=new Uint32Array(memory.buffer,64,40);assert.deepEqual(Array.from(u.slice(34,38)),[1,15,2,1]);
  assert.equal(u[3],0);assert.equal(u[23],0);assert.equal(u[30],0);
  const seq=u[2];vr.gameSettings(2,true);assert.equal(u[2],seq);
  vr.gameSettings(2,false);assert.equal(u[34],2);assert.equal(u[37],0);assert.equal(u[2]&1,0);
  vr.gameSettings(3,true);assert.equal(u[34],2);
  vr.gameSettings(2,false,true,true);assert.equal(u[34],3);assert.deepEqual(Array.from(u.slice(38,40)),[1,1]);
  assert.equal(u[3],0);assert.equal(u[23],0);assert.equal(u[30],0);
  vr.detach();vr.gameSettings(0,true);assert.equal(u[34],3);
});

test('version 1 settings mailboxes retain the original mask and reserved words',async t=>{
  const {vr,memory}=setup(t,Promise.resolve({}),160,1);await Promise.resolve();
  const u=new Uint32Array(memory.buffer,64,40);u[38]=77;u[39]=88;
  vr.gameSettings(1,true,true,true);assert.deepEqual(Array.from(u.slice(34,40)),[1,3,1,1,77,88]);
  const seq=u[2];vr.gameSettings(1,true,false,false);assert.equal(u[2],seq);
});

test('Quest-sized eyes supersample above a capped compositor and still reduce below 100 percent',async t=>{
  const {vr,calls,frame}=setup(t);await Promise.resolve();const sizes=[];
  const viewer={transform:{matrix:ident()},views:['left','right'].map(eye=>({eye,projectionMatrix:ident(),transform:{matrix:ident()}}))};
  for(const scale of [.5,.75,1,1.25,1.5,2]){
    vr.settings.renderScale=scale;await vr.enter();const layerScale=calls.filter(c=>c.bridgeScale).at(-1).bridgeScale;
    assert.equal(layerScale,Math.min(1,scale));
    vr.bridge.viewport=()=>({x:0,y:0,width:1680*layerScale,height:1760*layerScale});frame(viewer);
    sizes.push([vr.renderEyes[0].width,vr.renderEyes[0].height]);await vr.exit();
  }
  assert.deepEqual(sizes,[[840,880],[1260,1320],[1680,1760],[2100,2200],[2520,2640],[3360,3520]]);
});
