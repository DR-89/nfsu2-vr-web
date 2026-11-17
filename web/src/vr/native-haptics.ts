import {localStore,sessionStore,VR_HAPTICS_AUTO,VR_HAPTICS_BRIDGE} from '../app/prefs';

export const HAPTICS_DISCOVERY_URL='http://127.0.0.1:28765';

export function hapticsTarget(value:string|null):{url:string;token:string}|null {
  const match=value?.match(/^(\d{1,5})\.([a-f0-9]{32})$/);
  if(!match||+match[1]<1024||+match[1]>65535)return null;
  return {url:`http://127.0.0.1:${+match[1]}`,token:match[2]};
}
// One-time setup enables discovery in the ordinary browser profile. Explicit
// per-run capabilities remain supported for portable launches and diagnostics.
function target(){
  const value=typeof location==='undefined'?null:new URLSearchParams(location.hash.slice(1)).get('vr-haptics');
  if(value==='auto'||hapticsTarget(value)){
    if(value==='auto'){localStore.set(VR_HAPTICS_AUTO,'1');sessionStore.remove(VR_HAPTICS_BRIDGE);}
    else sessionStore.set(VR_HAPTICS_BRIDGE,value!);
    const hash=new URLSearchParams(location.hash.slice(1));hash.delete('vr-haptics');
    history.replaceState(history.state,'',location.pathname+location.search+(hash.size?'#'+hash:''));
  }
  return localStore.get(VR_HAPTICS_AUTO)==='1'?{url:HAPTICS_DISCOVERY_URL}:hapticsTarget(value??sessionStore.get(VR_HAPTICS_BRIDGE));
}
let connectionTarget=target();
export interface HapticBridge {
  readonly ready:boolean;
  pulse(hand:number,amplitude:number,duration:number):void;
  destroy():void;
}
export type HapticsConnectionState='checking'|'unavailable'|'connected'|'ready'|'update'|'restart';
export class NativeHaptics implements HapticBridge {
  state:HapticsConnectionState='checking';
  private checked=-Infinity;private live=-Infinity;private checking=false;private disposed=false;
  private pending=false;private queued=false;private revision=0;
  private levels=[{amplitude:0,until:0},{amplitude:0,until:0}];
  private token:string|null;
  constructor(private endpoint:{url:string;token?:string},private request:typeof fetch=(...args)=>fetch(...args),private now=()=>performance.now()){this.token=endpoint.token??null;}
  get ready():boolean {
    if(this.disposed)return false;
    const now=this.now();
    if(!this.checking&&now-this.checked>=1000){
      this.checking=true;this.checked=now;
      const token=this.token,headers:Record<string,string>=token?{'X-NFSU2-Haptics':token}:{'X-NFSU2-Connect':'1'};
      void this.request(this.endpoint.url+(token?'/status':'/connect'),{headers,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(60000)})
        .then(async response=>{
          const state=response.ok?await response.json():null;
          if(this.disposed)return;
          if(!token&&state?.version===1&&typeof state.token==='string'&&/^[a-f0-9]{32}$/.test(state.token)){
            this.token=state.token;this.checked=-Infinity;
          }
          if((response.status===401||response.status===403)&&!this.endpoint.token)this.token=null;
          this.live=state?.version===1&&state.ready===true&&!!this.token?this.now():-Infinity;
          this.state=this.live>-Infinity?'ready':state?.version===1&&!!this.token?'connected':'unavailable';
          if(token&&state?.version===1){
            if(!state.bridgeVersion||state.bridgeVersion<3)this.state='update';
            else if(state.initialized===false)this.state='restart';
          }
        })
        .catch(()=>{this.live=-Infinity;this.state='unavailable';}).finally(()=>{this.checking=false;});
    }
    return now-this.live<1500;
  }
  pulse(hand:number,amplitude:number,duration:number):void {
    if(this.disposed||hand<0||hand>1)return;
    this.levels[hand]={amplitude:Number.isFinite(amplitude)?Math.max(0,Math.min(1,amplitude)):0,
      until:this.now()+(Number.isFinite(duration)?Math.max(0,Math.min(100,duration)):0)};
    this.revision++;
    if(!this.queued){this.queued=true;queueMicrotask(()=>{this.queued=false;this.flush();});}
  }
  private flush():void {
    if(this.pending||this.disposed||!this.token)return;
    const now=this.now(),body=new Float32Array(4),revision=this.revision;
    for(let h=0;h<2;h++){
      const remaining=Math.max(0,this.levels[h].until-now);
      body[h*2]=remaining>0?this.levels[h].amplitude:0;body[h*2+1]=remaining;
    }
    this.pending=true;
    void this.request(this.endpoint.url+'/pulse',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-NFSU2-Haptics':this.token},
      body:body.buffer,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(150)})
      .then(response=>{if(!response.ok)this.live=-Infinity;}).catch(()=>{this.live=-Infinity;})
      .finally(()=>{this.pending=false;if(this.revision!==revision)this.flush();});
  }
  destroy():void {this.disposed=true;this.live=-Infinity;this.levels.forEach(v=>{v.amplitude=v.until=0;});}
}
export function nativeHaptics():HapticBridge|null {return connectionTarget?new NativeHaptics(connectionTarget):null;}
let probe:NativeHaptics|null=null;
export function nativeHapticsStatus():'off'|NativeHaptics['state'] {
  if(!connectionTarget)return 'off';
  probe??=new NativeHaptics(connectionTarget);void probe.ready;return probe.state;
}
export function enableNativeHaptics(enabled:boolean):void {
  if(enabled)localStore.set(VR_HAPTICS_AUTO,'1');else localStore.remove(VR_HAPTICS_AUTO);
  sessionStore.remove(VR_HAPTICS_BRIDGE);probe?.destroy();probe=null;
  connectionTarget=enabled?{url:HAPTICS_DISCOVERY_URL}:null;
}
/** Request Chrome's local connection permission on the start page, before XR owns focus. */
export function prepareNativeHaptics():void {void nativeHapticsStatus();}
// Setup may reuse an already open tab: changing only its fragment does not load
// the page again, so accept the one-time connection link there as well.
if(typeof window!=='undefined')window.addEventListener('hashchange',()=>{
  const value=new URLSearchParams(location.hash.slice(1)).get('vr-haptics');
  if(value==='auto'||hapticsTarget(value)){
    probe?.destroy();probe=null;connectionTarget=target();prepareNativeHaptics();
  }
});
