import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const repo=fileURLToPath(new URL('../..',import.meta.url));
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/stance-models';export * from './src/vr/stance-settings';export * from './src/vr/stance-menu';export * from './src/vr/drivers';export * from './src/input/proto';export {checkSetting,putKey,resolveEnv} from './src/app/settings';`,resolveDir:path.join(repo,'web'),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('model stance values preserve native bounds, distinct models and settings/cloud serialization',()=>{
  const s='v1|350Z:35,0,-40,80,130|SKYLINE:150,150,80,-40,80';
  assert.equal(V.stanceModelsValue(V.stanceModels(s)),s);assert.equal(V.checkSetting('stance_models',s).ok,true);
  assert.equal(V.resolveEnv(V.putKey('', 'stance_models',s).text,{},{}).env.NFSU2_STANCE_MODELS,s);
  for(const bad of ['v2','v1|','v1|350Z:0,0,0,0,100|350Z:0,0,0,0,100','v1|350z:0,0,0,0,100','v1|350Z:151,0,0,0,100','v1|350Z:0,0,-41,0,100','v1|350Z:0,0,0,0,131','v1|350Z:0,0,0,0,100\n','x'.repeat(4096)]){
    assert.equal(V.stanceModels(bad),null,bad.slice(0,40));assert.equal(V.checkSetting('stance_models',bad).ok,false);
  }
  const all=Object.fromEntries(Array.from({length:46},(_,i)=>['CAR'+i,[150,150,-40,80,130]]));
  assert.equal(Object.keys(V.stanceModels(V.stanceModelsValue(all))).length,46);all.EXTRA=[0,0,0,0,100];assert.equal(V.stanceModels(V.stanceModelsValue(all)),null);
});
const clang=process.platform!=='win32'&&spawnSync('clang',['--version']).status===0;

test('stance edits merge models, preserve comments and undo only the selected model',()=>{
  const initial='# mine\nstance = on\nvr_led_color = 6\nstance_models = v1|350Z:35,0,0,0,100\n';
  const a=V.editStance(initial,{model:'SKYLINE',value:[0,0,12,-3,110]});
  assert.match(a.text,/# mine/);assert.match(a.text,/vr_led_color = 6/);assert.equal(a.prefs.enabled,true);
  const b=V.editStance(a.text,{model:'350Z',value:null});assert.equal(b.prefs.models,'v1|SKYLINE:0,0,12,-3,110');
  assert.equal(V.editStance(b.text,{enabled:false}).prefs.models,b.prefs.models);
  for(const model of ['','350Z\n','car','A'.repeat(16)])assert.throws(()=>V.editStance(initial,{model,value:null}),RangeError);
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('stance publishes after persistence, serializes edits and rejects stale completions or failed saves',async()=>{
  let done,calls=0;const sent=[],s=new V.StanceSettings({},()=>{calls++;return new Promise(resolve=>done=resolve);},(...v)=>sent.push(v));
  const a=s.edit({model:'350Z',value:[35,0,0,0,110]});assert.equal(s.busy,true);assert.deepEqual(sent,[]);
  assert.equal(await s.edit({enabled:true}),false);assert.equal(calls,1);
  done({enabled:true,models:'v1|350Z:35,0,0,0,110'});assert.equal(await a,true);assert.deepEqual(sent.at(-1),['v1|350Z:35,0,0,0,110',true]);
  const b=s.edit({enabled:false});s.sync({NFSU2_STANCE:'1',NFSU2_STANCE_MODELS:'v1|SKYLINE:0,0,0,0,100'});done({enabled:false,models:'v1'});await b;
  assert.equal(s.enabled,true);assert.ok(s.models.SKYLINE);assert.equal(s.models['350Z'],undefined);
  const c=s.edit({enabled:false});s.destroy();const count=sent.length;done({enabled:false,models:'v1'});assert.equal(await c,false);assert.equal(sent.length,count);
  const f=new V.StanceSettings({},async()=>{throw Error('disk');},()=>assert.fail('failed save published'));assert.equal(await f.edit({enabled:true}),false);assert.equal(f.enabled,false);assert.equal(f.failed,true);assert.equal(f.busy,false);
});

test('paused stance input has native steps, bounded values and requires release after car changes or tracking loss',async()=>{
  let scene={local:{model:'350Z'},stance:{value:[35,0,0,0,100],stockFront:35}},text='',now=0;
  const edits=[],s=new V.StanceSettings({},async edit=>{edits.push(edit);const next=V.editStance(text,edit);text=next.text;return next.prefs;},()=>{}),m=new V.StanceMenu(s,()=>scene);
  const tick=(keys=0,dt=16)=>m.sample(now+=dt,{buttons:keys}),tap=key=>{tick(1<<key);tick();};m.show();
  tick(1<<V.PAD_A);assert.equal(edits.length,0);tick();tap(V.PAD_A);await settle();assert.equal(s.enabled,true);
  m.row=2;tap(V.PAD_A);assert.equal(edits.length,1,'A on a number does not adjust it');tap(V.PAD_DRIGHT);await settle();assert.deepEqual(s.models['350Z'],[40,0,0,0,100]);
  m.row=6;for(let i=0;i<40;i++){tap(V.PAD_DRIGHT);await settle();}assert.equal(s.models['350Z'][4],130);
  scene={local:{model:'SKYLINE'},stance:{value:[0,0,0,0,100],stockFront:0}};const before=edits.length;tick(1<<V.PAD_DRIGHT);tick(1<<V.PAD_DRIGHT);assert.equal(edits.length,before);tick();tap(V.PAD_DRIGHT);await settle();assert.equal(s.models.SKYLINE[4],101);
  m.sample(null,{buttons:1<<V.PAD_A});m.row=7;tick(1<<V.PAD_A);assert.ok(s.models.SKYLINE);tick();tap(V.PAD_A);await settle();assert.equal(s.models.SKYLINE,undefined);assert.ok(s.models['350Z']);
  scene.replay=true;tap(V.PAD_DRIGHT);assert.equal(m.view(),null);tick();tap(V.PAD_B);assert.equal(m.open,false);
});

test('scene 6 only exposes complete, valid stance snapshots for the current local car',()=>{
  const b=new ArrayBuffer(16384),p=V.SCENE_OFFSET,u=new Uint32Array(b),local=p+6352,s=new Int32Array(b,p+13632,8);
  u.set([0x3152564e,1,0,6],p/4);u[(local+96)/4]=2;s.set([1,35,0,-40,80,130,35,0]);
  const read=()=>V.readDriverScene(b,0,b.byteLength);assert.deepEqual(read().stance,{value:[35,0,-40,80,130],stockFront:35});
  assert.equal(V.readDriverScene(b,0,p+13663),null);
  for(const [at,bad]of [[0,2],[1,151],[3,-41],[5,131],[6,71]]){const old=s[at];s[at]=bad;assert.equal(read().stance,undefined);assert.ok(read().local);s[at]=old;}
  u[(local+96)/4]=0;assert.equal(read().stance,undefined);u[(local+96)/4]=2;u[p/4+3]=5;assert.equal(read().stance,undefined);
});
test('native model defaults reject malformed commands and retain original per-car records',{skip:!clang&&'needs native clang'},()=>{
  const out=path.join(repo,'out/web/test');fs.mkdirSync(out,{recursive:true});const bin=path.join(out,'stance-models');
  execFileSync('clang',['-O1','-g','-ffunction-sections','-fdata-sections','-Wl,--gc-sections','-Wno-unknown-attributes','-Iruntime','web/test/stance_models_unit.c','runtime/stance.c','-lm','-o',bin],{cwd:repo});
  assert.match(execFileSync(bin,{encoding:'utf8'}),/original garage saves OK/);
});
