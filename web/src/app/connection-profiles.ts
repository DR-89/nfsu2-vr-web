import {onlineName,readsAsSlur} from './claim';

export interface ConnectionProfile{id:string;name:string;room:string}
export interface ConnectionCatalog{version:1;identity:string;selected:string;profiles:ConnectionProfile[]}
export type ConnectionEdit={action:'create';name:string}|{action:'select';id:string}|{action:'delete';id:string}|{action:'rename';id:string;text:string}|{action:'room';id:string;text:string};
export type ConnectionError='unreadable'|'format'|'limit'|'name'|'room'|'missing';
export class ConnectionProfileError extends Error{constructor(readonly code:ConnectionError){super(code);}}
export const CONNECTION_FILE='xyz-profiles.json';
const idOK=(s:unknown):s is string=>typeof s==='string'&&s.length===32&&!/[^0-9a-f]/.test(s);
const nameOK=(s:unknown):s is string=>typeof s==='string'&&s.length<=15&&onlineName(s)===s&&!readsAsSlur(s);
const roomOK=(s:unknown):s is string=>typeof s==='string'&&new TextEncoder().encode(s).length<=63&&!/[\x00-\x1f\x7f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
const copy=(c:ConnectionCatalog):ConnectionCatalog=>({...c,profiles:c.profiles.map(p=>({...p}))});
export function connectionCatalog(text:string):ConnectionCatalog|null{
  if(text.length>16384)return null;
  try{
    const c=JSON.parse(text);
    if(!c||c.version!==1||!idOK(c.identity)||typeof c.selected!=='string'||!Array.isArray(c.profiles)||c.profiles.length>8)return null;
    const seen=new Set<string>(),profiles:ConnectionProfile[]=[];
    for(const p of c.profiles){
      if(!p||!idOK(p.id)||seen.has(p.id)||!nameOK(p.name)||!roomOK(p.room))return null;
      seen.add(p.id);profiles.push({...p,id:p.id,name:p.name,room:p.room});
    }
    if(profiles.length?!seen.has(c.selected):c.selected!=='')return null;
    return {...c,version:1,identity:c.identity,selected:c.selected,profiles};
  }catch{return null;}
}
export function connectionId():string{return Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');}
export function editConnection(catalog:ConnectionCatalog,edit:ConnectionEdit,newId=connectionId):ConnectionCatalog{
  const c=copy(catalog),fail=(code:ConnectionError):never=>{throw new ConnectionProfileError(code);};
  if(edit.action==='create'){
    if(c.profiles.length>=8)fail('limit');
    const name=onlineName(edit.name);if(!name||readsAsSlur(edit.name)||edit.name.length>256||edit.name.includes('\0'))fail('name');
    const id=newId();if(!idOK(id)||c.profiles.some(p=>p.id===id))fail('format');
    c.profiles.push({id,name:name!,room:''});c.selected=id;return c;
  }
  const i=c.profiles.findIndex(p=>p.id===edit.id);if(i<0)fail('missing');
  if(edit.action==='select')c.selected=edit.id;
  else if(edit.action==='delete'){c.profiles.splice(i,1);if(c.selected===edit.id)c.selected=c.profiles[0]?.id??'';}
  else if(edit.action==='rename'){
    const name=onlineName(edit.text);if(!name||readsAsSlur(edit.text)||edit.text.length>256||edit.text.includes('\0'))fail('name');c.profiles[i].name=name!;
  }else{if(!roomOK(edit.text))fail('room');c.profiles[i].room=edit.text;}
  return c;
}

/** A separate, cloud-portable catalogue. No career bytes or credentials belong
 * here. Mutations reread the latest complete file and publish only after save. */
export class ConnectionProfiles{
  private catalog:ConnectionCatalog|null=null;
  private pending:Promise<void>=Promise.resolve();
  constructor(private storage:{read:()=>Promise<string|null>;write:(text:string)=>Promise<void>},private id=connectionId,
    private exclusive:<T>(job:()=>Promise<T>)=>Promise<T>=job=>job()){}
  get current():ConnectionCatalog|null{return this.catalog&&copy(this.catalog);}
  private queue<T>(job:()=>Promise<T>):Promise<T>{const next=this.pending.then(()=>this.exclusive(job));this.pending=next.then(()=>{},()=>{});return next;}
  private async read():Promise<ConnectionCatalog>{
    const text=await this.storage.read();
    if(text===null)return {version:1,identity:this.catalog?.identity??this.id(),selected:'',profiles:[]};
    const parsed=connectionCatalog(text);if(!parsed)throw new ConnectionProfileError('format');return parsed;
  }
  load():Promise<ConnectionCatalog>{return this.queue(async()=>{this.catalog=await this.read();return copy(this.catalog);});}
  edit(edit:ConnectionEdit):Promise<ConnectionCatalog>{return this.queue(async()=>{
    const next=editConnection(await this.read(),edit,this.id);await this.storage.write(JSON.stringify(next)+'\n');this.catalog=next;return copy(next);
  });}
}
