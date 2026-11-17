// Kind 34 belongs to the mod on the existing LAN connection. The server assigns
// identity and routes. Race peer addresses express reciprocal LAN consent;
// they cannot override the server's free-roam or Online membership.
export const MOD_KIND = 34, MOD_VERSION = 1, MOD_MAX_BYTES = 16_384;
export interface Pose { p: [number, number, number]; q: [number, number, number, number] }
// cockpit appearance bits: 0..2 colour, 4 active zone, 5/6 up/down cue,
// 8 LEDs enabled, 9..12 brightness. Zero remains the legacy unlit cabin.
/** Left curl/index extension, then right; absent packets retain the legacy grip. */
export type Fingers = [number,number,number,number];
export interface Avatar { car: number; cockpit: number; vr: boolean; head: Pose | null; left: Pose | null; right: Pose | null; wheel?: number; shifter?: [number,number]; pedals?: [number,number,number]; fingers?: Fingers }
export interface Cop { id: number; model: number; pose: Pose; velocity: [number, number, number]; target: number; lights: boolean }
export interface Police { epoch: number; tick: number; cars: Cop[] }
export type ModRequest =
  | { op: 'join'; version: number; room: string; cops: boolean }
  | { op: 'update'; seq: number; avatar: Avatar | null; secondary?:Avatar|null; police: Police | null; peers?: number[] }
  | { op: 'leave' };
export type ModEvent =
  | { op: 'joined'; version: number; you: number; room: string }
  | { op: 'ack'; seq: number }
  | { op: 'avatar'; from: number; seq: number; avatar: Avatar | null; secondary?:Avatar|null }
  | { op: 'gone'; from: number }
  | { op: 'authority'; host: number | null; epoch: number; police: Police | null }
  | { op: 'police'; host: number; police: Police }
  | { op: 'rejected'; reason: string };
export function encodeMod(message: ModRequest): Uint8Array<ArrayBuffer> {
  const body = new TextEncoder().encode(JSON.stringify(message));
  if (body.length > MOD_MAX_BYTES) throw new RangeError('mod frame too large');
  const bytes = new Uint8Array(body.length + 4);
  bytes[0] = MOD_KIND; bytes.set(body, 4); return bytes;
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown, max = 0xffff_ffff): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const vector = (v: unknown, n: number, bound: number): v is number[] => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= bound);
export function validPose(v: unknown, bound = 4): v is Pose {
  if (!object(v) || !vector(v.p, 3, bound) || !vector(v.q, 4, 1.1)) return false;
  const norm = v.q.reduce((s, x) => s + x * x, 0); return norm >= .9 && norm <= 1.1;
}
export function validAvatar(v: unknown): v is Avatar | null {
  return v === null || object(v) && integer(v.car) && integer(v.cockpit, 65535) && typeof v.vr === 'boolean'
    && (v.wheel === undefined || typeof v.wheel === 'number' && Number.isFinite(v.wheel) && Math.abs(v.wheel) <= 3)
    && (v.shifter === undefined || vector(v.shifter,2,.1))
    && (v.pedals === undefined || vector(v.pedals,3,1)&&v.pedals.every(x=>x>=0))
    && (v.fingers === undefined || vector(v.fingers,4,1)&&v.fingers.every(x=>x>=0))
    && [v.head, v.left, v.right].every(p => p === null || validPose(p));
}
export function validPolice(v: unknown): v is Police {
  if (!object(v) || !integer(v.epoch, Number.MAX_SAFE_INTEGER) || !integer(v.tick) || !Array.isArray(v.cars) || v.cars.length > 16) return false;
  const ids = new Set<number>();
  return v.cars.every(c => {
    if (!object(c) || !integer(c.id, 65535) || c.id === 0 || ids.has(c.id) || !integer(c.model, 65535)
      || !validPose(c.pose, 100_000) || !vector(c.velocity, 3, 200) || !integer(c.target) || typeof c.lights !== 'boolean') return false;
    ids.add(c.id); return true;
  });
}
export function decodeMod(bytes: Uint8Array): ModEvent | null {
  if (bytes.length < 5 || bytes.length > MOD_MAX_BYTES + 4 || bytes[0] !== MOD_KIND || bytes[1] || bytes[2] || bytes[3]) return null;
  let m: unknown;
  try { m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4))); } catch { return null; }
  if (!object(m)) return null;
  switch (m.op) {
    case 'joined': if (m.version === MOD_VERSION && integer(m.you) && typeof m.room === 'string' && m.room.length <= 63) return m as ModEvent; break;
    case 'ack': if (integer(m.seq)) return m as ModEvent; break;
    case 'avatar': if (integer(m.from) && integer(m.seq) && validAvatar(m.avatar) && (m.secondary===undefined||m.secondary===null||validAvatar(m.secondary)&&m.secondary.car!==0&&m.secondary.car!==m.avatar?.car)) return m as ModEvent; break;
    case 'gone': if (integer(m.from)) return m as ModEvent; break;
    case 'authority': if ((m.host === null || integer(m.host)) && integer(m.epoch, Number.MAX_SAFE_INTEGER) && (m.police === null || validPolice(m.police))) return m as ModEvent; break;
    case 'police': if (integer(m.host) && validPolice(m.police)) return m as ModEvent; break;
    case 'rejected': if (typeof m.reason === 'string' && m.reason.length <= 64) return m as ModEvent; break;
  }
  return null;
}
