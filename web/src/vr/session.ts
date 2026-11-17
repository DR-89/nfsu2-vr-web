import { adjustedPose, vrSettings } from './settings';
import {stanceModels,stanceModelsValue} from './stance-models';
import { WebGLXRBridge } from './webgl-bridge';
import { webGLProjection,XR_DEPTH_NEAR,XR_DEPTH_FAR } from './math';
import type { GameProcess } from '../host/process';
import { HostKind } from '../host/abi';
import { identity, inverse, multiply, type Mat4 } from './math';
import type { Pose } from './protocol';
import type { MirrorRequest } from './mirrors';
import { RecenterChord } from './navigation';
import type {ScreenOverlay} from './cinema';
import { fitEyePixels, type VRRenderPixels } from './resolution-info';

export interface Eye {
  projection: Float32Array;
  view: Mat4;
  image?: XRGPUSubImage;
  xrView: XRView;
}
export interface Hand { pose: Pose; matrix: Mat4; source: XRInputSource }
export interface RenderEye {projection:Mat4;view:Mat4;width:number;height:number}
export interface ImmersiveFrame {
  eyes: Eye[];
  head: Mat4;
  hands: [Hand | null, Hand | null];
  sources?: [XRInputSource | null, XRInputSource | null];
  time: number;
}

/** Owns the XR lifetime. Browser-owned eye textures are only ever used inside
 * its animation callback. Ending VR releases controls and resumes the flat game. */
export class ImmersiveSession {
  settings = vrSettings({});
  active = false;
  bridge: WebGLXRBridge | null = null;
  inFrame = false;
  frame: ImmersiveFrame | null = null;
  /** Copied optics and dimensions, without any browser-owned XR textures or
   * frame objects. Offscreen rendering can use these between XR callbacks. */
  renderEyes:RenderEye[]=[];
  format: GPUTextureFormat = 'bgra8unorm';
  onFrame: ((time: number) => void) | null = null;
  onTracking: ((frame: ImmersiveFrame | null) => void) | null = null;
  onVisibility: ((visible: boolean | null) => void) | null = null;
  onResolution: ((pixels: VRRenderPixels | null) => void) | null = null;
  private pixels: VRRenderPixels | null = null;
  private eyeScale = 1;
  /** Immersive focus is independent of the browser window's focus. */
  get visibility(): boolean | null { return this.session ? this.session.visibilityState === 'visible' : null; }
  overlay:ScreenOverlay|null=null;
  private command = 0;
  get gearCommand():number {return this.command;}
  set gearCommand(value:number) {
    this.command=value>>>0;
    if(!this.ptr)return;
    // Ownership must be visible before the separate pad mailbox publishes a
    // shift-button edge. Do not renew the pose heartbeat with a command alone.
    const u=new Uint32Array(this.proc.memory.buffer,this.ptr,24);
    if(u[23]===this.command)return;
    Atomics.add(u,2,1);u[23]=this.command;Atomics.add(u,2,1);
  }
  private session: XRSession | null = null;
  /** The headset's nominal rate does not fall when an application misses frames. */
  get refreshRate(): number {
    const rate=this.session?.frameRate;
    return this.active && rate && Number.isFinite(rate) && rate>=30 && rate<=240 ? rate : 0;
  }
  private opening = false;
  private sessionId = 0;
  private disposed = false;
  private anchor: Mat4 | null = null;
  private recenterChord = new RecenterChord();
  private ptr = 0;
  private mailboxSize=0;
  get replayEpoch():number{
    return this.ptr && this.mailboxSize>=136 && this.active && !this.disposed
      ?Atomics.load(new Uint32Array(this.proc.memory.buffer,this.ptr,34),30):0;
  }
  replayAction(epoch:number,camera:boolean,timeline:boolean):void{
    if(!epoch || epoch!==this.replayEpoch || (!camera&&!timeline))return;
    const u=new Uint32Array(this.proc.memory.buffer,this.ptr,34);
    Atomics.add(u,2,1);u[31]=epoch;if(camera)u[32]++;if(timeline)u[33]++;Atomics.add(u,2,1);
  }
  set mirrorCapture(request:MirrorRequest|null){
    if(!this.ptr || this.mailboxSize<120 || this.disposed)return;
    const b=this.proc.memory.buffer,u=new Uint32Array(b,this.ptr,30),f=new Float32Array(b,this.ptr,30);
    Atomics.add(u,2,1);u[27]=request?.car??0;f.set(request?.origin??[0,0,0],24);
    new Float64Array(b,this.ptr+112,1)[0]=performance.timeOrigin+performance.now();Atomics.add(u,2,1);
  }
  private gameOptions:[number,boolean,boolean,boolean]|null=null;
  private carLimitOption:number|null=null;
  private stanceOptions:[string,boolean]|null=null;
  stanceSettings(models:string,enabled:boolean):void{
    const parsed=stanceModels(models);if(this.disposed||!parsed)return;
    models=stanceModelsValue(parsed);this.stanceOptions=[models,enabled];
    if(!this.ptr||this.mailboxSize<4264)return;
    const u=new Uint32Array(this.proc.memory.buffer,this.ptr,42);
    if(u[1]<3)return;
    const bytes=new Uint8Array(this.proc.memory.buffer,this.ptr+168,4096),encoded=new TextEncoder().encode(models);
    if(u[40]&&u[41]===Number(enabled)&&bytes[encoded.length]===0&&encoded.every((b,i)=>bytes[i]===b))return;
    Atomics.add(u,2,1);bytes.fill(0);bytes.set(encoded);u[41]=Number(enabled);u[40]=(u[40]+1)>>>0||1;Atomics.add(u,2,1);
  }
  carLimit(limit:number):void{
    if(this.disposed||!Number.isInteger(limit)||limit < -1||limit>64)return;
    this.carLimitOption=limit;
    if(!this.ptr||this.mailboxSize<4272)return;
    const u=new Uint32Array(this.proc.memory.buffer,this.ptr,1068),i=new Int32Array(this.proc.memory.buffer,this.ptr,1068);
    if(u[1]<4||u[1066]&&i[1067]===limit)return;
    Atomics.add(u,2,1);i[1067]=limit;u[1066]=(u[1066]+1)>>>0||1;Atomics.add(u,2,1);
  }
  gameSettings(lights:number,gps:boolean,special=false,whine=false):void{
    if(this.disposed||!Number.isInteger(lights)||lights<0||lights>2)return;
    this.gameOptions=[lights,gps,special,whine];
    if(!this.ptr||this.mailboxSize<160)return;
    const u=new Uint32Array(this.proc.memory.buffer,this.ptr,40);
    const extended=u[1]>=2,mask=extended?15:3;
    if(u[35]===mask&&u[36]===lights&&u[37]===Number(gps)&&(!extended||u[38]===Number(special)&&u[39]===Number(whine)))return;
    Atomics.add(u,2,1);u[34]=(u[34]+1)>>>0||1;u[35]=mask;u[36]=lights;u[37]=Number(gps);if(extended){u[38]=Number(special);u[39]=Number(whine);}Atomics.add(u,2,1);
  }
  private layer: XRProjectionLayer | null = null;
  private raf = 0;
  private ready: Promise<void>;
  private stopped!: () => void;
  private stop = new Promise<void>(resolve => { this.stopped = resolve; });
  constructor(private proc: GameProcess, private device: GPUDevice, private log: (s: string) => void, private directAvailable = false, private preferredFrameRate:90|120 = 90) {
    this.ready = proc.registered(HostKind.Vr).then(r => {
      if (this.disposed || ![96,120,136,160,4264,4272].includes(r.size)) return;
      const u = new Uint32Array(proc.memory.buffer, r.ptr, 2);
      if (u[0] === 0x3152564e && (u[1] === 1 || u[1] === 2 || u[1] === 3 || u[1] === 4)){this.ptr=r.ptr;this.mailboxSize=r.size;if(this.gameOptions)this.gameSettings(...this.gameOptions);if(this.stanceOptions)this.stanceSettings(...this.stanceOptions);if(this.carLimitOption!==null)this.carLimit(this.carLimitOption);}
    });
  }
  static async supported(): Promise<boolean> {
    if (!isSecureContext || !navigator.xr) return false;
    try { return await navigator.xr.isSessionSupported('immersive-vr'); } catch { return false; }
  }
  async enter(requested?: XRSession): Promise<void> {
    if (this.active || this.opening || this.disposed) { await requested?.end().catch(() => {}); return; }
    if (!navigator.xr && !requested) throw new Error('WebXR is unavailable');
    const direct = !requested && this.directAvailable && typeof XRGPUBinding !== 'undefined';
    if (!this.ptr && !requested) throw new Error('The VR game runtime is not ready');
    this.opening = true;
    let session: XRSession | null = requested ?? null;
    try {
      // This must be reached directly from a user click, before any await.
      session ??= await navigator.xr!.requestSession('immersive-vr', { requiredFeatures: direct ? ['webgpu'] : [], optionalFeatures: ['local-floor'] });
      if (this.disposed) { await session.end(); return; }
      this.session = session;
      session.addEventListener('visibilitychange', () => {
        if (this.session !== session) return;
        this.onVisibility?.(this.visibility);
        if (!this.visibility) {
          this.renderEyes = []; this.gearCommand = 0; this.recenterChord.reset();
          this.write(null); this.onTracking?.(null);
        }
      });
      this.onVisibility?.(this.visibility);
      let onEnd!: () => void;
      const closed = new Promise<void>(resolve => { onEnd = resolve; });
      session.addEventListener('end', () => { onEnd(); if (this.session === session) this.ended(); }, { once: true });
      // A headset already running at 120 Hz must not be reduced to 90. The
      // site's fixed 120/240 FPS choice also requests 120 Hz where available.
      const rates=session.supportedFrameRates;
      const target=this.preferredFrameRate===120 && rates?.includes(120)?120:
        (session.frameRate??0)<90 && rates?.includes(90)?90:0;
      if(target && session.frameRate!==target && session.updateTargetFrameRate){
        await Promise.race([session.updateTargetFrameRate(target).catch(error=>this.log(`[vr] headset kept its current refresh rate: ${error}`)),closed,this.stop]);
      }
      if (requested) await Promise.race([this.ready, this.stop, closed]);
      if (this.disposed || this.session !== session) return;
      if (!this.ptr) throw new Error('The VR game runtime is not ready');
      const space = await session.requestReferenceSpace('local');
      if (this.disposed || this.session !== session) return;
      const binding = direct ? new XRGPUBinding(session, this.device) : null;
      const renderScale = this.settings.renderScale;
      // Chromium caps compositor layers at the native size (Quest reports a
      // native scale of 1). Supersample our scene independently, then resolve
      // into the supported output. Reduced scales still use smaller layers.
      const layerScale = Math.min(1, renderScale);
      this.eyeScale = renderScale / layerScale;
      const layer = binding ? binding.createProjectionLayer({ colorFormat: binding.getPreferredColorFormat(), scaleFactor: layerScale }) : null;
      this.layer = layer;
      if (binding && layer) {
        this.format = binding.getPreferredColorFormat();
        session.updateRenderState({ layers: [layer], depthNear: XR_DEPTH_NEAR, depthFar: XR_DEPTH_FAR });
      } else {
        const bridge = await WebGLXRBridge.create(session, this.device, layerScale);
        if (this.disposed || this.session !== session) { bridge.destroy(); return; }
        this.bridge = bridge;
        this.log(`[vr] presentation GPU: ${bridge.renderer}`);
      }
      this.sessionId=(this.sessionId+1)>>>0||1;
      this.active = true; this.anchor = null;
      const draw = (time: number, frame: XRFrame) => {
        if (!this.active || this.disposed || this.session !== session) return;
        this.raf = frame.session.requestAnimationFrame(draw);
        this.renderEyes=[];
        const viewer = frame.getViewerPose(space);
        if (!viewer || frame.session.visibilityState !== 'visible') { this.renderEyes=[];this.recenterChord.reset();this.write(null); this.onTracking?.(null); return; }
        this.anchor ??= new Float32Array(viewer.transform.matrix);
        const anchorInv = inverse(this.anchor);
        if (!anchorInv) return;
        const head = adjustedPose(multiply(anchorInv, viewer.transform.matrix), this.settings), view = inverse(head);
        if (!view) return;
        const hands: [Hand | null, Hand | null] = [null, null], sources: [XRInputSource | null, XRInputSource | null] = [null, null];
        for (const source of frame.session.inputSources) {
          const index = source.handedness === 'left' ? 0 : source.handedness === 'right' ? 1 : -1;
          if (index < 0) continue;
          sources[index === 0 ? 0 : 1] = source;
          if (!source.gripSpace) continue;
          const pose = frame.getPose(source.gripSpace, space);
          if (!pose) continue;
          const matrix = adjustedPose(multiply(anchorInv, pose.transform.matrix), this.settings);
          const hand = { matrix, source, pose: poseFromMatrix(matrix) };
          if (index === 0) hands[0] = hand; else hands[1] = hand;
        }
        if(this.recenterChord.sample(sources)){this.recenter();return;}
        this.frame = { time, head, hands, sources, eyes: viewer.views.map(v => ({ projection: direct ? v.projectionMatrix : webGLProjection(v.projectionMatrix), xrView: v,
          view: inverse(adjustedPose(multiply(anchorInv, v.transform.matrix), this.settings))!, image: binding && layer ? binding.getViewSubImage(layer, v) : undefined })) };
        this.renderEyes=this.frame.eyes.slice(0,2).flatMap(eye=>{
          const size=this.eyeSize(eye);return size?[{projection:new Float32Array(eye.projection),view:new Float32Array(eye.view),...size}]:[];
        });
        this.reportResolution(renderScale, layerScale);
        this.inFrame = true;
        try { this.onTracking?.(this.frame);if(this.anchor){this.write(view);this.onFrame?.(time);} }
        catch (error) { this.log(`[vr] frame: ${error}`); void this.exit(); }
        finally { this.inFrame = false; this.frame = null; }
      };
      this.raf = session.requestAnimationFrame(draw);
      this.log(`[vr] immersive session started (${direct ? 'WebGPU layers' : 'WebGL presentation bridge'})`);
    } catch (error) {
      if (session) await session.end().catch(() => {});
      this.ended(); throw error;
    } finally { this.opening = false; }
  }
  recenter(): void { this.renderEyes=[];this.gearCommand=0;this.write(null);this.onTracking?.(null); this.anchor = null; }
  /** The runtime can cap the requested layer size. Render at its actual viewport. */
  eyeSize(eye:Eye):{width:number;height:number}|null {
    const viewport=eye.image?.viewport??this.bridge?.viewport(eye.xrView);
    if(!viewport || !(viewport.width>0 && viewport.height>0))return null;
    return fitEyePixels(viewport.width * this.eyeScale, viewport.height * this.eyeScale, this.device.limits.maxTextureDimension2D);
  }
  private reportResolution(scale: number, layerScale: number): void {
    const eyes = this.renderEyes;
    if (!eyes.length || !this.frame || this.pixels?.scale === scale && this.pixels.eyes.length === eyes.length &&
      eyes.every((e, i) => e.width === this.pixels!.eyes[i].width && e.height === this.pixels!.eyes[i].height)) return;
    const measured = this.frame.eyes.slice(0, 2).flatMap(eye => {
      const viewport = eye.image?.viewport ?? this.bridge?.viewport(eye.xrView);
      const size = this.eyeSize(eye);
      return viewport && size ? [{ eye: eye.xrView.eye, ...size, viewportWidth: viewport.width, viewportHeight: viewport.height }] : [];
    });
    if (!measured.length) return;
    this.pixels = { scale, layerScale, limit: this.device.limits.maxTextureDimension2D, eyes: measured };
    this.onResolution?.(this.pixels);
  }
  async exit(): Promise<void> { await this.session?.end(); }
  private write(view: Mat4 | null): void {
    if (!this.ptr) return;
    const buffer = this.proc.memory.buffer, u = new Uint32Array(buffer, this.ptr, 24);
    Atomics.add(u, 2, 1);
    u[3] = view ? this.sessionId : 0;
    new Float64Array(buffer, this.ptr + 16, 1)[0] = performance.timeOrigin + performance.now();
    new Float32Array(buffer, this.ptr + 24, 16).set(view ?? identity());
    new Float32Array(buffer, this.ptr + 88, 1)[0] = 1.9;
    u[23]=view?this.gearCommand:0;
    Atomics.add(u, 2, 1);
  }
  private ended(): void {
    if (this.session) this.session.cancelAnimationFrame(this.raf);
    this.gearCommand = 0;
    this.active = false; this.session = null; this.frame = null;this.renderEyes=[]; this.anchor = null;this.recenterChord.reset();
    this.onVisibility?.(null);
    this.pixels = null; this.onResolution?.(null);
    this.bridge?.destroy(); this.bridge = null;
    this.layer?.destroy(); this.layer = null; this.write(null); this.onTracking?.(null);
  }
  detach(): void { this.disposed = true; this.stopped(); void this.exit().catch(() => {}); this.ended(); }
}

export function poseFromMatrix(m: ArrayLike<number>): Pose {
  // Stable quaternion extraction, including 180-degree rotations.
  const q: [number, number, number, number] = [0, 0, 0, 1], trace = m[0] + m[5] + m[10];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2; q[3] = s / 4; q[0] = (m[6] - m[9]) / s; q[1] = (m[8] - m[2]) / s; q[2] = (m[1] - m[4]) / s;
  } else {
    const i = m[0] > m[5] && m[0] > m[10] ? 0 : m[5] > m[10] ? 1 : 2, j = (i + 1) % 3, k = (i + 2) % 3;
    const s = Math.sqrt(1 + m[i * 5] - m[j * 5] - m[k * 5]) * 2;
    q[i] = s / 4; q[3] = (m[j * 4 + k] - m[k * 4 + j]) / s;
    q[j] = (m[j * 4 + i] + m[i * 4 + j]) / s; q[k] = (m[k * 4 + i] + m[i * 4 + k]) / s;
  }
  const norm = Math.hypot(...q); for (let i = 0; i < 4; i++) q[i] /= norm;
  return { p: [m[12], m[13], m[14]], q };
}
