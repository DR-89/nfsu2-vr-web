import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/panel-grip';export * from './src/vr/cockpit';export * from './src/vr/math';export * from './src/vr/settings';export * from './src/vr/drivers';export * from './src/vr/gps';export * from './src/input/proto';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const point=(m,p)=>[0,1,2].map(k=>m[12+k]+p.reduce((n,v,j)=>n+m[j*4+k]*v,0));
const near=(a,b)=>a.forEach((v,k)=>assert.ok(Math.abs(v-b[k])<2e-6,`${a} != ${b}`));
const rotation=(pitch,yaw)=>V.poseMatrix({p:[0,0,0],q:[Math.sin(pitch/2)*Math.cos(yaw/2),Math.cos(pitch/2)*Math.sin(yaw/2),-Math.sin(pitch/2)*Math.sin(yaw/2),Math.cos(pitch/2)*Math.cos(yaw/2)]});
test('both grips anchor the contact point while moving/turning; resizing scales only the screen contact plane',()=>{
  for(const kind of ['map','screen'])for(const model of ['350Z','SKYLINE','A3'])for(const side of [0,1]){
    const s=V.vrSettings({}),p=V.placement(s,kind),g=new V.PanelGrip(kind),m=V.panelMount(model,kind,p),contact=[.04,.018,.025];
    const initial=rotation(.4,3.05),poses=[null,null],squeeze=[NaN,NaN];initial.set(point(m.matrix,contact),12);poses[side]=initial;squeeze[side]=0;
    g.update(model,p,poses,squeeze,[false,false],.016,0);assert.equal(g.hover[side],true);
    squeeze[side]=1;g.update(model,p,poses,squeeze,[false,false],.016,0);assert.equal(g.hand,side);
    const current=V.multiply(rotation(.12,.28),initial);current.set([initial[12]+.15,initial[13]+.08,initial[14]-.1],12);poses[side]=current;
    g.update(model,p,poses,squeeze,[false,false],.1,-1);
    const expected=contact.map((v,k)=>k<2?v*p.scale:v);near(point(V.panelMount(model,kind,p).matrix,expected),Array.from(current.slice(12,15)));
    assert.ok(Math.abs(p.yaw-.28)<1e-6,'no Euler wrap when the initial wrist faces backwards');
    assert.equal(p.scale,kind==='map'?1:1.1);
    assert.equal(g.release(p),true);assert.equal(g.release(p),false);
  }
});
test('map grip is circular, release-armed, bounded and never jumps to a changed controller',()=>{
  const s=V.vrSettings({}),p=V.placement(s,'map'),g=new V.PanelGrip('map'),m=V.mapMount('350Z',s),hand=V.identity(),poses=[hand,null];
  const update=(squeeze,busy=false)=>g.update('350Z',p,poses,[squeeze,NaN],[busy,false],.016,0);
  hand.set(point(m.matrix,[.07,.07,0]),12);update(0);update(1);assert.equal(g.hand,-1,'square corner outside round rim');
  hand.set(point(m.matrix,[0,0,0]),12);update(1);assert.equal(g.hand,-1,'moving into range with grip held cannot grab');
  update(0);g.block(0,p);update(1);assert.equal(g.hand,-1,'new controller must release');
  update(0);update(1);assert.equal(g.hand,0);assert.equal(g.release(p),false,'unchanged grab does not save');
  update(0);update(1);hand[12]+=9;update(1);assert.equal(p.offset[0],2);assert.equal(update(NaN),true);assert.equal(g.hand,-1);
  update(0,true);update(1);assert.equal(g.hand,-1,'wheel and shifter ownership blocks grabbing');
});
const car={vip:0,peer:0,model:'350Z',matrix:V.identity(),steer:0};
const scene=()=>({projection:V.identity(),view:V.identity(),cars:[],local:car,cockpit:true,telemetry:{time:1,speed:0,rpm:900,throttle:0,brake:0,gear:2,dt:.016},gearbox:{epoch:1,manual:true,ready:true,count:6}});
const hand=(m)=>({matrix:new Float32Array(m),source:{gamepad:{buttons:Array.from({length:6},()=>({value:0})),axes:[0,0,0,0]}}});
test('map X/A opens world map once, masks shifting/nitrous until release and loses to gripping',()=>{
  for(const side of [0,1]){
    const c=new V.Cockpit(V.vrSettings({}),null),h=hand(V.mapMount('350Z',c.settings).matrix),hands=[null,null];hands[side]=h;c.update(scene());
    c.track({time:1,hands});h.source.gamepad.buttons[4].value=1;c.track({time:17,hands});
    assert.equal(c.controls.buttons,1<<V.PAD_DLEFT);assert.equal(c.shiftRequest,null);
    h.matrix[12]+=1;c.track({time:150,hands});assert.equal(c.controls.buttons,0,'held X/A away from map stays consumed');
    h.source.gamepad.buttons[4].value=0;c.track({time:166,hands});h.source.gamepad.buttons[4].value=1;c.track({time:182,hands});
    assert.equal(c.controls.buttons,1<<(side?V.PAD_A:V.PAD_RB),'ordinary driving after physical release');
    c.track(null);h.matrix.set(V.mapMount('350Z',c.settings).matrix);h.source.gamepad.buttons[4].value=0;c.update(scene());c.track({time:200,hands});
    h.source.gamepad.buttons[1].value=h.source.gamepad.buttons[4].value=1;c.track({time:216,hands});assert.equal(c.mapGrip.hand,side);assert.equal(c.controls.buttons,0);
    assert.equal(c.fingers[side*2],1);assert.equal(c.fingers[side*2+1],0);c.destroy();
  }
});
test('map placement saves once on interruption and screen no-op grabs make no cloud write',()=>{
  const saves=[],c=new V.Cockpit(V.vrSettings({NFSU2_VR_SCREEN_MOVABLE:'1'}),null,x=>saves.push(x)),h=hand(V.mapMount('350Z',c.settings).matrix);c.update(scene());
  c.track({time:1,hands:[null,h]});h.source.gamepad.buttons[1].value=1;c.track({time:17,hands:[null,h]});h.matrix[13]+=.12;c.track({time:33,hands:[null,h]});c.track(null);c.track(null);
  assert.equal(saves.length,1);assert.equal(saves[0].vr_map_y,'12');
  h.source.gamepad.buttons[1].value=0;h.matrix.set(V.screenMount('350Z',c.settings).matrix);c.update(scene());c.track({time:49,hands:[null,h]});h.source.gamepad.buttons[1].value=1;c.track({time:65,hands:[null,h]});c.track(null);assert.equal(saves.length,1);
});
test('native GPS rounds unit boundaries, follows the map mount, and rejects inactive or invalid distances',()=>{
  for(const [metres,metric,text] of [[0,true,'0 M'],[999.4,true,'999 M'],[999.6,true,'1.0 KM'],[1500,true,'1.5 KM'],[30.48,false,'100 FT'],[1609,false,'5279 FT'],[1609.3,false,'1.0 MI'],[2414.016,false,'1.5 MI']])assert.equal(V.gpsText({metres,metric}),text);
  for(const metres of [-1,NaN,Infinity,1000000])assert.equal(V.gpsText({metres,metric:true}),'');assert.equal(V.gpsText(undefined),'');
  for(const model of ['350Z','SKYLINE']){
    const v=V.gpsVertices(model,'1.5 KM'),inverse=V.inverse(V.mapMount(model,V.vrSettings({})).matrix);assert.ok(v.length>36);
    for(let i=0;i<v.length;i+=6){const p=point(inverse,Array.from(v.slice(i,i+3)));assert.ok(p[1]<-.0789&&p[1]>-.104);assert.ok(p[2]>.0009&&p[2]<.0021);}
  }
  assert.equal(V.gpsVertices('350Z','').length,0);
});
test('scene v4 carries GPS with existing haptics; bad distances disappear without discarding the car',()=>{
  const b=new ArrayBuffer(12288),p=V.SCENE_OFFSET,local=p+6352;
  new Uint32Array(b,p,4).set([0x3152564e,1,0,4]);new Float32Array(b,p+16,16).set(V.identity());new Float32Array(b,p+144,16).set(V.identity());
  new Float32Array(b,local+16,16).set(V.identity());new Uint32Array(b,local+96,1)[0]=2;new Float32Array(b,p+6528,3).set([900,8000,.2]);new Float32Array(b,p+6544,1)[0]=1500;new Uint32Array(b,p+6548,1)[0]=1;
  const s=V.readDriverScene(b,0,b.byteLength);assert.deepEqual(s.gps,{metres:1500,metric:true});assert.equal(s.feedback.idle,900);
  for(const bad of [-1,NaN,Infinity,1000000]){new Float32Array(b,p+6544,1)[0]=bad;const next=V.readDriverScene(b,0,b.byteLength);assert.ok(next.local);assert.equal(next.gps,undefined);}
  assert.equal(V.readDriverScene(b,0,V.SCENE_OFFSET+6559),null);
});
