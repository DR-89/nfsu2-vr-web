import type { Cockpit } from './cockpit';
import { Shifter, SHIFT_PITCH, SHIFT_THROW, shiftCenter } from './shifter';
import { identity } from './math';

/** Native horizontal gate guide, 45 mm above the neutral knob. Slot directions
 * stay in driver space on both left- and right-hand-drive consoles. */
export function guideMount(model: string, count: number, sequential: boolean) {
  const center=shiftCenter(model),last=count===6?3:2,width=sequential?.075:last*SHIFT_PITCH+.045,height=.19;
  if(!sequential)center[0]+=(last*.5-1)*SHIFT_PITCH;
  center[1]+=.045;
  const matrix=identity();matrix.set([width,0,0,0, 0,0,-height,0, 0,1,0,0, ...center,1]);
  return {matrix,width,height,offset:sequential?0:(last*.5-1)*SHIFT_PITCH};
}
export class ShifterGuide {
  private surface: HTMLCanvasElement | null = null;
  private signature='';
  get canvas(): HTMLCanvasElement {
    if(!this.surface){this.surface=document.createElement('canvas');this.surface.width=this.surface.height=512;}
    return this.surface;
  }
  visible(c: Cockpit): boolean {
    const box=c.scene?.gearbox;
    return !!box?.manual && box.ready && box.count>=4 && box.count<=6 &&
      (c.settings.shiftGuide===1 || (c.settings.shiftGuide===2 && (c.shifter.atLever || c.shifter.hand>=0 || c.motion.zones.some(Boolean))));
  }
  paint(c: Cockpit): boolean {
    const count=c.scene!.gearbox!.count,mode=!!c.settings.shift.mode,reverse=c.settings.shift.reverse;
    const mount=guideMount(c.scene!.local!.model,count,mode),s=c.shifter;
    const signature=[count,mode,reverse,s.x.toFixed(4),s.z.toFixed(4)].join('/');
    if(signature===this.signature)return false;this.signature=signature;
    const g=this.canvas.getContext('2d')!;g.clearRect(0,0,512,512);
    const x=(v:number)=>(v-mount.offset)/mount.width*512+256,z=(v:number)=>v/mount.height*512+256;
    const line=(x1:number,z1:number,x2:number,z2:number)=>{g.beginPath();g.moveTo(x(x1),z(z1));g.lineTo(x(x2),z(z2));g.stroke();};
    g.strokeStyle='#a8dce8';g.lineWidth=.004/mount.width*512;g.lineCap='round';g.fillStyle='#effaff';g.textAlign='center';g.textBaseline='middle';g.font=`bold ${.017/mount.height*512}px monospace`;
    if(mode){
      line(0,-SHIFT_THROW,0,SHIFT_THROW);
      g.fillText(reverse?'+':'−',x(0),z(-SHIFT_THROW*1.25));g.fillText(reverse?'−':'+',x(0),z(SHIFT_THROW*1.25));
    } else {
      line(-SHIFT_PITCH,0,(count===6?2:1)*SHIFT_PITCH,0);
      const stop=new Shifter();
      for(let gear=0;gear<=count+1;gear++)if(gear!==1){
        stop.detent(gear,count);line(stop.x,0,stop.x,stop.z);g.fillText(gear===0?'R':String(gear-1),x(stop.x),z(stop.z*1.25));
      }
      g.font=`bold ${.014/mount.height*512}px monospace`;g.fillText('N',x(.011),z(-.011));
    }
    g.fillStyle='#5effac';g.beginPath();g.ellipse(x(s.x),z(s.z),.0085/mount.width*512,.0085/mount.height*512,0,0,Math.PI*2);g.fill();
    return true;
  }
}
