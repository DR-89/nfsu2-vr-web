// Runs the PC start sequence with synthetic XR controllers. Requests go through
// Cockpit, the shared mailbox and HumanDriver; the test only selects the game's
// manual/automatic mode, never the requested or engaged gear.
import {chromium} from 'playwright';
import {pickBrowser} from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../..',import.meta.url)),root=path.join(repo,'out/vr-checks/grid-live');
const prefix=fs.readFileSync(path.join(repo,'tests/scripts/carbal_straight.txt'),'utf8').split('+0    wzero')[0].replace('pad connect','pad disconnect');
const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']});
const modes=process.argv.slice(2);if(!modes.length)modes.push('neutral','first','automatic','flat');
try {for(const mode of modes) {
  assert.ok(['neutral','first','automatic','flat'].includes(mode));
  const out=path.join(root,mode);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'progress.log'),'');
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],states=[];
  // The intro temporarily uses an AI controller. Set the player's ordinary
  // transmission preference, which the real HumanDriver reads on handover.
  const script=prefix+`+0 poke [0x8900ac]+0x20 ${mode==='automatic'?0:1} byte\n+0 log GRID_LOADED\n`+(mode==='flat'?'+600 down UP\n':'')+'+6000 quit\n';
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{fs.appendFileSync(path.join(out,'progress.log'),m.text()+'\n');if(/uncaptured|validation error|GPUValidationError/.test(m.text()))errors.push(m.text());});
  const state=()=>page.evaluate(()=>{const session=window.__nfsu2.session,c=session.cockpit,p=window.__gridProbe;
    const mem=new DataView(session.proc.memory.buffer),u=a=>a>0&&a+4<mem.byteLength?mem.getUint32(a,true):0,f=a=>a>0&&a+4<mem.byteLength?mem.getFloat32(a,true):0;
    const car=u(u(0xd00000)+4),driver=u(car+0x30),race=u(0x890118),ptr=session.renderer.vr.ptr;
    return {box:c.scene?.gearbox,telemetry:c.scene?.telemetry,cockpit:c.scene?.cockpit,body:c.scene?.bodyDraws,lever:{hand:c.shifter.hand,gear:c.shifter.gear},request:c.shiftRequest,command:c.gearCommand,seen:p?.seen,
      guest:{car,driver,vt:u(driver),back:u(driver+0x2a8),mode:u(driver+0x2c0),race,stage:u(race),type:u(0x89e7b0),speed:f(car+0x430),request:u(driver+0x1e4),lock:mem.getUint8(driver+0x2b4),source:u(driver+0x2ac),mailbox:ptr?{active:u(ptr+12),command:u(ptr+92)}:null}};});
  const record=async label=>{const s={label,...await state()};states.push(s);console.log(mode,label,JSON.stringify(s));return s;};
  const move=async(x,z)=>{await page.evaluate(([x,z])=>{window.__gridProbe.target=[x,z];},[x,z]);await page.waitForTimeout(160);};
  const first=async()=>{
    await page.evaluate(()=>{window.__gridProbe.grip=1;});
    await page.waitForFunction(()=>window.__nfsu2.session.cockpit.shifter.hand===1);
    await move(0,-.06);assert.equal((await state()).request,null,'third cannot launch');
    await move(0,0);await move(-.045,0);await move(-.045,-.06);
  };
  let monitor;
  try {
    const query=new URLSearchParams({reg:'/tests/web/seed/registry_perf4_native.txt',script:'/tests/scripts/quickrace.txt',save:'vr-grid-'+mode,fresh:''});
    for(const [k,v] of Object.entries({NOMOVIES:1,NFSU2_RES:'1280x800',NFSU2_FPS:60,NFSU2_VR_COCKPIT:1,NFSU2_VR_HAND_CONTROLS:1,NFSU2_ROAM:0,ROAM_PROFILE:'GridTest',NFSU2_ROAM_NAME:'GridTest'}))query.append('env',`${k}=${v}`);
    await page.route('**/tests/scripts/quickrace.txt',r=>r.fulfill({contentType:'text/plain',body:script}));
    await page.goto('http://localhost:8612/?'+query);await page.waitForFunction(()=>window.__nfsu2?.phase==='ready',null,{timeout:120000});await page.click('#play');
    await page.waitForFunction(()=>window.__nfsu2?.session?.renderer?.vr?.onTracking,null,{timeout:60000});
    monitor=setInterval(()=>{void state().then(s=>fs.writeFileSync(path.join(out,'current.json'),JSON.stringify(s,null,2))).catch(()=>{});},1000);
    if(mode!=='flat')await page.evaluate(()=>{
      const session=window.__nfsu2.session,c=session.cockpit,vr=session.renderer.vr;
      const ident=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
      const p=window.__gridProbe={target:[0,0],position:[0,0],center:null,model:null,grip:0,gas:0,seen:{intro:0,countdown:0,body:0,grid:0},timer:0,view:ident()};
      const sources=[0,1].map(h=>({handedness:h?'right':'left',gamepad:{axes:[0,0,0,0],buttons:Array.from({length:6},()=>({value:0}))}}));
      p.timer=setInterval(()=>{
        const model=c.scene?.local?.model;
        if(model&&p.model!==model){p.model=model;p.center=c.shifter.knob(model).map((v,k)=>v-(k===0?c.shifter.x:k===2?c.shifter.z:0));}
        p.position=p.position.map((v,k)=>v+Math.max(-.012,Math.min(.012,p.target[k]-v)));
        sources[1].gamepad.buttons[0].value=p.gas;sources[1].gamepad.buttons[1].value=p.grip;
        const matrix=ident();if(p.center)matrix.set([p.center[0]+p.position[0],p.center[1],p.center[2]+p.position[1]],12);
        vr.onTracking({time:performance.now(),head:ident(),eyes:[],sources,hands:[null,p.center?{source:sources[1],matrix}:null]});vr.sessionId=1;vr.sessionId=1;vr.write(p.view);
        const b=c.scene?.gearbox;if(c.scene?.cockpit&&b&&!b.ready)p.seen.intro++;
        if(b?.countdown)p.seen.countdown++;if(b?.firstOnly)p.seen.grid++;
        if(c.scene?.cockpit&&c.scene.bodyDraws>0)p.seen.body++;
      },16);
    });
    if(mode==='neutral'||mode==='first') {
      await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene?.gearbox?.countdown,null,{timeout:180000});
      await record('countdown');await page.evaluate(()=>window.__gridProbe.gas=1);
      if(mode==='first') {await first();await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene.gearbox.selected===2);await record('first preselected');}
      await page.waitForFunction(()=>{const b=window.__nfsu2.session.cockpit.scene?.gearbox;return b?.ready&&!b.countdown;},null,{timeout:30000});
      if(mode==='neutral') {
        await page.waitForTimeout(1200);const n=await record('neutral after GO');
        assert.equal(n.telemetry.gear,1);assert.equal(n.box.firstOnly,true);assert.ok(Math.abs(n.telemetry.speed)<1,'neutral does not launch with full gas');
        await page.screenshot({path:path.join(out,'neutral.png')});await first();
      }
      await page.waitForFunction(()=>{const s=window.__nfsu2.session.cockpit.scene;return !s.gearbox.firstOnly&&s.telemetry.gear===2&&s.telemetry.speed>1;},null,{timeout:10000});
      const launch=await record('first launches');assert.equal(launch.lever.hand,1);assert.ok(launch.seen.countdown>0&&launch.seen.body>0);
      await move(-.045,0);await move(-.045,.06);
      await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene.telemetry.gear===3);await record('second after launch');
    } else {
      await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene?.gearbox?.ready,null,{timeout:180000});
      if(mode==='automatic')await page.evaluate(()=>window.__gridProbe.gas=1);
      await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene.telemetry.speed>2,null,{timeout:30000});
      const s=await record('retail launch');assert.equal(s.box.firstOnly,false);assert.ok(s.telemetry.gear>=2);assert.equal(s.command,0);
      if(mode==='automatic')assert.equal(s.seen.grid,0);
    }
    await page.screenshot({path:path.join(out,'launched.png')});
    await page.evaluate(()=>{const p=window.__gridProbe,s=window.__nfsu2.session;if(p)clearInterval(p.timer);s.renderer.vr.onTracking(null);s.renderer.vr.write(null);s.input.requestQuit();});
    await page.waitForFunction(()=>window.__nfsu2.phase==='exited',null,{timeout:30000});assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:true,mode,states,errors},null,2));
  } catch(error) {
    fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),states,state:await state().catch(()=>null),errors},null,2));
    await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;
  } finally {clearInterval(monitor);await page.close();}
}} finally {await browser.close();}
console.log('PASS: PC race grid, cockpit body, neutral/first launch and ordinary controls');
