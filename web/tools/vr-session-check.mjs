// Real PC game, simulated XR session lifecycle and controller input.
// Hardware optics and motor strength require a separate headset check.
import {chromium} from 'playwright';
import {pickBrowser} from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../..',import.meta.url)),out=path.join(root,'out/vr-checks/session-live');fs.mkdirSync(out,{recursive:true});
const script=fs.readFileSync(path.join(root,'tests/scripts/vr_cockpit.txt'),'utf8').replace('pad connect','pad disconnect').split('+0 trigger RT 1')[0]+'+36000 quit\n';
const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),logs=[],errors=[],states=[];
fs.writeFileSync(path.join(out,'progress.log'),'');
page.on('console',m=>{logs.push(m.text());fs.appendFileSync(path.join(out,'progress.log'),m.text()+'\n');if(/uncaptured|validation error|GPUValidationError/.test(m.text()))errors.push(m.text());});
page.on('pageerror',e=>errors.push(String(e)));
const state=()=>page.evaluate(()=>{const s=window.__nfsu2.session,c=s.cockpit;return {active:s.renderer.vr.active,cockpit:c.scene?.cockpit,local:!!c.scene?.local,gear:c.scene?.telemetry?.gear,controls:c.controls,gpu:s.renderer.stats()['gpu errors']};});
const enter=()=>page.evaluate(()=>window.__nfsu2.session.renderer.vr.enter(window.newTestSession()));
const button=async(b)=>{await page.evaluate(b=>window.testSources[1].gamepad.buttons[b].value=1,b);await page.waitForTimeout(120);await page.evaluate(b=>window.testSources[1].gamepad.buttons[b].value=0,b);};
try{
  const query=new URLSearchParams({reg:'/tests/web/seed/registry_perf4_native.txt',script:'/tests/scripts/vr_cockpit.txt',save:'vr-session-live',fresh:''});
  for(const [k,v] of Object.entries({NOMOVIES:1,NFSU2_RES:'1280x800',NFSU2_FPS:60,NFSU2_PAD_LOG:1,NFSU2_VR_COCKPIT:0,NFSU2_VR_HAND_CONTROLS:1,NFSU2_ROAM:0,ROAM_PROFILE:'SessionTest',NFSU2_ROAM_NAME:'SessionTest'}))query.append('env',`${k}=${v}`);
  await page.route('**/tests/scripts/vr_cockpit.txt',r=>r.fulfill({contentType:'text/plain',body:script}));
  await page.goto((process.env.VR_CHECK_URL??'http://localhost:8612')+'/?'+query);
  await page.waitForFunction(()=>window.__nfsu2?.phase==='ready',null,{timeout:120000});await page.click('#play');
  const deadline=Date.now()+180000;
  while(!logs.some(s=>s.includes('SHOT cockpit_media'))){assert.ok(Date.now()<deadline,'career drive did not start');await page.waitForTimeout(200);}
  await page.evaluate(()=>{
    const ident=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    WebGL2RenderingContext.prototype.makeXRCompatible=()=>Promise.resolve();
    window.XRWebGLLayer=class{
      constructor(session,gl){this.framebuffer=null;gl.canvas.width=1280;gl.canvas.height=800;}
      getViewport(view){return {x:view.eye==='left'?0:640,y:0,width:640,height:800};}
    };
    window.testSources=['left','right'].map(handedness=>({handedness,gamepad:{axes:[0,0,0,0],buttons:Array.from({length:6},()=>({value:0}))}}));
    window.testTracking=true;
    window.newTestSession=()=>{
      const events=new Map(),projection=new Float32Array([1.25,0,0,0,0,1,0,0,0,0,-1.00002,-1,0,0,-.100001,0]);
      const session={visibilityState:'visible',inputSources:window.testSources,
        addEventListener(type,fn){const list=events.get(type)??[];list.push(fn);events.set(type,list);},
        requestReferenceSpace:async()=>({}),updateRenderState(state){const n=state.depthNear??.05,f=state.depthFar??5000;projection[10]=-(f+n)/(f-n);projection[14]=-2*f*n/(f-n);},
        requestAnimationFrame(fn){return requestAnimationFrame(time=>fn(time,frame));},cancelAnimationFrame:id=>cancelAnimationFrame(id),
        async end(){for(const fn of events.get('end')??[])fn();}};
      const frame={session,getViewerPose(){return !window.testTracking?null:{transform:{matrix:ident()},views:['left','right'].map((eye,i)=>{const m=ident();m[12]=(i?1:-1)*.032;return {eye,projectionMatrix:projection,transform:{matrix:m}};})};},getPose:()=>null};
      return session;
    };
  });
  for(let cycle=0;cycle<2;cycle++){
    await enter();await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene?.cockpit);
    states.push({label:`entry ${cycle+1}`,...await state()});
    // Allow the game's controller enumeration to attach the new XR device.
    await page.waitForTimeout(1500);
    await button(3);await page.waitForFunction(()=>!window.__nfsu2.session.cockpit.scene?.cockpit,null,{timeout:5000});
    states.push({label:'exterior',...await state()});
    await page.evaluate(()=>window.testTracking=false);await page.waitForTimeout(350);
    await page.evaluate(()=>window.testTracking=true);await page.waitForTimeout(350);
    assert.equal((await state()).cockpit,false,'tracking loss must preserve an exterior view');
    await page.evaluate(()=>window.__nfsu2.session.renderer.vr.recenter());await page.waitForTimeout(250);
    assert.equal((await state()).cockpit,false,'recenter must preserve an exterior view');
    await page.evaluate(()=>window.__nfsu2.session.renderer.vr.exit());
    assert.equal((await state()).active,false);await page.waitForTimeout(250);
  }
  await enter();await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene?.cockpit);
  // The in-world career-status prompt must become navigable with menu input.
  await page.waitForTimeout(250);const before=await state();
  await page.evaluate(()=>window.testSources[1].gamepad.axes[3]=.4);
  await page.waitForFunction(()=>window.__nfsu2.session.status.read()?.get('drive')===0,null,{timeout:5000});
  await page.evaluate(()=>window.testSources[1].gamepad.axes[3]=0);await page.waitForTimeout(200);
  states.push({label:'career status',...await state()});assert.equal((await state()).gear,before.gear);
  await button(5);await page.waitForFunction(()=>!!(window.__nfsu2.session.status.read()?.get('drive')&3),null,{timeout:5000});
  await page.evaluate(()=>window.__nfsu2.session.renderer.vr.exit());
  await page.evaluate(()=>window.__nfsu2.session.input.requestQuit());await page.waitForFunction(()=>window.__nfsu2.phase==='exited',null,{timeout:30000});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:true,states,errors},null,2));
  console.log('PASS: repeated VR entry selects cockpit, pose gaps preserve exterior views, right stick opens career status and B closes it');
}finally{fs.writeFileSync(path.join(out,'page.log'),logs.join('\n'));await browser.close();}
