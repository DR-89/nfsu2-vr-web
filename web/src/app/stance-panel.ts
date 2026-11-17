import {t,N} from './i18n';
import {vehicleFits} from '../vr/vehicle-fits';
import {stanceModels,STANCE_MIN,STANCE_MAX,STANCE_STEPS,type StanceValue} from '../vr/stance-models';
import type {StanceEdit,StancePrefs} from '../vr/stance-settings';
import type {DriverScene} from '../vr/drivers';

const FIELDS=[N('Front camber'),N('Rear camber'),N('Front offset'),N('Rear offset'),N('Tire width')];
interface Deps{read:()=>StancePrefs;save:(edit:StanceEdit)=>Promise<void>;readOnly:()=>boolean;scene?:()=>DriverScene|null}
/** Uses the same per-model values as the paused cockpit editor. The selection
 * is a page convenience; only actual car settings belong in the cloud profile. */
export class StancePanel{
  private model='350Z';
  private busy=false;
  private failed=false;
  constructor(private root:HTMLElement,private deps:Deps){this.render();}
  private async save(edit:StanceEdit):Promise<void>{
    if(this.busy||this.deps.readOnly())return;
    this.busy=true;this.failed=false;this.render();
    try{await this.deps.save(edit);}catch{this.failed=true;}
    finally{this.busy=false;this.render();}
  }
  render():void{
    const prefs=this.deps.read(),models=stanceModels(prefs.models)??{},scene=this.deps.scene?.();
    const ro=this.busy||this.deps.readOnly(),custom=Object.hasOwn(models,this.model);
    const value:StanceValue=models[this.model]??(scene?.local?.model===this.model?scene.stance?.value:undefined)??[0,0,0,0,100];
    const focus=(document.activeElement as HTMLElement|null)?.id;
    const box=document.createElement('div');box.className='group';
    const title=document.createElement('h3');title.textContent=t('Stance');title.id='stance-heading';
    box.setAttribute('role','group');box.setAttribute('aria-labelledby',title.id);box.append(title);
    const row=(label:string,id:string,control:HTMLElement,help='')=>{
      const r=document.createElement('div');r.className='set';
      const l=document.createElement('label');l.className='set-label';l.textContent=label;l.htmlFor=id;
      const h=document.createElement('p');h.className='set-help';h.id=id+'-help';h.textContent=help;
      const c=document.createElement('div');c.className='set-control';control.id=id;control.setAttribute('aria-describedby',h.id);c.append(control);r.append(l,h,c);box.append(r);return c;
    };
    const select=document.createElement('select');
    for(const name of [...new Set([...Object.keys(vehicleFits).filter(n=>n!=='DEFAULT'),...Object.keys(models)])].sort())select.add(new Option(name,name));
    select.value=this.model;select.disabled=ro;select.onchange=()=>{this.model=select.value;this.render();};
    row(t('Car model'),'stance-model',select,t('Saved per model. Garage settings are kept.'));
    const mode=document.createElement('select');for(const [v,label]of [['0',t('Default')],['1',t('Custom')]])mode.add(new Option(label,v));
    mode.value=custom?'1':'0';mode.disabled=ro;mode.onchange=()=>void this.save({model:this.model,value:mode.value==='1'?[...value]:null});
    row(t('Model default'),'stance-custom',mode,t('Visual changes only.'));
    FIELDS.forEach((label,i)=>{
      const input=document.createElement('input'),scale=i<2?10:1;
      input.type='number';input.min=String(STANCE_MIN[i]/scale);input.max=String(STANCE_MAX[i]/scale);input.step=String(STANCE_STEPS[i]/scale);
      input.value=String(value[i]/scale);input.disabled=ro;
      input.onchange=()=>{if(!input.reportValidity()||input.value==='')return;const next:StanceValue=[...value];next[i]=Math.round(Number(input.value)*scale);void this.save({model:this.model,value:next});};
      const c=row(t(label),`stance-value-${i}`,input),unit=document.createElement('span');unit.className='unit';unit.textContent=i<2?'°':i<4?'mm':'%';c.append(unit);
    });
    const reset=document.createElement('button');reset.type='button';reset.className='btn';reset.textContent=t('Reset this model');reset.disabled=ro||!custom;reset.onclick=()=>void this.save({model:this.model,value:null});
    const state=document.createElement('p');state.className='set-help';state.setAttribute('role','status');state.textContent=this.failed?t('Not saved: try again in a moment'):this.busy?'…':'';
    box.append(reset,state);this.root.replaceChildren(box);
    if(focus?.startsWith('stance-'))this.root.querySelector<HTMLElement>(`#${focus}`)?.focus();
  }
}
