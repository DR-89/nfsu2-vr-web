import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
const load = async name => import('data:text/javascript;base64,' + Buffer.from((await esbuild.build({
  entryPoints: [new URL(`../src/vr/${name}.ts`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')],
  bundle: true, format: 'esm', write: false,
})).outputFiles[0].text).toString('base64'));
const M = await load('math'), P = await load('protocol'), { ModMultiplayer } = await load('multiplayer');
const {rotationWarp}=await load('reprojection');
const close = (a, b) => { assert.equal(a.length, b.length); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-5, `${i}: ${v} != ${b[i]}`)); };

test('one connection carries two independently matched driver streams with bounded secondary packets',()=>{
  const sent=[],c=new ModMultiplayer(m=>{sent.push(m);return true;},'a',false);
  const pose=car=>({car,cockpit:0,vr:false,head:null,left:null,right:null}),primary=pose(77),secondary=pose(88);
  c.receive({op:'joined',version:1,you:1,room:'a'},0);
  c.tick(100,primary,null,secondary);assert.deepEqual(sent.at(-1).secondary,secondary);
  const packet={op:'avatar',from:2,seq:1,avatar:primary,secondary};
  assert.deepEqual(P.decodeMod(P.encodeMod(packet)),packet);
  c.receive(packet,100);assert.equal(c.avatars.get(2).current.car,77);assert.equal(c.avatars.get(2).secondary.current.car,88);
  c.receive({...packet,seq:2,avatar:null},200);assert.equal(c.avatars.get(2).current,null);assert.equal(c.avatars.get(2).secondary.current.car,88);
  c.receive({...packet,seq:3,secondary:undefined},300);assert.equal(c.avatars.get(2).secondary,undefined);
  c.receive(packet,301);assert.equal(c.avatars.get(2).secondary,undefined,'old packets cannot restore the second driver');
  for(const value of [pose(0),pose(77),{...secondary,head:{p:[99,0,0],q:[0,0,0,1]}},[]])assert.equal(P.decodeMod(P.encodeMod({...packet,secondary:value})),null);
  c.receive({...packet,seq:4},400);c.receive({op:'gone',from:2},450);assert.equal(c.avatars.size,0);
  c.tick(500,null);assert.equal(sent.at(-1).avatar,null);assert.equal(sent.at(-1).secondary,undefined);
});

test('VR uses two eye positions and asymmetric WebGPU projections without remapping depth', () => {
  const game = new Float32Array([1,0,0,0, 0,-1,0,0, 0,0,1,1, 0,0,-.1,0]);
  const eyeProjection = M.multiply(game, M.GAME_TO_XR);
  close(M.eyeCorrection(eyeProjection, M.identity(), M.identity(), game), M.identity());
  const left = M.identity(), right = M.identity(); left[12] = .032; right[12] = -.032;
  const l = M.eyeCorrection(eyeProjection, left, M.identity(), game), r = M.eyeCorrection(eyeProjection, right, M.identity(), game);
  assert.notDeepEqual([...l], [...r]);
  eyeProjection[8] = .12;
  assert.notDeepEqual([...M.eyeCorrection(eyeProjection, left, M.identity(), game)], [...l]);
});
test('late eye pose cancels the recorded head pose, inverse rejects invalid matrices', () => {
  const head = M.identity(); head[12] = .25; head[13] = -.12;
  close(M.multiply(head, M.inverse(head)), M.identity());
  assert.equal(M.inverse(new Float32Array(16)), null);
  const invalid = M.identity(); invalid[5] = NaN; assert.equal(M.inverse(invalid), null);
});
test('cached eye reprojection cancels new rotation, preserves asymmetric optics and ignores translation',()=>{
  for(const eye of [-.12,.12]){
    const projection=new Float32Array([1.3,0,0,0,0,1.1,0,0,eye,.03,-1,-1,0,0,-.05,0]);
    const recorded={projection,view:M.identity()},view=M.identity(),angle=.3;
    view[0]=view[10]=Math.cos(angle);view[2]=-Math.sin(angle);view[8]=Math.sin(angle);
    const warp=rotationWarp(recorded,{projection,view});
    close(M.multiply(warp,M.multiply(projection,view)),projection);
    view[12]=10;view[13]=-5;view[14]=2;close(rotationWarp(recorded,{projection,view}),warp);
    close(rotationWarp(recorded,recorded),M.identity());
  }
});
test('legacy XR projection maps near/far depth into WebGPU without changing x/y', () => {
  const p = new Float32Array([2,0,0,0, 0,3,0,0, .2,.1,-1.02,-1, 0,0,-.202,0]);
  const gpu = M.webGLProjection(p);
  for (const [z, wanted] of [[-.1, 0], [-10.1, 1]]) {
    const depth = (gpu[10] * z + gpu[14]) / (gpu[11] * z);
    assert.ok(Math.abs(depth - wanted) < 1e-5);
  }
  for (const i of [0, 5, 8, 9, 11]) assert.equal(gpu[i], p[i]);
});
test('the retail sky far plane remains inside XR depth after float32 projection inversion',()=>{
  const n=M.XR_DEPTH_NEAR,f=M.XR_DEPTH_FAR;
  const xr=M.webGLProjection(new Float32Array([1,0,0,0,0,1,0,0,0,0,-(f+n)/(f-n),-1,0,0,-2*f*n/(f-n),0]));
  for(const far of [10000,15000,30000]){
    const guest=new Float32Array([1,0,0,0,0,-1,0,0,0,0,far/(far-.03),1,0,0,-.03*far/(far-.03),0]);
    const delta=M.eyeCorrection(xr,M.identity(),M.identity(),guest),sky=[.2,-.1,1,1];
    const out=[0,1,2,3].map(r=>sky.reduce((s,v,k)=>s+delta[k*4+r]*v,0));
    assert.ok(out[2]>0&&out[2]<=out[3],JSON.stringify({far,out}));
  }
});
test('stereo shader changes vertex output only', () => {
  const fragment = '@fragment fn main() -> vec4f { return vec4f(1.0); }';
  assert.equal(M.vertexStereo(fragment), fragment);
  const shader = M.vertexStereo('@vertex fn vs_1() -> VOut { var o: VOut; return o; }');
  assert.match(shader, /@binding\(4\)/); assert.match(shader, /XREye \* o.pos/);
});
const wire = event => { const b = new TextEncoder().encode(JSON.stringify(event)), out = new Uint8Array(b.length + 4); out[0] = 34; out.set(b, 4); return out; };
test('mod wire rejects malformed headers, oversized frames and invalid poses', () => {
  const good = wire({ op: 'avatar', from: 1, seq: 2, avatar: { car: 9, cockpit: 0, vr: false, head: null, left: null, right: null } });
  assert.equal(P.decodeMod(good)?.avatar.vr, false);
  good[1] = 1; assert.equal(P.decodeMod(good), null);
  assert.equal(P.decodeMod(new Uint8Array(16389)), null);
  assert.equal(P.validPose({ p: [99,0,0], q: [0,0,0,1] }), false);
  assert.equal(P.validPose({ p: [0,0,0], q: [0,0,0,0] }), false);
  assert.equal(P.validPolice({ epoch: 1, tick: 1, cars: [{ id: 0 }] }), false);
});
test('mixed display clients share avatars; disconnect clears authority and tracking', () => {
  const sent = []; let online = true;
  const client = new ModMultiplayer(m => { if (!online) return false; sent.push(m); return true; }, 'room', true);
  client.tick(0, null); assert.equal(sent[0].op, 'join');
  client.receive({ op: 'joined', version: 1, you: 7, room: 'room' }, 5);
  client.receive({ op: 'authority', host: 7, epoch: 2, police: null }, 6);
  assert.equal(client.authority, true);
  client.receive({ op: 'avatar', from: 8, seq: 1, avatar: { car: 10, cockpit: 0, vr: false, head: null, left: null, right: null } }, 10);
  assert.equal(client.avatars.get(8).current.vr, false);
  client.tick(100, null, { epoch: 1, tick: 1, cars: [] }); assert.equal(sent.at(-1).police, null);
  client.tick(200, null, { epoch: 2, tick: 1, cars: [] }); assert.equal(sent.at(-1).police.epoch, 2);
  client.tick(300, null, { epoch: 2, tick: 1, cars: [] }); assert.equal(sent.at(-1).police, null);
  online = false; client.tick(400, null);
  assert.equal(client.authority, false); assert.equal(client.avatars.size, 0);
});
test('opt-out clients discard police, stale tracking expires and room changes leave first', () => {
  const sent = [], client = new ModMultiplayer(m => { sent.push(m); return true; }, 'a', false);
  client.receive({ op: 'joined', version: 1, you: 1, room: 'a' }, 0);
  client.receive({ op: 'authority', host: 1, epoch: 1, police: { epoch: 1, tick: 1, cars: [] } }, 1);
  assert.equal(client.police, null); assert.equal(client.authority, false);
  client.receive({ op: 'avatar', from: 2, seq: 1, avatar: null }, 10);
  client.tick(2100, null); assert.equal(client.avatars.size, 0);
  client.configure('b', true); assert.equal(sent.at(-1).op, 'leave');
  client.tick(2200, null); assert.equal(sent.at(-1).room, 'b');
});
test('a sleeping client relinquishes a stale lease and rejoins over the same socket', () => {
  const sent = [], c = new ModMultiplayer(m => { sent.push(m); return true; }, 'room', true);
  c.receive({ op: 'joined', version: 1, you: 1, room: 'room' }, 0);
  c.receive({ op: 'authority', host: 1, epoch: 1, police: null }, 1);
  c.tick(100, null);
  c.receive({ op: 'ack', seq: 0 }, 110);
  c.tick(2000, null); assert.equal(c.authority, true);
  c.tick(2200, null, { epoch: 1, tick: 1, cars: [] });
  assert.equal(c.authority, false);
  assert.equal(sent.at(-2).op, 'leave'); assert.equal(sent.at(-1).op, 'join');
});

test('LAN consent follows bounded fresh original race peers and clears on world change', () => {
  const sent=[],c=new ModMultiplayer(m=>{sent.push(m);return true;},'world');
  c.receive({op:'joined',version:1,you:1,room:'world'},0);
  c.race([1,2,2,3,0,-1,NaN,0x100000000],10);c.tick(10,null);
  c.receive({op:'joined',version:1,you:1,room:c.room},11);c.tick(100,null);
  assert.deepEqual(sent.at(-1).peers,[2,3]);
  c.receive({op:'ack',seq:0},101);c.tick(1010,null);assert.deepEqual(sent.at(-1).peers,[]);
  c.race([2,3],1100);c.configure('elsewhere',false);c.tick(1200,null);
  c.receive({op:'joined',version:1,you:1,room:'elsewhere'},1201);c.tick(1300,null);
  assert.deepEqual(sent.at(-1).peers,[]);
});
