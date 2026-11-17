import { vehicleFits } from './vehicle-fits';
import type { MirrorSettings } from './mirrors';

export const mirrorModels=Object.keys(vehicleFits);
export const mirrorFields=['inside_yaw','inside_pitch','outside_yaw','outside_pitch'] as const;
export type MirrorField=typeof mirrorFields[number];
export const mirrorModel=(model:string):string=>Object.hasOwn(vehicleFits,model)?model:'DEFAULT';
export function mirrorKey(model:string,field:MirrorField):string {
  return `vr_mirror_${mirrorModel(model)==='DEFAULT'?'':mirrorModel(model).toLowerCase()+'_'}${field}`;
}
export function mirrorFor(s:{mirrors:MirrorSettings;mirrorCars:Record<string,MirrorSettings>},model:string):MirrorSettings {
  const name=mirrorModel(model);if(name==='DEFAULT')return s.mirrors;
  return s.mirrorCars[name]??=( {inside:{...s.mirrors.inside},outside:{...s.mirrors.outside}} );
}
