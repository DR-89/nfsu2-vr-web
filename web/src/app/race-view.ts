import {N,t,tn} from './i18n';
import {RaceBrowser,RACE_PAGE,joinable,raceKey,type RaceFormField} from './race-browser';
import type {RaceChoice} from './race-reader';

export const RACE_TITLE=N('Race browser');
const REVERSE=N('Reverse'),RETURN_CAREER=N('Return to career'),RETURN_MENU=N('Return to main menu');
const FIELDS:ReadonlyArray<[RaceFormField,string]>=[['mode',N('Race type')],['track',N('Track')],['reverse',N('Direction')],
  ['laps',N('Laps')],['minPlayers',N('Minimum players')],['maxPlayers',N('Maximum players')],['collision',N('Collision')],['catchup',N('Catch-up')]];
export interface RaceViewRow {key:string;label:string;value?:string;disabled:boolean;field?:RaceFormField}
export interface RaceView {kind:'entry'|'list'|'detail'|'create'|'room';title:string;lines:string[];rows:RaceViewRow[];notice:string}
export const raceMode=(mode:number):string=>({0:t('circuit'),1:t('sprint'),2:t('drag'),3:t('drift'),4:t('URL race'),10:t('Street X')}[mode]??t('Race'));
/** Captions are UTF-8 decoded in the guest against its actual loaded language
 * table and font mapping. A missing label retains its unambiguous track ID. */
export function raceCaption(choice:RaceChoice|undefined,reverse:boolean,_gameLanguage:string,id:number):string {
  return (reverse?choice?.reverseName:choice?.name)||t('Track {id}',{id});
}
export function raceView(m:RaceBrowser,gameLanguage:string):RaceView {
  const s=m.snapshot,rows:RaceViewRow[]=[],lines:string[]=[],off=m.busy,o=m.options;
  let kind:RaceView['kind']='list',title=t(RACE_TITLE);
  const caption=(mode:number,track:number,reverse:boolean)=>raceCaption(s?.choices.find(c=>c.mode===mode&&c.track===track),reverse,gameLanguage,track);
  const add=(key:string,label:string,disabled=off,value?:string,field?:RaceFormField)=>rows.push({key,label,value,disabled,field});
  if(m.creating){
    kind='create';title=t('Create race');const choice=s?.choices.find(c=>c.mode===o.mode&&c.track===o.track);
    for(const [field,label] of FIELDS){
      const value=field==='mode'?raceMode(o.mode):field==='track'?caption(o.mode,o.track,o.reverse):field==='reverse'?t(o.reverse?REVERSE:'Forward'):
        typeof o[field]==='boolean'?t(o[field]?'On':'Off'):String(o[field]);
      const fixed=field==='reverse'&&!choice?.reverse||field==='laps'&&choice?.minLaps===choice?.maxLaps||field==='catchup'&&(o.mode===3||o.mode===10);
      add('field:'+field,t(label),off||fixed,value,field);
    }
    add('password',t('Lobby password'),off,'•'.repeat(m.passwordLength));add('create',t('Create race'));add('back',t('Cancel'),false);
  }else if(m.selected){
    kind='detail';const r=m.selected;title=r.name;
    lines.push(caption(r.mode,r.track,r.reverse),`${raceMode(r.mode)} · ${tn(r.laps,'{n} lap','{n} laps')} · ${t(r.reverse?REVERSE:'Forward')}`,
      `${t('Host')}: ${r.host}`,`${t('Players')}: ${r.players} / ${r.maxPlayers}`);
    if(!r.compatible)lines.push(t('This track or these rules are unavailable.'));
    else if(r.players>=r.maxPlayers)lines.push(t('The race is full'));
    if(r.systemFlags&0x10000)add('password',t('Lobby password'),off,'•'.repeat(m.passwordLength));
    add('join',t('Join'),off||!joinable(r));add('back',t('Back'),false);
  }else if(s?.source==='room'&&s.current){
    kind='room';const r=s.current;lines.push(caption(r.mode,r.track,r.reverse),`${raceMode(r.mode)} · ${tn(r.laps,'{n} lap','{n} laps')}`);
    lines.push(...s.players.map((p,i)=>`${p.name} · ${i===0?t('Host'):t(p.ready?'Ready':'Not ready')}`));
    add('ready',t(s.ready?'Not ready':'Ready'));add('start',t('Start the race'),off||!s.startable);add('leave',t('Leave'));add('back',t('Back'),false);
  }else if(s?.canEnter||s?.entryActive&&!['list','room'].includes(s.source)){
    kind='entry';
    if(s.canEnter){lines.push(m.profileName?`${t('Online profiles')}: ${m.profileName}`:t('Select an online profile first.'));add('enter',t('Enter race browser'),!m.canEnter);}
    add('back',t('Back'),false);
  }else{
    if(s?.source==='list'){
      if(!s.rows.length)lines.push(t('No races on this page.'));
      for(const r of s.rows)add('race:'+raceKey(r),caption(r.mode,r.track,r.reverse),off,`${r.host} · ${r.players}/${r.maxPlayers}`);
    }
    add('previous',t('Previous page'),off||m.page===0);add('next',t('Next page'),off||s?.rows.length!==RACE_PAGE||m.page>=4080);
    add('refresh',t('Refresh'));add('new',t('Create race'),!m.canCreate);add('back',t('Back'),false);
  }
  if(s?.entryActive&&!m.creating&&!m.selected){
    rows.splice(Math.max(0,rows.length-1),0,{key:'exit',label:t(s.fromCareer?RETURN_CAREER:RETURN_MENU),disabled:!m.canExit});
  }
  const notice=s?.entryFailed?t('The connection change could not be completed.'):s?.canEnter?m.busy?t('Working…'):m.entryNotice:off?t('Working…'):m.notice==='stale'?t('The race list changed. Choose again.'):
    m.notice==='invalid'?t('Check the race settings.'):m.notice==='unavailable'?t('The race is no longer available.'):
    m.notice==='failed'?t('The race did not take you'):m.notice==='busy'?t('Working…'):'';
  return {kind,title,lines,rows,notice};
}
/** A shared row action; password entry and closing the surface belong to its UI. */
export function raceActivate(m:RaceBrowser,key:string):'password'|'close'|null {
  if(key==='back'){if(m.creating||m.selected)m.cancel();else return 'close';return null;}
  if(key==='enter'){void m.enter();return null;}
  if(key==='exit'){m.exit();return null;}
  if(m.busy)return null;
  if(key.startsWith('race:'))m.select(key.slice(5));
  else if(key.startsWith('field:'))m.adjust(key.slice(6) as RaceFormField,1);
  else if(key==='password')return 'password';
  else if(key==='previous')m.search(m.page-RACE_PAGE);
  else if(key==='next')m.search(m.page+RACE_PAGE);
  else if(key==='refresh')m.search();else if(key==='new')m.beginCreate();
  else if(key==='create')m.create();else if(key==='join')m.join();
  else if(key==='ready')m.ready();else if(key==='start')m.start();else if(key==='leave')m.leave();
  return null;
}
