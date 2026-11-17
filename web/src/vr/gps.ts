import { bitmapFont } from './bitmap-font';
import { mapMount } from './panel-grip';
import { vrSettings } from './settings';
import type { DriverScene } from './drivers';

export function gpsText(gps:DriverScene['gps']):string {
  if(!gps||!Number.isFinite(gps.metres)||gps.metres<0||gps.metres>=1000000)return '';
  const value=gps.metric?gps.metres:gps.metres/.3048,threshold=gps.metric?1000:5280;
  return value<threshold-.5?`${Math.round(value)} ${gps.metric?'M':'FT'}`:`${(value/threshold).toFixed(1)} ${gps.metric?'KM':'MI'}`;
}
/** Authored 5x7 glyphs below the map; no browser font or sampled HUD text.
 * Map and GPS share the same placement transform, including wrist rotation. */
export function gpsVertices(model:string,text:string):Float32Array<ArrayBuffer> {
  if(!text||text.length>=24)return new Float32Array();
  const m=mapMount(model,vrSettings({})).matrix,v:number[]=[];
  const quad=(x:number,y:number,w:number,h:number,z:number,kind:number)=>{
    for(const [a,b] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]){
      const p=[x+(a-.5)*w,y+(.5-b)*h,z];
      v.push(...[0,1,2].map(k=>m[12+k]+p.reduce((s,n,j)=>s+m[j*4+k]*n,0)),0,0,kind);
    }
  };
  quad(0,-.091,text.length*.010+.012,.024,.001,2);
  for(let i=0;i<text.length;i++){
    const rows=bitmapFont[text[i]]??[];
    for(let r=0;r<7;r++)for(let c=0;c<5;c++)if((rows[r]??0)&(1<<(4-c)))
      quad((i-(text.length-1)/2)*.010+(c-2)*.0083/5,-.091+(3-r)*.014/7,.0083/5,.014/7,.002,3);
  }
  return new Float32Array(v);
}
