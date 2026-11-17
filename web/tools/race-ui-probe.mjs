// Real app integration: host uses DOM controls, guest uses the installed
// GameSession headset menu through synthetic controller tracking. No fake
// lobby records or game-memory writes. Original scripts own login/results.
import fs from 'node:fs';
import path from 'node:path';
let guestReady=false;
export async function startRaceUIProbe(page,index,mode,dir,hostName='OLHOST',rejectPassword=false){
  await page.waitForFunction(()=>!!window.__nfsu2?.session?.races,null,{timeout:120000});
  const proof={ui:index?'headset menu with simulated tracking':'website',phase:0,actions:[],errors:[],racing:false,returned:false,left:false,readyOff:false,readyOn:false,rejectedPassword:false,mobile:false};
  let stopped=false;
  const read=()=>page.evaluate(()=>{const s=window.__nfsu2.session,m=s.raceBrowser;return {r:m.snapshot,busy:m.busy,creating:m.creating,selected:!!m.selected,passwordLength:m.passwordLength,options:m.creating?m.options:null,drive:s.status?.read()?.get('drive')??0};});
  const wait=async (predicate,timeout=300000)=>{const until=Date.now()+timeout;while(!stopped&&Date.now()<until){const s=await read();if(predicate(s))return s;await page.waitForTimeout(150);}throw Error('race UI wait timed out/stopped');};
  const list=()=>wait(s=>s.r?.source==='list'&&!s.busy&&!s.r.originalDialog);
  const room=()=>wait(s=>s.r?.source==='room'&&!s.busy&&!s.r.originalDialog);
  const click=async key=>{
    await page.waitForFunction(key=>[...document.querySelectorAll('#race-browser[open] [data-race-key]')].some(e=>e.dataset.raceKey===key&&!e.disabled),key,{timeout:20000});
    const locator=page.locator('#race-browser [data-race-key]');const keys=await locator.evaluateAll(els=>els.map(e=>e.dataset.raceKey));await locator.nth(keys.indexOf(key)).click();
  };
  const action=async(name,perform)=>{
    const before=(await read()).r;await perform();const s=await wait(s=>s.r?.ack!==before.ack,20000);
    proof.actions.push({id:s.r.ack,action:name,result:s.r.result,...(name==='ready'?{value:!before.ready}:{})});console.log(`race UI ${index+1}: ${name} ${s.r.result}`);if(s.r.result!=='accepted')throw Error(name+': '+s.r.result);
  };
  const snapshot=async name=>{
    if(!index)await page.screenshot({path:path.join(dir,name+'.png')});
    else{const uri=await page.evaluate(()=>window.__nfsu2.session.renderer.vr.overlay?.canvas.toDataURL('image/png'));if(!uri)throw Error('headset overlay missing');fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(uri.split(',')[1],'base64'));}
  };
  const press=async key=>{
    const map={a:[1,4],b:[1,5],x:[0,4]};
    // A completed game command may precede the next tracking frame. Let the
    // menu observe its new rows with released controls before the next edge.
    const released=await page.evaluate(()=>window.__raceUITracking.frames+2);
    await page.waitForFunction(n=>window.__raceUITracking.frames>=n,released,{timeout:10000});
    await page.evaluate(({key,map})=>{const src=window.__raceUITracking.sources;if(map[key])src[map[key][0]].gamepad.buttons[map[key][1]].value=1;else src[1].gamepad.axes[key==='left'||key==='right'?2:3]=key==='left'||key==='up'?-1:1;},{key,map});
    await page.waitForTimeout(100);await page.evaluate(()=>{for(const s of window.__raceUITracking.sources){s.gamepad.buttons.forEach(b=>b.value=0);s.gamepad.axes.fill(0);}});await page.waitForTimeout(110);
  };
  const password=async(value='Test_123')=>{
    if(!index){await click('password');const input=page.locator('#race-browser input[type=password]');await input.fill('bad password');if(await input.evaluate(e=>e.checkValidity()))throw Error('invalid password accepted by website');await input.fill(value);await snapshot('password');await click('password-save');return;}
    await press('a');await page.waitForTimeout(200);let at=0,bank=0;
    const move=async target=>{while(Math.floor(at/10)!==Math.floor(target/10)){const step=(Math.floor(target/10)-Math.floor(at/10)+4)%4<=2?'down':'up';await press(step);at=(at+(step==='down'?10:30))%40;}
      while(at%10!==target%10){const step=(target%10-at%10+10)%10<=5?'right':'left';await press(step);at=Math.floor(at/10)*10+(at%10+(step==='right'?1:9))%10;}};
    for(const ch of value){
      const next=/[a-z]/.test(ch)?1:/[A-Z]/.test(ch)?0:bank;if(next!==bank){await press('x');bank=next;}
      const chars=bank?'abcdefghijklmnopqrstuvwxyz0123456789_-':'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';await move(chars.indexOf(ch));await press('a');
    }
    await snapshot('password');await move(39);await press('a');await wait(s=>s.passwordLength===value.length,20000);
  };
  let mobileChecked=false;
  const create=async()=>{
    await click('new');for(let i=0;i<6&&(await read()).options?.mode!==mode;i++)await click('field:mode-more');
    if((await read()).options?.mode!==mode)throw Error('mode selector did not reach target');
    await password();await snapshot('create');
    if(!mobileChecked){
      const viewport=page.viewportSize();await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);await snapshot('create-mobile');
      const fits=await page.locator('#race-browser').evaluate(d=>d.scrollWidth<=d.clientWidth&&[...d.querySelectorAll('button,output,input')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
      await page.setViewportSize(viewport);if(!fits)throw Error('mobile race controls overflow');mobileChecked=proof.mobile=true;
    }
    await action('create',()=>click('create'));await room();
  };
  const run=(async()=>{
    try{
      await list();proof.phase=1;
      if(!index){
        guestReady=false;await action('search',()=>page.locator('.race-open').click());await list();await snapshot('list');
        await create();await action('leave',()=>click('leave'));await list();proof.left=true;await create();proof.phase=2;
        await wait(s=>guestReady&&s.r?.startable&&!s.busy);await snapshot('room');await action('start',()=>click('start'));
      }else{
        await page.waitForTimeout(15000);
        await page.evaluate(()=>{
          const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),sources=['left','right'].map(handedness=>({handedness,gamepad:{buttons:Array.from({length:6},()=>({value:0})),axes:[0,0,0,0]}}));
          const p=window.__raceUITracking={sources,timer:0,frames:0};p.timer=setInterval(()=>{window.__nfsu2.session.renderer.vr.onTracking({time:performance.now(),head:identity(),eyes:[],sources,hands:[null,null]});p.frames++;},16);
        });
        await page.waitForTimeout(250);await press('x');await press('up');await press('up');await action('search',()=>press('a'));await list();
        let s=await read(),at=s.r.rows.findIndex(r=>r.host===hostName&&r.compatible);
        if(at<0)throw Error('host absent after UI search');for(let i=0;i<at;i++)await press('down');await press('a');await wait(s=>s.selected,20000);await snapshot('detail');
        if(rejectPassword){
          await password('Bad_123');await press('down');await action('join',()=>press('a'));
          await wait(s=>s.r?.source==='list'&&s.r.originalDialog,20000);await page.screenshot({path:path.join(dir,'original-password-error.png')});
          await press('a');await list();proof.rejectedPassword=true;
          await press('a');await wait(s=>s.selected,20000);
        }
        await password();await press('down');await action('join',()=>press('a'));await room();await snapshot('room');proof.phase=2;
        if(!(await read()).r.ready){await action('ready',()=>press('a'));await wait(s=>s.r?.ready&&!s.busy,20000);}
        await action('ready',()=>press('a'));await wait(s=>s.r?.source==='room'&&!s.r.ready&&!s.busy,20000);proof.readyOff=true;
        await action('ready',()=>press('a'));await wait(s=>s.r?.ready&&!s.busy,20000);proof.readyOn=true;guestReady=true;
      }
      await wait(s=>s.drive&3);proof.racing=true;proof.phase=3;
      if(index)await page.evaluate(()=>{clearInterval(window.__raceUITracking.timer);window.__nfsu2.session.renderer.vr.onTracking(null);});
      await list();proof.returned=true;proof.phase=4;
    }catch(e){if(!stopped){proof.errors.push(e.message);fs.writeFileSync(path.join(dir,'ui-error.json'),JSON.stringify({...proof,state:await read().catch(()=>null)},null,2));console.log(`race UI ${index+1}: ${e.message}`);await snapshot('ui-overlay-failure').catch(()=>{});await page.screenshot({path:path.join(dir,'ui-failure.png')}).catch(()=>{});}}
  })();
  return Object.assign(async()=>{stopped=true;await page.evaluate(()=>{if(window.__raceUITracking)clearInterval(window.__raceUITracking.timer);}).catch(()=>{});await Promise.race([run,new Promise(r=>setTimeout(r,1000))]);return proof;},{proof});
}
