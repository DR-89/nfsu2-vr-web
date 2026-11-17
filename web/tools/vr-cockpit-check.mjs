import {execFileSync} from 'node:child_process';
// Real game + local video + pointer controls. XR hardware is tested separately.
import {chromium} from 'playwright';
import {pickBrowser} from './browser.mjs';
import * as esbuild from 'esbuild';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../..',import.meta.url)), out=path.join(repo,'out/vr-checks/cockpit-live');fs.mkdirSync(out,{recursive:true});
const source=(await esbuild.build({stdin:{contents:"export * from './src/vr/math';export * from './src/vr/drivers';export * from './src/vr/cockpit';",loader:'ts',resolveDir:path.join(repo,'web')},bundle:true,format:'iife',globalName:'CockpitMath',write:false})).outputFiles[0].text;
const fixture=path.join(out,'test-pattern.webm');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-t','2','-an','-c:v','libvpx','-b:v','400k',fixture]);
const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu','--force-high-performance-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],logs=[];
fs.writeFileSync(path.join(out,'progress.log'),'');
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{logs.push(m.text());fs.appendFileSync(path.join(out,'progress.log'),m.text()+'\n');if(/uncaptured|validation error|GPUValidationError/.test(m.text()))errors.push(m.text());});
try {
  const query=new URLSearchParams({reg:'/tests/web/seed/registry_perf4_native.txt',script:'/tests/scripts/vr_cockpit.txt',save:'vr-cockpit-live',fresh:''});
  for(const [k,v] of Object.entries({NOMOVIES:1,NFSU2_RES:'1280x800',NFSU2_FPS:60,NFSU2_VR_COCKPIT:1,FORCERAIN:4,NFSU2_ROAM:0,ROAM_PROFILE:'CabinTest',NFSU2_ROAM_NAME:'CabinTest',NFSU2_TEST_VR_BODY_TRACE:process.env.NFSU2_TEST_VR_BODY_TRACE??'0'}))query.append('env',`${k}=${v}`);
  await page.route('**/tests/vr-math.js',r=>r.fulfill({contentType:'application/javascript',body:source}));
  await page.goto('http://localhost:8612/?'+query);await page.addScriptTag({url:'/tests/vr-math.js'});
  await page.waitForFunction(()=>window.__nfsu2?.phase==='ready',null,{timeout:120000});
  await page.evaluate(bytes=>{
    const file=new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'Cockpit test.webm',{type:'video/webm'});
    window.showDirectoryPicker=async()=>({name:'Cockpit test',kind:'directory',queryPermission:async()=> 'granted',async *values(){yield {kind:'file',name:file.name,getFile:async()=>file};}});
  },fs.readFileSync(fixture).toString('base64'));
  await page.locator('[role=tab][data-tab=vr]').click();await page.getByRole('button',{name:'Choose media folder',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#media-library select').options.length===1);
  // Enter the game with a folder selected, without first playing a preview.
  // Browser autoplay exceptions would hide a broken VR playback startup.
  await page.evaluate(()=>document.querySelector('#media-library video').loop=true);
  await page.click('#play');await page.waitForFunction(()=>!!window.__nfsu2?.session?.cockpit?.scene?.cockpit,null,{timeout:180000});
  await new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(logs.some(s=>s.includes('SHOT cockpit_media'))){clearInterval(timer);resolve();}},100);setTimeout(()=>{clearInterval(timer);reject(new Error('cockpit script did not reach drive'));},90000).unref();});await page.screenshot({path:path.join(out,'video.png')});
  const screen=()=>page.evaluate(()=>{
    const c=window.__nfsu2.session.cockpit,p=c.context.getImageData(0,0,1024,450).data;
    let hash=0;for(let i=0;i<p.length;i+=64)hash=(Math.imul(hash,31)+p[i])|0;
    const video=document.querySelector('#media-library video');
    return {hash,time:video.currentTime,frames:video.getVideoPlaybackQuality().totalVideoFrames,paused:video.paused};
  });
  const videoBefore=await screen();await page.waitForTimeout(350);const videoAfter=await screen();
  assert.equal(videoAfter.paused,false);assert.ok(videoAfter.frames>videoBefore.frames,'video decoder advances while the start page is hidden');
  assert.notEqual(videoAfter.hash,videoBefore.hash,'moving video pixels reach the cockpit canvas');
  const click=async index=>{
    const position=await page.evaluate(index=>{
      const c=window.__nfsu2.session.cockpit,s=c.scene,V=CockpitMath,m=V.screenMount(s.local.model,c.settings),p=[((index+.5)/5-.5)*m.width,(.5-.95)*m.height,0,1];
      const matrix=V.multiply(s.projection,V.multiply(s.view,V.multiply(V.cabinMatrix(s.local),m.matrix)));
      const clip=[0,1,2,3].map(r=>p.reduce((sum,v,i)=>sum+matrix[4*i+r]*v,0)),rect=document.querySelector('canvas').getBoundingClientRect();
      return {x:rect.left+(clip[0]/clip[3]+1)*rect.width/2,y:rect.top+(1-clip[1]/clip[3])*rect.height/2};
    },index);
    assert.ok(position.x>=0&&position.x<=1280&&position.y>=0&&position.y<=800,JSON.stringify(position));await page.mouse.click(position.x,position.y);
  };
  assert.equal(await page.evaluate(()=>!!window.__nfsu2.session.cockpit.surface),true,'cockpit screen was painted');await click(4);await page.waitForFunction(()=>window.__nfsu2.session.cockpit.settings.page===1,null,{timeout:5000});
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene.bodyDraws>0,null,{timeout:5000});
  await page.waitForFunction(()=>window.__nfsu2.session?.cockpit?.scene?.telemetry.speed>1,null,{timeout:15000});
  await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'telemetry.png')});
  const before=await page.evaluate(()=>window.__nfsu2.session.cockpit.settings.ledColor);await click(3);
  await page.waitForFunction(before=>window.__nfsu2.session.cockpit.settings.ledColor!==before,before,{timeout:5000});
  await click(4);await page.waitForFunction(()=>window.__nfsu2.session.cockpit.settings.page===0,null,{timeout:5000});
  assert.equal(await page.evaluate(()=>document.querySelector('#media-library video').paused),false);
  await click(1);await page.waitForFunction(()=>document.querySelector('#media-library video').paused);
  await click(1);await page.waitForFunction(()=>!document.querySelector('#media-library video').paused);
  const telemetry=await page.evaluate(()=>window.__nfsu2.session.cockpit.scene.telemetry);assert.ok(telemetry.rpm>500);
  await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'video-after-switch.png')});
  await page.evaluate(()=>Object.assign(window.__nfsu2.session.cockpit.settings,{opacity:.35,screenX:-.2,screenY:.5,screenScale:1.5}));
  await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'moved-translucent-screen.png')});
  await page.waitForFunction(()=>window.__nfsu2.session?.cockpit?.scene?.telemetry.brake>.5,null,{timeout:15000});
  // Exercise the actual guest camera and car pass at several head directions.
  // This writes the tracking mailbox; it does not emulate a physical headset.
  await page.evaluate(async()=>{
    const proc=window.__nfsu2.session.proc,{ptr}=await proc.registered(8);
    const probe=window.__bodyProbe={yaw:0,pitch:0,timer:0,ptr};
    probe.timer=setInterval(()=>{
      const b=proc.memory.buffer,u=new Uint32Array(b,ptr,24),cy=Math.cos(probe.yaw),sy=Math.sin(probe.yaw),cx=Math.cos(probe.pitch),sx=Math.sin(probe.pitch);
      const head=new Float32Array([cy,0,-sy,0,sy*sx,cx,cy*sx,0,sy*cx,-sx,cy*cx,0,0,0,0,1]);
      Atomics.add(u,2,1);u[3]=1;new Float64Array(b,ptr+16,1)[0]=performance.timeOrigin+performance.now();
      new Float32Array(b,ptr+24,16).set(CockpitMath.inverse(head));new Float32Array(b,ptr+88,1)[0]=1.6;Atomics.add(u,2,1);
    },16);
  });
  for(const [name,yaw,pitch] of [['left',1.4,0],['right',-1.4,0],['rear',Math.PI,0],['roof',0,.7]]) {
    await page.evaluate(({yaw,pitch})=>Object.assign(window.__bodyProbe,{yaw,pitch}),{yaw,pitch});
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate(()=>window.__nfsu2.session.cockpit.scene.bodyDraws)>0,`own body rendered: ${name}`);
    await page.screenshot({path:path.join(out,`body-${name}.png`)});
  }
  await page.evaluate(()=>{
    const p=window.__bodyProbe;clearInterval(p.timer);const u=new Uint32Array(window.__nfsu2.session.proc.memory.buffer,p.ptr,24);
    Atomics.add(u,2,1);u[3]=0;Atomics.add(u,2,1);
  });
  await page.evaluate(()=>window.__nfsu2.session.input.requestQuit());
  await page.waitForFunction(()=>window.__nfsu2.phase==='exited',null,{timeout:30000});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,videoBefore,videoAfter,telemetry,errors,checks:'normal autoplay policy, advancing local video pixels, cockpit PAGE/LED/play/pause clicks, forced rain, actual telemetry, moved translucent screen, own body in four head directions'},null,2));
} finally {fs.writeFileSync(path.join(out,'page.log'),logs.join('\n'));await browser.close();}
