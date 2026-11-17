import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
const js = (await esbuild.build({ stdin: { contents: `export * from './src/vr/drivers'; export * from './src/vr/settings'; export * from './src/vr/math';export * from './src/vr/protocol';export * from './src/vr/glove-tip';`,
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, format: 'esm', write: false })).outputFiles[0].text;
const D = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const near = (a,b) => a.forEach((x,i) => assert.ok(Math.abs(x-b[i]) < 1e-5, `${i}: ${x} != ${b[i]}`));
test('driver frame validates bounds, carries the rendered body transform and sender VIP', () => {
  const b = new ArrayBuffer(8192), at = D.SCENE_OFFSET;
  new Uint32Array(b,at,4).set([0x3152564e,0,1,1]);
  new Float32Array(b,at+16,16).set(D.identity()); new Float32Array(b,at+144,16).set(D.identity());
  new Uint32Array(b,at+208,2).set([0x7f000102,42]); new Float32Array(b,at+224,16).set(D.identity());
  new Uint8Array(b,at+288,6).set(new TextEncoder().encode('PEUGOT'));
  const scene = D.readDriverScene(b,0,b.byteLength); assert.equal(scene.cars[0].vip,0x7f000102); assert.equal(scene.cars[0].model,'PEUGOT');
  near(D.cabinMatrix(scene.cars[0]), [0,-1,0,0, 0,0,1,0, -1,0,0,0, -.1,.35,.95,1]);
  assert.equal(D.readDriverScene(b,0,2092), null);
  new Uint32Array(b,at+8,1)[0] = 65; assert.equal(D.readDriverScene(b,0,b.byteLength),null);
  new Uint32Array(b,at+8,1)[0] = 1; new Float32Array(b,at+224,1)[0] = NaN;
  assert.equal(D.readDriverScene(b,0,b.byteLength).cars.length,0);
});
test('driver poses blend shortest rotations and disappear on lost tracking or opt-out', () => {
  const a = D.flatDriver(), b = D.flatDriver(); b.vr = a.vr = true; b.head.p[0] = .4; b.head.q[3] = -1;
  const packet = { previous:a,current:b,before:100,at:200,seq:1 };
  near(D.driverPose(packet,250).head.p,[.2,0,0]); near(D.driverPose(packet,250).head.q,[0,0,0,1]);
  assert.equal(D.driverPose(packet,701),null);
  assert.equal(D.driverPose({...packet,current:null},250),null);
  assert.equal(D.driverPose({...packet,current:{...b,left:null}},250).left,null);
  near(D.driverPose({...packet,current:{...b,car:88}},250).head.p,b.head.p);
});

test('co-op frame has independent endpoint identities and an owned second car snapshot',()=>{
  const buffer=new ArrayBuffer(16384),p=D.SCENE_OFFSET,local=p+6352,second=p+13664,length=p+13768,u=new Uint32Array(buffer);
  new Uint32Array(buffer,p,4).set([0x3152564e,0,0,7]);
  new Float32Array(buffer,p+16,16).set(D.identity());new Float32Array(buffer,p+144,16).set(D.identity());
  new Float32Array(buffer,local+16,16).set(D.identity());u[(local+4)/4]=77;u[(local+96)/4]=1;
  const matrix=D.identity();matrix[12]=3;new Float32Array(buffer,second+16,16).set(matrix);
  u[(second+4)/4]=88;u[(second+96)/4]=1;new Float32Array(buffer,second+8,1)[0]=.25;
  new Uint8Array(buffer,second+80,4).set(new TextEncoder().encode('RX8\0'));
  const scene=D.readDriverScene(buffer,0,length);assert.equal(scene.local.peer,77);assert.equal(scene.secondary.peer,88);
  assert.equal(scene.secondary.model,'RX8');assert.equal(scene.secondary.steer,.25);near(scene.secondary.matrix,matrix);
  new Float32Array(buffer,second+16,1)[0]=NaN;assert.equal(D.readDriverScene(buffer,0,length).secondary,undefined);near(scene.secondary.matrix,matrix);
  new Float32Array(buffer,second+16,16).set(matrix);u[(second+4)/4]=0;
  assert.equal(D.readDriverScene(buffer,0,length).secondary.peer,0,'offline co-op is still a local car');
  assert.equal(D.readDriverScene(buffer,0,length-1),null);
  u[(second+96)/4]=2;assert.equal(D.readDriverScene(buffer,0,length).secondary,undefined);
  u[(second+96)/4]=1;u[(local+96)/4]=0;assert.equal(D.readDriverScene(buffer,0,length).secondary,undefined);
  u[(local+96)/4]=1;u[(p+12)/4]=6;assert.equal(D.readDriverScene(buffer,0,p+13664).secondary,undefined);
});

test('two drivers sharing a browser are matched to their own cars and can opt out separately',()=>{
  const primary={...D.flatDriver(),car:77,vr:true},secondary={...D.flatDriver(),car:88};
  const state=current=>({current,previous:current,at:100,before:100,seq:1});
  const remote={...state(primary),secondary:state(secondary)},car=peer=>({peer,vip:7,model:'RX8',steer:0,matrix:D.identity()});
  assert.equal(D.driverForCar(remote,car(77),false,100).vr,true);
  assert.equal(D.driverForCar(remote,car(88),false,100).vr,false);
  assert.equal(D.driverForCar(remote,car(99),false,100),null);
  assert.equal(D.driverForCar(state(primary),car(88),false,100),null);
  assert.equal(D.driverForCar({...remote,current:null},car(88),false,100).car,88);
  assert.equal(D.driverForCar(remote,car(88),false,601),null);
  const race=state(D.flatDriver());assert.equal(D.driverForCar(race,car(77),false,100),null);
  assert.equal(D.driverForCar(race,car(77),true,100).car,0);
});

test('player cameras have bounded owned snapshots and never reuse a vanished split view',()=>{
  const b=new ArrayBuffer(16384),p=D.SCENE_OFFSET,length=p+14416,u=new Uint32Array(b),identity=D.identity();
  new Uint32Array(b,p,4).set([0x3152564e,0,0,8]);
  new Float32Array(b,p+16,16).set(identity);new Float32Array(b,p+144,16).set(identity);
  for(let slot=1;slot<6;slot++){
    const at=p+13768+(slot-1)*128,matrix=D.identity();matrix[12]=slot;
    new Float32Array(b,at,16).set(matrix);new Float32Array(b,at+64,16).set(identity);
  }
  u[(p+14408)/4]=63;const scene=D.readDriverScene(b,0,length);
  assert.deepEqual(scene.views.map(v=>v.view[12]),[0,1,2,3,4,5]);
  assert.deepEqual([1,2,5,6,7,8,0,3,4,9].map(D.driverViewSlot),[0,1,2,3,4,5,-1,-1,-1,-1]);
  new Float32Array(b,p+13768,1)[0]=NaN;assert.equal(D.readDriverScene(b,0,length).views[1],null);
  assert.equal(scene.views[1].view[0],1,'a later shared-memory frame cannot overwrite a camera');
  u[(p+14408)/4]=1;assert.equal(D.readDriverScene(b,0,length).views[5],null);
  u[(p+14408)/4]=64;assert.equal(D.readDriverScene(b,0,length),null);
  assert.equal(D.readDriverScene(b,0,length-1),null);
});
test('seat and world scale affect head, eyes and hands equally', () => {
  const settings = D.vrSettings({NFSU2_VR_WORLD_SCALE:'50',NFSU2_VR_SEAT_HEIGHT:'12',NFSU2_VR_SEAT_FORWARD:'8'});
  const head = D.identity(); head.set([.1,.2,.3],12);
  near(D.adjustedPose(head,settings).slice(12,15),[.2,.52,.52]);
  assert.equal(D.vrSettings({NFSU2_VR_WORLD_SCALE:'NaN'}).scale,1);
});
test('authored cockpit and glove packs contain finite, bounded indexed meshes', async () => {
  for (const name of ['cabin','glove']) {
    const bytes = await readFile(new URL(`../src/static/vr-${name}.nvwm`,import.meta.url));
    const buf = bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength), mesh = D.meshData(buf);
    assert.ok(mesh.indices.length > 10000); assert.ok(mesh.vertices.every(Number.isFinite));
    assert.throws(() => D.meshData(buf.slice(0,-4)));
    new Uint32Array(buf,16+mesh.vertices.byteLength,1)[0] = 999999; assert.throws(() => D.meshData(buf));
  }
});

test('hand weights are bounded, optional for legacy drivers, interpolated and respect tracking loss',()=>{
  const a={...D.flatDriver(),fingers:[0,0,1,0]},b={...D.flatDriver(),fingers:[1,1,0,0]};
  assert.ok(D.validAvatar(a));assert.ok(D.validAvatar(D.flatDriver()));
  for(const fingers of [[0,0,0],[0,0,0,0,0],[-.1,0,0,0],[0,1.1,0,0],[0,NaN,0,0],[0,Infinity,0,0],['1',0,0,0],null])assert.equal(D.validAvatar({...a,fingers}),false);
  const r={previous:a,current:b,before:100,at:200,seq:1};
  near(D.driverPose(r,250).fingers,[.5,.5,.5,0]);
  assert.equal(D.driverPose({...r,current:{...b,left:null}},250).left,null);
  assert.equal(D.driverPose({...r,current:D.flatDriver()},250).fingers,undefined);
});

test('glove v2 retains matching open vertices and the native pointing index pad',async()=>{
  const bytes=await readFile(new URL('../src/static/vr-glove.nvwm',import.meta.url)),buf=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),m=D.meshData(buf);
  assert.equal(m.opened.length,m.vertices.length);let tip=[0,0,0],moved=0;
  for(let i=0;i<m.opened.length;i+=8){
    const x=m.opened[i],weight=Math.max(0,Math.min(1,(x+.065)/.011,(-.009-x)/.008));
    if(weight===1&&m.opened[i+1]>tip[1])tip=Array.from(m.opened.slice(i,i+3));
    if(Math.hypot(...m.opened.slice(i,i+3).map((v,k)=>v-m.vertices[i+k]))>.02)moved++;
    near(m.opened.slice(i+6,i+8),m.vertices.slice(i+6,i+8));
  }
  assert.ok(moved>1000);near(tip,D.gloveTip);
  m.opened[0]=NaN;assert.throws(()=>D.meshData(buf),/pose/);
});
