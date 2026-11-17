/** Native Stance editor values: tenths of a degree, millimetres, percent.
 * A model default overrides a garage entry visually without deleting it. */
export type StanceValue=[number,number,number,number,number];
export type StanceModels=Record<string,StanceValue>;
export const STANCE_MIN=[0,0,-40,-40,80],STANCE_MAX=[150,150,80,80,130];
export const STANCE_STEPS=[5,5,1,1,1];
export function validStance(value:unknown):value is StanceValue{
  return Array.isArray(value)&&value.length===5&&value.every((v,i)=>Number.isInteger(v)&&v>=STANCE_MIN[i]&&v<=STANCE_MAX[i]);
}
export function stanceModels(text:string):StanceModels|null{
  if(text.length>=4096)return null;
  const out:StanceModels=Object.create(null);
  if(!text)return out;
  const [version,...rows]=text.split('|');if(version!=='v1'||rows.length>46)return null;
  for(const row of rows){
    const match=/^([A-Z0-9_]{1,15}):(-?\d{1,3}),(-?\d{1,3}),(-?\d{1,3}),(-?\d{1,3}),(-?\d{1,3})$/.exec(row);
    if(!match||match[0]!==row||Object.hasOwn(out,match[1]))return null;
    const v=match.slice(2).map(Number);if(!validStance(v))return null;out[match[1]]=v;
  }
  return out;
}
export function stanceModelsValue(models:StanceModels):string{
  return 'v1'+Object.keys(models).sort().map(name=>'|'+name+':'+models[name].join(',')).join('');
}
