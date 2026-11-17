import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { pickBrowser } from '../tools/browser.mjs';

test('WebGPU eye canvases reach distinct WebXR/WebGL viewports without a CPU readback', async t => {
  const js = (await esbuild.build({ stdin:{contents:"export * from './src/vr/webgl-bridge';export * from './src/vr/reprojection';",loader:'ts',resolveDir:fileURLToPath(new URL('..',import.meta.url))}, bundle: true,
    format: 'iife', globalName: 'VRBridge', write: false })).outputFiles[0].text;
  const server = createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>VR bridge test</title>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const browser = await chromium.launch({ ...pickBrowser(), headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ content: js });
  const result = await page.evaluate(async () => {
    // Only the XR hardware is replaced. Both graphics contexts, the canvas
    // import, texture upload, draw and framebuffer pixels are real browser GPU calls.
    // The context option also selects an XR adapter. Mock it along with
    // makeXRCompatible so a headset-free test cannot switch the real GPU device.
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, options) {
      return getContext.call(this, type, type === 'webgl2' ? { ...options, xrCompatible: false } : options);
    };
    let preparations = 0;
    WebGL2RenderingContext.prototype.makeXRCompatible = async function () { preparations++; };
    let layer;
    globalThis.XRWebGLLayer = class {
      constructor(_, gl, options) {
        this.scale=options.framebufferScaleFactor;
        this.gl = gl; this.framebuffer = gl.createFramebuffer();
        this.color = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.color);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 16, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color, 0);
        layer = this;
      }
      getViewport(view) { return { x: view.eye === 'left' ? 0 : 8, y: 0, width: 8, height: 8 }; }
    };
    const session = { updateRenderState() {}, addEventListener() {} };
    const prepared = await VRBridge.WebGLXRBridge.prepare(session);
    let device, graphics;
    try {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return { skip: 'Browser has no WebGPU adapter' };
      // Headless WSL's software adapter loses Dawn during cross-API import.
      // The hardware acceptance run uses Windows Chrome and must not skip.
      if (adapter.info.isFallbackAdapter) return { skip: 'Software GPU adapter: run GPU interop acceptance in desktop Chrome with a hardware adapter' };
      graphics = `${adapter.info.vendor} ${adapter.info.architecture}`;
      device = await adapter.requestDevice();
    } catch (error) { return { skip: `Browser cannot create a WebGPU device: ${error}` }; }
    const errors = [];
    device.addEventListener('uncapturederror', e => errors.push(e.error.message));
    let bridge;
    try { bridge = await VRBridge.WebGLXRBridge.create(session, device, .75); }
    catch (error) { throw new Error(`Creating XR bridge: ${error}`); }
    const gl=layer.gl,images=gl.texImage2D.bind(gl),updates=gl.texSubImage2D.bind(gl),query=gl.getParameter.bind(gl);
    let allocations=0,subImages=0,limitQueries=0;
    gl.texImage2D=(...args)=>{allocations++;return images(...args);};
    gl.texSubImage2D=(...args)=>{subImages++;return updates(...args);};
    gl.getParameter=(name)=>{if(name===gl.MAX_TEXTURE_SIZE)limitQueries++;return query(name);};
    let copies=0;
    for (const [index, eye, color] of [[0, 'left', [1,0,0,1]], [1, 'right', [0,0,1,1]]]) {
      try { bridge.present(index, { eye }, null, (_, view) => {
        copies++;
        const enc = device.createCommandEncoder();
        enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: color }] }).end();
        device.queue.submit([enc.finish()]);
      },1); } catch (error) { throw new Error(`Presenting eye ${eye}: ${error}`); }
    }
    // A fresh XR framebuffer still needs both eye draws, but unchanged game
    // images must not be copied/imported again while the GPU is behind.
    gl.clearColor(0,1,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
    for(const [i,eye] of ['left','right'].entries())bridge.present(i,{eye},null,()=>{throw Error('stale image copied');},1);
    const pixels = new Uint8Array(16 * 8 * 4);
    gl.readPixels(0, 0, 16, 8, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const at = x => [...pixels.slice((4 * 16 + x) * 4, (4 * 16 + x) * 4 + 4)];
    const result = { left: at(4), right: at(12), scale:layer.scale,viewport:bridge.viewport({eye:'right'}),error: gl.getError(), errors,
      preparations, reusedContext: prepared === gl, graphics, copies };
    const shader=device.createShaderModule({code:`
      @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
        return vec4f(vec2f(f32((i<<1u)&2u),f32(i&2u))*2.-1.,0.,1.);
      }
      @fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {
        return select(vec4f(1.,0.,0.,1.),vec4f(0.,0.,1.,1.),p.x>=8.)+vec4f(0.,select(0.,1.,p.y>=4.),0.,0.);
      }`});
    const pipe=device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format:bridge.format}]}});
    let stereoCopies=0;
    const views=[{eye:'left'},{eye:'right'}];
    result.stereo=bridge.presentStereo(views,2,(target,rects)=>{
      stereoCopies++;result.rects=rects;
      const ce=device.createCommandEncoder(),pass=ce.beginRenderPass({colorAttachments:[{view:target,loadOp:'clear',storeOp:'store'}]});
      pass.setPipeline(pipe);pass.draw(3);pass.end();device.queue.submit([ce.finish()]);
    });
    gl.clear(gl.COLOR_BUFFER_BIT);
    bridge.presentStereo(views,2,()=>{throw Error('stale stereo image copied');});
    gl.readPixels(0,0,16,8,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    result.stereoLeft=at(4);result.stereoRight=at(12);result.stereoCopies=stereoCopies;
    result.bottom=[...pixels.slice((16+4)*4,(16+4)*4+4)];
    // A fresh frame of the same size updates storage and preserves orientation.
    bridge.presentStereo(views,3,target=>{
      const ce=device.createCommandEncoder(),pass=ce.beginRenderPass({colorAttachments:[{view:target,loadOp:'clear',storeOp:'store'}]});
      pass.setPipeline(pipe);pass.draw(3);pass.end();device.queue.submit([ce.finish()]);
    });
    const warp=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,-1,0,1]);
    bridge.presentStereo(views,3,()=>{throw Error('rotation must not import the cached eyes again');},[warp,warp]);
    gl.readPixels(0,0,16,8,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    result.warpedLeft=at(4);result.warpedRight=at(12);result.outside=[...pixels.slice((16+4)*4,(16+4)*4+4)];
    layer.getViewport=view=>({x:view.eye==='left'?0:8,y:0,width:view.eye==='left'?8:4,height:view.eye==='left'?8:4});
    result.asymmetric=bridge.presentStereo(views,2,(target,rects)=>{
      result.asymmetricRects=rects;
      const ce=device.createCommandEncoder(),p=ce.beginRenderPass({colorAttachments:[{view:target,loadOp:'clear',storeOp:'store'}]});
      p.setPipeline(pipe);p.draw(3);p.end();device.queue.submit([ce.finish()]);
    });
    gl.readPixels(0,0,16,8,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    result.shortEye=[...pixels.slice((16+10)*4,(16+10)*4+4)];
    // Redistributing the eye widths keeps the total canvas size but requires a
    // new copy layout, even if no new game frame has arrived.
    layer.getViewport=view=>({x:view.eye==='left'?0:4,y:0,width:view.eye==='left'?4:8,height:view.eye==='left'?8:4});
    bridge.presentStereo(views,2,(target)=>{
      result.layoutCopied=true;
      const ce=device.createCommandEncoder();ce.beginRenderPass({colorAttachments:[{view:target,loadOp:'clear',storeOp:'store',clearValue:[0,1,0,1]}]}).end();device.queue.submit([ce.finish()]);
    });
    layer.getViewport=()=>({x:0,y:0,width:device.limits.maxTextureDimension2D,height:8});
    result.oversized=bridge.presentStereo(views,3,()=>{throw Error('oversized atlas allocated');});
    result.allocations=allocations;result.subImages=subImages;result.limitQueries=limitQueries;
    // Direct WebGPU presentation must use the same ray mapping and separate
    // per-eye uniforms when both draws are submitted together.
    const src=device.createTexture({size:[8,8],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    const data=new Uint8Array(8*8*4);for(let y=0;y<8;y++)for(let x=0;x<8;x++)data.set(y<4?[255,0,0,255]:[255,255,0,255],(y*8+x)*4);
    device.queue.writeTexture({texture:src},data,{bytesPerRow:32},[8,8]);
    const presenter=new VRBridge.EyePresenter(device),identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    const targets=[0,1].map(()=>device.createTexture({size:[8,8],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}));
    const read=device.createBuffer({size:4096,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),ce=device.createCommandEncoder(),source=src.createView();
    for(let i=0;i<2;i++){
      presenter.draw(ce,i,source,targets[i].createView(),'rgba8unorm',{x:0,y:0,width:8,height:8},i?warp:identity);
      ce.copyTextureToBuffer({texture:targets[i]},{buffer:read,offset:i*2048,bytesPerRow:256},[8,8]);
    }
    device.queue.submit([ce.finish()]);await read.mapAsync(GPUMapMode.READ);const direct=new Uint8Array(read.getMappedRange());
    result.direct=[...direct.slice(3*256+4*4,3*256+4*4+4)];result.directWarp=[...direct.slice(2048+3*256+4*4,2048+3*256+4*4+4)];
    read.unmap();read.destroy();presenter.destroy();src.destroy();targets.forEach(t=>t.destroy());
    try { await device.queue.onSubmittedWorkDone(); } catch (error) { throw new Error(`Waiting for GPU: ${error}`); }
    bridge.destroy(); device.destroy(); return result;
  });
  if (result.skip) { t.skip(result.skip); return; }
  t.diagnostic(`graphics: ${result.graphics}`);
  assert.equal(result.error, 0); assert.deepEqual(result.errors, []);
  assert.equal(result.preparations, 1); assert.equal(result.reusedContext, true);
  assert.equal(result.copies,2);
  assert.equal(result.scale,.75);assert.deepEqual(result.viewport,{x:8,y:0,width:8,height:8});
  assert.deepEqual(result.left, [255,0,0,255]); assert.deepEqual(result.right, [0,0,255,255]);
  assert.equal(result.stereo,true);assert.equal(result.stereoCopies,1);
  assert.deepEqual(result.rects,[[0,0,8,8],[8,0,8,8]]);
  assert.deepEqual(result.stereoLeft,[255,0,0,255]);assert.deepEqual(result.stereoRight,[0,0,255,255]);
  assert.deepEqual(result.bottom,[255,255,0,255],'atlas import retains vertical orientation');
  assert.deepEqual(result.warpedLeft,[255,255,0,255]);assert.deepEqual(result.warpedRight,[0,255,255,255]);assert.deepEqual(result.outside,[0,0,0,255]);
  assert.equal(result.asymmetric,true);assert.deepEqual(result.asymmetricRects,[[0,0,8,8],[8,0,4,4]]);
  assert.deepEqual(result.shortEye,[0,0,255,255],'a shorter eye samples its populated atlas rows');
  assert.equal(result.layoutCopied,true);assert.equal(result.oversized,false);
  assert.equal(result.allocations,4,'two eyes and two atlas sizes allocate once each');
  assert.equal(result.subImages,2,'fresh frames and same-size layout changes retain storage');
  assert.equal(result.limitQueries,0,'limits are queried only at bridge creation');
  assert.deepEqual(result.direct,[255,0,0,255]);assert.deepEqual(result.directWarp,[255,255,0,255]);
});
