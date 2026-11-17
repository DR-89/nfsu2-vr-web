import {N} from './i18n';
import type {VRControl,VRField} from '../vr/settings-fields';

/** One set of choices for the website and the controller-operated Mods page. */
export const MOD_CONTROLS:Record<string,VRControl>={
  ui_textures:{t:'seg',opts:[['original',N('Original')],['map',N('Map only')],['hud',N('HUD only')],['uhud',N('Upscaled')]]},
  subtitles:{t:'switch'},
  songs:{t:'seg',opts:[['uncensored',N('Uncensored')],['original',N('Original')]]},
  gps_distance:{t:'switch'},show_hidden_races:{t:'switch'},visual_rep_remover:{t:'switch'},
  stance:{t:'switch'},crash_damage:{t:'switch'},
  catchup:{t:'seg',opts:[['original',N('Original')],['noboost',N('No boost')],['off',N('Off')]]},
  gearbox_whine:{t:'switch'},hq_vinyls:{t:'switch'},regional_cars:{t:'switch'},special_vinyls:{t:'switch'},
};
export const playerHeadlights:VRField={key:'player_headlights',label:N('Headlights'),help:'',
  c:{t:'select',opts:[['original',N('Original')],['off',N('Off')],['high',N('High beam')]]}};

export const onlineCarLimit:VRField={key:'roam_max_cars',label:N('Players\' cars shown'),
  help:N('How many of the nearest players\' cars free roam shows. More can lower the frame rate; Auto adds them only while it stays smooth.'),
  c:{t:'select',opts:[['auto',N('Auto')],...Array.from({length:65},(_,i)=>[String(i),String(i)] as [string,string])]}};
