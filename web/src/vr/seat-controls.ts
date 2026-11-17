import { fitFor } from './drivers';
import { fitPoint } from './fit';
import { identity } from './math';
import type { Contact } from './screen-touch';

// One row along the armrest: forward, back, up, down. At the default cabin fit,
// the 52 x 208 mm strip has 39 mm circles and 47 mm touch targets.
export const seatLayout={width:256,height:1024,radius:96,hitRadius:116} as const;
export const seatButtons=[[128,128],[128,384],[128,640],[128,896]] as const;
/** Flat along the authored door armrest, with the first icon towards the dash.
 * The vehicle fit mirrors the mounting position for right-hand-drive cars. */
export function seatMount(model:string){
  // The handle's inner top spans roughly x=-.29..-.24 m, y=-.45 m.
  // Centre the strip on that surface, clear of the door trim behind it.
  const f=fitFor(model),matrix=identity(),center=fitPoint([-.265,-.434,-.134],f);
  matrix.set([1,0,0,0,0,0,-1,0,0,1,0,0,...center,1]);
  return {matrix,width:.052*f[3],height:.208};
}
export function seatContact(model:string,tip:readonly number[]):Contact {
  const m=seatMount(model),p=tip.map((v,k)=>v-m.matrix[12+k]);
  const local=[0,1,2].map(k=>p.reduce((sum,v,r)=>sum+v*m.matrix[k*4+r],0));
  return [local[0]/m.width+.5,.5-local[1]/m.height,local[2]];
}
export function seatButton(p:Contact):number {
  if(p[0]<0||p[0]>1||p[1]<0||p[1]>1||p[2]>.095)return -1;
  return seatButtons.findIndex(([x,y])=>Math.hypot(p[0]*seatLayout.width-x,p[1]*seatLayout.height-y)<=seatLayout.hitRadius);
}

function seatIcon(g:CanvasRenderingContext2D,button:number):void {
  g.strokeStyle='#effaff';g.lineWidth=12;g.lineCap='round';g.lineJoin='round';g.beginPath();
  // Seat back, cushion and the supporting rail, facing the forward arrow.
  g.moveTo(-36,-60);g.lineTo(-24,-12);g.lineTo(24,-12);g.stroke();
  g.lineWidth=8;g.beginPath();g.moveTo(-12,-12);g.lineTo(-20,4);g.lineTo(24,4);g.stroke();
  g.strokeStyle='#62ddff';g.lineWidth=10;g.beginPath();
  if(button<2){
    const d=button===0?1:-1;g.moveTo(-d*36,32);g.lineTo(d*36,32);g.moveTo(d*16,12);g.lineTo(d*36,32);g.lineTo(d*16,52);
  }else{
    const d=button===2?-1:1;g.moveTo(52,-24-d*36);g.lineTo(52,-24+d*36);g.moveTo(32,-24+d*16);g.lineTo(52,-24+d*36);g.lineTo(72,-24+d*16);
  }
  g.stroke();
}

export class SeatCanvas {
  private surface:HTMLCanvasElement|null=null;
  private signature=-1;
  get canvas():HTMLCanvasElement {
    if(!this.surface){this.surface=document.createElement('canvas');this.surface.width=seatLayout.width;this.surface.height=seatLayout.height;}
    return this.surface;
  }
  paint(hover:number):boolean {
    if(hover===this.signature)return false;this.signature=hover;
    const g=this.canvas.getContext('2d')!;g.clearRect(0,0,seatLayout.width,seatLayout.height);
    g.fillStyle='#080e19';g.strokeStyle='#647d98';g.lineWidth=4;g.beginPath();g.roundRect(4,4,seatLayout.width-8,seatLayout.height-8,40);g.fill();g.stroke();
    for(const [i,[x,y]] of seatButtons.entries()){
      g.save();g.translate(x,y);
      g.fillStyle=hover&(1<<i)?'#327a9a':'#16263c';g.strokeStyle=hover&(1<<i)?'#62ddff':'#647d98';g.lineWidth=hover&(1<<i)?8:4;
      g.beginPath();g.arc(0,0,seatLayout.radius,0,Math.PI*2);g.fill();g.stroke();
      seatIcon(g,i);g.restore();
    }
    return true;
  }
}
