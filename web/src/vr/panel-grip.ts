import { fitFor } from './drivers';
import { fitPoint } from './fit';
import { identity, type Mat4 } from './math';
import type { VRSettings } from './settings';
import { PAD_DLEFT } from '../input/proto';
import { screenLayout } from './screen-controls';

export type PanelKind = 'screen' | 'map';
export interface Placement { offset:number[]; pitch:number; yaw:number; scale:number }
export interface PanelMount { matrix:Mat4; width:number; height:number }
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function placement(s:VRSettings,kind:PanelKind):Placement {
  return kind==='map'?{offset:[s.mapX,s.mapY,s.mapZ],pitch:s.mapPitch,yaw:s.mapYaw,scale:1}:
    {offset:[s.screenX,s.screenY,s.screenZ],pitch:s.pitch,yaw:s.yaw,scale:s.screenScale};
}
export function applyPlacement(s:VRSettings,kind:PanelKind,p:Placement):void {
  if(kind==='map'){[s.mapX,s.mapY,s.mapZ]=p.offset;s.mapPitch=p.pitch;s.mapYaw=p.yaw;}
  else {[s.screenX,s.screenY,s.screenZ]=p.offset;s.pitch=p.pitch;s.yaw=p.yaw;s.screenScale=p.scale;}
}
export function panelMount(model:string,kind:PanelKind,p:Placement):PanelMount {
  const f=fitFor(model),slope=-.4*f[5],width=kind==='map'?.15:(.236*f[4]-.006)*p.scale;
  const y=-.237-(.236*f[4]-.006)*10/32/Math.hypot(1,slope);
  const center=fitPoint(kind==='map'?[.3116,-.155,-.463]:[.3116,y,-.365-.4*(y+.392)],f);
  if(kind==='screen')center[2]-=.10;
  const pitch=Math.atan(slope)+p.pitch,cy=Math.cos(p.yaw),sy=Math.sin(p.yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const matrix=identity();matrix.set([cy,0,-sy,0,sy*sp,cp,cy*sp,0,sy*cp,-sp,cy*cp,0,...center.map((v,k)=>v+p.offset[k]),1]);
  return {matrix,width,height:kind==='map'?.15:width*10/16};
}
export const screenMount=(model:string,s:VRSettings):PanelMount=>panelMount(model,'screen',placement(s,'screen'));
export const mapMount=(model:string,s:VRSettings):PanelMount=>panelMount(model,'map',placement(s,'map'));
function contact(m:PanelMount,pose:Mat4):number[] {
  return [0,1,2].map(k=>[0,1,2].reduce((v,r)=>v+m.matrix[k*4+r]*(pose[12+r]-m.matrix[12+r]),0));
}

/** Native quest_minimap/quest_screen grip: the grabbed point stays under the
 * palm during translation, wrist rotation and screen resizing. */
export class PanelGrip {
  hand=-1;
  hover=[false,false];
  private armed=[false,false];
  private start:Placement|null=null;
  private forward:number[]=[];
  private contact:number[]=[];
  constructor(readonly kind:PanelKind){}
  block(hand:number,p:Placement):boolean {if(this.hand===hand)return this.release(p);this.armed[hand]=this.hover[hand]=false;return false;}
  release(p:Placement):boolean {
    const a=this.start,changed=!!a&&[...p.offset.map((v,k)=>v-a.offset[k]),p.pitch-a.pitch,p.yaw-a.yaw,p.scale-a.scale].some(v=>Math.abs(v)>1e-5);
    this.hand=-1;this.start=null;this.armed.fill(false);this.hover.fill(false);return changed;
  }
  update(model:string,p:Placement,poses:(Mat4|null)[],squeeze:number[],busy:boolean[],dt:number,stick:number,enabled=true):boolean {
    if(!enabled)return this.release(p);
    let saved=false,m=panelMount(model,this.kind,p);
    const valid=(h:number)=>!!poses[h]?.every(Number.isFinite)&&Number.isFinite(squeeze[h])&&!busy[h];
    if(this.hand>=0){
      const h=this.hand,pose=poses[h],tracked=valid(h),a=this.start!;
      if(tracked&&(this.kind==='map'||squeeze[h]>=.15)){
        const forward=[0,1,2].map(k=>this.forward.reduce((v,x,j)=>v+pose![j*4+k]*x,0)),limit=this.kind==='map'?Math.PI/4:Math.PI/3;
        p.pitch=clamp(a.pitch+Math.atan2(-forward[1],Math.hypot(forward[0],forward[2])),-limit,limit);
        p.yaw=clamp(a.yaw+Math.atan2(forward[0],forward[2]),-limit,limit);
        if(this.kind==='screen'&&Number.isFinite(stick)&&Math.abs(stick)>.25)p.scale=clamp(p.scale-stick*clamp(dt,0,.1),.5,3);
        const zero=panelMount(model,this.kind,{...p,offset:[0,0,0]}).matrix,ratio=p.scale/a.scale;
        p.offset=[0,1,2].map(k=>clamp(pose![12+k]-zero[12+k]-(zero[k]*this.contact[0]+zero[4+k]*this.contact[1])*ratio-zero[8+k]*this.contact[2],-2,2));
        m=panelMount(model,this.kind,p);
      }
      if(!tracked||squeeze[h]<.15)saved=this.release(p);
    }
    for(let h=0;h<2;h++){
      this.hover[h]=false;
      if(!valid(h)){this.armed[h]=false;continue;}
      if(squeeze[h]<.15)this.armed[h]=true;
      const local=contact(m,poses[h]!);
      // Sliders and buttons cannot also serve as a handle for the display.
      const near=Math.abs(local[2])<=.055&&(this.kind==='map'?Math.hypot(local[0],local[1])<=.087:
        Math.abs(local[0])<=m.width/2+.012&&local[1]<=m.height/2+.012&&local[1]>=m.height*(.5-screenLayout.sliderTop/screenLayout.height));
      this.hover[h]=this.hand<0&&this.armed[h]&&near;
      if(squeeze[h]<.65)continue;
      if(this.hover[h]){
        this.hand=h;this.start={...p,offset:[...p.offset]};this.contact=local;this.forward=[poses[h]![2],poses[h]![6],poses[h]![10]];
      }
      this.armed[h]=false;
    }
    if(this.hand>=0)this.hover.fill(false);
    return saved;
  }
}

/** X/A over the map opens the original world map. Keep that face button
 * captured until release, including moving away or gripping the map. */
export class MapShortcut {
  captured=[false,false];
  private armed=[false,false];
  private until=0;
  reset():void {this.captured.fill(false);this.armed.fill(false);this.until=0;}
  block(hand:number):void {this.armed[hand]=this.captured[hand]=false;}
  sample(now:number,buttons:number[],hover:boolean[],held:number):number {
    for(let h=0;h<2;h++){
      const v=buttons[h],fresh=this.armed[h]&&v>.5;
      if(!Number.isFinite(v)){this.armed[h]=false;this.captured[h]=false;continue;}
      if(v<.15){this.armed[h]=true;this.captured[h]=false;}
      else if(v>.5)this.armed[h]=false;
      if(fresh&&(hover[h]||held===h)){this.captured[h]=true;if(held!==h)this.until=now+100;}
    }
    return now<this.until?1<<PAD_DLEFT:0;
  }
}
