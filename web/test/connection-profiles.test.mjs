import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';
const code=(await esbuild.build({stdin:{contents:`export * from './src/app/connection-profiles';export * from './src/app/connection-auth';export {CONNECTION_AUTH_DB} from './src/app/prefs';export {keysOf,newPhrase,keeps} from './src/app/vault';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'C',write:false})).outputFiles[0].text;
const V=(await import('node:vm')).runInNewContext(code+';C;',{TextEncoder,TextDecoder});
const id=n=>String(n).padStart(32,'0'),blank=()=>({version:1,identity:id(0),selected:'',profiles:[]});
test('connection catalogue preserves native eight-profile limits and rejects corrupt or newer files',()=>{
  let c=blank();for(let i=1;i<=8;i++)c=V.editConnection(c,{action:'create',name:'Driver '+i},()=>id(i));
  assert.equal(c.profiles.length,8);assert.equal(c.selected,id(8));assert.equal(c.profiles[0].name,'Driver_1');
  assert.throws(()=>V.editConnection(c,{action:'create',name:'Ninth'},()=>id(9)),e=>e.code==='limit');
  const original=JSON.stringify(c);c=V.editConnection(c,{action:'room',id:id(2),text:'世界 World 2'});assert.equal(c.profiles[1].room,'世界 World 2');assert.equal(JSON.parse(original).profiles[1].room,'');
  c=V.editConnection(c,{action:'select',id:id(2)});c=V.editConnection(c,{action:'delete',id:id(2)});assert.equal(c.selected,id(1));
  assert.ok(V.connectionCatalog(JSON.stringify(c)));assert.ok(V.keeps(V.CONNECTION_FILE),'portable catalogue enters the encrypted cloud archive');
  for(const bad of [{...c,version:2},{...c,selected:id(99)},{...c,identity:'../profile'},{...c,profiles:[c.profiles[0],c.profiles[0]]},{...c,profiles:[{id:id(1),name:'ABC\n',room:''}]},{...c,profiles:[{id:id(1),name:'ABC',room:'x'.repeat(64)}]},{...c,profiles:[{id:id(1),name:'ABC',room:'\ud800'}]}])assert.equal(V.connectionCatalog(JSON.stringify(bad)),null);
  assert.equal(V.connectionCatalog('x'.repeat(16385)),null);assert.equal(V.connectionCatalog('null'),null);
  assert.throws(()=>V.editConnection(c,{action:'room',id:id(1),text:'я'.repeat(32)}),e=>e.code==='room');
  c.future={a:[1,2]};c.profiles[0].future='kept';c=V.editConnection(V.connectionCatalog(JSON.stringify(c)),{action:'rename',id:id(1),text:'Future'});
  assert.equal(JSON.stringify(c.future),'{"a":[1,2]}');assert.equal(c.profiles[0].future,'kept');
});
test('profile writes serialize against fresh files, fail without publishing and never overwrite unreadable/newer data',async()=>{
  let text=null,n=0,release;const writes=[],s=new V.ConnectionProfiles({read:async()=>text,write:async next=>{writes.push(next);if(writes.length===1)await new Promise(r=>release=r);text=next;}},()=>id(++n));
  await s.load();const first=s.edit({action:'create',name:'First'}),second=s.edit({action:'create',name:'Second'});
  await new Promise(r=>setImmediate(r));assert.equal(s.current.profiles.length,0);assert.equal(writes.length,1);release();await Promise.all([first,second]);assert.equal(s.current.profiles.length,2);
  const copy=s.current;copy.profiles[0].name='Changed';assert.equal(s.current.profiles[0].name,'First');
  const before=s.current;text='{"version":2}';await assert.rejects(s.edit({action:'delete',id:before.selected}),e=>e.code==='format');assert.equal(text,'{"version":2}');assert.equal(s.current.profiles.length,2);
  const f=new V.ConnectionProfiles({read:async()=>{throw Error('unreadable');},write:async()=>assert.fail('wrote unreadable file')});await assert.rejects(f.edit({action:'create',name:'A'}),/unreadable/);
  const g=new V.ConnectionProfiles({read:async()=>JSON.stringify(before),write:async()=>{throw Error('quota');}});await g.load();await assert.rejects(g.edit({action:'delete',id:before.selected}),/quota/);assert.equal(g.current.profiles.length,2);
  text=null;await s.load();assert.equal(s.current.profiles.length,0,'a missing catalogue does not resurrect an old snapshot');
});
test('browser device credentials seal only tokens, survive reopen, bind each record and serialize forget after linking',async t=>{
  const server=createServer((_q,r)=>r.end('<!doctype html><body>Connection credentials test</body>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:code});
  const result=await page.evaluate(async()=>{
    const id='1'.repeat(32),other='2'.repeat(32),phrase=C.newPhrase(),expected=(await C.keysOf(phrase)).token,auth=new C.ConnectionAuth('career');
    await auth.link(id,phrase);const token=await auth.token(id);await auth.close();const reopened=new C.ConnectionAuth('career');const retained=await reopened.token(id);
    let db=await new Promise((ok,no)=>{const r=indexedDB.open(C.CONNECTION_AUTH_DB);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
    const get=(store,key)=>new Promise((ok,no)=>{const r=db.transaction(store,'readonly').objectStore(store).get(key);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
    const record=await get('claims','career\0'+id),key=await get('keys','device');const raw=new TextDecoder().decode(record.box);
    // Copying a ciphertext to another profile must not make its token usable.
    await new Promise((ok,no)=>{const tx=db.transaction('claims','readwrite');tx.objectStore('claims').put(record,'career\0'+other);tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});
    let movedRejected=false;try{await reopened.token(other);}catch{movedRejected=true;}
    let badRejected=false;try{await reopened.link(id,'invalid');}catch{badRejected=true;}
    const previous=await reopened.token(id);const pending=reopened.link(id,phrase),forget=reopened.forget(id);await Promise.all([pending,forget]);const gone=await reopened.token(id);
    await reopened.link(id,phrase);await reopened.link(id,'');const emptyRemoves=await reopened.token(id);await reopened.close();db.close();
    return {matching:token===expected&&retained===expected&&previous===expected,extractable:key.extractable,algorithm:key.algorithm.name,ciphertext:record.box.length,containsSecret:raw.includes(expected)||raw.includes(phrase),movedRejected,badRejected,gone,emptyRemoves};
  });
  assert.deepEqual(result,{matching:true,extractable:false,algorithm:'AES-GCM',ciphertext:59,containsSecret:false,movedRejected:true,badRejected:true,gone:null,emptyRemoves:null});
});
