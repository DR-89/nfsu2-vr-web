import {t} from '../app/i18n';
import {takes,secret,ACCEPT_TEXT} from '../app/textentry';
import {cp1252} from '../input/keymap';
import type {TextEntry} from '../input/index';
import type {SpatialPad} from '../input/gamepad';
import {PAD_A,PAD_B,PAD_X,PAD_Y,PAD_DUP,PAD_DDOWN,PAD_DLEFT,PAD_DRIGHT} from '../input/proto';
import {identity} from './math';
import type {ScreenOverlay} from './cinema';

// The native 4 x 10 controller keyboard, with the PC text field's character
// filter. The extra Latin banks cover every printable byte the PC permits.
export const KEY_BANKS=[
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
  'abcdefghijklmnopqrstuvwxyz0123456789_-',
  ' .,_@-`=[]\\;\'/<>?:"{}|+()*&%#!~',
  Array.from({length:32},(_,i)=>String.fromCharCode(0xc0+i)).join(''),
  Array.from({length:32},(_,i)=>String.fromCharCode(0xe0+i)).join(''),
];
const NAV=(1<<PAD_DUP)|(1<<PAD_DDOWN)|(1<<PAD_DLEFT)|(1<<PAD_DRIGHT);
export class ControllerKeyboard{
  key=0;
  bank=0;
  private entry:TextEntry|null=null;
  private held=0;
  private blocked=false;
  private last=NaN;
  private repeat=0;
  private reveal=false;
  private canvas:HTMLCanvasElement|null=null;
  private revision=0;
  private signature='';
  constructor(private send:(chars:number[])=>void,private label:()=>string=()=>t('Text for the game'),private filter:(kind:number,ch:string)=>boolean=takes){}
  get active():boolean{return this.entry!==null;}
  private length():number{return this.entry?.length??this.entry?.text.length??0;}
  shown():string{
    const e=this.entry;if(!e)return '';
    return secret(e.kind)&&!this.reveal?'•'.repeat(this.length()):e.text+(this.length()>e.text.length?'…':'');
  }
  allowed(key:number):boolean{
    if(!this.entry)return false;
    if(key===38)return this.length()>0;
    if(key===39)return true;
    const ch=KEY_BANKS[this.bank]?.[key];
    return !!ch&&this.length()<this.entry.max&&this.filter(this.entry.kind,ch);
  }
  private clear():void{
    this.entry=null;this.reveal=false;this.signature='';
    // Clear revealed text even if tracking disappears before another redraw.
    if(this.canvas)this.canvas.width=0;
  }
  sample(now:number|null,entry:TextEntry|null,pad:SpatialPad|null):boolean{
    const keys=pad?.buttons??0;
    if(now===null||!Number.isFinite(now)){this.clear();this.blocked=true;this.held=keys;this.last=NaN;return false;}
    if(now<this.last||now-this.last>250)this.blocked=true;
    this.last=now;
    if(entry&&(!Number.isInteger(entry.max)||entry.max<1||entry.max>255||!Number.isInteger(entry.kind)||entry.kind<0||entry.kind>6))entry=null;
    const edge=keys&~this.held;this.held=keys;
    if(!entry){
      if(this.active){this.clear();this.blocked=true;}
      if(!keys)this.blocked=false;
      return this.blocked&&!!keys;
    }
    if(!this.entry||entry.kind!==this.entry.kind||entry.max!==this.entry.max){
      this.key=this.bank=0;this.blocked=true;
    }
    this.entry={...entry,text:entry.text.slice(0,96),length:Math.min(entry.max,Math.max(0,entry.length??entry.text.length))};
    if(this.blocked){this.reveal=false;if(!keys)this.blocked=false;return true;}
    this.reveal=!!(keys&(1<<PAD_Y));
    if(edge&(1<<PAD_B)){this.send([27]);this.reveal=false;return true;}
    if(edge&(1<<PAD_X))for(let i=0;i<KEY_BANKS.length;i++){
      this.bank=(this.bank+1)%KEY_BANKS.length;if([...KEY_BANKS[this.bank]].some(ch=>this.filter(entry.kind,ch)))break;
    }
    if((keys&NAV)&&((edge&NAV)||now>=this.repeat)){
      this.repeat=now+((edge&NAV)?350:140);
      if(keys&(1<<PAD_DUP))this.key=(this.key+30)%40;
      else if(keys&(1<<PAD_DDOWN))this.key=(this.key+10)%40;
      else this.key=Math.floor(this.key/10)*10+(this.key+(keys&(1<<PAD_DRIGHT)?1:9))%10;
    }
    if((edge&(1<<PAD_A))&&this.allowed(this.key)){
      if(this.key===39)this.send([...ACCEPT_TEXT]);
      else this.send([this.key===38?8:cp1252(KEY_BANKS[this.bank].charCodeAt(this.key))]);
    }
    return true;
  }
  overlay(height:number,forward:number):ScreenOverlay|null{
    if(!this.entry)return null;
    const shown=this.shown(),label=this.label(),signature=JSON.stringify([shown,label,this.entry.kind,this.entry.max,this.length(),this.key,this.bank,t('Keyboard')]);
    const canvas=this.canvas??=document.createElement('canvas');
    if(signature!==this.signature){
      this.signature=signature;this.revision++;canvas.width=1024;canvas.height=768;
      const g=canvas.getContext('2d')!;g.fillStyle='#141b24';g.fillRect(0,0,1024,768);g.fillStyle='#4da3ff';g.fillRect(0,0,1024,6);
      g.textBaseline='middle';g.fillStyle='#fff';g.font='bold 32px sans-serif';g.fillText(`${t('VR')} · ${t('Keyboard')}`,40,44);
      g.font='20px sans-serif';g.fillStyle='#b8c5d6';g.fillText(label,40,96,790);
      g.textAlign='right';g.fillText(`${this.length()} / ${this.entry.max}`,984,96);g.textAlign='left';
      g.fillStyle='#102333';g.fillRect(32,128,960,96);g.fillStyle='#ffd79f';g.font='28px monospace';
      g.fillText(shown.slice(0,54),48,156,928);g.fillText(shown.slice(54,108),48,196,928);
      g.font='28px sans-serif';g.textAlign='center';
      for(let i=0;i<40;i++){
        const x=40+(i%10)*94,y=272+Math.floor(i/10)*68,ch=KEY_BANKS[this.bank][i]??'';
        g.fillStyle=i===this.key?'#214171':'#2b3038';g.fillRect(x,y,82,54);
        g.fillStyle=this.allowed(i)?'#fff':'#78818f';
        g.fillText(i===38?'⌫':i===39?t('OK'):ch===' '?'␣':ch,x+41,y+27,76);
      }
      g.textAlign='left';g.font='22px sans-serif';g.fillStyle='#b8c5d6';
      if(secret(this.entry.kind))g.fillText(t('Hold Y to show.'),40,600,940);
      g.fillText(`↑ ↓ ← → · A     X · ABC / abc / # / À / à`,40,664,940);
      g.fillText(`⌫ · ${t('Delete')}     OK · ${t('OK')}     B · ${t('Cancel')}`,40,716,940);
    }
    const model=identity();model[0]=2.6;model[5]=1.95;model[13]=height;model[14]=-2.65-forward;
    return {canvas,revision:this.revision,model};
  }
  destroy():void{this.clear();this.canvas=null;this.held=0;this.blocked=true;}
}
