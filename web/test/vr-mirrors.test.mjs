import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/mirrors';export * from './src/vr/mirror-renderer';export * from './src/vr/drivers';export * from './src/vr/math';export * from './src/gpu/proto';export {Encoder} from './src/gpu/encoder';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'M',write:false})).outputFiles[0].text;
const M=(await import('node:vm')).runInNewContext(code+';M;');
const near=(a,b,epsilon=2e-5)=>a.forEach((v,k)=>assert.ok(Math.abs(v-b[k])<epsilon,`${a} != ${b}`));
test('mirror normals reflect the seated eye into rearward lanes; trim and comfort preserve stereo separation',()=>{
  for(const part of [0,1,2]){
    const m={center:[part===0?.1:part===1?-.5:1.1,.16,-.4],half:[.13,.04,.01]},angle={yaw:.12,pitch:-.04},v=[.1,.2,.3];
    near(M.mirrorRotate(M.mirrorRotate(v,angle),angle,true),v);
    const n=M.mirrorNormal(m,part,{yaw:0,pitch:0}),incoming=m.center.map(x=>x/Math.hypot(...m.center)),d=incoming.reduce((v,x,k)=>v+x*n[k],0),r=incoming.map((x,k)=>x-2*d*n[k]);
    const aim=[part===1?-.6:part===2?.6:0,0,1],length=Math.hypot(...aim);near(r,aim.map(x=>x/length));
    const virtual=M.mirrorVirtualEye([0,0,0],m,n);near(M.mirrorVirtualEye(virtual,m,n),[0,0,0]);
  }
  assert.equal(M.mirrorTrim(1,-1).yaw,.18);assert.equal(M.mirrorTrim(1,-1).pitch,-.105);
  const p=M.identity();p[10]=1.01;p[11]=1;p[14]=-.1;p[15]=0;
  const eyes=[];
  for(const x of [-.032,.032]){const view=M.identity();view[12]=-x-.6;view[13]=-.1;eyes.push(M.mirrorEye(M.multiply(p,view),[.6,.1,0],[0,.1,0]));}
  near([eyes[1][0]-eyes[0][0]],[.064]);near([(eyes[1][0]+eyes[0][0])/2,eyes[0][1]],[.2,.1]);
});
test('scene 5 bounds every mirror polygon and rejects malformed capture fields without losing driving telemetry',()=>{
  const b=new ArrayBuffer(16384),p=M.SCENE_OFFSET,u=new Uint32Array(b),f=new Float32Array(b),local=p+6352,at=p+6560;
  u.set([0x3152564e,1,0,5],p/4);f.set(M.identity(),(p+16)/4);f.set(M.identity(),(p+144)/4);u[(local+96)/4]=2;f.set(M.identity(),(local+16)/4);
  u.set([1,15,9,0],at/4);f.set(M.identity(),(at+16)/4);f.set(M.identity(),(at+80)/4);u.set([6,0,0],(at+144)/4);
  const read=()=>M.readDriverScene(b,0,b.byteLength);assert.equal(read().mirrors.glass[0].length,18);
  assert.equal(M.readDriverScene(b,0,M.SCENE_OFFSET+13631),null);
  for(const bad of [193,4,0xffffffff]){u[(at+144)/4]=bad;assert.ok(read().local);assert.equal(read().mirrors,undefined);}u[(at+144)/4]=6;
  f[(at+80+40)/4]=NaN;assert.equal(read().mirrors,undefined);f[(at+80+40)/4]=1;
  f[(at+160)/4]=Infinity;assert.equal(read().mirrors,undefined);
});
test('real GPU mirror samples reflected color with depth reprojection at one and four samples',async t=>{
  const server=createServer((_req,res)=>res.end('<!doctype html><body>Mirror test</body>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:code});
  const result=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {skip:'No WebGPU adapter'};
    const d=await adapter.requestDevice(),errors=[],colors=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const color=d.createTexture({size:[32,32],format:'bgra8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    const bytes=new Uint8Array(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=(y*32+x)*4;bytes.set(x<16?[0,0,255,255]:[255,0,0,255],i);}d.queue.writeTexture({texture:color},bytes,{bytesPerRow:128},[32,32]);
    const depth=d.createTexture({size:[32,32],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const clear=d.createCommandEncoder();clear.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'store'}}).end();d.queue.submit([clear.finish()]);
    const renderer=new M.MirrorRenderer(d);renderer.setSource(color,depth);
    const local={model:'350Z',matrix:M.identity()},base=M.cabinMatrix(local),fit=M.fitFor(local.model),v=M.identity(),rear=M.identity();v[5]=v[10]=-1;rear[0]=rear[5]=-1;rear[14]=2;
    const p=M.identity();p[0]=1;p[5]=-1;p[10]=1000/999.99;p[11]=1;p[14]=-.01*p[10];p[15]=0;
    const glass=new Float32Array([-.6,-.6,-1,.6,-.6,-1,.6,.6,-1,-.6,-.6,-1,.6,.6,-1,-.6,.6,-1]);for(let i=0;i<glass.length;i++)glass[i]-=[fit[1],-fit[2],fit[0]][i%3];
    const scene={cars:[],local,cockpit:true,view:M.multiply(v,M.inverse(base)),projection:p,mirrors:{active:true,target:15,zid:9,view:M.multiply(rear,M.inverse(base)),projection:p,glass:[glass,new Float32Array(),new Float32Array()]}};
    for(const samples of [1,4])for(const mode of [0,1,2]){
      v[12]=mode?-.3:0;scene.view=M.multiply(v,M.inverse(base));
      const dc=d.createCommandEncoder();dc.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:mode===2?p[10]+p[14]/4:1,depthStoreOp:'store'}}).end();d.queue.submit([dc.finish()]);
      const out=d.createTexture({size:[32,32],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),ms=samples===4?d.createTexture({size:[32,32],sampleCount:4,format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT}):null,z=d.createTexture({size:[32,32],sampleCount:samples,format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT}),enc=d.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:(ms??out).createView(),resolveTarget:ms?out.createView():undefined,loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}],depthStencilAttachment:{view:z.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'store'}});const count=renderer.draw(pass,scene,undefined,samples);pass.end();
      const read=d.createBuffer({size:32*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});enc.copyTextureToBuffer({texture:out},{buffer:read,bytesPerRow:256},[32,32]);d.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);const data=new Uint8Array(read.getMappedRange());colors.push({samples,mode,count,left:Array.from(data.slice(16*256+10*4,16*256+10*4+4)),right:Array.from(data.slice(16*256+22*4,16*256+22*4+4)),center:Array.from(data.slice(16*256+14*4,16*256+14*4+4))});read.unmap();read.destroy();out.destroy();ms?.destroy();z.destroy();
    }
    await d.queue.onSubmittedWorkDone();renderer.destroy();color.destroy();depth.destroy();d.destroy();return {errors,colors};
  });
  if(result.skip){t.skip(result.skip);return;}assert.deepEqual(result.errors,[]);for(const c of result.colors){assert.equal(c.count,1);if(!c.mode){assert.ok(c.left[0]>200 && c.left[2]<10,JSON.stringify(c));assert.ok(c.right[2]>200 && c.right[0]<10,JSON.stringify(c));}}
  for(const samples of [1,4]){const far=result.colors.find(c=>c.samples===samples&&c.mode===1),near=result.colors.find(c=>c.samples===samples&&c.mode===2);assert.ok(near.center[2]>far.center[2]+60,'4 m depth changes the reflected texel under head lean: '+JSON.stringify({far,near}));}
});

test('rear colour and retail depth are captured once for stereo; a missing world pass cannot expose stale mirrors',async t=>{
  const server=createServer((_req,res)=>{res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.end('<!doctype html><body>Rear capture test</body>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:code});
  const result=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {skip:'No WebGPU adapter'};
    const d=await adapter.requestDevice(),errors=[],logs=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const b=new SharedArrayBuffer(1<<20),u=new Uint32Array(b),f=new Float32Array(b),enc=new M.Encoder(d,{buffer:b},0,s=>logs.push(s));
    enc.texCreate(15,32,32,1,21,1);
    let cabins=0,source=null;const scene={cockpit:true,mirrors:{active:true,target:15,zid:9}};
    enc.drivers={updateScene:()=>scene,draw:()=>0,localActive:false,mirrors:{resolution:512,setSource:(c,z)=>source=c&&z?c:null},drawRear:()=>{cabins++;return 0;}};
    const fw=M.C.frame,dw=4096/4,tv=8192/4;
    u[fw+M.F.seq]=1;u[fw+M.F.dn]=2;u[fw+M.F.vn]=6;u[fw+M.F.kn]=16384;u[fw+M.F.draws]=dw*4;u[fw+M.F.tv]=tv*4;u[fw+M.F.k]=16384;u[fw+M.F.psc]=12288;u[fw+M.F.bbW]=64;u[fw+M.F.bbH]=64;
    for(let i=0;i<2;i++){
      const w=dw+i*M.DRAW_WORDS;u[w+M.D.first]=i*3;u[w+M.D.count]=3;u[w+M.D.cull]=1;u[w+M.D.blend]=15<<14;u[w+M.D.depth]=19|((i?1:9)<<8);u[w+M.D.target]=i?0:15;f[w+M.D.fogv+3]=1;
      if(!i)f.set([0,0,32,32,0,1],w+M.D.viewport);
      for(const [j,p]of [[-1,-1],[3,-1],[-1,3]].entries()){const at=tv+(i*3+j)*28;f.set([...p,.5,1],at);f.set(i?[0,0,1,1]:[1,0,0,1],at+4);}
    }
    const out=d.createTexture({size:[64,64],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
    const draw=async()=>{const c=d.createCommandEncoder(),s=enc.encodeFrame(0,c,out,M.identity());d.queue.submit([c.finish()]);await d.queue.onSubmittedWorkDone();return {draws:s.draws,cabins,source:!!source};};
    const first=await draw(),resolution=[enc.tex[15].tex.width,enc.zTex[9].width];
    // A second eye must keep the source even if the pending vertex buffer
    // differs; the next guest frame must actually capture that new colour.
    for(let j=0;j<3;j++)f.set([0,1,0,1],tv+j*28+4);
    const pixel=async()=>{const c=d.createCommandEncoder(),r=d.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});c.copyTextureToBuffer({texture:enc.tex[15].tex,origin:[256,256]},{buffer:r,bytesPerRow:256},[1,1]);d.queue.submit([c.finish()]);await r.mapAsync(GPUMapMode.READ);const p=Array.from(new Uint8Array(r.getMappedRange()).slice(0,4));r.unmap();r.destroy();return p;};
    const second=await draw(),shared=await pixel();u[fw+M.F.seq]=2;const third=await draw(),fresh=await pixel();
    u[fw+M.F.seq]=3;u[dw+M.D.count]=0;const missing=await draw();
    // A clear-only rear target is also insufficient evidence of a captured world.
    u[fw+M.F.seq]=4;u[dw+M.D.kind]=1;u[dw+M.D.clrFlags]=3;f[dw+M.D.clrZ]=1;const cleared=await draw();
    scene.cockpit=false;u[fw+M.F.seq]=5;await draw();const restored=[enc.tex[15].tex.width,enc.zTex[9].width];
    scene.cockpit=true;u[fw+M.F.seq]=6;await draw();enc.texCreate(15,64,32,1,21,1);u[fw+M.F.dn]=0;scene.cockpit=false;u[fw+M.F.seq]=7;await draw();const recycled=[enc.tex[15].tex.width,enc.tex[15].tex.height];
    d.destroy();return {first,second,third,missing,cleared,shared,fresh,resolution,restored,recycled,errors,logs};
  });
  if(result.skip){t.skip(result.skip);return;}
  assert.deepEqual(result.errors,[],JSON.stringify(result));assert.deepEqual(result.logs,[],JSON.stringify(result));
  assert.deepEqual(result.first,{draws:2,cabins:0,source:true});assert.deepEqual(result.second,{draws:1,cabins:0,source:true});assert.deepEqual(result.third,{draws:2,cabins:0,source:true});
  assert.equal(result.missing.source,false);assert.equal(result.cleared.source,false);assert.equal(result.cleared.cabins,0);
  assert.deepEqual(result.shared,[0,0,255,255]);assert.deepEqual(result.fresh,[0,255,0,255]);
  assert.deepEqual(result.resolution,[512,512]);assert.deepEqual(result.restored,[32,32]);assert.deepEqual(result.recycled,[64,32]);
});


test('mirror depth silhouettes cannot become phantom surfaces or fragment the reflected background',async t=>{
  const server=createServer((_req,res)=>res.end('<!doctype html><body>Mirror silhouettes</body>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:code});
  const result=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {skip:'No WebGPU adapter'};
    const d=await adapter.requestDevice(),errors=[],checks=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const color=d.createTexture({size:[16,16],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    const pixels=new Uint8Array(1024);for(let y=0;y<16;y++)for(let x=0;x<16;x++)pixels.set([x*16+8,y*16+8,0,255],4*(16*y+x));d.queue.writeTexture({texture:color},pixels,{bytesPerRow:64},[16,16]);
    const depth=d.createTexture({size:[16,16],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const module=d.createShaderModule({code:M.MIRROR_SHADER}),pipe=d.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:12,attributes:[{shaderLocation:0,format:'float32x3',offset:0}]}]},fragment:{module,entryPoint:'fs',targets:[{format:'bgra8unorm'}]}});
    const uniform=d.createBuffer({size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),vertices=d.createBuffer({size:36,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});d.queue.writeBuffer(vertices,0,new Float32Array([-.01,-.01,-.4,.03,-.01,-.4,-.01,.03,-.4]));
    const bind=d.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:color.createView()},{binding:2,resource:depth.createView()},{binding:3,resource:d.createSampler({minFilter:'linear',magFilter:'linear'})}]});
    const obstacle=d.createShaderModule({code:`@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {return vec4f(select(-1.,3.,i==1u),select(-1.,3.,i==2u),0.,1.);} @fragment fn fs()->@builtin(frag_depth) f32 {return 1.01-.25/.7;}`});
    const obstaclePipe=d.createRenderPipeline({layout:'auto',vertex:{module:obstacle,entryPoint:'vs'},fragment:{module:obstacle,entryPoint:'fs',targets:[]},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'always'}});
    for(const eye of [-.032,.032])for(const silhouette of [false,true]){
      const u=new Float32Array(48);u[0]=u[5]=100;u[14]=.25;u[15]=1;u[16]=u[21]=-1;u[26]=u[31]=1;u[32]=eye;u[38]=1;u.set([-.6,.04,-.8,1],40);u.set([.7,1.67,1.01,-.25],44);d.queue.writeBuffer(uniform,0,u);
      const out=d.createTexture({size:[16,16],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),read=d.createBuffer({size:16*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),enc=d.createCommandEncoder();
      const z=enc.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:1.01-.25/8,depthStoreOp:'store'}});
      // A nearby narrow post at 0.7 m has no intersection with these rays.
      // Their screen-space paths cross its silhouette farther behind it.
      if(silhouette){z.setPipeline(obstaclePipe);z.setScissorRect(6,0,1,16);z.draw(3);}z.end();
      const pass=enc.beginRenderPass({colorAttachments:[{view:out.createView(),loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipe);pass.setBindGroup(0,bind);pass.setVertexBuffer(0,vertices);pass.draw(3);pass.end();enc.copyTextureToBuffer({texture:out},{buffer:read,bytesPerRow:256},[16,16]);d.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);
      const bytes=new Uint8Array(read.getMappedRange());let wrong=0,maxError=0;
      for(let y=0;y<16;y++)for(let x=0;x<16;x++){
        const gx=((x+.5)/8-1)*.01,gy=(1-(y+.5)/8)*.01,t=(8-.4)/.4;
        const uv=[.5-.35*(gx+.6+t*(gx-eye))/8,.5-.835*(gy-.04+t*gy)/8],at=y*256+x*4;
        const error=Math.max(Math.abs(bytes[at+2]-uv[0]*256),Math.abs(bytes[at+1]-uv[1]*256));maxError=Math.max(maxError,error);if(error>2.5)wrong++;
      }
      checks.push({eye,silhouette,wrong,maxError});read.unmap();read.destroy();out.destroy();
    }
    await d.queue.onSubmittedWorkDone();d.destroy();return {errors,checks};
  });
  if(result.skip){t.skip(result.skip);return;}assert.deepEqual(result.errors,[]);for(const c of result.checks)assert.equal(c.wrong,0,JSON.stringify(c));
});
