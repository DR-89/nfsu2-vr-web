import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/shifter';export * from './src/vr/shifter-guide';export * from './src/vr/pedals';export * from './src/vr/settings';export * from './src/vr/cockpit';export * from './src/vr/math';export * from './src/vr/drivers';export * from './src/vr/protocol';export * from './src/vr/fit';export * from './src/vr/glove-tip';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

test('H rails enforce the neutral crossing, first-gear stop and real four/five/six-speed gates',()=>{
  for(const count of [4,5,6]) {
    const s=new V.Shifter();s.detent(1,count);
    assert.equal(s.move(-.045,-.05,count),null,'first needs the full stop');
    assert.equal(s.move(-.045,-.06,count),2);
    assert.equal(s.move(.09,-.06,count),null,'engaged gear cannot jump across a wall');near(s.x,-.045);
    assert.equal(s.move(-.045,0,count),1);
    assert.equal(s.move(-.023,-.06,count),null,'between gates stays neutral');near(s.z,0);
    for(let g=3;g<=count+1;g++) {
      s.move(s.x,0,count);const x=(V.gearLane(g,count)-1)*.045;
      assert.equal(s.move(x,(g&1)?.05:-.05,count),g);
    }
    s.move(s.x,0,count);const rx=count===6?.09:.045;
    assert.equal(s.move(rx,.05,count),0);near(s.x,rx);
    s.move(rx,0,count);
    if(count===4)assert.equal(s.move(.045,-.06,count),null,'no fifth gear');
    if(count===6)assert.equal(s.move(.09,-.06,count),null,'no seventh gear');
  }
  const s=new V.Shifter();s.firstOnly=true;
  assert.equal(s.move(0,-.06,6),null);assert.equal(s.move(.09,.06,6),null);
  assert.equal(s.move(-.045,-.06,6),2);
});

test('lever acquisition follows the fitted knob, preserves lane direction on RHD, and rebases lost tracking',()=>{
  for(const model of ['350Z','SKYLINE']) {
    const s=new V.Shifter();s.detent(4,6);let now=0;
    const sample=(p,sq=[0,1],busy=[false,false],dt=16)=>s.update(now+=dt,model,6,4,[null,p],sq,busy);
    let p=s.knob(model);sample(p);assert.equal(s.hand,-1,'held grip cannot acquire on entry');
    sample(p,[0,0]);sample(p,[0,1],[false,true]);assert.equal(s.hand,-1,'occupied hand cannot acquire');
    sample(p);assert.equal(s.hand,1);near(s.x,0);
    p=[...p];p[2]+=.06;assert.equal(sample(p),1);
    p[0]-=.045;p[2]-=.06;assert.equal(sample(p),2);near(s.x,-.045);
    sample(null);p[0]+=.08;assert.equal(sample(p),null);near(s.x,-.045);
    sample(null,[0,NaN],undefined,200);assert.equal(s.hand,1);
    sample(null,[0,NaN],undefined,501);assert.equal(s.hand,-1);assert.ok(s.blocked[1]);
    sample(s.knob(model));assert.equal(s.hand,-1);
  }
});

function motion(env={}) {
  const c=V.vrSettings(env).shift,s=new V.Shifter(),m=new V.ShiftMotion(),center=V.shiftCenter('350Z');s.observe([0,0]);let now=0,actual=4;
  const sample=(d=0,{dt=20,angle=0,grip=c.gestures?0:1,out=false,busy=false}={})=>{
    const p=[...center];p[c.gestures&&c.axis?1:2]+=d;if(out)p[0]+=1;
    const pose=V.identity(),a=angle*Math.PI/180;pose[9]=-Math.sin(a);pose[10]=Math.cos(a);
    const result=m.update(c,s,now+=dt,'350Z',6,actual,[null,p],[null,pose],[0,grip],[false,busy]);
    if(result!==null)actual=result;return result;
  };
  const settle=()=>{for(let i=0;i<8;i++)assert.equal(sample(),null);};
  return {c,s,m,sample,settle,get gear(){return actual;}};
}

test('I lever settles on entry, shifts once per excursion, and supports reversed push/pull',()=>{
  for(const reverse of [false,true]) {
    const p=motion({NFSU2_VR_SHIFTER_MODE:'1',NFSU2_VR_SHIFT_REVERSE:reverse?'1':'0'});p.settle();
    assert.equal(p.sample(.05),reverse?3:5);
    for(let i=0;i<10;i++)assert.equal(p.sample(.06),null);
    assert.equal(p.sample(.025),null);assert.equal(p.sample(0),null);
    assert.equal(p.sample(-.05),4);
    p.sample(0);assert.equal(p.sample(.05,{dt:150}),null,'tracking gap rearms without shifting');
    assert.equal(p.sample(.05,{out:true}),null);assert.equal(p.s.hand,-1);
  }
});

test('single no-grip flick observes speed and travel deadzones, both axes and configurable direction',()=>{
  for(const axis of [0,1])for(const reverse of [false,true]) {
    const p=motion({NFSU2_VR_SHIFT_GESTURES:'1',NFSU2_VR_GESTURE_AXIS:String(axis),NFSU2_VR_GESTURE_REVERSE:reverse?'1':'0'});p.settle();
    for(let n=1;n<=6;n++)assert.equal(p.sample(n*.01,{dt:50}),null,'slow travel does not shift');
    p.sample(0);assert.equal(p.sample(.06),reverse?3:5);
    assert.equal(p.s.hand,-1,'gesture never captures the lever');
    p.sample(0);assert.equal(p.sample(-.06),4);
    p.sample(0);assert.equal(p.sample(.06,{busy:true}),null);
    p.sample(0);assert.equal(p.sample(.06),null,'entering zone requires settling again');
  }
});

test('double downshift needs distinct strokes within 550ms and a centered return never shifts',()=>{
  const p=motion({NFSU2_VR_SHIFT_GESTURES:'2'});p.settle();
  assert.equal(p.sample(.06),null);assert.equal(p.sample(.07),null);assert.equal(p.sample(0),null);
  assert.equal(p.sample(.06),3);p.sample(0);
  assert.equal(p.sample(-.06),4,'upshift remains a single flick');p.sample(0);
  assert.equal(p.sample(.06),null);p.sample(0);
  for(let i=0;i<30;i++)p.sample(0);
  assert.equal(p.sample(.06),null,'old first stroke expired');p.sample(0);assert.equal(p.sample(.06),3);
});

test('wrist angle alone can shift; sub-threshold angles and sudden tracking jumps cannot',()=>{
  const p=motion({NFSU2_VR_SHIFT_GESTURES:'1',NFSU2_VR_GESTURE_REVERSE:'0'});p.settle();
  assert.equal(p.sample(0,{angle:19}),null);assert.equal(p.sample(0,{angle:25}),5);
  p.sample(0);assert.equal(p.sample(0,{angle:-25}),4);
  p.sample(0);assert.equal(p.sample(.16),null,'unobserved position jump resets');
  p.sample(0,{out:true});p.settle();assert.equal(p.sample(0,{angle:80}),null,'unobserved angle jump resets');
});

test('an idle hand cannot block a sequential grip; a captured screen hand cannot shift',()=>{
  for(const gestures of [0,1]) {
    const c=V.vrSettings({NFSU2_VR_SHIFTER_MODE:'1',NFSU2_VR_SHIFT_GESTURES:String(gestures)}).shift,s=new V.Shifter(),m=new V.ShiftMotion();s.observe([0,0]);
    const center=V.shiftCenter('350Z'),p=[...center],poses=[V.identity(),V.identity()];let now=0;
    const sample=(busy=[false,false])=>m.update(c,s,now+=20,'350Z',6,4,[center,p],poses,[0,1],busy);
    for(let i=0;i<8;i++)sample();assert.equal(m.hand,1);p[2]+=.06;assert.equal(sample(),5);
  }
  const c=new V.Cockpit(V.vrSettings({NFSU2_VR_SHIFT_GESTURES:'1'}),null),sources=[source(),source()],matrix=V.identity(),model='350Z';
  matrix.set(V.shiftCenter(model),12);
  c.update({projection:V.identity(),view:V.identity(),cars:[],local:{matrix:V.identity(),model,steer:0},cockpit:true,gearbox:{epoch:1,count:6,manual:true,ready:true},telemetry:{time:1,gear:4,speed:0,rpm:1000,throttle:0,brake:0,dt:.016}});
  const mount=V.screenMount(model,c.settings),axes=V.gloveAxes(1);
  const tip=[0,1,2].map(k=>matrix[12+k]+V.gloveTip.reduce((sum,x,j)=>sum+axes[j*4+k]*x,0));
  const target=[0,1,2].map(k=>mount.matrix[12+k]-mount.matrix[4+k]*.3*mount.height+mount.matrix[8+k]*.003);
  [c.settings.screenX,c.settings.screenY,c.settings.screenZ]=tip.map((v,k)=>v-target[k]);
  for(let i=0;i<12;i++){if(i===9)matrix[14]+=.006;c.track({time:20*i+1,hands:[null,{source:sources[1],matrix}],sources});}
  assert.equal(c.shiftRequest,null);assert.equal(c.motion.hand,-1);
});

test('clutch follows neutral movement and a short shift pulse; gas/brake remain absolute',()=>{
  const p=new V.Pedals();p.update(100,true,.8,.2,1,2,false,false);assert.deepEqual(p.travel,[.8,.2,0]);
  p.update(155,true,0,1,1,1,true,false);assert.deepEqual(p.travel,[0,1,1]);
  p.update(175,true,.3,0,1,3,false,true);near(p.travel[2],1);
  p.update(275,true,.3,0,1,3,false,false);near(p.travel[2],1);
  p.update(365,true,0,0,1,3,false,false);near(p.travel[2],.5);
  p.update(455,true,0,0,1,3,false,false);near(p.travel[2],0);
  p.update(510,true,0,0,1,3,false,true);near(p.travel[2],1);
  p.update(520,true,0,0,2,3,false,false);near(p.travel[2],0,'new driver discards clutch pulse');
  p.update(530,false,1,1,2,3,true,true);assert.deepEqual(p.travel,[0,0,0]);
});

const source=()=>({gamepad:{axes:[0,0,0,0],buttons:Array.from({length:6},()=>({value:0}))}});
for(const mode of ['H','I','gesture'])test(`held throttle survives ${mode} shifts and a screen ray crossing without becoming a media click`,()=>{
  const settings=V.vrSettings(mode==='I'?{NFSU2_VR_SHIFTER_MODE:'1'}:mode==='gesture'?{NFSU2_VR_SHIFT_GESTURES:'1'}:{});
  const c=new V.Cockpit(settings,null),sources=[source(),source()],model='350Z';
  const scene={projection:V.identity(),view:V.identity(),cars:[],local:{matrix:V.identity(),model,steer:0},cockpit:true,
    gearbox:{epoch:7,count:6,manual:true,ready:true},telemetry:{time:1,gear:4,speed:20,rpm:4000,throttle:.8,brake:0,dt:.016}};
  c.update(scene);c.shifter.detent(4,6);
  const matrix=V.identity();matrix.set(mode==='H'?c.shifter.knob(model):V.shiftCenter(model),12);
  const hand={matrix,source:sources[1]},mount=V.screenMount(model,settings),ray=new Float32Array(mount.matrix);
  for(let k=0;k<3;k++)ray[12+k]+=mount.matrix[k]*.2*mount.width-mount.matrix[4+k]*.45*mount.height+mount.matrix[8+k]*.08;
  let time=0;const frame=(present=true)=>{c.update(scene);c.track({time:time+=20,hands:[null,present?hand:null],sources});};
  frame();sources[1].gamepad.buttons[0].value=.8;frame();near(c.controls.throttle,.8);
  hand.ray=ray;frame();near(c.controls.throttle,.8); // The hand points across the stereo on its way to the lever.
  if(mode!=='gesture')sources[1].gamepad.buttons[1].value=1;
  for(let i=0;i<8;i++){frame();near(c.controls.throttle,.8);}
  matrix[14]+=.06;frame();near(c.controls.throttle,.8);
  if(mode==='H'){assert.equal(c.shiftRequest,1);matrix[14]+=.06;frame();}
  assert.equal(c.shiftRequest,mode==='gesture'?3:5);near(c.controls.throttle,.8);
  sources[1].gamepad.buttons[1].value=0;frame();near(c.controls.throttle,.8);
  frame(false);frame();near(c.controls.throttle,.8);assert.equal(settings.ledColor,0,'held gas cannot click on pose recovery');
  sources[1].gamepad.buttons[0].value=0;frame();sources[1].gamepad.buttons[0].value=1;frame();
  assert.equal(c.controls.throttle,1,'a trigger aimed at the radio remains the accelerator');assert.equal(settings.ledColor,0);
  delete hand.ray;frame();assert.equal(c.controls.throttle,1,'ray visibility never owns the pedal');
  sources[1].gamepad.buttons[0].value=0;frame();sources[1].gamepad.buttons[0].value=.8;frame();near(c.controls.throttle,.8);
});

test('cockpit publishes epoch-bound requests, snaps glove to the knob and yields to buttons and focus loss',()=>{
  const c=new V.Cockpit(V.vrSettings({NFSU2_VR_SHIFT_LIGHTS:'1'}),null),sources=[source(),source()],model='350Z';
  const scene={projection:V.identity(),view:V.identity(),cars:[],local:{matrix:V.identity(),model,steer:0},cockpit:true,gearbox:{epoch:7,count:6,manual:true,ready:true},telemetry:{time:1,gear:4,speed:0,rpm:1000,throttle:0,brake:0,dt:.016}};
  c.update(scene);c.shifter.detent(4,6);const matrix=V.identity();matrix.set(c.shifter.knob(model),12);let time=0;
  const frame=()=>{c.track({time:time+=16,hands:[null,{matrix,source:sources[1]}],sources});};
  frame();sources[1].gamepad.buttons[1].value=1;frame();assert.equal(c.shifter.hand,1);
  assert.deepEqual(c.fingers,[0,0,1,0]);
  matrix[14]+=.06;frame();assert.equal(c.shiftRequest,1);assert.equal(c.gearCommand,(7<<8)|128|2);
  matrix[12]-=.045;matrix[14]-=.06;frame();assert.equal(c.shiftRequest,2);
  const hand=c.handMatrix(1),knob=c.shifter.knob(model);for(let k=0;k<3;k++)near(hand[12+k],knob[k]);
  scene.telemetry={...scene.telemetry,time:2,gear:1};c.update(scene);
  scene.telemetry={...scene.telemetry,time:3,gear:2};c.update(scene);assert.deepEqual(c.led().slice(0,3),[40/255,123/255,1],'downshift through neutral flashes blue');
  sources[1].gamepad.axes[3]=-1;frame();assert.equal(c.shiftRequest,2);assert.equal(c.gearCommand,(7<<8)|128|3,'world interactions do not shift or release the physical lever');
  sources[1].gamepad.axes[3]=0;for(let i=0;i<8;i++)frame();
  sources[0].gamepad.buttons[4].value=1;frame();assert.equal(c.shiftRequest,null);assert.equal(c.gearCommand&15,0);
  sources[0].gamepad.buttons[4].value=0;scene.gearbox.epoch=8;frame();assert.equal(c.shiftRequest,null);assert.equal(c.shifter.hand,-1);
  scene.gearbox.manual=false;frame();assert.equal(c.gearCommand,0);
  c.track(null);assert.equal(c.controls,null);assert.equal(c.gearCommand,0);
});

test('grid control intent starts before ready; neutral and first selection survive GO without dropping the lever',()=>{
  const c=new V.Cockpit(V.vrSettings({}),null),sources=[source(),source()],model='350Z';
  const scene={projection:V.identity(),view:V.identity(),cars:[],local:{matrix:V.identity(),model,steer:0},cockpit:true,gearbox:{epoch:9,count:6,manual:true,ready:false},telemetry:{time:1,gear:1,speed:0,rpm:1000,throttle:0,brake:1,dt:.016}};
  const matrix=V.identity();matrix.set(V.shiftCenter(model),12);let time=0;
  const frame=()=>{c.update(scene);c.track({time:time+=16,hands:[null,{matrix,source:sources[1]}],sources});};
  frame();assert.equal(c.gearCommand,(9<<8)|128,'advertises intent while retail driver is locked');
  Object.assign(scene.gearbox,{epoch:10,ready:true,firstOnly:true,countdown:true,selected:1});frame();
  sources[1].gamepad.buttons[1].value=1;frame();assert.equal(c.shifter.hand,1);
  matrix[14]-=.06;frame();assert.equal(c.shiftRequest,null,'third cannot launch');assert.equal(c.shifter.gear,1);
  matrix[14]+=.06;frame();matrix[12]-=.045;frame();matrix[14]-=.06;frame();
  assert.equal(c.shiftRequest,2);assert.equal(c.gearCommand,(10<<8)|128|3);
  scene.gearbox.selected=2;frame();assert.equal(c.shifter.gear,2);
  scene.gearbox.countdown=false;scene.gearbox.firstOnly=false;scene.telemetry.gear=2;frame();
  assert.equal(c.shifter.hand,1,'GO preserves grip');assert.equal(c.shiftRequest,2);
  matrix[14]+=.06;frame();matrix[14]+=.06;frame();assert.equal(c.shiftRequest,3,'second becomes available after launch');
  sources[0].gamepad.buttons[4].value=1;frame();assert.equal(c.gearCommand,0,'buttons yield the entire grid owner');
  sources[0].gamepad.buttons[4].value=0;c.settings.handControls=false;frame();assert.equal(c.gearCommand,0);
  c.settings.handControls=true;c.track({time:time+16,hands:[null,null],sources:[null,null]});assert.equal(c.gearCommand,0);
});

test('remote lever and pedals are bounded, optional and smoothly interpolated',()=>{
  const a={...V.flatDriver(),shifter:[-.045,-.06],pedals:[0,.2,1]},b={...a,shifter:[.045,.06],pedals:[1,.8,0]};
  assert.ok(V.validAvatar(a));assert.ok(V.validAvatar(V.flatDriver()));
  for(const field of [{shifter:[.101,0]},{shifter:[0,NaN]},{shifter:[0]},{pedals:[0,1.1,0]},{pedals:[0,-.1,0]},{pedals:[0,0,Infinity]}])assert.equal(V.validAvatar({...a,...field}),false);
  const p=V.driverPose({previous:a,current:b,at:100,before:0},150);near(p.shifter[0],0);near(p.shifter[1],0);p.pedals.forEach(v=>near(v,.5));
});

test('guide lies above the fitted knob and follows manual/near-zone visibility without a grip',()=>{
  const c=new V.Cockpit(V.vrSettings({}),null),g=new V.ShifterGuide();
  c.scene={gearbox:{count:6,manual:true,ready:true}};assert.ok(g.visible(c));
  c.settings.shiftGuide=2;assert.equal(g.visible(c),false);c.motion.zones[1]=true;assert.ok(g.visible(c));
  c.settings.shiftGuide=0;assert.equal(g.visible(c),false);c.settings.shiftGuide=1;c.scene.gearbox.manual=false;assert.equal(g.visible(c),false);
  for(const model of ['350Z','SKYLINE'])for(const count of [4,5,6]) {
    const m=V.guideMount(model,count,false),center=V.shiftCenter(model);
    near(m.matrix[13],center[1]+.045);near(m.matrix[14],center[2]);assert.ok(m.matrix[0]>0&&m.matrix[6]<0,'same left/right and forward/back labels in both cars');
    near(m.matrix[12]-m.offset,center[0]);
  }
});
