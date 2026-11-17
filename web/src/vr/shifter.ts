import { fitPoint } from './fit';
import { fitFor } from './drivers';
import type { Mat4 } from './math';

export interface ShiftConfig {
  mode: number; reverse: boolean; gestures: number; gestureReverse: boolean; axis: number;
  travel: number; zone: number; gestureTravel: number; angle: number; speed: number;
}
export interface Gearbox { epoch: number; count: number; manual: boolean; ready: boolean; firstOnly?: boolean; countdown?: boolean; selected?: number }
export const SHIFT_PITCH = .045, SHIFT_THROW = .060;
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
export function shiftCenter(model:string): number[] { return fitPoint([.312,-.413,-.205],fitFor(model)); }
export function gearLane(gear:number,count:number): number { return gear===0?(count===6?3:2):gear===1?1:Math.floor((gear-2)/2); }

/** Native quest_shifter.h: R=0, N=1, first=2. Rails are left-to-right
 * from the driver's seat, including a console fitted on the left. */
export class Shifter {
  hand = -1;
  blocked = [true,true];
  gear = 1;
  lane = 1;
  x = 0;
  z = 0;
  firstOnly = false;
  atLever = false;
  private rebase = true;
  private offset = [0,0];
  private previous = [0,0];
  private squeezeAt = 0;
  reset(): void { this.hand=-1;this.blocked.fill(true);this.rebase=true;this.atLever=false;this.firstOnly=false;this.detent(1,5); }
  block(hand:number): void { if(this.hand===hand)this.hand=-1;this.blocked[hand]=true; }
  observe(squeeze:number[]): void {
    for(let h=0;h<2;h++)if(Number.isFinite(squeeze[h])&&squeeze[h]<.15) {
      if(this.hand===h)this.hand=-1;
      this.blocked[h]=false;
    }
  }
  detent(gear:number,count:number): void {
    this.gear=gear;this.lane=gearLane(gear,count);this.x=(this.lane-1)*SHIFT_PITCH;
    this.z=gear===1?0:gear===0||(gear&1)?SHIFT_THROW:-SHIFT_THROW;
  }
  knob(model:string): number[] { const p=shiftCenter(model);p[0]+=this.x;p[2]+=this.z;return p; }
  move(x:number,z:number,count:number): number | null {
    const middle=.016,engage=.043,previous=this.gear;
    if(this.gear!==1&&(Math.abs(z)<=middle||z*this.z<0))this.gear=1;
    if(this.gear===1) {
      const last=count===6?3:2;
      if(Math.abs(this.z)>middle&&Math.abs(z)>middle&&z*this.z>0)x=this.x;
      this.x=clamp(x,-SHIFT_PITCH,(last-1)*SHIFT_PITCH);this.lane=Math.floor(this.x/SHIFT_PITCH+1.5);
      const rail=(this.lane-1)*SHIFT_PITCH;
      let target=z<0?2+this.lane*2:3+this.lane*2;
      if(z>0&&this.lane===last)target=0;
      if(Math.abs(this.x-rail)>.017||target>count+1||(this.firstOnly&&target!==2)) {
        this.z=0;return previous===this.gear?null:this.gear;
      }
      if(Math.abs(z)>middle)this.x=rail;
      if(Math.abs(z)>=(target===2?SHIFT_THROW-.0005:engage))this.gear=target;
    }
    this.z=clamp(z,-SHIFT_THROW,SHIFT_THROW);
    return previous===this.gear?null:this.gear;
  }
  update(now:number,model:string,count:number,actual:number,positions:(number[]|null)[],squeeze:number[],busy:boolean[]): number|null {
    this.atLever=false;this.observe(squeeze);
    if(this.hand<0)this.detent(actual,count);
    for(let h=0;h<2;h++) {
      const held=this.hand===h;
      if(!Number.isFinite(squeeze[h])) {
        if(held){this.rebase=true;if(now-this.squeezeAt>=500)this.block(h);}continue;
      }
      if(held)this.squeezeAt=now;
      const p=positions[h];if(!p||!p.every(Number.isFinite)) {if(held)this.rebase=true;continue;}
      if(!held) {
        if(this.hand>=0||busy[h]||this.blocked[h])continue;
        const knob=this.knob(model);if(Math.hypot(...p.map((v,k)=>v-knob[k]))>.065)continue;
        this.atLever=true;if(squeeze[h]<.65)continue;
        this.hand=h;this.squeezeAt=now;this.rebase=true;
      } else this.atLever=true;
      const x=p[0],z=p[2];
      if(this.rebase||Math.abs(x-this.previous[0])>.13||Math.abs(z-this.previous[1])>.15) {
        this.offset=[this.x-x,this.z-z];this.rebase=false;
      }
      this.previous=[x,z];return this.move(x+this.offset[0],z+this.offset[1],count);
    }
    return null;
  }
}

/** Native quest_shift_modes.h: settle after entering, one excursion per shift,
 * and return to centre before rearming. A double downshift requires two distinct
 * strokes inside 550 ms; its return stroke never counts as an upshift. */
export class ShiftMotion {
  hand = -1;
  zones = [false,false];
  private armed = false;
  private latched = false;
  private pending = false;
  private gesture = false;
  private origin = 0;
  private angle = 0;
  private last = 0;
  private lastAngle = 0;
  private tick = 0;
  private entered = 0;
  private pendingAt = 0;
  reset(): void { this.hand=-1;this.armed=this.latched=this.pending=false;this.zones.fill(false); }
  update(c:ShiftConfig,lever:Shifter,now:number,model:string,count:number,actual:number,
    positions:(number[]|null)[],poses:(Mat4|null)[],squeeze:number[],busy:boolean[]): number|null {
    const center=shiftCenter(model),old=this.hand;let hand=-1,priority=0;
    for(let h=0;h<2;h++) {
      const p=positions[h];
      this.zones[h]=!!p&&p.every(Number.isFinite)&&!busy[h]&&Math.hypot(...p.map((v,k)=>v-center[k]))<=c.zone;
      const gesture=c.gestures>0&&(!Number.isFinite(squeeze[h])||squeeze[h]<.65);
      const gripped=c.mode>0&&Number.isFinite(squeeze[h])&&squeeze[h]>=.65&&!lever.blocked[h];
      const rank=old===h?3:gripped?2:1;
      if(this.zones[h]&&(gesture||gripped)&&rank>priority){hand=h;priority=rank;}
    }
    const gesture=c.gestures>0&&hand>=0&&(!Number.isFinite(squeeze[hand])||squeeze[hand]<.65);
    if(hand<0||(!gesture&&(!c.mode||!Number.isFinite(squeeze[hand])||squeeze[hand]<.65||lever.blocked[hand]))) {
      this.hand=-1;this.armed=this.latched=this.pending=false;
      if(c.mode){lever.hand=-1;lever.x=lever.z=0;lever.gear=actual;}return null;
    }
    const value=positions[hand]![c.axis&&gesture?1:2],pose=poses[hand];
    const angle=pose?Math.atan2(-pose[9],Math.hypot(pose[8],pose[10]))*180/Math.PI:NaN,dt=now-this.tick;
    if(!Number.isFinite(angle)){this.reset();return null;}
    if(old!==hand||gesture!==this.gesture||dt<=0||dt>100||Math.abs(value-this.last)>.14||Math.abs(angle-this.lastAngle)>70) {
      this.hand=hand;this.origin=value;this.angle=angle;this.entered=now;
      this.armed=this.latched=this.pending=false;this.gesture=gesture;
    }
    const delta=value-this.origin,rotation=angle-this.angle;
    const speed=dt>0?Math.abs(value-this.last)*1000/dt:0,angularSpeed=dt>0?Math.abs(angle-this.lastAngle)*1000/dt:0;
    this.last=value;this.lastAngle=angle;this.tick=now;
    const threshold=gesture?c.gestureTravel:c.travel;
    const centered=Math.abs(delta)<threshold*.4&&(!gesture||Math.abs(rotation)<c.angle*.4);
    if(now-this.entered<120){this.origin=value;this.angle=angle;return null;}
    if(centered){this.armed=true;this.latched=false;}
    if(this.pending&&now-this.pendingAt>550)this.pending=false;
    if(c.mode){lever.hand=gesture?-1:hand;lever.x=0;lever.z=clamp(delta,-SHIFT_THROW,SHIFT_THROW);lever.gear=actual;}
    if(!this.armed||this.latched)return null;
    const linear=Math.abs(delta)>=threshold&&(!gesture||speed>=c.speed),angular=gesture&&Math.abs(rotation)>=c.angle&&angularSpeed>=c.speed*180;
    if(!linear&&!angular)return null;
    let direction=(linear?delta:rotation)>0?1:-1;
    if(gesture?c.gestureReverse:c.reverse)direction=-direction;
    this.latched=true;this.armed=false;
    if(gesture&&c.gestures===2&&direction<0&&!this.pending){this.pending=true;this.pendingAt=now;return null;}
    this.pending=false;
    const next=actual+direction;
    return next<0||next>count+1||(lever.firstOnly&&next!==2)?null:next;
  }
}
