import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';

test('cabin, wheel and gloves match native material pixels, independent of car/hand rotation; media stays ungraded',async t=>{
  const code=(await esbuild.build({stdin:{contents:`export {DriverRenderer} from './src/vr/driver-renderer';export * from './src/vr/math';export {wheel} from './src/vr/cabin-parts';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'M',write:false})).outputFiles[0].text;
  const server=createServer(async(q,r)=>{
    if(/^\/vr-(cabin|glove)\.(png|nvwm)$/.test(q.url))r.end(await readFile(new URL('../src/static'+q.url,import.meta.url)));
    else r.end('<!doctype html><title>Native cabin material</title>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:code});
  const result=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {skip:'No WebGPU adapter'};
    const d=await adapter.requestDevice(),errors=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const renderer=new M.DriverRenderer(d,()=>new Map(),()=>{});await renderer.ready;
    const vertices=d.createBuffer({size:(M.wheel.first+3)*32,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    const opened=d.createBuffer({size:3*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    const texture=d.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    const albedo=[128,160,200,255];d.queue.writeTexture({texture},new Uint8Array(albedo),{bytesPerRow:4},[1,1]);
    const bind=d.createBindGroup({layout:renderer.layout,entries:[
      {binding:0,resource:{buffer:renderer.uniform,size:208}},
      {binding:1,resource:texture.createView()},{binding:2,resource:d.createSampler()},
      {binding:3,resource:{buffer:opened}},
    ]});
    const color=d.createTexture({size:[64,64],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    const depth=d.createTexture({size:[64,64],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const read=d.createBuffer({size:64*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),samples=[];
    for(const [kind,first] of [[0,0],[0,M.wheel.first],[1,0],[3,0]])for(const normal of [[0,1,0],[0,-1,0],[1,0,0]])for(const rotated of [false,true]){
      const data=new Float32Array(24);
      [[-.8,-.8,.5],[.8,-.8,.5],[0,.8,.5]].forEach((p,i)=>data.set([...p,...normal,.5,.5],i*8));
      d.queue.writeBuffer(vertices,first*32,data);d.queue.writeBuffer(opened,0,data);
      const u=new Float32Array(64);u.set(M.identity());u.set(M.identity(),16);
      if(rotated){u[16]=u[21]=0;u[17]=1;u[20]=-1;}
      u.set([1,1,1,1],32);u.set([kind,20,1,0],36);d.queue.writeBuffer(renderer.uniform,0,u);
      const enc=d.createCommandEncoder(),p=enc.beginRenderPass({colorAttachments:[{view:color.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'discard'}});
      p.setPipeline(renderer.pipeline(1));p.setBindGroup(0,bind,[0]);p.setVertexBuffer(0,vertices);p.draw(3,1,first);p.end();
      enc.copyTextureToBuffer({texture:color},{buffer:read,bytesPerRow:256},[64,64]);d.queue.submit([enc.finish()]);
      await read.mapAsync(GPUMapMode.READ);const a=new Uint8Array(read.getMappedRange()),at=(32*64+32)*4;
      samples.push({kind,first,normal,rotated,rgb:[a[at+2],a[at+1],a[at]]});read.unmap();
    }
    renderer.destroy();for(const resource of [vertices,opened,texture,color,depth,read])resource.destroy();
    await d.queue.onSubmittedWorkDone();d.destroy();return {samples,errors};
  });
  if(result.skip){t.skip(result.skip);return;}
  assert.deepEqual(result.errors,[]);
  for(const s of result.samples){
    // Independent reference from quest_cockpit_vk.inc's vertex shade and cabinSurface.
    const light=[-.3,.9,-.2],shade=.78+.22*Math.max(0,s.normal.reduce((n,v,i)=>n+v*light[i],0)/Math.hypot(...light));
    const expected=[128,160,200].map((v,i)=>Math.round(v*(s.kind===3?1:shade*shade*[.51,.49,.54][i])));
    assert.ok(s.rgb.every((v,i)=>Math.abs(v-expected[i])<=1),JSON.stringify({sample:s,expected}));
  }
});
