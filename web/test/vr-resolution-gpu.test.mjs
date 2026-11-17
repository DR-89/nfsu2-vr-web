import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';

test('VR scene rasterization, viewports, clipping and screen copies follow eye resolution',async t=>{
  const code=(await esbuild.build({stdin:{contents:`export * from './src/gpu/encoder';export * from './src/gpu/proto';export * from './src/vr/math';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'V',write:false})).outputFiles[0].text;
  const server=createServer((_,r)=>r.end('<!doctype html><title>VR resolution test</title>'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:code});
  const result=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {skip:'No WebGPU adapter'};
    const device=await adapter.requestDevice(),errors=[],logs=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const buffer=new ArrayBuffer(1<<20),u=new Uint32Array(buffer),f=new Float32Array(buffer),enc=new V.Encoder(device,{buffer},0,s=>logs.push(s));
    const fw=V.C.frame,dw=4096/4,tv=8192/4,blit=dw+V.DRAW_WORDS;
    u[fw+V.F.vn]=6;u[fw+V.F.kn]=16384;u[fw+V.F.draws]=dw*4;u[fw+V.F.tv]=tv*4;u[fw+V.F.k]=16384;u[fw+V.F.psc]=12288;u[fw+V.F.bbW]=u[fw+V.F.bbH]=64;
    u[dw+V.D.count]=6;u[dw+V.D.cull]=1;u[dw+V.D.blend]=15<<14;f[dw+V.D.fogv+3]=1;
    f.set([16,8,32,48,0,1],dw+V.D.viewport);u[dw+V.D.clip]=16|(48<<16);
    u[dw+V.D.vrFlags]=(1<<V.VR_VIEW_SHIFT)|V.VR_PERSPECTIVE;
    for(const [j,p] of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]].entries()){
      f.set([...p,.5,1],tv+j*28);f.set([1,1,1,1],tv+j*28+4);
    }
    enc.texCreate(15,16,16,1,21,1);
    u[blit+V.D.kind]=V.Kind.Blit;u[blit+V.D.target]=15;u[blit+V.D.first]=16|(16<<16);u[blit+V.D.count]=48|(48<<16);
    const samples=[];
    for(const [width,height,eye,readFirst] of [[32,48,true,false],[128,96,true,false],[128,96,true,true],[128,96,false,false]]){
      // A leading screen copy forces the encoder's back-buffer fallback.
      if(readFirst){u.copyWithin(dw+2*V.DRAW_WORDS,dw,blit+V.DRAW_WORDS);u.fill(0,dw,blit);u[dw+V.D.kind]=V.Kind.Blit;u[dw+V.D.target]=15;}
      u[fw+V.F.dn]=readFirst?4:2;u[fw+V.F.seq]++;
      const output=device.createTexture({size:[width,height],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
      const command=device.createCommandEncoder(),stats=enc.encodeFrame(0,command,output,eye?V.identity():undefined);
      const screen=enc.screen,bytesPerRow=256*Math.ceil(screen.width*4/256),pixels=device.createBuffer({size:bytesPerRow*screen.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),crop=device.createBuffer({size:256*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      command.copyTextureToBuffer({texture:screen},{buffer:pixels,bytesPerRow},[screen.width,screen.height]);
      command.copyTextureToBuffer({texture:enc.tex[15].tex},{buffer:crop,bytesPerRow:256},[16,16]);device.queue.submit([command.finish()]);
      await pixels.mapAsync(GPUMapMode.READ);await crop.mapAsync(GPUMapMode.READ);
      const data=new Uint8Array(pixels.getMappedRange()),cut=new Uint8Array(crop.getMappedRange());let bad=0,cropBad=0;
      for(let y=0;y<screen.height;y++)for(let x=0;x<screen.width;x++){
        const white=x>=screen.width/4&&x<screen.width*3/4&&y>=screen.height/4&&y<screen.height*3/4;
        if(data[y*bytesPerRow+x*4]!==Number(white)*255)bad++;
      }
      for(let y=0;y<16;y++)for(let x=0;x<16;x++)if(cut[y*256+x*4]!==255)cropBad++;
      samples.push({width:screen.width,height:screen.height,direct:stats.direct,bad,cropBad});
      pixels.unmap();crop.unmap();pixels.destroy();crop.destroy();output.destroy();
      if(readFirst)u.copyWithin(dw,dw+2*V.DRAW_WORDS,dw+4*V.DRAW_WORDS);
    }
    // A size switch must clear depth even when its allocation is reused. A
    // following pass at the same size must retain it for normal occlusion.
    const depths=[],made=[],create=device.createTexture.bind(device);
    device.createTexture=desc=>{if(desc.label?.startsWith('z1 '))made.push(desc.label);return create(desc);};
    u[fw+V.F.dn]=1;u[dw+V.D.depth]=19|(1<<8);
    for(const [size,z] of [[32,.2],[64,.2],[32,.8],[32,.9]]){
      for(let i=0;i<6;i++)f[tv+i*28+2]=z;
      u[fw+V.F.seq]++;
      const output=device.createTexture({size:[size,size],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
      const command=device.createCommandEncoder();enc.encodeFrame(0,command,output,V.identity());
      const read=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      command.copyTextureToBuffer({texture:output,origin:[size/2,size/2]},{buffer:read,bytesPerRow:256},[1,1]);
      device.queue.submit([command.finish()]);enc.afterSubmit();await read.mapAsync(GPUMapMode.READ);
      depths.push(new Uint8Array(read.getMappedRange())[0]);read.unmap();read.destroy();output.destroy();
    }
    // The real game's effects copy SCREEN -> full-size RT -> another RT ->
    // SCREEN. One-pixel stripes must survive at eye resolution, not shrink to
    // the 64x64 window between the scene and its final composite.
    enc.texCreate(21,64,64,1,21,1);enc.texCreate(22,64,64,1,21,1);
    enc.psMods.set(99,device.createShaderModule({code:`override ALPHA_FUNC:u32=8u; @fragment fn main(@builtin(position) p:vec4f)->@location(0) vec4f {if(ALPHA_FUNC==999u){discard;} return vec4f(vec3f(f32(u32(p.x)%2u)),1.);}`}));
    enc.psMods.set(100,device.createShaderModule({code:`override ALPHA_FUNC:u32=8u; @group(1) @binding(0) var image:texture_2d<f32>; @group(1) @binding(4) var smp:sampler;
      @fragment fn main(@builtin(position) p:vec4f)->@location(0) vec4f {if(ALPHA_FUNC==999u){discard;} return textureSampleLevel(image,smp,p.xy/vec2f(128.,96.),0.);}`}));
    u.fill(0,dw,dw+4*V.DRAW_WORDS);u[fw+V.F.dn]=4;
    u[dw+V.D.count]=6;u[dw+V.D.cull]=1;u[dw+V.D.blend]=15<<14;u[dw+V.D.ps]=99;f[dw+V.D.fogv+3]=1;
    const copy=dw+V.DRAW_WORDS,effect=copy+V.DRAW_WORDS,finish=effect+V.DRAW_WORDS;
    u[copy+V.D.kind]=V.Kind.Blit;u[copy+V.D.target]=21;
    u.copyWithin(effect,dw,dw+V.DRAW_WORDS);u[effect+V.D.ps]=100;u[effect+V.D.target]=22;u[effect+V.D.tex]=21;
    u[finish+V.D.kind]=V.Kind.Blit;u[finish+V.D.blitSrc]=22;
    const chain=[],allocations=[];
    device.createTexture=desc=>{if(desc.label?.startsWith('VR effect'))allocations.push(desc.label);return create(desc);};
    for(const stereo of [true,false,true]){
      u[fw+V.F.seq]++;
      const output=device.createTexture({size:[128,96],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
      const command=device.createCommandEncoder();enc.encodeFrame(0,command,output,stereo?V.identity():undefined);
      const screen=enc.screen,read=device.createBuffer({size:512*screen.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      command.copyTextureToBuffer({texture:screen},{buffer:read,bytesPerRow:512},[screen.width,screen.height]);device.queue.submit([command.finish()]);enc.afterSubmit();
      await read.mapAsync(GPUMapMode.READ);const data=new Uint8Array(read.getMappedRange());let bad=0;
      if(stereo)for(let y=0;y<96;y++)for(let x=0;x<128;x++)if(data[y*512+x*4]!==x%2*255)bad++;
      chain.push({width:screen.width,height:screen.height,bad,originals:[enc.tex[21].w,enc.tex[22].w]});read.unmap();read.destroy();output.destroy();
    }
    enc.texFree(21);enc.texFree(22);
    await device.queue.onSubmittedWorkDone();device.destroy();return {samples,errors,logs,depths,made,chain,allocations};
  });
  if(result.skip){t.skip(result.skip);return;}
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.chain,[{width:128,height:96,bad:0,originals:[64,64]},{width:64,height:64,bad:0,originals:[64,64]},{width:128,height:96,bad:0,originals:[64,64]}]);
  assert.deepEqual(result.allocations,['VR effect t21','VR effect t22'],'stereo effect targets survive the desktop spectator without reallocating');
  assert.deepEqual(result.depths,[255,255,255,0],'resizing clears depth; consecutive passes retain occlusion');
  assert.equal(result.made.length,2,'alternating target sizes reuse depth allocations');
  assert.deepEqual(result.samples,[{width:32,height:48,direct:true,bad:0,cropBad:0},{width:128,height:96,direct:true,bad:0,cropBad:0},{width:128,height:96,direct:false,bad:0,cropBad:0},{width:64,height:64,direct:false,bad:0,cropBad:0}]);
});
