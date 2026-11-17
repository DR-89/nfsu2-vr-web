/** Native quest_pedals.h: gas/brake are absolute; the animated clutch follows
 * the neutral rail and completes a short stroke for each selected gear. */
export class Pedals {
  readonly travel: [number,number,number] = [0,0,0];
  private at=0;
  private shiftAt=0;
  private epoch=0;
  private active=false;
  private gear=-1;
  private pulse=false;
  reset(): void { this.travel.fill(0);this.active=this.pulse=false; }
  update(now:number,active:boolean,gas:number,brake:number,epoch:number,gear:number,moving:boolean,selected:boolean): void {
    if(!active){this.reset();return;}
    const fresh=!this.active||epoch!==this.epoch||now-this.at>=500,dt=fresh?0:Math.min(.1,Math.max(0,(now-this.at)/1000));
    if(fresh){this.pulse=false;this.travel[2]=0;}
    this.travel[0]=gas;this.travel[1]=brake;
    if(gear<0){this.pulse=false;this.travel[2]=0;}
    else {
      if(selected||(!fresh&&this.gear>=0&&this.gear!==gear)){this.shiftAt=now;this.pulse=true;}
      if(now-this.shiftAt>=130)this.pulse=false;
      this.travel[2]=moving||this.pulse?Math.min(1,this.travel[2]+dt/.055):Math.max(0,this.travel[2]-dt/.18);
    }
    this.active=true;this.epoch=epoch;this.gear=gear;this.at=now;
  }
}
