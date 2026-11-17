import {checkSetting,putKey,resolveEnv} from '../app/settings';
import {stanceModels,stanceModelsValue,validStance,type StanceModels,type StanceValue} from './stance-models';

export type StanceEdit={enabled:boolean}|{model:string;value:StanceValue|null};
export interface StancePrefs{models:string;enabled:boolean}
export function stancePrefs(env:Record<string,string>):StancePrefs{
  const check=checkSetting('stance',env.NFSU2_STANCE??'off');
  return {models:stanceModelsValue(stanceModels(env.NFSU2_STANCE_MODELS??'v1')??{}),enabled:!!check?.ok&&check.value==='1'};
}
/** Apply one model edit to the newest file inside SettingsFile.edit, so another
 * model changed on the website is retained while an asynchronous save waits. */
export function editStance(text:string,edit:StanceEdit):{text:string;prefs:StancePrefs}{
  const env=resolveEnv(text,{},{}).env,prefs=stancePrefs(env);
  if('enabled'in edit){prefs.enabled=edit.enabled;text=putKey(text,'stance',edit.enabled?'on':'off').text;}
  else{
    if(!edit.model||edit.model.length>15||/[^A-Z0-9_]/.test(edit.model)||edit.value!==null&&!validStance(edit.value))throw new RangeError('invalid model stance');
    const models=stanceModels(prefs.models)!;
    if(edit.value)models[edit.model]=[...edit.value];else delete models[edit.model];
    const value=stanceModelsValue(models);if(!stanceModels(value))throw new RangeError('model stance limit');
    prefs.models=value;text=putKey(text,'stance_models',value).text;
  }
  return {text,prefs};
}

export class StanceSettings{
  models:StanceModels={};
  enabled=false;
  busy=false;
  failed=false;
  private revision=0;
  private ended=false;
  constructor(env:Record<string,string>,private save:(edit:StanceEdit)=>Promise<StancePrefs>,private publish:(models:string,enabled:boolean)=>void){
    const p=stancePrefs(env);this.models=stanceModels(p.models)!;this.enabled=p.enabled;
  }
  send():void{if(!this.ended)this.publish(stanceModelsValue(this.models),this.enabled);}
  enable(on:boolean):void{if(this.enabled!==on){this.enabled=on;this.revision++;this.send();}}
  sync(env:Record<string,string>):void{
    const p=stancePrefs(env);if(p.models===stanceModelsValue(this.models)&&p.enabled===this.enabled)return;
    this.models=stanceModels(p.models)!;this.enabled=p.enabled;this.revision++;this.send();
  }
  async edit(edit:StanceEdit):Promise<boolean>{
    if(this.ended||this.busy)return false;
    this.busy=true;this.failed=false;const rev=this.revision;
    try{
      const p=await this.save(edit);
      if(this.ended)return false;
      // A synchronous settings-file notification may already have published
      // this save or a newer website edit. Never replace that newer snapshot.
      if(rev===this.revision)this.sync({NFSU2_STANCE:p.enabled?'1':'0',NFSU2_STANCE_MODELS:p.models});
      return true;
    }catch{if(!this.ended)this.failed=true;return false;}
    finally{this.busy=false;}
  }
  destroy():void{this.ended=true;this.revision++;}
}
