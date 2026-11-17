import { localStore, VR_RENDER_PIXELS } from '../app/prefs';
import { t } from '../app/i18n';

export interface EyePixels {
  eye: 'left' | 'right' | 'none';
  width: number; height: number;
  viewportWidth: number; viewportHeight: number;
}
export interface VRRenderPixels { scale: number; layerScale?: number; limit: number; eyes: EyePixels[] }

/** The render target uses the runtime's viewport, bounded by WebGPU's limit. */
export function fitEyePixels(width: number, height: number, limit: number) {
  const scale = Math.min(1, limit / Math.max(width, height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** Device-local measurements are never part of settings.ini or cloud profiles. */
export function lastVRPixels(): VRRenderPixels | null {
  const v = localStore.getJSON(VR_RENDER_PIXELS);
  if (!v || typeof v !== 'object') return null;
  const s = v as Partial<VRRenderPixels>;
  const dimension = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 65536;
  if (![.5, .75, 1, 1.25, 1.5, 2].includes(s.scale ?? 0) || !dimension(s.limit) || !Array.isArray(s.eyes) || !s.eyes.length || s.eyes.length > 2) return null;
  const layerScale = s.layerScale ?? s.scale!;
  if (![.5, .75, 1, 1.25, 1.5, 2].includes(layerScale)) return null;
  for (const e of s.eyes) {
    if (!e || !['left', 'right', 'none'].includes(e.eye) || !dimension(e.width) || !dimension(e.height) || !dimension(e.viewportWidth) || !dimension(e.viewportHeight)) return null;
    const fitted = fitEyePixels(e.viewportWidth * s.scale! / layerScale, e.viewportHeight * s.scale! / layerScale, s.limit);
    if (e.width !== fitted.width || e.height !== fitted.height) return null;
  }
  return s as VRRenderPixels;
}

export const keepVRPixels = (pixels: VRRenderPixels) => localStore.setJSON(VR_RENDER_PIXELS, pixels);

function sizes(eyes: EyePixels[], selected?: number, sample?: VRRenderPixels): string {
  const ordered = [...eyes].sort((a, b) => a.eye.localeCompare(b.eye));
  const pixels = ordered.map(e => selected !== undefined && sample
    ? fitEyePixels(e.viewportWidth * selected / (sample.layerScale ?? sample.scale), e.viewportHeight * selected / (sample.layerScale ?? sample.scale), sample.limit) : e);
  if (pixels.every(p => p.width === pixels[0].width && p.height === pixels[0].height))
    return t('{width} × {height} px per eye', pixels[0]);
  return t('Left: {left}; right: {right}', { left: `${pixels[0].width} × ${pixels[0].height} px`, right: `${pixels[1].width} × ${pixels[1].height} px` });
}

/** A measurement is exact only for that session. Other scales are estimates:
 * runtimes can round or cap their layers and a different headset can be used. */
export function vrPixelsText(sample: VRRenderPixels | null, live: boolean, selected: number): string {
  if (!sample) return t('Start VR once to measure the pixel dimensions.');
  const vars = { size: sizes(sample.eyes), scale: Math.round(sample.scale * 100) };
  const measured = live ? t('Rendering: {size} ({scale}%).', vars) : t('Last VR session: {size} ({scale}%).', vars);
  return selected === sample.scale ? measured : measured + ' ' + t('Selected: approximately {size}. Applies when entering VR.', { size: sizes(sample.eyes, selected, sample) });
}
