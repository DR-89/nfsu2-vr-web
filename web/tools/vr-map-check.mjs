// Real career GPS, world-map input and GPU display, with synthetic hand poses.
import {chromium} from 'playwright';
import {pickBrowser} from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
const repo=fileURLToPath(new URL('../..',import.meta.url)),out=path.join(repo,'out/vr-checks/map-live');fs.mkdirSync(out,{recursive:true});
const prefix=fs.readFileSync(path.join(repo,'tests/scripts/vr_cockpit.txt'),'utf8').replace('pad connect','pad disconnect').split('+0 trigger RT 1')[0];
const script=prefix+'+0 poke 0x83aa1a 1 byte\n+600 poke 0x83aa1a 0 byte\n+0 log SHOT gps_imperial\n+3600 quit\n';
const helpers=(await esbuild.build({stdin:{contents:`export * from './src/vr/panel-grip';export * from './src/vr/math';export * from './src/vr/drivers';export * from './src/vr/gps';`,resolveDir:path.join(repo,'web'),loader:'ts'},bundle:true,format:'iife',globalName:'MapProbe',write:false})).outputFiles[0].text;
const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']}),page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],logs=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{logs.push(m.text());fs.writeFileSync(path.join(out,'progress.log'),logs.join('\n'));if(/WebGPU error:|uncaptured|validation error|GPUValidationError/.test(m.text()))errors.push(m.text());});
try{
  const query=new URLSearchParams({reg:'/tests/web/seed/registry_perf4_native.txt',script:'/tests/scripts/vr_cockpit.txt',save:'vr-map-live',fresh:''});
  for(const [k,v] of Object.entries({NOMOVIES:1,NFSU2_RES:'1280x800',NFSU2_FPS:60,NFSU2_VR_COCKPIT:1,NFSU2_GPS_DISTANCE:1,NFSU2_ROAM:0,ROAM_PROFILE:'MapTest',NFSU2_ROAM_NAME:'MapTest'}))query.append('env',`${k}=${v}`);
  await page.route('**/tests/scripts/vr_cockpit.txt',r=>r.fulfill({contentType:'text/plain',body:script}));await page.route('**/tests/vr-map-helpers.js',r=>r.fulfill({contentType:'text/javascript',body:helpers}));
  await page.goto('http://localhost:8612/?'+query);await page.addScriptTag({url:'/tests/vr-map-helpers.js'});await page.waitForFunction(()=>window.__nfsu2?.phase==='ready',null,{timeout:120000});await page.click('#play');
  const deadline=Date.now()+180000;while(!logs.some(s=>s.includes('SHOT cockpit_media'))){assert.ok(Date.now()<deadline,'career drive did not start');await page.waitForTimeout(200);}
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene?.gps?.metric,null,{timeout:15000});
  const state=()=>page.evaluate(()=>{const c=window.__nfsu2.session.cockpit;return {gps:c.scene?.gps,text:MapProbe.gpsText(c.scene?.gps),map:MapProbe.placement(c.settings,'map'),screen:MapProbe.placement(c.settings,'screen'),controls:c.controls,gear:c.scene?.telemetry?.gear,fingers:c.fingers,stats:window.__nfsu2.session.renderer.stats(),saved:window.__mapProbe?.saved};});
  const metric=await state();await page.screenshot({path:path.join(out,'metric.png')});assert.ok(metric.gps.metres>0);
  await page.evaluate(()=>{
    const s=window.__nfsu2.session,c=s.cockpit;c.settings.movable=true;
    const source={handedness:'right',gamepad:{buttons:Array.from({length:6},()=>({value:0})),axes:[0,0,0,0]}},p=window.__mapProbe={source,pose:new Float32Array(MapProbe.mapMount(c.scene.local.model,c.settings).matrix),timer:0,saved:[]};
    const save=c.save;c.save=values=>{p.saved.push(values);save(values);};
    p.timer=setInterval(()=>s.renderer.vr.onTracking({time:performance.now(),head:MapProbe.identity(),eyes:[],sources:[null,source],hands:[null,{matrix:p.pose,source}]}),16);
  });
  await page.waitForTimeout(150);await page.evaluate(()=>window.__mapProbe.source.gamepad.buttons[1].value=1);await page.waitForFunction(()=>window.__nfsu2.session.cockpit.mapGrip.hand===1);
  await page.evaluate(()=>{const p=window.__mapProbe,old=p.pose,q=MapProbe.poseMatrix({p:[0,0,0],q:[0,Math.sin(.15),0,Math.cos(.15)]});p.pose=MapProbe.multiply(q,old);p.pose.set([old[12]-.18,old[13]+.13,old[14]+.04],12);});
  await page.waitForTimeout(150);await page.evaluate(()=>window.__mapProbe.source.gamepad.buttons[1].value=0);await page.waitForFunction(()=>window.__mapProbe.saved.length===1);
  const moved=await state();assert.ok(moved.map.offset[0]<-.17&&moved.map.offset[1]>.12);assert.ok(moved.map.yaw>.29);assert.equal(moved.saved[0].vr_map_y,'13');await page.screenshot({path:path.join(out,'moved.png')});
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene?.gps?.metric===false,null,{timeout:20000});const imperial=await state();assert.match(imperial.text,/FT|MI/);await page.screenshot({path:path.join(out,'imperial.png')});
  await page.evaluate(()=>{const p=window.__mapProbe,c=window.__nfsu2.session.cockpit;p.pose=new Float32Array(MapProbe.screenMount(c.scene.local.model,c.settings).matrix);});await page.waitForTimeout(150);
  await page.evaluate(()=>window.__mapProbe.source.gamepad.buttons[1].value=1);await page.waitForFunction(()=>window.__nfsu2.session.cockpit.screenGrip.hand===1);
  await page.evaluate(()=>{const p=window.__mapProbe;p.pose[12]-=.12;p.pose[13]+=.08;p.source.gamepad.axes[3]=-1;});await page.waitForTimeout(300);
  await page.evaluate(()=>{const p=window.__mapProbe;p.source.gamepad.axes[3]=0;p.source.gamepad.buttons[1].value=0;});await page.waitForFunction(()=>window.__mapProbe.saved.length===2);
  const screen=await state();assert.ok(screen.screen.scale>1.15);assert.equal(screen.controls.buttons,0);await page.screenshot({path:path.join(out,'screen.png')});
  await page.evaluate(()=>{const p=window.__mapProbe,c=window.__nfsu2.session.cockpit;p.pose=new Float32Array(MapProbe.mapMount(c.scene.local.model,c.settings).matrix);});await page.waitForTimeout(150);
  await page.evaluate(()=>window.__mapProbe.source.gamepad.buttons[4].value=1);
  await page.waitForFunction(()=>!window.__nfsu2.session.cockpit.scene?.cockpit,null,{timeout:10000});await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'world-map.png')});
  await page.evaluate(()=>window.__mapProbe.source.gamepad.buttons[4].value=0);
  await page.keyboard.press('c',{delay:150});await page.waitForTimeout(300);await page.keyboard.press('ArrowLeft',{delay:150});await page.keyboard.press('Enter',{delay:150});await page.waitForTimeout(300);await page.keyboard.press('Escape',{delay:150});
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene?.cockpit&&!window.__nfsu2.session.cockpit.scene?.gps,null,{timeout:10000});const inactive=await state();await page.screenshot({path:path.join(out,'gps-off.png')});
  assert.equal(inactive.text,'');assert.equal(inactive.stats['gpu errors'],0);
  await page.evaluate(()=>{clearInterval(window.__mapProbe.timer);window.__nfsu2.session.renderer.vr.onTracking(null);window.__nfsu2.session.input.requestQuit();});await page.waitForFunction(()=>window.__nfsu2.phase==='exited',null,{timeout:30000});assert.deepEqual(errors,[]);
  const result={pass:true,metric,moved,imperial,screen,inactive,errors};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),errors},null,2));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
finally{fs.writeFileSync(path.join(out,'page.log'),logs.join('\n'));await browser.close();}
