import { cabinMatrix, type DriverScene } from './drivers';
import { mirrorMounts,type MirrorRequest } from './mirrors';
import { MirrorGrip } from './mirror-grip';
import { mirrorFor,mirrorModel,mirrorKey } from './mirror-profiles';
import { identity, inverse, multiply, type Mat4 } from './math';
import type { ImmersiveFrame } from './session';
import type { VRSettings } from './settings';
import type { MediaPanel } from './media-panel';
import { t } from '../app/i18n';
import { WheelGrip } from './wheel-grip';
import { gloveAxes } from './fit';
import { DrivingInput, controllerSources, controllerButton, controllerStick } from './driving';
import { poseFromMatrix } from './session';
import type { SpatialPad, SpatialFeedback } from '../input/gamepad';
import type { Pose, Fingers } from './protocol';
import { gloveTip } from './glove-tip';
import { ScreenTouch } from './screen-touch';
import { seatContact,seatButton } from './seat-controls';
import {MediaTouch,screenControl,screenLayout,screenButtons,sliderValue,mediaTime,SEEK,VOLUME,seekRange,volumeRange,type Timeline} from './screen-controls';
import type {CockpitRadio} from './radio';
import { Shifter, ShiftMotion, shiftCenter } from './shifter';
import { Pedals } from './pedals';
import { ControllerHaptics, engineRumble, mixRumble } from './haptics';
import { PAD_LB, PAD_RB } from '../input/proto';
import { PanelGrip, MapShortcut, placement, applyPlacement, screenMount, type PanelKind } from './panel-grip';
export { fitPoint } from './fit';
export { screenMount, mapMount } from './panel-grip';

export const LED_COLORS = [0x32dbe7,0x5287ff,0xa072ff,0xff64ad,0xff5144,0xffab43,0x4ddf88,0xe6eff5];
export function appearanceLED(bits: number): number[] {
  if (!(bits&256)) return [0,0,0,0];
  const rgb=bits&32?0xff2020:bits&64?0x287bff:bits&16?0x5effac:LED_COLORS[bits&7];
  return [((rgb>>>16)&255)/255,((rgb>>>8)&255)/255,(rgb&255)/255,((bits>>>9)&15)/15];
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b,v));
export type SaveCockpit = (values: Record<string,string>) => void;
function point(m: Mat4, p: readonly number[], w=1): number[] { return [0,1,2].map(r => m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]*w); }
export function hitScreen(ray: Mat4, mount: ReturnType<typeof screenMount>): [number,number] | null {
  const inv = inverse(mount.matrix); if (!inv) return null;
  const p = point(inv, Array.from(ray.subarray(12,15))), d = point(inv, [-ray[8],-ray[9],-ray[10]],0);
  if (d[2] >= -.0001 || p[2] < 0) return null;
  const distance = -p[2]/d[2]; if (distance > 3) return null;
  const u = (p[0]+d[0]*distance)/mount.width+.5, v = .5-(p[1]+d[1]*distance)/mount.height;
  return u>=0 && u<=1 && v>=0 && v<=1 ? [u,v] : null;
}

/** Draw at the button's centre; vector icons stay legible in the headset. */
function screenIcon(g:CanvasRenderingContext2D,index:number,paused:boolean,page:number):void {
  g.strokeStyle=g.fillStyle='#effaff';g.lineWidth=4;g.lineCap='round';g.lineJoin='round';g.beginPath();
  if(index===0||index===2){
    const d=index===0?-1:1;g.moveTo(d*18,-16);g.lineTo(d*18,16);g.stroke();
    g.beginPath();g.moveTo(-d*14,-18);g.lineTo(d*10,0);g.lineTo(-d*14,18);g.closePath();g.fill();
  }else if(index===1){
    if(paused){g.moveTo(-10,-18);g.lineTo(18,0);g.lineTo(-10,18);g.closePath();g.fill();}
    else{g.lineWidth=8;for(const x of [-10,10]){g.moveTo(x,-16);g.lineTo(x,16);}g.stroke();}
  }else if(index===3){
    g.arc(0,0,8,0,Math.PI*2);g.stroke();g.beginPath();
    for(let i=0;i<8;i++){const a=i*Math.PI/4;g.moveTo(Math.cos(a)*16,Math.sin(a)*16);g.lineTo(Math.cos(a)*22,Math.sin(a)*22);}g.stroke();
  }else{
    g.moveTo(-12,12);g.lineTo(-20,12);g.lineTo(-20,-20);g.lineTo(8,-20);g.lineTo(8,-16);g.stroke();
    g.beginPath();g.roundRect(-8,-8,28,28,4);g.stroke();
    g.beginPath();
    if(page){g.moveTo(0,-2);g.lineTo(12,6);g.lineTo(0,14);g.closePath();g.fill();}
    else{for(const [x,y] of [[0,8],[6,0],[12,4]]){g.moveTo(x,12);g.lineTo(x,y);}g.stroke();}
  }
}
type Sample = { time:number; rpm:number; speed:number; throttle:number; brake:number; acceleration:number };
/** One player and one display texture for the page and the cabin. Switching the
 * dashboard page never restarts the media or creates another audio source. */
export class Cockpit {
  readonly wheel: WheelGrip;
  readonly shifter = new Shifter();
  readonly motion = new ShiftMotion();
  readonly pedals = new Pedals();
  shiftRequest: number | null = null;
  private shiftEpoch = 0;
  private leverHand: Mat4 | null = null;
  controls: SpatialPad | null = null;
  wheelVisual: number | null = null;
  private driving = new DrivingInput();
  private outside = new DrivingInput();
  private sources: (XRInputSource | null)[] = [null, null];
  private surface: HTMLCanvasElement | null = null;
  get canvas(): HTMLCanvasElement {
    if (!this.surface) { this.surface=document.createElement('canvas');this.surface.width=screenLayout.width;this.surface.height=screenLayout.height; }
    return this.surface;
  }
  get context(): CanvasRenderingContext2D { return this.canvas.getContext('2d')!; }
  scene: DriverScene | null = null;
  rearCapture:((request:MirrorRequest|null)=>void)|null=null;
  tracking: ImmersiveFrame | null = null;
  hover: [number,number] | null = null;
  zone = false;
  private screenPresses = [-1,-1];
  private pointerHeld = false;
  private pointerPosition:[number,number]|null=null;
  private mediaOverlayUntil=0;
  private mediaOverlayTrack:string|null=null;
  private showMediaControls(now=performance.now()):void {this.mediaOverlayUntil=now+3000;}
  private touches = [new MediaTouch(),new MediaTouch()];
  private seatTouches=[new ScreenTouch(seatButton),new ScreenTouch(seatButton)];
  private volumeDirty=false;
  private sliders=new Map<number,{control:number;id:string;duration:number;value:number}>();
  get seatHover():number {return this.seatTouches.reduce((mask,t)=>t.pointing<0?mask:mask|(1<<t.pointing),0);}
  private resetTouches(hand?:number):void {
    for(const list of [this.touches,this.seatTouches])if(hand===undefined)list.forEach(t=>t.reset());else list[hand].reset();
    for(const i of hand===undefined?[0,1]:[hand]){this.finishSlider(i,true);this.screenPresses[i]=-1;}
  }
  private fingerWeights:Fingers = [0,0,0,0];
  get fingers():Fingers {return [...this.fingerWeights];}
  readonly screenGrip = new PanelGrip('screen');
  readonly mapGrip = new PanelGrip('map');
  readonly mirrorGrip = new MirrorGrip();
  private mirrorModel='DEFAULT';
  get mirrors(){return mirrorFor(this.settings,this.mirrorModel);}
  private mapShortcut = new MapShortcut();
  private interactionModel = '';
  private lastTime = 0;
  private lastPaint = -Infinity;
  private history: Sample[] = [];
  private gear: number | null = null;
  private actualGear: number | null = null;
  private feedbackEpoch = -1;
  private pendingEngagement: {gear:number;hand:number;epoch:number}|null=null;
  private haptics=new ControllerHaptics();
  private zones=[false,false];
  private flash = 0;
  private flashUntil = 0;
  private lastScene = 0;
  constructor(readonly settings: VRSettings, readonly media: MediaPanel | null, private save: SaveCockpit = () => {}, private peers: (p:number[]) => void = () => {}, private shiftSound:()=>void = () => {},readonly radio:CockpitRadio|null=null) {
    this.wheel = new WheelGrip(settings);
  }
  handMatrix(hand: number): Mat4 | null {
    const grip = this.wheel.handMatrix(hand);
    if (grip) return grip;
    const tracked = this.tracking?.hands[hand];
    if(this.shifter.hand===hand && this.scene?.local) {
      if(tracked)this.leverHand=new Float32Array(tracked.matrix);
      if(this.leverHand){const m=new Float32Array(this.leverHand);m.set(this.shifter.knob(this.scene.local.model),12);return multiply(m,gloveAxes(hand));}
    }
    return tracked ? multiply(tracked.matrix,gloveAxes(hand)) : null;
  }
  get gearCommand(): number {
    const b=this.scene?.gearbox;
    if(!this.tracking || !this.scene?.cockpit || !this.settings.handControls || !b?.manual)return 0;
    const sources=controllerSources(this.tracking);
    if(!sources.some(s=>s?.gamepad) || (!this.mapShortcut.captured[0]&&controllerButton(sources[0],4)>.5) || controllerButton(sources[0],5)>.5 || this.buttonShift)return 0;
    // Advertise control intent even during the locked countdown. Only a live,
    // ready cockpit submits a target; the runtime owns grid neutral/first.
    return (b.epoch<<8)|128|(this.controls&&b.ready&&this.shiftRequest!==null?this.shiftRequest+1:0);
  }
  get pedalTravel(): [number,number,number] {
    return this.controls?this.pedals.travel:[clamp(this.scene?.telemetry?.throttle??0,0,1),clamp(this.scene?.telemetry?.brake??0,0,1),0];
  }
  private resetShifter(): void { this.shifter.reset();this.motion.reset();this.shiftRequest=null;this.leverHand=null;this.pendingEngagement=null; }
  private get buttonShift():boolean {return !!((this.controls?.buttons??0)&((1<<PAD_LB)|(1<<PAD_RB)));}
  get feedback():SpatialFeedback|null {
    if(!this.tracking)return null;
    const sources=controllerSources(this.tracking),controllers=this.settings.handControls&&sources.some(s=>!!s?.gamepad);
    const s=this.scene,t=s?.telemetry,f=s?.feedback;
    const live=!!s?.local&&performance.now()-this.lastScene<250&&!!s.gearbox?.ready&&!s.gearbox.countdown&&!!t&&t.dt>0;
    return {controllers,rumble:this.settings.haptics&&(!controllers||this.haptics.supported(sources.map(s=>s?.gamepad))),
      engine:live&&f&&this.settings.engineRumble?engineRumble(t!.rpm,f.idle,f.limit,t!.throttle):0,road:live?f?.road??0:0};
  }
  private refreshHaptics(now:number):void {
    const f=this.feedback;
    if(!f?.rumble||!f.controllers){this.haptics.stop();return;}
    const pads=controllerSources(this.tracking!).map(s=>s?.gamepad??null);
    const levels=pads.map((_,h)=>mixRumble(f.road,!this.settings.gripFeedback||this.zones[h]||this.wheel.grabbed[h]?f.engine:0));
    this.haptics.update(now,pads,levels);
  }
  handPose(hand: number): Pose | null {
    const matrix = this.handMatrix(hand);
    return matrix ? poseFromMatrix(multiply(matrix,inverse(gloveAxes(hand))!)) : null;
  }
  update(scene: DriverScene): void {
    const model=mirrorModel(scene.local?.model??'DEFAULT');
    if(model!==this.mirrorModel){this.releasePanels();this.mirrorModel=model;}
    this.scene=scene; this.lastScene=performance.now(); this.peers(scene.peers??[]);
    this.radio?.update(!!scene.cockpit&&!!scene.local,this.settings.volume,this.settings.masterGainDB,this.settings.musicSource,!!scene.local);
    this.rearCapture?.(null); // Retail mirror camera never follows an individual glass adjustment.
    const t = scene.telemetry; if (!t || t.time === this.history.at(-1)?.time) return;
    if(!this.controls) {
      if(!this.settings.shift.mode && scene.gearbox?.manual)this.shifter.detent(t.gear,scene.gearbox.count);
      else {this.shifter.x=this.shifter.z=0;}
    }
    const prev=this.history.at(-1), dt=prev?(t.time-prev.time)/1000:0;
    const epoch=scene.gearbox?.epoch??0;
    if(epoch!==this.feedbackEpoch){this.gear=this.actualGear=null;this.feedbackEpoch=epoch;this.flashUntil=0;this.pendingEngagement=null;}
    if (this.actualGear !== null && t.gear !== this.actualGear && t.gear>=0 && t.gear!==1) {
      if(this.gear!==null && t.gear!==this.gear){this.flash=t.gear>this.gear?0xff2020:0x287bff;this.flashUntil=performance.now()+160;}
      const pending=this.pendingEngagement;
      if(pending?.gear===t.gear&&pending.epoch===epoch&&this.tracking&&scene.cockpit) {
        const now=performance.now();
        if(this.settings.haptics&&this.settings.shiftClick)this.haptics.kick(pending.hand,.95,28,now);
        if(this.settings.shiftSound)this.shiftSound();
        this.pendingEngagement=null;this.refreshHaptics(now);
      }
    }
    this.actualGear=t.gear;
    if(t.gear!==1)this.gear=t.gear;
    if (dt<0 || dt>1 || !scene.local) this.history=[];
    if (dt>0 && dt<.045) return;
    this.history.push({...t, acceleration:dt>.01 && dt<.5 && t.dt>0 ? clamp((t.speed-prev!.speed)/dt,-30,30):0});
    while (this.history.length>240 || (this.history.length && t.time-this.history[0].time>12000)) this.history.shift();
  }
  led(now=performance.now()): number[] {
    if (!this.settings.leds) return [0,0,0,0];
    const cue=this.settings.shiftLights, rgb=cue && now<this.flashUntil?this.flash:cue && this.zone?0x5effac:LED_COLORS[this.settings.ledColor];
    const gain=this.settings.pulse ? .72+(this.radio?.level()??this.media?.level()??0)*.8:1;
    return [((rgb>>>16)&255)/255,((rgb>>>8)&255)/255,(rgb&255)/255,clamp(gain,0,1.2)];
  }
  appearance(now=performance.now()): number {
    const s=this.settings, cue=s.shiftLights;
    return s.leds ? 256 | s.ledColor | (cue && now<this.flashUntil ? (this.flash===0xff2020?32:64) : cue && this.zone?16:0) | (Math.round(clamp(this.led(now)[3],0,1)*15)<<9) : 0;
  }
  action(index:number): void {
    this.showMediaControls();
    if(index>=0&&index<=2&&this.radio)this.radio.command(index===0?'previous':index===1?'toggle':'next');
    else {
      if (index===0) void this.media?.step(-1);
      if (index===1) void this.media?.toggle();
      if (index===2) void this.media?.step(1);
    }
    if (index===3) { this.settings.ledColor=(this.settings.ledColor+1)%LED_COLORS.length; this.settings.leds=true; this.save({vr_led_color:String(this.settings.ledColor),vr_leds:'on'}); }
    if (index===4) { this.settings.page=1-this.settings.page; this.save({vr_screen_page:String(this.settings.page)}); }
    this.lastPaint=-Infinity;
  }
  private moveSeat(button:number):void {
    const s=this.settings,height=button>=2,key=height?'height':'forward',old=s[key];
    const limit=height?35:40,value=clamp(Math.round(old*100)+(button===0||button===2?1:-1),-limit,limit)/100;
    if(value===old)return;s[key]=value;this.save({[height?'vr_seat_height':'vr_seat_forward']:String(Math.round(value*100))});
  }
  private saveVolume():void {
    if(this.volumeDirty&&![...this.sliders.values()].some(t=>t.control===VOLUME)){
      this.volumeDirty=false;this.save({vr_media_volume:String(Math.round(this.settings.volume*100))});
    }
  }
  get timeline():Timeline {return this.radio?.timeline??this.media?.timeline??{id:'',current:0,duration:0,seekable:false};}
  private slider(owner:number,control:number,value:number):void {
    this.showMediaControls();
    let drag=this.sliders.get(owner);
    if(!drag){
      if([...this.sliders.values()].some(s=>s.control===control))return;
      const track=this.timeline;if(control===SEEK&&!track.seekable)return;
      drag={control,id:track.id,duration:track.duration,value};this.sliders.set(owner,drag);
    }
    if(drag.control!==control)return;
    drag.value=value;
    if(control===VOLUME){this.settings.volume=Math.round(value*100)/100;this.media?.setVolume(this.settings.volume);this.volumeDirty=true;}
    this.lastPaint=-Infinity;
  }
  private finishSlider(owner:number,cancel=false):void {
    const drag=this.sliders.get(owner);this.sliders.delete(owner);
    if(drag)this.showMediaControls();
    if(drag?.control===SEEK&&!cancel){
      if(this.radio)this.radio.seek(drag.value*drag.duration,drag.id);
      else this.media?.seek(drag.value*drag.duration,drag.id);
    }
    this.saveVolume();
  }
  private touchHeld(hand:number):boolean{return this.seatTouches[hand].control>=0||this.touches[hand].control>=0||this.screenPresses[hand]>=0;}
  private pointerHit(x:number,y:number):[number,number]|null {
    const s=this.scene; if (!s?.local || !s.cockpit) return null;
    const pv=inverse(multiply(s.projection,multiply(s.view,cabinMatrix(s.local)))); if(!pv)return null;
    const unproject=(z:number)=>{ const q=[x,y,z,1], o=[0,1,2,3].map(r=>q.reduce((a,v,i)=>a+pv[i*4+r]*v,0)); return o.slice(0,3).map(v=>v/o[3]); };
    const a=unproject(0), b=unproject(1), len=Math.hypot(...a.map((v,i)=>v-b[i])), ray=identity();
    ray.set(a,12); ray.set(a.map((v,i)=>(v-b[i])/len),8);
    return hitScreen(ray,screenMount(s.local.model,this.settings));
  }
  pointer(x:number,y:number,phase:'down'|'move'|'up'|'cancel'|'leave'='down'): boolean {
    if(phase==='leave'||phase==='cancel')this.pointerPosition=null;
    if(phase==='leave')return false;
    if(phase==='up'||phase==='cancel'){const held=this.pointerHeld;this.pointerHeld=false;this.finishSlider(2,phase==='cancel');if(held)this.showMediaControls();return held;}
    if(phase==='down'&&this.pointerHeld)return true;
    this.pointerPosition=[x,y];
    const hit=this.pointerHit(x,y),drag=this.sliders.get(2),control=hit?screenControl(hit):-1;
    if(hit)this.showMediaControls();
    if(phase==='move'){if(drag&&hit)this.slider(2,drag.control,sliderValue(drag.control,hit[0]));return !!drag;}
    if(control<0)return false;
    this.pointerHeld=true;
    if(control<SEEK)this.action(control);else this.slider(2,control,sliderValue(control,hit![0]));
    return true;
  }
  track(frame: ImmersiveFrame | null, downshift?:number): void {
    this.tracking=frame; this.zone=false; this.hover=null;this.zones=[false,false];
    const s=this.scene, active=!!frame && !!s?.cockpit && !!s.local && performance.now()-this.lastScene<300;
    if (!active) {
      this.releasePanels();this.resetTouches();this.fingerWeights=[0,0,0,0];this.mapShortcut.reset();this.wheel.reset();this.driving.reset();this.resetShifter();this.pedals.reset();this.controls=null;this.wheelVisual=null;this.sources=[null,null];this.interactionModel='';
      if(frame && s?.local && !s.cockpit && performance.now()-this.lastScene<300 && this.settings.handControls){
        if(frame.time<this.lastTime || frame.time-this.lastTime>250)this.outside.reset();
        const raw=controllerStick(controllerSources(frame)[0]?.gamepad,0),stick=Math.sign(raw)*Math.max(0,(Math.abs(raw)-.08)/.92);
        this.controls=this.outside.sample(frame,stick,[false,false],false,[],downshift);this.lastTime=frame.time;
        this.refreshHaptics(frame.time);
      }else {this.outside.reset();this.haptics.stop();}
      return;
    }
    this.outside.reset();
    const now=frame.time, dt=clamp((now-this.lastTime)/1000,0,.1);
    const sources=controllerSources(frame),model=s.local!.model;
    if(now-this.lastTime>250||now<this.lastTime||model!==this.interactionModel){this.resetTouches();this.releasePanels();this.mapShortcut.reset();}
    this.interactionModel=model;
    this.lastTime=now;
    for(let i=0;i<2;i++)if(sources[i]!==this.sources[i]) {
      this.releasePanels(i);this.mapShortcut.block(i);this.wheel.block(i);this.shifter.block(i);this.resetTouches(i);if(this.motion.hand===i)this.motion.reset();this.sources[i]=sources[i];
    }
    const poses=frame.hands.map(h=>h?.matrix??null),squeeze=sources.map(h=>controllerButton(h,1));
    const positions=poses.map(m=>m?Array.from(m.subarray(12,15)):null);
    let mount=screenMount(model,this.settings),inv=inverse(mount.matrix)!;
    const fingertips=frame.hands.map((h,i)=>h?point(multiply(h.matrix,gloveAxes(i)),gloveTip):null);
    const atScreen=fingertips.map(p=>{
      if(!p)return false;
      const tip=point(inv,p);
      return tip[2]>=-.035&&screenControl([tip[0]/mount.width+.5,.5-tip[1]/mount.height,tip[2]])>=0;
    });
    const raw=controllerStick(sources[0]?.gamepad,0), stick=Math.sign(raw)*Math.max(0,(Math.abs(raw)-.08)/.92);
    // Physical rim contact takes priority over the other cabin controls.
    // Release distant hands before the other controls try to acquire them.
    const autoAcquired=this.settings.wheelGrip?0:this.wheel.update(now,this.settings.handControls,positions,squeeze,
      [0,1].map(h=>this.panelHeld(h)||this.shifter.hand===h||this.touchHeld(h)),stick);
    if(this.mirrorGrip.update(this.mirrors,mirrorMounts(s),now,poses,squeeze,
      [0,1].map(h=>this.wheel.grabbed[h]||this.shifter.hand===h||this.screenGrip.hand===h||this.mapGrip.hand===h||this.touchHeld(h))))this.saveMirrors();
    for(const grip of [this.mapGrip,this.screenGrip]){
      const p=placement(this.settings,grip.kind),other=grip===this.mapGrip?this.screenGrip:this.mapGrip;
      // An angled hand can put its palm over the video while its index is
      // pressing a control. Contact owns that gesture before a new panel grip.
      const save=grip.update(model,p,poses,squeeze,[0,1].map(h=>this.wheel.grabbed[h]||this.shifter.hand===h||other.hand===h||this.mirrorGrip.hand===h||this.touchHeld(h)||grip.hand!==h&&atScreen[h]),dt,controllerStick(sources[1]?.gamepad,1),grip.kind==='map'||this.settings.movable);
      applyPlacement(this.settings,grip.kind,p);if(save)this.savePanel(grip.kind);
    }
    const mapButton=this.mapShortcut.sample(now,sources.map(h=>controllerButton(h,4)),this.mapGrip.hover,this.mapGrip.hand);
    mount=screenMount(model,this.settings);inv=inverse(mount.matrix)!;
    const shifter=shiftCenter(model);
    const captured=[false,false], triggerCaptured=[false,false], pointing=[false,false], zones=[false,false];
    this.zones=zones;
    for (let i=0;i<2;i++) {
      const h=frame.hands[i]; if (!h) { this.resetTouches(i); continue; }
      const p=Array.from(h.matrix.subarray(12,15));
      const zone=zones[i]=Math.hypot(...p.map((v,k)=>v-shifter[k]))<this.settings.shift.zone; this.zone ||= zone;
      const knob=this.shifter.knob(model),atKnob=this.settings.handControls&&s.gearbox?.manual&&s.gearbox.ready&&
        (Math.hypot(...p.map((v,k)=>v-knob[k]))<=.065||!!(this.settings.shift.mode||this.settings.shift.gestures)&&zone);
      // Media and seat controls use the fingertip only. Their hand ownership
      // protects against grabbing the display or shifter without capturing pedals.
      const free=!this.wheel.grabbed[i] && this.shifter.hand!==i && !this.panelHeld(i);
      const fingertip=fingertips[i]!,tip=point(inv,fingertip),contact:[number,number,number]=[tip[0]/mount.width+.5,.5-tip[1]/mount.height,tip[2]];
      if(free&&contact[0]>=0&&contact[0]<=1&&contact[1]>=0&&contact[1]<=1&&contact[2]>=-.035&&contact[2]<=.095)this.showMediaControls();
      const seatPress=this.seatTouches[i].update(free&&!atKnob?seatContact(model,fingertip):null,this.seatTouches[1-i].control);
      const atSeat=this.seatTouches[i].pointing>=0;
      const touch=this.touches[i].sample(free&&this.screenGrip.hand<0&&!atSeat?contact:null,this.screenPresses[1-i]);
      pointing[i]=free&&(atSeat||this.screenGrip.hand<0&&this.touches[i].pointing>=0);
      if(seatPress>=0){this.moveSeat(seatPress);this.haptics.kick(i,.5,22,now);}
      if(this.touches[i].pointing>=0)this.hover=[contact[0],contact[1]];
      // A deep or sideways poke stays latched until the finger withdraws.
      // A held accelerator does not prevent the next physical tap.
      if(contact[2]>.025)this.screenPresses[i]=-1;
      const press=touch.press;
      if(press>=0&&this.screenPresses[i]<0){
        this.screenPresses[i]=press;
        if(this.screenPresses[1-i]!==press){
          if(press<SEEK)this.action(press);
          this.haptics.kick(i,.5,22,now);
        }
      }
      captured[i]=pointing[i] || this.screenPresses[i]>=0 || this.panelHeld(i) || this.mapShortcut.captured[i];
      triggerCaptured[i]=this.panelHeld(i) || this.mapShortcut.captured[i];
      if(touch.slider>=0)this.slider(i,touch.slider,touch.value);
      else this.finishSlider(i);
    }
    this.saveVolume();
    const acquired=this.settings.wheelGrip?this.wheel.update(now,this.settings.handControls,positions,squeeze,
      [0,1].map(h=>this.panelHeld(h)||this.shifter.hand===h||this.touchHeld(h)),stick):autoAcquired;
    this.controls=this.settings.handControls?this.driving.sample(frame,this.wheel.input(stick),triggerCaptured,this.screenGrip.hand>=0,this.mapShortcut.captured,downshift):null;
    if(mapButton){this.controls??={steer:0,throttle:0,brake:0,buttons:0};this.controls.buttons|=mapButton;}
    if(!this.settings.handControls)this.driving.reset();
    this.wheelVisual=this.controls?this.wheel.angle/Math.PI:null;
    const gearbox=s.gearbox,t=s.telemetry,buttonsShift=(!this.mapShortcut.captured[0]&&controllerButton(sources[0],4)>.5)||controllerButton(sources[0],5)>.5||this.buttonShift;
    let requested=false,withdrawing=false;
    if(!this.controls||!gearbox?.manual||!gearbox.ready||gearbox.count<4||gearbox.count>6||!t||buttonsShift) this.resetShifter();
    else {
      if(gearbox.epoch!==this.shiftEpoch){this.resetShifter();this.shiftEpoch=gearbox.epoch;}
      this.shifter.firstOnly=!!gearbox.firstOnly;
      const actual=gearbox.firstOnly?gearbox.selected??1:this.shiftRequest??t.gear,busy=[0,1].map(h=>captured[h]||this.wheel.grabbed[h]||this.panelHeld(h));
      const oldHand=this.shifter.hand,oldGear=this.shifter.gear,oldThrow=Math.abs(this.shifter.z);this.shifter.observe(squeeze);
      let request=this.settings.shift.mode?null:this.shifter.update(now,s.local!.model,gearbox.count,actual,positions,squeeze,busy);
      const motion=this.motion.update(this.settings.shift,this.shifter,now,s.local!.model,gearbox.count,actual,positions,frame.hands.map(h=>h?.matrix??null),squeeze,busy);
      request=motion??request;
      if(request!==null){this.shiftRequest=request;requested=true;this.pendingEngagement=request===1?null:{gear:request,hand:this.settings.shift.mode||motion!==null?this.motion.hand:this.shifter.hand,epoch:gearbox.epoch};}
      withdrawing=!this.settings.shift.mode&&this.shifter.hand>=0&&oldHand===this.shifter.hand&&oldGear===this.shifter.gear&&oldGear!==1&&Math.abs(this.shifter.z)+.001<oldThrow;
      if(oldHand!==this.shifter.hand)this.leverHand=null;
    }
    this.pedals.update(now,!!this.controls,this.controls?.throttle??0,this.controls?.brake??0,gearbox?.epoch??0,t?.gear??-1,
      !this.settings.shift.mode&&this.shifter.hand>=0&&this.shifter.gear===1,requested||withdrawing);
    for(let h=0;h<2;h++){
      const grip=this.wheel.grabbed[h]||this.shifter.hand===h||this.panelHeld(h);
      this.fingerWeights[h*2]=grip||pointing[h]?1:0;
      this.fingerWeights[h*2+1]=!grip&&pointing[h]?1:0;
    }
    if(this.settings.haptics)for(let h=0;h<2;h++)if(acquired&(1<<h))this.haptics.kick(h,.35,22,now);
    this.refreshHaptics(now);
  }
  private panelHeld(hand:number):boolean {return this.screenGrip.hand===hand||this.mapGrip.hand===hand||this.mirrorGrip.hand===hand;}
  private releasePanels(hand?:number):void {
    if(hand===undefined?this.mirrorGrip.release(this.mirrors):this.mirrorGrip.block(hand,this.mirrors))this.saveMirrors();
    for(const grip of [this.screenGrip,this.mapGrip]){
      const p=placement(this.settings,grip.kind),save=hand===undefined?grip.release(p):grip.block(hand,p);if(save)this.savePanel(grip.kind);
    }
  }
  private saveMirrors():void {
    const s=this.mirrors,deg=(v:number)=>String(Number((v*180/Math.PI).toFixed(5)));
    this.save({[mirrorKey(this.mirrorModel,'inside_yaw')]:deg(s.inside.yaw),[mirrorKey(this.mirrorModel,'inside_pitch')]:deg(s.inside.pitch),
      [mirrorKey(this.mirrorModel,'outside_yaw')]:deg(s.outside.yaw),[mirrorKey(this.mirrorModel,'outside_pitch')]:deg(s.outside.pitch)});
  }
  private savePanel(kind:PanelKind):void {
    const s=this.settings, cm=(v:number)=>String(Math.round(v*100)), deg=(v:number)=>String(Math.round(v*180/Math.PI));
    if(kind==='map'){this.save({vr_map_x:cm(s.mapX),vr_map_y:cm(s.mapY),vr_map_z:cm(s.mapZ),vr_map_pitch:deg(s.mapPitch),vr_map_yaw:deg(s.mapYaw)});return;}
    this.save({vr_screen_x:cm(s.screenX),vr_screen_y:cm(s.screenY),vr_screen_z:cm(s.screenZ),vr_screen_pitch:deg(s.pitch),vr_screen_yaw:deg(s.yaw),vr_screen_size:cm(s.screenScale)});
  }
  paint(now=performance.now()): boolean {
    if(now-this.lastPaint<33)return false; this.lastPaint=now;
    const g=this.context,w=this.canvas.width,h=screenLayout.contentHeight; g.fillStyle='#080e19';g.fillRect(0,0,w,screenLayout.height);
    const video=this.settings.page?null:this.media?.video,hasVideo=!!video&&video.readyState>=2&&video.videoWidth>0,track=this.timeline;
    if(hasVideo){
      if(this.mediaOverlayTrack!==track.id){this.mediaOverlayTrack=track.id;this.showMediaControls(now);}
      // A parked mouse still points at the display, but only while the current
      // camera puts it under the cursor. XR uses its live rays and fingertips.
      const mouseOver=!this.tracking&&this.pointerPosition&&this.pointerHit(...this.pointerPosition);
      if(mouseOver||this.pointerHeld||this.sliders.size||this.screenPresses.some(p=>p>=0)||this.screenGrip.hand>=0)this.showMediaControls(now);
    }else this.mediaOverlayTrack=null;
    if(this.settings.page) {
      g.save();g.scale(1,h/450);
      const s=this.history.at(-1); g.fillStyle='#e9f6ff';g.font='bold 36px sans-serif';g.fillText(t('Telemetry'),28,48);
      g.font='28px monospace';g.fillText(`${Math.round(Math.abs(s?.speed??0)*3.6)} km/h   ${Math.round(s?.rpm??0)} RPM   ${s ? (this.scene!.telemetry!.gear===0?'R':this.scene!.telemetry!.gear===1?'N':this.scene!.telemetry!.gear-1) : '—'}`,28,94);
      const rows: [keyof Sample,number,string,string][]=[['rpm',10000,'#62ddff','RPM'],['acceleration',20,'#ffbd58',t('Acceleration')+' m/s²'],['brake',1,'#ff6689',t('Braking')]];
      for(let r=0;r<rows.length;r++) {
        const [key,max,color,label]=rows[r],top=108+r*114;
        g.strokeStyle='#263447';g.lineWidth=1;for(let j=0;j<4;j++){g.beginPath();g.moveTo(28,top+28+j*23);g.lineTo(996,top+28+j*23);g.stroke();}
        g.fillStyle=color;g.font='21px sans-serif';g.fillText(label,28,top+18);g.strokeStyle=color;g.lineWidth=3;g.beginPath();
        this.history.forEach((p,i)=>{const x=996-(this.history.at(-1)!.time-p.time)/12000*968,v=key==='acceleration'?.5+p[key]/(max*2):p[key]/max,y=top+98-clamp(v,0,1)*69;i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();
      }
      g.restore();
    } else {
      if(hasVideo) {
        const height=screenLayout.height,scale=Math.min(w/video.videoWidth,height/video.videoHeight),dw=video.videoWidth*scale,dh=video.videoHeight*scale;
        g.drawImage(video,(w-dw)/2,(height-dh)/2,dw,dh);
      } else if(video){
        g.fillStyle='#e9f6ff';g.font='28px sans-serif';g.fillText(this.media!.videoStatus,32,h/2,w-64);
      } else {
        const spectrum=this.radio?.spectrum()??this.media?.spectrum(),color=this.led(); g.fillStyle=`rgb(${color.slice(0,3).map(v=>Math.round(v*255)).join(',')})`;
        for(let i=0;i<64;i++){const bar=(spectrum?.[i]??0)/255*(h-100);g.fillRect(32+i*15,h-72-bar,10,Math.max(2,bar));}
        g.fillStyle='#e9f6ff';g.font='28px sans-serif';g.fillText(this.radio?.title||this.media?.title||t('Choose media folder'),32,h-16,960);
      }
    }
    const opacity=hasVideo?clamp((this.mediaOverlayUntil+250-now)/250,0,1):1;
    if(opacity>0){
      g.save();g.globalAlpha=opacity;
      // Local backings keep controls legible without covering the gaps between them.
      const preview=[...this.sliders.values()].find(s=>s.control===SEEK&&s.id===track.id),current=preview?preview.value*track.duration:track.current;
      g.shadowColor='#080e19';g.shadowBlur=8;
      g.font='28px monospace';g.fillStyle='#e9f6ff';g.fillText(`${mediaTime(current)} / ${track.duration?mediaTime(track.duration):'—'}`,56,screenLayout.timeY);
      g.textAlign='right';g.fillText(`♪ ${Math.round(this.settings.volume*100)}%`,968,screenLayout.timeY);g.textAlign='left';g.shadowBlur=0;
      const hovered=this.hover?screenControl(this.hover):-1;
      for(const [control,range,value,enabled] of [[SEEK,seekRange,track.duration?current/track.duration:0,track.seekable],[VOLUME,volumeRange,this.settings.volume,true]] as const){
        const x=range[0]*w,width=(range[1]-range[0])*w,at=x+width*clamp(value,0,1);
        const active=enabled&&(hovered===control||[...this.sliders.values()].some(s=>s.control===control));
        g.fillStyle='rgba(8,14,25,.72)';g.beginPath();g.roundRect(x-32,screenLayout.sliderY-32,width+64,64,32);g.fill();
        g.lineCap='round';g.lineWidth=16;g.strokeStyle='#263447';g.beginPath();g.moveTo(x,screenLayout.sliderY);g.lineTo(x+width,screenLayout.sliderY);g.stroke();
        g.strokeStyle=enabled?'#62ddff':'#607080';g.beginPath();g.moveTo(x,screenLayout.sliderY);g.lineTo(at,screenLayout.sliderY);g.stroke();
        if(enabled){g.fillStyle=active?'#effaff':'#62ddff';g.beginPath();g.arc(at,screenLayout.sliderY,screenLayout.knobRadius,0,Math.PI*2);g.fill();g.strokeStyle=active?'#62ddff':'#080e19';g.lineWidth=4;g.stroke();}
      }
      for(const [i,x] of screenButtons.entries()){
        g.save();g.translate(x,screenLayout.buttonY);
        g.fillStyle=hovered===i?'#32648a':'rgba(8,14,25,.72)';g.strokeStyle=hovered===i?'#62ddff':'#647d98';g.lineWidth=hovered===i?4:2;
        g.beginPath();g.arc(0,0,i===4?screenLayout.pageRadius:screenLayout.buttonRadius,0,Math.PI*2);g.fill();g.stroke();
        screenIcon(g,i,(this.radio?.paused??this.media?.player.paused)!==false,this.settings.page);g.restore();
      }
      g.restore();
    }
    return true;
  }
  destroy(): void { this.finishSlider(2,true);this.track(null);this.haptics.destroy(); this.radio?.destroy();this.scene=null; }
}
