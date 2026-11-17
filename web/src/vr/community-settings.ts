import {N} from '../app/i18n';
import {MODS} from '../app/mods';
import {MOD_CONTROLS,playerHeadlights,onlineCarLimit} from '../app/mod-controls';
import {checkSetting,DEFAULTS,keyDef} from '../app/settings';
import type {VRField} from './settings-fields';

export const communityFields:VRField[]=[playerHeadlights,...MODS.flatMap(m=>
  !m.pending&&!m.row&&'setting' in m.control?[{key:m.control.setting,label:m.name,help:m.line,c:MOD_CONTROLS[m.control.setting]??{t:'switch' as const}}]:[]),onlineCarLimit];
export const communityLive=new Set(['player_headlights','gps_distance','special_vinyls','gearbox_whine','stance','roam_max_cars']);
export const communityRestart=N('Applies the next time you press Play.');

function valueOf(key:string,env:Record<string,string>):string{
  const d=keyDef(key)!,v=env[d.env];
  if(v===undefined)return DEFAULTS.get(key)??'';
  const check=checkSetting(key,v);
  if(!check?.ok)return DEFAULTS.get(key)??'';
  if(d.kind==='bool')return check.value==='1'?'on':'off';
  return check.value;
}
/** Pending restart choices and live controls share the same profile keys. Only
 * the runtime-supported controls go to the game; no mutable environment. */
export class CommunitySettings{
  readonly values:Record<string,string>={};
  constructor(env:Record<string,string>,private publish:(lights:number,gps:boolean,special:boolean,whine:boolean)=>void,private stance?:(enabled:boolean)=>void,private cars?:(limit:number)=>void){
    for(const f of communityFields)this.values[f.key]=valueOf(f.key,env);
  }
  send():void{this.publish(['original','off','high'].indexOf(this.values.player_headlights),this.values.gps_distance==='on',this.values.special_vinyls==='on',this.values.gearbox_whine==='on');this.stance?.(this.values.stance==='on');this.cars?.(this.values.roam_max_cars==='auto'?-1:Number(this.values.roam_max_cars));}
  change(patch:Record<string,string>):Record<string,string>{
    const accepted:Record<string,string>={};
    for(const [key,value]of Object.entries(patch)){
      if(!Object.hasOwn(this.values,key))continue;
      const c=checkSetting(key,value);if(!c?.ok)continue;
      const v=keyDef(key)!.kind==='bool'?(c.value==='1'?'on':'off'):c.value;
      if(this.values[key]!==v)this.values[key]=accepted[key]=v;
    }
    if(Object.keys(accepted).some(key=>communityLive.has(key)))this.send();
    return accepted;
  }
  sync(before:Record<string,string>,after:Record<string,string>):void{
    const changed:Record<string,string>={};
    for(const f of communityFields)if(valueOf(f.key,before)!==valueOf(f.key,after))changed[f.key]=valueOf(f.key,after);
    this.change(changed);
  }
}
