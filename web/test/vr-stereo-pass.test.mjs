import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';

test('CPU and GPU world vertices share stereo while screen effects and other views retain their projection',async t=>{
  const code=(await esbuild.build({stdin:{contents:`export * from './src/gpu/proto';export * from './src/vr/math';export {Encoder} from './src/gpu/encoder';export {TVERT_VS} from './src/gpu/wgsl';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'M',write:false})).outputFiles[0].text;
  const server=createServer((_q,r)=>{r.setHeader('Cross-Origin-Opener-Policy','same-origin');r.setHeader('Cross-Origin-Embedder-Policy','require-corp');r.end('<!doctype html><body>Stereo projection test</body>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:code});
  const result=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {skip:'No WebGPU adapter'};
    const device=await adapter.requestDevice(),errors=[],logs=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const buffer=new SharedArrayBuffer(1<<20),u=new Uint32Array(buffer),f=new Float32Array(buffer),enc=new M.Encoder(device,{buffer},0,s=>logs.push(s));
    enc.vsMods.set(1,device.createShaderModule({code:M.vertexStereo(M.TVERT_VS)}));enc.texCreate(15,64,64,1,21,1);
    const fw=M.C.frame,dw=4096/4,tv=8192/4,raw=32768/4;
    u[fw+M.F.dn]=1;u[fw+M.F.vn]=3;u[fw+M.F.kn]=16384;u[fw+M.F.draws]=dw*4;u[fw+M.F.tv]=tv*4;u[fw+M.F.k]=16384;u[fw+M.F.psc]=12288;u[fw+M.F.bbW]=u[fw+M.F.bbH]=64;
    u[fw+M.F.raw]=raw*4;u[fw+M.F.rvn]=3*112;
    u[dw+M.D.count]=3;u[dw+M.D.cull]=1;u[dw+M.D.blend]=15<<14;u[dw+M.D.ksz]=16;f[dw+M.D.fogv+3]=1;
    for(const [j,p]of [[-.4,-.4],[.4,-.4],[0,.4]].entries()){const at=tv+j*28;f.set([...p,.5,1],at);f.set([1,1,1,1],at+4);}f.set(f.slice(tv,tv+84),raw);
    const output=device.createTexture({size:[64,64],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
    const pixels=device.createBuffer({size:64*64*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const draw=async(vsid,flags,shift,target=0,reuse=false)=>{
      if(!reuse)u[fw+M.F.seq]++;u[dw+M.D.vsid]=vsid;u[dw+M.D.vrFlags]=flags;u[dw+M.D.target]=target;
      const eye=M.identity();eye[12]=shift;const command=device.createCommandEncoder();enc.encodeFrame(0,command,output,eye,reuse);
      command.copyTextureToBuffer({texture:target?enc.tex[target].tex:output},{buffer:pixels,bytesPerRow:256},[64,64]);device.queue.submit([command.finish()]);
      await pixels.mapAsync(GPUMapMode.READ);const data=new Uint8Array(pixels.getMappedRange()).slice();pixels.unmap();return data;
    };
    const primary=1<<M.VR_VIEW_SHIFT,world=primary|M.VR_PERSPECTIVE;
    const baseline=await draw(0,world,0),left=await draw(0,world,-.3),right=await draw(0,world,.3),gpuLeft=await draw(1,world,-.3),gpuRight=await draw(1,world,.3);
    const difference=(a,b)=>a.reduce((n,v,i)=>n+(v!==b[i]),0);
    const fixed=[];
    for(const vs of [0,1])for(const flags of [primary,2<<M.VR_VIEW_SHIFT|M.VR_PERSPECTIVE,M.VR_PERSPECTIVE,world|M.VR_HUD]){
      fixed.push(difference(await draw(vs,flags,-.3),await draw(vs,flags,.3)));
    }
    const reflection=difference(await draw(0,world,-.3,15),await draw(0,world,.3,15));
    const changes=[difference(baseline,left),difference(baseline,right)],paths=[difference(left,gpuLeft),difference(right,gpuRight)];
    const uploads=[],write=device.queue.writeBuffer.bind(device.queue);
    device.queue.writeBuffer=(buffer,...args)=>{uploads.push(buffer.label);return write(buffer,...args);};
    let sceneUpdates=0;
    enc.drivers={updateScene(){sceneUpdates++;return null;}};
    const cachedLeft=await draw(1,world,-.3),cachedRight=await draw(1,world,.3,0,true);
    const reusePixels=[difference(cachedLeft,gpuLeft),difference(cachedRight,gpuRight)];
    const sharedSceneUpdates=sceneUpdates;
    const sharedUploads=uploads.splice(0);
    // An unrelated frame cannot reuse stale arenas, even if the caller asks.
    u[fw+M.F.seq]++;await draw(1,world,.3,0,true);
    device.destroy();return {changes,paths,fixed,reflection,errors,logs,reusePixels,uploads:sharedUploads,freshUploads:uploads,sharedSceneUpdates,sceneUpdates};
  });
  if(result.skip){t.skip(result.skip);return;}
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.logs,[]);
  assert.ok(result.changes.every(n=>n>100),JSON.stringify(result));assert.deepEqual(result.paths,[0,0]);
  assert.ok(result.fixed.every(n=>n===0),JSON.stringify(result));assert.equal(result.reflection,0);
  assert.deepEqual(result.reusePixels,[0,0],'shared geometry retains distinct, correct stereo pixels');
  assert.equal(result.sharedSceneUpdates,1);assert.equal(result.sceneUpdates,2);
  for(const label of ['tvert','raw','vsconst','pspar']){
    assert.equal(result.uploads.filter(n=>n===label).length,1,`${label} uploads once for both eyes`);
    assert.equal(result.freshUploads.filter(n=>n===label).length,1,`${label} refreshes for a different frame`);
  }
});
