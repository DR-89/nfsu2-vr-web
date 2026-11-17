import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { pickBrowser } from '../tools/browser.mjs';

test('authored remote drivers render in mono/stereo and obey the world depth buffer', async t => {
  const js = (await esbuild.build({ stdin: { contents: `export * from './src/vr/driver-renderer'; export * from './src/vr/drivers'; export * from './src/vr/math'; export * from './src/vr/cockpit'; export * from './src/vr/settings'; export {wheel} from './src/vr/cabin-parts';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, format: 'iife', globalName: 'Drivers', write: false })).outputFiles[0].text;
  const server = createServer(async (req,res) => {
    res.setHeader('Cross-Origin-Opener-Policy','same-origin'); res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if (/^\/vr-(cabin|glove)\.(nvwm|png)$/.test(req.url)) {
      try { res.end(await readFile(new URL('../src/static'+req.url,import.meta.url))); } catch { res.writeHead(404).end(); }
    } else { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><body style="background:#080a0f;margin:0"><canvas width="640" height="480"></canvas>'); }
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r)); t.after(() => new Promise(r => server.close(r)));
  const browser = await chromium.launch({ ...pickBrowser(), headless:true, args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist'] }); t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:640,height:480}}); await page.goto(`http://127.0.0.1:${server.address().port}`); await page.addScriptTag({content:js});
  const result = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter(); if (!adapter) return {skip:'No WebGPU adapter'};
    const device = await adapter.requestDevice(), errors = [], logs = []; device.addEventListener('uncapturederror',e => errors.push(e.error.message));
    const b = new SharedArrayBuffer(8192), at = Drivers.SCENE_OFFSET, car = {matrix:Drivers.identity(),model:'PEUGOT'};
    new Uint32Array(b,at,4).set([0x3152564e,0,1,1]); new Uint32Array(b,at+208,2).set([17,123]);
    new Float32Array(b,at+224,16).set(car.matrix); new Uint8Array(b,at+288,6).set(new TextEncoder().encode('PEUGOT'));
    // See the full cabin from behind, through the missing outer body (tested separately in the game).
    const eye = [1.4,.7,-2.2], target = [.25,-.25,.2];
    const norm = a => {const n=Math.hypot(...a);return a.map(v=>v/n);}, cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const z=norm(eye.map((v,i)=>v-target[i])), x=norm(cross([0,1,0],z)), y=cross(z,x), local=Drivers.identity();
    local.set(x,0);local.set(y,4);local.set(z,8);local.set(eye,12);
    const camera = Drivers.multiply(Drivers.cabinMatrix(car),local);
    const view = Drivers.inverse(camera), near=.05, far=100, f=1.4;
    const projection = new Float32Array([f/1.333,0,0,0, 0,f,0,0, 0,0,far/(near-far),-1, 0,0,near*far/(near-far),0]);
    new Float32Array(b,at+16,16).set(projection); new Float32Array(b,at+144,16).set(view);
    const pose = {...Drivers.flatDriver(),car:123}, remotes = new Map([[17,{current:pose,previous:pose,at:performance.now(),before:performance.now(),seq:1}]]);
    const renderer = new Drivers.DriverRenderer(device,() => remotes,s => logs.push(s)); await renderer.ready;
    const color = device.createTexture({size:[640,480],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.TEXTURE_BINDING});
    const depth = device.createTexture({size:[640,480],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const pixels = device.createBuffer({size:640*480*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const draw = async (z,eye) => {
      if (remotes.has(17)) remotes.get(17).at = performance.now();
      const enc = device.createCommandEncoder(), pass = enc.beginRenderPass({colorAttachments:[{view:color.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:z,depthStoreOp:'store'}});
      const count = renderer.draw(pass,b,0,8192,eye,1); pass.end(); enc.copyTextureToBuffer({texture:color},{buffer:pixels,bytesPerRow:640*4},[640,480]); device.queue.submit([enc.finish()]);
      await pixels.mapAsync(GPUMapMode.READ); const data = new Uint8Array(pixels.getMappedRange()).slice(); pixels.unmap();
      let nonblack=0, sum=0; for (let i=0;i<data.length;i+=4) if(data[i]+data[i+1]+data[i+2]>0) {nonblack++;sum=(sum+data[i]*i+data[i+1]+data[i+2])>>>0;}
      return {count,nonblack,sum,data};
    };
    const mono = await draw(1), replaces=[renderer.replacesDriver(0,1),renderer.replacesDriver(0,2),renderer.replacesDriver(1,1)], covered = await draw(0), l = Drivers.identity(), r = Drivers.identity(); l[12]=.04;r[12]=-.04;
    const left = await draw(1,l), right = await draw(1,r);
    const splitScene=Drivers.readDriverScene(b,0,8192),secondView=new Float32Array(view);secondView[12]+=.2;
    splitScene.views=[{view,projection},{view:secondView,projection}];
    const splitDraw=async only=>{
      remotes.get(17).at=performance.now();
      const enc=device.createCommandEncoder(),pass=enc.beginRenderPass({colorAttachments:[{view:color.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'store'}});
      const counts=[];
      for(let slot=0;slot<2;slot++)if(only===undefined||only===slot){
        pass.setViewport(slot*320,0,320,480,0,1);pass.setScissorRect(slot*320,0,320,480);
        counts.push(renderer.draw(pass,b,0,8192,undefined,1,false,false,splitScene,slot));
      }
      pass.end();enc.copyTextureToBuffer({texture:color},{buffer:pixels,bytesPerRow:2560},[640,480]);device.queue.submit([enc.finish()]);
      await pixels.mapAsync(GPUMapMode.READ);const data=new Uint8Array(pixels.getMappedRange()).slice();pixels.unmap();return {counts,data};
    };
    const splitSingle=[await splitDraw(0),await splitDraw(1)],splitBoth=await splitDraw();let splitErrors=0;
    for(let y=0;y<480;y++)for(let x=0;x<640;x++)for(let c=0;c<4;c++){
      const i=(y*640+x)*4+c;if(splitBoth.data[i]!==splitSingle[x<320?0:1].data[i])splitErrors++;
    }
    const detail=Drivers.identity(),da=Math.PI/3;detail[5]=detail[10]=Math.cos(da);detail[6]=-Math.sin(da);detail[9]=Math.sin(da);detail[12]=.2;
    new Float32Array(b,at+144,16).set(Drivers.inverse(Drivers.multiply(Drivers.cabinMatrix(car),detail)));
    const rest={...pose,head:null,left:null,right:null,shifter:[0,0],pedals:[0,0,0]};
    remotes.set(17,{current:rest,previous:rest,at:performance.now(),before:performance.now(),seq:2});
    const stillParts=await draw(1);replaces.push(renderer.replacesDriver(0,1));const animated={...rest,shifter:[.045,-.06],pedals:[1,1,1]};
    remotes.set(17,{current:animated,previous:animated,at:performance.now(),before:performance.now(),seq:2});
    const movingParts=await draw(1);
    let movingPixels=0;for(let i=0;i<stillParts.data.length;i+=4)if(Math.abs(stillParts.data[i]-movingParts.data[i])+Math.abs(stillParts.data[i+1]-movingParts.data[i+1])+Math.abs(stillParts.data[i+2]-movingParts.data[i+2])>10)movingPixels++;
    const handCamera=Drivers.identity();handCamera.set([0,.19,.55],12);
    new Float32Array(b,at+144,16).set(Drivers.inverse(Drivers.multiply(Drivers.cabinMatrix(car),handCamera)));
    const handPose={...rest,left:{p:[-.13,.10,0],q:[Math.SQRT1_2,0,0,Math.SQRT1_2]},right:{p:[.13,.10,0],q:[Math.SQRT1_2,0,0,Math.SQRT1_2]}};
    const handFrames=[],sheet=document.createElement('canvas');sheet.width=1920;sheet.height=480;const sg=sheet.getContext('2d');
    for(const [index,fingers] of [[0,0,0,0],[1,0,1,0],[1,1,1,1]].entries()){
      const current={...handPose,fingers};remotes.set(17,{current,previous:current,at:performance.now(),before:performance.now(),seq:3});
      const frame=await draw(1);handFrames.push(frame);const rgba=frame.data.slice();
      for(let i=0;i<rgba.length;i+=4)[rgba[i],rgba[i+2]]=[rgba[i+2],rgba[i]];
      sg.putImageData(new ImageData(new Uint8ClampedArray(rgba),640,480),index*640,0);
      sg.fillStyle='white';sg.font='24px sans-serif';sg.fillText(['Open','Grip','Point'][index],index*640+24,36);
    }
    const difference=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>10)n++;return n;};
    const handPixels=[difference(handFrames[0].data,handFrames[1].data),difference(handFrames[1].data,handFrames[2].data),difference(handFrames[0].data,handFrames[2].data)];
    remotes.get(17).current={...handPose,left:null};const lostHand=await draw(1);
    new Float32Array(b,at+144,16).set(view);
    const flat = document.querySelector('canvas').getContext('2d'), rgba=mono.data;
    for(let i=0;i<rgba.length;i+=4) [rgba[i],rgba[i+2]]=[rgba[i+2],rgba[i]];
    flat.putImageData(new ImageData(new Uint8ClampedArray(rgba),640,480),0,0);
    remotes.clear(); const privatePose = await draw(1);replaces.push(renderer.replacesDriver(0,1));
    // The real local display must survive the cabin depth test and blend with
    // the already rendered cockpit when its profile opacity changes.
    const localBuffer=new SharedArrayBuffer(12288),lp=at+6352;
    new Uint32Array(localBuffer,at,4).set([0x3152564e,0,0,2]);
    const lpj=new Float32Array([.69,0,0,0,0,1.05,0,0,0,0,100/(.03-100),-1,0,0,.03*100/(.03-100),0]);
    new Float32Array(localBuffer,at+16,16).set(lpj);
    new Float32Array(localBuffer,at+144,16).set(Drivers.inverse(Drivers.cabinMatrix(car)));
    new Float32Array(localBuffer,lp+16,16).set(car.matrix);
    new Uint8Array(localBuffer,lp+80,6).set(new TextEncoder().encode('PEUGOT'));
    new Uint32Array(localBuffer,lp+96,1)[0]=2;
    new Float32Array(localBuffer,lp+144,6).set([12,3200,.6,.2,3,.016]);
    new Float64Array(localBuffer,lp+168,1)[0]=1000;
    const cockpit=new Drivers.Cockpit(Drivers.vrSettings({NFSU2_VR_SCREEN_PAGE:'1'}),null),localRenderer=new Drivers.DriverRenderer(device,()=>new Map(),()=>{},cockpit);
    await localRenderer.ready;
    const localMs=device.createTexture({size:[640,480],sampleCount:4,format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const localZ4=device.createTexture({size:[640,480],sampleCount:4,format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const localDraw=async (opacity,mode='both',eye=undefined,samples=1)=>{
      cockpit.settings.opacity=opacity;
      const ce=device.createCommandEncoder(),p=ce.beginRenderPass({colorAttachments:[{view:(samples===4?localMs:color).createView(),resolveTarget:samples===4?color.createView():undefined,loadOp:'clear',storeOp:'store',clearValue:[.1,.2,.3,1]}],depthStencilAttachment:{view:(samples===4?localZ4:depth).createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'store'}});
      let count=0;
      if(mode==='wheel'){
        const mesh=localRenderer.cabin;p.setPipeline(localRenderer.pipeline(samples));p.setBindGroup(0,mesh.bind,[64*256]);p.setVertexBuffer(0,mesh.vertices);p.setIndexBuffer(mesh.indices,'uint32');p.drawIndexed(Drivers.wheel.indexCount,1,Drivers.wheel.indexFirst);count=1;
      }else{
        if(mode!=='screen')count+=localRenderer.draw(p,localBuffer,0,12288,eye,samples,true);
        count+=localRenderer.drawScreen(p,eye,samples);
      }
      p.end();
      ce.copyTextureToBuffer({texture:color},{buffer:pixels,bytesPerRow:2560},[640,480]);device.queue.submit([ce.finish()]);await pixels.mapAsync(GPUMapMode.READ);
      const data=new Uint8Array(pixels.getMappedRange()).slice();pixels.unmap();return {count,data};
    };
    const hidden=await localDraw(0),shown=await localDraw(1),faded=await localDraw(.35);
    let screenPixels=0,alphaPixels=0;for(let i=0;i<shown.data.length;i+=4){if(Math.abs(shown.data[i]-hidden.data[i])+Math.abs(shown.data[i+1]-hidden.data[i+1])+Math.abs(shown.data[i+2]-hidden.data[i+2])>10)screenPixels++;if(faded.data[i]!==shown.data[i]&&faded.data[i]!==hidden.data[i])alphaPixels++;}
    // Move the real panel across the authored wheel. Compare overlapping
    // wheel pixels with screen-only and cabin-only renders, including alpha
    // and both optical eyes. A draw-order overlay fails the front cases.
    const savedScreen={...cockpit.settings},savedPaint=cockpit.paint;
    cockpit.paint=()=>{const ctx=cockpit.canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,1024,640);return true;};
    cockpit.settings.shiftGuide=0;cockpit.settings.pitch=-Math.atan(-.4*Drivers.fitFor(car.model)[5]);cockpit.settings.yaw=0;
    const neutral=Drivers.screenMount(car.model,cockpit.settings),occlusion=[];
    cockpit.settings.screenScale=.42/neutral.width;
    for(const samples of [1,4])for(const shift of [-.03,.03])for(const distance of [.18,.65]){
      cockpit.settings.screenX=-neutral.matrix[12];
      cockpit.settings.screenY=Drivers.wheel.pivot[1]*distance/-Drivers.wheel.pivot[2]-neutral.matrix[13];
      cockpit.settings.screenZ=-distance-neutral.matrix[14];
      const eye=Drivers.identity();eye[12]=shift;
      const off=await localDraw(0,'both',eye,samples),rim=await localDraw(0,'wheel',eye,samples),screen=await localDraw(1,'screen',eye,samples);
      const full=await localDraw(1,'both',eye,samples),half=await localDraw(.35,'both',eye,samples);
      let overlap=0,wrong=0;
      for(let i=0;i<full.data.length;i+=4){
        if(screen.data[i+2]<254 || screen.data[i]>1 || screen.data[i+1]>1)continue;
        if(Math.abs(rim.data[i]-77)+Math.abs(rim.data[i+1]-51)+Math.abs(rim.data[i+2]-26)<8)continue;
        overlap++;
        for(let c=0;c<3;c++){
          const want=distance<.3?screen.data[i+c]:off.data[i+c];
          const mixed=distance<.3?Math.round(.35*screen.data[i+c]+.65*off.data[i+c]):off.data[i+c];
          if(Math.abs(full.data[i+c]-want)>2 || Math.abs(half.data[i+c]-mixed)>2){wrong++;break;}
        }
      }
      occlusion.push({samples,shift,distance,overlap,wrong});
    }
    Object.assign(cockpit.settings,savedScreen);cockpit.paint=savedPaint;
    const down=Drivers.identity(),a=Math.PI/3;down[5]=down[10]=Math.cos(a);down[6]=-Math.sin(a);down[9]=Math.sin(a);down[12]=.2;
    new Float32Array(localBuffer,at+144,16).set(Drivers.inverse(Drivers.multiply(Drivers.cabinMatrix(car),down)));
    new Uint32Array(localBuffer,lp+12,1)[0]=(1<<8)|6|8|16;
    cockpit.settings.shiftGuide=0;const noGuide=await localDraw(1);
    cockpit.settings.shiftGuide=1;const guide=await localDraw(1);
    let guidePixels=0;for(let i=0;i<guide.data.length;i+=4)if(Math.abs(noGuide.data[i]-guide.data[i])+Math.abs(noGuide.data[i+1]-guide.data[i+1])+Math.abs(noGuide.data[i+2]-guide.data[i+2])>20)guidePixels++;
    localMs.destroy();localZ4.destroy();localRenderer.destroy();cockpit.destroy();
    renderer.destroy(); color.destroy(); depth.destroy(); pixels.destroy(); await device.queue.onSubmittedWorkDone(); device.destroy();
    return {occlusion,replaces,splitErrors,splitCounts:splitBoth.counts,handPixels,handCounts:handFrames.map(f=>f.count),lostHandCount:lostHand.count,handImage:sheet.toDataURL(),screenPixels,alphaPixels,movingPixels,guidePixels,guideCount:guide.count,screenCount:shown.count,mono:{count:mono.count,nonblack:mono.nonblack},covered:covered.nonblack,left:left.sum,right:right.sum,privateCount:privatePose.count,errors,logs};
  });
  if(result.skip) {t.skip(result.skip);return;}
  const out = new URL('../../out/vr-checks/',import.meta.url); await mkdir(out,{recursive:true});
  await writeFile(new URL('hand-poses.png',out),Buffer.from(result.handImage.split(',')[1],'base64'));delete result.handImage;
  for(const c of result.occlusion){assert.ok(c.overlap>300,JSON.stringify(c));assert.equal(c.wrong,0,JSON.stringify(c));}
  assert.deepEqual(result.handCounts,[3,3,3]);assert.equal(result.lostHandCount,2);assert.ok(result.handPixels.every(n=>n>500),JSON.stringify(result));
  assert.deepEqual(result.replaces,[true,false,false,false,false]);assert.deepEqual(result.errors,[]); assert.equal(result.screenCount,3); assert.ok(result.screenPixels>1000,JSON.stringify(result)); assert.ok(result.alphaPixels>500,JSON.stringify(result)); assert.equal(result.mono.count,4,JSON.stringify(result.logs)); assert.ok(result.mono.nonblack>2000);
  assert.equal(result.splitErrors,0,'two cameras in one submit must match separate renders');assert.deepEqual(result.splitCounts,[4,4]);
  assert.equal(result.covered,0); assert.notEqual(result.left,result.right); assert.equal(result.privateCount,1);
  assert.ok(result.movingPixels>25,JSON.stringify(result));assert.equal(result.guideCount,4);assert.ok(result.guidePixels>50,JSON.stringify(result));
  await page.screenshot({path:fileURLToPath(new URL('remote-cabin.png',out))});
});
