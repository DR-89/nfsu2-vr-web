// The original PC replay and renderer with synthetic tracked controllers.
// No replay snapshots or position checksums are bypassed.
import {chromium} from 'playwright';
import {pickBrowser} from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../..',import.meta.url)),base=process.argv[2]??'http://localhost:8614',out=path.resolve(repo,process.argv[3]??'out/vr-checks/replay-live');fs.mkdirSync(out,{recursive:true});
const script=fs.readFileSync(path.join(repo,'tests/scripts/replay_pause.txt'),'utf8').split('+0    wzero')[0]+
  '+0 pad disconnect\n+0 wzero\n7000wms poke [[[0x8900ac]+0x4]+0x30]+0x2c0 1\n+0 log replay_record_ready\n+36000 quit\n';
const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']}),page=await browser.newPage({viewport:{width:1280,height:800}}),logs=[],result={record:[],views:[]};
page.on('console',m=>{logs.push(m.text());fs.writeFileSync(out+'/progress.log',logs.join('\n'));});page.on('pageerror',e=>logs.push(String(e)));
const state=()=>page.evaluate(()=>{
 const s=window.__nfsu2.session,c=s.cockpit,m=new DataView(s.proc.memory.buffer),u=a=>m.getUint32(a,true),p=u(0xd00000),rec=u(0x8650b8),ui=u(0x8363ec);
 return {phase:window.__nfsu2.phase,epoch:s.renderer.vr.replayEpoch,ui,hidden:ui?m.getUint8(ui+0x74):null,leaving:ui?m.getUint8(ui+0xd2):0,
  frame:u(0x7fb724),first:rec?u(rec+0x78):0,recording:rec?u(rec+4):0,playing:rec?u(rec):0,error:rec?u(rec+8):0,bad:rec?u(rec+12):0,paused:rec?u(rec+20):0,
  slot:p?u(p+0x21c):0,mover:p?u(p+0x238):0,moverVT:p?u(u(p+0x238)):0,cockpit:c.scene?.cockpit,replay:c.scene?.replay,telemetry:c.scene?.telemetry,box:c.scene?.gearbox,lever:{hand:c.shifter.hand,x:c.shifter.x,z:c.shifter.z},gpu:s.renderer.stats()['gpu errors'],status:Object.fromEntries(s.status.read()??[])};
});
const save=async label=>{const s={label,...await state()};console.log(label,JSON.stringify(s));fs.writeFileSync(out+'/last-state.json',JSON.stringify(s,null,2));return s;};
const key=async code=>{await page.evaluate(code=>window.__nfsu2.session.input.key(code,true),code);await page.waitForTimeout(100);await page.evaluate(code=>window.__nfsu2.session.input.key(code,false),code);await page.waitForTimeout(250);};
const button=async(h,b,ms=120)=>{await page.evaluate(({h,b})=>window.sources[h].gamepad.buttons[b].value=1,{h,b});await page.waitForTimeout(ms);await page.evaluate(({h,b})=>window.sources[h].gamepad.buttons[b].value=0,{h,b});await page.waitForTimeout(280);};
const move=async(x,z)=>{await page.evaluate(([x,z])=>{window.handTarget=[window.center[0]+x,window.center[1],window.center[2]+z];},[x,z]);await page.waitForTimeout(180);};
const gear=async(g,label)=>{await page.waitForFunction(g=>window.__nfsu2.session.cockpit.scene.telemetry.gear===g,g,{timeout:10000});result.record.push(await save(label));};
const replayWait=()=>page.waitForFunction(()=>{const s=window.__nfsu2.session;return s.renderer.vr.replayEpoch>0&&!s.status.read()?.get('loading')&&s.cockpit.scene?.replay;},null,{timeout:20000});
try{
 const q=new URLSearchParams({reg:'/tests/web/seed/registry_perf4_native.txt',script:'/tests/scripts/replay_pause.txt',save:'vr-replay-live',fresh:''});
 for(const[k,v]of Object.entries({NOMOVIES:1,NFSU2_RES:'1280x800',NFSU2_FPS:60,NFSU2_VR_COCKPIT:1,NFSU2_VR_HAND_CONTROLS:1,NFSU2_ROAM:0}))q.append('env',`${k}=${v}`);
 await page.route('**/tests/scripts/replay_pause.txt',r=>r.fulfill({contentType:'text/plain',body:script}));await page.goto(base+'/?'+q);await page.waitForFunction(()=>window.__nfsu2?.phase==='ready',null,{timeout:120000});await page.click('#play');
 const deadline=Date.now()+180000;while(!logs.some(s=>s.includes('LOG replay_record_ready'))){if(Date.now()>deadline)throw Error('race did not start');await page.waitForTimeout(200);}
 await page.evaluate(async()=>{
  const s=window.__nfsu2.session,c=s.cockpit,vr=s.renderer.vr,ident=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  WebGL2RenderingContext.prototype.makeXRCompatible=()=>Promise.resolve();
  window.XRWebGLLayer=class{constructor(session,gl){this.framebuffer=null;gl.canvas.width=1280;gl.canvas.height=800;Object.assign(gl.canvas.style,{position:'fixed',inset:'0',width:'1280px',height:'800px',zIndex:99999});document.body.append(gl.canvas);}getViewport(v){return {x:v.eye==='left'?0:640,y:0,width:640,height:800};}};
  const sources=['left','right'].map((handedness,h)=>({handedness,gripSpace:{h},targetRaySpace:{h},gamepad:{buttons:Array.from({length:6},()=>({value:0})),axes:[0,0,0,0]}}));window.sources=sources;
  const projection=new Float32Array([1.25,0,0,0,0,1,0,0,0,0,-1.00002,-1,0,0,-.100001,0]);window.head=ident();
  const position=c.shifter.knob(c.scene.local.model);window.center=position.map((v,k)=>v-(k===0?c.shifter.x:k===2?c.shifter.z:0));window.hand=position;window.handTarget=[...position];
  let end;const session={visibilityState:'visible',inputSources:sources,addEventListener(_,fn){end=fn;},requestReferenceSpace:async()=>({}),updateRenderState(state){const n=state.depthNear??.05,f=state.depthFar??5000;projection[10]=-(f+n)/(f-n);projection[14]=-2*f*n/(f-n);},requestAnimationFrame(fn){return requestAnimationFrame(time=>{window.hand=window.hand.map((v,k)=>v+Math.max(-.012,Math.min(.012,window.handTarget[k]-v)));fn(time,frame);});},cancelAnimationFrame:id=>cancelAnimationFrame(id),async end(){end?.();}};
  const frame={session,getViewerPose(){return {transform:{matrix:window.head},views:['left','right'].map((eye,i)=>{const m=new Float32Array(window.head);m[12]+=(i?1:-1)*.032;return {eye,projectionMatrix:projection,transform:{matrix:m}};})};},getPose(space){const m=ident();m.set(space.h?window.hand:[-.3,-.25,-.18],12);return {transform:{matrix:m}};}};
  window.padEvents=[];const spatial=s.input.spatialPad.bind(s.input);s.input.spatialPad=p=>{if(sources[1].gamepad.buttons[5].value>.5)window.padEvents.push({time:performance.now(),buttons:p?.buttons,epoch:vr.replayEpoch,loading:s.status.read()?.get('loading')});spatial(p);};
  window.xrSession=session;await vr.enter(session);
 });
 await page.waitForFunction(()=>{const s=window.__nfsu2.session,m=new Uint32Array(s.proc.memory.buffer),r=m[0x8650b8/4];return r&&m[(r+4)/4]===1&&!s.cockpit.scene.gearbox.countdown;},null,{timeout:30000});
 result.initial=await save('recording');assert.notEqual(result.initial.first,0xffffffff);
 await page.evaluate(()=>window.sources[1].gamepad.buttons[1].value=1);await page.waitForFunction(()=>window.__nfsu2.session.cockpit.shifter.hand===1);
 await move(-.045,0);await gear(1,'neutral');await move(-.045,-.06);await gear(2,'first');
 await page.evaluate(()=>window.sources[1].gamepad.buttons[0].value=.7);await page.waitForTimeout(1800);
 await move(-.045,0);await move(-.045,.06);await gear(3,'second');await page.waitForTimeout(1500);
 await page.evaluate(()=>window.sources[1].gamepad.buttons[0].value=0);await move(-.045,0);await gear(1,'neutral again');
 await page.evaluate(()=>window.sources[0].gamepad.buttons[0].value=1);await page.waitForTimeout(1500);await page.evaluate(()=>window.sources[0].gamepad.buttons[0].value=0);
 const count=(await state()).box.count;await move(count===6?.09:.045,0);await move(count===6?.09:.045,.06);await gear(0,'reverse');
 await page.evaluate(()=>window.sources[1].gamepad.buttons[0].value=.5);await page.waitForTimeout(1400);await page.evaluate(()=>window.sources[1].gamepad.buttons[0].value=0);
 await move(count===6?.09:.045,0);await move(-.045,0);await move(-.045,-.06);await gear(2,'first after reverse');
 await page.evaluate(()=>{window.sources[1].gamepad.buttons[1].value=0;window.handTarget=[.6,-.2,-.1];});await page.waitForTimeout(10000);
 await button(0,5,750);await page.waitForFunction(()=>window.__nfsu2.session.status.read()?.get('pause')===1);await key('ArrowRight');await key('ArrowRight');await key('ArrowRight');await key('Enter');await replayWait();
 await page.waitForTimeout(400);result.open=await save('replay open');const epoch=result.open.epoch;assert.equal(result.open.bad,0);assert.equal(result.open.error,0);await page.screenshot({path:out+'/open.png'});
 const hidden=result.open.hidden;await button(1,5);assert.equal((await state()).hidden,1-hidden);await page.screenshot({path:out+'/timeline-toggle.png'});await button(1,5);assert.equal((await state()).hidden,hidden);
 for(let i=0;i<6;i++){await button(1,3);const s=await save('camera '+i);result.views.push(s);assert.equal(s.gpu,0);assert.equal(s.epoch,epoch);await page.screenshot({path:out+`/camera-${i}.png`});}
 assert.ok(result.views.some(s=>s.cockpit));assert.equal(new Set(result.views.map(s=>`${s.slot}/${s.cockpit}`)).size,6);
 const stable=(await state()).slot;
 await page.evaluate(()=>window.sources[1].gamepad.buttons[3].value=1);await page.waitForTimeout(120);
 await page.evaluate(()=>window.xrSession.visibilityState='hidden');await page.waitForTimeout(200);await page.evaluate(()=>window.xrSession.visibilityState='visible');await page.waitForTimeout(120);
 await page.evaluate(()=>window.sources[1].gamepad.buttons[3].value=0);await page.waitForTimeout(300);assert.equal((await state()).slot,stable);
 const chosen=(await state()).slot;
 for(let i=0;i<10;i++){await key('BracketLeft');await page.waitForTimeout(600);await replayWait();const s=await state();if(s.frame-s.first<150)break;}
 result.rewind=await save('rewind');assert.equal(result.rewind.slot,chosen);assert.equal(result.rewind.bad,0);assert.equal(result.rewind.epoch,epoch);assert.ok(result.rewind.frame-result.rewind.first<150);
 if(result.rewind.paused)await button(1,4);
 result.playback=[];for(let i=0;i<200;i++){const s=await state();result.playback.push({frame:s.frame,gear:s.telemetry.gear,bad:s.bad,epoch:s.epoch});await page.waitForTimeout(100);}
 result.played=await save('played physical shifts');assert.equal(result.played.epoch,epoch);assert.equal(result.played.bad,0);assert.equal(result.played.error,0);
 for(const gear of [0,1,2,3])assert.ok(result.playback.some(s=>s.gear===gear),`recorded gear ${gear} reappears in playback`);
 await key('BracketRight');await page.waitForTimeout(1000);result.forward=await save('forward');assert.equal(result.forward.slot,chosen);assert.equal(result.forward.bad,0);
 await button(1,5,1200);await page.waitForFunction(()=>{const s=window.__nfsu2.session;return !s.renderer.vr.replayEpoch&&s.status.read()?.get('pause')===1&&!new Uint32Array(s.proc.memory.buffer)[0x8363ec/4];},null,{timeout:20000});
 result.closed=await save('back to pause');assert.equal(result.closed.status.pause,1);
 await button(1,5);await page.waitForFunction(()=>{const s=window.__nfsu2.session;return !!s.status.read()?.get('drive')&&s.cockpit.scene?.cockpit;},null,{timeout:20000});result.resumed=await save('driving cockpit restored');assert.equal(result.resumed.gpu,0);
 await page.evaluate(async()=>{await window.__nfsu2.session.renderer.vr.exit();window.__nfsu2.session.input.requestQuit();});await page.waitForFunction(()=>window.__nfsu2.phase==='exited',null,{timeout:30000});
 fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));console.log('PASS replay recording, H gears/reverse, timeline and six cameras through seeks');
}catch(e){fs.writeFileSync(out+'/streamer.json',JSON.stringify(await page.evaluate(()=>{const m=new DataView(window.__nfsu2.session.proc.memory.buffer),u=a=>m.getUint32(a,true),raw=(a,n)=>Array.from({length:n/4},(_,i)=>[ (a+4*i).toString(16),u(a+4*i)]),reads=head=>{const list=[];for(let p=u(head);p&&p!==head&&list.length<512;p=u(p))list.push(raw(p,0xe0));return list;};return {streamer:raw(0x88eb00,0x700),blocks:raw(u(0x88eb00),Math.min(1024,u(0x88eb04))*0x50),busy:u(0x8a329c),waiting:reads(0x865220),started:reads(0x865550),stack:raw(0x5feee00,0x200),readState:raw(0x864f50,0x60)};}),null,2));fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(e),result,state:await state().catch(()=>null),padEvents:await page.evaluate(()=>window.padEvents).catch(()=>null)},null,2));await page.screenshot({path:out+'/failure.png'}).catch(()=>{});throw e;}
finally{fs.writeFileSync(out+'/page.log',logs.join('\n'));await browser.close();}
