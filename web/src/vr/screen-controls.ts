import {ScreenTouch,type Contact} from './screen-touch';
export interface Timeline {id:string;current:number;duration:number;seekable:boolean}
export const SEEK=5,VOLUME=6;
// At the default 230 mm width, sliders have an 18 mm tall touch area and
// buttons a 25 mm target. Their smaller visible circles leave the video clear.
// Drawing, touch targets and the reserved grip area share these coordinates.
export const screenLayout={width:1024,height:640,contentHeight:400,timeY:436,sliderY:488,sliderTop:448,sliderBottom:528,sliderPadding:32,knobRadius:24,buttonY:584,buttonRadius:36,pageRadius:44,buttonHitRadius:56} as const;
export const screenButtons=[112,312,512,712,912] as const;
export const seekRange=[56/1024,624/1024] as const,volumeRange=[744/1024,968/1024] as const;
export function screenControl(p:readonly number[]):number {
  const [u,v,z=0]=p;
  if(u<0||u>1||v<0||v>1||z>.095)return -1;
  const x=u*screenLayout.width,y=v*screenLayout.height,pad=screenLayout.sliderPadding/screenLayout.width;
  if(y>=screenLayout.sliderTop&&y<screenLayout.sliderBottom){
    if(u>=seekRange[0]-pad&&u<=seekRange[1]+pad)return SEEK;
    if(u>=volumeRange[0]-pad&&u<=volumeRange[1]+pad)return VOLUME;
  }
  return screenButtons.findIndex(center=>Math.hypot(x-center,y-screenLayout.buttonY)<=screenLayout.buttonHitRadius);
}
export function sliderValue(control:number,u:number):number {
  const [a,b]=control===SEEK?seekRange:volumeRange;
  return Math.max(0,Math.min(1,(u-a)/(b-a)));
}
export function mediaTime(seconds:number):string {
  const n=Number.isFinite(seconds)?Math.max(0,Math.floor(seconds)):0,m=Math.floor(n/60);
  return `${m>=60?`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`:m}:${String(n%60).padStart(2,'0')}`;
}
export class MediaTouch extends ScreenTouch {
  constructor(){super(screenControl);}
  sample(p:Contact|null,occupied=-1):{press:number;slider:number;value:number} {
    const press=this.update(p,occupied),slider=p&&this.control>=SEEK&&screenControl(p)===this.control?this.control:-1;
    return {press,slider,value:slider>=0?sliderValue(slider,p![0]):0};
  }
}
