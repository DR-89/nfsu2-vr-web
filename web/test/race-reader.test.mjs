import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import * as esbuild from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const built=await esbuild.build({stdin:{contents:"export * from './web/src/app/race-reader.ts';",resolveDir:root,loader:'ts'},bundle:true,format:'esm',write:false,platform:'neutral'});
const R=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const hasClang=process.platform!=='win32'&&spawnSync('clang',['--version']).status===0;
let fixture;
function native(){
  if(fixture)return fixture;
  const out=path.join(root,'out/web/test');fs.mkdirSync(out,{recursive:true});
  const bin=path.join(out,'racebrowser-unit'),file=bin+'.bin';
  execFileSync('clang',['-O1','-g','-Wall','-Wextra','-Werror','-Iruntime',
    'tests/racebrowser_unit.c','runtime/racebrowser.c','-o',bin],{cwd:root,encoding:'utf8'});
  assert.match(execFileSync(bin,[file],{encoding:'utf8'}),/PASS PC catalogue/);
  fixture=new Uint8Array(fs.readFileSync(file));return fixture;
}
const opts={skip:!hasClang&&'native clang unavailable'};
test('PC catalogue and lobby reader reject sparse/stale records and preserve game memory',opts,()=>{
  const b=native();assert.equal(b.length,R.RACE_BYTES);
  assert.equal(Buffer.from(b).includes(Buffer.from('PRIVATE_AUTH_TOKEN')),false);
  assert.equal(Buffer.from(b).includes(Buffer.from('PRIVATE_DEVELOPMENT_LABEL')),false);
});
test('C-written race snapshot decodes choices and original lobby rows without guest pointers',opts,()=>{
  const r=R.decodeRaceSnapshot(native(),2);assert.ok(r);assert.equal(r.choices.length,7);assert.equal(r.source,'list');
  assert.deepEqual(r.rows.map(r=>[r.id,r.track,r.mode,r.compatible]),[[100,4101,0,true],[101,4101,0,true]]);
  assert.equal(r.persona,'Host');assert.equal(r.choices[0].name,'König-Straße');
  assert.deepEqual(r.choices[0].reverseName,r.choices[0].name);assert.equal(r.current,null);assert.deepEqual(r.players,[]);
});
test('race reader bounds, odd sequences, incompatible versions and detached growth',opts,()=>{
  const buf=new SharedArrayBuffer(R.RACE_BYTES+8),memory={buffer:buf};new Uint8Array(buf,8).set(native());
  assert.equal(R.RaceReader.open(memory,7,R.RACE_BYTES),null);assert.equal(R.RaceReader.open(memory,12,R.RACE_BYTES),null);
  assert.equal(R.RaceReader.open(memory,8,R.RACE_BYTES-4),null);
  const reader=R.RaceReader.open(memory,8,R.RACE_BYTES);assert.ok(reader);assert.equal(reader.read().source,'list');
  const words=new Int32Array(buf,8,4);Atomics.store(words,3,3);assert.equal(reader.read(),null);Atomics.store(words,3,4);
  assert.equal(reader.read().revision,4);words[1]=99;assert.equal(reader.read(),null);assert.equal(R.RaceReader.open(memory,8,R.RACE_BYTES),null);words[1]=R.RACE_VERSION;
  memory.buffer=new SharedArrayBuffer(R.RACE_BYTES+100);new Uint8Array(memory.buffer,8,R.RACE_BYTES).set(native());assert.equal(reader.read().revision,2);
  memory.buffer=new SharedArrayBuffer(8);assert.equal(reader.read(),null);
});
test('race snapshots are owned copies and malformed row/count data fail closed',opts,()=>{
  const buf=new SharedArrayBuffer(R.RACE_BYTES),memory={buffer:buf};new Uint8Array(buf).set(native());
  const reader=R.RaceReader.open(memory,0,R.RACE_BYTES),a=reader.read();a.choices[0].name='Changed';a.rows[0].name='Changed';
  assert.equal(reader.read().rows[0].name,'Room');assert.equal(reader.read().choices[0].name,'König-Straße');
  for(const [offset,value] of [[24,129],[16,0],[101404,4],[101412,21],[101408,5000],[101404+276+4,100],[101404+276+232,2],[101404+24,0]]){
    const b=native().slice();new DataView(b.buffer).setUint32(offset,value,true);assert.equal(R.decodeRaceSnapshot(b,2),null,`offset ${offset}`);
  }
  const bad=native().slice();bad.fill(65,101404+276+28,101404+276+64);assert.equal(R.decodeRaceSnapshot(bad,2),null);
  assert.equal(R.decodeRaceSnapshot(native(),4),null);assert.equal(R.decodeRaceSnapshot(native().slice(0,-1),2),null);
});
test('room snapshot keeps readiness separate from host start permission',opts,()=>{
  const b=native().slice(),d=new DataView(b.buffer),at=101404,set=(offset,value)=>d.setUint32(at+offset,value,true),str=(offset,s)=>{b.fill(0,at+offset,at+offset+16);b.set(Buffer.from(s),at+offset);};
  b.copyWithin(at+40,at+276,at+276+236);b.fill(0,at+276,at+4996);
  set(0,3);set(4,0);set(8,0);set(12,1);set(16,0);set(20,1);set(4996,2);str(5000,'Host');str(5016,'Guest');set(5096,0);set(5100,0x08000000);
  const r=R.decodeRaceSnapshot(b,2);assert.ok(r);assert.equal(r.startable,true);assert.equal(r.ready,false);assert.equal(r.current.id,100);
  set(5100,0);assert.equal(R.decodeRaceSnapshot(b,2),null,'an unready guest cannot leave the host startable');
  set(20,0);assert.equal(R.decodeRaceSnapshot(b,2).startable,false);
  str(5016,'Host');assert.equal(R.decodeRaceSnapshot(b,2),null,'duplicate members');
});
test('Latin-1 service room names remain listed; unsupported PARAMS stay incompatible',opts,()=>{
  const b=native().slice(),at=101404+276,d=new DataView(b.buffer);
  b.fill(0,at+28,at+64);b.set(Buffer.from('Königs Rennen','latin1'),at+28);
  assert.equal(R.decodeRaceSnapshot(b,2).rows[0].name,'Königs Rennen');
  b.fill(0,at+80,at+212);b.set(Buffer.from('Unbekannt Ä','latin1'),at+80);
  for(const offset of [212,216,224,228,232])d.setUint32(at+offset,0,true);d.setUint32(at+220,0xffffffff,true);
  const row=R.decodeRaceSnapshot(b,2).rows[0];assert.equal(row.params,'Unbekannt Ä');assert.equal(row.compatible,false);
  b[at+28]=0x81;assert.equal(R.decodeRaceSnapshot(b,2),null);
});

test('original PC race commands validate ownership/options and restore only owned fields',opts,()=>{
  const out=path.join(root,'out/web/test');fs.mkdirSync(out,{recursive:true});const bin=path.join(out,'raceactions-unit');
  execFileSync('clang',['-O1','-g','-Wall','-Wextra','-Werror','-Iruntime','tests/raceactions_unit.c','runtime/raceactions.c','runtime/racebrowser.c','-o',bin],{cwd:root,encoding:'utf8'});
  assert.match(execFileSync(bin,{encoding:'utf8'}),/PASS original PC lobby actions/);
});
test('race mailbox has one pending command and never returns password data',opts,()=>{
  const memory={buffer:new SharedArrayBuffer(R.RACE_BYTES)};new Uint8Array(memory.buffer).set(native());
  const d=new DataView(memory.buffer);d.setUint32(106524,27,true);const reader=R.RaceReader.open(memory,0,R.RACE_BYTES);
  const a=reader.read();assert.equal(a.epoch,27);
  const cmd={action:'join',epoch:a.epoch,selected:a.rows[0],value:0,password:'Secret_123'};
  assert.equal(reader.send({...cmd,epoch:26}),null);
  const seq=reader.send(cmd);assert.equal(seq,2);assert.equal(reader.send(cmd),null);
  assert.equal(d.getUint32(106544,true),27);assert.equal(d.getUint32(106548,true),3);
  assert.equal(d.getUint32(106556,true),100);assert.equal(d.getUint32(106540,true),2);
  assert.equal(JSON.stringify(reader.read()).includes('Secret_123'),false);
  new Uint8Array(memory.buffer,106544,328).fill(0);d.setUint32(106528,2,true);d.setUint32(106532,1,true);d.setUint32(106536,3,true);
  assert.equal(reader.read().result,'accepted');assert.equal(reader.send({...cmd,password:''}),4);
  for(const edit of [{password:'x'.repeat(33)},{password:'bad=tag'},{value:-1},{epoch:1.5},{selected:undefined},{action:'create'}])
    assert.equal(R.encodeRaceCommand({...cmd,...edit}),null);
  d.setUint32(106532,9,true);assert.equal(reader.read(),null);
});

test('all-race searches match original LAN predicates without changing retail filters',opts,()=>{
  const out=path.join(root,'out/web/test');fs.mkdirSync(out,{recursive:true});const bin=path.join(out,'raceactions-game-unit');
  execFileSync('clang',['-O1','-g','-Wall','-Wextra','-Werror','-Iruntime','tests/raceactions_game_unit.c','runtime/raceactions_game.c','-o',bin],{cwd:root,encoding:'utf8'});
  assert.match(execFileSync(bin,{encoding:'utf8'}),/PASS scoped LAN and Online search filters/);
});

test('race dialog ownership is a bounded flag independent of a valid lobby',opts,()=>{
  const b=native().slice(),d=new DataView(b.buffer);d.setUint32(20,3,true);
  assert.equal(R.decodeRaceSnapshot(b,2).originalDialog,true);assert.equal(R.decodeRaceSnapshot(b,2).lobbyValid,true);
  d.setUint32(20,256,true);assert.equal(R.decodeRaceSnapshot(b,2),null);
});


test('race entry owns original transitions and protects career/profile/dialog state',opts,()=>{
  const out=path.join(root,'out/web/test');fs.mkdirSync(out,{recursive:true});const bin=path.join(out,'raceentry-unit');
  execFileSync('clang',['-O1','-g','-Wall','-Wextra','-Werror','-Iruntime','tests/raceentry_unit.c','runtime/raceentry.c','-o',bin],{cwd:root,encoding:'utf8'});
  assert.match(execFileSync(bin,{encoding:'utf8'}),/PASS original race browser entry and career return/);
});

test('entry flags and commands work without a lobby and reject unowned return state',opts,()=>{
  const b=native().slice(),d=new DataView(b.buffer);b.fill(0,101404,106524);d.setUint32(20,4,true);
  const s=R.decodeRaceSnapshot(b,2);assert.ok(s.canEnter);assert.equal(s.entryActive,false);assert.equal(s.source,'none');
  d.setUint32(20,8|16|32,true);assert.equal(R.decodeRaceSnapshot(b,2).fromCareer,true);
  d.setUint32(20,16,true);assert.equal(R.decodeRaceSnapshot(b,2),null);
  for(const [action,n] of [['enter',7],['exit',8]])assert.equal(new DataView(R.encodeRaceCommand({epoch:1,action}).buffer).getUint32(4,true),n);
});


test('UTF-8 PC labels preserve Unicode and reject malformed encodings independently of service Latin-1',opts,()=>{
  const b=native().slice(),start=52;
  for(const caption of ['Плаза','카탈로그','カタログ','賽道','เส้นทาง','Zażółć','Αθήνα','Ľúčky']){
    b.fill(0,start,start+384);b.set(new TextEncoder().encode(caption),start);assert.equal(R.decodeRaceSnapshot(b,2).choices[0].name,caption);
  }
  for(const bytes of [[0xc0,0xaf],[0xed,0xa0,0x80],[0xf0,0x9f],[0xc2,0x85]]){
    b.fill(0,start,start+384);b.set(bytes,start);assert.equal(R.decodeRaceSnapshot(b,2),null);
  }
});
