import {t,N} from '../app/i18n';
import type {SpatialPad} from '../input/gamepad';
import {PAD_A,PAD_B,PAD_DUP,PAD_DDOWN,PAD_DLEFT,PAD_DRIGHT} from '../input/proto';
import type {DriverScene} from './drivers';
import type {StanceSettings} from './stance-settings';
import {STANCE_MIN,STANCE_MAX,STANCE_STEPS,type StanceValue} from './stance-models';
import type {ScreenOverlay} from './cinema';
import {identity} from './math';

const LABELS=[N('Stance'),N('Model default'),N('Front camber'),N('Rear camber'),N('Front offset'),N('Rear offset'),N('Tire width'),N('Reset this model'),N('Back')];
const NAV=(1<<PAD_DUP)|(1<<PAD_DDOWN)|(1<<PAD_DLEFT)|(1<<PAD_DRIGHT);
export class StanceMenu{
  open=false;
  row=0;
  private held=0;
  private blocked=true;
  private last=NaN;
  private repeat=0;
  private model='';
  private canvas:HTMLCanvasElement|null=null;
  private revision=0;
  private signature='';
  constructor(readonly settings:StanceSettings,private scene:()=>DriverScene|null){}
  show():void{this.open=true;this.row=0;this.blocked=true;this.last=NaN;this.settings.failed=false;}
  close():void{this.open=false;this.blocked=true;}
  view():{model:string;value:StanceValue}|null{
    const scene=this.scene(),model=scene?.local?.model;
    return model&&/^[A-Z0-9_]{1,15}$/.test(model)&&scene?.stance&&!scene.replay?{model,value:this.settings.models[model]??scene.stance.value}:null;
  }
  private change(delta:number):void{
    if(this.settings.busy)return;
    if(this.row===0){void this.settings.edit({enabled:!this.settings.enabled});return;}
    if(this.row===8){this.close();return;}
    const view=this.view();if(!view||view.model!==this.model)return;
    if(this.row===7||this.row===1&&Object.hasOwn(this.settings.models,this.model)){void this.settings.edit({model:this.model,value:null});return;}
    const value:StanceValue=[...view.value],i=this.row-2;
    if(i>=0&&i<5)value[i]=Math.min(STANCE_MAX[i],Math.max(STANCE_MIN[i],value[i]+delta*STANCE_STEPS[i]));
    void this.settings.edit({model:this.model,value});
  }
  sample(now:number|null,pad:SpatialPad|null):boolean{
    if(!this.open)return false;
    const keys=pad?.buttons??0,model=this.view()?.model??'';
    if(now===null||!Number.isFinite(now)){this.blocked=true;this.last=NaN;this.held=keys;return true;}
    if(now<this.last||now-this.last>250||model!==this.model)this.blocked=true;
    this.model=model;this.last=now;
    const edge=keys&~this.held;this.held=keys;
    if(this.blocked){if(!keys)this.blocked=false;return true;}
    if(edge&(1<<PAD_B)){this.close();return true;}
    const nav=keys&NAV;
    if(nav&&((edge&NAV)||now>=this.repeat)){
      this.repeat=now+((edge&NAV)?350:140);
      if(nav&(1<<PAD_DUP))this.row=(this.row+8)%9;
      else if(nav&(1<<PAD_DDOWN))this.row=(this.row+1)%9;
      else if(this.row<7)this.change(nav&(1<<PAD_DRIGHT)?1:-1);
    }
    if((edge&(1<<PAD_A))&&(this.row<2||this.row>6))this.change(1);
    return true;
  }
  overlay(height:number,forward:number):ScreenOverlay|null{
    if(!this.open)return null;
    const view=this.view(),custom=view&&Object.hasOwn(this.settings.models,view.model),value=view?.value??[0,0,0,0,100];
    const signature=JSON.stringify([view,custom,this.row,this.settings.enabled,this.settings.busy,this.settings.failed,t('Front camber')]);
    const canvas=this.canvas??=document.createElement('canvas');
    if(signature!==this.signature){
      this.signature=signature;this.revision++;canvas.width=1024;canvas.height=768;
      const g=canvas.getContext('2d')!;g.fillStyle='#141b24';g.fillRect(0,0,1024,768);g.fillStyle='#4da3ff';g.fillRect(0,0,1024,6);
      g.textBaseline='middle';g.fillStyle='#fff';g.font='bold 32px sans-serif';g.fillText(t('Stance'),40,44);
      g.font='24px sans-serif';g.fillStyle='#ffd79f';g.fillText(view?.model??t('Load a car in free roam or a race.'),40,100,940);
      const values=[t(this.settings.enabled?'On':'Off'),t(custom?'Custom':'Default'),`${(value[0]/10).toFixed(1)}°`,`${(value[1]/10).toFixed(1)}°`,`${value[2]} mm`,`${value[3]} mm`,`${value[4]} %`,'',''];
      for(let i=0;i<9;i++){
        const y=156+i*52;if(i===this.row){g.fillStyle='#214171';g.fillRect(24,y-24,976,48);}
        g.fillStyle=this.settings.busy||!view&&i>0&&i<8?'#78818f':'#f4f6fa';g.fillText(t(LABELS[i]),40,y,610);
        g.textAlign='right';g.fillText(values[i]?`‹ ${values[i]} ›`:'',980,y,330);g.textAlign='left';
      }
      g.font='21px sans-serif';g.fillStyle='#b8c5d6';g.fillText(t('Saved per model. Garage settings are kept.'),40,636,940);
      g.fillStyle=this.settings.failed?'#ff8888':'#b8c5d6';g.fillText(this.settings.failed?t('Not saved: try again in a moment'):this.settings.busy?'…':t('Visual changes only.'),40,676,940);
      g.fillStyle='#fff';g.fillText(`↑ ↓ · ← → · A     B · ${t('Back')}`,40,732,940);
    }
    const model=identity();model[0]=2.6;model[5]=1.95;model[13]=height;model[14]=-2.7-forward;
    return {canvas,revision:this.revision,model};
  }
  destroy():void{this.close();this.canvas=null;}
}
