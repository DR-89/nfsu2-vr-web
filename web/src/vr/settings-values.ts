import {checkSetting,keyDef} from '../app/settings';
import {mirrorFields,mirrorKey} from './mirror-profiles';
import {vrSettings,type VRSettings} from './settings';

function mergeChanged(target:object,base:object,next:object):void{
  const a=target as Record<string,unknown>,b=base as Record<string,unknown>,n=next as Record<string,unknown>;
  for(const key of new Set([...Object.keys(b),...Object.keys(n)])){
    if(!Object.hasOwn(n,key)){delete a[key];continue;}
    if(n[key]&&b[key]&&a[key]&&typeof n[key]==='object'&&typeof b[key]==='object'&&typeof a[key]==='object')mergeChanged(a[key] as object,b[key] as object,n[key] as object);
    else if(!Object.is(b[key],n[key]))a[key]=n[key];
  }
}
/** Apply just the website edit, without resetting live hand-adjusted values. */
export function syncVRSettings(s:VRSettings,before:Record<string,string>,after:Record<string,string>):void{
  mergeChanged(s,vrSettings(before),vrSettings(after));
}

/** Encode the live cabin, including placements changed by hand, through the
 * same settings.ini units as the website. Do not reconstruct from launch env. */
export function vrValues(s:VRSettings):Record<string,string>{
  const deg=(v:number)=>v*180/Math.PI;
  const values:Record<string,number|boolean>={
    avatars:s.avatars,share_pose:s.share,world_scale:s.scale*100,seat_height:s.height*100,seat_forward:s.forward*100,
    media_volume:s.volume*100,media_opacity:s.opacity*100,master_gain:s.masterGainDB,music_source:s.musicSource,leds:s.leds,led_color:s.ledColor,led_pulse:s.pulse,shift_lights:s.shiftLights,
    haptics:s.haptics,engine_rumble:s.engineRumble,grip_feedback:s.gripFeedback,shift_click:s.shiftClick,shift_sound:s.shiftSound,
    hand_controls:s.handControls,wheel_grip:s.wheelGrip,wheel_rotation:s.rotation,steering_sensitivity:s.sensitivity*100,steering_deadzone:s.steeringDeadzone*100,wheel_return:s.returnSpeed,
    shifter_mode:s.shift.mode,shift_guide:s.shiftGuide,shift_reverse:s.shift.reverse,shift_travel:s.shift.travel*1000,
    shift_gestures:s.shift.gestures,gesture_reverse:s.shift.gestureReverse,gesture_axis:s.shift.axis,shift_zone:s.shift.zone*100,
    gesture_travel:s.shift.gestureTravel*1000,gesture_angle:s.shift.angle,gesture_speed:s.shift.speed*100,
    screen_page:s.page,screen_movable:s.movable,screen_size:s.screenScale*100,screen_x:s.screenX*100,screen_y:s.screenY*100,screen_z:s.screenZ*100,
    screen_pitch:deg(s.pitch),screen_yaw:deg(s.yaw),map_x:s.mapX*100,map_y:s.mapY*100,map_z:s.mapZ*100,map_pitch:deg(s.mapPitch),map_yaw:deg(s.mapYaw),
    mirror_resolution:s.mirrorResolution,
  };
  const out=Object.fromEntries(Object.entries(values).map(([key,v])=>['vr_'+key,typeof v==='boolean'?(v?'on':'off'):String(keyDef('vr_'+key)?.kind==='int'?Math.round(v):Number(v.toFixed(5)))]));
  for(const [model,angles]of Object.entries({DEFAULT:s.mirrors,...s.mirrorCars})){
    const v=[angles.inside.yaw,angles.inside.pitch,angles.outside.yaw,angles.outside.pitch];
    mirrorFields.forEach((field,i)=>out[mirrorKey(model,field)]=String(Number(deg(v[i]).toFixed(5))));
  }
  return out;
}

export function applyVRValues(s:VRSettings,patch:Record<string,string>):Record<string,string>{
  const values=vrValues(s),accepted:Record<string,string>={},env:Record<string,string>={};
  for(const [key,value]of Object.entries(values)){const check=checkSetting(key,value);if(check?.ok)env[check.env]=check.value;}
  const before=vrSettings(env);
  for(const [key,value]of Object.entries(patch)){
    if(!key.startsWith('vr_')||!keyDef(key)||key==='vr_cockpit'||key==='vr_mirror_vehicle')continue;
    const check=checkSetting(key,value);if(!check?.ok)continue;
    const kind=keyDef(key)!.kind,normalized=kind==='bool'?(check.value==='1'?'on':'off'):kind==='num'||kind==='int'?String(Number(check.value)):check.value;
    if(values[key]!==normalized){values[key]=normalized;accepted[key]=normalized;}
  }
  if(!Object.keys(accepted).length)return accepted;
  for(const [key,value]of Object.entries(values)){const check=checkSetting(key,value);if(check?.ok)env[check.env]=check.value;}
  // Unrelated hand placements keep their sub-centimetre/sub-degree precision;
  // changing one menu value must not quantize every live cockpit property.
  mergeChanged(s,before,vrSettings(env));return accepted;
}
