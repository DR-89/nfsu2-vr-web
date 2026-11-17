import { AUDIO, VIDEO, canPickMusic, forgetFolder, keptFolder, keepFolder, pickMusic, reopenFolder, sortedTracks, type Folder, type Picked } from '../radio-folder';
import { radioWasOn, type Radio } from '../radio';
import { ShuffleOrder } from '../radio-order';
import { onLanguage, t } from '../app/i18n';
import type { VRSettings } from './settings';
import { masterGain } from '../audio/master-gain';
import { MEDIA_FOLDER } from '../app/prefs';

/** Handles and media bytes stay on this device. Only the separate volume and
 * opacity preferences are in settings.ini, which the existing vault syncs. */
export class MediaPanel {
  private picked: Picked | null = null;
  private order = new ShuffleOrder();
  private get indices(): number[] { return this.picked?.files.map((_, i) => i) ?? []; }
  private get shuffled(): boolean { return this.deps.radio().shuffle; }
  private hasVideo=false;
  readonly player = document.createElement('video');
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain:GainNode|null=null;
  private trim=1;
  private gameSource:number|null=null;
  private inWorld=false;
  private manualPause=false;
  private pending=false;
  private failed=false;
  private playBlocked=false;
  private ownPauses=0;
  private pauseForSource():void {if(!this.player.paused){this.ownPauses++;this.player.pause();}}
  private get sourceAllows():boolean{return this.gameSource===null||this.gameSource!==2&&this.inWorld;}
  private samples = new Uint8Array(128);
  get title(): string { return this.picked?.paths[Number(this.select.value)] ?? ''; }
  get active():boolean {return this.url!==null&&this.sourceAllows&&!this.failed;}
  get timeline() {
    const duration=Number.isFinite(this.player.duration)?Math.max(0,this.player.duration):0;
    return {id:`media:${this.epoch}`,current:Number.isFinite(this.player.currentTime)?this.player.currentTime:0,duration,seekable:this.active&&duration>0};
  }
  seek(seconds:number,id:string):boolean {
    const track=this.timeline;
    if(!track.seekable||track.id!==id||!Number.isFinite(seconds))return false;
    try{this.player.currentTime=Math.max(0,Math.min(track.duration,seconds));return true;}catch{return false;}
  }
  get available():boolean {return !!this.picked?.files.length;}
  get usable():boolean{return this.available&&!this.failed;}
  get video():HTMLVideoElement|null {
    return this.sourceAllows&&VIDEO.test(this.picked?.files[Number(this.select.value)]?.name??'')?this.player:null;
  }
  get videoStatus():string {return this.failed||this.playBlocked?t('This file could not be played.'):t('Loading');}
  /** Call in the Play/Play in VR click, before XR consumes user activation.
   * Controller poses arrive later in animation callbacks, outside that click. */
  preparePlayback():void {
    if(!this.available)return;
    if(!this.context){
      this.context=new AudioContext();this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;
      this.gain=this.context.createGain();this.gain.gain.value=this.trim;
      this.context.createMediaElementSource(this.player).connect(this.analyser).connect(this.gain).connect(this.context.destination);
    }
    // resume() can stay pending under autoplay restrictions. Video decoding
    // must not wait on it; play() reports its own failure and can be retried.
    if(this.context.state==='suspended')void this.context.resume().catch(e=>this.deps.log(`[media] audio: ${e}`));
  }
  /** Keep the same media position while EA TRAX owns a menu or the chosen
   * source. A paused track stays paused when the player returns to driving. */
  setGameSource(source:number,inWorld:boolean):void {
    this.gameSource=source;this.inWorld=inWorld;
    if(!this.sourceAllows){this.pauseForSource();this.deps.radio().setExternalPlayback(false);return;}
    if(!this.usable||this.pending||!this.hasVideo&&(this.music.checked||radioWasOn()))return;
    if(!this.url){void this.play(Number(this.select.value)||0);return;}
    this.deps.radio().setExternalPlayback(true);
    if(this.player.paused&&!this.manualPause)void this.resume();
  }
  endGame():void {this.gameSource=null;this.manualPause=true;this.player.pause();this.deps.radio().setExternalPlayback(false);}
  setVolume(level:number):void {this.player.volume=Math.max(0,Math.min(1,level));}
  setMasterGain(db:number):void {
    const next=masterGain(db);if(next===this.trim)return;this.trim=next;
    if(this.gain&&this.context)this.gain.gain.setTargetAtTime(next,this.context.currentTime,0.015);
  }
  spectrum(): Uint8Array { this.analyser?.getByteFrequencyData(this.samples); return this.samples; }
  level(): number { const s = this.spectrum(); return this.player.paused ? 0 : s.reduce((a,b) => a+b, 0)/(255*s.length); }
  async toggle(): Promise<void> {
    if(!this.sourceAllows)return;
    if (!this.url||this.failed) { await this.play(Number(this.select.value) || 0); return; }
    if (this.player.paused) {this.manualPause=false;await this.resume();} else {this.manualPause=true;this.player.pause();}
  }
  private async resume():Promise<void> {
    if(this.pending||!this.sourceAllows)return;
    this.pending=true;this.playBlocked=false;const epoch=this.epoch;
    try{this.preparePlayback();await this.player.play();}
    catch(e){this.playFailed(e,epoch);}
    finally{if(epoch===this.epoch)this.pending=false;}
  }
  private playFailed(error:unknown,epoch:number):void {
    if(epoch!==this.epoch)return;
    // Menus pause the video while a play promise may still be settling.
    // That cancellation must not poison the file on return to the cockpit.
    if(error instanceof DOMException&&error.name==='AbortError')return;
    this.manualPause=true;
    this.playBlocked=error instanceof DOMException&&error.name==='NotAllowedError';
    this.failed=!this.playBlocked;
    this.deps.radio().setExternalPlayback(false);
    this.deps.log(`[media] play: ${error}`);this.info.textContent=t('This file could not be played.');
  }
  private select = document.createElement('select');
  private info = document.createElement('p');
  private choose = document.createElement('button');
  private reconnect = document.createElement('button');
  private music = document.createElement('input');
  private musicLabel = document.createElement('span');
  private heading = document.createElement('h3');
  private privacy = document.createElement('p');
  private prev = document.createElement('button');
  private next = document.createElement('button');
  private url: string | null = null;
  private epoch = 0;
  private restoring = true;
  private accessNeeded = false;
  private remembered: Folder | null = null;
  private folderBusy = false;
  private folderError = false;
  private storageFailed = false;
  constructor(root: HTMLElement, private deps: { radio: () => Radio; settings: () => VRSettings; log: (s: string) => void }) {
    root.classList.add('vr-media');
    this.player.controls = true; this.player.playsInline = true; this.player.preload = 'metadata';
    this.info.className = this.privacy.className = 'hint'; this.info.setAttribute('role', 'status');
    this.choose.type = this.reconnect.type = this.prev.type = this.next.type = 'button';
    this.choose.className = this.reconnect.className = 'btn'; this.prev.className = this.next.className = 'text-btn';
    this.music.type = 'checkbox'; this.music.checked = radioWasOn();
    const label = document.createElement('label'); label.className = 'vr-music-choice'; label.append(this.music, this.musicLabel);
    const row = document.createElement('div'); row.className = 'row'; row.append(this.choose, this.reconnect, label);
    const controls = document.createElement('div'); controls.className = 'row'; controls.append(this.prev, this.select, this.next);
    root.append(this.heading, this.privacy, row, this.info, controls, this.player);
    this.choose.onclick = () => { void this.pick(); };
    this.reconnect.onclick = () => { void this.allowAccess(); };
    this.select.onchange = () => { void this.play(Number(this.select.value)); };
    this.prev.onclick = () => { void this.step(-1); }; this.next.onclick = () => { void this.step(1); };
    this.player.onended = () => { if(this.player.ended&&!this.pending)void this.step(1); };
    this.player.onplay = () => {
      if(!this.sourceAllows){this.pauseForSource();return;}
      this.manualPause=false;
      const r = this.deps.radio();
      if (!r.externalPlayback) { r.turnOff(); r.setExternalPlayback(true); }
      this.music.checked = false;
      void this.context?.resume().catch(() => {});
    };
    this.player.onpause=()=>{if(this.ownPauses){this.ownPauses--;return;}if(this.url&&this.sourceAllows&&!this.player.ended)this.manualPause=true;};
    this.player.onerror = () => { this.failed=true;this.deps.radio().setExternalPlayback(false); this.info.textContent = t('This file could not be played.'); };
    this.music.onchange = () => { this.applyMusic(); };
    this.render(); onLanguage(() => this.render()); void this.restore();
    window.addEventListener('pagehide', () => this.stop());
  }
  refresh(): void { const s = this.deps.settings(); this.player.volume = s.volume; this.setMasterGain(s.masterGainDB);this.player.style.opacity = String(s.opacity); }
  private render(): void {
    this.heading.textContent = t('Music & videos'); this.privacy.textContent = t('Files stay on this device.');
    if (this.remembered && !this.storageFailed) this.privacy.textContent += ' ' + t('The folder is remembered in this browser.');
    else if (this.picked) this.privacy.textContent += ' ' + t('This browser cannot remember the folder. Choose it again next visit.');
    this.choose.textContent = t('Choose media folder'); this.musicLabel.textContent = t('Use as game music');
    this.choose.disabled = this.folderBusy || !canPickMusic();
    this.reconnect.textContent = t('Allow folder access');
    this.reconnect.hidden = !this.accessNeeded || !this.remembered;
    this.reconnect.disabled = this.folderBusy;
    this.select.setAttribute('aria-label', t('Select a file')); this.prev.textContent = t('Previous track'); this.next.textContent = t('Next track');
    this.player.setAttribute('aria-label', t('Music & videos'));
    const p = this.picked;
    this.info.textContent = this.folderError ? t('Folder access needed. Choose it again.') : this.accessNeeded
      ? `${this.remembered?.name ?? ''}: ${t('Folder access needed. Allow access to use the saved folder.')}`
      : p ? p.files.length ? p.name : t('No supported music or videos found.') : t('No media folder selected.');
    this.select.disabled = this.prev.disabled = this.next.disabled = !p?.files.length;
    this.music.disabled = this.hasVideo||!p?.files.some(f => AUDIO.test(f.name));
    this.player.hidden = !this.url;
    this.refresh();
  }
  private async restore(): Promise<void> {
    try {
      const h = await keptFolder(MEDIA_FOLDER);
      if (!h || !this.restoring) return;
      this.remembered = h;
      const found = await reopenFolder(h, false, true);
      if (!this.restoring) return;
      if (found) this.setFolder({ ...found, handle: h, name: h.name }); else { this.accessNeeded = true; this.render(); }
    } catch (e) {
      if (!this.restoring) return;
      this.accessNeeded = !!this.remembered; this.folderError = true; this.render();
      this.deps.log(`[media] restore: ${e}`);
    }
  }
  private async pick(): Promise<void> {
    // Invoke the picker in the click task, before any storage work.
    if (this.folderBusy) return;
    this.restoring = false; this.folderBusy = true; this.folderError = false; this.render();
    try {
      const p = await pickMusic(true); if (!p) return;
      if (p.handle) this.storageFailed = await keepFolder(p.handle, MEDIA_FOLDER) === undefined;
      else { await forgetFolder(MEDIA_FOLDER); this.storageFailed = true; }
      this.setFolder(p);
    } catch (e) { this.deps.log(`[media] folder: ${e}`); this.folderError = true; }
    finally { this.folderBusy = false; this.render(); }
  }
  private async allowAccess(): Promise<void> {
    const h = this.remembered;
    if (!h || this.folderBusy) return;
    this.restoring = false; this.folderBusy = true; this.folderError = false; this.render();
    try {
      // requestPermission runs in this click, with no IndexedDB read before it.
      // A denial leaves the handle intact and never opens a second picker.
      const found = await reopenFolder(h, true, true);
      if (found) this.setFolder({ ...found, handle: h, name: h.name });
    } catch (e) { this.deps.log(`[media] access: ${e}`); this.folderError = true; }
    finally { this.folderBusy = false; this.render(); }
  }
  private setFolder(p: Picked): void {
    this.stop(); this.accessNeeded = this.folderError = false; this.remembered = p.handle ?? null;
    this.picked = { ...p, ...sortedTracks(p.files, p.paths) };
    this.order = new ShuffleOrder();
    this.hasVideo=this.picked.files.some(f=>VIDEO.test(f.name));
    this.select.replaceChildren(...this.picked.paths.map((path, i) => new Option(path, String(i))));
    if(this.shuffled)this.select.value=String(this.order.peek(this.indices));
    this.applyMusic(); this.render();
  }
  private applyMusic(): void {
    // The game's PCM radio decodes audio only. A playlist containing videos
    // stays on the browser player, including its audio tracks and Next button.
    if(this.hasVideo)this.music.checked=false;
    if (!this.music.checked) { this.deps.radio().turnOff(); return; }
    const p = this.picked; if (!p) return;
    const indices = p.files.flatMap((f, i) => AUDIO.test(f.name) ? [i] : []);
    if (!indices.length) {this.music.checked=false;this.deps.radio().turnOff();return;}
    this.stop(); const r = this.deps.radio();
    r.setFolder({ ...p, files: indices.map(i => p.files[i]), paths: indices.map(i => p.paths[i]) });
    r.enableForNextGame();
  }
  stop(): void {
    this.deps.radio().setExternalPlayback(false);
    this.epoch++;this.pending=this.manualPause=this.failed=this.playBlocked=false;
    if (this.url) URL.revokeObjectURL(this.url); this.url = null;
    this.pauseForSource(); this.player.removeAttribute('src'); this.player.load();this.player.hidden = true;
  }
  async step(delta: number): Promise<void> {
    const n = this.picked?.files.length ?? 0;
    if (!n) return;
    const index=this.shuffled?(delta<0?this.order.previous(this.indices):this.order.peek(this.indices)):(Number(this.select.value)+delta+n)%n;
    await this.play(index,delta<0);
  }
  private async play(index: number, backwards=false): Promise<void> {
    const file = this.picked?.files[index]; if (!file) return;
    this.order.played(index,backwards);
    this.stop(); const epoch = this.epoch;this.pending=true;this.select.value=String(index);
    try {
      this.preparePlayback();
      // Reserve playback before the asynchronous read so custom-only mode
      // cannot start the PCM folder while this track is still loading.
      this.deps.radio().turnOff();this.music.checked=false;
      this.deps.radio().setExternalPlayback(this.sourceAllows);
      const bytes = await file.getFile(); if (epoch !== this.epoch) return;
      // The preview and the game's radio must not play two songs at once.
      this.deps.radio().turnOff(); this.music.checked = false;
      this.deps.radio().setExternalPlayback(this.sourceAllows);
      this.url = URL.createObjectURL(bytes); this.player.src = this.url; this.player.hidden = false;
      this.refresh();
      if(this.sourceAllows)await this.player.play();
    } catch (e) {this.playFailed(e,epoch);}
    finally{if(epoch===this.epoch)this.pending=false;}
  }
}
