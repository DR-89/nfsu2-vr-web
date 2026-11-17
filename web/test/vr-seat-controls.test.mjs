import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';
import {writeFile} from 'node:fs/promises';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/seat-controls';export * from './src/vr/seat-renderer';export * from './src/vr/cockpit';export * from './src/vr/settings';export * from './src/vr/math';export * from './src/vr/drivers';export * from './src/vr/glove-tip';export * from './src/vr/fit';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const scene=model=>({projection:V.identity(),view:V.identity(),cars:[],local:{vip:0,peer:0,model,matrix:V.identity(),steer:0},cockpit:true,telemetry:{time:1,speed:0,rpm:900,throttle:0,brake:0,gear:2,dt:.016},gearbox:{epoch:1,manual:true,ready:true,count:6}});
const onPanel=(m,u,v,depth)=>[0,1,2].map(k=>m.matrix[12+k]+m.matrix[k]*(u-.5)*m.width+m.matrix[4+k]*(.5-v)*m.height+m.matrix[8+k]*depth);
const buttonPoint=(m,button,depth)=>{const [x,y]=V.seatButtons[button];return onPanel(m,x/V.seatLayout.width,y/V.seatLayout.height,depth);};
function rig(model='350Z',side=0,env={}){
  const saves=[],s=V.vrSettings(env),c=new V.Cockpit(s,null,x=>saves.push(x)),m=V.seatMount(model),hands=[null,null];c.update(scene(model));
  const sources=[0,1].map(()=>({gamepad:{buttons:Array.from({length:6},()=>({value:0})),axes:[0,0,0,0]}}));
  const h={matrix:V.identity(),source:sources[side]};hands[side]=h;let time=0;
  const move=(button,depth)=>{
    const tip=buttonPoint(m,button,depth),axes=V.gloveAxes(side);
    for(let k=0;k<3;k++)h.matrix[12+k]=tip[k]-V.gloveTip.reduce((v,x,j)=>v+axes[j*4+k]*x,0);
    c.track({time:time+=16,hands,sources});
  };
  return {s,c,h,hands,sources,m,saves,move};
}
test('seat icons and touch targets follow the flat door armrest on both drive sides',()=>{
  for(const model of ['350Z','PEUGOT','A3','SKYLINE','HUMMER']){
    const f=V.fitFor(model),m=V.seatMount(model);assert.ok(m.width>0);assert.equal(Math.sign(m.matrix[12]),-Math.sign(f[6]));
    for(let i=0;i<4;i++){
      const contact=V.seatContact(model,buttonPoint(m,i,.003));
      assert.equal(V.seatButton(contact),i);assert.ok(Math.abs(contact[2]-.003)<1e-6);
      const [x,y]=V.seatButtons[i];
      assert.equal(V.seatButton(V.seatContact(model,onPanel(m,(x+108)/V.seatLayout.width,y/V.seatLayout.height,.003))),i,'generous target outside the visible ring');
      assert.equal(V.seatButton(V.seatContact(model,buttonPoint(m,i,.10))),-1,'distant fingers do not highlight');
    }
    for(const [u,v] of [[.5,.25],[.5,.5],[.5,.75],[1.1,.5]])assert.equal(V.seatButton(V.seatContact(model,onPanel(m,u,v,.003))),-1,'gaps do not trigger neighbours');
    const front=buttonPoint(m,0,0),rear=buttonPoint(m,3,0);
    assert.equal(front[0],rear[0]);assert.equal(front[1],rear[1]);assert.ok(front[2]<rear[2],'the row runs front to back along the armrest');
    const above=V.seatContact(model,[front[0],front[1]+.04,front[2]]);
    assert.equal(V.seatButton(above),0);assert.ok(Math.abs(above[2]-.04)<1e-6,'touch approaches from above the door handle');
  }
});
test('either index finger moves the personal seat once per tap; holds, slides and tracking entry do not repeat',()=>{
  for(const model of ['350Z','A3','SKYLINE'])for(const side of [0,1]){
    const r=rig(model,side);r.move(0,.003);assert.equal(r.saves.length,0);
    for(let button=0;button<4;button++){
      r.move(button,.04);assert.equal(r.c.seatHover,1<<button);assert.equal(r.c.fingers[side*2+1],1);
      r.h.source.gamepad.buttons[0].value=1;r.move(button,.003);assert.equal(side?r.c.controls.throttle:r.c.controls.brake,1);
      assert.equal(r.saves.length,button+1);r.move(button,.003);r.move((button+1)%4,.003);assert.equal(r.saves.length,button+1);
    }
    assert.equal(r.s.height,0);assert.equal(r.s.forward,0);assert.deepEqual(r.saves,[{vr_seat_forward:'1'},{vr_seat_forward:'0'},{vr_seat_height:'1'},{vr_seat_height:'0'}]);
    r.c.track(null);assert.equal(r.c.seatHover,0);r.move(0,.003);assert.equal(r.saves.length,4);
  }
});
test('seat taps and both pedals stay independent in either order, including repeated taps with held pedals',()=>{
  for(const model of ['350Z','SKYLINE'])for(const side of [0,1])for(const pedalFirst of [false,true]){
    const r=rig(model,side);
    const pedals=(brake,throttle)=>{r.sources[0].gamepad.buttons[0].value=brake;r.sources[1].gamepad.buttons[0].value=throttle;};
    const move=(button,depth)=>{
      r.move(button,depth);
      assert.equal(r.c.controls.brake,r.sources[0].gamepad.buttons[0].value,'seat contact preserves brake pressure');
      assert.equal(r.c.controls.throttle,r.sources[1].gamepad.buttons[0].value,'seat contact preserves accelerator pressure');
    };
    move(0,.12);
    if(pedalFirst){pedals(.6,.8);move(0,.12);}
    for(let button=0;button<4;button++){
      move(button,.04);assert.equal(r.c.seatHover,1<<button);
      move(button,.003);assert.equal(r.saves.length,button+1,'one seat step per physical tap');
      for(const [brake,throttle] of [[1,.75],[.2,.4],[0,0],[.8,.6]]){
        pedals(brake,throttle);move(button,.003);
        assert.equal(r.saves.length,button+1,'pressing, releasing and reapplying pedals cannot repeat a seat tap');
      }
      move((button+1)%4,.003);assert.equal(r.saves.length,button+1,'sliding to a neighbour cannot repeat a seat tap');
    }
    assert.deepEqual(r.saves,[{vr_seat_forward:'1'},{vr_seat_forward:'0'},{vr_seat_height:'1'},{vr_seat_height:'0'}]);
  }
});
test('seat stops match native limits and do not write repeated unchanged values',()=>{
  const r=rig('350Z',0,{NFSU2_VR_SEAT_HEIGHT:'34',NFSU2_VR_SEAT_FORWARD:'39'});
  for(const button of [0,0,2,2]){r.move(button,.04);r.move(button,.003);}
  assert.equal(r.s.forward,.4);assert.equal(r.s.height,.35);assert.equal(r.saves.length,2);
  const low=rig('350Z',0,{NFSU2_VR_SEAT_HEIGHT:'-34',NFSU2_VR_SEAT_FORWARD:'-39'});
  for(const button of [1,1,3,3]){low.move(button,.04);low.move(button,.003);}
  assert.equal(low.s.forward,-.4);assert.equal(low.s.height,-.35);assert.equal(low.saves.length,2);
});
test('a fingertip on the armrest cannot operate while that hand holds a wheel, mirror or panel',()=>{
  for(const kind of ['wheel','mirrorGrip','screenGrip','mapGrip']){
    const r=rig('350Z',0,kind==='wheel'?{NFSU2_VR_WHEEL_GRIP:'1'}:{});r.move(0,.04);
    if(kind==='wheel'){r.c.wheel.grabbed[0]=true;r.h.source.gamepad.buttons[1].value=1;}
    else {r.c[kind].hand=0;r.c[kind].update=()=>false;}
    r.move(0,.003);assert.equal(r.saves.length,0,kind);assert.equal(r.c.seatHover,0,kind);
  }
});
test('physical seat buttons render and highlight through real GPU depth at one and four samples',async t=>{
  const server=createServer((req,res)=>res.end('<!doctype html>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true,args:['--enable-unsafe-webgpu']});t.after(()=>browser.close());const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({content:(await esbuild.transform(code,{format:'iife',globalName:'S'})).code});
  if(process.env.NFSU2_SEAT_CONTROLS_SCREENSHOT){
    const png=await page.evaluate(()=>{const canvas=new S.SeatCanvas();canvas.paint(0);return canvas.canvas.toDataURL().split(',')[1];});
    await writeFile(process.env.NFSU2_SEAT_CONTROLS_SCREENSHOT,Buffer.from(png,'base64'));
  }
  const result=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {skip:'No WebGPU adapter'};
    const d=await adapter.requestDevice(),errors=[],pictures=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));const renderer=new S.SeatRenderer(d);
    const car={model:'350Z',matrix:S.identity()},projection=S.identity(),mount=S.seatMount(car.model);projection[0]=1.8/mount.width;projection[5]=1.8/mount.height;projection[10]=0;projection[14]=.5;
    const scene={cars:[],local:car,cockpit:true,projection,view:S.inverse(S.multiply(S.cabinMatrix(car),S.seatMount(car.model).matrix))};
    for(const samples of [1,4])for(const mode of [0,1,2]){
      const color=d.createTexture({size:[128,128],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),ms=samples===4?d.createTexture({size:[128,128],sampleCount:4,format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT}):null,z=d.createTexture({size:[128,128],sampleCount:samples,format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT}),enc=d.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:(ms??color).createView(),resolveTarget:ms?color.createView():undefined,loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}],depthStencilAttachment:{view:z.createView(),depthLoadOp:'clear',depthClearValue:mode===2?0:1,depthStoreOp:'store'}});renderer.draw(pass,scene,undefined,samples,mode===1?15:0);pass.end();
      const b=d.createBuffer({size:128*512,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});enc.copyTextureToBuffer({texture:color},{buffer:b,bytesPerRow:512},[128,128]);d.queue.submit([enc.finish()]);await b.mapAsync(GPUMapMode.READ);const a=new Uint8Array(b.getMappedRange());let visible=0,blue=0;for(let i=0;i<a.length;i+=4){if(a[i]+a[i+1]+a[i+2])visible++;if(a[i]>100&&a[i]>a[i+2]*2)blue++;}pictures.push({samples,mode,visible,blue});b.unmap();b.destroy();color.destroy();ms?.destroy();z.destroy();
    }
    await d.queue.onSubmittedWorkDone();renderer.destroy();d.destroy();return {errors,pictures};
  });
  if(result.skip){t.skip(result.skip);return;}assert.deepEqual(result.errors,[]);
  for(const p of result.pictures){if(p.mode===2)assert.equal(p.visible,0);else assert.ok(p.visible>2500,JSON.stringify(p));if(p.mode===1)assert.ok(p.blue>2000,JSON.stringify(p));}
});
