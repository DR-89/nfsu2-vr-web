import {fitFor} from './drivers';
import {fitPoint} from './fit';
import {identity} from './math';
import {ScreenTouch,type Contact} from './screen-touch';
import type {CockpitRadio} from './radio';
import {t} from '../app/i18n';

/** Native console slope, recess and 53 mm control row. The web screen is
 * 16:10 including its buttons; leave the same 6 mm gap below that face. */
export function radioMount(model:string){
  const f=fitFor(model),slope=-.4*f[5],len=Math.hypot(1,slope),down=(.236*f[4]-.006)*10/16+.006;
  const y=-.237-down/len,center=fitPoint([.3116,y,-.365-.4*(y+.392)],f);
  center[1]-=.053*1.25;center[2]+=.053*1.25*.4*f[5]-.10;
  const m=identity();m.set([1,0,0,0,0,1/len,slope/len,0,0,-slope/len,1/len,0,...center,1]);
  return {matrix:m,width:.236*f[4],height:.053*2.5*len};
}
export function radioContact(model:string,tip:readonly number[]):Contact {
  const m=radioMount(model),p=tip.map((v,k)=>v-m.matrix[12+k]);
  const y=p[1]*m.matrix[5]+p[2]*m.matrix[6],z=p[1]*m.matrix[9]+p[2]*m.matrix[10];
  return [p[0]/m.width+.5,(.5-y/m.height)*2.5,z];
}
export const radioButton=(p:Contact):number=>{
  if(p[2]>.095)return -1;
  if(p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1)return p[0]<.46?0:p[0]<.64?1:p[0]<.82?2:3;
  if(p[0]>=.05&&p[0]<=.95&&p[1]>=1.9&&p[1]<=2.5)return p[0]<.5?4:5;
  return -1;
};
export class RadioTouch extends ScreenTouch {
  constructor(){super(radioButton);}
  sample(p:Contact|null,occupied:number):{button:number;volume:number|null}{
    const button=this.update(p,occupied);
    return {button,volume:p&&this.control===0&&radioButton(p)===0&&occupied!==0?Math.max(0,Math.min(1,(p[0]-.09)/.33)):null};
  }
}
export function radioScroll(length:number,elapsed:number):number {
  if(length<=20)return 0;
  const travel=(length-20)*350,tick=Math.max(0,elapsed)%(travel+3600);
  return Math.max(0,Math.min(travel,tick-1800))/350;
}
export class RadioCanvas {
  private surface:HTMLCanvasElement|null=null;
  private painted=-Infinity;
  private song='';
  private since=0;
  get canvas():HTMLCanvasElement {
    if(!this.surface){this.surface=document.createElement('canvas');this.surface.width=1024;this.surface.height=576;}
    return this.surface;
  }
  paint(radio:CockpitRadio|null,volume:number,hover:number,now=performance.now()):boolean {
    if(now-this.painted<33)return false;this.painted=now;
    const g=this.canvas.getContext('2d')!,title=radio?.title||'EA TRAX',artist=radio?.artist||'',song=title+'\n'+artist;
    if(song!==this.song){this.song=song;this.since=now;}
    g.clearRect(0,0,1024,576);g.fillStyle='#101a24';g.fillRect(0,0,1024,408);
    const boxes=[[.02,.44],[.47,.63],[.65,.81],[.83,.99]],labels=['', '⏮',radio?.paused?'▶':'Ⅱ','⏭'];
    g.textAlign='center';g.textBaseline='middle';g.font='bold 64px sans-serif';
    boxes.forEach(([a,b],i)=>{g.fillStyle=hover&(1<<i)?'#327a9a':'#213041';g.fillRect(a*1024,8,(b-a)*1024,210);g.fillStyle='#eafaff';g.fillText(labels[i],(a+b)*512,112);});
    g.fillStyle='#08131c';g.fillRect(92,98,338,28);g.fillStyle='#62ddff';g.fillRect(92,98,338*volume,28);g.fillRect(86+338*volume,83,12,58);
    g.fillStyle='#eafaff';g.font='26px monospace';g.fillText(`${Math.round(volume*100)}%`,255,172);
    g.save();g.beginPath();g.rect(28,244,968,144);g.clip();g.fillStyle='#83e9da';g.font='40px monospace';g.textAlign='left';
    const advance=g.measureText('M').width;g.translate(28,0);g.scale(968/(20*advance),1);
    for(const [row,text]of [title,artist].entries())g.fillText(text,-radioScroll([...text].length,now-this.since)*advance,276+row*60);
    g.restore();g.font='bold 42px sans-serif';g.textAlign='center';
    for(let i=0;i<2;i++){g.fillStyle=hover&(1<<(i+4))?'#327a9a':'#213041';g.fillRect((.06+i*.45)*1024,438,.43*1024,138);g.fillStyle='#eafaff';g.fillText(i?t('Next page'):'LED',(.275+i*.45)*1024,508,400);}
    return true;
  }
}
