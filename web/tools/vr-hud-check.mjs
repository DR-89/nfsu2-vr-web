// Real PC frontend draws captured on the actual WebGPU device. Controller
// hardware and optical readability require a separate headset session.
import {chromium} from 'playwright';
import {pickBrowser} from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
const repo=fileURLToPath(new URL('../..',import.meta.url)),gpu=process.env.HUD_GPUVS??'1',race=process.env.HUD_RACE==='1',out=path.join(repo,`out/vr-checks/hud-live-${gpu}${race?'-race':''}`);fs.mkdirSync(out,{recursive:true});
const prefix=race?fs.readFileSync(path.join(repo,'tests/scripts/carbal_straight.txt'),'utf8').split('+0    wzero')[0]+'+600 log SHOT cockpit_media\n':fs.readFileSync(path.join(repo,'tests/scripts/vr_cockpit.txt'),'utf8').split('+0 trigger RT 1')[0];
const script=prefix+'+3600 quit\n';
const helpers=(await esbuild.build({stdin:{contents:`export * from './src/gpu/proto';export * from './src/vr/math';`,resolveDir:path.join(repo,'web'),loader:'ts'},bundle:true,format:'iife',globalName:'HudProbe',write:false})).outputFiles[0].text;
const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']}),page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],logs=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{logs.push(m.text());fs.writeFileSync(path.join(out,'progress.log'),logs.join('\n'));if(/WebGPU error:|uncaptured|validation error|GPUValidationError/.test(m.text()))errors.push(m.text());});
try{
  // Observe the real capture without a product readback path or debug setting.
  await page.addInitScript(()=>{
    const request=GPUAdapter.prototype.requestDevice,create=GPUDevice.prototype.createTexture;
    GPUAdapter.prototype.requestDevice=async function(...args){const d=await request.apply(this,args);window.__hudDevice=d;return d;};
    GPUDevice.prototype.createTexture=function(desc){const t=create.call(this,desc);if(desc.label==='Original cockpit HUD')window.__hudTexture=t;return t;};
  });
  const query=new URLSearchParams({reg:'/tests/web/seed/registry_perf4_native.txt',script:'/tests/scripts/vr_cockpit.txt',save:`vr-hud-${gpu}`,fresh:''});
  for(const [k,v] of Object.entries({GPUVS:gpu,NOMOVIES:1,NFSU2_RES:'1280x800',NFSU2_FPS:60,NFSU2_VR_COCKPIT:1,NFSU2_ROAM:0,ROAM_PROFILE:'HudTest',NFSU2_ROAM_NAME:'HudTest'}))query.append('env',`${k}=${v}`);
  await page.route('**/tests/scripts/vr_cockpit.txt',r=>r.fulfill({contentType:'text/plain',body:script}));await page.route('**/tests/vr-hud-helpers.js',r=>r.fulfill({contentType:'text/javascript',body:helpers}));
  await page.goto('http://localhost:8612/?'+query);await page.addScriptTag({url:'/tests/vr-hud-helpers.js'});await page.waitForFunction(()=>window.__nfsu2?.phase==='ready',null,{timeout:120000});await page.click('#play');
  await page.waitForFunction(()=>!!window.__nfsu2?.session?.cockpit?.scene?.cockpit,null,{timeout:180000});
  await new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(logs.some(s=>s.includes('SHOT cockpit_media'))){clearInterval(timer);resolve();}},100);setTimeout(()=>{clearInterval(timer);reject(new Error('career intro did not finish'));},90000).unref();});
  const snap=async name=>{
    await page.screenshot({path:path.join(out,`${name}.png`)});
    const result=await page.evaluate(async()=>{
      const device=window.__hudDevice,texture=window.__hudTexture,width=1280,height=960,b=device.createBuffer({size:width*height*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),ce=device.createCommandEncoder();ce.copyTextureToBuffer({texture},{buffer:b,bytesPerRow:width*4},[width,height]);device.queue.submit([ce.finish()]);await b.mapAsync(GPUMapMode.READ);const rgba=new Uint8ClampedArray(b.getMappedRange()).slice();b.unmap();b.destroy();
      let visible=0,partial=0,gauge=0,map=0;for(let i=0;i<rgba.length;i+=4){[rgba[i],rgba[i+2]]=[rgba[i+2],rgba[i]];if(rgba[i+3]>5){visible++;const x=(i/4)%width,y=Math.floor(i/4/width);if(x>=880&&y>=520)gauge++;if(x<400&&y>=520)map++;}if(rgba[i+3]>5&&rgba[i+3]<250)partial++;}
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);
      const s=window.__nfsu2.session,P=HudProbe,{ptr}=await s.proc.registered(1),u=new Uint32Array(s.proc.memory.buffer),cw=ptr/4;
      const fw0=cw+P.C.frame,fw1=fw0+P.FRAME_BYTES/4,fw=u[fw0+P.F.seq]>u[fw1+P.F.seq]?fw0:fw1,dw=u[fw+P.F.draws]/4,n=u[fw+P.F.dn];let captured=0,raw=0;
      for(let i=0;i<n;i++){const w=dw+i*P.DRAW_WORDS;if(u[w+P.D.vrFlags]&P.VR_HUD){captured++;if(u[w+P.D.vsid])raw++;}}
      return {png:canvas.toDataURL(),visible,partial,gauge,map,captured,raw,stats:s.renderer.stats(),telemetry:s.cockpit.scene.telemetry};
    });
    fs.writeFileSync(path.join(out,`${name}-hud.png`),Buffer.from(result.png.split(',')[1],'base64'));delete result.png;return result;
  };
  const stopped=await snap('stopped');assert.ok(stopped.captured>10,JSON.stringify(stopped));assert.ok(stopped.gauge>1000&&stopped.map>1000,JSON.stringify(stopped));assert.ok(stopped.visible<1280*960*.6,JSON.stringify(stopped));assert.equal(stopped.stats['gpu errors'],0);
  assert.equal(stopped.raw>0,gpu==='1',JSON.stringify(stopped));
  await page.keyboard.down('ArrowUp');await page.waitForTimeout(2500);await page.keyboard.up('ArrowUp');const moving=await snap('moving');assert.ok(moving.telemetry.rpm>stopped.telemetry.rpm+100,JSON.stringify({stopped,moving}));
  await page.evaluate(async()=>{
    const s=window.__nfsu2.session,{ptr}=await s.proc.registered(8),buffer=s.proc.memory.buffer,u=new Uint32Array(buffer,ptr,24),f=new Float32Array(buffer,ptr,24),d=new Float64Array(buffer,ptr,12),p=window.__hudHead={yaw:0,ptr};
    p.timer=setInterval(()=>{const m=HudProbe.identity(),c=Math.cos(p.yaw),sn=Math.sin(p.yaw);m[0]=m[10]=c;m[2]=-sn;m[8]=sn;Atomics.add(u,2,1);u[3]=1;d[2]=performance.timeOrigin+performance.now();f.set(m,6);f[22]=1.9;Atomics.add(u,2,1);},16);
  });
  await page.evaluate(()=>window.__hudHead.yaw=1.3);await page.waitForTimeout(500);const side=await snap('right-window');assert.equal(side.stats['gpu errors'],0);
  await page.evaluate(()=>{const p=window.__hudHead;clearInterval(p.timer);const u=new Uint32Array(window.__nfsu2.session.proc.memory.buffer,p.ptr,24);Atomics.add(u,2,1);u[3]=0;Atomics.add(u,2,1);});
  await page.keyboard.press('Escape',{delay:150});await page.waitForFunction(()=>!window.__nfsu2.session.cockpit.scene?.cockpit,null,{timeout:10000});await page.waitForTimeout(300);const pause=await snap('pause');assert.equal(pause.captured,0);
  await page.keyboard.press('Escape',{delay:150});await page.waitForFunction(()=>window.__nfsu2.session.cockpit.scene?.cockpit===true,null,{timeout:10000});await page.waitForTimeout(300);const resumed=await snap('resumed');assert.ok(resumed.captured>10);assert.equal(resumed.stats['gpu errors'],0);
  await page.evaluate(()=>window.__nfsu2.session.input.requestQuit());await page.waitForFunction(()=>window.__nfsu2.phase==='exited',null,{timeout:30000});assert.deepEqual(errors,[]);
  const result={pass:true,gpu,race,stopped,moving,side,pause,resumed,errors};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){
  const state=await page.evaluate(()=>{const s=window.__nfsu2?.session;return {cockpit:s?.cockpit?.scene,phase:window.__nfsu2?.phase,input:s?.input?.status(),modal:document.querySelector('dialog[open]')?.id};}).catch(()=>null);
  fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),state,errors},null,2));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;
}finally{fs.writeFileSync(path.join(out,'page.log'),logs.join('\n'));await browser.close();}
