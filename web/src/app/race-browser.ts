import type {RaceCommand,RaceOptions,RaceRow,RaceSnapshot} from './race-reader';

export interface RaceBrowserPort {
  read():RaceSnapshot|null;
  send(command:RaceCommand):number|null;
}
export const RACE_PAGE=20;
/** Occupancy is live; every other field identifies the selected service record.
 * Reusing a list index after a refresh must never join a different race. */
export function raceKey(r:RaceRow):string {
  return JSON.stringify([r.id,r.seed,r.name,r.host,r.params,r.minPlayers,r.maxPlayers,r.customFlags,r.systemFlags]);
}
export function joinable(r:RaceRow):boolean {
  return r.compatible&&r.players>0&&r.players<r.maxPlayers&&!(r.systemFlags&0x80000);
}
const defaults=():RaceOptions=>({mode:0,track:0,laps:2,minPlayers:2,maxPlayers:6,reverse:false,
  collision:true,catchup:true,ranked:false,privateGame:false,unrestricted:true});
export type RaceFormField='mode'|'track'|'reverse'|'laps'|'minPlayers'|'maxPlayers'|'collision'|'catchup';

/** Website and headset share selection, command ownership and PC track rules.
 * Secrets exist only while editing and are cleared on submit or context loss.
 * An accepted command is a receipt; the next original lobby state is authoritative. */
export class RaceBrowser {
  snapshot:RaceSnapshot|null=null;
  selected:RaceRow|null=null;
  creating=false;
  options=defaults();
  page=0;
  notice:RaceSnapshot['result']='idle';
  private password='';
  private observed:RaceSnapshot|null=null;
  private pending:{serial:number;action:RaceCommand['action'];page:number}|null=null;
  private preparing=false;
  private generation=0;
  constructor(private port:()=>RaceBrowserPort|null,private prepare:()=>Promise<boolean>=async()=>false,private message:()=>string=()=>'',private name:()=>string=()=>''){}
  get available():boolean {const s=this.snapshot;return !!s&&(s.canEnter||s.entryActive||s.lobbyValid&&['list','room'].includes(s.source));}
  get entryNotice():string{return this.message();}
  get profileName():string{return this.name();}
  get canEnter():boolean{return !!this.snapshot?.canEnter&&!this.preparing&&!this.pending&&!this.snapshot.originalDialog;}
  get canExit():boolean{return !!this.snapshot?.canExit&&!this.preparing&&!this.pending&&!this.snapshot.originalDialog;}
  async enter():Promise<boolean>{
    if(!this.canEnter)return false;
    const generation=++this.generation,epoch=this.snapshot!.epoch;this.preparing=true;this.notice='idle';
    try{
      if(!await this.prepare()||generation!==this.generation)return false;
      this.update();
      if(this.snapshot?.epoch!==epoch||!this.snapshot.canEnter){this.notice='stale';return false;}
      return this.send('enter');
    }catch{this.notice='failed';return false;}
    finally{if(generation===this.generation)this.preparing=false;}
  }
  exit():boolean {return this.canExit&&this.send('exit');}
  get busy():boolean{const s=this.snapshot;return this.preparing||!!this.pending||!s||s.originalDialog||s.entryBusy||!s.canEnter&&!s.canExit&&(!s.lobbyValid||!['list','room'].includes(s.source));}
  get canCreate():boolean{return !this.busy&&this.snapshot?.source==='list'&&!!this.snapshot.choices.length;}
  get hasPassword():boolean{return !!this.password;}
  get passwordLength():number{return this.password.length;}
  /** Only for the local password editor, never a published race snapshot. */
  get passwordInput():string{return this.password;}
  get pendingSerial():number{return this.pending?.serial??0;}
  update():void {
    const next=this.port()?.read()??null,old=this.observed;
    this.snapshot=next;
    // An odd shared-memory read can be retried. Hide it, but do not lose a
    // submitted command or permit a second writer into its slot.
    if(!next)return;
    this.observed=next;
    if(this.pending&&next.ack===this.pending.serial){
      this.notice=next.result;
      if(next.result==='accepted'&&this.pending.action==='search')this.page=this.pending.page;
      this.pending=null;
    }
    const changed=!old||next.epoch!==old.epoch||next.source!==old.source;
    if(changed||!next.lobbyValid){
      if(next.source!=='list'||old?.epoch!==next.epoch){this.cancel();}
      if(next.source==='list'&&old?.source!=='waiting')this.page=0;
    }
    if(this.selected){
      const key=raceKey(this.selected),fresh=next.rows.find(r=>raceKey(r)===key);
      if(next.source==='list'&&fresh)this.selected={...fresh};
      else{this.selected=null;this.password='';this.notice='stale';}
    }
    if(this.creating&&!next.choices.some(t=>t.mode===this.options.mode&&t.track===this.options.track))this.cancel();
  }
  cancel():void{this.selected=null;this.creating=false;this.password='';this.options=defaults();}
  close():void{this.generation++;this.preparing=false;this.cancel();this.notice='idle';}
  select(key:string):boolean {
    if(this.busy||this.snapshot?.source!=='list')return false;
    const row=this.snapshot.rows.find(r=>raceKey(r)===key);if(!row)return false;
    this.cancel();this.selected={...row};this.notice='idle';return true;
  }
  beginCreate():boolean {
    if(!this.canCreate)return false;
    this.cancel();this.creating=true;this.notice='idle';this.choose(0);return true;
  }
  setPassword(value:string):boolean {
    if(this.busy||(!this.creating&&!this.selected)||!/^[A-Za-z0-9_-]*$/.test(value)||value.length>(this.creating?12:32))return false;
    this.password=value;return true;
  }
  private choose(index:number):void {
    const t=this.snapshot?.choices[index];if(!t)return;
    const o=this.options;o.mode=t.mode;o.track=t.track;
    if(!t.reverse)o.reverse=false;
    o.laps=Math.min(t.maxLaps,Math.max(t.minLaps,o.laps));
    o.maxPlayers=Math.min(t.maxPlayers,Math.max(2,o.maxPlayers));o.minPlayers=Math.min(o.maxPlayers,Math.max(2,o.minPlayers));
    if(o.mode===3||o.mode===10)o.catchup=false;
  }
  adjust(field:RaceFormField,step:number):void {
    if(!this.creating||this.busy||!step||!Number.isFinite(step))return;
    step=step<0?-1:1;
    const list=this.snapshot!.choices,o=this.options,at=list.findIndex(t=>t.mode===o.mode&&t.track===o.track),t=list[at];
    if(!t)return;
    const cycle=(value:number,min:number,max:number)=>min+(value-min+max-min+1+step)%(max-min+1);
    if(field==='mode'||field==='track'){
      for(let n=1;n<=list.length;n++){const index=(at+n*step+list.length)%list.length;
        if(field==='mode'?list[index].mode!==o.mode:list[index].mode===o.mode){this.choose(index);break;}}
    }else if(field==='reverse'){if(t.reverse)o.reverse=!o.reverse;}
    else if(field==='laps')o.laps=cycle(o.laps,t.minLaps,t.maxLaps);
    else if(field==='minPlayers')o.minPlayers=cycle(o.minPlayers,2,o.maxPlayers);
    else if(field==='maxPlayers'){o.maxPlayers=cycle(o.maxPlayers,2,t.maxPlayers);o.minPlayers=Math.min(o.minPlayers,o.maxPlayers);}
    else if(field==='collision')o.collision=!o.collision;
    else if(field==='catchup'&&o.mode!==3&&o.mode!==10)o.catchup=!o.catchup;
  }
  private send(action:RaceCommand['action'],extra:Partial<RaceCommand>={}):boolean {
    const s=this.snapshot;if(!s||this.pending||s.originalDialog)return false;
    if(action==='enter'? !s.canEnter : action==='exit'? !s.canExit : this.busy||!s.lobbyValid||!['list','room'].includes(s.source))return false;
    const serial=this.port()?.send({epoch:s.epoch,action,...extra});
    if(!serial){this.notice='busy';return false;}
    this.pending={serial,action,page:action==='search'?extra.value??0:this.page};this.notice='idle';return true;
  }
  search(page=this.page):boolean {
    if(this.snapshot?.source!=='list'||!Number.isInteger(page)||page<0||page>4080||page%RACE_PAGE)return false;
    if(!this.send('search',{value:page}))return false;this.cancel();return true;
  }
  create():boolean {
    if(!this.creating||!this.canCreate)return false;
    const ok=this.send('create',{options:{...this.options},password:this.password});
    if(ok)this.cancel();return ok;
  }
  join():boolean {
    if(!this.selected||this.snapshot?.source!=='list'||!joinable(this.selected))return false;
    const key=raceKey(this.selected),index=this.snapshot.rows.findIndex(r=>raceKey(r)===key);
    if(index<0)return false;
    const ok=this.send('join',{value:index,selected:{...this.selected},password:this.password});
    if(ok)this.cancel();return ok;
  }
  ready(value=!this.snapshot?.ready):boolean {return !!this.snapshot?.current&&this.send('ready',{selected:{...this.snapshot.current},value:value?1:0});}
  start():boolean {return !!this.snapshot?.startable&&!!this.snapshot.current&&this.send('start',{selected:{...this.snapshot.current}});}
  leave():boolean {return !!this.snapshot?.current&&this.send('leave',{selected:{...this.snapshot.current}});}
}
