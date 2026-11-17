import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/app/settings';export * from './src/vr/settings';export * from './src/vr/settings-fields';export * from './src/vr/resolution-info';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const S=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

test('pixel readouts distinguish measured, last-session and estimated sizes, including GPU caps and asymmetric eyes',()=>{
  const sample={scale:1,limit:4096,eyes:['left','right'].map(eye=>({eye,width:4096,height:3072,viewportWidth:8000,viewportHeight:6000}))};
  assert.match(S.vrPixelsText(null,false,1),/Start VR once/);
  assert.equal(S.vrPixelsText(sample,true,1),'Rendering: 4096 × 3072 px per eye (100%).');
  assert.match(S.vrPixelsText(sample,false,.5),/^Last VR session:.*approximately 4000 × 3000 px per eye/,'preview uses the viewport before the GPU cap');
  assert.match(S.vrPixelsText(sample,true,2),/approximately 4096 × 3072/,'raising scale respects the GPU cap');
  const different={scale:.75,limit:4096,eyes:[{eye:'right',width:1500,height:1700,viewportWidth:1500,viewportHeight:1700},{eye:'left',width:1400,height:1600,viewportWidth:1400,viewportHeight:1600}]};
  assert.equal(S.vrPixelsText(different,true,.75),'Rendering: Left: 1400 × 1600 px; right: 1500 × 1700 px (75%).');
});

test('pixel measurements survive a local reload, reject damaged data and tolerate blocked storage',t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let value=null;
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>value,setItem:(_,v)=>{value=v;}}});
  const sample={scale:1.5,limit:4096,eyes:[{eye:'left',width:3000,height:3600,viewportWidth:3000,viewportHeight:3600}]};
  assert.equal(S.keepVRPixels(sample),true);assert.deepEqual(S.lastVRPixels(),sample);
  for(const invalid of ['oops','null','{}','[]',JSON.stringify({...sample,scale:0}),JSON.stringify({...sample,limit:-1}),JSON.stringify({...sample,eyes:[null]}),JSON.stringify({...sample,eyes:[{...sample.eyes[0],width:99999}]}),JSON.stringify({...sample,eyes:[{...sample.eyes[0],viewportWidth:20}]})]){value=invalid;assert.equal(S.lastVRPixels(),null,invalid);}
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('storage blocked');}});
  assert.equal(S.keepVRPixels(sample),false);assert.equal(S.lastVRPixels(),null);
});

test('headset resolution saves, reloads and resets through the normal settings file',()=>{
  const field=S.vrLaunchFields.find(f=>f.key==='vr_render_scale');
  assert.ok(field);assert.equal(S.vrFields.some(f=>f.key===field.key),false,'not a live headset adjustment');
  for(const [value] of field.c.opts){
    const text=S.settingsPut('# personal settings\nvr_seat_height = 12\n',field.key,value);
    const env=S.resolveEnv(text,{},{}).env;
    assert.equal(S.vrSettings(env).renderScale,Number(value)/100);
    assert.equal(env.NFSU2_VR_SEAT_HEIGHT,'12');assert.match(text,/# personal settings/);
    assert.equal(S.vrSettings(S.resolveEnv(S.settingsPut(text,field.key,null),{},{}).env).renderScale,1);
  }
  for(const value of ['0','-50','Infinity','NaN','201','80','125.5','']){
    if(value)assert.equal(S.checkSetting(field.key,value)?.ok,false,value);
    assert.equal(S.vrSettings({NFSU2_VR_RENDER_SCALE:value}).renderScale,1,value);
  }
});

test('cloud profile restore preserves this device’s headset resolution',()=>{
  const mine=S.settingsPut(S.TEMPLATE,'vr_render_scale','75');
  const theirs=S.settingsPut(S.settingsPut(S.TEMPLATE,'vr_render_scale','200'),'vr_seat_height','12');
  const cloud=S.withoutDevice(theirs);
  assert.equal(S.resolveEnv(cloud,{},{}).env.NFSU2_VR_RENDER_SCALE,undefined);
  const restored=S.resolveEnv(S.withDevice(cloud,mine),{},{}).env;
  assert.equal(restored.NFSU2_VR_RENDER_SCALE,'75');assert.equal(restored.NFSU2_VR_SEAT_HEIGHT,'12');
});

test('supersampled pixels and estimates distinguish layer scale from scene scale',t=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let stored;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>stored,setItem:(_,v)=>stored=v}});
  t.after(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete globalThis.localStorage;});
  const sample={scale:2,layerScale:1,limit:8192,eyes:['left','right'].map(eye=>({eye,width:3360,height:3520,viewportWidth:1680,viewportHeight:1760}))};
  assert.equal(S.keepVRPixels(sample),true);assert.deepEqual(S.lastVRPixels(),sample);
  assert.match(S.vrPixelsText(sample,true,2),/Rendering: 3360 × 3520.*200%/);
  assert.match(S.vrPixelsText(sample,false,1.25),/approximately 2100 × 2200/);
  S.keepVRPixels({...sample,layerScale:0});assert.equal(S.lastVRPixels(),null);
});
