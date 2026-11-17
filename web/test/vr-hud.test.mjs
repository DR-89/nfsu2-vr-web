import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';

const source=(await esbuild.build({stdin:{contents:`export * from './src/vr/hud-panels';export * from './src/vr/math';export * from './src/vr/vehicle-fits';export * from './src/gpu/proto';export {Encoder} from './src/gpu/encoder';export {TVERT_VS} from './src/gpu/wgsl';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'HUD',write:false})).outputFiles[0].text;
const H=(await import('node:vm')).runInNewContext(source+';HUD;');
test('native HUD crops and window placements fit every authored cabin',()=>{
  for(const [model,fit] of Object.entries(H.vehicleFits)){
    const v=H.hudPanels(model);assert.equal(v.length,48*6);assert.ok(v.every(Number.isFinite),model);
    // Gauge letters remain left-to-right after fitting a right-hand-drive dash.
    const gauge=Array.from({length:6},(_,i)=>Array.from(v.slice(i*6,i*6+6)));
    const a=gauge.reduce((a,b)=>a[0]<b[0]?a:b),b=gauge.reduce((a,b)=>a[0]>b[0]?a:b);
    assert.ok(a[3]<b[3],model);assert.ok(a[2]<-.33);
    for(let i=42;i<48;i++){const [x,y]=v.slice(i*6,i*6+2);assert.ok(Math.abs(x-(fit[8]-.025-y*fit[9]))<1e-6);}
    const center=[0,0,0];for(let i=6;i<12;i++)for(let k=0;k<3;k++)center[k]+=v[i*6+k]/6;
    for(let i=6;i<12;i++){assert.ok(Math.abs(Math.hypot(...center.map((x,k)=>v[i*6+k]-x))-.075*Math.SQRT2)<1e-6);assert.equal(v[i*6+5],1);}
  }
});

test('replay uses one complete frontend plane and retains head movement in either eye',()=>{
  const v=H.replayPanel();assert.equal(v.length,36);
  assert.equal(v[2],-3);assert.equal(v[5],0);assert.equal(v[3],0);assert.equal(v[9],1);assert.equal(v[16],1);
  const head=H.identity();head[12]=-.2;
  const projection=new Float32Array([1,0,0,0,0,-1,0,0,0,0,1,1,0,0,-.1,0]);
  const xr=H.multiply(projection,H.GAME_TO_XR);
  for(const x of [-.032,.032]){
    const view=H.identity();view[12]=-.3+x;
    const correction=H.eyeCorrection(xr,view,head,projection),out=H.replayPanelView({projection,headView:head},correction),want=H.multiply(xr,view);
    out.forEach((v,i)=>assert.ok(Math.abs(v-want[i])<1e-5));
  }
});

test('real GPU HUD capture preserves alpha, separates world colour and is reused for stereo',async t=>{
  const server=createServer((_req,res)=>{res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.end('<!doctype html><body>HUD capture test</body>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:source});
  const result=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {skip:'No WebGPU adapter'};
    const device=await adapter.requestDevice(),errors=[],logs=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const buffer=new SharedArrayBuffer(1<<20),u=new Uint32Array(buffer),f=new Float32Array(buffer),h=new HUD.HudPanels(device),encoder=new HUD.Encoder(device,{buffer},0,s=>logs.push(s));
    encoder.drivers={hud:h,localActive:false,updateScene:()=>null};
    const fw=HUD.C.frame,dw=4096/4,tv=8192/4,psc=12288/4;
    u[fw+HUD.F.seq]=1;u[fw+HUD.F.dn]=3;u[fw+HUD.F.vn]=9;u[fw+HUD.F.kn]=12288;u[fw+HUD.F.draws]=dw*4;u[fw+HUD.F.tv]=tv*4;u[fw+HUD.F.psc]=psc*4;u[fw+HUD.F.k]=16384;u[fw+HUD.F.bbW]=64;u[fw+HUD.F.bbH]=64;
    for(let i=0;i<3;i++){
      const d=dw+i*HUD.DRAW_WORDS;u[d+HUD.D.first]=i*3;u[d+HUD.D.count]=3;u[d+HUD.D.cull]=1;u[d+HUD.D.blend]=i?1+(5<<1)+(6<<6)+(1<<11)+(7<<14):15<<14;u[d+HUD.D.vrFlags]=i?HUD.VR_HUD:0;f[d+HUD.D.fogv+3]=1;
      const color=i===0?[0,0,1,1]:i===1?[1,0,0,.5]:[0,1,0,.5];
      for(const [j,p] of [[-1,-1],[3,-1],[-1,3]].entries()){const at=tv+(i*3+j)*28;f.set([...p,.5,1],at);f.set(color,at+4);}
    }
    const output=device.createTexture({size:[64,64],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
    const pixel=async(texture,x,y)=>{const b=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),ce=device.createCommandEncoder();ce.copyTextureToBuffer({texture,origin:[x,y]},{buffer:b,bytesPerRow:256},[1,1]);device.queue.submit([ce.finish()]);await b.mapAsync(GPUMapMode.READ);const rgba=Array.from(new Uint8Array(b.getMappedRange()).slice(0,4));b.unmap();b.destroy();return [rgba[2],rgba[1],rgba[0],rgba[3]];};
    const draw=async()=>{const ce=device.createCommandEncoder(),eye=HUD.identity();eye[12]=.3;const stats=encoder.encodeFrame(0,ce,output,eye);device.queue.submit([ce.finish()]);await device.queue.onSubmittedWorkDone();return stats;};
    const first=await draw(),captured=await pixel(h.texture,640,480),world=await pixel(output,32,32);
    const second=await draw(),reused=await pixel(h.texture,640,480);
    u[fw+HUD.F.seq]=2;u[fw+HUD.F.dn]=2;const third=await draw(),cleared=await pixel(h.texture,640,480);
    // A GPU vertex draw normally receives the eye delta. Captured frontend
    // vertices must bind identity even at the left edge of an asymmetric eye.
    encoder.vsMods.set(1,device.createShaderModule({code:HUD.vertexStereo(HUD.TVERT_VS)}));
    u[fw+HUD.F.seq]=3;u[fw+HUD.F.raw]=32768;u[fw+HUD.F.rvn]=3*112;f.set(f.slice(tv+3*28,tv+6*28),32768/4);
    const rawDraw=dw+HUD.DRAW_WORDS;u[rawDraw+HUD.D.vsid]=1;u[rawDraw+HUD.D.ksz]=16;
    await draw();const rawEdge=await pixel(h.texture,5,480);
    // Compile/draw the real panel shaders at both sample counts, including the
    // gauge's trim override and circular map derivative edge coverage.
    for(const count of [1,4]){
      const color=device.createTexture({size:[64,64],format:'bgra8unorm',sampleCount:count,usage:GPUTextureUsage.RENDER_ATTACHMENT}),depth=device.createTexture({size:[64,64],format:'depth32float',sampleCount:count,usage:GPUTextureUsage.RENDER_ATTACHMENT});
      const ce=device.createCommandEncoder(),p=ce.beginRenderPass({colorAttachments:[{view:color.createView(),loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'store'}});
      h.draw(p,{cockpit:true,local:{model:'PEUGOT',matrix:HUD.identity()},view:HUD.identity(),projection:HUD.identity(),gps:{metres:1500,metric:true}},undefined,count);p.end();device.queue.submit([ce.finish()]);await device.queue.onSubmittedWorkDone();color.destroy();depth.destroy();
    }
    h.destroy();output.destroy();device.destroy();return {first,second,third,captured,world,reused,cleared,rawEdge,errors,logs};
  });
  if(result.skip){t.skip(result.skip);return;}
  assert.deepEqual(result.errors,[],JSON.stringify(result));assert.deepEqual(result.logs,[],JSON.stringify(result));
  const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<=2,JSON.stringify({a,b})));
  near(result.captured,[64,128,0,191]);near(result.world,[0,0,255,255]);near(result.reused,result.captured);near(result.cleared,[128,0,0,128]);near(result.rawEdge,[128,0,0,128]);
  assert.equal(result.first.draws,3);assert.equal(result.second.draws,1);assert.equal(result.third.draws,2);
});
