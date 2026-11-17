import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/settings-menu';export * from './src/vr/community-settings';export * from './src/vr/settings-values';export * from './src/vr/settings-fields';export * from './src/vr/settings';export * from './src/vr/mirror-profiles';export * from './src/input/proto';export {checkSetting} from './src/app/settings';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const bit=n=>1<<n;
function setup(){const settings=V.vrSettings({}),saves=[],recenter=[],menu=new V.SettingsMenu(settings,v=>saves.push(v),()=>recenter.push(1));let now=0;
 return {menu,settings,saves,recenter,sample(buttons=0,available=true,dt=16,model='350Z'){return menu.sample(now+=dt,available,{buttons,steer:0,throttle:0,brake:0},model);},select(key){menu.row=menu.fields.findIndex(f=>f.key===key);assert.ok(menu.row>=0);}};
}
test('all live headset fields share valid website values and change limits',()=>{
  const s=V.vrSettings({}),values=V.vrValues(s);
  for(const f of V.vrFields){
    if(['vr_cockpit','vr_mirror_vehicle'].includes(f.key))continue;
    assert.equal(V.checkSetting(f.key,values[f.key])?.ok,true,f.key);
    if(f.c.t==='num'){
      assert.equal(V.checkSetting(f.key,String(f.c.min)).ok,true);assert.equal(V.checkSetting(f.key,String(f.c.max)).ok,true);
    }
  }
  assert.deepEqual(V.applyVRValues(s,{vr_wheel_rotation:'9999',vr_led_color:'NaN',NFSU2_VR_LEDS:'off',catchup:'off'}),{});
});

test('wheel grip is optional by default and the headset saves and resets the same profile option',()=>{
  const a=setup();assert.equal(a.settings.wheelGrip,false);
  a.sample();a.sample(bit(V.PAD_X));a.sample();a.select('vr_wheel_grip');
  a.sample(bit(V.PAD_A));a.sample();assert.equal(a.settings.wheelGrip,true);assert.deepEqual(a.saves,[{vr_wheel_grip:'on'}]);
  assert.equal(V.vrSettings({NFSU2_VR_WHEEL_GRIP:V.checkSetting('vr_wheel_grip',a.saves[0].vr_wheel_grip).value}).wheelGrip,true);
  a.sample(bit(V.PAD_Y));a.sample();assert.equal(a.settings.wheelGrip,false);assert.deepEqual(a.saves.at(-1),{vr_wheel_grip:'off'});
});
test('editing one setting preserves precise live hand placement and all unrelated per-car mirrors',()=>{
  const s=V.vrSettings({});s.screenX=.123456;s.pitch=.237891;s.mapYaw=-.489123;s.mirrorCars.SKYLINE={inside:{yaw:.127891,pitch:.068912},outside:{yaw:-.137891,pitch:.037891}};
  const before=structuredClone(s);assert.deepEqual(V.applyVRValues(s,{vr_led_color:'4'}),{vr_led_color:'4'});before.ledColor=4;assert.deepEqual(s,before);
  V.applyVRValues(s,{vr_seat_height:'12',vr_steering_deadzone:'8',vr_shift_reverse:'on'});assert.equal(s.height,.12);assert.equal(s.steeringDeadzone,.08);assert.equal(s.shift.reverse,true);assert.equal(s.screenX,before.screenX);
});

test('master trim shares native limits, live headset edits and profile units',()=>{
  assert.equal(V.vrSettings({NFSU2_VR_MASTER_GAIN:'NaN'}).masterGainDB,0);
  assert.equal(V.vrSettings({NFSU2_VR_MASTER_GAIN:'-99'}).masterGainDB,-12);
  assert.equal(V.vrSettings({NFSU2_VR_MASTER_GAIN:'99'}).masterGainDB,12);
  const a=setup();a.sample();a.sample(bit(V.PAD_X));a.sample();a.select('vr_master_gain');
  a.sample(bit(V.PAD_DLEFT));assert.equal(a.settings.masterGainDB,-1);assert.equal(a.saves.length,0);
  a.sample();assert.deepEqual(a.saves,[{vr_master_gain:'-1'}]);
  a.sample(bit(V.PAD_Y));a.sample();assert.equal(a.settings.masterGainDB,0);
});
test('website changes and resets reach the live cabin without losing hand placement or profile inheritance',()=>{
  const before={NFSU2_VR_LED_COLOR:'3',NFSU2_VR_MIRROR_350Z_INSIDE_YAW:'2'},s=V.vrSettings(before);s.screenX=.12345;
  V.syncVRSettings(s,before,{...before,NFSU2_VR_LED_COLOR:'6'});assert.equal(s.ledColor,6);assert.equal(s.screenX,.12345);assert.ok(s.mirrorCars['350Z']);
  V.syncVRSettings(s,{...before,NFSU2_VR_LED_COLOR:'6'},{});assert.equal(s.ledColor,0);assert.equal(s.mirrorCars['350Z'],undefined);assert.equal(s.screenX,.12345);
});
test('X opens only in a menu, settings own input until release, and B saves without returning to the race',()=>{
  const a=setup();a.sample();assert.equal(a.sample(bit(V.PAD_X),false),false);assert.equal(a.menu.open,false);
  a.sample(0);assert.equal(a.sample(bit(V.PAD_X)),true);assert.equal(a.menu.open,true);a.sample();a.select('vr_wheel_rotation');
  a.sample(bit(V.PAD_DRIGHT));assert.equal(a.settings.rotation,390);assert.equal(a.saves.length,0);
  a.sample(bit(V.PAD_DRIGHT),true,200);assert.equal(a.settings.rotation,390);a.sample(bit(V.PAD_DRIGHT),true,150);assert.equal(a.settings.rotation,420);
  a.sample();assert.deepEqual(a.saves,[{vr_wheel_rotation:'420'}]);
  assert.equal(a.sample(bit(V.PAD_B)),true);assert.equal(a.menu.open,false);assert.equal(a.sample(bit(V.PAD_B)),true);a.sample();assert.equal(a.sample(),false);
});
test('mirror adjustments and reset affect the selected car and cloud keys only',()=>{
  const a=setup();a.sample();a.sample(bit(V.PAD_X));a.sample();a.select('vr_mirror_inside_yaw');a.sample(bit(V.PAD_DRIGHT));a.sample();
  assert.deepEqual(a.saves,[{vr_mirror_350z_inside_yaw:'0.1'}]);assert.ok(Math.abs(a.settings.mirrorCars['350Z'].inside.yaw-Math.PI/1800)<1e-8);assert.equal(a.settings.mirrors.inside.yaw,0);
  a.menu.change(a.menu.fields.find(f=>f.key==='vr_mirror_vehicle'),'SKYLINE');a.sample(bit(V.PAD_DLEFT));a.sample();assert.deepEqual(a.saves.at(-1),{vr_mirror_skyline_inside_yaw:'-0.1'});
  a.menu.row=a.menu.fields.length+1;a.sample(bit(V.PAD_A));a.sample();assert.equal(a.settings.mirrorCars.SKYLINE.inside.yaw,0);assert.ok(a.settings.mirrorCars['350Z'].inside.yaw>0);
});
test('Y resets one setting; tracking loss flushes edits and requires release before resuming',()=>{
  const a=setup();a.sample();a.sample(bit(V.PAD_X));a.sample();a.select('vr_led_color');a.sample(bit(V.PAD_DRIGHT));assert.equal(a.settings.ledColor,1);
  a.menu.sample(null,false,null,'350Z');assert.deepEqual(a.saves,[{vr_led_color:'1'}]);a.sample(bit(V.PAD_DRIGHT));assert.equal(a.settings.ledColor,1);a.sample();
  a.sample(bit(V.PAD_Y));a.sample();assert.equal(a.settings.ledColor,0);assert.deepEqual(a.saves.at(-1),{vr_led_color:'0'});
  a.menu.row=a.menu.fields.length;a.sample(bit(V.PAD_A));assert.equal(a.recenter.length,1);a.sample(bit(V.PAD_A));assert.equal(a.recenter.length,1);
});

test('an unavailable settings panel releases its input capture after tracking returns and buttons release',()=>{
  const a=setup();a.sample(0,false);a.menu.sample(null,false,null,'350Z');
  assert.equal(a.sample(bit(V.PAD_B),false),true,'the old held button remains captured');
  assert.equal(a.sample(0,false),false);
  assert.equal(a.sample(bit(V.PAD_B),false),false,'a new replay Back can reach the original menu');
  assert.equal(a.sample(bit(V.PAD_A),false),false);
  a.sample(0);a.sample(bit(V.PAD_X));assert.equal(a.menu.open,true);
  assert.equal(a.sample(bit(V.PAD_X),false),true);assert.equal(a.menu.open,false);
  assert.equal(a.sample(0,false),false);assert.equal(a.sample(bit(V.PAD_A),false),false);
});


test('Mods page shares profile keys, batches held edits and distinguishes live controls from pending restarts',()=>{
  const raw=new V.CommunitySettings({NFSU2_GPS_DISTANCE:'true',NFSU2_PLAYER_HEADLIGHTS:'HIGH'},()=>{});assert.equal(raw.values.gps_distance,'on');assert.equal(raw.values.player_headlights,'high');
  const sent=[],saved=[],mods=new V.CommunitySettings({NFSU2_UI_TEXTURES:'uhud'},(...v)=>sent.push(v));
  const menu=new V.SettingsMenu(V.vrSettings({}),v=>saved.push(v),()=>{},mods);let now=0;
  const tick=(keys=0)=>menu.sample(now+=16,true,{buttons:keys,steer:0,throttle:0,brake:0},'350Z');
  tick();tick(bit(V.PAD_X));tick();const parent=menu.fields.length+3;menu.row=parent;tick(bit(V.PAD_A));tick();
  assert.equal(menu.fields,V.communityFields);assert.equal(menu.values().ui_textures,'uhud');
  menu.row=menu.fields.findIndex(f=>f.key==='player_headlights');tick(bit(V.PAD_DRIGHT));
  assert.deepEqual(sent.at(-1),[1,false,false,false]);assert.equal(saved.length,0);tick();assert.deepEqual(saved.at(-1),{player_headlights:'off'});
  menu.row=menu.fields.findIndex(f=>f.key==='gps_distance');tick(bit(V.PAD_A));tick();assert.deepEqual(sent.at(-1),[1,true,false,false]);
  menu.row=menu.fields.findIndex(f=>f.key==='show_hidden_races');const count=sent.length;tick(bit(V.PAD_A));tick();
  assert.deepEqual(saved.at(-1),{show_hidden_races:'on'});assert.equal(sent.length,count,'restart-only choice must not pretend to change the running world');
  mods.sync({NFSU2_PLAYER_HEADLIGHTS:'off'},{NFSU2_PLAYER_HEADLIGHTS:'high'});assert.equal(menu.values().player_headlights,'high');
  assert.equal(menu.values().show_hidden_races,'on','website edit preserves pending headset changes');
  assert.deepEqual(mods.change({player_headlights:'999',gps_distance:'bogus',roam_claim:'secret'}),{});
  tick(bit(V.PAD_B));assert.equal(menu.open,true);assert.equal(menu.row,parent);tick();tick(bit(V.PAD_B));assert.equal(menu.open,false);
});

test('all native optional mod choices share validation, restart boundaries and bounded car counts',()=>{
  const sent=[],cars=[],mods=new V.CommunitySettings({},(...v)=>sent.push(v),undefined,v=>cars.push(v));
  assert.equal(mods.values.regional_cars,'off');assert.equal(mods.values.special_vinyls,'off');
  for(const f of V.communityFields){
    assert.equal(V.checkSetting(f.key,mods.values[f.key])?.ok,true,f.key);
    if(f.c.t==='seg'||f.c.t==='select')for(const [v]of f.c.opts)assert.equal(V.checkSetting(f.key,v)?.ok,true,`${f.key}=${v}`);
  }
  mods.change({ui_textures:'hud',regional_cars:'on'});assert.equal(sent.length,0);
  mods.change({roam_max_cars:'6'});assert.deepEqual(cars,[6]);assert.deepEqual(sent,[[0,false,false,false]]);
  assert.equal(mods.values.ui_textures,'hud');assert.equal(mods.values.roam_max_cars,'6');
  mods.change({special_vinyls:'on',gearbox_whine:'on'});assert.deepEqual(sent.at(-1),[0,false,true,true]);
  assert.deepEqual(mods.change({roam_max_cars:'65',regional_cars:'bad',ui_textures:'bogus'}),{});
  mods.change({roam_max_cars:'auto'});assert.equal(mods.values.roam_max_cars,'auto');
  mods.change({roam_max_cars:'0'});mods.change({roam_max_cars:'64'});
  assert.deepEqual(cars,[6,6,-1,0,64]);assert.equal(V.communityLive.has('roam_max_cars'),true);
});
