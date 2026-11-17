// Integration-only driver of the shared race controller. Navigation to Online
// remains the retail test script; all room actions reach its public mailbox.
export async function startRaceActionsProbe(page,index,mode,hostName='OLHOST'){
  await page.waitForFunction(()=>!!window.__nfsu2?.session?.races,null,{timeout:120000});
  await page.evaluate(({index,mode,hostName})=>{
    const proof=window.__raceActionsProof={controller:true,phase:0,actions:[],errors:[],racing:false,returned:false,left:false,readyOff:false,readyOn:false,timer:0};
    let pending=0,next=0,firstList=0,readyAt=0,diagnosticAt=0;
    const send=(r,action,extra={})=>{
      const model=window.__nfsu2.session.raceBrowser;model.update();let ok=false;
      if(action==='search')ok=model.search(extra.value);
      else if(action==='create'){
        ok=model.beginCreate();
        for(let i=0;ok&&i<6&&model.options.mode!==mode;i++)model.adjust('mode',1);
        if(ok&&model.options.mode!==mode)throw Error('create form mode missing');
        ok=ok&&model.setPassword(extra.password)&&model.create();
      }else if(action==='join'){
        const row=r.rows[extra.value],key=JSON.stringify([row.id,row.seed,row.name,row.host,row.params,row.minPlayers,row.maxPlayers,row.customFlags,row.systemFlags]);
        ok=model.select(key)&&model.setPassword(extra.password)&&model.join();
      }else if(action==='ready'){
        ok=model.ready(!!extra.value);
      }else if(action==='start')ok=model.start();
      else if(action==='leave')ok=model.leave();
      const id=ok?model.pendingSerial:0;
      if(!id){proof.errors.push('queue rejected '+action);return false;}
      pending=id;proof.actions.push({id,action,result:null});return true;
    };
    proof.timer=setInterval(()=>{
      if(proof.errors.length)return;
      try {
        const session=window.__nfsu2?.session,r=session?.races?.read();if(!r)return;
        const now=performance.now(),d=new DataView(session.proc.memory.buffer),u=a=>d.getUint32(a,true);
        if(now>diagnosticAt&&!proof.racing){
          diagnosticAt=now+20000;const request=u(0x86a3d4);
          console.info('[race-actions-proof] '+JSON.stringify({phase:proof.phase,source:r.source,valid:r.lobbyValid,epoch:r.epoch,
            flow:u(0x8654a4),mode:u(0x850078),stage:u(0x8500d0),callback:u(0x86a864),protocol:!!u(0x86a3cc),
            pending:!!request,pendingKind:request&&request<0x28000000?u(request+8):0,dialog:!!u(0x838974)}));
        }
        if(pending){
          if(r.ack!==pending)return;
          proof.actions.at(-1).result=r.result;pending=0;
          if(r.result!=='accepted'){proof.errors.push('command '+r.action+' returned '+r.result);return;}
          next=now+500;return;
        }
        const flow=new DataView(session.proc.memory.buffer).getUint32(0x8654a4,true);
        if(flow===6){proof.racing=true;return;}
        if(proof.racing&&r.source==='list'){proof.returned=true;return;}
        if(now<next||r.originalDialog)return;
        if(r.source==='list'&&!firstList)firstList=now;
        if(index===0){
          if(proof.phase===0&&r.source==='list'){
            if(send(r,'search',{value:0}))proof.phase=1;
          }else if((proof.phase===1||proof.phase===3)&&r.source==='list'){
            if(proof.phase===3)proof.left=true;
            const choice=r.choices.find(t=>t.mode===mode);if(!choice)throw Error('mode missing');
            const options={mode,track:choice.track,laps:choice.minLaps,minPlayers:2,maxPlayers:choice.maxPlayers,
              reverse:false,collision:true,catchup:mode!==3&&mode!==10,ranked:false,privateGame:false,unrestricted:true};
            if(send(r,'create',{options,password:'Test_123'}))proof.phase+=1;
          }else if(proof.phase===2&&r.source==='room'){
            if(send(r,'leave',{selected:r.current}))proof.phase=3;
          }else if(proof.phase===4&&r.source==='room'&&r.startable){
            if(!readyAt)readyAt=now;
            if(now-readyAt>3000&&send(r,'start',{selected:r.current}))proof.phase=5;
          }else if(proof.phase===4)readyAt=0;
        }else{
          if(proof.phase===0&&r.source==='list'){
            if(now-firstList<15000)return;
            if(send(r,'search',{value:0}))proof.phase=1;
          }else if(proof.phase===1&&r.source==='list'){
            const at=r.rows.findIndex(row=>row.host===hostName&&row.compatible&&row.players<row.maxPlayers);
            if(at<0){proof.phase=0;next=now+2000;return;}
            if(send(r,'join',{value:at,selected:r.rows[at],password:'Test_123'}))proof.phase=2;
          }else if(proof.phase===2&&r.source==='room'){
            if(send(r,'ready',{selected:r.current,value:0})){proof.phase=3;proof.readyOff=true;}
          }else if(proof.phase===3&&r.source==='room'&&!r.ready){
            if(send(r,'ready',{selected:r.current,value:1}))proof.phase=4;
          }else if(proof.phase===4&&r.source==='room'&&r.ready)proof.readyOn=true;
        }
      }catch(e){proof.errors.push(String(e.message??e));}
    },100);
  },{index,mode,hostName});
  return ()=>page.evaluate(()=>{const p=window.__raceActionsProof;clearInterval(p.timer);return {...p,timer:undefined};});
}
