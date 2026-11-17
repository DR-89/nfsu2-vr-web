import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/cockpit';export * from './src/vr/settings';export * from './src/vr/math';export * from './src/vr/drivers';export * from './src/vr/multiplayer';export * from './src/vr/screen-touch';export * from './src/vr/glove-tip';export * from './src/vr/fit';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
globalThis.document={createElement:()=>({getContext:()=>({})})};
const car={vip:0,peer:0,model:'350Z',matrix:V.identity(),steer:0};
const scene=(time=1,gear=2)=>({projection:V.identity(),view:V.identity(),cars:[],local:car,cockpit:true,peers:[],telemetry:{time,speed:time/100,rpm:3000,throttle:.5,brake:.2,gear,dt:.016}});
const rayAt=(mount,u,v,depth=.08)=>{const m=new Float32Array(mount.matrix);for(let k=0;k<3;k++)m[12+k]+=m[k]*(u-.5)*mount.width+m[4+k]*(.5-v)*mount.height+m[8+k]*depth;return m;};

const fingerAt=(mount,side,u,v,depth)=>{
  const grip=V.multiply(mount.matrix,V.inverse(V.gloveAxes(side)));
  for(let k=0;k<3;k++)grip[12+k]=mount.matrix[12+k]+mount.matrix[k]*(u-.5)*mount.width+mount.matrix[4+k]*(.5-v)*mount.height+mount.matrix[8+k]*depth-V.gloveTip.reduce((sum,x,j)=>sum+mount.matrix[j*4+k]*x,0);
  return grip;
};

test('exterior views keep released-to-arm pedals and stick steering without invisible cabin controls or lever ownership',()=>{
  const c=new V.Cockpit(V.vrSettings({}),null),s=scene();s.cockpit=false;s.gearbox={manual:true,count:6,ready:true,epoch:2};c.update(s);
  const sources=[0,1].map(()=>({gamepad:{buttons:Array.from({length:6},()=>({value:0})),axes:[0,0,0,0]}}));
  const frame={time:10,hands:[null,null],sources};sources[1].gamepad.buttons[0].value=1;
  c.track(frame);assert.equal(c.controls.throttle,0);assert.equal(c.gearCommand,0);
  sources[1].gamepad.buttons[0].value=0;c.track({...frame,time:20});sources[1].gamepad.buttons[0].value=.8;sources[0].gamepad.axes[2]=.54;
  c.track({...frame,time:30});assert.equal(c.controls.throttle,.8);assert.ok(Math.abs(c.controls.steer-.5)<1e-6);
  assert.equal(c.wheelVisual,null);assert.equal(c.zone,false);assert.equal(c.gearCommand,0);
  c.track(null);c.track({...frame,time:40});assert.equal(c.controls.throttle,0);
  c.settings.handControls=false;c.track({...frame,time:50});assert.equal(c.controls,null);
  c.destroy();
});
test('dashboard picking follows fitting, scale, translation, pitch and yaw; rejects back and out-of-bounds rays',()=>{
  const s=V.vrSettings({NFSU2_VR_SCREEN_SIZE:'180',NFSU2_VR_SCREEN_PITCH:'25',NFSU2_VR_SCREEN_YAW:'-30',NFSU2_VR_SCREEN_X:'12'});
  for(const model of ['350Z','SKYLINE','A3','DEFAULT']) {
    const fitted=V.screenMount(model,V.vrSettings({})).matrix;
    assert.ok(Math.abs(fitted[6]/fitted[5]+.4*V.fitFor(model)[5])<1e-6,'screen follows the native console slope');
    const m=V.screenMount(model,s),hit=V.hitScreen(rayAt(m,.9,.95),m);
    assert.ok(Math.abs(hit[0]-.9)<1e-5 && Math.abs(hit[1]-.95)<1e-5);
    assert.equal(V.hitScreen(rayAt(m,1.1,.5),m),null);
    const back=rayAt(m,.5,.5);for(let k=0;k<3;k++)back[8+k]*=-1;
    assert.equal(V.hitScreen(back,m),null);
  }
});
test('physical PAGE and LED controls persist without restarting media while the trigger stays held',()=>{
  const saved=[],media={player:{paused:false},step:()=>assert.fail('unexpected media restart'),toggle:()=>assert.fail('unexpected media restart'),level:()=>0};
  const c=new V.Cockpit(V.vrSettings({}),media,x=>saved.push(x)),mount=V.screenMount(car.model,c.settings),source={gamepad:{buttons:[{value:0},{value:0}]}};
  const hand={matrix:V.identity(),source};let time=0;
  const move=(u,depth)=>{hand.matrix=fingerAt(mount,1,u,.95,depth);c.update(scene());c.track({time:time+=16,hands:[null,hand]});};
  move(.9,.04);source.gamepad.buttons[0].value=.8;move(.9,.003);assert.equal(c.settings.page,1);move(.9,.003);assert.equal(c.settings.page,1);
  assert.deepEqual(c.fingers,[0,0,1,1]);assert.equal(c.controls.throttle,.8);
  move(.9,.04);move(.9,.003);assert.equal(c.settings.page,0);
  move(.7,.04);move(.7,.003);assert.equal(c.settings.ledColor,1);assert.equal(c.controls.throttle,.8);
  assert.deepEqual(saved.map(v=>Object.keys(v)[0]),['vr_screen_page','vr_screen_page','vr_led_color']);c.destroy();
});

test('VR radio ignores controller rays and triggers at every distance',()=>{
  for(const side of [0,1]){
    const c=new V.Cockpit(V.vrSettings({NFSU2_VR_SCREEN_X:'100'}),null),s=scene();c.update(s);
    const mount=V.screenMount(car.model,c.settings),source={gamepad:{buttons:[{value:0},{value:0}]}},hand={matrix:V.identity(),source},hands=[null,null];hands[side]=hand;let time=0;
    for(const distance of [.01,.08,.14,.3,1,2.9])for(const trigger of [0,.8]){
      hand.ray=rayAt(mount,.9,.95,distance);source.gamepad.buttons[0].value=trigger;c.update(s);c.track({time:time+=16,hands});
      assert.equal(c.hover,null);assert.equal(c.settings.page,0);assert.equal(side?c.controls.throttle:c.controls.brake,trigger);
    }
    assert.deepEqual(c.fingers,[0,0,0,0]);c.destroy();
  }
});

test('desktop picking unprojects the actual cockpit near plane in world coordinates',()=>{
  const c=new V.Cockpit(V.vrSettings({}),null),s=scene(),near=.03,far=15000;
  s.local={...car,matrix:V.identity()};s.local.matrix.set([1695,-884,24],12);
  s.view=V.inverse(V.cabinMatrix(s.local));
  s.projection=new Float32Array([.69,0,0,0,0,1.05,0,0,0,0,far/(near-far),-1,0,0,near*far/(near-far),0]);c.update(s);
  const mount=V.screenMount(car.model,c.settings),m=V.multiply(s.projection,V.multiply(s.view,V.multiply(V.cabinMatrix(s.local),mount.matrix)));
  const p=[.4*mount.width,-.45*mount.height,0,1],clip=[0,1,2,3].map(r=>p.reduce((sum,v,i)=>sum+m[4*i+r]*v,0));
  assert.ok(c.pointer(clip[0]/clip[3],clip[1]/clip[3]));assert.equal(c.settings.page,1);
  assert.ok(c.pointer(clip[0]/clip[3],clip[1]/clip[3]));assert.equal(c.settings.page,1,'duplicate pointerdown is one press');
  assert.ok(c.pointer(0,0,'up'));
  assert.ok(c.pointer(clip[0]/clip[3],clip[1]/clip[3]));assert.equal(c.settings.page,0,'release allows the next click');
});
test('screen release on tracking loss saves bounded movement and right-stick size once',()=>{
  const saved=[],s=V.vrSettings({NFSU2_VR_SCREEN_MOVABLE:'1'}),c=new V.Cockpit(s,null,x=>saved.push(x));c.update(scene());
  const m=V.screenMount(car.model,s).matrix,hand={matrix:new Float32Array(m),source:{gamepad:{buttons:[{value:0},{value:0}],axes:[0,0,0,-1]}}};
  c.track({time:1,hands:[null,hand]});hand.source.gamepad.buttons[1].value=1;c.track({time:2,hands:[null,hand]});
  hand.matrix[12]+=.2;c.track({time:102,hands:[null,hand]});assert.ok(s.screenX>.19);assert.ok(s.screenScale>1);assert.equal(c.controls.buttons,0,'resizing cannot shift');
  assert.deepEqual(c.fingers,[0,0,1,0],'holding the display uses the authored grip');
  c.track(null);c.track(null);assert.equal(saved.length,1);assert.equal(saved[0].vr_screen_x,'20');
  assert.deepEqual(c.fingers,[0,0,0,0]);assert.equal(c.handPose(1),null);
});

test('index contact is armed from the front, swept through fast pokes and latched until withdrawal',()=>{
  const touch=new V.ScreenTouch();
  assert.equal(touch.update([.9,.95,0]),-1,'tracking cannot appear inside a pressed button');
  assert.equal(touch.update([.9,.95,.04]),-1);assert.equal(touch.pointing,4);
  assert.equal(touch.update([.9,.95,-.08]),4,'swept fingertip crosses the press plane');
  assert.equal(touch.update([.9,.95,-.08]),-1);assert.equal(touch.pointing,-1,'deep penetration stops pointing');
  assert.equal(touch.update([.9,.95,0]),-1);assert.equal(touch.update([.9,.95,.03]),-1);
  assert.equal(touch.update([.9,.95,.005],4),-1,'other hand already owns this button');
  touch.update([.9,.95,.03]);assert.equal(touch.update([.9,.95,.005]),4);
  assert.equal(touch.update([.7,.95,0]),-1,'sliding while pressed does not click adjacent buttons');
  touch.update([1.1,.95,0]);assert.equal(touch.update([.7,.95,0]),-1,'leaving the edge sideways cannot rearm');
  touch.update([1.1,.95,.04]);assert.equal(touch.update([.7,.95,0]),3,'withdrawing outside the edge rearms');
  touch.reset();assert.equal(touch.update([.7,.95,0]),-1);
  touch.update([.7,.95,.31]);assert.equal(touch.update([.7,.95,-.1]),-1,'a teleport cannot synthesize a poke');
});

test('two fingers and trigger noise cannot double a held radio press; withdrawal rearms with gas held',()=>{
  const c=new V.Cockpit(V.vrSettings({NFSU2_VR_SCREEN_X:'100'}),null),mount=V.screenMount(car.model,c.settings);
  const sources=[0,1].map(()=>({gamepad:{buttons:[{value:0},{value:0}]}})),hands=sources.map(source=>({source,matrix:V.identity()}));let time=0;
  const sample=(left,right)=>{for(const i of [0,1])hands[i].matrix=fingerAt(mount,i,.9,.95,i?right:left);c.update(scene());c.track({time:time+=16,hands});};
  sample(.04,.04);sources[0].gamepad.buttons[0].value=.6;sources[1].gamepad.buttons[0].value=.8;
  sample(.003,.04);assert.equal(c.settings.page,1);sample(.003,.003);assert.equal(c.settings.page,1,'one button has one owner');
  for(const value of [0,.7,.64,.66,1]){sources[1].gamepad.buttons[0].value=value;sample(.003,.003);assert.equal(c.settings.page,1);assert.equal(c.controls.throttle,value);}
  sample(-.08,.003);sample(.003,.003);assert.equal(c.settings.page,1,'going behind the screen does not rearm');
  sample(.04,.04);sample(.04,.003);assert.equal(c.settings.page,0,'a second tap works without releasing the accelerator');
  assert.equal(c.controls.throttle,1);assert.equal(c.controls.brake,.6);c.destroy();
});

test('both authored index pads press PAGE in a moved and rotated display without buttons',()=>{
  for(let side=0;side<2;side++){
    const s=V.vrSettings({NFSU2_VR_SCREEN_PITCH:'20',NFSU2_VR_SCREEN_YAW:'-30',NFSU2_VR_SCREEN_SIZE:'180'}),c=new V.Cockpit(s,null);c.update(scene());
    const mount=V.screenMount(car.model,s),grip=V.multiply(mount.matrix,V.inverse(V.gloveAxes(side))),axes=V.multiply(grip,V.gloveAxes(side));
    const hand={matrix:grip,source:{gamepad:{buttons:[{value:0},{value:0}]}}},hands=[null,null];hands[side]=hand;
    const move=depth=>{for(let k=0;k<3;k++)grip[12+k]=mount.matrix[12+k]+mount.matrix[k]*.34*mount.width-mount.matrix[4+k]*.4125*mount.height+mount.matrix[8+k]*depth-V.gloveTip.reduce((v,x,j)=>v+axes[j*4+k]*x,0);};
    move(.04);c.track({time:1,hands});assert.equal(c.fingers[side*2+1],1);assert.equal(s.page,0);
    move(.003);c.track({time:17,hands});assert.equal(s.page,1);c.track({time:33,hands});assert.equal(s.page,1);
    move(.04);c.track({time:49,hands});move(.003);c.track({time:65,hands});assert.equal(s.page,0);
    hand.matrix[12]+=1;c.track({time:81,hands});assert.deepEqual(c.fingers,[0,0,0,0]);c.destroy();
  }
});

test('a poke behind the display and its returning trigger advance exactly one track',()=>{
  for(const side of [0,1]){
    const steps=[],c=new V.Cockpit(V.vrSettings({}),{step:d=>steps.push(d)});c.update(scene());
    const mount=V.screenMount(car.model,c.settings),grip=V.multiply(mount.matrix,V.inverse(V.gloveAxes(side)));
    const source={gamepad:{buttons:[{value:0},{value:0}]}},hand={matrix:grip,ray:rayAt(mount,.5,.95),source},hands=[null,null];hands[side]=hand;let time=0;
    const sample=(depth,trigger)=>{
      for(let k=0;k<3;k++)grip[12+k]=mount.matrix[12+k]-mount.matrix[4+k]*.45*mount.height+mount.matrix[8+k]*depth-V.gloveTip.reduce((v,x,j)=>v+mount.matrix[j*4+k]*x,0);
      source.gamepad.buttons[0].value=trigger;c.track({time:time+=16,hands});
    };
    sample(.04,0);sample(-.08,0);assert.deepEqual(steps,[1]);
    sample(-.08,0);sample(-.02,1);sample(.003,0);sample(.003,1);
    assert.deepEqual(steps,[1],'going behind the face does not release a physical press');
    sample(.04,0);sample(.003,0);assert.deepEqual(steps,[1,1],'withdrawing in front permits the next track');c.destroy();
  }
});

test('finger radio input keeps pedal triggers and cannot grab the display',()=>{
  for(const side of [0,1])for(const trigger of [0,.8])for(const angle of [0,Math.PI/4,3*Math.PI/4]){
    const steps=[],c=new V.Cockpit(V.vrSettings({NFSU2_VR_SCREEN_MOVABLE:'1'}),{step:d=>steps.push(d)});c.update(scene());
    const mount=V.screenMount(car.model,c.settings),rotation=V.identity();rotation.set([Math.cos(angle),Math.sin(angle),0,0,-Math.sin(angle),Math.cos(angle),0,0]);
    const axes=V.multiply(mount.matrix,rotation),grip=V.multiply(axes,V.inverse(V.gloveAxes(side)));
    const source={gamepad:{buttons:[{value:0},{value:0}]}},hand={matrix:grip,ray:rayAt(mount,.5,.88),source},hands=[null,null];hands[side]=hand;let time=0;
    const sample=(depth,trigger,squeeze)=>{
      for(let k=0;k<3;k++)grip[12+k]=mount.matrix[12+k]-mount.matrix[4+k]*.38*mount.height+mount.matrix[8+k]*depth-V.gloveTip.reduce((v,x,j)=>v+axes[j*4+k]*x,0);
      source.gamepad.buttons[0].value=trigger;source.gamepad.buttons[1].value=squeeze;c.track({time:time+=16,hands});
    };
    sample(.04,0,0);sample(.003,trigger,1);
    assert.deepEqual(steps,[1]);assert.equal(c.screenGrip.hand,-1);assert.equal(c.controls.throttle,side?trigger:0);assert.equal(c.controls.brake,side?0:trigger);c.destroy();
  }
});
test('LED cues need opt-in, follow actual shifts and share the selected appearance',()=>{
  const c=new V.Cockpit(V.vrSettings({}),null),colour=c.led().slice(0,3);
  c.zone=true;c.update(scene(100));c.update(scene(200,3));
  assert.deepEqual(c.led().slice(0,3),colour);assert.equal(c.appearance()&0x70,0);
  c.settings.shiftLights=V.vrSettings({NFSU2_VR_SHIFT_LIGHTS:'1'}).shiftLights;
  c.update(scene(300,4));assert.deepEqual(c.led().slice(0,3),[1,32/255,32/255]);
  const decoded=V.appearanceLED(c.appearance());assert.deepEqual(decoded.slice(0,3),c.led().slice(0,3));
  c.update(scene(400,2));assert.deepEqual(c.led().slice(0,3),[40/255,123/255,1]);
  c.settings.shiftLights=false;assert.deepEqual(c.led().slice(0,3),colour);assert.equal(c.appearance()&0x70,0);
  c.settings.leds=false;assert.deepEqual(c.led(),[0,0,0,0]);assert.equal(c.appearance(),0);
});

test('re-engaging the same gear has no false direction cue; unrequested changes never click',()=>{
  const c=new V.Cockpit(V.vrSettings({NFSU2_VR_SHIFT_LIGHTS:'1'}),null),clicks=[];
  const pulse=(a,d)=>{clicks.push([a,d]);return Promise.resolve(true);};
  c.tracking={hands:[{source:{gamepad:{hapticActuators:[{pulse}]}}}]};
  c.update(scene(100,3));c.update(scene(200,1));c.update(scene(300,3));
  assert.deepEqual(clicks,[]);assert.deepEqual(c.led().slice(0,3),[0x32/255,0xdb/255,0xe7/255]);
  const next=scene(400,6);next.gearbox={epoch:8,count:6,manual:true,ready:true};c.update(next);assert.equal(clicks.length,0);
});
test('racing peers from different roam worlds converge; leaving restores each world',()=>{
  const sentA=[],sentB=[],a=new V.ModMultiplayer(x=>(sentA.push(x),true),'world-a'),b=new V.ModMultiplayer(x=>(sentB.push(x),true),'world-b');
  a.receive({op:'joined',you:17,room:'world-a'},0);b.receive({op:'joined',you:29,room:'world-b'},0);
  a.race([29]);b.race([17]);assert.equal(a.room,b.room);assert.match(a.room,/^race\//);
  const room=a.room;a.race([29]);assert.equal(a.room,room);assert.equal(sentA.length,1);
  a.race([]);b.race([]);assert.equal(a.room,'world-a');assert.equal(b.room,'world-b');
  assert.equal(V.raceRoom(17,[29,31]),V.raceRoom(31,[17,29,29]));
});
test('v2 driver scene exports bounded local telemetry and authentic race peer list',()=>{
  const b=new SharedArrayBuffer(12288),p=V.SCENE_OFFSET,local=p+6352;
  new Uint32Array(b,p,4).set([0x3152564e,1,0,2]);new Float32Array(b,p+16,16).set(V.identity());new Float32Array(b,p+144,16).set(V.identity());
  new Float32Array(b,local+16,16).set(V.identity());new Uint8Array(b,local+80,4).set([51,53,48,90]);new Uint32Array(b,local+96,12).set([2,1,2,17,29]);
  new Float32Array(b,local+144,6).set([22,4100,.4,.8,3,.016]);new Float64Array(b,local+168,1)[0]=1234;
  const s=V.readDriverScene(b,0,b.byteLength);assert.equal(s.local.model,'350Z');assert.equal(s.cockpit,true);assert.equal(s.telemetry.rpm,4100);assert.deepEqual(s.peers,[17,29]);
  new Uint32Array(b,local+12,1)[0]=(0xffffff<<8)|6|8|16|32|64|128;
  assert.deepEqual(V.readDriverScene(b,0,b.byteLength).gearbox,{epoch:0xffffff,count:6,manual:true,ready:true,firstOnly:true,countdown:true,selected:2});
  new Uint32Array(b,local+12,1)[0]=(12<<8)|5|8|16;
  assert.deepEqual(V.readDriverScene(b,0,b.byteLength).gearbox,{epoch:12,count:5,manual:true,ready:true,firstOnly:false,countdown:false,selected:undefined});
  assert.equal(V.readDriverScene(b,0,8192),null);new Uint32Array(b,local+104,1)[0]=9;assert.equal(V.readDriverScene(b,0,b.byteLength),null);
});
