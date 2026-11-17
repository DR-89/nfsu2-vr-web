import {t} from '../app/i18n';
import {ConnectionManager,CONNECTION_LABELS as L} from '../app/connection-manager';
import {ControllerKeyboard} from './keyboard';
import {PAD_A,PAD_B,PAD_DUP,PAD_DDOWN,PAD_DLEFT,PAD_DRIGHT} from '../input/proto';
import type {SpatialPad} from '../input/gamepad';
import type {ScreenOverlay} from './cinema';
import {identity} from './math';

const actions=['create','rename','room','remove','connect','disconnect','auth','manage','back'] as const;
type Edit='create'|'rename'|'room'|'auth';
const NAV=(1<<PAD_DUP)|(1<<PAD_DDOWN)|(1<<PAD_DLEFT)|(1<<PAD_DRIGHT);
export class ConnectionMenu{
  open=false;row=0;
  private editing:Edit|null=null;
  private editId='';
  private text='';
  private confirming=false;
  private guide=false;
  private guideRow=0;
  private yes=false;
  private held=0;
  private blocked=true;
  private last=NaN;
  private repeat=0;
  private rows:string[]=[];
  private canvas:HTMLCanvasElement|null=null;
  private revision=0;
  private signature='';
  readonly keyboard=new ControllerKeyboard(chars=>this.type(chars),()=>t(this.editing?L[this.editing]:L.title));
  constructor(readonly manager:ConnectionManager){}
  show():void{this.open=true;this.row=Math.max(0,this.manager.current?.profiles.findIndex(p=>p.id===this.manager.current?.selected)??0);this.blocked=true;this.last=NaN;this.rows=[];void this.manager.refresh();}
  close():void{this.open=false;this.editing=null;this.editId=this.text='';this.confirming=this.guide=false;this.keyboard.destroy();this.blocked=true;}
  private type(chars:number[]):void{
    if(!this.editing||this.manager.busy)return;
    const max=this.editing==='auth'?255:this.editing==='room'?63:15;
    for(const ch of chars){
      if(ch===27){this.editing=null;this.text='';this.keyboard.destroy();this.blocked=true;break;}
      if(ch===13){const action=this.editing,text=this.text;this.editing=null;this.text='';this.keyboard.destroy();this.blocked=true;
        if(action==='auth')void this.manager.link(this.editId,text);
        else if(action==='create')void this.manager.edit({action,name:text});
        else void this.manager.edit({action,id:this.editId,text});break;
      }
      if(ch===8)this.text=this.text.slice(0,-1);else if(ch>=32&&ch<=255&&this.text.length<max)this.text+=String.fromCharCode(ch);
    }
  }
  sample(now:number|null,pad:SpatialPad|null):boolean{
    if(!this.open)return false;
    const keys=pad?.buttons??0;
    if(now===null||!Number.isFinite(now)){this.blocked=true;this.last=NaN;this.held=keys;this.keyboard.sample(null,null,pad);return true;}
    if(now<this.last||now-this.last>250)this.blocked=true;this.last=now;
    const edge=keys&~this.held;this.held=keys;
    if(this.editing){this.keyboard.sample(now,{kind:this.editing==='auth'?5:0,max:this.editing==='auth'?255:this.editing==='room'?63:15,text:this.text},pad);return true;}
    this.keyboard.sample(now,null,pad);
    const c=this.manager.current,list=c?.profiles??[],rows=[...list.map(p=>p.id),...actions];
    if(this.rows.length&&rows.join('|')!==this.rows.join('|')){const at=rows.indexOf(this.rows[this.row]);this.row=Math.max(0,at);if(at<0)this.blocked=true;}this.rows=rows;
    if(this.blocked){if(!keys)this.blocked=false;return true;}
    if(edge&(1<<PAD_B)){if(this.confirming||this.guide){this.confirming=this.guide=false;this.blocked=true;}else this.close();return true;}
    const nav=keys&NAV;if(nav&&((edge&NAV)||now>=this.repeat)){
      this.repeat=now+((edge&NAV)?350:140);
      if(this.guide)this.guideRow=1-this.guideRow;
      else if(this.confirming)this.yes=!this.yes;
      else if(nav&(1<<PAD_DUP))this.row=(this.row+rows.length-1)%rows.length;
      else if(nav&(1<<PAD_DDOWN))this.row=(this.row+1)%rows.length;
    }
    if(!(edge&(1<<PAD_A))||this.manager.busy)return true;
    if(this.guide){
      this.guide=false;this.blocked=true;
      if(this.guideRow===0&&c?.selected){this.editing='auth';this.editId=c.selected;this.text='';}
      return true;
    }
    if(this.confirming){this.confirming=false;if(this.yes)void this.manager.edit({action:'delete',id:this.editId});this.blocked=true;return true;}
    if(this.row<list.length){void this.manager.edit({action:'select',id:list[this.row].id});return true;}
    const action=actions[this.row-list.length],p=list.find(p=>p.id===c?.selected);
    if(action==='back'){this.close();return true;}
    if(action==='disconnect'){void this.manager.disconnect();return true;}
    if(action==='create'||p){
      if(action==='connect')void this.manager.connect();
      else if(action==='manage'){this.guide=true;this.guideRow=0;void this.manager.manage();}
      else if(action==='remove'){this.confirming=true;this.yes=false;this.editId=p!.id;}
      else{this.editing=action;this.editId=p?.id??'';this.text=action==='rename'?p!.name:action==='room'?p!.room:'';}
    }
    return true;
  }
  overlay(height:number,forward:number):ScreenOverlay|null{
    if(!this.open)return null;const keyboard=this.keyboard.overlay(height,forward);if(keyboard)return keyboard;
    const c=this.manager.current,list=c?.profiles??[],signature=JSON.stringify([c,this.row,this.confirming,this.yes,this.guide,this.guideRow,this.manager.busy,this.manager.message,[...this.manager.linked],t(L.title)]);
    const canvas=this.canvas??=document.createElement('canvas');
    if(signature!==this.signature){this.signature=signature;this.revision++;canvas.width=1024;canvas.height=768;const g=canvas.getContext('2d')!;
      g.fillStyle='#141b24';g.fillRect(0,0,1024,768);g.fillStyle='#4da3ff';g.fillRect(0,0,1024,6);g.font='bold 32px sans-serif';g.fillStyle='#fff';g.textBaseline='middle';g.fillText(t(L.title),40,44);
      g.font='22px sans-serif';
      if(this.guide){
        g.fillText(t(L.manage),40,120,940);g.fillStyle='#b8c5d6';let line='',y=184;
        for(const ch of this.manager.notice){if(g.measureText(line+ch).width>940){g.fillText(line,40,y);line='';y+=32;}line+=ch;}if(line)g.fillText(line,40,y);
        g.fillStyle='#214171';g.fillRect(24,506+this.guideRow*56,976,48);g.fillStyle='#fff';g.fillText(t(L.auth),40,530);g.fillText(t('Back'),40,586);
      }
      else if(this.confirming){g.fillText(t('Delete this connection profile? Your career is kept.'),40,160,940);g.fillStyle='#214171';g.fillRect(this.yes?520:24,320,464,64);g.fillStyle='#fff';g.fillText(t('Cancel'),40,352);g.fillText(t('Delete'),540,352);}
      else{
        const labels=[...list.map(p=>p.name+(p.id===c?.selected?' ✓':'')+(this.manager.linked.has(p.id)?' · '+t('Linked'):'')),...actions.map(a=>a==='back'?t('Back'):t(L[a]))];
        for(let i=0;i<labels.length;i++){const y=104+i*30;if(this.row===i){g.fillStyle='#214171';g.fillRect(24,y-14,976,29);}g.fillStyle=this.manager.busy?'#78818f':'#fff';g.fillText(labels[i],40,y,940);}
        const p=list.find(p=>p.id===c?.selected);g.fillStyle='#ffd79f';g.fillText(t('World')+': '+(p?.room||t('Default')),40,644,940);
      }
      if(!this.guide){g.fillStyle='#b8c5d6';g.fillText(this.manager.message,40,686,940);}g.fillStyle='#fff';g.fillText(`↑ ↓ · A     B · ${t('Back')}`,40,732);
    }
    const model=identity();model[0]=2.6;model[5]=1.95;model[13]=height;model[14]=-2.7-forward;return {canvas,revision:this.revision,model};
  }
  destroy():void{this.close();this.canvas=null;}
}
