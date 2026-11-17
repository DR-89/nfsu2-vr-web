import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/mirror-grip';export * from './src/vr/mirrors';export * from './src/vr/mirror-profiles';export * from './src/vr/cockpit';export * from './src/vr/settings';export * from './src/vr/math';export * from './src/vr/drivers';export {checkSetting,DEFAULTS,KEYS} from './src/app/settings';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const near=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const rotation=(pitch,yaw)=>V.poseMatrix({p:[0,0,0],q:[Math.sin(pitch/2)*Math.cos(yaw/2),Math.cos(pitch/2)*Math.sin(yaw/2),-Math.sin(pitch/2)*Math.sin(yaw/2),Math.cos(pitch/2)*Math.cos(yaw/2)]});
function rig(part=0,side=0){
  const s=V.vrSettings({}).mirrors,g=new V.MirrorGrip(),m={center:[.3,.15,-.4],half:[.12,.04,.01]},mounts=[null,null,null];mounts[part]=m;
  const poses=[null,null],grip=[NaN,NaN],busy=[false,false];poses[side]=V.identity();poses[side].set([.38,.17,-.4],12);let time=0;
  const step=(v,dt=16)=>{grip[side]=v;return g.update(s,mounts,time+=dt,poses,grip,busy);};
  step(0);step(1);assert.equal(g.hand,side);assert.equal(g.part,part);
  return {s,g,m,poses,grip,busy,mounts,step,side};
}
test('mirror wrist turns are absolute and independent of hand, with linked opposite outside yaw',()=>{
  for(const part of [0,1,2])for(const side of [0,1]){
    const r=rig(part,side),a=part===0?r.s.inside:r.s.outside,p=r.poses[side],pos=Array.from(p.slice(12,15));
    p.set(rotation(.1,.2));p.set(pos,12);for(let i=0;i<80;i++)r.step(1);
    assert.ok(a.pitch>.04&&a.pitch<.05);assert.ok((part===1?-a.yaw:a.yaw)>.08);
    const settled={...a};for(let i=0;i<80;i++)r.step(1);near(a.yaw,settled.yaw);near(a.pitch,settled.pitch);
    const left=V.mirrorAngle(r.s,1),right=V.mirrorAngle(r.s,2);near(left.yaw,-right.yaw);near(left.pitch,right.pitch);
    assert.equal(r.step(0),true);assert.equal(r.g.release(r.s),false);
  }
});
test('pushing a fixed contact edge reaches mechanical stops, with equal 35 ms response at different rates',()=>{
  const ends=[];
  for(const dt of [5,10,20]){
    const r=rig();r.poses[0][14]+=.09;r.step(1,1);r.poses[0][14]+=.05;for(let t=0;t<200;t+=dt)r.step(1,dt);
    ends.push([r.s.inside.yaw,r.s.inside.pitch]);
    assert.ok(r.s.inside.yaw<-.17);assert.ok(r.s.inside.pitch>0);
    for(let i=0;i<200;i++)r.step(1);near(r.s.inside.yaw,-V.mirrorStops.yaw);
  }
  for(const e of ends.slice(1))e.forEach((v,k)=>near(v,ends[0][k]));
});
test('tracking loss, jumps, clock gaps and large turns rebase without changing the angle',()=>{
  const r=rig();r.poses[0][14]+=.02;r.step(1);const a={...r.s.inside},pose=r.poses[0];
  r.poses[0]=null;r.step(1);assert.equal(r.g.hand,0);pose[12]+=1;r.poses[0]=pose;r.step(1);assert.deepEqual(r.s.inside,a);
  pose[13]+=.5;r.step(1);assert.deepEqual(r.s.inside,a);
  const pos=Array.from(pose.slice(12,15));pose.set(rotation(0,2));pose.set(pos,12);r.step(1);assert.deepEqual(r.s.inside,a);
  pose[12]+=.05;r.step(1,300);assert.deepEqual(r.s.inside,a);
  r.step(NaN,400);assert.equal(r.g.hand,0);r.step(NaN,101);assert.equal(r.g.hand,-1);
  r.step(1);assert.equal(r.g.hand,-1,'lost input requires release before reacquiring');
});
test('grips use the nearest rotated glass, release on ownership loss, and save only real changes',()=>{
  const r=rig();assert.equal(r.g.release(r.s),false);r.step(1);assert.equal(r.g.hand,-1);
  r.step(0);r.step(1);r.poses[0][14]+=.02;r.step(1);r.busy[0]=true;assert.equal(r.step(1),true);assert.equal(r.g.hand,-1);
  r.busy[0]=false;r.step(1);assert.equal(r.g.hand,-1);r.step(0);r.step(1);assert.equal(r.g.hand,0);
  assert.equal(r.g.block(0,r.s),false);r.step(1);assert.equal(r.g.hand,-1);
  r.poses[0][12]+=1;r.step(0);r.step(1);assert.equal(r.g.hand,-1,'distant hand cannot grab a mirror');
  r.poses[0].set(r.m.center,12);r.step(1);assert.equal(r.g.hand,0);r.mounts[0]=null;assert.equal(r.step(1),false);assert.equal(r.g.hand,-1);
});
test('website mirror values validate, retain fractional degrees, clamp to native stops and travel with the profile',()=>{
  for(const n of [256,512,1024,2048,4096])assert.equal(V.vrSettings({NFSU2_VR_MIRROR_RESOLUTION:String(n)}).mirrorResolution,n);
  for(const n of ['999','NaN','-1'])assert.equal(V.vrSettings({NFSU2_VR_MIRROR_RESOLUTION:n}).mirrorResolution,1024);
  const s=V.vrSettings({NFSU2_VR_MIRROR_INSIDE_YAW:'5.125',NFSU2_VR_MIRROR_OUTSIDE_PITCH:'-999',NFSU2_VR_MIRROR_INSIDE_PITCH:'NaN'});
  near(s.mirrors.inside.yaw,5.125*Math.PI/180);near(s.mirrors.outside.pitch,-V.mirrorStops.pitch);assert.equal(s.mirrors.inside.pitch,0);
  for(const key of ['vr_mirror_inside_yaw','vr_mirror_outside_yaw','vr_mirror_inside_pitch','vr_mirror_outside_pitch']){
    const value=V.checkSetting(key,'-5.125');assert.equal(value.value,'-5.125');assert.equal(V.checkSetting(key,'100').ok,false);
    assert.equal(V.DEFAULTS.get(key),'0');assert.equal(V.KEYS.find(k=>k.key===key).device,undefined);
  }
});
function scene(){
  const local={vip:0,peer:0,model:'350Z',matrix:V.identity(),steer:0},fit=V.fitFor(local.model),raw=new Float32Array([.2,.1,-.4,.4,.1,-.4,.4,.2,-.4,.2,.1,-.4,.4,.2,-.4,.2,.2,-.4]);
  for(let i=0;i<raw.length;i++)raw[i]-=[fit[1],-fit[2],fit[0]][i%3];
  return {projection:V.identity(),view:V.identity(),cars:[],local,cockpit:true,mirrors:{active:true,car:1,glass:[raw,new Float32Array(),new Float32Array()]},telemetry:{time:1,speed:0,rpm:900,throttle:0,brake:0,gear:2,dt:.016},gearbox:{epoch:1,manual:true,ready:true,count:6}};
}
test('cockpit mirror ownership captures trigger, blocks other grips and saves once on interruption',()=>{
  const saved=[],s=V.vrSettings({}),c=new V.Cockpit(s,null,x=>saved.push(x));c.update(scene());
  const h={matrix:V.identity(),source:{gamepad:{buttons:Array.from({length:6},()=>({value:0})),axes:[0,0,0,0]}}};h.matrix.set([.38,.15,-.4],12);
  c.track({time:1,hands:[null,h]});h.source.gamepad.buttons[1].value=1;c.track({time:17,hands:[null,h]});assert.equal(c.mirrorGrip.hand,1);
  h.matrix[14]+=.02;h.source.gamepad.buttons[0].value=1;c.track({time:33,hands:[null,h]});assert.equal(c.controls.throttle,0);assert.equal(c.shifter.hand,-1);assert.equal(c.screenGrip.hand,-1);assert.equal(c.wheel.grabbed[1],false);assert.deepEqual(c.fingers,[0,0,1,0]);
  assert.ok(c.mirrors.inside.yaw<0);c.track(null);c.track(null);assert.equal(saved.length,1);assert.equal(Object.keys(saved[0]).length,4);
  const restored=V.vrSettings(Object.fromEntries(Object.entries(saved[0]).map(([k,v])=>['NFSU2_'+k.toUpperCase(),v])));near(V.mirrorFor(restored,'350Z').inside.yaw,c.mirrors.inside.yaw,1e-7);
  const old=c.mirrors.inside.yaw,next=scene();next.local={...next.local,model:'SKYLINE'};c.update(next);assert.equal(c.mirrors.inside.yaw,0);
  c.mirrors.inside.yaw=.05;c.update(scene());near(c.mirrors.inside.yaw,old);assert.equal(s.mirrors.inside.yaw,0,'model adjustment never changes new-car defaults');
});
test('mirror profiles retain independent car angles, partial overrides and a safe unknown-car fallback',()=>{
  const s=V.vrSettings({NFSU2_VR_MIRROR_INSIDE_YAW:'2',NFSU2_VR_MIRROR_350Z_INSIDE_YAW:'-4',NFSU2_VR_MIRROR_SKYLINE_OUTSIDE_PITCH:'3'});
  near(V.mirrorFor(s,'350Z').inside.yaw,-4*Math.PI/180);near(V.mirrorFor(s,'SKYLINE').inside.yaw,2*Math.PI/180);near(V.mirrorFor(s,'SKYLINE').outside.pitch,3*Math.PI/180);
  V.mirrorFor(s,'A3').inside.yaw=.15;near(V.mirrorFor(s,'DEFAULT').inside.yaw,2*Math.PI/180);
  assert.equal(V.mirrorFor(s,'__proto__'),s.mirrors);assert.equal(V.mirrorKey('unknown','inside_pitch'),'vr_mirror_inside_pitch');
  for(const model of V.mirrorModels)for(const field of V.mirrorFields){const key=V.mirrorKey(model,field);assert.equal(V.checkSetting(key,'4.125').ok,true);assert.equal(V.checkSetting(key,'100').ok,false);}
});
