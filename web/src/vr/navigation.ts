import { controllerButton, controllerSources, controllerStick, stickDirection } from './driving';
import { PAD_A, PAD_B, PAD_X, PAD_Y, PAD_START, PAD_DUP, PAD_DDOWN, PAD_DLEFT, PAD_DRIGHT } from '../input/proto';
import type { SpatialPad } from '../input/gamepad';
import type { ImmersiveFrame } from './session';

/** Both stick clicks belong to recentering, including when no grip pose exists.
 * Each controller must first be released after entry or a source replacement. */
export class RecenterChord {
  private sources:(XRInputSource|null)[]=[null,null];
  private armed=[false,false];
  reset():void{this.sources=[null,null];this.armed.fill(false);}
  sample(sources:(XRInputSource|null)[]):boolean{
    const down=[false,false];
    for(let h=0;h<2;h++){
      if(sources[h]!==this.sources[h]){this.sources[h]=sources[h];this.armed[h]=false;}
      const value=controllerButton(sources[h],3);
      if(!Number.isFinite(value))this.armed[h]=false;
      else if(value<.15)this.armed[h]=true;
      down[h]=value>.5;
    }
    if(down.every(Boolean)&&this.armed.every(Boolean)){this.armed.fill(false);return true;}
    return false;
  }
}

/** The native SteamVR fallback: tap Y to downshift, hold 650 ms to pause.
 * A held button never transfers into menu input after opening that menu. */
class PauseButton {
  private armed=false;
  private since:number|null=null;
  private until=0;
  private pulse=0;
  reset():void{this.armed=false;this.since=null;this.until=this.pulse=0;}
  sample(now:number,driving:boolean,value:number):{shift:number;pause:number}{
    if(!Number.isFinite(value)){this.reset();return {shift:0,pause:0};}
    if(now>=this.until||(!driving&&this.pulse===1))this.pulse=0;
    if(!driving){this.armed=false;this.since=null;}
    else if(value<.15){
      if(this.since!==null){this.pulse=1;this.until=now+100;}
      this.armed=true;this.since=null;
    }else if(value>.5&&this.armed){this.since=now;this.armed=false;}
    if(this.since!==null&&now-this.since>=650){this.pulse=2;this.until=now+200;this.since=null;}
    return {shift:this.pulse===1?1:0,pause:this.pulse===2?1<<PAD_START:0};
  }
}

/** Right click advances on release. Left click holds the stock rear view
 * outside the cockpit; the two-click recenter chord owns both until release. */
export class ViewShortcuts {
  private sources:(XRInputSource|null)[]=[null,null];
  private blocked=true;
  private right=false;
  private until=0;
  reset():void{this.sources=[null,null];this.blocked=true;this.right=false;this.until=0;}
  sample(frame:ImmersiveFrame,cockpit:boolean):number{
    const sources=controllerSources(frame);
    if(sources.some((s,h)=>s!==this.sources[h])){this.reset();this.sources=[...sources];}
    const values=sources.map(s=>controllerButton(s,3)),down=values.map(v=>v>.5);
    if(down.every(Boolean)){this.blocked=true;this.right=false;this.until=0;}
    if(this.blocked){if(values.every((v,h)=>!sources[h] || Number.isFinite(v)&&v<.15))this.blocked=false;return 0;}
    if(!Number.isFinite(values[1])){this.right=false;this.until=0;}
    else if(values[1]<.15 && this.right){this.until=frame.time+100;this.right=false;}
    else if(down[1])this.right=true;
    return (frame.time<this.until?1<<PAD_Y:0)|(!cockpit&&down[0]?1<<PAD_B:0);
  }
}

export class MenuInput {
  private sources:(XRInputSource|null)[]=[null,null];
  private armed=[[false,false],[false,false]];
  private sticks=[false,false];
  private direction=0;
  private until=0;
  reset():void{this.sources=[null,null];this.armed.forEach(a=>a.fill(false));this.sticks.fill(false);this.direction=this.until=0;}
  sample(frame:ImmersiveFrame):SpatialPad|null{
    const sources=controllerSources(frame);let buttons=0,x=0,y=0;
    for(let h=0;h<2;h++){
      if(sources[h]!==this.sources[h]){this.sources[h]=sources[h];this.armed[h].fill(false);this.sticks[h]=false;this.direction=this.until=0;}
      for(let b=0;b<2;b++){
        const v=controllerButton(sources[h],b+4);
        if(!Number.isFinite(v))this.armed[h][b]=false;
        else if(v<.15)this.armed[h][b]=true;
        if(this.armed[h][b]&&v>.5)buttons|=1<<(h?(b?PAD_B:PAD_A):(b?PAD_Y:PAD_X));
      }
      const sx=controllerStick(sources[h]?.gamepad,0),sy=controllerStick(sources[h]?.gamepad,1);
      if(Math.max(Math.abs(sx),Math.abs(sy))<6500/32767)this.sticks[h]=true;
      if(this.sticks[h]&&Math.abs(sx)+Math.abs(sy)>Math.abs(x)+Math.abs(y)){x=sx;y=sy;}
    }
    const direction=stickDirection(x,y,this.direction);
    if(direction&&direction!==this.direction){this.direction=direction;this.until=frame.time+100;}
    else if(!direction&&frame.time>=this.until)this.direction=0;
    buttons|=this.direction;
    return sources.some(s=>s?.gamepad)?{steer:0,throttle:0,brake:0,buttons}:null;
  }
}

/** Replay keeps the original menu controls. B tap toggles its timeline;
 * holding B for 500 ms reaches the original back action. Right click changes
 * camera on release; recenter, a new viewer or lost tracking cancel the tap. */
export class ReplayInput {
  private menu=new MenuInput();
  private sources:(XRInputSource|null)[]=[null,null];
  private epoch=0;
  private last=NaN;
  private armed=false;
  private since:number|null=null;
  private blocked=true;
  private right=false;
  reset():void{this.menu.reset();this.sources=[null,null];this.epoch=0;this.last=NaN;this.armed=false;this.since=null;this.blocked=true;this.right=false;}
  sample(frame:ImmersiveFrame|null,epoch:number):{pad:SpatialPad|null;camera:boolean;timeline:boolean}{
    const result={pad:null as SpatialPad|null,camera:false,timeline:false};
    if(!frame || !epoch){this.reset();return result;}
    const sources=controllerSources(frame);
    if(epoch!==this.epoch || !Number.isFinite(frame.time) || frame.time<this.last || frame.time-this.last>250 || sources.some((s,h)=>s!==this.sources[h]))this.reset();
    this.epoch=epoch;this.last=frame.time;this.sources=[...sources];
    result.pad=this.menu.sample(frame);
    if(result.pad)result.pad.buttons&=~(1<<PAD_B);
    const b=controllerButton(sources[1],5);
    if(!Number.isFinite(b)){this.armed=false;this.since=null;}
    else if(b<.15){
      result.timeline=this.since!==null && frame.time-this.since<500;
      this.since=null;this.armed=true;
    }else if(b>.5 && this.armed){this.since=frame.time;this.armed=false;}
    if(this.since!==null && frame.time-this.since>=500 && result.pad)result.pad.buttons|=1<<PAD_B;
    const clicks=sources.map(s=>controllerButton(s,3));
    if(clicks[0]>.5 || (sources[1]&&!Number.isFinite(clicks[1]))){this.blocked=true;this.right=false;}
    if(this.blocked){if(clicks.every((v,h)=>!sources[h] || Number.isFinite(v)&&v<.15))this.blocked=false;}
    else if(clicks[1]<.15 && this.right){result.camera=true;this.right=false;}
    else if(clicks[1]>.5)this.right=true;
    return result;
  }
}

/** Input ownership follows the game's published driving/menu state, rather
 * than the last captured cockpit, which can outlive a paused world frame. */
export class NavigationInput {
  private pause=new PauseButton();
  private menu=new MenuInput();
  private views=new ViewShortcuts();
  private source:XRInputSource|null=null;
  private driving=false;
  private last=NaN;
  reset():void{this.pause.reset();this.menu.reset();this.views.reset();this.source=null;this.driving=false;this.last=NaN;}
  sample(frame:ImmersiveFrame|null,driving:boolean,cockpit=true){
    if(!frame){this.reset();return {pad:null,shift:0,pause:0,view:0};}
    if(!Number.isFinite(frame.time)||frame.time<this.last||frame.time-this.last>250)this.reset();
    this.last=frame.time;
    const source=controllerSources(frame)[0];
    if(source!==this.source){this.pause.reset();this.source=source;}
    if(driving!==this.driving){this.menu.reset();this.views.reset();this.driving=driving;}
    const action=this.pause.sample(frame.time,driving,controllerButton(source,5));
    return {pad:driving?null:this.menu.sample(frame),view:driving?this.views.sample(frame,cockpit):0,...action};
  }
}
