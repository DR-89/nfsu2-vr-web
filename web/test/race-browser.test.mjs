import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import {fileURLToPath} from 'node:url';
const built=await esbuild.build({stdin:{contents:"export * from './src/app/race-browser.ts'",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false,platform:'neutral'});
const {RaceBrowser,raceKey}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function fixture(prepare){
  const row=id=>({id,seed:id,name:'Race '+id,host:'Driver'+id,params:'TRACK=4101 DIR=0 LAPS=2',minPlayers:2,maxPlayers:6,
    customFlags:0x04000003,systemFlags:0x10000,players:1,compatible:true,parsed:true,mode:0,track:4101,laps:2,reverse:false});
  const choice=(mode,track,reverse,minLaps,maxLaps,maxPlayers)=>({mode,track,reverse,minLaps,maxLaps,maxPlayers,name:'',reverseName:''});
  let snapshot={epoch:27,ack:0,result:'idle',action:0,revision:2,catalogValid:true,lobbyValid:true,source:'list',listed:2,
    rows:[row(1),row(2)],choices:[choice(0,4101,true,2,10,6),choice(0,4102,false,2,10,6),choice(2,4402,false,1,1,3),choice(10,4601,false,4,10,6)],
    persona:'Local',host:false,ready:false,startable:false,current:null,players:[]};
  const commands=[];let serial=0;
  const m=new RaceBrowser(()=>({read:()=>snapshot,send:c=>{commands.push(c);return serial+=2;} }),prepare);m.update();
  return {m,commands,get s(){return snapshot;},set s(s){snapshot=s;},update(patch){snapshot={...snapshot,...patch,revision:snapshot.revision+2};m.update();},row};
}
test('selection follows identity through reorder/occupancy changes and rejects record replacement',()=>{
  const f=fixture(),m=f.m;assert(m.select(raceKey(f.s.rows[0])));assert(m.setPassword('Join_Secret'));
  f.update({rows:[f.s.rows[1],{...f.s.rows[0],players:3}]});assert.equal(m.selected.players,3);
  assert(m.join());assert.equal(f.commands[0].value,1);assert.equal(f.commands[0].password,'Join_Secret');assert(!m.hasPassword);
  f.update({ack:2,result:'stale'});assert.equal(m.notice,'stale');assert(m.select(raceKey(f.s.rows[0])));
  f.update({rows:[{...f.s.rows[0],seed:900},f.s.rows[1]]});assert.equal(m.selected,null);assert(!m.join());assert.equal(f.commands.length,1);
});
test('one command owns the slot through transient reads, and waiting states cannot create or join',()=>{
  const f=fixture(),m=f.m;assert(m.search(20));assert(!m.search(40));assert(!m.beginCreate());
  const previous=f.s;f.s=null;m.update();assert(m.busy);assert.equal(m.pendingSerial,2);
  f.s=previous;f.update({ack:2,result:'accepted',source:'waiting',rows:[],listed:0});assert(m.busy);assert.equal(m.page,20);assert(!m.beginCreate());
  f.update({source:'list',rows:[f.row(1)],listed:1});assert(!m.busy);assert.equal(m.page,20);assert(m.beginCreate());
  assert(m.setPassword('Hidden_123'));f.update({epoch:28});assert(!m.creating);assert(!m.hasPassword);
});
test('create form uses loaded PC rules and never alters game state before submission',()=>{
  const f=fixture(),m=f.m;assert(m.beginCreate());m.adjust('reverse',1);m.adjust('laps',1);assert.equal(m.options.laps,3);
  m.adjust('mode',1);assert.equal(m.options.track,4402);assert.equal(m.options.maxPlayers,3);assert.equal(m.options.laps,1);assert(!m.options.reverse);
  m.adjust('laps',-1);assert.equal(m.options.laps,1);m.adjust('minPlayers',1);assert.equal(m.options.minPlayers,3);
  m.adjust('maxPlayers',1);assert.equal(m.options.minPlayers,2);assert.equal(m.options.maxPlayers,2);
  m.adjust('mode',1);assert.equal(m.options.mode,10);assert.equal(m.options.laps,4);assert(!m.options.catchup);m.adjust('catchup',1);assert(!m.options.catchup);
  assert(!m.setPassword('bad=tag'));assert(!m.setPassword('A'.repeat(13)));assert(m.setPassword('Create_123'));
  assert.equal(f.commands.length,0);assert(m.create());assert.equal(f.commands[0].options.track,4601);assert(!f.commands[0].options.ranked);
  assert.equal(f.commands[0].password,'Create_123');assert(!m.creating);assert(!m.hasPassword);assert(!m.create());
});
test('empty reads do not discard an edited form; full races and host permission remain authoritative',()=>{
  const f=fixture(),m=f.m;assert(m.beginCreate());const previous=f.s;f.s=null;m.update();assert(m.busy);
  f.s=previous;m.update();assert(m.creating);m.cancel();
  assert(m.select(raceKey(f.s.rows[0])));f.update({rows:[{...f.s.rows[0],players:6},f.s.rows[1]]});assert(!m.join());
  f.update({epoch:28,source:'room',current:f.row(3),rows:[],listed:0});assert(!m.start());assert(m.ready());
  f.update({ack:2,result:'accepted',ready:true,startable:true,host:true});assert(m.start());assert.equal(f.commands[1].action,'start');
  m.close();assert(m.busy);f.update({ack:4,result:'busy'});assert.equal(m.notice,'busy');assert(m.leave());
});


test('entry prepares the chosen connection once, then submits only while the original context still matches',async()=>{
  let resolve,prepared=0;const f=fixture(()=>{prepared++;return new Promise(r=>resolve=r);});
  f.update({source:'none',lobbyValid:false,canEnter:true,rows:[],listed:0});
  assert(f.m.available);assert(f.m.canEnter);assert(!f.m.canCreate);
  const pending=f.m.enter();assert(f.m.busy);assert.equal(await f.m.enter(),false);assert.equal(prepared,1);
  resolve(true);assert.equal(await pending,true);assert.deepEqual(f.commands,[{epoch:27,action:'enter'}]);
  f.update({ack:2,result:'accepted',canEnter:false,entryActive:true,entryBusy:true});assert(f.m.busy);assert(!f.m.canExit);
  f.update({entryBusy:false,canExit:true,source:'list',lobbyValid:true});assert(f.m.exit());assert.equal(f.commands.at(-1).action,'exit');assert(!f.m.exit());
});

test('closing, context changes and failed profile preparation cannot submit a late entry',async()=>{
  for(const cancel of ['close','epoch','unavailable','failed']){
    let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.update({source:'none',lobbyValid:false,canEnter:true,rows:[],listed:0});
    const pending=f.m.enter();
    if(cancel==='close')f.m.close();else if(cancel==='epoch')f.update({epoch:28});else if(cancel==='unavailable')f.update({canEnter:false});
    resolve(cancel!=='failed');assert.equal(await pending,false,cancel);assert.equal(f.commands.length,0,cancel);
  }
});
