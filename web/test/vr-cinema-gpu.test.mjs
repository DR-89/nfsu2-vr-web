import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';
const source=(await esbuild.build({stdin:{contents:`export * from './src/vr/cinema';export * from './src/vr/math';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'V',write:false})).outputFiles[0].text;
test('VR menu plane keeps image orientation, depth, stereo disparity and room around the screen',async t=>{
  const server=createServer((_req,res)=>res.end('<!doctype html><body>VR menu test</body>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:source});
  const result=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {skip:'No WebGPU adapter'};
    const device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const renderer=new V.CinemaRenderer(device),texture=device.createTexture({size:[2,2],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    device.queue.writeTexture({texture},new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),{bytesPerRow:8},[2,2]);
    const target=device.createTexture({size:[256,128],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),image=texture.createView();
    const projection=new Float32Array([1,0,0,0,0,1,0,0,0,0,-1.00001,-1,0,0,-.05,0]);
    const render=async x=>{
      const view=V.identity();view[12]=x;const ce=device.createCommandEncoder();renderer.draw(ce,image,target.createView(),projection,view,V.cinemaMatrix(2,1));
      const buffer=device.createBuffer({size:256*128*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});ce.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:1024},[256,128]);device.queue.submit([ce.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();buffer.destroy();
      const pixel=(x,y)=>{const at=(y*256+x)*4;return [bytes[at+2],bytes[at+1],bytes[at],bytes[at+3]];};
      let sum=0,count=0;for(let y=0;y<128;y++)for(let x=0;x<256;x++){const p=pixel(x,y);if(Math.max(...p.slice(0,3))>30){sum+=x;count++;}}
      return {corners:[pixel(0,0),pixel(255,127)],colours:[pixel(32,44),pixel(224,44),pixel(32,84)],center:sum/count,count};
    };
    const base=await render(0),left=await render(.032),right=await render(-.032),moved=await render(.6);
    await device.queue.onSubmittedWorkDone();renderer.destroy();texture.destroy();target.destroy();device.destroy();return {base,left,right,moved,errors};
  });
  if(result.skip){t.skip(result.skip);return;}
  assert.deepEqual(result.errors,[]);assert.ok(result.base.count>9000&&result.base.count<14000);
  for(const p of result.base.corners)assert.ok(Math.max(...p.slice(0,3))<6);
  const [red,green,blue]=result.base.colours;assert.ok(red[0]>240&&red[1]<10&&red[2]<10);assert.ok(green[1]>240&&green[0]<10);assert.ok(blue[2]>240&&blue[0]<10);
  assert.ok(result.left.center>result.right.center);assert.ok(result.moved.center>result.base.center+15);
});
