import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const built=await esbuild.build({stdin:{contents:"export * from './src/vr/race-menu';export * from './src/app/race-browser';export * from './src/app/race-view';export * from './src/input/proto';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false});
const R=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function fixture(prepare){
  const row=id=>({id,seed:id,name:'Race '+id,host:'Driver'+id,params:'TRACK=4101 DIR=0 LAPS=2',minPlayers:2,maxPlayers:6,customFlags:0x04000003,systemFlags:0x10000,players:1,compatible:true,parsed:true,mode:0,track:4101,laps:2,reverse:false});
  const choice={mode:0,track:4101,reverse:true,minLaps:2,maxLaps:10,maxPlayers:6,name:'Track',reverseName:'Rev'};
  let s={epoch:27,ack:0,result:'idle',action:0,revision:2,catalogValid:true,lobbyValid:true,originalDialog:false,source:'list',listed:2,rows:[row(1),row(2)],choices:[choice],persona:'Local',host:false,ready:false,startable:false,current:null,players:[]},serial=0,now=0;
  const commands=[],m=new R.RaceBrowser(()=>({read:()=>s,send:c=>{commands.push(c);return serial+=2;}}),prepare),menu=new R.RaceMenu(m,'english');m.update();
  const sample=(key=0)=>menu.sample(now+=16,{buttons:key,steer:0,throttle:0,brake:0});
  const update=patch=>{s={...s,...patch,revision:s.revision+2};m.update();};
  return {m,menu,commands,row,sample,update,get s(){return s;},press(key){sample();sample(1<<key);sample();},
    open(){menu.show();update({ack:serial,result:'accepted'});sample();},
    select(key){menu.row=R.raceView(m,'english').rows.findIndex(r=>r.key===key);assert(menu.row>=0,key);}};
}
test('race menu captures held buttons and keeps command selection when the list changes',()=>{
  const f=fixture();f.menu.show();f.update({ack:2,result:'accepted'});f.sample(1<<R.PAD_A);f.sample(1<<R.PAD_A);assert.equal(f.m.selected,null);
  f.sample();f.press(R.PAD_A);assert.equal(f.m.selected.id,1);f.press(R.PAD_B);assert.equal(f.m.selected,null);
  f.select('refresh');f.update({rows:[f.row(3)],listed:1});f.sample();assert.equal(R.raceView(f.m,'english').rows[f.menu.row].key,'refresh');
  f.press(R.PAD_A);assert.equal(f.commands.length,2);assert.equal(f.commands[1].action,'search');
});
test('removed race selection cannot silently become another join target',()=>{
  const f=fixture();f.open();f.select('race:'+R.raceKey(f.s.rows[0]));f.sample();
  f.update({rows:[f.row(4),f.row(2)]});f.sample(1<<R.PAD_A);assert.equal(f.m.selected,null);assert.equal(f.commands.length,1);
  f.sample();f.press(R.PAD_A);assert.equal(f.m.selected.id,4);
});
test('password keyboard is masked, allows original password symbols and clears on tracking loss',()=>{
  const f=fixture();f.open();f.select('new');f.press(R.PAD_A);assert(f.m.creating);f.select('password');f.press(R.PAD_A);
  f.sample();f.press(R.PAD_A);assert.equal(f.menu.keyboard.shown(),'•');
  f.menu.keyboard.key=36;f.press(R.PAD_A);f.menu.keyboard.key=37;f.press(R.PAD_A);
  f.menu.keyboard.key=39;f.press(R.PAD_A);assert.equal(f.m.passwordInput,'A_-');assert(!f.menu.keyboard.active);
  f.select('password');f.press(R.PAD_A);f.sample();assert.equal(f.menu.keyboard.shown(),'•••');
  f.menu.sample(null,null);assert.equal(f.m.passwordInput,'');assert(!f.menu.keyboard.active);
});
test('original dialogs take input and restore menu ownership only after release',()=>{
  const f=fixture();f.open();f.update({epoch:28,source:'room',current:f.row(1),rows:[],listed:0,players:[{name:'Local',ready:false}],host:true,startable:false});f.sample();
  f.update({originalDialog:true});assert.equal(f.sample(1<<R.PAD_A),false);assert.equal(f.menu.overlay(0,0),null);
  f.update({originalDialog:false});assert.equal(f.sample(1<<R.PAD_A),true);assert.equal(f.commands.length,1);
  f.sample();f.press(R.PAD_A);assert.equal(f.commands[1].action,'ready');assert.equal(f.commands[1].value,1);
  f.menu.close();assert(!f.menu.open);
});
test('closing an inactive headset menu preserves a website form',()=>{
  const f=fixture();f.m.beginCreate();f.m.setPassword('Local_Only');f.menu.close();assert(f.m.creating);assert.equal(f.m.passwordInput,'Local_Only');
});

test('first search selects its first result after an initially empty list',()=>{
  const f=fixture();f.update({rows:[],listed:0});f.menu.show();f.sample();
  f.update({source:'waiting'});f.sample();
  f.update({source:'list',rows:[f.row(3)],listed:1,ack:2,result:'accepted'});f.sample();
  assert.equal(f.menu.row,0);f.press(R.PAD_A);assert.equal(f.m.selected.id,3);
});

test('failed join returns to the first race without selecting a transient waiting command',()=>{
  const f=fixture();f.open();f.press(R.PAD_A);f.select('join');f.press(R.PAD_A);
  assert.equal(f.commands.at(-1).action,'join');
  f.update({source:'waiting',rows:[],listed:0,ack:4,result:'accepted'});f.sample();f.press(R.PAD_DDOWN);
  f.update({source:'list',rows:[f.row(1)],listed:1,originalDialog:true});assert.equal(f.sample(1<<R.PAD_A),false);
  f.update({originalDialog:false});f.sample(1<<R.PAD_A);assert.equal(f.m.selected,null);
  f.sample();assert.equal(f.menu.row,0);f.press(R.PAD_A);assert.equal(f.m.selected.id,1);
});


test('headset opens from the career/menu gate and exposes the owned return without a lobby',async()=>{
  const f=fixture(async()=>true);f.update({source:'none',lobbyValid:false,canEnter:true,rows:[],listed:0});
  assert(f.menu.available);f.open();assert.equal(R.raceView(f.m,'english').kind,'entry');f.press(R.PAD_A);
  await new Promise(r=>setImmediate(r));assert.equal(f.commands.at(-1).action,'enter');
  f.update({ack:2,result:'accepted',canEnter:false,entryActive:true,fromCareer:true,entryBusy:true});f.sample();assert(f.m.busy);
  f.update({entryBusy:false,canExit:true});f.sample();f.select('exit');f.press(R.PAD_A);assert.equal(f.commands.at(-1).action,'exit');
});
