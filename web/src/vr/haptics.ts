import {nativeHaptics,type HapticBridge} from './native-haptics';
const clamp=(v:number)=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;
/** Native quest_haptics.h, normalized to the actual car's engine limits. */
export function engineRumble(rpm:number,idle:number,limit:number,throttle:number):number {
  if(![rpm,idle,limit].every(Number.isFinite)||rpm<=0||idle<=0||limit<=idle)return 0;
  return .025*Math.min(1,rpm/idle)+clamp((rpm-idle)/(limit-idle))*(.14+.14*clamp(throttle));
}
export function mixRumble(road:number,engine:number):number {return clamp(road)+(1-clamp(road))*clamp(engine);}
export function canPulse(pad:Gamepad|null|undefined):boolean {
  return typeof pad?.hapticActuators?.[0]?.pulse==='function'||typeof pad?.vibrationActuator?.playEffect==='function';
}
function pulse(pad:Gamepad|null,amplitude:number,duration:number):void {
  try {
    const h=pad?.hapticActuators?.[0],v=pad?.vibrationActuator;
    if(h?.pulse)void h.pulse(amplitude,duration).catch(()=>{});
    else if(v?.playEffect)void v.playEffect('dual-rumble',{duration,strongMagnitude:amplitude,weakMagnitude:amplitude}).catch(()=>{});
  } catch { /* Some browsers expose an actuator their device cannot drive. */ }
}
/** Short renewable pulses cannot keep a motor running after frame delivery
 * stops. Contact/shift impulses mix with the engine and road background. */
export class ControllerHaptics {
  constructor(private bridge:HapticBridge|null=nativeHaptics()){}
  supported(pads:(Gamepad|null|undefined)[]):boolean {return !!this.bridge?.ready||pads.some(canPulse);}
  private pulse(hand:number,pad:Gamepad|null,amplitude:number,duration:number):void {
    if(canPulse(pad))pulse(pad,amplitude,duration);
    else if(pad&&this.bridge?.ready)this.bridge.pulse(hand,amplitude,duration);
  }
  private pads:(Gamepad|null)[]=[null,null];
  private sent=[0,0];private at=[-Infinity,-Infinity];private clicking=[false,false];
  private impulses=[{amplitude:0,until:0},{amplitude:0,until:0}];
  kick(hand:number,amplitude:number,duration:number,now:number):void {
    if(hand<0||hand>1)return;
    this.impulses[hand]={amplitude:clamp(amplitude),until:now+Math.min(100,Math.max(0,duration))};
  }
  update(now:number,pads:(Gamepad|null)[],levels:number[]):void {
    for(let h=0;h<2;h++) {
      const pad=pads[h]??null;
      if(pad!==this.pads[h]) {
        if(this.pads[h])this.impulses[h]={amplitude:0,until:0};
        if(this.sent[h]>0)this.pulse(h,this.pads[h],0,0);
        this.pads[h]=pad;this.sent[h]=0;this.at[h]=-Infinity;this.clicking[h]=false;
        // A replacement controller must never inherit another controller's click.
      }
      const i=this.impulses[h],click=now<i.until&&i.amplitude>0,a=mixRumble(levels[h],click?i.amplitude:0);
      if(!pad)continue;
      if(!a&&!this.sent[h])continue;
      if(a>0&&click===this.clicking[h]&&Math.abs(a-this.sent[h])<1/255&&now-this.at[h]<50)continue;
      this.pulse(h,pad,a,a?(click?Math.max(1,i.until-now):100):0);
      this.sent[h]=a;this.at[h]=now;this.clicking[h]=click;
    }
  }
  stop():void {
    for(let h=0;h<2;h++)if(this.sent[h]>0)this.pulse(h,this.pads[h],0,0);
    this.pads=[null,null];this.sent=[0,0];this.at=[-Infinity,-Infinity];this.clicking=[false,false];
    this.impulses=[{amplitude:0,until:0},{amplitude:0,until:0}];
  }
  destroy():void {this.stop();this.bridge?.destroy();}
}
