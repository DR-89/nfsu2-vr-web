// Two real PC games: a paused prologue career and a main-menu player with
// free-roam multiplayer off. Select profiles, enter through the website, then
// use the actual website/headset race controls, race, and return. Only the
// guest's tracking and the original test autopilot/race finish are synthetic.
// Run against a dev server with complete PC data:
//   node web/tools/race-entry-check.mjs --base http://localhost:8611
import {chromium} from 'playwright';
import {pickBrowser} from './browser.mjs';
import {startRaceUIProbe} from './race-ui-probe.mjs';
import {startVRRaceProbe} from './vr-race-probe.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';
import path from 'node:path';import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../..',import.meta.url)));
const option=(key,fallback)=>{const at=process.argv.indexOf(key);return at<0?fallback:process.argv[at+1];};
const base=option('--base','http://localhost:8611').replace(/\/$/,'');
const out=path.resolve(option('--out','out/vr-race-entry-'+Date.now().toString(36)));fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']});const clients=[],results=[];
async function careerState(page){return page.evaluate(()=>{
 const s=window.__nfsu2.session,d=new DataView(s.proc.memory.buffer),u=p=>d.getUint32(p,true),m=s.cockpit.scene?.local?.matrix;
 return {car:u(0x863480),quick:u(0x83aab8),category:u(0x83aac0),bank:u(0x861e74),position:m?[m[12],m[13],m[14]]:null};
});}
async function start(index){
 const name=index?'EntryPeer':'EntryHost',ctx=await browser.newContext({viewport:{width:1280,height:800}}),page=await ctx.newPage(),logs=[];
 const dir=out+'/'+name;fs.mkdirSync(dir,{recursive:true});const c={name,ctx,page,logs,dir};clients.push(c);
 page.on('console',m=>{logs.push(m.text());fs.writeFileSync(`${dir}/console.log`,logs.join('\n'));});page.on('pageerror',e=>logs.push('PAGEERROR '+e));
 const file='vr_drivers_a.txt',boot=fs.readFileSync('tests/scripts/'+file,'utf8'),prelude=index?boot.split('+300  tap LEFT')[0]:boot.split('+0    roam mp waitpeers')[0]+'+60 roam teleport 1695.3 -883.6 24.6 0x4000\n+120 tap ESCAPE\n';
 const script=prelude+`+180 log ENTRY_READY
+0 waitfng PC_OL_Lobby.fng 12000
+0 waitmem 0x008654a4 6 18000
+0 waitexpr i:[0x00890118]+0x24 == 2 1800
+0 expect i:[0x00890118]+0x24 == 2
+0 autopilot on 6000
+0 log ENTRY_RACING
+${index?35000:30000}ms racewin
+0 waitfng UI_PostRaceResults.fng 18000
+180 log ENTRY_RESULTS
+3000ms tap RETURN
+0 waitfng PC_OL_Lobby.fng 6000
+180 log ENTRY_FINISHED
+30000 quit
`;
 await page.route('**/tests/scripts/'+file,r=>r.fulfill({contentType:'text/plain',body:script}));
 const q=new URLSearchParams({reg:'/tests/web/seed/registry_perf4_native.txt',script:'/tests/scripts/'+file,save:'race-entry-'+name,fresh:''});
 for(const[k,v]of Object.entries({NOMOVIES:1,NFSU2_RES:'1280x800',NFSU2_FPS:60,NFSU2_ROAM:index?0:1,NFSU2_ROAM_WEBTEST:'vlan',NFSU2_ROAM_COLLIDE:'off',NFSU2_ROAM_NAME:index?'BeforeEntry':name,ROAM_PROFILE:name,NFSU2_ROAM_SPAWN_M:0,NFSU2_ROAM_ROOM:'entry-pair',NOFOCUS:2}))q.append('env',`${k}=${v}`);
 await page.goto(base+'/?'+q);await page.waitForFunction(()=>window.__nfsu2?.phase==='ready',null,{timeout:120000});
 await page.locator('button[data-tab="online"]').click();await page.locator('#connection-create:enabled').fill(name);await page.locator('#connection-profiles').getByRole('button',{name:'Create profile',exact:true}).click();
 await page.waitForFunction(name=>document.querySelector('#connection-selected')?.selectedOptions[0]?.textContent===name,name);await page.click('#play');
 c.vr=await startVRRaceProbe(page,index,dir+'/avatars.png');
 const readyUntil=Date.now()+180000;while(!logs.some(l=>l.includes('LOG ENTRY_READY'))){assert(Date.now()<readyUntil,'script not ready');await page.waitForTimeout(200);}
 await page.waitForFunction(()=>window.__nfsu2.session.raceBrowser.canEnter,null,{timeout:120000});
 c.before=await careerState(page);
 await page.locator('.race-open').click();await page.locator('[data-race-key="enter"]').click();
 await page.waitForFunction(()=>window.__nfsu2.session.raceBrowser.snapshot?.source==='list'&&!window.__nfsu2.session.raceBrowser.busy,null,{timeout:120000});
 await page.locator('[data-race-key="back"]').click();
 c.index=index;return c;
}
try{
 await Promise.all([start(0),start(1)]);for(const c of clients)c.ui=await startRaceUIProbe(c.page,c.index,1,c.dir,'EntryHost',false);const until=Date.now()+360000;
 while(!clients.every(c=>c.logs.some(l=>l.includes('ENTRY_FINISHED')))){
  for(const c of clients)assert(!c.ui.proof.errors.length,c.name+': '+c.ui.proof.errors.join('; '));
  assert(Date.now()<until,'race did not complete');await new Promise(r=>setTimeout(r,500));
 }
 for(const c of clients){
  const ui=await c.ui(),vr=await c.vr();assert.equal(ui.phase,4,JSON.stringify(ui));assert.equal(ui.errors.length,0);assert(vr.samples>0,'no avatar samples');assert(vr.cars>=1);
  await c.page.evaluate(()=>{window.__nfsu2.session.renderer.vr.onTracking(null);});
  if(!await c.page.locator('#race-browser').evaluate(d=>d.open))await c.page.locator('.race-open').click();
  await c.page.locator('[data-race-key="exit"]').click();await c.page.waitForFunction(index=>{const s=window.__nfsu2.session;return !s.raceBrowser.snapshot?.entryActive&&(index?s.raceBrowser.snapshot?.canEnter:!!(s.status?.read()?.get('drive')&3));},c.index,{timeout:120000});
  const after=await careerState(c.page),stats=await c.page.evaluate(()=>window.__nfsu2.session.stats());assert.equal(stats['gpu errors'],0);
  for(const key of ['car','quick','category','bank'])assert.equal(after[key],c.before[key],key+' changed');
  if(c.index===0){assert(after.position&&c.before.position);assert(Math.hypot(...after.position.map((n,i)=>n-c.before.position[i]))<2,'career position changed');}
  assert(!c.logs.some(s=>/CARS.\(null\)|PAGEERROR|\[expect\] FAIL/.test(s)),'invalid car or runtime failure');
  await c.page.waitForTimeout(300);await c.page.screenshot({path:c.dir+'/returned.png'});
  await c.page.evaluate(()=>window.__nfsu2.session.input.requestQuit());await c.page.waitForFunction(()=>window.__nfsu2.phase==='exited',null,{timeout:30000});const exit=await c.page.evaluate(()=>window.__nfsu2.lastExit.code);assert.equal(exit,0);
  results.push({name:c.name,before:c.before,after,ui,vr,stats,exit});fs.writeFileSync(out+'/result.json',JSON.stringify(results,null,2));
 }
 console.log('PASS two actual games enter via selected profiles, website/headset lobby controls, race, avatars, results and return');
}catch(e){for(const c of clients){await c.page.screenshot({path:c.dir+'/failure.png'}).catch(()=>{});fs.writeFileSync(c.dir+'/failure.json',JSON.stringify(await c.page.evaluate(()=>({race:window.__nfsu2.session?.raceBrowser.snapshot,drive:window.__nfsu2.session?.status?.read()?.get('drive')})).catch(()=>null),null,2));}throw e;}finally{await browser.close();}
