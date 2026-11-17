import {ConnectionProfiles,ConnectionProfileError,type ConnectionEdit,type ConnectionProfile} from './connection-profiles';
import {ConnectionAuth} from './connection-auth';
import {NameClaims} from './claim';
import {t,N} from './i18n';

export const CONNECTION_LABELS={title:N('Online profiles'),create:N('Create profile'),rename:N('Rename selected'),room:N('Edit world'),remove:N('Delete selected'),connect:N('Connect free roam'),disconnect:N('Disconnect'),auth:N('Link passphrase'),manage:N('Reserve / manage name')};
export interface ConnectionActions{
  writable():boolean;
  connect(profile:ConnectionProfile,claim:string|null):Promise<string>;
  disconnect():Promise<string>;
  manage():Promise<string>;
  online?():boolean;
  race?(profile:ConnectionProfile,claim:string|null):Promise<boolean>;
}
/** Website and headset operate one catalogue and one serial command stream.
 * Tokens are request-only values: snapshots and notices never contain them. */
export class ConnectionManager{
  busy=false;
  notice='';
  linked=new Set<string>();
  private listeners=new Set<()=>void>();
  constructor(readonly profiles:ConnectionProfiles,private auth:ConnectionAuth,private actions:ConnectionActions){}
  onChange(fn:()=>void):()=>void{this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  private publish():void{for(const fn of this.listeners)fn();}
  get current(){return this.profiles.current;}
  get selectedName():string {const c=this.current;return c?.profiles.find(p=>p.id===c.selected)?.name??'';}
  get message():string{return this.notice===t('Connecting to free roam…')&&this.actions.online?.()?t('Online'):this.notice;}
  private selected():ConnectionProfile{const c=this.current,p=c?.profiles.find(p=>p.id===c.selected);if(!p)throw new ConnectionProfileError('missing');return p;}
  private async run(job:()=>Promise<void>):Promise<boolean>{
    if(this.busy)return false;
    this.busy=true;this.notice='';this.publish();
    try{await job();return true;}
    catch(e){this.notice=e instanceof ConnectionProfileError?e.code==='limit'?t('At most eight online profiles.'):e.code==='name'?t('Choose a valid online name.'):e.code==='room'?t('World names can have at most 63 bytes.'):e.code==='missing'?t('Select an online profile first.'):t('Online profiles could not be read.'):t('The connection change could not be completed.');return false;}
    finally{this.busy=false;this.publish();}
  }
  refresh():Promise<boolean>{return this.run(async()=>{
    const c=await this.profiles.load(),linked=new Set<string>();let failed=false;
    for(const p of c.profiles)try{if(await this.auth.token(p.id))linked.add(p.id);}catch{failed=true;}
    this.linked=linked;if(failed)this.notice=t('Saved sign-in could not be opened. Link the passphrase again.');
  });}
  edit(edit:ConnectionEdit):Promise<boolean>{return this.run(async()=>{
    if(!this.actions.writable())throw Error('read-only');await this.profiles.edit(edit);
    if(edit.action==='delete'){this.linked.delete(edit.id);await this.auth.forget(edit.id);}
    this.notice=t('Saved.');
  });}
  link(id:string,phrase:string):Promise<boolean>{return this.run(async()=>{
    if(!this.actions.writable())throw Error('read-only');
    if(!(await this.profiles.load()).profiles.some(p=>p.id===id))throw new ConnectionProfileError('missing');
    await this.auth.link(id,phrase);phrase='';if(await this.auth.token(id))this.linked.add(id);else this.linked.delete(id);this.notice=t('Saved.');
  });}
  private async checked(job:(p:ConnectionProfile,claim:string|null)=>Promise<void>):Promise<void>{
    const selected=this.selected(),claim=await this.auth.token(selected.id),names=new NameClaims(async()=>claim),state=await names.check(selected.name);
    if(!state&&names.here!==false){this.notice=t('The connection change could not be completed.');return;}
    if(state&&!['free','yours','old'].includes(state.state)){this.notice=t('This name is unavailable. Check its passphrase or choose another name.');return;}
    const c=await this.profiles.load(),p=c.profiles.find(p=>p.id===selected.id);
    if(!p||c.selected!==selected.id||p.name!==selected.name||p.room!==selected.room)throw new ConnectionProfileError('missing');
    await job(p,claim);
  }
  connect():Promise<boolean>{return this.run(()=>this.checked(async(p,claim)=>{this.notice=await this.actions.connect(p,claim);}));}
  async prepareRace():Promise<boolean>{
    let ready=false;
    await this.run(()=>this.checked(async(p,claim)=>{
      ready=await this.actions.race?.(p,claim)??false;
      if(!ready)this.notice=t('The connection change could not be completed.');
    }));
    return ready;
  }
  disconnect():Promise<boolean>{return this.run(async()=>{this.notice=await this.actions.disconnect();});}
  manage():Promise<boolean>{return this.run(async()=>{this.notice=await this.actions.manage();});}
}
