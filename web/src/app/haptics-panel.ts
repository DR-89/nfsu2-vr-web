import {t,onLanguage} from './i18n';
import type {HapticsConnectionState} from '../vr/native-haptics';

interface HapticsPanelDeps {
  status:()=> 'off'|HapticsConnectionState;
  enable:(enabled:boolean)=>void;
}
/** Setup lives beside the VR start button, with no network probe before opt-in. */
export class HapticsPanel {
  constructor(private root:HTMLElement,private deps:HapticsPanelDeps){
    root.querySelector<HTMLButtonElement>('[data-haptics-connect]')!.onclick=()=>{deps.enable(true);this.render();};
    root.querySelector<HTMLButtonElement>('[data-haptics-disconnect]')!.onclick=()=>{deps.enable(false);this.render();};
    onLanguage(()=>this.render());
    // The panel lives as long as the start page. Hidden tabs do not poll.
    window.setInterval(()=>{if(!document.hidden)this.render();},1000);
    this.render();
  }
  private render():void {
    const state=this.deps.status();
    const text=state==='off'?t('Connect after installing the Windows helper.'):
      state==='checking'?t('Checking the vibration connection…'):
      state==='unavailable'?t('No connection. Check the installation and allow local connections in your browser’s site settings.'):
      state==='update'?t('Update the Windows helper using the download below, then restart Chrome or Edge completely.'):
      state==='restart'?t('The helper is running, but vibration is not loaded in the browser. Exit Chrome or Edge completely, including background processes, then reopen this website.'):
      state==='ready'?t('VR vibration connection ready. You can test it in the car.'):
      t('Helper connected. Start VR to connect the controllers. Restart the browser completely after installation.');
    const status=this.root.querySelector<HTMLElement>('[data-haptics-status]')!;
    if(status.textContent!==text)status.textContent=text;
    this.root.querySelector<HTMLButtonElement>('[data-haptics-disconnect]')!.hidden=state==='off';
  }
}
