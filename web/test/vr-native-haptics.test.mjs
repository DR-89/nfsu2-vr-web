import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/native-haptics';export * from './src/vr/haptics';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const endpoint={url:'http://127.0.0.1:12345',token:'0123456789abcdef0123456789abcdef'};
test('native haptics accepts only a bounded loopback port and launcher capability',()=>{
  assert.deepEqual(V.hapticsTarget('12345.'+endpoint.token),endpoint);
  for(const value of [null,'','1.'+endpoint.token,'65536.'+endpoint.token,'host.example:1234.'+endpoint.token,'1234.'+endpoint.token+'\n','1234.bad','1234.'+endpoint.token+'/pulse'])assert.equal(V.hapticsTarget(value),null);
});
test('PCVR uses the local output for both hands while Quest actuators retain direct pulses',()=>{
  const calls=[],bridge={ready:true,pulse:(...args)=>calls.push(args),destroy:()=>{bridge.ready=false;}};
  const h=new V.ControllerHaptics(bridge),pads=[{},{}];assert.equal(h.supported(pads),true);
  h.update(0,pads,[.025,.305]);assert.deepEqual(calls,[[0,.025,100],[1,.305,100]]);
  h.kick(1,.95,28,10);h.update(10,pads,[.025,.305]);assert.deepEqual(calls.at(-1),[1,V.mixRumble(.305,.95),28]);
  h.update(39,pads,[.8,.8]);assert.deepEqual(calls.slice(-2),[[0,.8,100],[1,.8,100]]);
  h.stop();assert.deepEqual(calls.slice(-2),[[0,0,0],[1,0,0]]);
  const quest=[];const pad={hapticActuators:[{pulse:(...args)=>{quest.push(args);return Promise.resolve(true);}}]};
  const count=calls.length;h.update(100,[pad,null],[.5,0]);assert.deepEqual(quest,[[.5,100]]);assert.equal(calls.length,count);
  h.destroy();assert.deepEqual(quest.at(-1),[0,0]);assert.equal(bridge.ready,false);
});
test('bridge readiness is confirmed, two hand updates coalesce and the token stays in headers',async()=>{
  let now=100;const calls=[];
  const request=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({version:1,ready:true})};};
  const h=new V.NativeHaptics(endpoint,request,()=>now);assert.equal(h.ready,false);await tick();assert.equal(h.ready,true);
  h.pulse(0,.25,100);h.pulse(1,.95,28);await tick();
  assert.equal(calls.length,2);const {url,options}=calls[1];assert.equal(url,endpoint.url+'/pulse');assert.equal(options.credentials,'omit');
  assert.equal(options.headers['X-NFSU2-Haptics'],endpoint.token);assert.equal(options.body.byteLength,16);
  const values=new Float32Array(options.body);assert.deepEqual([values[0],values[1],values[3]],[.25,100,28]);assert.ok(Math.abs(values[2]-.95)<1e-6);
  now+=1600;assert.equal(h.ready,false);h.destroy();await tick();assert.equal(h.ready,false,'late status cannot resurrect a destroyed bridge');
});
test('a delayed local request cannot queue old clicks or replay them after they expire',async()=>{
  let now=100,release;const packets=[];
  const h=new V.NativeHaptics(endpoint,(url,options)=>{
    packets.push(new Float32Array(options.body));return new Promise(resolve=>{release=()=>resolve({ok:true});});
  },()=>now);
  h.pulse(0,.3,100);await tick();h.pulse(1,.95,28);now+=150;h.pulse(0,0,0);await tick();assert.equal(packets.length,1);
  release();await tick();assert.equal(packets.length,2);assert.deepEqual(Array.from(packets[1]),[0,0,0,0]);
  release();h.destroy();await tick();
});
test('a stopped or rejected helper does not advertise force feedback to the game',async()=>{
  let now=0;const h=new V.NativeHaptics(endpoint,async()=>{throw new Error('offline');},()=>now);
  assert.equal(h.ready,false);await tick();now=1001;assert.equal(h.ready,false);await tick();h.destroy();
});

test('automatic discovery reconnects after a background helper restart without a launcher URL',async()=>{
  let now=0,token=endpoint.token;const calls=[];
  const h=new V.NativeHaptics({url:V.HAPTICS_DISCOVERY_URL},async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/connect'))return {ok:true,json:async()=>({version:1,token})};
    const ok=options.headers['X-NFSU2-Haptics']===token;
    return {ok,status:ok?200:403,json:async()=>({version:1,ready:true})};
  },()=>now);
  assert.equal(h.ready,false);await tick();assert.equal(h.state,'connected');
  assert.equal(h.ready,false);await tick();assert.equal(h.ready,true);
  token='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';now+=1001;void h.ready;await tick();
  assert.equal(h.ready,false);assert.equal(h.state,'unavailable');
  now+=1001;void h.ready;await tick();void h.ready;await tick();assert.equal(h.ready,true);
  h.pulse(1,.5,28);await tick();assert.equal(calls.at(-1).options.headers['X-NFSU2-Haptics'],token);
  assert.equal(calls.filter(c=>c.url.endsWith('/connect')).length,2);
  assert.ok(calls.every(c=>!c.url.includes(token)));h.destroy();
});

test('a reachable helper is not reported as a loaded browser vibration extension',async()=>{
  for(const [state,want] of [[{version:1,ready:false},'update'],[{version:1,bridgeVersion:3,ready:false,initialized:false},'restart'],[{version:1,bridgeVersion:3,ready:false,initialized:true},'connected'],[{version:1,bridgeVersion:3,ready:true,initialized:true},'ready']]){
    const h=new V.NativeHaptics(endpoint,async()=>({ok:true,json:async()=>state}));
    void h.ready;await tick();assert.equal(h.state,want);h.destroy();
  }
});
