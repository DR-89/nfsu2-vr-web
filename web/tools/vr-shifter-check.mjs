// Real PC gearbox and render path, with synthetic XR poses. The script selects
// manual transmission in the test driver; all gear requests use the production
// cockpit -> seqlock mailbox -> HumanDriver -> retail gearbox path.
import {chromium} from 'playwright';
import {pickBrowser} from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../..',import.meta.url)),out=path.join(repo,'out/vr-checks/shifter-live');fs.mkdirSync(out,{recursive:true});
const script=fs.readFileSync(path.join(repo,'tests/scripts/vr_cockpit.txt'),'utf8').replace('pad connect','pad disconnect').split('+0 trigger RT 1')[0]+'+0 poke [[[0x8900ac]+0x4]+0x30]+0x2c0 1\n+7200 quit\n';
const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],logs=[],states=[];
fs.writeFileSync(path.join(out,'progress.log'),'');
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{logs.push(m.text());fs.appendFileSync(path.join(out,'progress.log'),m.text()+'\n');if(/uncaptured|validation error|GPUValidationError/.test(m.text()))errors.push(m.text());});
const state=()=>page.evaluate(()=>{const c=window.__nfsu2.session.cockpit,p=window.__shiftProbe;return {box:c.scene.gearbox,telemetry:c.scene.telemetry,request:c.shiftRequest,command:c.gearCommand,lever:{hand:c.shifter.hand,x:c.shifter.x,z:c.shifter.z},led:c.led(),pedals:c.pedalTravel,engine:c.scene.feedback,feedback:c.feedback,sounds:p?.sounds,roadPeak:p?.peakRoad,motors:[0,1].map(h=>p?.pulses.findLast(p=>p.h===h)??null)};});
const gear=async (value,label)=>{await page.waitForFunction(g=>window.__nfsu2.session.cockpit.scene.telemetry.gear===g,value,{timeout:5000});const s=await state();states.push({label,...s});console.log(label,JSON.stringify(s));};
const move=async (x,z)=>{await page.evaluate(([x,z])=>{const p=window.__shiftProbe;p.target=[p.center[0]+x,p.center[1],p.center[2]+z];},[x,z]);await page.waitForTimeout(150);};
const reset=async settings=>{await page.evaluate(settings=>{const p=window.__shiftProbe,c=window.__nfsu2.session.cockpit;p.grip=0;p.gas=p.brake=0;c.track(null);Object.assign(c.settings.shift,settings);p.position=p.target=[...p.center];},settings);await page.waitForTimeout(250);};
try {
  const query=new URLSearchParams({reg:'/tests/web/seed/registry_perf4_native.txt',script:'/tests/scripts/vr_cockpit.txt',save:'vr-shifter-live',fresh:''});
  for(const [k,v] of Object.entries({NOMOVIES:1,NFSU2_RES:'1280x800',NFSU2_FPS:60,NFSU2_VR_COCKPIT:1,NFSU2_VR_HAND_CONTROLS:1,NFSU2_VR_SHIFT_SOUND:1,NFSU2_VR_GRIP_FEEDBACK:1,NFSU2_VR_SHIFT_LIGHTS:1,NFSU2_FF_LOG:1,NFSU2_PAD_LOG:1,NFSU2_ROAM:0,ROAM_PROFILE:'ShiftTest',NFSU2_ROAM_NAME:'ShiftTest'}))query.append('env',`${k}=${v}`);
  await page.route('**/tests/scripts/vr_cockpit.txt',r=>r.fulfill({contentType:'text/plain',body:script}));
  await page.goto((process.env.VR_CHECK_URL??'http://localhost:8612')+'/?'+query);await page.waitForFunction(()=>window.__nfsu2?.phase==='ready',null,{timeout:120000});await page.click('#play');
  await page.waitForFunction(()=>{const s=window.__nfsu2?.session?.cockpit?.scene;return s?.cockpit&&s.gearbox?.manual&&s.gearbox?.ready;},null,{timeout:180000});
  await page.evaluate(()=>{
    const session=window.__nfsu2.session,c=session.cockpit,vr=session.renderer.vr;vr.sessionId=1;
    const ident=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    const position=c.shifter.knob(c.scene.local.model),center=position.map((v,k)=>v-(k===0?c.shifter.x:k===2?c.shifter.z:0));
    const p=window.__shiftProbe={position,target:[...position],center,grip:0,gas:0,brake:0,steer:0,stick:[0,0],shift:[0,0],pulses:[],timer:0,view:ident(),sounds:0,peakRoad:0};
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer?.length===960&&this.buffer.sampleRate===48000)p.sounds++;return start.apply(this,args);};
    const sources=[0,1].map(h=>({handedness:h?'right':'left',gamepad:{axes:[0,0,0,0],buttons:Array.from({length:6},()=>({value:0})),hapticActuators:[{pulse:(amplitude,duration)=>{p.pulses.push({h,amplitude,duration});return Promise.resolve(true);}}]}}));
    p.timer=setInterval(()=>{
      p.position=p.position.map((v,k)=>v+Math.max(-.012,Math.min(.012,p.target[k]-v)));
      sources[0].gamepad.buttons[0].value=p.brake;sources[1].gamepad.buttons[0].value=p.gas;sources[1].gamepad.buttons[1].value=p.grip;
      sources[0].gamepad.buttons[4].value=p.shift[0];sources[0].gamepad.buttons[5].value=p.shift[1];
      sources[0].gamepad.axes[2]=p.steer;p.peakRoad=Math.max(p.peakRoad,c.scene?.feedback?.road??0);
      sources[1].gamepad.axes[2]=p.stick[0];sources[1].gamepad.axes[3]=p.stick[1];
      const matrix=ident();matrix.set(p.position,12);
      vr.onTracking({time:performance.now(),head:ident(),eyes:[],sources,hands:[null,{source:sources[1],matrix}]});
      // ImmersiveSession.write is the same production seqlock used each XR frame.
      vr.write(p.view);
    },16);
  });
  await page.waitForTimeout(300);await page.evaluate(()=>window.__shiftProbe.grip=1);
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.shifter.hand===1);
  await move(-.045,0);await gear(1,'H neutral');
  await move(0,0);await move(0,-.06);await gear(4,'H third');
  await move(0,0);await gear(1,'H neutral crossing');
  await move(-.045,0);await move(-.045,-.06);await gear(2,'H first');
  assert.deepEqual((await state()).led.slice(0,3),[40/255,123/255,1]);
  await page.evaluate(()=>{const p=window.__shiftProbe,a=Math.PI/3;p.view[5]=p.view[10]=Math.cos(a);p.view[6]=Math.sin(a);p.view[9]=-Math.sin(a);});
  await page.screenshot({path:path.join(out,'h-guide.png')});
  await move(-.045,0);await gear(1,'H neutral before reverse');
  const count=(await state()).box.count;await move(count===6?.09:.045,0);await move(count===6?.09:.045,.06);await gear(0,'H reverse');
  await page.evaluate(()=>{window.__shiftProbe.gas=.6;});await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene.telemetry.throttle>.4);
  await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene.telemetry.speed<-.5,null,{timeout:10000});states.push({label:'reverse acceleration',...await state()});
  await page.evaluate(()=>{window.__shiftProbe.gas=0;window.__shiftProbe.brake=1;});await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene.telemetry.brake>.8);
  await page.waitForTimeout(800);states.push({label:'reverse braking',...await state()});
  await page.evaluate(()=>window.__shiftProbe.brake=0);await move(count===6?.09:.045,0);await gear(1,'neutral after reverse');
  await move(-.045,0);await move(-.045,-.06);await gear(2,'first after reverse');
  await reset({mode:1,gestures:0,reverse:false});await page.evaluate(()=>window.__shiftProbe.grip=1);await page.waitForTimeout(250);
  await move(0,.06);await gear(3,'I pull up');await page.waitForTimeout(300);assert.equal((await state()).telemetry.gear,3);
  await move(0,0);await move(0,-.06);await gear(2,'I push down');
  await reset({mode:1,gestures:0,reverse:true});await page.evaluate(()=>window.__shiftProbe.grip=1);await page.waitForTimeout(250);
  await move(0,-.06);await gear(3,'I reversed push up');
  await page.screenshot({path:path.join(out,'i-guide.png')});
  await reset({mode:0,gestures:1,gestureReverse:false});await move(0,.06);await gear(4,'no-grip pull up');
  assert.equal((await state()).lever.hand,-1);await move(0,0);await move(0,-.06);await gear(3,'no-grip push down');
  await reset({mode:0,gestures:2,gestureReverse:true});await move(0,.06);assert.equal((await state()).telemetry.gear,3);
  await move(0,0);await move(0,.06);await gear(2,'double flick down');
  const pulses=await page.evaluate(()=>window.__shiftProbe.pulses);assert.ok(pulses.some(p=>p.h===1&&p.amplitude>=.95&&p.duration===28),'confirmed engagement click on shifting hand');assert.ok(pulses.some(p=>p.duration===100&&p.amplitude>0),'engine feedback in active zone');
  await page.waitForTimeout(600);
  await page.evaluate(()=>window.__shiftProbe.shift=[1,0]);await gear(3,'X upshift');
  await page.waitForTimeout(500);assert.equal((await state()).telemetry.gear,3,'held shift button does not repeat');assert.equal((await state()).request,null);
  await page.evaluate(()=>window.__shiftProbe.shift=[0,0]);await page.waitForTimeout(150);
  await page.evaluate(()=>window.__shiftProbe.shift=[0,1]);await page.waitForTimeout(120);
  await page.evaluate(()=>window.__shiftProbe.shift=[0,0]);await gear(2,'Y tap downshift');
  await page.evaluate(()=>window.__shiftProbe.shift=[0,0]);await page.waitForTimeout(150);
  assert.ok((await state()).sounds>=8,'confirmed shifts play the native sound buffer through the game audio output');
  await reset({mode:1,gestures:0,reverse:false});await page.evaluate(()=>{window.__shiftProbe.grip=1;window.__nfsu2.session.cockpit.settings.shiftClick=false;});await page.waitForTimeout(250);
  const before=await state();const clicksBefore=await page.evaluate(()=>window.__shiftProbe.pulses.filter(p=>p.amplitude>=.95&&p.duration===28).length);
  await move(0,.06);await gear(3,'sound without vibration click');assert.equal((await state()).sounds,before.sounds+1);
  assert.equal(await page.evaluate(()=>window.__shiftProbe.pulses.filter(p=>p.amplitude>=.95&&p.duration===28).length),clicksBefore);
  await page.evaluate(()=>{const s=window.__nfsu2.session.cockpit.settings;s.shiftClick=true;s.shiftSound=false;});
  await move(0,0);await move(0,-.06);await gear(2,'vibration click without sound');assert.equal((await state()).sounds,before.sounds+1);
  await move(0,0);await move(0,-.06);await gear(1,'neutral for engine gradient');
  await page.evaluate(()=>{const p=window.__shiftProbe;p.grip=0;p.target=[...p.center];p.gas=0;});await page.waitForTimeout(1200);
  const idle=await state();states.push({label:'idle vibration',...idle});assert.ok(idle.engine.idle>0&&idle.engine.limit>idle.engine.idle);assert.ok(idle.feedback.engine>0&&idle.feedback.engine<.05);
  await page.evaluate(()=>window.__shiftProbe.gas=1);await page.waitForFunction(()=>window.__nfsu2.session.cockpit.feedback.engine>.2);await page.waitForTimeout(120);
  const rev=await state();states.push({label:'rev vibration in no-grip zone',...rev});assert.ok(rev.motors[1].amplitude>idle.feedback.engine+.1);
  await move(.5,.3);await page.waitForFunction(()=>!window.__nfsu2.session.cockpit.zone);await page.waitForTimeout(150);
  const outOfZone=await state();states.push({label:'engine stops outside controls',...outOfZone});assert.ok(Math.abs(outOfZone.motors[1].amplitude-outOfZone.feedback.road)<.03);
  await page.evaluate(()=>window.__nfsu2.session.cockpit.settings.gripFeedback=false);await page.waitForTimeout(150);
  const everywhere=await state();states.push({label:'engine on both controllers',...everywhere});assert.ok(everywhere.motors.every(p=>p.amplitude>.2));
  await page.evaluate(()=>{const c=window.__nfsu2.session.cockpit;c.settings.engineRumble=false;});await page.waitForTimeout(150);
  const disabled=await state();states.push({label:'engine vibration off',...disabled});assert.equal(disabled.feedback.engine,0);assert.ok(disabled.motors.every(p=>Math.abs(p.amplitude-disabled.feedback.road)<.03));
  await reset({mode:1,gestures:0,reverse:false});await page.evaluate(()=>window.__shiftProbe.grip=1);await page.waitForTimeout(250);await move(0,.06);await gear(2,'first for collision feedback');
  const impactStart=await page.evaluate(()=>{const p=window.__shiftProbe;p.grip=0;p.gas=1;p.peakRoad=0;return p.pulses.length;});
  try {await page.waitForFunction(()=>window.__shiftProbe.peakRoad>.3,null,{timeout:12000});}
  catch {await page.evaluate(()=>window.__shiftProbe.steer=1);await page.waitForFunction(()=>window.__shiftProbe.peakRoad>.3,null,{timeout:15000});}
  const impact=await state();states.push({label:'real road/collision feedback',...impact});assert.ok(impact.roadPeak>.3);
  const impactPulses=await page.evaluate(at=>window.__shiftProbe.pulses.slice(at),impactStart);
  for(let h=0;h<2;h++)assert.ok(impactPulses.some(p=>p.h===h&&p.amplitude>.3&&p.duration===100),'road/collision reaches each controller');
  await page.evaluate(()=>window.__nfsu2.session.cockpit.settings.haptics=false);await page.waitForTimeout(150);
  const off=await state();assert.ok(off.motors.every(p=>p.amplitude===0));states.push({label:'vibration master off',...off});
  await page.evaluate(()=>{const p=window.__shiftProbe;clearInterval(p.timer);const vr=window.__nfsu2.session.renderer.vr;vr.onTracking(null);vr.write(null);});assert.equal((await state()).command,0);
  await page.evaluate(()=>window.__nfsu2.session.input.requestQuit());await page.waitForFunction(()=>window.__nfsu2.phase==='exited',null,{timeout:30000});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:true,states,pulses,impactPulses,errors},null,2));console.log('PASS: H/I/gestures, reverse, face-button shifts, native shift sound, engine gradient/contact modes, collision feedback and master stop');
} catch(error) {
  fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),states,state:await state().catch(()=>null),errors},null,2));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;
} finally {fs.writeFileSync(path.join(out,'page.log'),logs.join('\n'));await browser.close();}
