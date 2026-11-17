import {t,tvars} from '../app/i18n';
import {checkRoom,sameName} from '../app/invite';
import {WORLDS,isOwn,worldName} from '../app/worlds';
import {ControllerKeyboard} from './keyboard';
import type {SpatialPad} from '../input/gamepad';
import {PAD_A,PAD_B,PAD_DUP,PAD_DDOWN} from '../input/proto';
import type {ScreenOverlay} from './cinema';
import {identity} from './math';

export interface WorldMenuDeps{
  /** Live room, or the saved room when this run has no free-roam endpoint. */
  read():{room:string;name:string};
  /** The page owns validation, persistence, ghost rules and the live change. */
  select(room:string):Promise<string>;
}

/** World selection shares the page's invitation path; it never writes the
 * network mailbox or settings itself. Mutations are edge-triggered and serial. */
export class WorldMenu{
  open=false;
  row=0;
  busy=false;
  notice='';
  private held=0;
  private blocked=true;
  private last=NaN;
  private repeat=0;
  private editing=false;
  private text='';
  private error='';
  private generation=0;
  private previousRooms:string[]=[];
  private canvas:HTMLCanvasElement|null=null;
  private revision=0;
  private signature='';
  readonly keyboard=new ControllerKeyboard(chars=>this.type(chars),()=>this.error||t('World name'));
  constructor(private deps:WorldMenuDeps){}
  get rooms():string[]{const {room}=this.deps.read();return ['',...WORLDS,...(isOwn(room)?[room]:[])];}
  show():void{
    this.open=true;this.row=Math.max(0,this.rooms.findIndex(r=>sameName(r,this.deps.read().room)));
    this.previousRooms=this.rooms;this.blocked=true;this.last=NaN;this.notice='';
  }
  close():void{this.open=false;this.editing=false;this.text=this.error='';this.keyboard.destroy();this.blocked=true;}
  private async choose(room:string):Promise<void>{
    if(this.busy)return;
    this.busy=true;this.notice='';const gen=this.generation;
    try{const message=await this.deps.select(room);if(gen===this.generation)this.notice=message;}
    catch{if(gen===this.generation)this.notice=t('Not saved: try again in a moment');}
    finally{if(gen===this.generation)this.busy=false;}
  }
  private type(chars:number[]):void{
    if(!this.editing||this.busy)return;
    for(const c of chars){
      if(c===27){this.editing=false;this.text=this.error='';this.blocked=true;break;}
      if(c===13){
        const checked=this.text.trim()?checkRoom(this.text):{ok:true as const,name:''};
        if(!checked.ok){this.error=checked.why?tvars(checked.why,checked.v??{}):t('World name');break;}
        this.editing=false;this.text=this.error='';this.blocked=true;void this.choose(checked.name);break;
      }
      if(c===8)this.text=this.text.slice(0,-1);
      else if(c>=32&&c<=255&&this.text.length<63)this.text+=String.fromCharCode(c);
      if(c)this.error='';
    }
  }
  sample(now:number|null,pad:SpatialPad|null):boolean{
    if(!this.open)return false;
    const keys=pad?.buttons??0;
    if(now===null||!Number.isFinite(now)){
      this.blocked=true;this.held=keys;this.last=NaN;this.keyboard.sample(null,null,pad);return true;
    }
    if(now<this.last||now-this.last>250)this.blocked=true;
    this.last=now;
    const edge=keys&~this.held;this.held=keys;
    if(this.editing){this.keyboard.sample(now,{max:63,kind:0,text:this.text},pad);return true;}
    // Captures the same A/B that finished text entry until its release.
    this.keyboard.sample(now,null,pad);
    if(this.blocked){if(!keys)this.blocked=false;return true;}
    if(edge&(1<<PAD_B)){this.close();return true;}
    const rooms=this.rooms,count=rooms.length+2;
    if(JSON.stringify(rooms)!==JSON.stringify(this.previousRooms)){
      // A website change can add/remove the own-world row. Keep commands and
      // worlds under the cursor rather than letting A select their replacement.
      if(this.row>=this.previousRooms.length)this.row+=rooms.length-this.previousRooms.length;
      else{const next=rooms.findIndex(r=>sameName(r,this.previousRooms[this.row]));this.row=Math.max(0,next);if(next<0)this.blocked=true;}
      this.previousRooms=rooms;
      if(this.blocked)return true;
    }
    this.row=Math.min(this.row,count-1);
    const nav=keys&((1<<PAD_DUP)|(1<<PAD_DDOWN));
    if(nav&&((edge&nav)||now>=this.repeat)){
      this.repeat=now+((edge&nav)?350:140);this.row=(this.row+count+(nav&(1<<PAD_DUP)?-1:1))%count;
    }
    if(edge&(1<<PAD_A)){
      if(this.row===count-1)this.close();
      else if(!this.busy&&this.row===rooms.length){this.editing=true;this.text=isOwn(this.deps.read().room)?this.deps.read().room:'';this.error='';}
      else if(!this.busy)void this.choose(rooms[this.row]);
    }
    return true;
  }
  overlay(height:number,forward:number):ScreenOverlay|null{
    if(!this.open)return null;
    const keyboard=this.keyboard.overlay(height,forward);if(this.editing&&keyboard)return keyboard;
    const state=this.deps.read(),rooms=this.rooms;
    const signature=JSON.stringify([state,rooms,this.row,this.busy,this.notice,t('World')]);
    const canvas=this.canvas??=document.createElement('canvas');
    if(signature!==this.signature){
      this.signature=signature;this.revision++;canvas.width=1024;canvas.height=768;
      const g=canvas.getContext('2d')!;g.fillStyle='#141b24';g.fillRect(0,0,1024,768);g.fillStyle='#4da3ff';g.fillRect(0,0,1024,6);
      g.textBaseline='middle';g.fillStyle='#fff';g.font='bold 32px sans-serif';g.fillText(`${t('Online')} · ${t('World')}`,40,44);
      g.font='24px sans-serif';g.fillStyle='#ffd79f';g.fillText(state.name,40,100,940);
      const labels=[...rooms.map(worldName),t('Own name…'),t('Back')];
      for(let i=0;i<labels.length;i++){
        const y=168+i*52;if(i===this.row){g.fillStyle='#214171';g.fillRect(24,y-24,976,48);}
        g.fillStyle=this.busy&&i<labels.length-1?'#78818f':'#f4f6fa';g.fillText(labels[i],40,y,870);
        if(i<rooms.length&&sameName(rooms[i],state.room)){g.fillStyle='#a9dbff';g.fillText('✓',950,y);}
      }
      g.fillStyle='#b8c5d6';g.font='22px sans-serif';g.fillText(this.busy?'…':this.notice,40,644,940);
      g.fillStyle='#fff';g.fillText(`↑ ↓ · A     B · ${t('Back')}`,40,724,940);
    }
    const model=identity();model[0]=2.6;model[5]=1.95;model[13]=height;model[14]=-2.7-forward;
    return {canvas,revision:this.revision,model};
  }
  destroy():void{this.close();this.generation++;this.busy=false;this.canvas=null;}
}
