import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';

test('only surviving, screen-independent colour and depth targets are shared',async()=>{
  const code=(await esbuild.build({stdin:{contents:`export * from './src/gpu/proto';export {sharedPrelude} from './src/gpu/stereo-prepass';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
  const {D,DRAW_WORDS,Kind,sharedPrelude}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  const clear={kind:Kind.Clear,target:0,depth:1<<8},mono={target:7,depth:3<<8},world={target:0,depth:1<<8};
  const check=(records,expected)=>{
    const u=new Uint32Array(12+records.length*DRAW_WORDS);
    records.forEach((record,i)=>{for(const [key,value]of Object.entries(record))u[12+i*DRAW_WORDS+D[key]]=value;});
    assert.equal(sharedPrelude(u,12,records.length),expected,JSON.stringify(records));
  };
  check([clear,mono,world],2);
  check([clear,mono,world,{kind:Kind.Blit,blitSrc:7,target:9}],2);
  check([clear,mono,world,{target:7|(2<<16)}],0); // another cube face aliases the texture
  check([clear,mono,world,{target:8,depth:3<<8}],0);
  check([clear,{...mono,depth:1<<8},world],0);
  check([clear,{kind:Kind.Blit,blitSrc:0,target:7},world],0);
  check([clear,world,mono],0);
  check([clear,mono],0);
});

test('shared mono prepasses preserve both eye images and refresh each frame; overwritten targets replay',async t=>{
  const code=(await esbuild.build({stdin:{contents:`export * from './src/gpu/proto';export * from './src/vr/math';export {Encoder} from './src/gpu/encoder';export {sharedPrelude} from './src/gpu/stereo-prepass';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'M',write:false})).outputFiles[0].text;
  const server=createServer((_q,r)=>r.end('<!doctype html><title>Stereo prepass pixels</title>'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:code});
  const result=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {skip:'No WebGPU adapter'};
    const device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const buffer=new ArrayBuffer(1<<20),u=new Uint32Array(buffer),f=new Float32Array(buffer),enc=new M.Encoder(device,{buffer},0,()=>{});
    const fw=M.C.frame,dw=4096/4,tv=8192/4,record=i=>dw+i*M.DRAW_WORDS;
    u[fw+M.F.vn]=6;u[fw+M.F.kn]=16384;u[fw+M.F.draws]=dw*4;u[fw+M.F.tv]=tv*4;u[fw+M.F.k]=16384;u[fw+M.F.psc]=12288;u[fw+M.F.bbW]=u[fw+M.F.bbH]=64;
    for(const id of [15,16])enc.texCreate(id,64,64,1,21,1);
    for(let i=0;i<2;i++){
      const w=record(i);u[w+M.D.kind]=M.Kind.Clear;u[w+M.D.target]=i?15:0;u[w+M.D.depth]=(i?3:1)<<8;u[w+M.D.clrFlags]=3;u[w+M.D.clrArgb]=i?0xff0000ff:0xff000000;f[w+M.D.clrZ]=1;
    }
    for(let i=2;i<4;i++){
      const w=record(i);u[w+M.D.target]=i===2?15:0;u[w+M.D.tex]=i===2?0:15;u[w+M.D.first]=(i-2)*3;u[w+M.D.count]=3;
      u[w+M.D.depth]=19|((i===2?3:1)<<8);u[w+M.D.cull]=1;u[w+M.D.blend]=15<<14;f[w+M.D.fogv+3]=1;u[w+M.D.vrFlags]=18;
      // Distinct pixel-constant slots: the second eye skips the first draw.
      // Binding the compacted slot zero would discard its half-alpha world.
      f[w+M.D.aref]=i===2?.75:.25;
    }
    for(let i=0;i<6;i++){
      const xy=[[-1,-1],[1,-1],[0,1]][i%3],p=tv+i*28;
      f.set([...xy,.5,1],p);f.set([1,1,1,i<3?1:.5],p+4);f.set([(xy[0]+1)/2,(1-xy[1])/2],p+12);
    }
    const overwrite=record(4);u[overwrite+M.D.kind]=M.Kind.Blit;u[overwrite+M.D.blitSrc]=16;u[overwrite+M.D.target]=15;
    const output=device.createTexture({size:[64,64],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
    const read=device.createBuffer({size:64*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const pair=async(reuse,color,overwritten=false)=>{
      u[fw+M.F.seq]++;u[fw+M.F.dn]=overwritten?5:4;
      for(let i=0;i<3;i++)f.set(color,tv+i*28+4);
      const samples=[];
      for(let i=0;i<2;i++){
        const eye=M.identity();eye[12]=i?.25:-.25;
        const command=device.createCommandEncoder(),stats=enc.encodeFrame(0,command,output,eye,reuse&&i===1);
        command.copyTextureToBuffer({texture:output},{buffer:read,bytesPerRow:256},[64,64]);device.queue.submit([command.finish()]);enc.afterSubmit();
        await read.mapAsync(GPUMapMode.READ);samples.push({draws:stats.draws,pixels:Array.from(new Uint8Array(read.getMappedRange()))});read.unmap();
      }
      return samples;
    };
    const cases=[];
    for(const color of [[1,0,0,1],[0,1,0,1]])for(const overwritten of [false,true]){
      const golden=await pair(false,color,overwritten),shared=await pair(true,color,overwritten);
      cases.push({overwritten,delta:shared.map((s,i)=>s.pixels.filter((p,k)=>p!==golden[i].pixels[k]).length),draws:shared.map(s=>s.draws),stereo:golden[0].pixels.filter((p,k)=>p!==golden[1].pixels[k]).length,nonzero:golden[0].pixels.filter((p,k)=>k%4!==3&&p>0).length});
    }
    await device.queue.onSubmittedWorkDone();device.destroy();return {cases,errors};
  });
  if(result.skip){t.skip(result.skip);return;}
  assert.deepEqual(result.errors,[]);
  for(const c of result.cases){assert.deepEqual(c.delta,[0,0],JSON.stringify(c));assert.deepEqual(c.draws,c.overwritten?[2,2]:[2,1]);assert.ok(c.stereo>100);assert.ok(c.nonzero>100);}
});
