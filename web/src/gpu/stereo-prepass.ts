import {D,DRAW_WORDS,Kind} from './proto';

/** A mono reflection/shadow prelude may be shared by the eyes only while its
 * colour and depth survive the rest of the frame. Screen-dependent effects
 * and targets written again after the world remain separate eye replays. */
export function sharedPrelude(u:Uint32Array,at:number,count:number):number {
  const colors=new Set<number>(),depths=new Set<number>();
  let end=0;
  for(;end<count;end++){
    const w=at+end*DRAW_WORDS,kind=u[w+D.kind],target=u[w+D.target]&0xffff;
    if(!target && kind!==Kind.Clear || kind===Kind.Blit && !u[w+D.blitSrc])break;
    if(!target)continue;
    colors.add(target);
    if(kind!==Kind.Blit){
      const z=u[w+D.depth]>>>8;
      if(z===1)return 0; // implicit screen depth is resized during each eye
      if(z)depths.add(z);
    }
  }
  if(!colors.size || end===count)return 0;
  for(let i=end;i<count;i++){
    const w=at+i*DRAW_WORDS;
    if(colors.has(u[w+D.target]&0xffff) || u[w+D.kind]!==Kind.Blit && depths.has(u[w+D.depth]>>>8))return 0;
  }
  return end;
}
