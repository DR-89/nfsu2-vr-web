import { t } from '../app/i18n';
import { ImmersiveSession } from './session';

/** In-game entry points remain ordinary DOM controls, so the same game can be
 * started on a monitor and entered/exited in VR without a second connection. */
export class VRPanel {
  private root = document.createElement('div');
  private enter = document.createElement('button');
  private center = document.createElement('button');
  private status = document.createElement('span');
  private timer: ReturnType<typeof setInterval>;
  private disposed = false;
  private available = false;
  private check = () => { void ImmersiveSession.supported().then(supported => {
    if (this.disposed) return;
    this.available = supported; this.refresh();
  }); };
  failure(error: unknown): void {
    this.log(`[vr] ${error}`);
    if (!this.disposed) { this.status.textContent = t('VR could not start. Check your headset and browser.'); this.refresh(); }
  }
  constructor(stage: HTMLElement, private vr: ImmersiveSession, private log: (s: string) => void) {
    this.root.className = 'vr-controls'; this.root.dataset.nfsu2Ui = ''; this.root.hidden = true;
    this.enter.type = this.center.type = 'button';
    this.enter.textContent = t('Enter VR'); this.enter.disabled = true;
    this.center.textContent = t('Recenter view'); this.center.hidden = true;
    this.status.setAttribute('role', 'status');
    this.root.append(this.enter, this.center, this.status); stage.append(this.root);
    this.enter.addEventListener('click', () => {
      this.status.textContent = ''; this.enter.disabled = true;
      const operation = vr.active ? vr.exit() : vr.enter();
      void operation.catch(error => this.failure(error))
        .finally(() => { if (!this.disposed) this.refresh(); });
    });
    this.center.addEventListener('click', () => vr.recenter());
    this.check(); navigator.xr?.addEventListener('devicechange', this.check);
    this.timer = setInterval(() => this.refresh(), 500);
  }
  private refresh(): void {
    this.root.hidden = !this.available && !this.vr.active && !this.status.textContent;
    this.enter.hidden = !this.available && !this.vr.active;
    this.enter.textContent = this.vr.active ? t('Leave VR') : t('Enter VR');
    this.center.hidden = !this.vr.active;
    if (!this.enter.hidden) this.enter.disabled = false;
  }
  detach(): void { this.disposed = true; clearInterval(this.timer); navigator.xr?.removeEventListener('devicechange', this.check); this.root.remove(); }
}
