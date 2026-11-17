import { PAD_A, PAD_X, PAD_LB, PAD_RB, PAD_DUP, PAD_DDOWN, PAD_DLEFT, PAD_DRIGHT } from '../input/proto';
import type { SpatialPad } from '../input/gamepad';
import type { ImmersiveFrame } from './session';

export function controllerSources(f: ImmersiveFrame): (XRInputSource | null)[] { return f.sources ?? f.hands.map(h => h?.source ?? null); }
export function controllerStick(pad: Gamepad | undefined, axis: 0 | 1): number {
  const value = pad?.axes?.[(pad.axes?.length??0) >= 4 ? axis + 2 : axis] ?? 0;
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}
export function controllerButton(source: XRInputSource | null, button: number): number {
  const value = source?.gamepad?.buttons[button]?.value;
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : NaN;
}
/** Native quest_driving_input.h thresholds, with WebXR's downward Y axis. */
export function stickDirection(x:number,y:number,previous=0):number {
  if(Math.abs(x)<6500/32767&&Math.abs(y)<6500/32767)return 0;
  if(Math.abs(x)<11500/32767&&Math.abs(y)<11500/32767)return previous;
  return 1<<(Math.abs(y)>=Math.abs(x)?(y<0?PAD_DUP:PAD_DDOWN):(x<0?PAD_DLEFT:PAD_DRIGHT));
}
/** Career actions last 100 ms across guest input polls. Both axes must
 * return to centre before another action, including after panel capture. */
export class StickShortcuts {
  private armed=false;
  private pulse=0;
  private until=0;
  private captured=false;
  private last=NaN;
  reset():void {this.armed=false;this.pulse=0;this.until=0;this.captured=false;this.last=NaN;}
  sample(now:number,x:number,y:number,captured:boolean):number {
    if(![now,x,y].every(Number.isFinite)){this.reset();return 0;}
    if(now<this.last||now-this.last>250)this.reset();
    this.last=now;
    if(captured)this.captured=true;
    if(this.captured){
      this.armed=false;this.pulse=0;
      if(!captured&&Math.abs(x)<6500/32767&&Math.abs(y)<6500/32767)this.captured=false;
      else return 0;
    }
    const released=!!this.pulse&&now>=this.until;
    if(released)this.pulse=0;
    if(Math.abs(x)<6500/32767&&Math.abs(y)<6500/32767)this.armed=true;
    const direction=stickDirection(x,y);
    if(!released&&!this.pulse&&this.armed&&direction){
      // PC layout: D-pad up engages, down opens status, right opens SMS.
      this.pulse=direction===(1<<PAD_DLEFT)?1<<PAD_DRIGHT:direction===(1<<PAD_DRIGHT)?1<<PAD_DUP:direction;
      this.until=now+100;this.armed=false;
    }
    return this.pulse;
  }
}
/** Release to arm, including entry into driving and a changed controller.
 * Triggers captured by cockpit controls rearm only after letting go. */
export class DrivingInput {
  private sources: (XRInputSource | null)[] = [null, null];
  private armed = [[false, false, false], [false, false, false]];
  private shortcuts=new StickShortcuts();
  reset(): void { this.sources = [null, null]; this.armed.forEach(a => a.fill(false));this.shortcuts.reset(); }
  sample(frame: ImmersiveFrame, steer: number, captured: boolean[],stickCaptured=false,faceCaptured:boolean[]=[],downshift?:number): SpatialPad | null {
    const sources = controllerSources(frame), down = [[0,0,0], [0,0,0]];
    for (let h = 0; h < 2; h++) {
      if (sources[h] !== this.sources[h]) { this.armed[h].fill(false); this.sources[h] = sources[h];if(h===1)this.shortcuts.reset(); }
      for (const [i, button] of [0,4,5].entries()) {
        const v = h===0&&button===5&&downshift!==undefined?downshift:controllerButton(sources[h], button);
        if (!Number.isFinite(v)) this.armed[h][i] = false;
        else if (v < .15) this.armed[h][i] = true;
        if ((i === 0 && captured[h]) || (i===1&&faceCaptured[h])) this.armed[h][i] = false;
        down[h][i] = this.armed[h][i] ? v : 0;
      }
    }
    if (!sources.some(s => s?.gamepad)) return null;
    // The PC wheel layout: RB up, LB down, A nitrous, X handbrake.
    const buttons = (down[0][1] > .5 ? 1 << PAD_RB : 0) | (down[0][2] > .5 ? 1 << PAD_LB : 0)
      | (down[1][1] > .5 ? 1 << PAD_A : 0) | (down[1][2] > .5 ? 1 << PAD_X : 0)
      | this.shortcuts.sample(frame.time,controllerStick(sources[1]?.gamepad,0),controllerStick(sources[1]?.gamepad,1),stickCaptured);
    return { steer, throttle: down[1][0], brake: down[0][0], buttons };
  }
}
