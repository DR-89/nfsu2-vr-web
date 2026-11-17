import { cabinMatrix,fitFor,type DriverScene } from './drivers';
import { identity,inverse,multiply,type Mat4 } from './math';

export interface MirrorAngle { yaw:number;pitch:number }
export interface MirrorSettings { inside:MirrorAngle;outside:MirrorAngle }
export interface MirrorMount { center:number[];half:number[];vertices:Float32Array<ArrayBuffer> }
export interface MirrorRequest { car:number;origin:number[] }
export const mirrorStops={yaw:.18,pitch:.105};
export const mirrorTrim=(yaw:number,pitch:number):MirrorAngle=>({yaw:Math.max(-.18,Math.min(.18,yaw)),pitch:Math.max(-.105,Math.min(.105,pitch))});
export function mirrorAngle(settings:MirrorSettings,part:number):MirrorAngle{
  const a=part===0?settings.inside:settings.outside;return {yaw:part===1?-a.yaw:a.yaw,pitch:a.pitch};
}
const dot=(a:ArrayLike<number>,b:ArrayLike<number>)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const unit=(v:number[])=>{const n=Math.hypot(...v);return n>1e-5?v.map(x=>x/n):[0,0,1];};
export function mirrorRotate(v:readonly number[],a:MirrorAngle,back=false):number[]{
  const [x,y,z]=v,cy=Math.cos(a.yaw),sy=Math.sin(a.yaw),cp=Math.cos(a.pitch),sp=Math.sin(a.pitch);
  if(back){const p=sy*x+cy*z;return [cy*x-sy*z,cp*y+sp*p,-sp*y+cp*p];}
  const p=sp*y+cp*z;return [cy*x+sy*p,cp*y-sp*z,-sy*x+cy*p];
}
export function mirrorMounts(scene:DriverScene): (MirrorMount|null)[]{
  if(!scene.local || !scene.mirrors)return [null,null,null];
  const fit=fitFor(scene.local.model),offset=[fit[1],-fit[2],fit[0]];
  return scene.mirrors.glass.map(raw=>{
    if(raw.length<18)return null;
    const vertices=new Float32Array(raw.length),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<raw.length;i++){const k=i%3,v=raw[i]+offset[k];vertices[i]=v;lo[k]=Math.min(lo[k],v);hi[k]=Math.max(hi[k],v);}
    const center=lo.map((v,k)=>(v+hi[k])/2),half=lo.map((v,k)=>(hi[k]-v)/2);
    return half[0]>.025 && half[1]>.012?{center,half,vertices}:null;
  });
}
export function mirrorNormal(m:MirrorMount,part:number,a:MirrorAngle,seat:readonly number[]=[0,0,0]):number[]{
  const toEye=unit(m.center.map((v,k)=>seat[k]-v)),aim=unit([part===1?-.6:part===2?.6:0,0,1]);
  return mirrorRotate(unit(toEye.map((v,k)=>v+aim[k])),a);
}
export function mirrorVirtualEye(eye:readonly number[],m:MirrorMount,n:readonly number[]):number[]{
  const d=2*(dot(eye,n)-dot(m.center,n));return eye.map((v,k)=>v-d*n[k]);
}
/** Perspective eye from the inverse clip transform, including asymmetric
 * projections. The optical head-center adjustment preserves the eye offset. */
export function mirrorEye(mvp:Mat4,center:readonly number[],seat:readonly number[]):number[]|null{
  const inv=inverse(mvp);if(!inv || Math.abs(inv[11])<1e-6)return null;
  const lean=center.map((v,k)=>v-seat[k]),gain=Math.min(.7,.2/Math.max(1e-6,Math.hypot(...lean)));
  return [0,1,2].map(k=>inv[8+k]/inv[11]+(gain-1)*lean[k]);
}
export function mirrorCamera(scene:DriverScene):{view:Mat4;origin:number[]}|null{
  if(!scene.local || !scene.mirrors?.active)return null;
  const view=multiply(scene.mirrors.view,cabinMatrix(scene.local)),inv=inverse(view);
  return inv?{view,origin:Array.from(inv.subarray(12,15))}:null;
}
export function mirrorMvp(scene:DriverScene,eye?:Mat4):Mat4|null{
  return scene.local?multiply(eye??identity(),multiply(scene.projection,multiply(scene.view,cabinMatrix(scene.local)))):null;
}
