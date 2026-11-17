// Column-major matrices, column vectors, metres. WebXR/WebGPU already supplies
// 0..1 depth; applying the WebGL depth conversion here would break stereo.
export type Mat4 = Float32Array<ArrayBuffer>;
// The retail sky reaches the original camera's far plane (about 15 km).
// Keep it inside XR's clip volume, including the largest 30 km guest camera
// and float32 inverse-projection rounding. Guest culling is unchanged.
export const XR_DEPTH_NEAR=.05, XR_DEPTH_FAR=60000;
export function identity(): Mat4 { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
export function inverse(a: ArrayLike<number>): Mat4 | null {
  if (a.length !== 16 || Array.from(a).some(x => !Number.isFinite(x))) return null;
  const rows = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => c < 4 ? a[c * 4 + r] : +(c - 4 === r)));
  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(rows[r][i]) > Math.abs(rows[pivot][i])) pivot = r;
    if (Math.abs(rows[pivot][i]) < 1e-9) return null;
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    const divisor = rows[i][i]; for (let c = 0; c < 8; c++) rows[i][c] /= divisor;
    for (let r = 0; r < 4; r++) if (r !== i) {
      const factor = rows[r][i]; for (let c = 0; c < 8; c++) rows[r][c] -= factor * rows[i][c];
    }
  }
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = rows[r][c + 4];
  return o;
}
export const GAME_TO_XR = new Float32Array([1,0,0,0, 0,-1,0,0, 0,0,-1,0, 0,0,0,1]);
export function eyeCorrection(projection: ArrayLike<number>, eyeView: ArrayLike<number>, recordedHeadView: ArrayLike<number>, gameProjection: ArrayLike<number>): Mat4 | null {
  const p = inverse(gameProjection), h = inverse(recordedHeadView);
  return p && h ? multiply(projection, multiply(eyeView, multiply(h, multiply(GAME_TO_XR, p)))) : null;
}
export function vertexStereo(code: string): string {
  if (!code.includes('@vertex') || !code.includes('return o;')) return code;
  return `@group(0) @binding(4) var<uniform> XREye: mat4x4f;\n${code.replaceAll('return o;', 'o.pos = XREye * o.pos; return o;')}`;
}

/** Only legacy WebXR/WebGL uses -1..1 depth. Its matrices must be converted
 * before they reach the WebGPU scene renderer. */
export function webGLProjection(projection: ArrayLike<number>): Mat4 {
  const p = new Float32Array(projection);
  for (let c = 0; c < 4; c++) p[c * 4 + 2] = .5 * (projection[c * 4 + 2] + projection[c * 4 + 3]);
  return p;
}
