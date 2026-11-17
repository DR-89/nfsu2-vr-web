export type Contact = [number,number,number]; // normalized u/v, depth in metres
const button = (p:Contact) => p[0]>=0&&p[0]<=1&&p[1]>=.9&&p[1]<=1&&p[2]<=.095 ? Math.min(4,Math.floor(p[0]*5)) : -1;
/** Native quest_touch_update thresholds. Contact uses the authored index pad,
 * with a swept press plane so a fast poke cannot pass between two frames. */
export class ScreenTouch {
  constructor(private hit:(p:Contact)=>number=button){}
  pointing = -1;
  control = -1;
  private blocked = true;
  private previous:Contact|null = null;
  reset():void {this.pointing=this.control=-1;this.blocked=true;this.previous=null;}
  update(position:Contact|null, occupied=-1):number {
    if(!position){this.reset();return -1;}
    const old=this.previous;this.previous=position;
    let p=position;
    if(!this.blocked&&old&&old[2]>.006&&p[2]<=.006) {
      const travel=old[2]-p[2];
      if(travel<.30&&Math.abs(old[0]-p[0])<1.2&&Math.abs(old[1]-p[1])<5){
        const t=(old[2]-.006)/travel;
        const swept:Contact=[old[0]+(p[0]-old[0])*t,old[1]+(p[1]-old[1])*t,.006];
        if(this.hit(swept)>=0)p=swept;
      }
    }
    const hit=this.hit(p);this.pointing=hit;
    if(hit<0||p[2]>.025||p[2]<-.035){
      this.control=-1;
      // Leaving a button sideways is not a release. Rearm only after the
      // fingertip withdraws in front of the screen, including outside its UVs.
      if(p[2]>.025)this.blocked=false;
      else if(p[2]<-.035)this.blocked=true;
      if(p[2]<-.035)this.pointing=-1;
      return -1;
    }
    if(!this.blocked&&p[2]<=.006){
      this.blocked=true;
      if(hit!==occupied){this.control=hit;return hit;}
    }
    return -1;
  }
}
