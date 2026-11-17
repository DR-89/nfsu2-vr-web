import type {ConnectionProfile} from './connection-profiles';
import type {NetProfile} from '../net';

export interface ProfileGame{
  ready():boolean;
  nameHash():number|undefined;
  profile(p:NetProfile|null):Promise<boolean>;
  name(name:string):boolean;
  room(room:string):boolean;
  reset():void;
}
export function connectionNameHash(name:string):number{
  let h=2166136261;for(let i=0;i<name.length;i++)h=Math.imul(h^name.charCodeAt(i),16777619);return h>>>0;
}
/** A game ending, leaving free roam or rejecting a command cannot reconnect
 * later under the previous game's credentials. Failed changes stay off. */
export async function connectProfile(game:ProfileGame,current:()=>ProfileGame|null,p:ConnectionProfile,claim:string|null,
  wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))):Promise<boolean>{
  const valid=()=>current()===game&&game.ready();
  if(!valid()||!await game.profile(null))return false;
  game.reset();
  if(!valid()||!game.name(p.name)||!game.room(p.room))return false;
  const hash=connectionNameHash(p.name);
  for(let i=0;i<100&&valid()&&game.nameHash()!==hash;i++)await wait(50);
  if(!valid()||game.nameHash()!==hash)return false;
  if(!await game.profile({name:p.name,...(claim?{claim}:{})}))return false;
  // A state transition may race the worker's acknowledgement.
  if(!valid()){await game.profile(null);return false;}
  return true;
}
