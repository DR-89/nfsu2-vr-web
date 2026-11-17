import { identity,type Mat4 } from './math';
import { mirrorAngle,mirrorRotate,mirrorTrim,type MirrorMount,type MirrorSettings,type MirrorAngle } from './mirrors';

/** Native quest_mirrors grip: wrist rotation and a push at the fixed contact
 * point adjust the optical angle. Tracking discontinuities rebase the grip. */
export class MirrorGrip {
  hand=-1;
  part=-1;
  private armed=[false,false];
  private rebase=true;
  private tick=0;
  private previous=identity();
  private anchor=identity();
  private contact=[0,0,0];
  private start:MirrorAngle={yaw:0,pitch:0};
  private original:MirrorAngle|null=null;
  block(hand:number,s:MirrorSettings):boolean {
    this.armed[hand]=false;return this.hand===hand?this.release(s):false;
  }
  release(s:MirrorSettings):boolean {
    const a=this.part===0?s.inside:s.outside,o=this.original;
    const changed=!!o&&(Math.abs(a.yaw-o.yaw)>1e-5||Math.abs(a.pitch-o.pitch)>1e-5);
    this.hand=this.part=-1;this.original=null;this.rebase=true;this.armed.fill(false);return changed;
  }
  update(s:MirrorSettings,mounts:(MirrorMount|null)[],now:number,poses:(Mat4|null)[],grip:number[],busy:boolean[]):boolean {
    if(!Number.isFinite(now))return this.release(s);
    let saved=false;
    for(let h=0;h<2;h++)if(grip[h]<.15){if(this.hand===h)saved=this.release(s);this.armed[h]=true;}
    const valid=(h:number)=>!!poses[h]?.every(Number.isFinite);
    if(this.hand<0){
      let best=.075*.075;
      for(let h=0;h<2;h++){
        if(busy[h]||!valid(h)||!this.armed[h]||!(grip[h]>=.65))continue;
        for(let p=0;p<3;p++){
          const m=mounts[p];if(!m)continue;
          const local=mirrorRotate(m.center.map((v,k)=>poses[h]![12+k]-v),mirrorAngle(s,p),true);
          const contact=local.map((v,k)=>Math.max(-m.half[k],Math.min(m.half[k],v)));
          const d=contact.reduce((sum,v,k)=>sum+(v-local[k])**2,0);
          if(d<best){best=d;this.hand=h;this.part=p;this.contact=contact;this.rebase=true;}
        }
      }
      if(this.hand>=0){this.original={...(this.part===0?s.inside:s.outside)};this.tick=now;}
    }
    if(this.hand<0)return saved;
    const h=this.hand,p=this.part;
    if(!mounts[p]||busy[h])return this.release(s)||saved;
    if(!Number.isFinite(grip[h])){this.rebase=true;return now-this.tick>=500?this.release(s)||saved:saved;}
    const elapsed=now-this.tick;this.tick=now;
    if(!valid(h)){this.rebase=true;return saved;}
    const cur=poses[h]!,old=this.previous,a=p===0?s.inside:s.outside;
    let trace=0;for(let col=0;col<3;col++)for(let k=0;k<3;k++)trace+=old[col*4+k]*cur[col*4+k];
    const step=[0,1,2].reduce((sum,k)=>sum+(cur[12+k]-old[12+k])**2,0);
    if(this.rebase||elapsed<0||elapsed>250||trace<2.4||step>.1*.1){this.anchor.set(cur);this.start=mirrorAngle(s,p);}
    else {
      const arm=mirrorRotate(this.contact,this.start),motion=[0,1,2].map(k=>cur[12+k]-this.anchor[12+k]),spin=[0,0,0];
      for(let k=0;k<3;k++){const i=(k+1)%3,j=(k+2)%3;for(let col=0;col<3;col++)spin[k]+=.5*(this.anchor[col*4+i]*cur[col*4+j]-this.anchor[col*4+j]*cur[col*4+i]);}
      const leverage=.30/(arm.reduce((sum,v)=>sum+v*v,0)+.085*.085);
      const yaw=.45*spin[1]+leverage*(arm[2]*motion[0]-arm[0]*motion[2]);
      const pitch=.45*spin[0]+leverage*(arm[1]*motion[2]-arm[2]*motion[1]);
      const target=mirrorTrim(this.start.yaw+yaw,this.start.pitch+pitch);if(p===1)target.yaw=-target.yaw;
      const gain=-Math.expm1(-elapsed/35);a.yaw+=gain*(target.yaw-a.yaw);a.pitch+=gain*(target.pitch-a.pitch);
    }
    this.previous.set(cur);this.rebase=false;return saved;
  }
}
