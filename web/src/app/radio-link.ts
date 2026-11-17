// The one place that knows the layout of the radio's words after the status table (HostStatusRadio in
// runtime/web/radio_proto.h, same order): the page writes the switch, the tags and the sound, the runtime (runtime/radio.c)
// reads them.  RadioLink.open() gives a link only to a game whose block has the radio's magic and version.
import type { GameMemory } from '../host/memory';
const WORDS = ['radio_magic', 'radio_version', 'on', 'tag_seq', 'places', 'req_seq', 'req_index', 'ready_seq', 'failed_seq', 'total', 'written', 'ring', 'ring_frames', 'read', 'skip',
  'listen', 'song_seq', 'song_kind', 'song_ms', 'song_end'] as const;
type Word = typeof WORDS[number];
export const RADIO_WORDS: readonly string[] = WORDS;
/** What the runtime writes into the first two words at its start (RADIO_MAGIC, RADIO_VERSION in radio_proto.h). */
export const RADIO_MAGIC = 0x31444152, RADIO_VERSION = 5;
const W = Object.fromEntries(WORDS.map((n, i) => [n, i])) as Record<Word, number>;
const CTL = 16 + 48 * 24,   // the status table before them (status.ts: HEAD + MAX * ITEM)
  PLACES = 2, TAG = 44, TEXT = WORDS.length * 4;
const COCKPIT = TEXT + (PLACES + 1) * 3 * TAG, PCM = 512, COMMANDS = 8;

export interface Lines { artist: string; title: string; album: string }
/** The song playing as the runtime tells it (radio_proto.h song_*): seq counts the songs the game started; kind: 'game' an EA Trax
 *  song, 'folder' the Radio's track, 'none' no song; ms: how long it has been heard; ended: it played to its end. */
export interface Song { seq: number; kind: 'none' | 'game' | 'folder'; ms: number; ended: boolean; lines: Lines }
const KINDS = ['none', 'game', 'folder'] as const;
/** 0 menus, 1 driving */
export type Place = 0 | 1;

const ascii = (s: string, to: Uint8Array) => {
  to.fill(0);
  [...s].slice(0, TAG - 1).forEach((ch, i) => { const c = ch.codePointAt(0)!; to[i] = c >= 0x20 && c < 0x7f ? c : 63; });
};

export class RadioLink {
  constructor(private memory: GameMemory, private ptr: number) {}

  /** The link to the radio's words at the status block, or null: the block is too short, or it is another build's (an older game in the cache). */
  static open(memory: GameMemory, ptr: number): RadioLink | null {
    const end = ptr + CTL + TEXT + (PLACES + 1) * 3 * TAG;
    if (!Number.isInteger(ptr) || ptr < 0 || end > memory.buffer.byteLength || (ptr + CTL) % 4) return null;
    const w = new Int32Array(memory.buffer, ptr + CTL, 2);
    const version=Atomics.load(w,W.radio_version);
    return Atomics.load(w, W.radio_magic) === RADIO_MAGIC && (version === 3 || (version===4||version===5)&&end+64+PCM*4+(version===5?20:0)<=memory.buffer.byteLength) ? new RadioLink(memory, ptr) : null;
  }
  private words() { return new Int32Array(this.memory.buffer, this.ptr + CTL, WORDS.length); }

  /** False once the runtime switched the radio off (memory that does not look right). */
  isOn(): boolean { return (Atomics.load(this.words(), W.on) & 1) === 1; }

  /** The runtime adds one to the word too: the page swaps only the value it read, and a lost swap is read again by isOn(). */
  setOn(on: boolean) {
    const w = this.words(), now = Atomics.load(w, W.on);
    if (((now & 1) === 1) !== on) Atomics.compareExchange(w, W.on, now, now + 1);
  }

  /** The next track of each place (0 menus, 1 driving) with its tags, null: no track suits the place. */
  setPlaces(next: readonly [Lines | null, Lines | null]) {
    const w = this.words(), bytes = new Uint8Array(this.memory.buffer, this.ptr + CTL + TEXT, PLACES * 3 * TAG), s0 = Atomics.load(w, W.tag_seq) & ~1;
    Atomics.store(w, W.tag_seq, s0 + 1);
    next.forEach((t, p) => [t?.artist, t?.title, t?.album].forEach((line, k) => ascii(line ?? '', bytes.subarray((p * 3 + k) * TAG, (p * 3 + k + 1) * TAG))));
    Atomics.store(w, W.places, next.reduce((mask, t, p) => mask | (t ? 1 << p : 0), 0));
    Atomics.store(w, W.tag_seq, s0 + 2);
  }

  /** The game's latest track start: its number and its place. */
  request(): { seq: number; place: Place } {
    const w = this.words();
    return { seq: Atomics.load(w, W.req_seq) >>> 0, place: (Atomics.load(w, W.req_index) & 1) as Place };
  }

  /** The track the game asked for is decoded: total frames, none written yet.  Nothing is published while the runtime has no rings. */
  serve(seq: number, total: number): boolean {
    const w = this.words();
    if (!Atomics.load(w, W.ring_frames) || !Atomics.load(w, W.ring)) return false;
    Atomics.store(w, W.written, 0); Atomics.store(w, W.total, total); Atomics.store(w, W.ready_seq, seq);
    return true;
  }
  fail(seq: number) { Atomics.store(this.words(), W.failed_seq, seq); }

  /** Ends the track where the game has read it: the runtime sees the end of the stream and the game goes on to its next song. */
  cut() { const w = this.words(), at = Atomics.load(w, W.read); Atomics.store(w, W.written, at); Atomics.store(w, W.total, at); }

  /** The next-song key (F7): the runtime stops the song playing, so the game starts its next one (EA Trax's, or with the
   *  radio on the folder's next track).  Each press counts once; with no song playing (a drift or drag race, the pause
   *  menu) the runtime lets it go. */
  skip() { Atomics.add(this.words(), W.skip, 1); }

  /** The page wants the song playing told (song()), radio on or off: Last.fm's scrobbles (lastfm.ts). */
  listen(on: boolean, consumer:'scrobble'|'cockpit'='scrobble') {
    const bit=consumer==='cockpit'?2:1;
    if(on)Atomics.or(this.words(),W.listen,bit);else Atomics.and(this.words(),W.listen,~bit);
  }

  private controls():Int32Array|null {
    const version=Atomics.load(this.words(),W.radio_version);
    if((version!==4&&version!==5)||this.ptr+CTL+COCKPIT+64+PCM*4>this.memory.buffer.byteLength)return null;
    return new Int32Array(this.memory.buffer,this.ptr+CTL+COCKPIT,16);
  }
  cockpit(active:boolean,volume:number):void {
    this.listen(active,'cockpit');
    const w=this.controls();if(!w)return;
    if(Number.isFinite(volume))Atomics.store(w,1,Math.round(Math.min(1,Math.max(0,volume))*65536));
    Atomics.store(w,0,active?1:0);
  }
  command(action:'previous'|'toggle'|'next'):boolean {
    const w=this.controls();if(!w||!Atomics.load(w,0))return false;
    const write=Atomics.load(w,2)>>>0,read=Atomics.load(w,3)>>>0;
    if((write-read>>>0)>=COMMANDS)return false;
    Atomics.store(w,4+(write&(COMMANDS-1)),action==='previous'?1:action==='toggle'?2:3);
    Atomics.store(w,2,write+1);return true;
  }
  transport():{live:boolean;paused:boolean}|null {
    const w=this.controls();if(!w)return null;
    const state=Atomics.load(w,12);return {live:!!(state&1),paused:!!(state&2)};
  }
  private seekWords():Int32Array|null {
    return Atomics.load(this.words(),W.radio_version)===5?new Int32Array(this.memory.buffer,this.ptr+CTL+COCKPIT+64+PCM*4,5):null;
  }
  get seekable():boolean{return this.seekWords()!==null;}
  get position():number{return Atomics.load(this.words(),W.read)>>>0;}
  requestSeek(track:number,frame:number):number {
    const s=this.seekWords();if(!s||this.request().seq!==track)return 0;
    const seq=((Atomics.load(s,0)+1)>>>0)||1;
    Atomics.store(s,1,track);Atomics.store(s,2,frame);Atomics.store(s,0,seq);return seq;
  }
  seekAcknowledged(seq:number):boolean {const s=this.seekWords();return !!s&&(Atomics.load(s,3)>>>0)===seq;}
  beginSeek(frame:number):void {Atomics.store(this.words(),W.written,frame);}
  finishSeek(seq:number):void {const s=this.seekWords();if(s)Atomics.store(s,4,seq);}
  musicSamples(after=-1):{seq:number;rate:number;samples:Float32Array}|null {
    const w=this.controls();if(!w)return null;
    const seq=Atomics.load(w,13)>>>0,n=Atomics.load(w,15),rate=Atomics.load(w,14);
    if(!seq||seq===after||(seq&1)||n<1||n>PCM||rate<11025||rate>48000)return null;
    const samples=new Float32Array(this.memory.buffer,this.ptr+CTL+COCKPIT+64,n).slice();
    return (Atomics.load(w,13)>>>0)===seq&&samples.every(Number.isFinite)?{seq,rate,samples}:null;
  }

  /** The song playing, null while the runtime writes it (asked again a moment later) or before it told one. */
  song(): Song | null {
    const w = this.words(), seq = Atomics.load(w, W.song_seq) >>> 0;
    if (!seq || seq & 1) return null;
    const bytes = new Uint8Array(this.memory.buffer, this.ptr + CTL + TEXT + PLACES * 3 * TAG, 3 * TAG);
    const line = (k: number) => { const b = bytes.slice(k * TAG, (k + 1) * TAG), nul = b.indexOf(0); return new TextDecoder('latin1').decode(nul < 0 ? b : b.subarray(0, nul)).trim(); };
    const kind = KINDS[Atomics.load(w, W.song_kind)] ?? 'none', lines = { artist: line(0), title: line(1), album: line(2) };
    const ms = Atomics.load(w, W.song_ms) >>> 0, ended = (Atomics.load(w, W.song_end) >>> 0) === seq;
    return (Atomics.load(w, W.song_seq) >>> 0) === seq ? { seq, kind, ms, ended, lines } : null;
  }

  /** Frames the rings take now (the counters wrap at 32 bits, their difference does not). */
  room(): number {
    const w = this.words(), size = Atomics.load(w, W.ring_frames);
    return Math.max(0, Math.min(size, size - ((Atomics.load(w, W.written) - Atomics.load(w, W.read)) | 0)));
  }

  /** Appends frames to the rings (left, right) and tells the game they are there.  False: the rings are not where the page can trust them. */
  push(left: Float32Array, right: Float32Array): boolean {
    const w = this.words(), size = Atomics.load(w, W.ring_frames), at = Atomics.load(w, W.written), base = Atomics.load(w, W.ring) >>> 0;
    const buf = this.memory.buffer;
    if (!size || (size & (size - 1)) || !base || base + 8 * size > buf.byteLength) return false;
    [left, right].forEach((src, ch) => {
      const ring = new Float32Array(buf, base + 4 * size * ch, size), from = at & (size - 1), first = Math.min(src.length, size - from);
      ring.set(src.subarray(0, first), from);
      ring.set(src.subarray(first), 0);
    });
    Atomics.store(w, W.written, at + left.length);
    return true;
  }
}
