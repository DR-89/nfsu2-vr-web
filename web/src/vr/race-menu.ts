import {t} from '../app/i18n';
import {RaceBrowser} from '../app/race-browser';
import {raceView,raceActivate,type RaceView} from '../app/race-view';
import {ControllerKeyboard} from './keyboard';
import {PAD_A,PAD_B,PAD_DUP,PAD_DDOWN,PAD_DLEFT,PAD_DRIGHT} from '../input/proto';
import type {SpatialPad} from '../input/gamepad';
import type {ScreenOverlay} from './cinema';
import {identity} from './math';

const NAV=(1<<PAD_DUP)|(1<<PAD_DDOWN)|(1<<PAD_DLEFT)|(1<<PAD_DRIGHT);
export class RaceMenu {
  open=false;row=0;
  private editing=false;
  private opening=false;
  private text='';
  private held=0;
  private blocked=true;
  private last=NaN;
  private repeat=0;
  private rows:string[]=[];
  private kind='';
  private canvas:HTMLCanvasElement|null=null;
  private signature='';
  private revision=0;
  readonly keyboard=new ControllerKeyboard(chars=>this.type(chars),()=>t('Lobby password'),(_kind,ch)=>/^[A-Za-z0-9_-]$/.test(ch));
  constructor(readonly manager:RaceBrowser,readonly gameLanguage:string){}
  get available():boolean{return this.open||this.manager.available;}
  show():void {
    this.manager.update();this.manager.cancel();this.open=true;this.opening=true;this.row=0;this.rows=[];this.kind='';this.blocked=true;this.last=NaN;
    if(this.manager.snapshot?.source==='list')this.manager.search(0);
  }
  close():void {if(this.open)this.manager.close();this.open=false;this.editing=false;this.text='';this.keyboard.destroy();this.blocked=true;}
  private type(chars:number[]):void {
    if(!this.editing)return;
    for(const ch of chars){
      if(ch===27){this.editing=false;this.text='';this.keyboard.destroy();this.blocked=true;break;}
      if(ch===13){this.manager.setPassword(this.text);this.editing=false;this.text='';this.keyboard.destroy();this.blocked=true;break;}
      if(ch===8)this.text=this.text.slice(0,-1);
      else if(ch>=32&&ch<127&&/^[A-Za-z0-9_-]$/.test(String.fromCharCode(ch))&&this.text.length<(this.manager.creating?12:32))this.text+=String.fromCharCode(ch);
    }
  }
  private view():RaceView {
    const view=raceView(this.manager,this.gameLanguage),rows=view.rows.map(r=>r.key);
    // A search/join temporarily publishes no rows. Keep logical selection
    // until its result, and never navigate the transient waiting view.
    if(this.manager.busy)return view;
    // Opening starts at the first result after the initial search. Later
    // refreshes preserve the player's selected row by identity.
    if(this.opening&&!this.manager.busy){this.opening=false;this.kind='';this.rows=[];}
    if(view.kind!==this.kind){this.kind=view.kind;this.row=0;this.rows=[];this.blocked=true;}
    if(this.rows.length&&rows.join('|')!==this.rows.join('|')){
      const at=rows.indexOf(this.rows[this.row]);this.row=Math.max(0,at);if(at<0)this.blocked=true;
    }
    this.rows=rows;this.row=Math.min(this.row,rows.length-1);return view;
  }
  sample(now:number|null,pad:SpatialPad|null):boolean {
    if(!this.open)return false;
    const keys=pad?.buttons??0;
    if(this.manager.snapshot?.originalDialog){
      this.editing=false;this.text='';this.keyboard.destroy();this.blocked=true;this.held=keys;return false;
    }
    if(now===null||!Number.isFinite(now)){
      this.text='';this.editing=false;this.manager.setPassword('');this.keyboard.sample(null,null,pad);this.blocked=true;this.last=NaN;this.held=keys;return true;
    }
    if(now<this.last||now-this.last>250)this.blocked=true;this.last=now;
    const edge=keys&~this.held;this.held=keys;
    if(this.editing&&(!this.manager.creating&&!this.manager.selected||this.manager.busy)){
      this.editing=false;this.text='';this.keyboard.destroy();this.blocked=true;
    }
    if(this.editing){this.keyboard.sample(now,{kind:5,max:this.manager.creating?12:32,text:this.text},pad);return true;}
    this.keyboard.sample(now,null,pad);
    const view=this.view();
    if(this.manager.busy){this.blocked=true;return true;}
    if(this.blocked){if(!keys)this.blocked=false;return true;}
    if(edge&(1<<PAD_B)){if(raceActivate(this.manager,'back')==='close')this.close();this.blocked=true;return true;}
    const nav=keys&NAV;
    if(nav&&((edge&NAV)||now>=this.repeat)){
      this.repeat=now+((edge&NAV)?350:140);
      if(nav&(1<<PAD_DUP))this.row=(this.row+view.rows.length-1)%view.rows.length;
      else if(nav&(1<<PAD_DDOWN))this.row=(this.row+1)%view.rows.length;
      else{const r=view.rows[this.row];if(r.field&&!r.disabled)this.manager.adjust(r.field,nav&(1<<PAD_DRIGHT)?1:-1);}
    }
    if(edge&(1<<PAD_A)){
      const r=view.rows[this.row];if(r.disabled)return true;
      const action=raceActivate(this.manager,r.key);
      if(action==='close')this.close();
      else if(action==='password'){this.editing=true;this.text=this.manager.passwordInput;}
    }
    return true;
  }
  overlay(height:number,forward:number):ScreenOverlay|null {
    if(!this.open||this.manager.snapshot?.originalDialog)return null;const keyboard=this.keyboard.overlay(height,forward);if(keyboard)return keyboard;
    const v=this.view(),signature=JSON.stringify([v,this.row,t('Back')]),canvas=this.canvas??=document.createElement('canvas');
    if(signature!==this.signature){
      this.signature=signature;this.revision++;canvas.width=1024;canvas.height=768;const g=canvas.getContext('2d')!;
      g.fillStyle='#141b24';g.fillRect(0,0,1024,768);g.fillStyle='#4da3ff';g.fillRect(0,0,1024,6);
      g.textBaseline='middle';g.fillStyle='#fff';g.font='bold 32px sans-serif';g.fillText(v.title,40,44,940);
      g.font='22px sans-serif';g.fillStyle='#b8c5d6';
      for(let i=0;i<v.lines.length;i++)g.fillText(v.lines[i],40,100+i*32,940);
      const selected=Math.min(this.row,v.rows.length-1),top=100+v.lines.length*32,visible=Math.max(3,Math.floor((652-top)/48)),first=Math.floor(selected/visible)*visible;
      for(let i=first;i<Math.min(first+visible,v.rows.length);i++){
        const row=v.rows[i],y=top+(i-first)*48;if(selected===i){g.fillStyle='#214171';g.fillRect(24,y-20,976,40);}
        g.fillStyle=row.disabled?'#78818f':'#fff';g.fillText(row.label,40,y,row.value?550:940);
        if(row.value){g.textAlign='right';g.fillStyle=row.disabled?'#78818f':'#a9dbff';g.fillText(row.field?`‹ ${row.value} ›`:row.value,980,y,400);g.textAlign='left';}
      }
      g.fillStyle='#ffd79f';g.fillText(v.notice,40,684,940);g.fillStyle='#fff';g.fillText(`↑ ↓ · ← → · A     B · ${t('Back')}`,40,732,820);
      g.textAlign='right';g.fillText(`${selected+1}/${v.rows.length}`,984,732);g.textAlign='left';
    }
    const model=identity();model[0]=2.6;model[5]=1.95;model[13]=height;model[14]=-2.7-forward;return{canvas,revision:this.revision,model};
  }
  destroy():void{this.close();this.canvas=null;}
}
