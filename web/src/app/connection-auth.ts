import {CONNECTION_AUTH_DB} from './prefs';
import {readPhrase,keysOf} from './vault';

interface ClaimBox{v:1;iv:Uint8Array;box:Uint8Array}
const enc=new TextEncoder(),dec=new TextDecoder();
const tokenOK=(s:string)=>s.length===43&&!/[^A-Za-z0-9_-]/.test(s);
const request=<T>(r:IDBRequest<T>):Promise<T>=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
const finished=(tx:IDBTransaction):Promise<void>=>new Promise((ok,no)=>{tx.oncomplete=()=>ok();tx.onerror=tx.onabort=()=>no(tx.error??new Error('credential transaction failed'));});

/** Device-local sign-in, independent of the linked cloud career. Only the
 * derived claim token is sealed; the phrase is never stored or transmitted.
 * This is origin storage protection, not a boundary against same-origin code. */
export class ConnectionAuth{
  private opening:Promise<IDBDatabase>|null=null;
  private pending:Promise<void>=Promise.resolve();
  private ended=false;
  constructor(private scope:string,private database=CONNECTION_AUTH_DB){}
  private address(id:string):string{if(id.length!==32||/[^0-9a-f]/.test(id))throw new Error('invalid connection identity');return this.scope+'\0'+id;}
  private queue<T>(job:()=>Promise<T>):Promise<T>{
    if(this.ended)return Promise.reject(new Error('credentials closed'));
    const next=this.pending.then(job);this.pending=next.then(()=>{},()=>{});return next;
  }
  private db():Promise<IDBDatabase>{
    return this.opening??=new Promise((ok,no)=>{
      const r=indexedDB.open(this.database,1);
      r.onupgradeneeded=()=>{r.result.createObjectStore('keys');r.result.createObjectStore('claims');};
      r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{db.close();this.opening=null;};ok(db);};
      r.onerror=()=>{this.opening=null;no(r.error);};
    });
  }
  private async key(db:IDBDatabase):Promise<CryptoKey>{
    // Generate before opening the transaction; crypto promises do not keep an
    // IndexedDB transaction alive. The read/write transaction picks one key
    // even if two tabs initialize this store at the same time.
    const candidate=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const tx=db.transaction('keys','readwrite'),end=finished(tx),store=tx.objectStore('keys');
    const existing=await request(store.get('device')) as CryptoKey|undefined;
    const key=existing??candidate;if(!existing)store.put(key,'device');await end;
    if(key.extractable||key.type!=='secret'||key.algorithm.name!=='AES-GCM')throw new Error('invalid device key');return key;
  }
  token(id:string):Promise<string|null>{return this.queue(async()=>{
    const address=this.address(id),db=await this.db(),tx=db.transaction('claims','readonly'),end=finished(tx);
    const record=await request(tx.objectStore('claims').get(address)) as ClaimBox|undefined;await end;
    if(!record)return null;
    if(record.v!==1||!(record.iv instanceof Uint8Array)||record.iv.length!==12||!(record.box instanceof Uint8Array)||record.box.length!==59)throw new Error('invalid saved sign-in');
    const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv as Uint8Array<ArrayBuffer>,additionalData:enc.encode(address)},await this.key(db),record.box as Uint8Array<ArrayBuffer>));
    try{const token=dec.decode(raw);if(!tokenOK(token))throw new Error('invalid saved sign-in');return token;}finally{raw.fill(0);}
  });}
  link(id:string,phrase:string):Promise<void>{
    if(phrase==='')return this.forget(id);
    if(phrase.length>512)return Promise.reject(new Error('invalid keyphrase'));
    return this.queue(async()=>{
    const address=this.address(id),parsed=readPhrase(phrase);phrase='';
    if(!('phrase'in parsed))throw new Error('invalid keyphrase');
    const keys=await keysOf(parsed.phrase);parsed.phrase='';
    const raw=enc.encode(keys.token);keys.token='';
    try{
      const db=await this.db(),key=await this.key(db),iv=crypto.getRandomValues(new Uint8Array(12));
      const box=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(address)},key,raw));
      const tx=db.transaction('claims','readwrite'),end=finished(tx);tx.objectStore('claims').put({v:1,iv,box} satisfies ClaimBox,address);await end;
    }finally{raw.fill(0);}
  });}
  forget(id:string):Promise<void>{return this.queue(async()=>{
    const address=this.address(id),db=await this.db(),tx=db.transaction('claims','readwrite'),end=finished(tx);tx.objectStore('claims').delete(address);await end;
  });}
  async close():Promise<void>{this.ended=true;await this.pending;const db=await this.opening?.catch(()=>null);db?.close();this.opening=null;}
}
