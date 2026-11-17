import { MOD_VERSION, type Avatar, type ModEvent, type ModRequest, type Police } from './protocol';

export interface RemoteAvatar { current: Avatar | null; previous: Avatar | null; at: number; before: number; seq: number; secondary?:RemoteAvatar }
/** Runs for flat and VR sessions alike. Tracking is expressed relative to the
 * player's car, so late car snapshots do not leave the driver's hands behind. */
export class ModMultiplayer {
  readonly avatars = new Map<number, RemoteAvatar>();
  police: Police | null = null;
  host: number | null = null;
  epoch = 0;
  you: number | null = null;
  private seq = 0;
  private joined = false;
  private sentAt = -Infinity;
  private heardAt = -Infinity;
  private policeAt = -Infinity;
  private joinAt = -Infinity;
  private sentTick: number | null = null;
  private roamRoom: string | null = null;
  private identity: number | null = null;
  private racePeers: number[] = [];
  private peersAt = -Infinity;
  constructor(private send: (m: ModRequest) => boolean, public room: string, public cops = false) {}
  get authority(): boolean { return this.cops && this.joined && this.you !== null && this.host === this.you; }
  configure(room: string, cops: boolean): void {
    this.roamRoom = room;
    this.racePeers=[];
    if (room === this.room && cops === this.cops) return;
    this.send({ op: 'leave' }); this.reset(); this.room = room; this.cops = cops;
  }
  /** Original-game peers supply reciprocal LAN consent. The server checks
   * actual free-roam/Online membership independently of this room label. */
  race(peers: readonly number[], now=performance.now()): void {
    this.racePeers=[...new Set(peers)].filter(v=>Number.isInteger(v)&&v>0&&v<=0xffffffff&&v!==this.identity).slice(0,8);
    this.peersAt=now;
    this.roamRoom ??= this.room;
    const room = peers.length && this.identity !== null ? raceRoom(this.identity, peers) : this.roamRoom;
    if (room === this.room) return;
    this.send({ op: 'leave' }); this.reset(); this.room = room;
  }
  reset(): void {
    this.avatars.clear(); this.police = null; this.host = this.you = null; this.epoch = 0;
    this.joined = false; this.seq = 0; this.sentAt = this.joinAt = this.heardAt = this.policeAt = -Infinity; this.sentTick = null;
  }
  receive(m: ModEvent, now: number): void {
    if (m.op === 'joined' && m.room === this.room) { this.identity = this.you = m.you; this.joined = true; this.heardAt = now; }
    else if (m.op === 'ack' && this.joined && ((this.seq - m.seq) | 0) > 0) this.heardAt = now;
    else if (m.op === 'avatar' && this.joined && m.from !== this.you) {
      const old = this.avatars.get(m.from);
      if (old && ((m.seq - old.seq) | 0) <= 0) return;
      const secondary=m.secondary?{current:m.secondary,previous:old?.secondary?.current??m.secondary,at:now,before:old?.secondary?.at??now,seq:m.seq}:undefined;
      this.avatars.set(m.from, { current: m.avatar, previous: old?.current ?? m.avatar, at: now, before: old?.at ?? now, seq: m.seq, secondary });
    } else if (m.op === 'gone') this.avatars.delete(m.from);
    else if (m.op === 'authority' && this.joined && this.cops && m.epoch >= this.epoch) {
      this.epoch = m.epoch; this.host = m.host; this.police = m.police; this.policeAt = now; this.sentTick = null;
    } else if (m.op === 'police' && this.joined && this.cops && m.host === this.host && m.police.epoch === this.epoch) {
      if (this.police?.epoch === this.epoch && ((m.police.tick - this.police.tick) | 0) <= 0) return;
      this.police = m.police; this.policeAt = now;
    } else if (m.op === 'rejected') this.reset();
  }
  tick(now: number, avatar: Avatar | null, police: Police | null = null, secondary:Avatar|null=null): void {
    // A backgrounded tab may outlive its server membership without losing the
    // socket. Only acknowledgements of our own updates renew this membership.
    if (this.joined && now - this.heardAt >= 2000) { this.send({ op: 'leave' }); this.reset(); }
    for (const [who, p] of this.avatars) if (now - p.at > 2000) this.avatars.delete(who);
    // A stale pursuit freezes immediately and disappears after the lease. Its
    // host may continue only after a new authority event or a fresh snapshot.
    if (!this.authority && now - this.policeAt > 2000) this.police = null;
    if (!this.joined) {
      if (now - this.joinAt >= 1000 && this.send({ op: 'join', version: MOD_VERSION, room: this.room, cops: this.cops })) this.joinAt = now;
      return;
    }
    if (now - this.sentAt < 100) return;
    const fresh = this.authority && police?.epoch === this.epoch && police.tick !== this.sentTick ? police : null;
    const peers=now-this.peersAt<1000?this.racePeers.filter(v=>v!==this.you):[];
    if (!this.send({ op: 'update', seq: this.seq, avatar, police: fresh, peers, ...(secondary?{secondary}:{}) })) { this.reset(); return; }
    this.seq = (this.seq + 1) >>> 0; this.sentAt = now;
    if (fresh) this.sentTick = fresh.tick;
  }
  close(): void { this.send({ op: 'leave' }); this.racePeers=[]; this.reset(); }
}

export function raceRoom(you: number, peers: readonly number[]): string {
  const members = [...new Set([you, ...peers])].filter(x => Number.isInteger(x) && x > 0 && x <= 0xffffffff).sort((a,b) => a-b);
  // The game supports six racers; two 32-bit hashes also bound malformed input.
  let a = 2166136261, b = 5381;
  for (const v of members) for (let i = 0; i < 4; i++) { const byte = (v >>> (i*8)) & 255; a = Math.imul(a ^ byte, 16777619); b = Math.imul(b, 33) ^ byte; }
  return `race/${(a>>>0).toString(16)}/${(b>>>0).toString(16)}`;
}
