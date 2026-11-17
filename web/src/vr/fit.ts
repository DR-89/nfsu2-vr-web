import type { Mat4 } from './math';

export function fitPoint(p: readonly number[], f: readonly number[]): number[] {
  return [p[0] * (p[0] < 0 ? f[3] : f[4]) * f[6], p[1], p[2] < -.33 ? -.33 + (p[2] + .33) * f[5] : p[2]];
}
/** Native poll_wheel_grips: mesh +X follows grip +Z, fingertips follow
 * grip -Y, and the back follows grip +/-X for right/left hands. */
export function gloveAxes(hand: number): Mat4 { return new Float32Array([0,0,1,0, 0,-1,0,0, hand ? 1 : -1,0,0,0, 0,0,0,1]); }
