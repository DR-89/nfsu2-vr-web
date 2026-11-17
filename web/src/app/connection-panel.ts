import {t} from './i18n';
import {CONNECTION_LABELS as L,type ConnectionManager} from './connection-manager';

export class ConnectionPanel{
  private confirm=false;
  constructor(private root:HTMLElement,private manager:ConnectionManager,private readOnly:()=>boolean){manager.onChange(()=>this.render());this.render();}
  render():void{
    const c=this.manager.current,p=c?.profiles.find(p=>p.id===c.selected),off=this.manager.busy||this.readOnly();
    const box=document.createElement('div');box.className='group';const h=document.createElement('h3');h.textContent=t(L.title);box.append(h);
    const hint=document.createElement('p');hint.className='set-help';hint.textContent=t('Connection profiles keep names and worlds. Your career and cloud sign-in stay unchanged.');box.append(hint);
    const row=(label:string,id:string,control:HTMLElement)=>{const r=document.createElement('div');r.className='set';const l=document.createElement('label');l.className='set-label';l.htmlFor=id;l.textContent=label;const ctl=document.createElement('div');ctl.className='set-control';control.id=id;ctl.append(control);r.append(l,ctl);box.append(r);return ctl;};
    const button=(label:string,fn:()=>void,disabled=off)=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.disabled=disabled;b.onclick=fn;return b;};
    const pick=document.createElement('select');for(const profile of c?.profiles??[])pick.add(new Option(profile.name+(this.manager.linked.has(profile.id)?' ✓':''),profile.id));pick.value=c?.selected??'';pick.disabled=off||!p;pick.onchange=()=>{this.confirm=false;void this.manager.edit({action:'select',id:pick.value});};row(t(L.title),'connection-selected',pick);
    const create=document.createElement('input');create.type='text';create.maxLength=15;create.autocomplete='off';create.disabled=off||!c||c.profiles.length>=8;
    row(t(L.create),'connection-create',create).append(button(t(L.create),()=>void this.manager.edit({action:'create',name:create.value}),create.disabled));
    if(p){
      const name=document.createElement('input');name.type='text';name.maxLength=15;name.value=p.name;name.disabled=off;
      row(t(L.rename),'connection-name',name).append(button(t('Save'),()=>void this.manager.edit({action:'rename',id:p.id,text:name.value})));
      const world=document.createElement('input');world.type='text';world.value=p.room;world.maxLength=63;world.disabled=off;
      row(t(L.room),'connection-room',world).append(button(t('Save'),()=>void this.manager.edit({action:'room',id:p.id,text:world.value})));
      const password=document.createElement('input');password.type='password';password.autocomplete='off';password.maxLength=512;password.disabled=off;
      row(t(L.auth),'connection-auth',password).append(button(t('Save'),()=>{const phrase=password.value;password.value='';void this.manager.link(p.id,phrase);}));
      const help=document.createElement('p');help.className='set-help';help.textContent=t('Sign-in stays on this device. An empty passphrase removes it.');box.append(help);
      const actions=document.createElement('div');actions.className='row';actions.append(button(t(L.connect),()=>void this.manager.connect()),button(t(L.disconnect),()=>void this.manager.disconnect()),button(t(L.manage),()=>void this.manager.manage()),button(t(L.remove),()=>{this.confirm=true;this.render();}));box.append(actions);
      if(this.confirm){const r=document.createElement('p');r.className='set-help';r.textContent=t('Delete this connection profile? Your career is kept.');r.append(' ',button(t('Delete'),()=>{this.confirm=false;void this.manager.edit({action:'delete',id:p.id});}),' ',button(t('Cancel'),()=>{this.confirm=false;this.render();}));box.append(r);}
    }
    const notice=document.createElement('p');notice.className='set-help';notice.setAttribute('role','status');notice.textContent=this.manager.busy?'…':this.manager.notice;box.append(notice);this.root.replaceChildren(box);
  }
}
