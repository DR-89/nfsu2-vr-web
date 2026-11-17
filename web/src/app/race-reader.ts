// Copied original PC race data (runtime/web/racebrowser_proto.h). The guest
// owns the snapshot. The page owns one acknowledged command slot.
import type { GameMemory } from '../host/memory';
export const RACE_BYTES=106872, RACE_SNAPSHOT_BYTES=106540, RACE_MAGIC=0x31534252, RACE_VERSION=5;
const REQUEST_AT=106544, REQUEST_BYTES=328;
const ACTIONS={search:1,create:2,join:3,ready:4,start:5,leave:6,enter:7,exit:8} as const;
const RESULTS=['idle','accepted','invalid','stale','unavailable','busy','failed'] as const;
export interface RaceOptions {
  mode:number;track:number;laps:number;minPlayers:number;maxPlayers:number;
  reverse:boolean;collision:boolean;catchup:boolean;ranked:boolean;privateGame:boolean;unrestricted:boolean;
}
export interface RaceCommand {
  epoch:number;action:keyof typeof ACTIONS;value?:number;selected?:RaceRow;options?:RaceOptions;password?:string;
}
export interface RaceChoice {
  mode:number; track:number; reverse:boolean; minLaps:number; maxLaps:number; maxPlayers:number;
  name:string; reverseName:string;
}
export interface RaceRow {
  id:number; players:number; minPlayers:number; maxPlayers:number; customFlags:number; systemFlags:number; seed:number;
  name:string; host:string; params:string; parsed:boolean; compatible:boolean; mode:number; track:number; laps:number; reverse:boolean;
}
export interface RaceSnapshot {
  epoch:number;ack:number;result:typeof RESULTS[number];action:number;
  revision:number; catalogValid:boolean; lobbyValid:boolean; originalDialog:boolean; choices:RaceChoice[];
  canEnter:boolean; entryActive:boolean; fromCareer:boolean; entryBusy:boolean; canExit:boolean; entryFailed:boolean;
  source:'none'|'waiting'|'list'|'room'; listed:number; persona:string;
  host:boolean; ready:boolean; startable:boolean; current:RaceRow|null; rows:RaceRow[];
  players:{name:string;ready:boolean}[];
}
const MODES=new Set([0,1,2,3,4,10]);
/** A fresh copy on every successful read; holding or editing it cannot modify
 * the game or another caller's view. An odd/changing sequence returns null. */
export class RaceReader {
  private constructor(private memory:GameMemory,private ptr:number){}
  static open(memory:GameMemory,ptr:number,size:number):RaceReader|null {
    if(!Number.isInteger(ptr)||ptr<0||ptr%4||size!==RACE_BYTES||ptr>memory.buffer.byteLength-size)return null;
    const header=new Uint32Array(memory.buffer,ptr,4);
    return header[0]===RACE_MAGIC&&header[1]===RACE_VERSION&&header[2]===RACE_BYTES?new RaceReader(memory,ptr):null;
  }
  read():RaceSnapshot|null {
    if(this.ptr>this.memory.buffer.byteLength-RACE_BYTES)return null;
    const header=new Int32Array(this.memory.buffer,this.ptr,4),seq=Atomics.load(header,3)>>>0;
    if(seq&1)return null;
    const copy=new Uint8Array(this.memory.buffer,this.ptr,RACE_SNAPSHOT_BYTES).slice();
    if((Atomics.load(header,3)>>>0)!==seq)return null;
    return decodeRaceSnapshot(copy,seq);
  }
  /** Returns the command serial once queued, not a successful network reply.
   * Only the game can acknowledge it. Callers then observe the lobby/room. */
  send(command:RaceCommand):number|null {
    const snapshot=this.read();if(!snapshot||snapshot.epoch!==command.epoch)return null;
    const words=new Int32Array(this.memory.buffer,this.ptr+RACE_SNAPSHOT_BYTES,1);
    const previous=Atomics.load(words,0)>>>0;
    if(previous&1||previous!==snapshot.ack)return null;
    const packet=encodeRaceCommand(command);if(!packet)return null;
    const serial=((previous+2)>>>0)||2;
    Atomics.store(words,0,(serial-1)|0);
    new Uint8Array(this.memory.buffer,this.ptr+REQUEST_AT,REQUEST_BYTES).set(packet);
    Atomics.store(words,0,serial|0);
    packet.fill(0);return serial;
  }
}
export function encodeRaceCommand(c:RaceCommand):Uint8Array|null {
  try {
    const b=new Uint8Array(REQUEST_BYTES),d=new DataView(b.buffer);
    const u=(at:number,n:number)=>{if(!Number.isInteger(n)||n<0||n>0xffffffff)throw Error();d.setUint32(at,n,true);};
    const str=(at:number,n:number,s:string)=>{if(typeof s!=='string'||s.length>=n||[...s].some(c=>c.charCodeAt(0)>255||!c.charCodeAt(0)))throw Error();for(let i=0;i<s.length;i++)b[at+i]=s.charCodeAt(i);};
    if(!c.epoch||!Object.hasOwn(ACTIONS,c.action))return null;
    u(0,c.epoch);u(4,ACTIONS[c.action]);u(8,c.value??0);
    if(c.selected){const r=c.selected,at=12;
      [r.id,r.players,r.minPlayers,r.maxPlayers,r.customFlags,r.systemFlags,r.seed].forEach((n,i)=>u(at+i*4,n));
      str(at+28,36,r.name);str(at+64,16,r.host);str(at+80,132,r.params);
      [Number(r.parsed),Number(r.compatible),r.mode,r.track,r.laps,Number(r.reverse)].forEach((n,i)=>u(at+212+i*4,n));
    }
    if(['join','ready','start','leave'].includes(c.action)&&!c.selected)return null;
    if(c.options){const o=c.options;
      [o.mode,o.track,o.laps,o.minPlayers,o.maxPlayers,Number(o.reverse),Number(o.collision),Number(o.catchup),Number(o.ranked),Number(o.privateGame),Number(o.unrestricted)].forEach((n,i)=>u(248+i*4,n));
    }
    if(c.action==='create'&&!c.options)return null;
    const password=c.password??'';
    if(!/^[A-Za-z0-9_-]{0,32}$/.test(password)||(c.action==='create'&&password.length>12))return null;
    str(292,33,password);return b;
  }catch{return null;}
}
/** Exposed for wire fixtures; accepts only a complete, internally bounded copy. */
export function decodeRaceSnapshot(copy:Uint8Array,revision:number):RaceSnapshot|null {
  if(copy.byteLength!==RACE_BYTES&&copy.byteLength!==RACE_SNAPSHOT_BYTES)return null;
  const d=new DataView(copy.buffer,copy.byteOffset,copy.byteLength),u=(at:number)=>d.getUint32(at,true);
  if(u(0)!==RACE_MAGIC||u(4)!==RACE_VERSION||u(8)!==RACE_BYTES||u(12)!==revision||(revision&1))return null;
  const bool=(at:number)=>{const n=u(at);if(n>1)throw Error();return !!n;};
  const raw=(at:number,size:number)=>{const bytes=copy.slice(at,at+size),end=bytes.indexOf(0);if(end<0)throw Error();return bytes.slice(0,end);};
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const utf8=(at:number,size:number)=>{const s=decoder.decode(raw(at,size));if(/[\u0000-\u001f\u007f-\u009f\ufffe\uffff]/u.test(s))throw Error();return s;};
  const ascii=(at:number,size:number)=>{
    const b=raw(at,size);if(b.some(c=>c<32||c>126))throw Error();return String.fromCharCode(...b);
  };
  // DirtySock TagFields are Latin-1 (online/aries.rs), including room names.
  // Reject control bytes, while retaining accented names in a valid list.
  const line=(at:number,size:number,whitespace=false)=>{
    const b=raw(at,size);if(b.some(c=>(c<32||c>=127&&c<160)&&!(whitespace&&[9,10,13].includes(c))))throw Error();
    return String.fromCharCode(...b);
  };
  const name=(at:number)=>{const s=ascii(at,16);if(!/^[A-Za-z0-9_-]{3,15}$/.test(s))throw Error();return s;};
  const row=(at:number):RaceRow=>{
    const r:RaceRow={id:d.getInt32(at,true),players:u(at+4),minPlayers:u(at+8),maxPlayers:u(at+12),customFlags:u(at+16),systemFlags:u(at+20),seed:u(at+24),
      name:line(at+28,36),host:name(at+64),params:line(at+80,132,true),parsed:bool(at+212),compatible:bool(at+216),mode:u(at+220),track:u(at+224),laps:u(at+228),reverse:bool(at+232)};
    // PARAMS may use service whitespace; it is metadata, never markup or code.
    if(r.id<0||!r.name||r.maxPlayers>8||r.players>r.maxPlayers||r.minPlayers>r.maxPlayers)throw Error();
    if(r.parsed&&(!r.track||r.track>32767||r.laps<1||r.laps>10))throw Error();
    if(r.compatible&&(!r.parsed||!MODES.has(r.mode)||r.minPlayers<2||r.maxPlayers>6))throw Error();
    return r;
  };
  try {
    const catalogValid=bool(16),flags=u(20),lobbyValid=!!(flags&1),originalDialog=!!(flags&2),count=u(24),choices:RaceChoice[]=[],seen=new Set<string>();
    if(flags>255)return null;
    const canEnter=!!(flags&4),entryActive=!!(flags&8),fromCareer=!!(flags&16),entryBusy=!!(flags&32),canExit=!!(flags&64),entryFailed=!!(flags&128);
    if(canEnter&&entryActive||!entryActive&&(fromCareer||entryBusy||canExit||entryFailed))return null;
    if(count>128||catalogValid!==(count>0))return null;
    for(let i=0;i<count;i++){
      const at=28+i*792,t:RaceChoice={mode:u(at),track:u(at+4),reverse:bool(at+8),minLaps:u(at+12),maxLaps:u(at+16),maxPlayers:u(at+20),name:utf8(at+24,384),reverseName:utf8(at+408,384)};
      const key=`${t.mode}:${t.track}`;
      if(!MODES.has(t.mode)||!t.track||t.track>32767||t.minLaps<1||t.maxLaps<t.minLaps||t.maxLaps>10||t.maxPlayers<2||t.maxPlayers>6||seen.has(key))return null;
      seen.add(key);choices.push(t);
    }
    const at=101404,source=u(at),listed=u(at+4),n=u(at+8),host=bool(at+12),ready=bool(at+16),startable=bool(at+20),players=u(at+4996);
    if(source>3||listed>4096||n>20||n>listed||players>6||(!lobbyValid&&source!==0))return null;
    if((source!==2&&(listed||n))||(source!==3&&(players||host||ready||startable)))return null;
    const rows:RaceRow[]=[],ids=new Set<number>();
    for(let i=0;i<n;i++){const r=row(at+276+i*236);if(ids.has(r.id))return null;ids.add(r.id);rows.push(r);}
    const current=source===3?row(at+40):null,roster:{name:string;ready:boolean}[]=[];
    const who=source>=2?name(at+24):'';
    for(let i=0;i<players;i++)roster.push({name:name(at+5000+i*16),ready:!!(u(at+5096+i*4)&0x08000000)});
    if(current){
      const me=roster.filter(p=>p.name===who);
      if(!current.compatible||players!==current.players||!players||new Set(roster.map(p=>p.name)).size!==players||me.length!==1||current.host!==roster[0].name||
        host!==(who===roster[0].name)||ready!==me[0].ready||startable!==(host&&players>=current.minPlayers&&roster.slice(1).every(p=>p.ready)))return null;
    }
    const epoch=u(106524),ack=u(106528),result=u(106532),action=u(106536);
    if(ack&1||result>=RESULTS.length||action>8)return null;
    return {revision,epoch,ack,result:RESULTS[result],action,catalogValid,lobbyValid,originalDialog,canEnter,entryActive,fromCareer,entryBusy,canExit,entryFailed,choices,source:(['none','waiting','list','room'] as const)[source],listed,persona:who,host,ready,startable,current,rows,players:roster};
  }catch{return null;}
}
