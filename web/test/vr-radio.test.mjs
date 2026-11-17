import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const code=(await esbuild.build({stdin:{contents:`export * from './src/vr/radio';export * from './src/vr/radio-controls';export * from './src/vr/screen-controls';export * from './src/app/radio-link';export * from './src/vr/cockpit';export * from './src/vr/settings';export * from './src/vr/math';export * from './src/vr/drivers';export * from './src/vr/fit';export * from './src/vr/glove-tip';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'esm',write:false})).outputFiles[0].text;
const V=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const CTL=16+48*24,TAIL=CTL+80+9*44;
test('screen time formatting and sliders are bounded',()=>{
 assert.equal(V.mediaTime(65.9),'1:05');assert.equal(V.mediaTime(3661),'1:01:01');assert.equal(V.mediaTime(NaN),'0:00');
 assert.equal(V.screenControl([.3,.8]),V.SEEK);assert.equal(V.screenControl([.9,.8]),V.VOLUME);
 for(const v of [.71,.76,.82]){assert.equal(V.screenControl([.3,v]),V.SEEK);assert.equal(V.screenControl([.75,v]),V.VOLUME);}
 assert.equal(V.screenControl([.84,.9125]),4,'page target extends beyond its visible circle');
 assert.equal(V.screenControl([.6,.9125]),-1,'gaps between circles are not buttons');
 assert.equal(V.screenControl([.3,.65]),-1);assert.equal(V.sliderValue(V.SEEK,-1),0);assert.equal(V.sliderValue(V.VOLUME,2),1);
});

function fingerRig(side,media){
 const c=new V.Cockpit(V.vrSettings({NFSU2_VR_SCREEN_X:'100'}),media),mount=V.screenMount('350Z',c.settings);
 const sources=[0,1].map(()=>({gamepad:{buttons:[{value:0},{value:0}],axes:[0,0,0,0]}})),hand={source:sources[side],matrix:V.identity()},hands=[null,null];hands[side]=hand;let time=0;
 const move=(u,v,depth)=>{
  hand.matrix=V.multiply(mount.matrix,V.inverse(V.gloveAxes(side)));
  for(let k=0;k<3;k++)hand.matrix[12+k]=mount.matrix[12+k]+mount.matrix[k]*(u-.5)*mount.width+mount.matrix[4+k]*(.5-v)*mount.height+mount.matrix[8+k]*depth-V.gloveTip.reduce((sum,x,j)=>sum+mount.matrix[j*4+k]*x,0);
  c.update({projection:V.identity(),view:V.identity(),cars:[],local:{model:'350Z',matrix:V.identity()},cockpit:true});c.track({time:time+=16,hands,sources});
  assert.equal(c.controls.throttle,sources[1].gamepad.buttons[0].value);assert.equal(c.controls.brake,sources[0].gamepad.buttons[0].value);
 };
 const pedals=(brake,gas)=>{sources[0].gamepad.buttons[0].value=brake;sources[1].gamepad.buttons[0].value=gas;};
 return {c,move,pedals};
}
test('radio taps and pedals work in either order, with either hand and through repeated taps',()=>{
 for(const side of [0,1])for(const order of ['pedal','touch']){
  const steps=[],r=fingerRig(side,{step:d=>steps.push(d)});r.move(.5,.95,.04);
  if(order==='pedal'){r.pedals(.4,.8);r.move(.5,.95,.04);}
  r.move(.5,.95,.003);assert.deepEqual(steps,[1]);
  for(const gas of [.8,0,.3,1]){r.pedals(gas/2,gas);r.move(.5,.95,.003);assert.deepEqual(steps,[1]);}
  r.move(.5,.95,.04);r.move(.5,.95,.003);assert.deepEqual(steps,[1,1]);
  r.move(.5,.95,-.08);r.move(.5,.95,.003);r.move(.3,.95,.003);assert.deepEqual(steps,[1,1],'deep and sideways movements are still one poke');
  r.c.destroy();
 }
});
test('finger seek and volume work with held pedals; seek waits for withdrawal and tracking loss cancels it',()=>{
 for(const side of [0,1]){
  const seeks=[],volumes=[],media={timeline:{id:'one',current:10,duration:100,seekable:true},player:{paused:true},seek:(...args)=>seeks.push(args),setVolume:v=>volumes.push(v)};
  const r=fingerRig(side,media);r.move(56/1024,.76,.04);r.pedals(.4,.8);
  r.move(56/1024,.76,.003);r.move(340/1024,.76,.003);assert.equal(seeks.length,0);r.move(340/1024,.76,.04);
  assert.ok(Math.abs(seeks[0][0]-50)<1e-4);assert.equal(seeks[0][1],'one');assert.equal(media.player.paused,true);
  r.move(744/1024,.76,.04);r.move(744/1024,.76,.003);r.move(968/1024,.76,.003);assert.deepEqual(volumes,[0,1]);r.move(968/1024,.76,.04);
  r.move(340/1024,.76,.04);r.move(340/1024,.76,.003);r.c.track(null);assert.equal(seeks.length,1,'tracking loss cancels the pending seek');r.c.destroy();
 }
});

function link(){const memory=new WebAssembly.Memory({initial:1,maximum:1,shared:true}),words=new Uint32Array(memory.buffer,CTL,20),controls=new Uint32Array(memory.buffer,TAIL,16);words[0]=V.RADIO_MAGIC;words[1]=V.RADIO_VERSION;return {memory,words,controls,link:V.RadioLink.open(memory,0)};}
test('radio transport uses a bounded command queue and independent metadata consumers',()=>{
 const s=link();assert.ok(s.link);assert.equal(s.link.command('next'),false);s.link.cockpit(true,.25);s.link.listen(true);assert.equal(s.words[15],3);s.link.listen(false);assert.equal(s.words[15],2);
 assert.equal(s.controls[1],16384);s.controls[2]=s.controls[3]=0xfffffffc;
 for(let i=0;i<8;i++)assert.equal(s.link.command(i%2?'previous':'next'),true);
 assert.equal(s.link.command('next'),false);assert.equal(s.controls[2],4);
 s.controls[3]++;assert.equal(s.link.command('toggle'),true);assert.equal(s.controls[4+4],2);
 s.link.cockpit(false,1);assert.equal(s.words[15],0);assert.equal(s.link.command('next'),false);
 s.words[1]=3;assert.ok(V.RadioLink.open(s.memory,0));assert.equal(s.link.transport(),null);
});
test('music-only PCM snapshots reject torn, nonfinite and invalid buffers',()=>{
 const s=link(),pcm=new Float32Array(s.memory.buffer,TAIL+64,512);pcm.fill(.25);s.controls[13]=2;s.controls[14]=44100;s.controls[15]=512;
 assert.equal(s.link.musicSamples().samples[511],.25);s.controls[13]=3;assert.equal(s.link.musicSamples(),null);s.controls[13]=4;
 for(const n of [0,513,0xffffffff]){s.controls[15]=n;assert.equal(s.link.musicSamples(),null);}s.controls[15]=512;
 pcm[100]=NaN;assert.equal(s.link.musicSamples(),null);
});
test('FFT follows an actual tone, silence, paused transport and a stopped producer',()=>{
 const fft=new V.MusicSpectrum(),samples=Float32Array.from({length:512},(_,i)=>.5*Math.sin(2*Math.PI*20*i/512));
 const bins=fft.update({seq:2,rate:44100,samples},false,100);assert.equal(bins.indexOf(Math.max(...bins)),10);assert.ok(bins[10]>220);assert.ok(bins[60]<20);
 assert.ok(fft.update({seq:2,rate:44100,samples},false,200)[10]>220);
 assert.ok(fft.update({seq:2,rate:44100,samples},false,400).every(x=>x===0));
 fft.update({seq:4,rate:44100,samples},false,410);assert.ok(fft.update(null,true,420).every(x=>x===0));
 assert.ok(fft.update({seq:6,rate:44100,samples:new Float32Array(512)},false,430).every(x=>x===0));
});
test('native radio contacts match the fitted plane and fixed controls on both drive sides',()=>{
 for(const model of ['350Z','A3','SKYLINE','HUMMER']){
   const m=V.radioMount(model);
   for(const [u,v,expected]of [[.2,.5,0],[.55,.5,1],[.73,.5,2],[.9,.5,3],[.25,2.2,4],[.75,2.2,5]]){
     const p=[u-.5,.5-v/2.5,.003],tip=[0,1,2].map(k=>m.matrix[12+k]+m.matrix[k]*p[0]*m.width+m.matrix[4+k]*p[1]*m.height+m.matrix[8+k]*p[2]);
     const c=V.radioContact(model,tip);assert.ok(Math.abs(c[0]-u)<1e-6);assert.ok(Math.abs(c[1]-v)<1e-6);assert.equal(V.radioButton(c),expected);
   }
 }
});
test('radio touch slides volume continuously, rearms on withdrawal and cannot steal another finger',()=>{
 const a=new V.RadioTouch(),b=new V.RadioTouch();a.sample([.2,.5,.04],-1);assert.equal(a.sample([.09,.5,.003],-1).volume,0);assert.ok(Math.abs(a.sample([.42,.5,.003],-1).volume-1)<1e-6);
 b.sample([.2,.5,.04],0);b.sample([.2,.5,.003],0);assert.equal(b.control,-1);assert.equal(b.sample([.2,.5,.003],-1).volume,null);
 a.sample([.55,.5,.04],-1);assert.equal(a.sample([.55,.5,-.05],-1).button,1);assert.equal(a.sample([.55,.5,-.05],-1).button,-1);
 a.reset();assert.equal(a.sample([.73,.5,.003],-1).button,-1);
 assert.equal(V.radioScroll(20,3000),0);assert.equal(V.radioScroll(30,1700),0);assert.equal(V.radioScroll(30,2150),1);assert.equal(V.radioScroll(30,7000),10);assert.equal(V.radioScroll(30,7100),0);
});
test('cockpit and screen buttons share stock, folder and video transport',()=>{
 const actions=[],port={cockpit:(...x)=>actions.push(['active',...x]),command:x=>actions.push(x),song:()=>({lines:{title:'Stock title',artist:'Artist'}}),transport:()=>({live:true,paused:false}),musicSamples:()=>null};
 const media={active:false,available:false,player:{paused:false},setGameSource:(...x)=>actions.push(['source',...x]),endGame(){},setVolume:v=>actions.push(['volume',v]),setMasterGain:v=>actions.push(['gain',v]),toggle:()=>actions.push('video-play'),step:d=>actions.push(['video-step',d])};
 const folder={on:false,trackPaths:[],pauseForSource:(...x)=>actions.push(['folder-source',...x]),clearSource(){},stepTrack:d=>actions.push(['folder-step',d])},r=new V.CockpitRadio(()=>port,media,()=>folder);
 r.update(true,.5,-6);assert.deepEqual(actions.at(-1),['gain',-6]);r.command('toggle');assert.equal(actions.at(-1),'toggle');assert.equal(r.title,'Stock title');
 folder.on=true;r.command('previous');assert.deepEqual(actions.at(-1),['folder-step',-1]);
 media.active=true;media.title='Clip';r.command('next');assert.deepEqual(actions.at(-1),['video-step',1]);assert.equal(r.title,'Clip');
 media.active=false;media.available=true;folder.on=false;r.update(true,.5,0,2,true);r.command('next');assert.equal(actions.at(-1),'next','EA TRAX owns transport even with a media folder');
 r.update(false,.5,0,1,false);assert.deepEqual(actions.findLast(x=>x[0]==='folder-source'),['folder-source',true,false,true]);
 r.destroy();const n=actions.length;r.command('toggle');assert.equal(actions.length,n);
});
test('screen volume saves once on release and LED/page buttons follow the moved screen',()=>{
 const settings=V.vrSettings({NFSU2_VR_SCREEN_X:'100'}),saves=[],c=new V.Cockpit(settings,null,x=>saves.push(x)),m=V.screenMount('350Z',settings),h={matrix:V.identity(),source:{gamepad:{buttons:Array.from({length:6},()=>({value:0})),axes:[0,0,0,0]}}};let time=0;
 c.update({projection:V.identity(),view:V.identity(),cars:[],local:{vip:0,peer:0,model:'350Z',matrix:V.identity(),steer:0},cockpit:true});
 const move=(u,v,depth)=>{const tip=[0,1,2].map(k=>m.matrix[12+k]+m.matrix[k]*(u-.5)*m.width+m.matrix[4+k]*(.5-v)*m.height+m.matrix[8+k]*depth),axes=V.gloveAxes(1);for(let k=0;k<3;k++)h.matrix[12+k]=tip[k]-V.gloveTip.reduce((a,x,j)=>a+axes[j*4+k]*x,0);c.track({time:time+=16,hands:[null,h]});};
 move(.75,.71,.04);move(744/1024,.71,.003);assert.equal(settings.volume,0);move(968/1024,.82,.003);assert.equal(settings.volume,1);assert.equal(saves.length,0);
 move(968/1024,.82,.04);assert.deepEqual(saves,[{vr_media_volume:'100'}]);
 move(.7,.95,.04);move(.7,.95,.003);assert.equal(settings.ledColor,1);
 move(.9,.95,.04);move(.9,.95,.003);assert.equal(settings.page,1);
});
