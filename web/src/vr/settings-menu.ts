import {t,N} from '../app/i18n';
import {PAD_A,PAD_B,PAD_X,PAD_Y,PAD_DUP,PAD_DDOWN,PAD_DLEFT,PAD_DRIGHT} from '../input/proto';
import type {SpatialPad} from '../input/gamepad';
import {vrFields,type VRField} from './settings-fields';
import {vrSettings,type VRSettings} from './settings';
import {vrValues,applyVRValues} from './settings-values';
import {mirrorFields,mirrorKey,mirrorModel,mirrorFor} from './mirror-profiles';
import {communityFields,communityLive,communityRestart,type CommunitySettings} from './community-settings';
import {DEFAULTS} from '../app/settings';
import {identity} from './math';
import type {ScreenOverlay} from './cinema';
import {WorldMenu,type WorldMenuDeps} from './world-menu';
import type {StanceMenu} from './stance-menu';
import type {ConnectionMenu} from './connection-menu';
import type {RaceMenu} from './race-menu';

const INSIDE=new Map(mirrorFields.map(f=>[mirrorKey('DEFAULT',f),f]));
const ACTIONS=[N('Recenter view'),N('Reset mirrors'),N('Reset all settings'),N('Mods'),N('World'),N('Online profiles'),N('Race browser'),N('Back')];
const MOD_ACTIONS=[N('Reset all settings'),N('Stance'),N('Back')];
const NAV=(1<<PAD_DUP)|(1<<PAD_DDOWN)|(1<<PAD_DLEFT)|(1<<PAD_DRIGHT);
const VISIBLE=10;
/** The native X entry point owns input only while the game is in its menus.
 * Live edits share website validation and save once after a held adjustment. */
export class SettingsMenu {
  private vrFields=vrFields.filter(f=>f.key!=='vr_cockpit');
  private mods=false;
  private vrRow=0;
  get fields():VRField[]{return this.mods?communityFields:this.vrFields;}
  private get actions():string[]{return this.mods?MOD_ACTIONS.filter(a=>a!=='Stance'||this.stance):ACTIONS.filter(a=>(a!=='Mods'||this.community)&&(a!=='World'||this.worlds)&&(a!=='Online profiles'||this.connections)&&(a!=='Race browser'||this.races?.available));}
  readonly worlds:WorldMenu|null;
  open=false;
  available=false;
  row=0;
  vehicle='DEFAULT';
  private held=0;
  private repeat=0;
  private swallow=false;
  private last=NaN;
  private dirty:Record<string,string>={};
  private canvas:HTMLCanvasElement|null=null;
  private signature='';
  private revision=0;
  constructor(readonly settings:VRSettings,private save:(values:Record<string,string>)=>void,private recenter:()=>void,readonly community?:CommunitySettings,worlds?:WorldMenuDeps,readonly stance?:StanceMenu,readonly connections?:ConnectionMenu,readonly races?:RaceMenu){this.worlds=worlds?new WorldMenu(worlds):null;}
  get count():number{return this.fields.length+this.actions.length;}
  close():void{this.flush();this.worlds?.close();this.stance?.close();this.connections?.close();this.races?.close();this.open=false;this.swallow=true;}
  private back():void{if(this.mods){this.flush();this.mods=false;this.row=this.vrRow;}else this.close();}
  flush():void{if(Object.keys(this.dirty).length){const changed=this.dirty;this.dirty={};this.save(changed);}}
  private key(field:VRField):string{const f=INSIDE.get(field.key);return f?mirrorKey(this.vehicle,f):field.key;}
  values():Record<string,string>{if(this.mods)return {...this.community!.values};mirrorFor(this.settings,this.vehicle);return {...vrValues(this.settings),vr_mirror_vehicle:this.vehicle};}
  change(field:VRField,value:string):void{
    if(this.mods){Object.assign(this.dirty,this.community!.change({[field.key]:value}));return;}
    if(field.key==='vr_mirror_vehicle'){this.vehicle=mirrorModel(value);return;}
    Object.assign(this.dirty,applyVRValues(this.settings,{[this.key(field)]:value}));
  }
  private adjust(delta:number):void{
    const field=this.fields[this.row];if(!field)return;
    const c=field.c,current=this.values()[this.key(field)];
    if(c.t==='switch')this.change(field,current==='on'?'off':'on');
    else if(c.t==='num')this.change(field,String(Number(Math.min(c.max,Math.max(c.min,Number(current)+delta*c.step)).toFixed(5))));
    else {const i=c.opts.findIndex(([value])=>value===current),n=c.opts.length;this.change(field,c.opts[((i<0?0:i)+delta+n)%n][0]);}
  }
  private resetRow():void{
    const field=this.fields[this.row];if(!field||field.key==='vr_mirror_vehicle')return;
    if(this.mods){this.change(field,DEFAULTS.get(field.key)??'');return;}
    this.change(field,INSIDE.has(field.key)?'0':vrValues(vrSettings({}))[field.key]);
  }
  private activate():void{
    if(this.mods&&this.fields[this.row]?.key==='stance'&&this.stance){this.flush();this.stance.show();return;}
    if(this.row<this.fields.length){this.adjust(1);return;}
    if(this.mods){if(this.row===this.fields.length)Object.assign(this.dirty,this.community!.change(Object.fromEntries(communityFields.map(f=>[f.key,DEFAULTS.get(f.key)??'']))));else if(this.actions[this.row-this.fields.length]==='Stance'){this.flush();this.stance?.show();}else this.back();return;}
    switch(this.actions[this.row-this.fields.length]){
      case 'Recenter view':this.recenter();break;
      case 'Reset mirrors':Object.assign(this.dirty,applyVRValues(this.settings,Object.fromEntries(mirrorFields.map(f=>[mirrorKey(this.vehicle,f),'0']))));break;
      case 'Reset all settings':{const defaults=vrValues(vrSettings({}));for(const f of mirrorFields)delete defaults[mirrorKey('DEFAULT',f)];Object.assign(this.dirty,applyVRValues(this.settings,defaults));break;}
      case 'Mods':this.flush();this.vrRow=this.row;this.mods=true;this.row=0;break;
      case 'World':this.flush();this.worlds?.show();break;
      case 'Online profiles':this.flush();this.connections?.show();break;
      case 'Race browser':this.flush();this.races?.show();break;
      case 'Back':this.close();break;
    }
  }
  sample(now:number|null,available:boolean,pad:SpatialPad|null,model:string):boolean{
    this.available=available;
    if(now===null||!Number.isFinite(now)){this.flush();this.worlds?.sample(null,pad);this.stance?.sample(null,pad);this.connections?.sample(null,pad);this.races?.sample(null,pad);this.held=0;this.swallow=true;return this.open;}
    if(now<this.last||now-this.last>250){this.flush();this.held=pad?.buttons??0;this.swallow=true;}
    this.last=now;
    const keys=pad?.buttons??0,edge=keys&~this.held;this.held=keys;
    if(!available){if(this.open)this.close();if(!keys)this.swallow=false;return this.swallow&&(keys!==0);}
    if(this.worlds?.open){this.worlds.sample(now,pad);if(!this.worlds.open)this.swallow=true;return true;}
    if(this.stance?.open){this.stance.sample(now,pad);if(!this.stance.open)this.swallow=true;return true;}
    if(this.connections?.open){this.connections.sample(now,pad);if(!this.connections.open)this.swallow=true;return true;}
    if(this.races?.open){const owns=this.races.sample(now,pad);if(!this.races.open)this.swallow=true;return owns;}
    if(this.swallow){if(!keys)this.swallow=false;return true;}
    if(!this.open){
      if(edge&(1<<PAD_X)){this.open=true;this.vehicle=mirrorModel(model);this.repeat=now+350;return true;}
      return false;
    }
    if(edge&(1<<PAD_B)){this.back();return true;}
    if(edge&(1<<PAD_Y))this.resetRow();
    const nav=keys&NAV;
    if(nav&&((edge&NAV)||now>=this.repeat)){
      this.repeat=now+((edge&NAV)?350:140);
      if(nav&(1<<PAD_DUP)){this.flush();this.row=(this.row+this.count-1)%this.count;}
      else if(nav&(1<<PAD_DDOWN)){this.flush();this.row=(this.row+1)%this.count;}
      else this.adjust(nav&(1<<PAD_DRIGHT)?1:-1);
    }
    if(edge&(1<<PAD_A))this.activate();
    if(!(keys&(NAV|(1<<PAD_A)|(1<<PAD_Y))))this.flush();
    return true;
  }
  overlay():ScreenOverlay|null{
    if(!this.available&&!this.open)return null;
    if(this.worlds?.open)return this.worlds.overlay(this.settings.height,this.settings.forward);
    if(this.stance?.open)return this.stance.overlay(this.settings.height,this.settings.forward);
    if(this.connections?.open)return this.connections.overlay(this.settings.height,this.settings.forward);
    if(this.races?.open)return this.races.overlay(this.settings.height,this.settings.forward);
    const values=this.open?this.values():{},signature=JSON.stringify([this.open,this.mods,this.row,this.vehicle,values,t('Settings')]);
    const canvas=this.canvas??=document.createElement('canvas');
    if(signature!==this.signature){
      this.signature=signature;this.revision++;canvas.width=1024;canvas.height=this.open?768:80;
      const g=canvas.getContext('2d')!;g.fillStyle='#141b24';g.fillRect(0,0,canvas.width,canvas.height);g.fillStyle='#4da3ff';g.fillRect(0,0,1024,6);
      g.fillStyle='#fff';g.font='bold 32px sans-serif';g.textBaseline='middle';
      if(!this.open)g.fillText(`X · ${t('VR')} · ${t('Settings')}`,32,44);
      else{
        g.fillText(`${t('VR')} · ${t(this.mods?'Mods':'Settings')}`,32,44);g.font='20px sans-serif';g.textAlign='right';g.fillText(`${this.row+1} / ${this.count}`,992,44);g.textAlign='left';
        const first=Math.floor(this.row/VISIBLE)*VISIBLE,end=Math.min(first+VISIBLE,this.count);
        for(let i=first;i<end;i++){
          const y=104+(i-first)*52,field=this.fields[i];
          if(i===this.row){g.fillStyle='#214171';g.fillRect(24,y-24,944,48);}
          g.fillStyle='#f4f6fa';g.font='24px sans-serif';g.fillText(t(field?.label??this.actions[i-this.fields.length]),40,y,560);
          if(!field)continue;
          const c=field.c,value=values[this.key(field)],text=c.t==='switch'?t(value==='on'?'On':'Off'):c.t==='num'?`${value} ${c.unit}`:t(c.opts.find(([v])=>v===value)?.[1]??value);
          g.textAlign='right';g.fillStyle='#a9dbff';g.fillText(`‹ ${text} ›`,948,y,330);g.textAlign='left';
        }
        if(this.count>VISIBLE){
          const height=Math.max(32,464*(end-first)/this.count),top=104+(464-height)*first/(this.count-(end-first));
          g.fillStyle='#34455b';g.beginPath();g.roundRect(984,104,16,464,8);g.fill();
          g.fillStyle='#7dc4ff';g.beginPath();g.roundRect(984,top,16,height,8);g.fill();
          g.fillStyle=first>0?'#b3ddff':'#455269';g.beginPath();g.moveTo(992,80);g.lineTo(1000,92);g.lineTo(984,92);g.closePath();g.fill();
          g.fillStyle=end<this.count?'#b3ddff':'#455269';g.beginPath();g.moveTo(992,596);g.lineTo(984,584);g.lineTo(1000,584);g.closePath();g.fill();
        }
        const field=this.fields[this.row];g.font='20px sans-serif';g.fillStyle='#b8c5d6';
        const help=[field?.help?t(field.help):'',this.mods&&field&&!communityLive.has(field.key)?t(communityRestart):''].filter(Boolean).join(' ');
        if(help){const words=help.split(' ');let line='',y=644;for(const word of words){const next=line?line+' '+word:word;if(g.measureText(next).width>940){g.fillText(line,40,y,940);line=word;y+=24;if(y>684)break;}else line=next;}if(y<=684)g.fillText(line,40,y,940);}
        g.fillStyle='#fff';g.fillText(`↑ ↓ · ← → · A     B · ${t('Back')}     Y · ${t('Reset')}`,40,732,944);
      }
    }
    const model=identity();model[0]=this.open?2.6:1.9;model[5]=this.open?1.95:.1484375;
    model[13]=this.settings.height+(this.open?0:-1.42);model[14]=-2.7-this.settings.forward;
    return {canvas,revision:this.revision,model};
  }
  destroy():void{this.close();this.worlds?.destroy();this.stance?.destroy();this.connections?.destroy();this.races?.destroy();this.available=false;this.canvas=null;}
}
