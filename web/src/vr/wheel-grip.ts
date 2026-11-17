import { wheel } from './cabin-parts';
import { identity, type Mat4 } from './math';
import type { VRSettings } from './settings';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((n, v, i) => n + v * b[i], 0);

/** Port of quest_wheel_grip.h. The wheel and hands keep their physical size
 * and rim plane across cars, including right-hand-drive cabins.
 * PC wheel input is already linear, so the Xbox stick encoding is omitted. */
export class WheelGrip {
  readonly pivot = wheel.pivot;
  readonly axis = wheel.axis;
  readonly radius = .185;
  readonly right: number[];
  readonly up: number[];
  angle = 0;
  latched = false;
  grabbed = [false, false];
  private blocked = [true, true];
  private rebase = [false, false];
  private previous = [0, 0];
  private anchor = [0, 0];
  private squeezeAt = [0, 0];
  private tick = 0;
  private requireGrip: boolean;
  constructor(private settings: VRSettings) {
    this.requireGrip = settings.wheelGrip;
    const a = this.axis, length = Math.hypot(a[2], a[0]);
    this.right = [a[2] / length, 0, -a[0] / length];
    this.up = [a[1] * this.right[2], a[2] * this.right[0] - a[0] * this.right[2], -a[1] * this.right[0]];
  }
  reset(): void { this.grabbed.fill(false); this.blocked.fill(true); this.rebase.fill(false); this.latched = false; }
  block(hand: number): void { this.grabbed[hand] = false; this.blocked[hand] = true; }
  get limit(): number { return this.settings.rotation * Math.PI / 360; }
  /** Returns the hands newly attached to the rim, for the contact impulse. */
  update(now: number, active: boolean, position: (readonly number[] | null)[], squeeze: number[], busy: boolean[], fallback: number): number {
    if (!active) { this.reset(); return 0; }
    const manual = this.settings.wheelGrip;
    if (manual !== this.requireGrip || (!manual && (now < this.tick || now - this.tick > 250))) {
      // Keep the steering angle, but never apply motion from before a mode
      // change or tracking gap. Button mode needs a fresh release to arm.
      this.grabbed.fill(false); this.blocked.fill(true); this.rebase.fill(false);
    }
    this.requireGrip = manual;
    const free = this.latched && !this.grabbed.some(Boolean), elapsed = clamp(now - this.tick, 0, 100);
    this.tick = now;
    if (!this.latched) this.angle = clamp(fallback / this.settings.sensitivity, -1, 1) * this.limit;
    let delta = 0, contributors = 0, acquired = 0;
    for (let h = 0; h < 2; h++) {
      if (busy[h]) { this.block(h); continue; }
      if (manual && !Number.isFinite(squeeze[h])) {
        if (this.grabbed[h]) {
          this.rebase[h] = true;
          if (now - this.squeezeAt[h] >= 500) this.block(h);
        }
        continue;
      }
      this.squeezeAt[h] = now;
      if (manual && squeeze[h] < .15) { this.grabbed[h] = this.blocked[h] = this.rebase[h] = false; continue; }
      if (manual && this.blocked[h]) continue;
      const pos = position[h];
      if (!pos || pos.length !== 3 || !pos.every(Number.isFinite)) {
        if (!manual) this.grabbed[h] = false;
        else if (this.grabbed[h]) this.rebase[h] = true;
        continue;
      }
      const p = pos.map((v, i) => v - this.pivot[i]), x = dot(p, this.right), y = dot(p, this.up), r = Math.hypot(x, y), depth = dot(p, this.axis);
      // Distance to the rim, not its whole disc. A 4 cm hysteresis band
      // absorbs tracking jitter; leaving the band releases that hand.
      if (!manual && Math.hypot(r - this.radius, depth) > (this.grabbed[h] ? .12 : .08)) {
        this.grabbed[h] = false; this.rebase[h] = false; continue;
      }
      if (r < .06) { if (this.grabbed[h]) this.rebase[h] = true; continue; }
      const theta = Math.atan2(y, x);
      if (!this.grabbed[h]) {
        if (manual && (squeeze[h] < .65 || Math.abs(r - this.radius) > .12 || Math.abs(depth) > .14)) continue;
        this.grabbed[h] = this.latched = true; this.previous[h] = theta; this.rebase[h] = false; acquired |= 1 << h;
      } else if (this.rebase[h]) { this.previous[h] = theta; this.rebase[h] = false; }
      else {
        let d = theta - this.previous[h];
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) <= .8) { delta -= d; contributors++; }
        this.previous[h] = theta;
      }
    }
    if (contributors) this.angle = clamp(this.angle + delta / contributors, -this.limit, this.limit);
    if (free && !this.grabbed.some(Boolean)) this.angle = Math.sign(this.angle) * Math.max(0, Math.abs(this.angle) - this.settings.returnSpeed * Math.PI / 180000 * elapsed);
    for (let h = 0; h < 2; h++) if (acquired & (1 << h)) this.anchor[h] = this.previous[h] + this.angle;
    return acquired;
  }
  input(stick: number): number {
    if (this.latched && !this.grabbed.some(Boolean) && Math.abs(stick) >= .25) {
      this.latched = false; this.angle = clamp(stick / this.settings.sensitivity, -1, 1) * this.limit;
    }
    if (!this.latched) return stick;
    const v = clamp(this.angle / this.limit * this.settings.sensitivity, -1, 1), dz = this.settings.steeringDeadzone;
    return Math.sign(v) * Math.max(0, (Math.abs(v) - dz) / (1 - dz));
  }
  /** Fixed contact on the rendered rim, including while tracking is rebased. */
  handMatrix(hand: number): Mat4 | null {
    if (!this.grabbed[hand]) return null;
    const theta = this.anchor[hand] - this.angle, c = Math.cos(theta), s = Math.sin(theta), out = identity();
    for (let k = 0; k < 3; k++) {
      const radial = c * this.right[k] + s * this.up[k], tangent = -s * this.right[k] + c * this.up[k];
      out[k] = tangent * (hand ? -1 : 1); out[4 + k] = -this.axis[k]; out[8 + k] = radial;
      out[12 + k] = this.pivot[k] + radial * (this.radius + .027) + this.axis[k] * .020;
    }
    return out;
  }
}
