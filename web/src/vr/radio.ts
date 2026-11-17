import type {RadioLink} from '../app/radio-link';
import type {Radio} from '../radio';
import type {MediaPanel} from './media-panel';
import type {Timeline} from './screen-controls';

/** Windowed FFT of the actual music reader, excluding engines and speech. */
export class MusicSpectrum {
  readonly bins=new Uint8Array(128);
  private seq=0;
  get sequence():number{return this.seq;}
  private re=new Float64Array(512);
  private im=new Float64Array(512);
  private window=Float64Array.from({length:512},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/511));
  private at=-Infinity;
  update(frame:ReturnType<RadioLink['musicSamples']>,paused:boolean,now:number):Uint8Array {
    if(paused){this.bins.fill(0);this.at=-Infinity;return this.bins;}
    if(!frame||frame.seq===this.seq){if(now-this.at>250)this.bins.fill(0);return this.bins;}
    this.seq=frame.seq;this.at=now;
    const n=512,re=this.re,im=this.im,samples=frame.samples;im.fill(0);
    for(let i=0;i<n;i++)re[i]=(samples[i]??0)*this.window[i];
    for(let i=1,j=0;i<n;i++){
      let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
      if(i<j)[re[i],re[j]]=[re[j],re[i]];
    }
    for(let len=2;len<=n;len*=2){
      const a=-2*Math.PI/len,cr=Math.cos(a),ci=Math.sin(a);
      for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){
        const l=i+j,r=l+len/2,vr=re[r]*wr-im[r]*wi,vi=re[r]*wi+im[r]*wr;
        re[r]=re[l]-vr;im[r]=im[l]-vi;re[l]+=vr;im[l]+=vi;
        const next=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=next;
      }}
    }
    for(let i=0;i<this.bins.length;i++){
      const amp=Math.max(Math.hypot(re[i*2],im[i*2]),Math.hypot(re[i*2+1],im[i*2+1]))*4/n;
      this.bins[i]=Math.round(Math.max(0,Math.min(1,(20*Math.log10(Math.max(1e-6,amp))+70)/70))*255);
    }
    return this.bins;
  }
}

export class CockpitRadio {
  private fft=new MusicSpectrum();
  private active=false;
  private source=0;
  private volume=NaN;
  constructor(private port:()=>RadioLink|null,readonly media:MediaPanel|null,private folder:()=>Radio|null=()=>null){}
  update(active:boolean,volume:number,gainDB=0,source=0,inWorld=active):void {
    this.active=active;this.source=source;
    this.media?.setGameSource(source,inWorld);
    const folder=this.folder();
    folder?.pauseForSource(!inWorld||source===2,source===1&&!!(this.media?.usable||folder.usable),source===1);
    this.port()?.cockpit(active&&!this.media?.active,volume);
    if(volume!==this.volume){this.media?.setVolume(volume);this.volume=volume;}
    this.media?.setMasterGain(gainDB);
  }
  get title():string {return this.media?.active?this.media.title:this.port()?.song()?.lines.title??'EA TRAX';}
  get artist():string {return this.media?.active?'':this.port()?.song()?.lines.artist??'';}
  get paused():boolean {return this.media?.active?this.media.player.paused:this.port()?.transport()?.paused??true;}
  get timeline():Timeline {
    if(this.media?.active)return this.media.timeline;
    const folder=this.folder();if(folder?.on&&folder.timeline)return folder.timeline;
    const song=this.port()?.song();return {id:`game:${song?.seq??0}`,current:(song?.ms??0)/1000,duration:0,seekable:false};
  }
  seek(seconds:number,id:string):boolean {
    return this.media?.active?this.media.seek(seconds,id):this.folder()?.seek(seconds,id)??false;
  }
  command(action:'previous'|'toggle'|'next'):void {
    if(!this.active)return;
    const media=this.media,folder=this.folder();
    if(this.source!==2&&(media?.active||media?.available&&!folder?.on)){
      if(action==='toggle')void media.toggle();else void media.step(action==='next'?1:-1);
    } else if(folder?.on&&action!=='toggle')void folder.stepTrack(action==='next'?1:-1);
    else this.port()?.command(action);
  }
  spectrum(now=performance.now()):Uint8Array {
    return this.media?.active?this.media.spectrum():this.fft.update(this.port()?.musicSamples(this.fft.sequence)??null,this.paused,now);
  }
  level():number {const bins=this.spectrum();return this.paused?0:bins.reduce((a,b)=>a+b,0)/(255*bins.length);}
  destroy():void {this.port()?.cockpit(false,1);this.media?.endGame();this.folder()?.clearSource();this.active=false;}
}
