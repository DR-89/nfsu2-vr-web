import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/wheel-grip';export * from './src/vr/settings';export * from './src/vr/cockpit';export * from './src/vr/driving';export * from './src/vr/fit';export * from './src/vr/math';export * from './src/vr/drivers';export * from './src/vr/protocol';export * from './src/input/gamepad';export * from './src/input/proto';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const rim=(w,a,r=w.radius)=>w.pivot.map((v,k)=>v+r*(Math.cos(a)*w.right[k]+Math.sin(a)*w.up[k]));
function setup(env={}) {
  const w=new V.WheelGrip(V.vrSettings({NFSU2_VR_WHEEL_GRIP:'1',...env}));let t=0;
  const sample=(angles,squeeze=[1,0],busy=[false,false],dt=16,stick=0)=>w.update(t+=dt,true,angles.map(a=>a===null?null:rim(w,a)),squeeze,busy,stick);
  sample([0,Math.PI],[0,0]);return {w,sample};
}
test('one and two hands steer by physical angle, without jumps when changing hands',()=>{
  const {w,sample}=setup();assert.equal(sample([0,Math.PI]),1);
  sample([-.4,Math.PI]);near(w.angle,.4);near(w.input(0),.4/Math.PI);
  const before=w.handMatrix(0);assert.equal(sample([-.4,Math.PI],[1,1]),2);near(w.angle,.4);
  sample([-.6,Math.PI-.2],[1,1]);near(w.angle,.6);
  sample([-.6,Math.PI-.2],[0,1]);near(w.angle,.6);
  sample([-.6,Math.PI-.4],[0,1]);near(w.angle,.8);
  assert.ok(before.every(Number.isFinite));assert.equal(w.handMatrix(0),null);
});
test('hub crossing, jumps and lost poses keep the contact; recovery discards unobserved motion',()=>{
  const {w,sample}=setup();sample([0,Math.PI]);sample([-.3,Math.PI]);const contact=Array.from(w.handMatrix(0));
  w.update(50,true,[w.pivot,null],[1,0],[false,false],0);
  sample([2,Math.PI]);near(w.angle,.3);assert.deepEqual(Array.from(w.handMatrix(0)),contact);
  sample([null,Math.PI]);sample([-.7,Math.PI]);near(w.angle,.3);
  sample([-.8,Math.PI]);near(w.angle,.4);
  sample([1.2,Math.PI]);near(w.angle,.4);
});
test('a wrapped angle is continuous; release returns at the chosen speed and a catch stops the return',()=>{
  const {w,sample}=setup({NFSU2_VR_WHEEL_RETURN:'180'});sample([3.1,0]);sample([-3.1,0]);near(w.angle,-(2*Math.PI-6.2));
  sample([2.8,0]);const a=w.angle;
  sample([2.8,0],[0,0]);near(w.angle,a);
  sample([2.8,0],[0,0],undefined,50);near(w.angle,a-Math.PI*.05);
  const b=w.angle;sample([2.8,0]);near(w.angle,b);
  const held=setup({NFSU2_VR_WHEEL_RETURN:'0'});held.sample([0,0]);held.sample([-.5,0]);held.sample([-.5,0],[0,0]);held.sample([-.5,0],[0,0],undefined,100);near(held.w.angle,.5);
});
test('missing squeeze, focus loss and occupied hands need a fresh release; stick can take back steering',()=>{
  const {w,sample}=setup();sample([0,0]);sample([-.4,0]);sample([null,0],[NaN,0],undefined,200);assert.ok(w.grabbed[0]);
  sample([-.9,0],[1,0]);near(w.angle,.4);
  sample([null,0],[NaN,0],undefined,501);assert.equal(w.grabbed[0],false);
  sample([0,0]);assert.equal(w.grabbed[0],false);sample([0,0],[0,0]);sample([0,0]);assert.ok(w.grabbed[0]);
  sample([-.2,0],[1,0],[true,false]);assert.equal(w.grabbed[0],false);sample([0,0]);assert.equal(w.grabbed[0],false);
  sample([0,0],[0,0]);sample([0,0]);sample([-.3,0]);sample([-.3,0],[0,0]);near(w.input(.7),.7);assert.equal(w.latched,false);
  w.update(1000,false,[],[],[],0);sample([0,0]);assert.equal(w.grabbed[0],false);
});
test('rotation, gain and dead zone affect input independently of the physical wheel and contact',()=>{
  const {w,sample}=setup({NFSU2_VR_WHEEL_ROTATION:'180',NFSU2_VR_STEERING_SENSITIVITY:'200',NFSU2_VR_STEERING_DEADZONE:'10'});
  sample([0,0]);sample([-.05,0]);near(w.input(0),0);
  sample([-.4,0]);near(w.angle,.4);near(w.input(0),(.4/(Math.PI/2)*2-.1)/.9);
  for(let a=.8;a<3;a+=.4)sample([-a,0]);near(w.angle,Math.PI/2);near(w.input(0),1);
  assert.equal(V.vrSettings({NFSU2_VR_STEERING_DEADZONE:'Infinity'}).steeringDeadzone,0);
});
const source=()=>({gamepad:{axes:[0,0,0,0],buttons:Array.from({length:6},()=>({value:0}))}});
test('hands attach by proximity, steer together and release independently without a grip button',()=>{
  const w=new V.WheelGrip(V.vrSettings({NFSU2_VR_WHEEL_RETURN:'180'}));let time=0;
  const sample=(positions,busy=[false,false],dt=16)=>w.update(time+=dt,true,positions,[0,0],busy,0);
  assert.equal(sample([w.pivot,null]),0,'the hub is not rim contact');
  assert.equal(sample([rim(w,0),null]),1);near(w.angle,0);
  sample([rim(w,-.3),null]);near(w.angle,.3);
  assert.equal(sample([rim(w,-.3),rim(w,Math.PI)]),2);near(w.angle,.3);
  sample([rim(w,-.5),rim(w,Math.PI-.2)]);near(w.angle,.5);
  sample([w.pivot,rim(w,Math.PI-.4)]);assert.deepEqual(w.grabbed,[false,true]);near(w.angle,.7);
  sample([w.pivot,null]);assert.deepEqual(w.grabbed,[false,false]);near(w.angle,.7);
  sample([null,null],[false,false],50);near(w.angle,.7-Math.PI*.05);
  near(w.input(.6),.6);assert.equal(w.latched,false,'stick can take over after release');
});

test('automatic contact tolerates rim jitter, yields to other controls and rebases tracking gaps',()=>{
  const w=new V.WheelGrip(V.vrSettings({NFSU2_VR_WHEEL_RETURN:'0'}));let time=0;
  const sample=(p,busy=false,dt=16)=>w.update(time+=dt,true,[p,null],[NaN,NaN],[busy,false],0);
  assert.equal(sample(rim(w,0,w.radius+.075)),1,'no squeeze reading required');
  sample(rim(w,-.2,w.radius+.10));assert.equal(w.grabbed[0],true);near(w.angle,.2);
  sample(rim(w,-.2,w.radius+.125));assert.equal(w.grabbed[0],false);
  assert.equal(sample(rim(w,-.2,w.radius+.095)),0,'outside entry radius');
  assert.equal(sample(rim(w,-.6)),1);near(w.angle,.2);
  sample(rim(w,-.8));near(w.angle,.4);sample(null);assert.equal(w.grabbed[0],false);
  sample([NaN,0,0]);assert.equal(w.grabbed[0],false);
  sample(rim(w,-1));near(w.angle,.4);sample(rim(w,-1.4),false,301);near(w.angle,.4);
  sample(rim(w,-1.6));near(w.angle,.6);sample(rim(w,-1.6),true);assert.equal(w.grabbed[0],false);
  assert.equal(sample(rim(w,-2)),1);near(w.angle,.6);
  w.reset();assert.equal(w.handMatrix(0),null);
});

test('changing to button grip requires release while automatic mode accepts contact immediately',()=>{
  const settings=V.vrSettings({NFSU2_VR_WHEEL_RETURN:'0'}),w=new V.WheelGrip(settings);let time=0;
  const sample=(angle,squeeze)=>w.update(time+=16,true,[rim(w,angle),null],[squeeze,0],[false,false],0);
  sample(0,0);sample(-.4,0);near(w.angle,.4);
  settings.wheelGrip=true;assert.equal(sample(-.6,1),0);assert.equal(w.grabbed[0],false);near(w.angle,.4);
  sample(-.6,0);assert.equal(sample(-.6,1),1);near(w.angle,.4);sample(-.8,1);near(w.angle,.6);
  sample(-.8,0);assert.equal(w.grabbed[0],false);
  settings.wheelGrip=false;assert.equal(sample(-1,0),1);near(w.angle,.6);
});

test('automatic wheel contact owns the hand before screen hover and yields to the physical shifter',()=>{
  const c=new V.Cockpit(V.vrSettings({}),null),sources=[source(),source()],model='350Z';
  const scene={projection:V.identity(),view:V.identity(),cars:[],local:{matrix:V.identity(),model,steer:0},cockpit:true,
    gearbox:{epoch:1,count:6,manual:true,ready:true},telemetry:{time:1,gear:2,speed:0,rpm:1000,throttle:0,brake:0,dt:.016}};
  c.update(scene);const matrix=V.identity(),mount=V.screenMount(model,c.settings),ray=new Float32Array(mount.matrix);
  matrix.set(rim(c.wheel,0),12);
  for(let k=0;k<3;k++)ray[12+k]+=mount.matrix[k]*.4*mount.width-mount.matrix[4+k]*.45*mount.height+mount.matrix[8+k]*.08;
  let time=0;const frame=()=>{c.update(scene);c.track({time:time+=16,sources,hands:[null,{source:sources[1],matrix,ray}]});};
  frame();assert.equal(c.wheel.grabbed[1],true);sources[1].gamepad.buttons[0].value=.8;frame();near(c.controls.throttle,.8);
  matrix.set(rim(c.wheel,-.3),12);frame();near(c.wheel.angle,.3);assert.equal(c.settings.page,0,'rim contact is not a media click');
  matrix.set(c.shifter.knob(model),12);frame();assert.equal(c.wheel.grabbed[1],false);near(c.controls.throttle,.8);
  sources[1].gamepad.buttons[1].value=1;frame();assert.equal(c.shifter.hand,1);assert.equal(c.wheel.grabbed[1],false);
  sources[1].gamepad.buttons[1].value=0;frame();assert.equal(c.shifter.hand,-1);
  matrix.set(rim(c.wheel,0),12);frame();assert.equal(c.wheel.grabbed[1],true);near(c.controls.throttle,.8);
  c.track(null);assert.deepEqual(c.wheel.grabbed,[false,false]);assert.equal(c.controls,null);
});
test('right-stick shortcuts use native directions, pulse length, thresholds and dominant axis',()=>{
  const s=new V.StickShortcuts(),up=1<<V.PAD_DUP,down=1<<V.PAD_DDOWN,sms=1<<V.PAD_DRIGHT,enter=1<<V.PAD_DUP;
  assert.equal(s.sample(0,0,-1,false),0,'held stick on entry cannot engage');
  assert.equal(s.sample(10,0,0,false),0);
  assert.equal(s.sample(20,0,-.35,false),0);
  assert.equal(s.sample(30,0,-.36,false),up);
  assert.equal(s.sample(129,0,-1,false),up);
  assert.equal(s.sample(130,0,-1,false),0);
  assert.equal(s.sample(140,0,1,false),0,'opposite deflection still requires center');
  s.sample(150,0,0,false);assert.equal(s.sample(160,.3,.9,false),down);
  s.sample(260,0,0,false);assert.equal(s.sample(270,-1,.2,false),sms);
  assert.equal(s.sample(370,-1,.2,false),0);s.sample(380,0,0,false);
  assert.equal(s.sample(390,.9,.3,false),enter);
  s.sample(490,0,0,false);assert.equal(s.sample(500,.8,.8,false),down,'diagonal chooses a single vertical action');
  assert.equal(s.sample(510,.8,-.9,false),down,'rotating the stick cannot send another action');
  assert.equal(s.sample(610,-.9,0,false),0,'both axes must center, even when changing axes');
  assert.equal(s.sample(800,0,-1,false),0,'stale input needs a fresh release');
  assert.equal(s.sample(700,0,-1,false),0,'clock rebase needs a fresh release');
  assert.equal(s.sample(710,NaN,1,false),0);
});
test('screen capture owns the right stick until center, including release and controller replacement',()=>{
  const d=new V.DrivingInput(),sources=[source(),source()],f={time:0,sources,hands:[null,null]};
  const sample=(capture=false)=>{f.time+=16;return d.sample(f,0,[false,false],capture);};
  sample();sources[1].gamepad.axes[3]=-1;assert.equal(sample().buttons,1<<V.PAD_DUP);
  assert.equal(sample(true).buttons,0);sample(true);assert.equal(sample().buttons,0);
  sources[1].gamepad.axes[2]=1;sources[1].gamepad.axes[3]=0;assert.equal(sample().buttons,0,'both axes must return to center');
  sources[1].gamepad.axes[2]=0;sample();sources[1].gamepad.axes[3]=-1;
  const p=sample();assert.equal(p.buttons,1<<V.PAD_DUP);assert.equal(p.throttle,0);assert.equal(p.brake,0);
  sources[1]=source();sources[1].gamepad.axes[3]=1;assert.equal(sample().buttons,0);
  sources[1].gamepad.axes=[0,0];sample();sources[1].gamepad.axes[1]=1;assert.equal(sample().buttons,1<<V.PAD_DDOWN,'two-axis controllers');
});
test('pedals release to arm, panel grips can capture triggers, and controller changes rearm',()=>{
  const d=new V.DrivingInput(),sources=[source(),source()],f={sources,hands:[null,null]};
  sources[1].gamepad.buttons[0].value=1;assert.equal(d.sample(f,0,[false,false]).throttle,0);
  sources[1].gamepad.buttons[0].value=0;d.sample(f,0,[false,false]);sources[1].gamepad.buttons[0].value=.75;
  near(d.sample(f,.2,[false,false]).throttle,.75);assert.equal(d.sample(f,.2,[false,true]).throttle,0);
  assert.equal(d.sample(f,0,[false,false]).throttle,0);sources[1].gamepad.buttons[0].value=0;d.sample(f,0,[false,false]);
  sources[0].gamepad.buttons[0].value=.6;sources[0].gamepad.buttons[4].value=1;
  const p=d.sample(f,0,[false,false]);near(p.brake,.6);assert.equal(p.buttons,1<<V.PAD_RB);
  const fresh=source();fresh.gamepad.buttons[0].value=1;f.sources[0]=fresh;assert.equal(d.sample(f,0,[false,false]).brake,0);
  d.reset();assert.equal(d.sample({sources:[null,null],hands:[null,null]},0,[false,false]),null);
});
test('remote wheel angles are bounded and interpolate separately from vehicle steering',()=>{
  near(V.wheelFromSteer(8192/32767),-1);near(V.wheelFromSteer(-4096/32767),.5);
  const a=V.flatDriver();a.vr=true;a.wheel=-2.5;
  assert.ok(V.validAvatar(a));assert.equal(V.validAvatar({...a,wheel:3.1}),false);assert.equal(V.validAvatar({...a,wheel:NaN}),false);
  const b={...a,wheel:2.5};near(V.driverPose({previous:a,current:b,at:100,before:0},150).wheel,0);
  assert.equal(V.driverPose({previous:a,current:b,at:100,before:0},601),null);
});
test('grip gloves keep physical size and publish the same pose as the local renderer',()=>{
  globalThis.document={createElement:()=>({getContext:()=>({})})};
  const c=new V.Cockpit(V.vrSettings({}),null),model='SKYLINE',sources=[source(),source()];
  c.update({projection:V.identity(),view:V.identity(),cars:[],local:{matrix:V.identity(),model,steer:0},cockpit:true});
  const hand=(i,a)=>{const matrix=V.identity();matrix.set(rim(c.wheel,a),12);return {matrix,source:sources[i]};};
  const f={time:1,hands:[hand(0,Math.PI),hand(1,0)],sources};c.track(f);
  sources.forEach(s=>s.gamepad.buttons[1].value=1);c.track({...f,time:17});f.hands=[hand(0,Math.PI-.4),hand(1,-.4)];c.track({...f,time:33});
  near(c.wheelVisual,.4/Math.PI);assert.ok(c.controls.steer>0);
  assert.deepEqual(c.fingers,[1,0,1,0]);
  for(let h=0;h<2;h++) {
    const actual=c.handMatrix(h),pose=c.handPose(h),reconstructed=V.multiply(V.poseMatrix(pose),V.gloveAxes(h));
    assert.ok(V.validPose(pose));for(let k=0;k<16;k++)near(actual[k],reconstructed[k]);
    const contact=rim(c.wheel,(h?0:Math.PI)-.4,c.wheel.radius+.027).map((v,k)=>v+c.wheel.axis[k]*.02);
    for(let k=0;k<3;k++)near(actual[12+k],contact[k]);
  }
  c.track({...f,time:49,sources:[null,null],hands:[null,null]});assert.equal(c.controls,null);assert.equal(c.wheelVisual,null);
  c.track(null);assert.equal(c.controls,null);assert.equal(c.handPose(1),null);
});
test('free and shifter hands use the Xbox grip basis, also after network pose reconstruction',t=>{
  const original=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({})})};
  t.after(()=>{globalThis.document=original;});
  const c=new V.Cockpit(V.vrSettings({}),null);
  c.update({projection:V.identity(),view:V.identity(),cars:[],local:{matrix:V.identity(),model:'SKYLINE',steer:0},cockpit:true});
  for(const q of [[0,0,0,1],[Math.SQRT1_2,0,0,Math.SQRT1_2],[0,Math.sin(.6),0,Math.cos(.6)]])for(let h=0;h<2;h++){
    const tracked=V.poseMatrix({p:[h?.3:-.3,-.2,-.4],q}),hands=[null,null];hands[h]={matrix:tracked};
    c.tracking={hands};c.shifter.hand=-1;
    // Reference: quest_xr.c poll_wheel_grips, applied to the same OpenXR pose.
    const native=new Float32Array(tracked);
    for(let r=0;r<3;r++){native[r]=tracked[8+r];native[4+r]=-tracked[4+r];native[8+r]=tracked[r]*(h?1:-1);}
    const compare=()=>{
      const local=c.handMatrix(h),pose=c.handPose(h),remote=V.multiply(V.poseMatrix(pose),V.gloveAxes(h));
      assert.ok(V.validPose(pose));
      for(let k=0;k<16;k++){near(local[k],native[k]);near(remote[k],native[k]);}
    };
    compare();c.shifter.hand=h;native.set(c.shifter.knob('SKYLINE'),12);compare();
  }
  const flat=V.flatDriver();
  for(const [h,pose] of [flat.left,flat.right].entries()){
    const mesh=V.multiply(V.poseMatrix(pose),V.gloveAxes(h));
    assert.deepEqual(Array.from(mesh.slice(4,7)),[0,0,-1],'untracked fingers still point forward around the rim');
    assert.deepEqual(Array.from(mesh.slice(8,11)),[0,1,0],'untracked hand backs stay up');
  }
});

test('spatial pad reaches the real mailbox as a wheel and expires back to the monitor controller',t=>{
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),doc=globalThis.document,et=new EventTarget();let now=100;
  const events=['addEventListener','removeEventListener','dispatchEvent'],old=events.map(k=>globalThis[k]);
  events.forEach(k=>globalThis[k]=et[k].bind(et));globalThis.document={hidden:false,visibilityState:'visible'};
  const gamepad={connected:true,id:'Xbox Controller',index:0,mapping:'standard',axes:[.4,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>[gamepad]}});t.mock.method(performance,'now',()=>now);
  const b=new SharedArrayBuffer(V.IM_BYTES),h=new Int32Array(b),u8=new Uint8Array(b),p=new V.PadPoller(h,u8,0,()=>{},()=>{}),f=new Float32Array(b);
  try {
    p.setSpatial({steer:.3,throttle:.7,brake:.2,buttons:1<<V.PAD_RB});assert.equal(h[V.IM_PAD_WHEEL],1);near(f[V.IM_PAD_AXIS],.3);near(f[V.IM_PAD_AXIS+5],.7);
    now+=249;p.poll();assert.equal(h[V.IM_PAD_WHEEL],1);now+=2;p.poll();assert.equal(h[V.IM_PAD_WHEEL],0);near(f[V.IM_PAD_AXIS],.4);near(f[V.IM_PAD_AXIS+5],0);
    p.setSpatial({steer:-.5,throttle:1,brake:0,buttons:0});p.setSpatial(null);assert.equal(h[V.IM_PAD_WHEEL],0);
    p.setSpatial({steer:.8,throttle:1,brake:0,buttons:0});document.hidden=true;p.poll();assert.equal(h[V.IM_PAD_WHEEL],0);
  } finally {p.dispose();events.forEach((k,i)=>globalThis[k]=old[i]);globalThis.document=doc;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
});
