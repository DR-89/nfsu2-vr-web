import {t} from './i18n';
import {raceView,raceActivate,RACE_TITLE} from './race-view';
import type {GameSession} from './game';
import type {RaceBrowser} from './race-browser';

/** The monitor/touch surface of the same controller used by the headset.
 * The modal uses the page's normal keyboard/gamepad capture and focus rules. */
export class RacePanel {
  private launch:HTMLButtonElement;
  private dialog:HTMLDialogElement;
  private current:GameSession|null=null;
  private manager:RaceBrowser|null=null;
  private editing=false;
  private suspended=false;
  private signature='';
  private timer:ReturnType<typeof setInterval>;
  constructor(private root:HTMLElement,private session:()=>GameSession|null,private gameLanguage:()=>string){
    this.launch=document.createElement('button');this.launch.type='button';this.launch.className='btn race-open';this.launch.dataset.nfsu2Ui='';this.launch.hidden=true;
    this.dialog=document.createElement('dialog');this.dialog.className='dlg race-dlg';this.dialog.dataset.nfsu2Ui='';this.dialog.id='race-browser';
    this.launch.onclick=()=>this.show();this.dialog.addEventListener('close',()=>{this.clearEdit();if(!this.suspended)this.manager?.close();this.signature='';});
    this.dialog.addEventListener('cancel',e=>{if(this.editing||this.manager?.creating||this.manager?.selected){e.preventDefault();this.back();}});
    root.append(this.launch,this.dialog);this.timer=setInterval(()=>this.update(),100);
  }
  private clearEdit():void {this.editing=false;const input=this.dialog.querySelector('input');if(input)input.value='';}
  private back():void {
    if(this.editing){this.clearEdit();this.signature='';this.render();return;}
    if(this.manager&&raceActivate(this.manager,'back')!=='close'){this.signature='';this.render();}else this.dialog.close();
  }
  private show():void {
    const m=this.manager;if(!m)return;
    m.update();m.cancel();if(m.snapshot?.source==='list')m.search(0);
    this.current?.input?.releaseAll?.();this.signature='';this.dialog.showModal();this.render();
  }
  private update():void {
    const s=this.session();if(s!==this.current){
      this.suspended=false;if(this.dialog.open)this.dialog.close();this.current=s;this.manager=s?.raceBrowser??null;this.signature='';
    }
    const m=this.manager,snapshot=m?.snapshot;
    const driving=!!s?.status?.read()?.get('drive'),loading=!!s?.status?.read()?.get('loading');
    const available=!driving&&!loading&&!!s&&!s.ended&&!s.renderer?.vr?.active&&!snapshot?.originalDialog&&!!m?.available;
    this.launch.hidden=!available;this.launch.textContent=t(RACE_TITLE);
    // Searches/joins stay covered while waiting; original driving, text entry
    // and error dialogs regain control when their game context takes over.
    const ended=!s||s.ended||s.renderer?.vr?.active||s.status?.read()?.get('drive')||s.input?.textEntry?.()||snapshot?.source==='none'&&!m?.available;
    if(ended){this.suspended=false;if(this.dialog.open)this.dialog.close();}
    else if(snapshot?.originalDialog&&this.dialog.open){this.suspended=true;this.dialog.close();}
    else if(!snapshot?.originalDialog&&this.suspended){this.suspended=false;this.dialog.showModal();this.signature='';}
    if(this.dialog.open){
      if(this.editing&&(m?.busy||!m?.creating&&!m?.selected)){this.clearEdit();this.signature='';}
      if(!this.editing)this.render();
    }
  }
  private render():void {
    const m=this.manager;if(!m||!this.dialog.open)return;
    const view=raceView(m,this.gameLanguage()),signature=JSON.stringify([view,this.editing]);if(signature===this.signature)return;this.signature=signature;
    const focused=this.dialog.contains(document.activeElement)?(document.activeElement as HTMLElement).dataset.raceKey:undefined;
    const body=document.createElement('div'),title=document.createElement('h2');title.textContent=view.title;title.id='race-browser-title';this.dialog.setAttribute('aria-labelledby',title.id);body.append(title);
    const button=(label:string,key:string,fn:()=>void,disabled=false)=>{
      const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.dataset.raceKey=key;b.disabled=disabled;b.onclick=fn;return b;
    };
    if(this.editing){
      const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),actions=document.createElement('div');
      label.textContent=t('Lobby password');input.type='password';input.autocomplete='off';input.spellcheck=false;input.maxLength=m.creating?12:32;input.value=m.passwordInput;
      input.pattern='[A-Za-z0-9_\\-]*';input.setAttribute('aria-label',t('Lobby password'));input.dataset.raceKey='password-input';label.append(input);actions.className='row';
      const save=button(t('Save'),'password-save',()=>{if(input.reportValidity()&&m.setPassword(input.value)){this.clearEdit();this.signature='';this.render();}});
      form.onsubmit=e=>{e.preventDefault();save.click();};actions.append(save,button(t('Cancel'),'back',()=>this.back()));form.append(label,actions);body.append(form);
    }else{
      for(const line of view.lines){const p=document.createElement('p');p.className='hint';p.textContent=line;body.append(p);}
      const list=document.createElement('div');list.className='race-rows';
      for(const r of view.rows){
        const row=document.createElement('div');row.className=r.field?'race-row race-adjust':'race-row';
        const activate=()=>{
          if(r.disabled)return;const action=raceActivate(m,r.key);
          if(action==='close')this.dialog.close();else if(action==='password')this.editing=true;
          this.signature='';this.render();
        };
        const b=button(r.label+(r.value&&!r.field?' · '+r.value:''),r.key,activate,r.disabled);
        if(r.key==='back')b.dataset.act='back';
        if(r.field){
          const label=document.createElement('span');label.textContent=r.label;label.id='race-'+r.field;
          const minus=button('−',r.key+'-less',()=>{m.adjust(r.field!,-1);this.render();},r.disabled);
          const plus=button('+',r.key+'-more',()=>{m.adjust(r.field!,1);this.render();},r.disabled);
          minus.setAttribute('aria-label',t('Decrease {name}',{name:r.label}));plus.setAttribute('aria-label',t('Increase {name}',{name:r.label}));
          const value=document.createElement('output');value.textContent=r.value??'';value.setAttribute('aria-labelledby',label.id);
          row.append(label,minus,value,plus);
        }else row.append(b);
        list.append(row);
      }
      const notice=document.createElement('p');notice.className='hint';notice.setAttribute('role','status');notice.textContent=view.notice;body.append(list,notice);
    }
    this.dialog.replaceChildren(body);
    const choices=[...this.dialog.querySelectorAll<HTMLElement>('[data-race-key]')],restore=choices.find(e=>e.dataset.raceKey===focused);
    if(restore)restore.focus();else if(this.editing)this.dialog.querySelector('input')?.focus();else this.dialog.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }
  destroy():void{clearInterval(this.timer);if(this.dialog.open)this.dialog.close();this.launch.remove();this.dialog.remove();this.manager=null;this.current=null;}
}
