// One run of the game: the process (web/src/host/process.ts) plus the
// subsystems attached to it, and its end.  The wasm runtime is not
// re-enterable, so every Play starts a fresh process from the compiled
// module and every exit terminates all of its workers.

import { flatDriver } from '../vr/drivers';
import { Cockpit, type SaveCockpit } from '../vr/cockpit';
import type { MediaPanel } from '../vr/media-panel';
import {CockpitRadio} from '../vr/radio';
import {RadioLink} from './radio-link';
import type {Radio} from '../radio';
import { vrSettings } from '../vr/settings';
import { VRPanel } from '../vr/panel';
import { NavigationInput, ReplayInput } from '../vr/navigation';
import {CommunitySettings} from '../vr/community-settings';
import {ControllerKeyboard} from '../vr/keyboard';
import {SettingsMenu} from '../vr/settings-menu';
import type {WorldMenuDeps} from '../vr/world-menu';
import {StanceSettings,type StanceEdit,type StancePrefs} from '../vr/stance-settings';
import {StanceMenu} from '../vr/stance-menu';
import {ConnectionMenu} from '../vr/connection-menu';
import {RaceBrowser} from './race-browser';
import {RaceMenu} from '../vr/race-menu';
import type {ConnectionManager} from './connection-manager';
import { ModMultiplayer } from '../vr/multiplayer';
import { poseFromMatrix } from '../vr/session';
import type { Avatar } from '../vr/protocol';
import type { VRLaunch } from '../vr/launch';
import { startProcess, type GameProcess } from '../host/process';
import { N } from './i18n';
import { HostKind } from '../host/abi';
import {
  attachAudio, attachInput, attachNet, attachRenderer, OtherBuild,
  type AudioSubsystem, type InputSubsystem, type NetSubsystem, type RendererSubsystem, type Subsystem,
} from './subsystems';
import { StatusReader } from './status';
import { RaceReader } from './race-reader';
import { DATA_BASE, MANIFEST_URL } from '../host/datacache';
import type { GameInfo } from './loader';
import type { VRRenderPixels } from '../vr/resolution-info';
import type { PadPage } from '../input/gamepad';
import type { NetQueue, NetRaces, NetRemoved, NetRename } from '../net';

export interface SessionOptions {
  module: WebAssembly.Module;
  info: GameInfo;
  saveDir: string;
  env: Record<string, string>;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  audio: AudioContext | null;
  displayHz: number;
  vrLaunch?: VRLaunch;
  onVRResolution?(pixels: VRRenderPixels | null): void;
  media?: MediaPanel | null;
  music?:()=>Radio|null;
  saveCockpit?: SaveCockpit;
  worlds?:WorldMenuDeps;
  connections?:ConnectionManager;
  saveStance?:(edit:StanceEdit)=>Promise<StancePrefs>;
  /** the name other browsers see on the server's virtual LAN (LAN races, free roam); null: network = off */
  netName: string | null;
  /** free roam: a line for the player (a friend joined, left, went into a race) */
  notice?(text: string, who?: string): void;
  /** free roam: the race lobby's panel, its state as JSON from the game ("{}": none) */
  lobby?(json: string): void;
  /** free roam: quick chat, a phrase said (by a friend or the player), as JSON from the game */
  say?(json: string): void;
  /** free roam: front bumpers touching for 3 s, or parted, as JSON from the game (friends.ts) */
  bump?(json: string): void;
  /** free roam: a drift battle's scoreboard, as JSON from the game ("{}": none; drift.ts) */
  battle?(json: string): void;
  /** co-op free roam: player 2 online, as JSON from the game ({"name"}; "{}": its endpoint ended; shell.ts coopMsg) */
  coop?(json: string): void;
  /** free roam: a friend message from the server (friends.ts) */
  friend?(m: Record<string, unknown>): void;
  /** every frame drawn: quick chat's places over the cars in it (contract.ts RendererOptions.onMarks) */
  marks?(n: number, m: Float32Array, ids: Uint32Array): void;
  /** the server's LAN took the game back after the link was lost (a server restart, as for a deploy) */
  netBack?(): void;
  /** the server is full: the game's place in line for one (null: not in line) */
  netQueue?(q: NetQueue | null): void;
  /** this browser's own id on the server's LAN, and the one its other store held when that was another (page-id.ts) */
  netId?: string;
  netWas?: string[];
  /** the token of the keyphrase this page plays with (claim.ts: whose claimed names it may play under) */
  netClaim?: string;
  /** free roam: the names of the players this one blocks (settings.ini roam_block) */
  netBlock?: string[];
  /** the server's operator removed the player from playing with others (a kick or a ban) */
  netRemoved?(r: NetRemoved): void;
  /** the operator's race ban: the player plays on with others but races none of them (null: lifted) */
  netRaces?(r: NetRaces | null): void;
  /** the operator took the player's name away: the page asks for another */
  netRename?(r: NetRename): void;
  /** the game finished writing a file of the save overlay (path relative to /save) */
  onSaved?(path: string): void;
  /** the browser deleted the save folder during the game: the saves back into the new one (process.ts onSaveGone) */
  onSaveGone?(): Promise<void>;
  /** the game deleted a profile's file (process.ts onRemoved) */
  onRemoved?(path: string): void;
  /** a save the game wrote as the browser deleted the save folder was not kept (process.ts onLost) */
  onLost?(path: string): void;
  /** the browser would not open or make a file of the save folder (process.ts onSaveTrouble) */
  onSaveTrouble?(error: string): void;
  /** playing without saving: /save in the I/O worker's memory, with these files where the save folder has none
   *  (proto.ts BootConfig saves, memFiles) */
  memory?: { path: string; text: string; over?: boolean }[];
  /** tests: where frame dumps go, and their scale */
  artifacts?: string; dumpScale?: number;
  toggleFullscreen(): void;
  /** the page's own use of the controller: its menu (Home) and dialogs */
  padPage?: PadPage;
  log(line: string): void;
  /** a subsystem the game cannot do without (the renderer) failed to attach, or stopped working;
   *  what: English (the log; the page translates it); code: its fixed name, the same in every language */
  onFatal(what: string, code?: string): void;
  /** the renderer is of another build than the game module (gpu/index.ts OtherBuild): this page is not the one that
   *  goes with it (without this, onFatal as for any renderer that did not start); why: English, the log's */
  onOtherBuild?(why: string): void;
}

export class GameSession {
  readonly started = performance.now();
  gameLanguage='english';
  proc!: GameProcess;
  status: StatusReader | null = null;
  races: RaceReader | null = null;
  private connections:ConnectionManager|undefined;
  readonly raceBrowser=new RaceBrowser(()=>this.races,()=>this.connections?.prepareRace()??Promise.resolve(false),()=>this.connections?.message??'',()=>this.connections?.selectedName??'');
  private subs: Subsystem[] = [];
  renderer: RendererSubsystem | null = null;
  audio: AudioSubsystem | null = null;
  input: InputSubsystem | null = null;
  net: NetSubsystem | null = null;
  mod: ModMultiplayer | null = null;
  cockpit: Cockpit | null = null;
  community:CommunitySettings|null=null;
  stance:StanceSettings|null=null;
  exitCode: number | null = null;
  exited!: Promise<number>;
  private detached = false;
  private canvas!: HTMLCanvasElement;

  static async start(o: SessionOptions): Promise<GameSession> {
    const s = new GameSession();
    s.connections=o.connections;
    s.gameLanguage=(o.env.NFSU2_LANGUAGE??'english').toLowerCase();
    s.canvas = o.canvas;
    const tid = (t: number, fd: number) => fd === 2 ? `[${t}!]` : `[${t}]`;
    s.proc = await startProcess({
      module: o.module,
      initialPages: o.info.pages || undefined,
      cfg: { args: ['nfsu2', '/data/SPEED2.EXE'], env: o.env, dataBase: DATA_BASE, manifestUrl: MANIFEST_URL, saveDir: o.saveDir,
        ...o.memory ? { saves: 'memory' as const, memFiles: o.memory } : {} },
      onLog: (line, fd, t) => o.log(`${tid(t, fd)} ${line}`),
      onSaved: o.onSaved,
      onSaveGone: o.onSaveGone,
      onRemoved: o.onRemoved,
      onLost: o.onLost,
      onSaveTrouble: o.onSaveTrouble,
      onNote: o.log,
    });
    s.exited = s.proc.exited.then(code => { s.exitCode = code; s.detach(); return code; });
    if (o.vrLaunch) s.subs.push({ detach: () => o.vrLaunch!.cancel() });
    void s.proc.registered(HostKind.Status).then(r => { if (!s.detached) s.status = new StatusReader(s.proc.memory, r.ptr); });
    void s.proc.registered(HostKind.Races).then(r=>{
      if(s.detached)return;s.races=RaceReader.open(s.proc.memory,r.ptr,r.size);
      if(!s.races)return;
      const raceTimer=setInterval(()=>s.raceBrowser.update(),100);
      s.subs.push({detach:()=>{clearInterval(raceTimer);s.raceBrowser.close();}});
    });
    const common = { env: o.env, log: o.log };
    const vrOptions = vrSettings(o.env);
    const stance=s.stance=new StanceSettings(o.env,o.saveStance??(async()=>{throw new Error('stance settings unavailable');}),(models,on)=>{
      if(s.community)s.community.values.stance=on?'on':'off';s.renderer?.vr?.stanceSettings(models,on);
    });s.subs.push({detach:()=>stance.destroy()});
    const community=s.community=new CommunitySettings(o.env,(lights,gps,special,whine)=>s.renderer?.vr?.gameSettings(lights,gps,special,whine),on=>stance.enable(on),limit=>s.renderer?.vr?.carLimit(limit));
    let avatarAt = 0;
    let avatar: Avatar | null = vrOptions.share ? flatDriver() : null;
    s.mod = new ModMultiplayer(m => s.net?.mod?.(m) ?? false, o.env.NFSU2_ROAM_ROOM ?? '', false);
    let musicLink:RadioLink|null=null;
    void s.proc.registered(HostKind.Status).then(r=>{if(!s.detached)musicLink=RadioLink.open(s.proc.memory,r.ptr);});
    const music=new CockpitRadio(()=>musicLink,o.media??null,o.music);
    const cockpit = s.cockpit = new Cockpit(vrOptions,o.media??null,o.saveCockpit,peers=>s.mod?.race(peers),()=>s.audio?.shiftClick?.(),music);
    s.subs.push({detach:()=>cockpit.destroy()});

    // An attach may finish after the game ended (a crash at boot, Stop while the
    // renderer still waits for its registration): such a module is detached at once.
    const attach = async <T extends Subsystem>(name: string, f: () => T | Promise<T>): Promise<T | null> => {
      try {
        const x = await f();
        if (s.detached) { o.log(`[app] ${name} attached after the game ended: detached at once`); try { x.detach(); } catch { /* best effort */ } return null; }
        s.subs.push(x);
        return x;
      } catch (e) {
        o.log(`[app] ${name} could not attach: ${e}`);
        return null;
      }
    };
    // not awaited one by one: a subsystem waiting for its registration must not hold up the others
    let other = '';
    void attach('renderer', async () => {
      try {
        return await attachRenderer(s.proc, o.canvas, {
          ...common, width: o.canvas.width, height: o.canvas.height, displayHz: o.displayHz, artifacts: o.artifacts, dumpScale: o.dumpScale,
          // a frozen picture otherwise: the game stops and the page says why.  Some Android phones' graphics drivers
          // (Adreno 6xx, 2026-10/11) refuse the canvas's own picture at the first frame: Chrome asks the driver whether
          // it may import it, the driver says the format is not supported, and Dawn takes that answer for an error
          // ("vkGetPhysicalDeviceImageFormatProperties2 failed with VK_ERROR_FORMAT_NOT_SUPPORTED - While checking
          // external image import support with TextureFormat::RGBA8Unorm ...").  Every Play ends the same way there,
          // so the page says so instead of "press Play again".
          onLost: why => {
            if (s.detached) return;
            if (/external image import support/i.test(why) && /Android/.test(navigator.userAgent)) o.onFatal(N('the graphics stopped working'), 'GPU-ANDROID-DRIVER');
            else o.onFatal(N('the graphics stopped working'), 'GPU-LOST');
          },
          onMarks: o.marks, avatars: () => s.mod!.avatars, cockpit,
        });
      } catch (e) { if (e instanceof OtherBuild) other = e.message; throw e; }
    }).then(r => {
      s.renderer = r;community.send();stance.send();
      if (r?.vr) {
        r.vr.onResolution = pixels => o.onVRResolution?.(pixels);
        r.vr.onVisibility = visible => s.input?.immersiveFocus?.(visible);
        s.input?.immersiveFocus?.(r.vr.visibility);
        cockpit.rearCapture=request=>{r.vr!.mirrorCapture=request;};
        const panel = new VRPanel(o.stage, r.vr, o.log); s.subs.push(panel);
        if (o.vrLaunch) void o.vrLaunch.connect(r.vr).catch(error => panel.failure(error));
        const navigation=new NavigationInput(),replay=new ReplayInput();let driving=false,replayOwner=0;
        const menu=new SettingsMenu(vrOptions,o.saveCockpit??(()=>{}),()=>r.vr!.recenter(),community,o.worlds,new StanceMenu(stance,()=>cockpit.scene),o.connections?new ConnectionMenu(o.connections):undefined,new RaceMenu(s.raceBrowser,s.gameLanguage));s.subs.push({detach:()=>menu.destroy()});
        const keyboard=new ControllerKeyboard(chars=>s.input?.text?.(chars));s.subs.push({detach:()=>keyboard.destroy()});
        r.vr.onTracking = frame => {
          const status=s.status?.read();if(status)driving=!!((status.get('drive')??0)&3);
          const epoch=r.vr!.replayEpoch;
          if(epoch!==replayOwner){navigation.reset();replayOwner=epoch;}
          if(epoch)driving=false;
          const entry=!epoch&&!status?.get('loading')?s.input?.textEntry?.()??null:null;
          const nav=navigation.sample(frame,driving&&!entry,!!cockpit.scene?.cockpit);
          const replayInput=replay.sample(status?.get('loading')?null:frame,epoch);r.vr!.replayAction(epoch,replayInput.camera,replayInput.timeline);
          const available=!!frame&&!epoch&&!driving&&!!status&&!status.get('loading')&&(status.get('pause')===1||!cockpit.scene?.local);
          if(!frame&&!r.vr!.active)menu.close();
          const typing=keyboard.sample(frame?.time??null,entry,nav.pad);
          const settings=menu.sample(frame?.time??null,available&&!entry,nav.pad,cockpit.scene?.local?.model??'DEFAULT');
          r.vr!.overlay=frame?(keyboard.overlay(vrOptions.height,vrOptions.forward)??menu.overlay()):null;
          cockpit.track(driving&&!entry?frame:null,nav.shift);
          r.vr!.gearCommand=cockpit.gearCommand;
          s.input?.vrFeedback?.(cockpit.feedback);
          let pad=epoch?replayInput.pad:driving&&!entry?cockpit.controls:nav.pad;
          if(frame&&(nav.pause||nav.view)){pad??={steer:0,throttle:0,brake:0,buttons:0};pad={...pad,buttons:pad.buttons|nav.pause|nav.view};}
          if((typing||settings)&&pad)pad={steer:0,throttle:0,brake:0,buttons:0};
          s.input?.spatialPad?.(pad);
          avatarAt = performance.now();
          // Sender identity comes from the socket; the renderer joins it to a visible roam slot.
          avatar = !vrOptions.share ? null : frame ? { car: 0, cockpit: 0, vr: true, head: poseFromMatrix(frame.head), left: cockpit.handPose(0), right: cockpit.handPose(1), wheel: cockpit.wheelVisual ?? undefined, fingers: cockpit.fingers } : r.vr!.active ? null : flatDriver();
        };
      }
      // without a picture there is no game to play: say so instead of a black screen
      if (r || s.detached) return;
      if (other && o.onOtherBuild) o.onOtherBuild(other);
      else o.onFatal(N('the graphics could not start'), 'GPU-RENDERER');
    });
    void attach('audio', () => attachAudio(s.proc, { ...common, context: o.audio, masterGainDB:()=>vrOptions.masterGainDB })).then(a => {
      s.audio = a;
      // the audio subsystem closes the context made in the Play click; without one, close it here
      if (!a) void o.audio?.close().catch(() => {});
    });
    void attach('input', () => attachInput(s.proc, o.canvas, {
      ...common, stage: o.stage, toggleFullscreen: o.toggleFullscreen, padPage: o.padPage, viewRect: () => s.viewRect(),
    })).then(i => { s.input = i; i?.immersiveFocus?.(s.renderer?.vr?.visibility ?? null); });
    if (o.netName !== null)
      void attach('network', () => attachNet(s.proc, {
        ...common, mod: m => s.mod?.receive(m, performance.now()), name: o.netName!, id: o.netId, was: o.netWas, claim: o.netClaim, block: o.netBlock, notice: o.notice, lobby: o.lobby, say: o.say, bump: o.bump, battle: o.battle, coop: o.coop, friend: o.friend, back: () => { s.mod?.reset(); o.netBack?.(); }, queue: o.netQueue, removed: o.netRemoved, races: o.netRaces, rename: o.netRename,
      })).then(n => {
        s.net = n;
        if (n?.mod && !s.detached) {
          const modTimer = setInterval(() => {
            const scene=cockpit.scene;
            let published=vrOptions.share?(avatar??(!s.renderer?.vr?.active?flatDriver():null)):null;
            if(published)published={...published,car:scene?.local?.peer??0,cockpit:cockpit.appearance(),shifter:[cockpit.shifter.x,cockpit.shifter.z],pedals:cockpit.pedalTravel};
            const secondary=vrOptions.share&&scene?.secondary?.peer?{...flatDriver(),car:scene.secondary.peer,cockpit:cockpit.appearance()}:null;
            s.mod?.tick(performance.now(), published?.vr && performance.now() - avatarAt > 300 ? null : published,null,secondary);
          }, 50);
          s.subs.push({ detach: () => { clearInterval(modTimer); s.mod?.close(); } });
          const room = n.room?.bind(n);
          if (room) n.room = name => { s.mod?.configure(name, s.mod.cops); return room(name); };
        }
      });
    return s;
  }

  /** the renderer's aspect-fit image, in CSS px of the canvas (the whole canvas until the renderer is there) */
  viewRect(): { x: number; y: number; w: number; h: number } {
    const c = this.canvas, r = this.renderer?.imageRect();
    if (!r || !c.width || !c.height) return { x: 0, y: 0, w: c.clientWidth, h: c.clientHeight };
    const kx = c.clientWidth / c.width, ky = c.clientHeight / c.height;
    return { x: r.x * kx, y: r.y * ky, w: r.w * kx, h: r.h * ky };
  }

  /** counters the subsystems offer for the detailed overlay */
  stats(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const x of this.subs) Object.assign(out, x.stats?.() ?? {});
    return out;
  }

  /** the game's own quit path, if the input subsystem offers it and it can reach the game */
  canQuit(): boolean { const i = this.input; return !!i?.requestQuit && !this.detached && (i.canQuit?.() ?? true); }
  /** false: the request cannot reach the game (the page can only stop it) */
  requestQuit(): boolean { return this.canQuit() && this.input!.requestQuit!() !== false; }
  /** Download log: asks the game for its stall report (InputSubsystem.logReport); false: it cannot be asked */
  logReport(): boolean { const i = this.input; return !this.detached && !!i?.logReport && i.logReport() !== false; }

  /** true once the game exited or was stopped (every subsystem detached) */
  get ended() { return this.detached; }

  private detach() {
    if (this.detached) return;
    this.detached = true;
    for (const x of this.subs) { try { x.detach(); } catch { /* best effort */ } }
    this.subs = [];
    this.status = null;
    this.races = null;
  }

  /** Stop at once (every worker), e.g. "Stop the game" or after the exit. */
  terminate() { this.detach(); this.proc.terminate(); }
}
