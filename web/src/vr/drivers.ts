import { identity, multiply, type Mat4 } from './math';
import type { Avatar, Pose } from './protocol';
import type { RemoteAvatar } from './multiplayer';
import { vehicleFits } from './vehicle-fits';
import type { Gearbox } from './shifter';
import {validStance,type StanceValue} from './stance-models';

export const SCENE_OFFSET = 1792, SCENE_HEADER = 208, CAR_BYTES = 96, MAX_CARS = 64;
export interface DriverCar { vip: number; peer: number; steer: number; model: string; matrix: Mat4 }
/** The PC input channel stores 0x2000 for full left; the scene transports it
 * divided by 32767. Cabin wheel rotation is normalized clockwise/right. */
export function wheelFromSteer(steer: number): number { return Math.max(-1,Math.min(1,-steer*32767/8192)); }
export interface Telemetry { speed: number; rpm: number; throttle: number; brake: number; gear: number; dt: number; time: number }
export interface MirrorScene { active:boolean;target:number;zid:number;car:number;view:Mat4;projection:Mat4;glass:Float32Array[] }
export interface DriverView {view:Mat4;projection:Mat4}
export function driverViewSlot(id:number):number{return [1,2,5,6,7,8].indexOf(id);}
export interface DriverScene { projection: Mat4; view: Mat4; views?: (DriverView|null)[]; cars: DriverCar[]; local?: DriverCar; secondary?:DriverCar; cockpit?: boolean; replay?:boolean; headView?:Mat4; peers?: number[]; telemetry?: Telemetry; bodyDraws?: number; gearbox?: Gearbox; feedback?: {idle:number;limit:number;road:number}; gps?:{metres:number;metric:boolean}; mirrors?:MirrorScene; stance?:{value:StanceValue;stockFront:number} }
export function readDriverScene(buffer: ArrayBufferLike, offset: number, length: number): DriverScene | null {
  if (length < SCENE_OFFSET + SCENE_HEADER || offset < 0 || offset + length > buffer.byteLength) return null;
  const p = offset + SCENE_OFFSET, u = new Uint32Array(buffer, p, 4), n = u[2];
  if (u[0] !== 0x3152564e || ![1,2,3,4,5,6,7,8].includes(u[3]) || n > MAX_CARS || SCENE_OFFSET + SCENE_HEADER + n * CAR_BYTES > length || (u[3] >= 2 && length < SCENE_OFFSET + (u[3]===8?14416:u[3]===7?13768:u[3]===6?13664:u[3]===5?13632:u[3]===4?6560:u[3]===3?6544:6528))) return null;
  const projection = new Float32Array(new Float32Array(buffer, p + 16, 16));
  const view = new Float32Array(new Float32Array(buffer, p + 144, 16));
  if (![...projection, ...view].every(Number.isFinite)) return null;
  const cars: DriverCar[] = [];
  for (let i = 0; i < n; i++) {
    const at = p + SCENE_HEADER + i * CAR_BYTES, ids = new Uint32Array(buffer, at, 2);
    const matrix = new Float32Array(new Float32Array(buffer, at + 16, 16));
    const steer = new Float32Array(buffer, at + 8, 1)[0];
    if (!ids[0] || !ids[1] || !matrix.every(Number.isFinite) || !Number.isFinite(steer)) continue;
    const bytes = new Uint8Array(buffer, at + 80, 16), end = bytes.indexOf(0);
    cars.push({ vip: ids[0], peer: ids[1], steer, matrix, model: String.fromCharCode(...bytes.subarray(0, end < 0 ? 16 : end)) });
  }
  const scene: DriverScene = { projection, view, cars };
  if(u[3]>=8){
    const mask=new Uint32Array(buffer,p+14408,1)[0];if(mask>63)return null;
    scene.views=Array.from({length:6},(_,slot)=>{
      if(!(mask&1<<slot))return null;
      if(!slot)return {view,projection};
      const at=p+13768+(slot-1)*128,extraView=new Float32Array(new Float32Array(buffer,at,16)),extraProjection=new Float32Array(new Float32Array(buffer,at+64,16));
      return extraView.every(Number.isFinite)&&extraProjection.every(Number.isFinite)?{view:extraView,projection:extraProjection}:null;
    });
  }
  if (u[3] >= 2) {
    const at = p + 6352, flags = new Uint32Array(buffer, at + 96, 12), values = new Float32Array(buffer, at + 144, 6);
    if (flags[2] > 8) return null;
    scene.peers = flags[1] ? Array.from(flags.subarray(3, 3 + flags[2])) : [];
    scene.bodyDraws = flags[11];
    if (flags[0]) {
      const matrix = new Float32Array(new Float32Array(buffer, at + 16, 16)), bytes = new Uint8Array(buffer, at + 80, 16), end = bytes.indexOf(0);
      const time = new Float64Array(buffer, at + 168, 1)[0];
      const steer=new Float32Array(buffer,at+8,1)[0];
      if (matrix.every(Number.isFinite) && values.every(Number.isFinite) && Number.isFinite(time) && Number.isFinite(steer)) {
        scene.local = { vip: 0, peer: new Uint32Array(buffer,at+4,1)[0], steer, matrix, model: String.fromCharCode(...bytes.subarray(0, end < 0 ? 16 : end)) };
        if(u[3]>=7&&new Uint32Array(buffer,p+13760,1)[0]===1){
          const at=p+13664,matrix=new Float32Array(new Float32Array(buffer,at+16,16)),steer=new Float32Array(buffer,at+8,1)[0];
          const bytes=new Uint8Array(buffer,at+80,16),end=bytes.indexOf(0),peer=new Uint32Array(buffer,at+4,1)[0];
          if(matrix.every(Number.isFinite)&&Number.isFinite(steer))scene.secondary={vip:0,peer,steer,matrix,model:String.fromCharCode(...bytes.subarray(0,end<0?16:end))};
        }
        scene.cockpit = flags[0] === 2;
        const gearbox = new Uint32Array(buffer,at+12,1)[0];
        scene.gearbox = {epoch:gearbox>>>8,count:gearbox&7,manual:!!(gearbox&8),ready:!!(gearbox&16),firstOnly:!!(gearbox&32),countdown:!!(gearbox&64),selected:gearbox&32?(gearbox&128?2:1):undefined};
        scene.telemetry = { speed: values[0], rpm: values[1], throttle: values[2], brake: values[3], gear: values[4], dt: values[5], time };
        if(u[3]>=6){
          const s=new Int32Array(buffer,p+13632,8),value=Array.from(s.subarray(1,6));
          if(s[0]===1&&validStance(value)&&s[6]>=0&&s[6]<=70)scene.stance={value,stockFront:s[6]};
        }
        if(u[3]>=3){
          const f=new Float32Array(buffer,p+6528,3);
          if(f.every(Number.isFinite)&&f[0]>=0&&f[0]<30000&&f[1]>=0&&f[1]<30000&&f[2]>=0&&f[2]<=1)scene.feedback={idle:f[0],limit:f[1],road:f[2]};
        }
        if(u[3]>=4){
          const metres=new Float32Array(buffer,p+6544,1)[0],metric=new Uint32Array(buffer,p+6548,1)[0];
          if(Number.isFinite(metres)&&metres>=0&&metres<1000000&&metric<=1)scene.gps={metres,metric:!!metric};
        }
        if(u[3]>=5){
          if(new Uint32Array(buffer,p+6552,1)[0]===1){
            const head=u[1]?new Float32Array(new Float32Array(buffer,p+80,16)):identity();
            if(head.every(Number.isFinite)){scene.replay=true;scene.headView=head;}
          }
          const at=p+6560,header=new Uint32Array(buffer,at,4),count=new Uint32Array(buffer,at+144,3);
          const view=new Float32Array(new Float32Array(buffer,at+16,16)),projection=new Float32Array(new Float32Array(buffer,at+80,16));
          if(header[0]<=1 && header[1]<65536 && header[2]<64 && count.every(n=>n<=192 && n%3===0) && view.every(Number.isFinite) && projection.every(Number.isFinite)){
            const glass=Array.from(count,(n,i)=>new Float32Array(new Float32Array(buffer,at+160+i*192*12,n*3)));
            if(glass.every(p=>p.every(v=>Number.isFinite(v)&&Math.abs(v)<20)))scene.mirrors={active:!!header[0],target:header[1],zid:header[2],car:header[3],view,projection,glass};
          }
        }
      }
    }
  }
  return scene;
}
export function fitFor(model: string): readonly number[] { return vehicleFits[model] ?? vehicleFits.DEFAULT; }
/** FLU car space to the authored cabin's right/up/back, at its driver's eye. */
export function cabinMatrix(car: DriverCar): Mat4 {
  const a = car.matrix, fit = fitFor(car.model), out = identity();
  for (let r = 0; r < 3; r++) {
    out[r] = -a[4 + r]; out[4 + r] = a[8 + r]; out[8 + r] = -a[r];
    out[12 + r] = a[12 + r] + a[r] * fit[0] + a[4 + r] * fit[1] + a[8 + r] * fit[2];
  }
  return out;
}
export function poseMatrix(p: Pose): Mat4 {
  const [x, y, z, w] = p.q, out = identity();
  out[0] = 1 - 2*(y*y+z*z); out[1] = 2*(x*y+z*w); out[2] = 2*(x*z-y*w);
  out[4] = 2*(x*y-z*w); out[5] = 1-2*(x*x+z*z); out[6] = 2*(y*z+x*w);
  out[8] = 2*(x*z+y*w); out[9] = 2*(y*z-x*w); out[10] = 1-2*(x*x+y*y);
  out.set(p.p, 12); return out;
}
function blendPose(a: Pose | null, b: Pose | null, t: number): Pose | null {
  if (!b || !a) return b;
  const sign = a.q.reduce((v, x, i) => v + x*b.q[i], 0) < 0 ? -1 : 1;
  const q = a.q.map((x, i) => x*(1-t) + b.q[i]*sign*t), length = Math.hypot(...q);
  return { p: a.p.map((x, i) => x*(1-t) + b.p[i]*t) as Pose['p'], q: q.map(x => x/length) as Pose['q'] };
}
/** One packet of interpolation delay, bounded to 150 ms; stale tracking disappears. */
export function driverPose(remote: RemoteAvatar | undefined, now: number): Avatar | null {
  if (!remote?.current || now - remote.at > 500) return null;
  const b = remote.current, a = remote.previous;
  if (!a || a.vr !== b.vr || a.car !== b.car) return b;
  const t = Math.max(0, Math.min(1, (now-remote.at) / Math.max(1, Math.min(150, remote.at-remote.before))));
  return { ...b, wheel: a.wheel !== undefined && b.wheel !== undefined ? a.wheel*(1-t)+b.wheel*t : b.wheel,
    shifter: a.shifter&&b.shifter?a.shifter.map((v,k)=>v*(1-t)+b.shifter![k]*t) as [number,number]:b.shifter,
    pedals: a.pedals&&b.pedals?a.pedals.map((v,k)=>v*(1-t)+b.pedals![k]*t) as [number,number,number]:b.pedals,
    fingers: a.fingers&&b.fingers?a.fingers.map((v,k)=>v*(1-t)+b.fingers![k]*t) as Avatar['fingers']:b.fingers,
    head: blendPose(a.head, b.head, t), left: blendPose(a.left, b.left, t), right: blendPose(a.right, b.right, t) };
}
/** Only original LAN/Online races use the single-driver car-zero convention.
 * Free-roam and co-op match the exact source endpoint carried by the car. */
export function driverForCar(remote:RemoteAvatar|undefined,car:DriverCar,racing:boolean,now:number):Avatar|null {
  const match=[remote,remote?.secondary].find(r=>r?.current&&(r.current.car===car.peer||racing&&r.current.car===0));
  return driverPose(match,now);
}
export function flatDriver(): Avatar {
  // Resting hands point around the rim; packets express their pose in grip space.
  return { car: 0, cockpit: 0, vr: false, head: { p: [0, 0, 0], q: [0, 0, 0, 1] },
    left: { p: [-.14, -.21, -.33], q: [.5, -.5, -.5, .5] }, right: { p: [.14, -.21, -.33], q: [.5, .5, .5, .5] } };
}
export function translated(a: Mat4, x: number, y: number, z: number): Mat4 {
  const b = identity(); b.set([x, y, z], 12); return multiply(a, b);
}

export function meshData(bytes: ArrayBuffer): { vertices: Float32Array<ArrayBuffer>; indices: Uint32Array<ArrayBuffer>; opened?:Float32Array<ArrayBuffer> } {
  if (bytes.byteLength < 16) throw new Error('Truncated driver mesh');
  const h = new Uint32Array(bytes, 0, 4), nv = h[2], ni = h[3];
  if (h[0] !== 0x4d57564e || ![1,2].includes(h[1]) || !nv || nv > 200000 || !ni || ni > 600000 || ni % 3 || bytes.byteLength !== 16 + nv*32*h[1] + ni*4) throw new Error('Invalid driver mesh');
  const vertices = new Float32Array(bytes, 16, nv*8), indices = new Uint32Array(bytes, 16+nv*32, ni);
  if (!vertices.every(Number.isFinite) || indices.some(i => i >= nv)) throw new Error('Invalid driver geometry');
  const opened=h[1]===2?new Float32Array(bytes,16+nv*32+ni*4,nv*8):undefined;
  if(opened&&!opened.every(Number.isFinite))throw new Error('Invalid driver pose');
  return { vertices, indices,opened };
}
