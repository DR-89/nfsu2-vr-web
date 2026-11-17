import type { Mat4 } from './math';
import type { ShiftConfig } from './shifter';
import { mirrorStops,type MirrorSettings } from './mirrors';
import { mirrorFields,mirrorModels,mirrorKey } from './mirror-profiles';
export interface VRSettings {
  renderScale: number;
  avatars: boolean; share: boolean; scale: number; height: number; forward: number; volume: number; opacity: number; masterGainDB:number; musicSource:number;
  leds: boolean; ledColor: number; pulse: boolean; shiftLights: boolean; haptics: boolean;
  page: number; movable: boolean; screenScale: number; screenX: number; screenY: number; screenZ: number; pitch: number; yaw: number;
  mapX:number; mapY:number; mapZ:number; mapPitch:number; mapYaw:number;
  mirrors:MirrorSettings; mirrorCars:Record<string,MirrorSettings>; mirrorResolution:number;
  handControls: boolean; wheelGrip: boolean; rotation: number; sensitivity: number; steeringDeadzone: number; returnSpeed: number;
  shift: ShiftConfig; shiftGuide: number; engineRumble: boolean; gripFeedback: boolean; shiftClick: boolean; shiftSound: boolean;
}
export function vrSettings(env: Record<string, string>): VRSettings {
  const number = (key: string, fallback: number, lo: number, hi: number) => {
    const v = env[key] === undefined ? fallback : Number(env[key]); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  };
  const angle=(key:string,limit:number,fallback=0)=>number(key,fallback*180/Math.PI,-limit*180/Math.PI,limit*180/Math.PI)*Math.PI/180;
  const mirrors:MirrorSettings={inside:{yaw:angle('NFSU2_VR_MIRROR_INSIDE_YAW',mirrorStops.yaw),pitch:angle('NFSU2_VR_MIRROR_INSIDE_PITCH',mirrorStops.pitch)},
    outside:{yaw:angle('NFSU2_VR_MIRROR_OUTSIDE_YAW',mirrorStops.yaw),pitch:angle('NFSU2_VR_MIRROR_OUTSIDE_PITCH',mirrorStops.pitch)}};
  const mirrorCars:Record<string,MirrorSettings>={};
  for(const model of mirrorModels.filter(m=>m!=='DEFAULT')){
    const keys=mirrorFields.map(f=>'NFSU2_'+mirrorKey(model,f).toUpperCase());
    if(keys.some(k=>env[k]!==undefined))mirrorCars[model]={inside:{yaw:angle(keys[0],mirrorStops.yaw,mirrors.inside.yaw),pitch:angle(keys[1],mirrorStops.pitch,mirrors.inside.pitch)},
      outside:{yaw:angle(keys[2],mirrorStops.yaw,mirrors.outside.yaw),pitch:angle(keys[3],mirrorStops.pitch,mirrors.outside.pitch)}};
  }
  const resolution=Number(env.NFSU2_VR_MIRROR_RESOLUTION??1024);
  const renderScale=Number(env.NFSU2_VR_RENDER_SCALE??100);
  return { avatars: env.NFSU2_VR_AVATARS !== '0', share: env.NFSU2_VR_SHARE_POSE !== '0',
    renderScale:[50,75,100,125,150,200].includes(renderScale)?renderScale/100:1,
    handControls: env.NFSU2_VR_HAND_CONTROLS !== '0', wheelGrip: env.NFSU2_VR_WHEEL_GRIP === '1', rotation: number('NFSU2_VR_WHEEL_ROTATION', 360, 180, 1080),
    sensitivity: number('NFSU2_VR_STEERING_SENSITIVITY', 100, 50, 300)/100,
    steeringDeadzone: number('NFSU2_VR_STEERING_DEADZONE', 0, 0, 50)/100, returnSpeed: number('NFSU2_VR_WHEEL_RETURN', 240, 0, 540),
    shiftGuide: Math.round(number('NFSU2_VR_SHIFT_GUIDE',1,0,2)),
    shift: { mode: Math.round(number('NFSU2_VR_SHIFTER_MODE',0,0,1)), reverse: env.NFSU2_VR_SHIFT_REVERSE==='1',
      gestures: Math.round(number('NFSU2_VR_SHIFT_GESTURES',0,0,2)), gestureReverse: env.NFSU2_VR_GESTURE_REVERSE!=='0',
      axis: Math.round(number('NFSU2_VR_GESTURE_AXIS',0,0,1)), travel: number('NFSU2_VR_SHIFT_TRAVEL',45,20,100)/1000,
      zone: number('NFSU2_VR_SHIFT_ZONE',10,10,30)/100, gestureTravel: number('NFSU2_VR_GESTURE_TRAVEL',45,20,120)/1000,
      angle: number('NFSU2_VR_GESTURE_ANGLE',20,10,60), speed: number('NFSU2_VR_GESTURE_SPEED',35,10,150)/100 },
    scale: number('NFSU2_VR_WORLD_SCALE', 100, 50, 150)/100,
    mirrorResolution:[256,512,1024,2048,4096].includes(resolution)?resolution:1024,
    mirrors,mirrorCars,
    height: number('NFSU2_VR_SEAT_HEIGHT', 0, -35, 35)/100, forward: number('NFSU2_VR_SEAT_FORWARD', 0, -40, 40)/100,
    volume: number('NFSU2_VR_MEDIA_VOLUME', 70, 0, 100)/100, opacity: number('NFSU2_VR_MEDIA_OPACITY', 100, 10, 100)/100,
    masterGainDB:Math.round(number('NFSU2_VR_MASTER_GAIN',0,-12,12)),
    musicSource:Math.round(number('NFSU2_VR_MUSIC_SOURCE',0,0,2)),
    leds: env.NFSU2_VR_LEDS !== '0', ledColor: Math.round(number('NFSU2_VR_LED_COLOR', 0, 0, 7)), pulse: env.NFSU2_VR_LED_PULSE !== '0',
    shiftLights: env.NFSU2_VR_SHIFT_LIGHTS === '1', haptics: env.NFSU2_VR_HAPTICS !== '0',
    engineRumble: env.NFSU2_VR_ENGINE_RUMBLE !== '0', gripFeedback: env.NFSU2_VR_GRIP_FEEDBACK === '1',
    shiftClick: env.NFSU2_VR_SHIFT_CLICK !== '0', shiftSound: env.NFSU2_VR_SHIFT_SOUND === '1',
    page: Math.round(number('NFSU2_VR_SCREEN_PAGE', 0, 0, 1)), movable: env.NFSU2_VR_SCREEN_MOVABLE === '1',
    screenScale: number('NFSU2_VR_SCREEN_SIZE', 100, 50, 300)/100,
    screenX: number('NFSU2_VR_SCREEN_X', 0, -200, 200)/100, screenY: number('NFSU2_VR_SCREEN_Y', 0, -200, 200)/100, screenZ: number('NFSU2_VR_SCREEN_Z', 0, -200, 200)/100,
    pitch: number('NFSU2_VR_SCREEN_PITCH', 0, -60, 60)*Math.PI/180, yaw: number('NFSU2_VR_SCREEN_YAW', 0, -60, 60)*Math.PI/180,
    mapX:number('NFSU2_VR_MAP_X',0,-200,200)/100,mapY:number('NFSU2_VR_MAP_Y',0,-200,200)/100,mapZ:number('NFSU2_VR_MAP_Z',0,-200,200)/100,
    mapPitch:number('NFSU2_VR_MAP_PITCH',0,-45,45)*Math.PI/180,mapYaw:number('NFSU2_VR_MAP_YAW',0,-45,45)*Math.PI/180 };
}
export function adjustedPose(matrix: ArrayLike<number>, s: VRSettings): Mat4 {
  const out = new Float32Array(matrix); out[12] /= s.scale; out[13] = out[13]/s.scale + s.height; out[14] = out[14]/s.scale - s.forward; return out;
}
