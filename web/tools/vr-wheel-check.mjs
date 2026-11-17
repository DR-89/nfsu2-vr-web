// Synthetic XR tracking through the real session/input path into the running
// PC game. This checks the port, not controller hardware or headset comfort.
import {chromium} from 'playwright';
import {pickBrowser} from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
const repo=fileURLToPath(new URL('../..',import.meta.url)),out=path.join(repo,'out/vr-checks/wheel-contact/game');fs.mkdirSync(out,{recursive:true});
const script=fs.readFileSync(path.join(repo,'tests/scripts/vr_cockpit.txt'),'utf8').replace('pad connect','pad disconnect').split('+0 trigger RT 1')[0]+'+36000 quit\n';
const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']});
const helpers=(await esbuild.build({stdin:{contents:`export {screenMount} from './src/vr/cockpit';export {gloveAxes} from './src/vr/fit';export {gloveTip} from './src/vr/glove-tip';export {multiply,inverse} from './src/vr/math';`,resolveDir:path.join(repo,'web'),loader:'ts'},bundle:true,format:'iife',globalName:'HandProbe',write:false})).outputFiles[0].text;
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],logs=[];
fs.writeFileSync(path.join(out,'progress.log'),'');
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{logs.push(m.text());fs.appendFileSync(path.join(out,'progress.log'),m.text()+'\n');if(/uncaptured|validation error|GPUValidationError/.test(m.text()))errors.push(m.text());});
try {
  const query=new URLSearchParams({reg:'/tests/web/seed/registry_perf4_native.txt',script:'/tests/scripts/vr_cockpit.txt',save:'vr-wheel-live',fresh:''});
  for(const [k,v] of Object.entries({NOMOVIES:1,NFSU2_RES:'1280x800',NFSU2_FPS:60,NFSU2_VR_COCKPIT:1,NFSU2_VR_HAND_CONTROLS:1,NFSU2_ROAM:0,ROAM_PROFILE:'WheelTest',NFSU2_ROAM_NAME:'WheelTest'}))query.append('env',`${k}=${v}`);
  await page.route('**/tests/scripts/vr_cockpit.txt',r=>r.fulfill({contentType:'text/plain',body:script}));
  await page.route('**/tests/vr-hand-helpers.js',r=>r.fulfill({contentType:'text/javascript',body:helpers}));
  await page.goto((process.env.VR_CHECK_URL??'http://localhost:8612')+'/?'+query);await page.waitForFunction(()=>window.__nfsu2?.phase==='ready',null,{timeout:120000});
  await page.click('#play');
  const deadline=Date.now()+180000;
  while(!logs.some(s=>s.includes('SHOT cockpit_media'))) {assert.ok(Date.now()<deadline,'career drive did not start');await page.waitForTimeout(200);}
  await page.waitForFunction(()=>window.__nfsu2?.session?.cockpit?.scene?.cockpit);
  await page.addScriptTag({url:'/tests/vr-hand-helpers.js'});
  await page.evaluate(()=>{
    const session=window.__nfsu2.session,c=session.cockpit,w=c.wheel;
    const ident=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    const p=window.__wheelProbe={angle:0,target:0,grip:[0,0],gas:0,brake:0,contact:null,away:false,pulses:[],timer:0};
    const sources=[0,1].map(h=>({handedness:h?'right':'left',gamepad:{axes:[0,0,0,0],buttons:Array.from({length:6},()=>({value:0})),hapticActuators:[{pulse:(amplitude,duration)=>{p.pulses.push({h,amplitude,duration});return Promise.resolve(true);}}]}}));
    p.timer=setInterval(()=>{
      p.angle+=Math.max(-.035,Math.min(.035,p.target-p.angle));
      sources[0].gamepad.buttons[0].value=p.brake;sources[1].gamepad.buttons[0].value=p.gas;
      const hands=sources.map((source,h)=>{source.gamepad.buttons[1].value=p.grip[h];const a=(h?0:Math.PI)-p.angle,matrix=ident();matrix.set(w.pivot.map((v,k)=>v+w.radius*(Math.cos(a)*w.right[k]+Math.sin(a)*w.up[k])),12);if(p.away)for(let k=0;k<3;k++)matrix[12+k]+=w.axis[k]*.3;return {source,matrix};});
      if(p.contact!==null){
        const mount=HandProbe.screenMount(c.scene.local.model,c.settings),m=HandProbe.multiply(mount.matrix,HandProbe.inverse(HandProbe.gloveAxes(1))),a=HandProbe.multiply(m,HandProbe.gloveAxes(1));
        for(let k=0;k<3;k++)m[12+k]=mount.matrix[12+k]+mount.matrix[k]*.4*mount.width-mount.matrix[4+k]*.45*mount.height+mount.matrix[8+k]*p.contact-HandProbe.gloveTip.reduce((v,x,j)=>v+a[j*4+k]*x,0);
        hands[1].matrix=m;
      }
      session.renderer.vr.onTracking({time:performance.now(),head:ident(),eyes:[],sources,hands});
    },16);
  });
  const state=()=>page.evaluate(()=>{const c=window.__nfsu2.session.cockpit;return {controls:c.controls,angle:c.wheel.angle,grabbed:c.wheel.grabbed,steer:c.scene.local.steer,telemetry:c.scene.telemetry,fingers:c.fingers,page:c.settings.page,hands:[c.handPose(0),c.handPose(1)]};});
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.__nfsu2.session.cockpit.settings.wheelGrip),false,'proximity steering is the default');
  assert.deepEqual(await page.evaluate(()=>window.__wheelProbe.grip),[0,0]);
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.wheel.grabbed.every(Boolean));
  assert.deepEqual((await state()).fingers,[1,0,1,0]);
  await page.evaluate(()=>window.__wheelProbe.target=.7);await page.waitForTimeout(700);
  const right=await state();fs.writeFileSync(path.join(out,'right-state.json'),JSON.stringify(right,null,2));assert.ok(right.angle>.65&&right.controls.steer>.2,JSON.stringify(right));assert.ok(right.steer<-.02,'clockwise grip steers the guest right');
  await page.screenshot({path:path.join(out,'right.png')});
  await page.evaluate(()=>window.__wheelProbe.target=-.7);await page.waitForTimeout(1100);
  const left=await state();assert.ok(left.angle<-.65&&left.controls.steer<-.2,JSON.stringify(left));assert.ok(left.steer*right.steer<0,'guest steered both directions');
  await page.screenshot({path:path.join(out,'left.png')});
  await page.evaluate(()=>{window.__wheelProbe.target=0;window.__wheelProbe.gas=.75;});
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene.telemetry.throttle>.5,null,{timeout:10000});
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene.telemetry.speed>2,null,{timeout:15000});
  const driving=await state();assert.ok(driving.telemetry.rpm>600);await page.screenshot({path:path.join(out,'driving.png')});
  await page.evaluate(()=>{window.__wheelProbe.gas=0;window.__wheelProbe.brake=1;});
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene.telemetry.brake>.5,null,{timeout:5000});
  const braking=await state();
  await page.evaluate(()=>{const p=window.__wheelProbe;p.brake=0;p.grip=[0,0];p.away=true;});
  await page.waitForFunction(()=>!window.__nfsu2.session.cockpit.wheel.grabbed.some(Boolean));
  assert.deepEqual((await state()).fingers,[0,0,0,0]);
  await page.evaluate(()=>{window.__nfsu2.session.cockpit.settings.wheelGrip=true;window.__wheelProbe.away=false;});
  await page.waitForTimeout(150);assert.ok(!(await state()).grabbed.some(Boolean),'button mode does not grab on proximity');
  await page.evaluate(()=>window.__wheelProbe.grip=[1,1]);
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.wheel.grabbed.every(Boolean));
  await page.evaluate(()=>window.__wheelProbe.grip=[0,0]);
  await page.waitForFunction(()=>!window.__nfsu2.session.cockpit.wheel.grabbed.some(Boolean));
  await page.evaluate(()=>window.__nfsu2.session.cockpit.settings.wheelGrip=false);
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.wheel.grabbed.every(Boolean));
  await page.evaluate(()=>window.__wheelProbe.away=true);
  await page.waitForFunction(()=>!window.__nfsu2.session.cockpit.wheel.grabbed.some(Boolean));
  const pageBefore=(await state()).page;
  await page.evaluate(()=>window.__wheelProbe.contact=.04);await page.waitForFunction(()=>window.__nfsu2.session.cockpit.fingers[3]===1);
  await page.screenshot({path:path.join(out,'point.png')});
  await page.evaluate(()=>window.__wheelProbe.contact=.003);await page.waitForFunction(before=>window.__nfsu2.session.cockpit.settings.page!==before,pageBefore);
  await page.waitForTimeout(250);assert.equal((await state()).page,1-pageBefore,'held index does not repeat');
  const pointing=await state();assert.deepEqual(pointing.fingers,[0,0,1,1]);
  const pulses=await page.evaluate(()=>window.__wheelProbe.pulses);
  assert.ok(pulses.some(p=>p.duration===22)&&pulses.some(p=>p.duration===100&&p.amplitude>0),'wheel contact and engine feedback requested');
  await page.evaluate(()=>{clearInterval(window.__wheelProbe.timer);window.__nfsu2.session.renderer.vr.onTracking(null);});
  assert.equal((await state()).controls,null);
  await page.evaluate(()=>window.__nfsu2.session.input.requestQuit());await page.waitForFunction(()=>window.__nfsu2.phase==='exited',null,{timeout:30000});
  assert.deepEqual(errors,[]);
  const result={pass:true,right,left,driving,braking,pointing,pulses:pulses.length,errors};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {fs.writeFileSync(path.join(out,'page.log'),logs.join('\n'));await browser.close();}
