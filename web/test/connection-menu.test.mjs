import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/app/connection-profiles';export * from './src/app/connection-manager';export * from './src/app/connection-live';export * from './src/vr/connection-menu';export * from './src/vr/settings-menu';export * from './src/vr/settings';export * from './src/input/proto';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'C',write:false})).outputFiles[0].text;
let check=async()=>new Response(JSON.stringify({state:'free'}));
const V=runInNewContext(code+';C;',{TextEncoder,TextDecoder,URLSearchParams,AbortSignal,fetch:(...args)=>check(...args)});
const id=n=>String(n).padStart(32,'0'),bit=n=>1<<n,tick=()=>new Promise(r=>setImmediate(r)),copy=x=>JSON.parse(JSON.stringify(x));
async function setup(race){
  let text=JSON.stringify({version:1,identity:id(0),selected:id(1),profiles:[{id:id(1),name:'Alpha',room:''},{id:id(2),name:'Beta',room:'World 2'}]}),n=2,write=true;
  const tokens=new Map(),authCalls=[],actions=[];
  const profiles=new V.ConnectionProfiles({read:async()=>text,write:async s=>{if(!write)throw Error('quota');text=s;}},()=>id(++n));
  const auth={token:async id=>tokens.get(id)??null,link:async(id,phrase)=>{authCalls.push([id,phrase]);if(phrase==='bad')throw Error('bad phrase');if(phrase)tokens.set(id,'token');else tokens.delete(id);},forget:async id=>{authCalls.push(['forget',id]);tokens.delete(id);}};
  const manager=new V.ConnectionManager(profiles,auth,{writable:()=>true,race,connect:async(p,claim)=>{actions.push([p,claim]);return 'Connecting';},disconnect:async()=>{actions.push('off');return 'Disconnected';},manage:async()=> 'Guide'});
  await manager.refresh();const menu=new V.ConnectionMenu(manager);let now=0;
  return {manager,menu,profiles,tokens,authCalls,actions,setText:s=>{text=s;},failWrite:()=>{write=false;},async show(){menu.show();await tick();this.sample();},sample(keys=0,dt=16){return menu.sample(now+=dt,{buttons:keys,steer:0,throttle:0,brake:0});},tap(key){this.sample(bit(key));this.sample();},action(i){menu.row=(manager.current?.profiles.length??0)+i;this.tap(V.PAD_A);},type(bank,key){menu.keyboard.bank=bank;menu.keyboard.key=key;this.tap(V.PAD_A);}};
}

test('profile manager binds a phrase to the edited identity and preserves sign-in when persistence fails',async()=>{
  const a=await setup();await a.manager.edit({action:'select',id:id(2)});
  assert.equal(await a.manager.link(id(1),'phrase'),true);assert.deepEqual(a.authCalls,[[id(1),'phrase']]);assert.equal(a.manager.current.selected,id(2));
  await a.manager.link(id(1),'bad');assert.equal(a.tokens.get(id(1)),'token');assert.doesNotMatch(a.manager.notice,/bad phrase|token/);
  a.failWrite();assert.equal(await a.manager.edit({action:'delete',id:id(1)}),false);assert.equal(a.tokens.has(id(1)),true);assert.equal(a.manager.current.profiles.length,2);
  a.setText(JSON.stringify({version:1,identity:id(0),selected:id(2),profiles:[{id:id(2),name:'Beta',room:''}]}));
  assert.equal(await a.manager.link(id(1),'late'),false);assert.equal(a.authCalls.length,2,'removed profile cannot receive a late phrase');
});

test('claim checks cannot apply a stale selection and failures never start a connection',async()=>{
  const a=await setup();let done;
  check=()=>new Promise(r=>done=r);const pending=a.manager.connect();await tick();
  assert.equal(await a.manager.edit({action:'select',id:id(2)}),false,'one command in flight');
  const c=a.manager.current;c.selected=id(2);a.setText(JSON.stringify(c));done(new Response(JSON.stringify({state:'free'})));
  assert.equal(await pending,false);assert.equal(a.actions.length,0);
  check=async()=>new Response(JSON.stringify({state:'taken'}));await a.manager.connect();assert.equal(a.actions.length,0);assert.match(a.manager.notice,/unavailable/);
  check=async()=>new Response('{}',{status:503});await a.manager.connect();assert.equal(a.actions.length,0);
  check=async()=>new Response('{}',{status:404});await a.manager.connect();assert.equal(a.actions.length,1,'servers without name claims still permit a connection');
  check=async()=>new Response(JSON.stringify({state:'free'}));
});

test('controller text is masked, cancelled without mutation, cleared on acceptance and bound to the opened profile',async()=>{
  const a=await setup();await a.show();a.action(6);a.type(0,0);assert.equal(a.menu.keyboard.shown(),'•');
  a.sample(bit(V.PAD_Y));assert.equal(a.menu.keyboard.shown(),'A');a.menu.sample(null,null);assert.equal(a.menu.keyboard.shown(),'');
  a.sample();a.tap(V.PAD_B);assert.equal(a.authCalls.length,0);assert.equal(a.menu.keyboard.shown(),'');
  a.sample();a.action(6);a.type(1,0);await a.manager.edit({action:'select',id:id(2)});a.type(0,39);await tick();
  assert.deepEqual(a.authCalls,[[id(1),'a']]);assert.equal(a.menu.keyboard.active,false);assert.equal(a.menu.keyboard.shown(),'');
  a.sample();a.action(1);a.type(0,39);await tick();assert.equal(a.manager.current.profiles[1].name,'Beta','prefilled name accepts on one OK');
  a.menu.destroy();assert.equal(a.menu.open,false);assert.equal(a.menu.keyboard.shown(),'');
});

test('deletion defaults to cancel, stable actions survive catalogue changes and the guide returns to its parent',async()=>{
  const a=await setup();await a.show();a.action(3);a.tap(V.PAD_A);await tick();assert.equal(a.manager.current.profiles.length,2);
  a.sample();a.action(3);a.tap(V.PAD_DRIGHT);a.tap(V.PAD_A);await tick();assert.equal(a.manager.current.profiles.length,1);assert.equal(a.authCalls[0][0],'forget');
  a.sample();a.action(7);await tick();a.tap(V.PAD_B);assert.equal(a.menu.open,true);a.sample();
  a.menu.row=a.manager.current.profiles.length+8;await a.manager.edit({action:'create',name:'Third'});a.tap(V.PAD_A);assert.equal(a.menu.open,false,'Back stays Back as a row appears');
});

test('profile submenu captures Back through release and closes when the original game leaves its menu',async()=>{
  const a=await setup(),menu=new V.SettingsMenu(V.vrSettings({}),()=>{},()=>{},undefined,undefined,undefined,a.menu);let now=0;
  const sample=(buttons=0,available=true)=>menu.sample(now+=16,available,{buttons,steer:0,throttle:0,brake:0},'350Z');
  sample();sample(bit(V.PAD_X));sample();menu.row=menu.fields.length+3;sample(bit(V.PAD_A));await tick();sample();assert.equal(a.menu.open,true);
  sample(bit(V.PAD_B));sample(bit(V.PAD_B));assert.equal(menu.open,true);assert.equal(a.menu.open,false);sample();sample(bit(V.PAD_A));await tick();sample();
  sample(0,false);assert.equal(a.menu.open,false);assert.equal(menu.open,false);menu.destroy();
});

test('switching waits for the applied game name, times out off and never carries work into another session',async()=>{
  const p={id:id(1),name:'Alpha',room:'World 2'},calls=[];let ready=true,hash=0,active,steps=0;
  const game={ready:()=>ready,nameHash:()=>hash,profile:async p=>{calls.push(p);return true;},name:n=>{calls.push(['name',n]);return true;},room:r=>{calls.push(['room',r]);return true;},reset:()=>calls.push('reset')};active=game;
  assert.equal(await V.connectProfile(game,()=>active,p,'secret',async()=>{if(++steps===3)hash=V.connectionNameHash('Alpha');}),true);
  assert.equal(steps,3);assert.deepEqual(copy(calls),[null,'reset',['name','Alpha'],['room','World 2'],{name:'Alpha',claim:'secret'}]);
  calls.length=0;hash=0;steps=0;assert.equal(await V.connectProfile(game,()=>active,p,null,async()=>{steps++;}),false);assert.equal(steps,100);assert.equal(calls.filter(v=>v?.name).length,0);
  calls.length=0;assert.equal(await V.connectProfile(game,()=>active,p,null,async()=>{active=null;}),false);assert.equal(calls.filter(v=>v?.name).length,0);
  active=game;ready=false;calls.length=0;assert.equal(await V.connectProfile(game,()=>active,p,null),false);assert.equal(calls.length,0);
});


test('race preparation uses the selected claim and returns false for rejected, changed or busy profiles',async()=>{
  const actions=[];const a=await setup(async(p,claim)=>{actions.push([p.name,claim]);return true;});a.tokens.set(id(1),'private-token');
  assert.equal(await a.manager.prepareRace(),true);assert.deepEqual(actions,[['Alpha','private-token']]);assert.doesNotMatch(a.manager.notice,/private-token/);
  check=async()=>new Response(JSON.stringify({state:'taken'}));assert.equal(await a.manager.prepareRace(),false);assert.equal(actions.length,1);
  let done;check=()=>new Promise(r=>done=r);const pending=a.manager.prepareRace();await tick();
  assert.equal(await a.manager.prepareRace(),false);const c=a.manager.current;c.selected=id(2);a.setText(JSON.stringify(c));done(new Response(JSON.stringify({state:'free'})));
  assert.equal(await pending,false);assert.equal(actions.length,1);
  check=async()=>new Response(JSON.stringify({state:'free'}));const fail=await setup(async()=>false);assert.equal(await fail.manager.prepareRace(),false);
});
