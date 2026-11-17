// Read-only integration check against the real PC catalogue and original
// Online menus. Does not create synthetic rooms or change guest memory.
export async function startRaceBrowserProbe(page){
  await page.waitForFunction(()=>!!window.__nfsu2?.session?.races,null,{timeout:120000});
  await page.evaluate(()=>{
    const session=window.__nfsu2.session;
    const p=window.__raceBrowserProof={catalog:0,catalogMatches:false,list:0,listed:0,room:0,roster:0,ready:0,startable:0,racingClear:0,
      sources:[],invalid:0,errors:[],diagnostic:null,timer:0};
    let catalogueChecked=false;
    p.timer=setInterval(()=>{
      const r=session.races?.read();if(!r){if(session.races)p.invalid++;return;}
      const d=new DataView(session.proc.memory.buffer),u=a=>d.getUint32(a,true);
      p.diagnostic={flow:u(0x8654a4),mode:u(0x850078),stage:u(0x8500d0),callback:u(0x86a864),pending:!!u(0x86a3d4),
        catalogueValid:r.catalogValid,lobbyValid:r.lobbyValid,source:r.source};
      if(!p.sources.includes(r.source)){p.sources.push(r.source);console.info('[race-browser-proof] '+r.source);}
      if(r.catalogValid&&!catalogueChecked){
        catalogueChecked=true;p.catalog=r.choices.length;
        const ptr=u(0x883da0),n=u(0x883da4),expected=[];
        if(n>512){p.errors.push('catalogue exceeds bound');return;}
        for(const [mode,mask]of [[0,1],[1,4],[2,2],[3,8],[4,0x2000],[10,0x800]])for(let i=0;i<n;i++){
          const at=ptr+i*0x128,id=d.getUint16(at+0x8a,true);
          if(id!==4000&&id!==4801&&!d.getUint8(at+0x88)&&(u(at+0x94)&mask))expected.push(`${mode}:${id}`);
        }
        p.catalogMatches=JSON.stringify(expected)===JSON.stringify(r.choices.map(t=>`${t.mode}:${t.track}`));
        if(!p.catalogMatches)p.errors.push('catalogue differs from loaded PC records');
        console.info('[race-browser-proof] catalogue '+p.catalog+' matches='+p.catalogMatches);
      }
      if(r.source==='list'){p.list++;p.listed=Math.max(p.listed,r.listed);}
      if(r.source==='room'){
        p.room++;p.roster=Math.max(p.roster,r.players.length);p.ready+=Number(r.ready);p.startable+=Number(r.startable);
        if(!r.current?.compatible)p.errors.push('room has no compatible race');
      }
      if(u(0x8654a4)===6&&r.source==='none'&&!r.rows.length&&!r.players.length)p.racingClear++;
    },100);
  });
  return ()=>page.evaluate(()=>{const p=window.__raceBrowserProof;clearInterval(p.timer);return {...p,timer:undefined};});
}
