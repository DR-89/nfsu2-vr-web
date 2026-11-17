// Opt-in integration probe for the real LAN/Online game tests. Only the second
// player's headset poses are synthetic; sockets, car slots and rendering are real.
export async function startVRRaceProbe(page, index, screenshot) {
  await page.waitForFunction(()=>!!window.__nfsu2?.session?.mod && !!window.__nfsu2.session.cockpit,null,{timeout:120000});
  page.on('console',msg=>{if(msg.text().startsWith('[vr-proof]'))void page.screenshot({path:screenshot}).catch(()=>{});});
  await page.evaluate(index=>{
    const session=window.__nfsu2.session,mod=session.mod,original=mod.tick.bind(mod);
    if(index===1)mod.tick=(now,avatar,police,secondary)=>original(now,{car:avatar?.car??0,cockpit:avatar?.cockpit??0,vr:true,
      head:{p:[Math.sin(now/700)*.08,0,0],q:[0,0,0,1]},left:{p:[-.14,-.21,-.33],q:[0,0,0,1]},right:{p:[.18,-.15+Math.sin(now/500)*.1,-.30],q:[0,0,0,1]},wheel:Math.sin(now/700)*.4,shifter:[.045,Math.sin(now/500)*.06],pedals:[.7,.2,(Math.sin(now/300)+1)*.5],fingers:[1,0,Math.floor(now/500)%3?1:0,Math.floor(now/500)%3===2?1:0]},police,secondary);
    const proof=window.__vrRaceProof={samples:0,vr:0,flat:0,wheel:0,shifter:0,pedals:0,fingers:0,fingerPoses:[],cars:0,room:'',gpuErrors:0,timer:0};
    proof.timer=setInterval(()=>{
      proof.gpuErrors=Math.max(proof.gpuErrors,session.renderer?.stats()['gpu errors']??0);
      const s=session.cockpit.scene;if(!s?.peers?.length||!mod.room.startsWith('race/'))return;
      for(const car of s.cars){const avatar=mod.avatars.get(car.vip)?.current;if(!avatar?.head||!avatar.left||!avatar.right)continue;
        if(!proof.samples)console.info('[vr-proof] authenticated race car has a head and both hands');
        proof.samples++;proof.vr+=Number(avatar.vr);proof.flat+=Number(!avatar.vr);proof.wheel+=Number(Number.isFinite(avatar.wheel)&&Math.abs(avatar.wheel)>.05);proof.cars=Math.max(proof.cars,s.cars.length);proof.room=mod.room;
        proof.shifter+=Number(!!avatar.shifter&&Math.abs(avatar.shifter[1])>.01);proof.pedals+=Number(!!avatar.pedals&&avatar.pedals[0]>.1&&avatar.pedals[2]>.1);
        if(avatar.fingers){proof.fingers++;const pose=avatar.fingers.join(',');if(!proof.fingerPoses.includes(pose))proof.fingerPoses.push(pose);}
      }
    },200);
  },index);
  return async()=>page.evaluate(()=>{const p=window.__vrRaceProof;clearInterval(p.timer);return {...p,timer:undefined};});
}
