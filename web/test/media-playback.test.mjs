import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';

test('local cockpit videos start, survive source changes and recover from a blocked play',{skip:spawnSync('ffmpeg',['-version']).status!==0&&'needs ffmpeg for the video fixture'},async t=>{
  const fixture=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',"color=red:size=64x64:rate=20,drawbox=color=lime:t=fill:enable='lt(mod(t,0.4),0.2)'",'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-c:v','libvpx','-c:a','libopus','-f','webm','pipe:1']);
  const code=(await esbuild.build({stdin:{contents:"export * from './src/vr/media-panel';export * from './src/vr/settings';export * from './src/vr/cockpit';export * from './src/vr/drivers';export * from './src/vr/math';export * from './src/vr/fit';export * from './src/vr/glove-tip';export * from './src/app/prefs';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'V',write:false})).outputFiles[0].text;
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><button id="start">Start</button><main></main><canvas width="64" height="64"></canvas>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  // Keep Chrome's normal autoplay policy. The test starts playback through
  // the same user click / deferred world update as Play in VR.
  const browser=await chromium.launch({...pickBrowser(),headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.addScriptTag({content:code});
  await page.evaluate(async bytes=>{
    const file=new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'Pattern.webm',{type:'video/webm'});
    window.qa={logs:[],reads:0,external:false,audio:[],holdAudio:false,shuffle:false};
    const Context=window.AudioContext;
    window.AudioContext=class extends Context{
      constructor(){super();qa.audio.push(this);}
      resume(){return qa.holdAudio?new Promise(()=>{}):super.resume();}
    };
    // Remembered music can be on even though the newly selected folder only
    // contains video. The disabled checkbox must not block that playlist.
    V.localStore.set(V.RADIO_ON,'1');
    const radio={get shuffle(){return qa.shuffle;},get externalPlayback(){return qa.external;},setExternalPlayback(on){qa.external=on;},turnOff(){V.localStore.set(V.RADIO_ON,'0');},setFolder(){throw Error('video sent to the audio decoder');},enableForNextGame(){}};
    qa.files=[file];
    window.showDirectoryPicker=async()=>({name:'Patterns',kind:'directory',async *values(){for(const file of qa.files)yield {kind:'file',name:file.name,async getFile(){qa.reads++;await new Promise(r=>setTimeout(r,30));return file;}};}});
    window.panel=new V.MediaPanel(document.querySelector('main'),{radio:()=>radio,settings:()=>V.vrSettings({}),log:s=>qa.logs.push(s)});
    panel.player.loop=true;
    document.querySelector('#start').onclick=()=>{
      panel.preparePlayback();
      document.querySelector('main').hidden=true;
      setTimeout(()=>panel.setGameSource(0,true),50);
    };
  },fixture.toString('base64'));
  await page.getByRole('button',{name:'Choose media folder',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('select').options.length===1);
  assert.deepEqual(await page.evaluate(()=>({reads:qa.reads,checked:document.querySelector('input').checked,disabled:document.querySelector('input').disabled})),{reads:0,checked:false,disabled:true});
  await page.click('#start');
  await page.waitForFunction(()=>panel.active&&!panel.player.paused&&panel.player.currentTime>.05,null,{timeout:5000}).catch(async error=>{
    console.error(await page.evaluate(()=>({logs:qa.logs,reads:qa.reads,active:panel.active,paused:panel.player.paused,time:panel.player.currentTime,ready:panel.player.readyState,error:panel.player.error?.message,context:qa.audio[0]?.state})));
    throw error;
  });
  assert.equal(await page.evaluate(()=>qa.audio[0].state),'running');
  const frame=()=>page.evaluate(()=>{
    const g=document.querySelector('canvas').getContext('2d');g.drawImage(panel.player,0,0,64,64);return [...g.getImageData(32,32,1,1).data].slice(0,3);
  });
  const first=await frame();assert.ok(Math.max(...first)>180,'real video pixels reach the cockpit texture source');
  await page.waitForFunction(first=>{const g=document.querySelector('canvas').getContext('2d');g.drawImage(panel.player,0,0,64,64);const p=g.getImageData(32,32,1,1).data;return Math.abs(p[0]-first[0])>100;},first);

  await t.test('menus and EA TRAX pause without losing position; manual pause stays paused',async()=>{
    await page.evaluate(()=>panel.setGameSource(0,false));
    assert.equal(await page.evaluate(()=>panel.player.paused),true);
    const position=await page.evaluate(()=>panel.player.currentTime);
    await page.evaluate(()=>panel.setGameSource(0,true));await page.waitForFunction(()=>!panel.player.paused);
    assert.ok(await page.evaluate(position=>Math.abs(panel.player.currentTime-position)<.2,position));
    await page.evaluate(()=>panel.setGameSource(2,true));assert.equal(await page.evaluate(()=>panel.player.paused),true);
    await page.evaluate(()=>panel.setGameSource(0,true));await page.waitForFunction(()=>!panel.player.paused);
    await page.evaluate(()=>panel.toggle());await page.waitForTimeout(50);
    await page.evaluate(()=>{panel.setGameSource(0,false);panel.setGameSource(0,true);});
    assert.equal(await page.evaluate(()=>panel.player.paused),true);await page.evaluate(()=>panel.toggle());
  });
  await t.test('a pending audio resume cannot hold video playback hostage',async()=>{
    await page.evaluate(async()=>{await panel.toggle();await qa.audio[0].suspend();qa.holdAudio=true;void panel.toggle();});
    await page.waitForFunction(()=>!panel.player.paused&&panel.player.currentTime>.05,null,{timeout:3000});
    await page.evaluate(async()=>{qa.holdAudio=false;await qa.audio[0].resume();});
  });
  await t.test('autoplay refusal and menu cancellation leave the file retryable',async()=>{
    await page.evaluate(async()=>{
      await panel.toggle();window.playVideo=panel.player.play.bind(panel.player);
      panel.player.play=()=>Promise.reject(new DOMException('Blocked fixture','NotAllowedError'));
      await panel.toggle();
    });
    assert.equal(await page.evaluate(()=>panel.usable),true);
    await page.evaluate(async()=>{panel.player.play=playVideo;await panel.toggle();});await page.waitForFunction(()=>!panel.player.paused);
    await page.evaluate(async()=>{
      await panel.toggle();
      panel.player.play=()=>new Promise((resolve,reject)=>setTimeout(()=>reject(new DOMException('Menu pause','AbortError')),30));
      const pending=panel.toggle();panel.setGameSource(0,false);await pending;panel.player.play=playVideo;
      panel.setGameSource(0,true);
    });
    await page.waitForFunction(()=>!panel.player.paused);assert.equal(await page.evaluate(()=>panel.usable),true);
  });
  await t.test('mixed folders retain videos even with a remembered game-music switch',async()=>{
    const wav=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-f','wav','pipe:1']);
    await page.evaluate(bytes=>{
      const video=qa.files[0],audio=new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'01-song.wav',{type:'audio/wav'});
      qa.files=[audio,new File([video],'02-clip.webm',{type:video.type}),new File([video],'03-clip.webm',{type:video.type})];
      panel.stop();V.localStore.set(V.RADIO_ON,'1');document.querySelector('input').checked=true;document.querySelector('main').hidden=false;
    },wav.toString('base64'));
    await page.getByRole('button',{name:'Choose media folder',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('select').options.length===3);
    assert.equal(await page.evaluate(()=>document.querySelector('input').checked),false,'a mixed folder must not silently discard its videos');
    await page.click('#start');await page.waitForFunction(()=>panel.active&&!panel.player.paused&&panel.player.currentTime>.05);
    await page.evaluate(()=>panel.step(1));await page.waitForFunction(()=>panel.player.videoWidth===64&&panel.player.currentTime>.05);
    assert.equal(await page.evaluate(()=>panel.title),'02-clip.webm');
    const pixel=await page.evaluate(()=>{
      const cockpit=new V.Cockpit(V.vrSettings({}),panel);cockpit.paint();
      return [...cockpit.context.getImageData(512,160,1,1).data].slice(0,3);
    });
    assert.ok(Math.max(...pixel)>180,'the actual cockpit canvas paints video, not the visualizer');
    if(process.env.NFSU2_MEDIA_PLAYBACK_SCREENSHOT){
      const png=await page.evaluate(()=>{const cockpit=new V.Cockpit(V.vrSettings({}),panel);cockpit.paint();return cockpit.canvas.toDataURL().split(',')[1];});
      writeFileSync(process.env.NFSU2_MEDIA_PLAYBACK_SCREENSHOT,Buffer.from(png,'base64'));
    }
    await page.evaluate(async()=>{
      const next=panel.step(1);panel.player.dispatchEvent(new Event('ended'));await next;
      panel.player.dispatchEvent(new Event('ended'));
    });
    assert.equal(await page.evaluate(()=>panel.title),'03-clip.webm','stale ended events do not skip the requested track');
    await page.evaluate(()=>{panel.player.loop=false;panel.player.currentTime=panel.player.duration-.05;});
    await page.waitForFunction(()=>panel.title==='01-song.wav'&&!panel.player.paused&&panel.player.currentTime>.05);
  });
  await t.test('shuffled mixed media visits each file once, retraces history and advances once at the end',async()=>{
    await page.evaluate(()=>{panel.stop();panel.player.loop=true;qa.shuffle=true;document.querySelector('main').hidden=false;});
    await page.getByRole('button',{name:'Choose media folder',exact:true}).click();
    await page.click('#start');await page.waitForFunction(()=>panel.active&&!panel.player.paused&&panel.player.currentTime>.05);
    const result=await page.evaluate(async()=>{
      const heard=[panel.title],reads=qa.reads;
      for(let i=0;i<5;i++){
        const next=panel.step(1);panel.player.dispatchEvent(new Event('ended'));await next;
        panel.player.dispatchEvent(new Event('ended'));heard.push(panel.title);
      }
      const forward=panel.order.peek(panel.indices);
      await panel.step(-1);const back=panel.title;
      await panel.step(1);const again=panel.title;
      return {heard,reads:qa.reads-reads,back,again,forward,after:panel.order.peek(panel.indices)};
    });
    assert.equal(new Set(result.heard.slice(0,3)).size,3);assert.equal(new Set(result.heard.slice(3)).size,3);
    for(let i=1;i<result.heard.length;i++)assert.notEqual(result.heard[i],result.heard[i-1]);
    assert.equal(result.reads,7,'each Next/Previous reads exactly one file, despite stale ended events');
    assert.equal(result.back,result.heard[4]);assert.equal(result.again,result.heard[5]);assert.equal(result.after,result.forward);
    await page.evaluate(()=>{panel.player.loop=false;panel.player.currentTime=panel.player.duration-.05;});
    await page.waitForFunction(index=>Number(panel.select.value)===index&&!panel.player.paused&&panel.player.currentTime>.05,result.forward);
    await page.evaluate(()=>{panel.player.loop=true;qa.shuffle=false;});
  });
  await t.test('MP4 video reaches the display and remains excluded from EA TRAX-only playback',async()=>{
    const mp4=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=blue:size=64x64:rate=20','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
    await page.evaluate(bytes=>{
      panel.stop();panel.player.loop=true;
      qa.files=[new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'Clip.mp4',{type:'video/mp4'})];
      document.querySelector('main').hidden=false;
    },mp4.toString('base64'));
    await page.getByRole('button',{name:'Choose media folder',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('select').options.length===1);await page.click('#start');
    await page.waitForFunction(()=>panel.player.videoWidth===64&&!panel.player.paused&&panel.player.currentTime>.05);
    const pixel=await page.evaluate(()=>{const c=new V.Cockpit(V.vrSettings({}),panel);c.paint();return [...c.context.getImageData(512,160,1,1).data];});
    assert.ok(pixel[2]>180&&pixel[0]<30,`MP4 pixels: ${pixel}`);
    await page.evaluate(()=>panel.setGameSource(2,true));assert.equal(await page.evaluate(()=>panel.video),null);
    await page.evaluate(()=>panel.setGameSource(0,true));await page.waitForFunction(()=>!panel.player.paused);
  });
  await t.test('video overlays ignore rays and return for fingertips and mouse hover without restarting playback',async()=>{
    const result=await page.evaluate(()=>{
      const realNow=performance.now.bind(performance);let now=0;performance.now=()=>now;
      const c=new V.Cockpit(V.vrSettings({}),panel),position=panel.player.currentTime;
      try{
        const local={model:'350Z',matrix:V.identity()},near=.03,far=15000;
        const scene={projection:new Float32Array([.69,0,0,0,0,1.05,0,0,0,0,far/(near-far),-1,0,0,near*far/(near-far),0]),view:V.inverse(V.cabinMatrix(local)),cars:[],local,cockpit:true};
        c.update(scene);const mount=V.screenMount(local.model,c.settings);
        const pixel=(x=512,y=488)=>[...c.context.getImageData(x,y,1,1).data].slice(0,3);
        const paint=time=>{now=time;c.paint(now);return pixel();};
        const initial=paint(0),buttonsInitial=pixel(512,612),gap=pixel(612,584),fade=paint(3125),buttonsFade=pixel(512,612),hidden=paint(3500),buttonsHidden=pixel(512,612);
        const ray=new Float32Array(mount.matrix);for(let k=0;k<3;k++)ray[12+k]+=mount.matrix[8+k]*.08;
        const source={gamepad:{buttons:[{value:0},{value:0}]}},hand={matrix:V.identity(),ray,source};
        const point=time=>{now=time;c.update(scene);c.track({time,hands:[hand,null]});};
        point(4000);const rayHidden=paint(4000),buttonsRay=pixel(512,612);
        for(let time=4250;time<=8000;time+=250)point(time);
        const rayHeld=paint(8000);c.track(null);const afterRay=paint(11500);
        const matrix=V.multiply(mount.matrix,V.inverse(V.gloveAxes(1)));
        for(let k=0;k<3;k++)matrix[12+k]=mount.matrix[12+k]+mount.matrix[8+k]*.03-V.gloveTip.reduce((sum,v,j)=>sum+mount.matrix[j*4+k]*v,0);
        now=12000;c.update(scene);c.track({time:now,hands:[null,{matrix,source}]});
        const touch=paint(12000),buttonsTouch=pixel(512,612);
        for(let time=12250;time<=16000;time+=250){now=time;c.update(scene);c.track({time,hands:[null,{matrix,source}]});}
        const touchHeld=paint(16000);c.track(null);paint(19500);
        const at=(u,v)=>{
          const m=V.multiply(scene.projection,mount.matrix),p=[(u-.5)*mount.width,(.5-v)*mount.height,0,1];
          const q=[0,1,2,3].map(r=>p.reduce((sum,x,k)=>sum+m[k*4+r]*x,0));return [q[0]/q[3],q[1]/q[3]];
        };
        now=19600;const hoverConsumed=c.pointer(...at(.5,.4),'move'),mouse=paint(19600),mouseParked=paint(24500);
        c.pointer(0,0,'leave');const afterMouse=paint(28000);
        now=28500;const dragConsumed=c.pointer(...at(.9,.8),'down');c.pointer(99,99,'move');
        const dragging=paint(33500);now=33600;c.pointer(99,99,'up');const released=paint(37000);
        const buttonsAfter=pixel(512,612);c.settings.page=1;paint(38000);const telemetrySlider=pixel(),telemetryButtons=pixel(512,584);
        return {initial,fade,hidden,gap,buttonsInitial,buttonsFade,buttonsHidden,buttonsRay,rayHidden,rayHeld,afterRay,touch,buttonsTouch,touchHeld,mouse,mouseParked,afterMouse,dragging,released,buttonsAfter,telemetrySlider,telemetryButtons,hoverConsumed,dragConsumed,positionUnchanged:panel.player.currentTime===position,paused:panel.player.paused};
      }finally{c.destroy();performance.now=realNow;}
    });
    assert.ok(result.hidden[2]>240&&result.hidden[0]<10,'no shade remains over the video');
    assert.ok(result.initial[2]<result.fade[2]&&result.fade[2]<result.hidden[2],'the overlay fades smoothly');
    for(const key of ['touch','touchHeld','mouse','mouseParked','dragging'])assert.deepEqual(result[key],result.initial,key);
    for(const key of ['rayHidden','rayHeld','afterRay','afterMouse','released'])assert.deepEqual(result[key],result.hidden,key);
    assert.deepEqual(result.buttonsHidden,result.hidden,'video reaches the bottom of the display behind the hidden buttons');
    assert.ok(result.buttonsInitial[2]<result.buttonsFade[2]&&result.buttonsFade[2]<result.buttonsHidden[2],'buttons fade with the sliders');
    assert.deepEqual(result.buttonsRay,result.hidden,'a controller ray cannot reveal the buttons');
    assert.deepEqual(result.buttonsTouch,result.buttonsInitial,'a fingertip near the video reveals the buttons');
    assert.deepEqual(result.buttonsAfter,result.hidden,'the entire overlay hides again after interaction');
    assert.deepEqual(result.gap,result.hidden,'video stays unobscured between the circular buttons');
    assert.deepEqual(result.telemetryButtons,[239,250,255],'telemetry keeps the transport icons');
    assert.deepEqual(result.telemetrySlider,[38,52,71],'telemetry keeps its controls');
    assert.equal(result.hoverConsumed,false);assert.equal(result.dragConsumed,true);
    assert.equal(result.positionUnchanged,true);assert.equal(result.paused,false);
  });
  await page.evaluate(()=>panel.stop());assert.deepEqual(errors,[]);
});
