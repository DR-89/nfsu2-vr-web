import type { ImmersiveSession } from './session';
import { WebGLXRBridge } from './webgl-bridge';

/** Requests XR in the start button's user gesture, then holds it while the
 * ordinary game startup runs. Exactly one renderer takes ownership. */
export class VRLaunch {
  readonly ready: Promise<XRSession>;
  private cancelled = false;
  private taken = false;
  private session: XRSession | null = null;
  constructor(log: (line: string) => void = () => {}) {
    if (!navigator.xr) throw new Error('WebXR is unavailable');
    // The GPU device does not exist yet. This session uses the WebGL presentation
    // bridge, which works with the renderer's ordinary WebGPU device.
    this.ready = navigator.xr.requestSession('immersive-vr', { requiredFeatures: [], optionalFeatures: ['local-floor'] }).then(async session => {
      this.session = session;
      session.addEventListener('end', () => { this.cancelled = true; }, { once: true });
      if (this.cancelled) { await session.end(); return session; }
      try {
        await WebGLXRBridge.prepare(session);
        if (this.cancelled) throw new Error('The VR launch ended before the game was ready');
        log('[vr] presentation GPU ready before game renderer');
      } catch (error) { if (!this.cancelled) await session.end().catch(() => {}); throw error; }
      return session;
    });
  }
  async connect(vr: ImmersiveSession): Promise<void> {
    const session = await this.ready;
    if (this.cancelled || this.taken) throw new Error('The VR launch ended before the game was ready');
    this.taken = true;
    await vr.enter(session);
  }
  cancel(): void {
    if (this.taken || this.cancelled) return;
    this.cancelled = true;
    if (this.session) void this.session.end().catch(() => {});
    // A late permission answer is ended by the request handler above. Do not
    // wait for graphics preparation to finish before releasing an open session.
    void this.ready.catch(() => {});
  }
}
