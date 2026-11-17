/* Head tracking is applied before the game's projection and culling setup.
 * The driving camera stays valid through Present, including car-part culling.
 * Stereo replays the recorded draws with each eye's projection in WebGPU. */
#include "vr_web.h"
#include "host_abi.h"
#include "guest.h"
#include "game.h"
#include "splitscreen_mem.h"
#include "splitscreen_layout.h"
#include "setting.h"
#include "vr_seats.h"
#include "vr_feedback.h"
#include "vr_replay.h"
#include "vr_rear.h"
#include "vr_mirror_mesh.h"
#include "gpsdistance.h"
#include "stance.h"
#include <math.h>
#include <string.h>
#include <stdio.h>

static VrMailbox box = { .magic = VR_MAGIC, .version = VR_VERSION };
static VrMailbox input;
static uint32_t settings_revision;
static uint32_t stance_revision;
static uint32_t cars_revision;
static void car_limit_settings(void){
    if(!input.cars_revision || input.cars_revision==cars_revision || input.cars_limit < -1 || input.cars_limit > 64)return;
    void roam_game_set_car_limit(int limit);
    roam_game_set_car_limit(input.cars_limit);cars_revision=input.cars_revision;
}
static void stance_settings(void){
    if(!input.stance_revision||input.stance_revision==stance_revision||input.stance_enabled>1u||
       !memchr(input.stance_models,0,sizeof input.stance_models))return;
    if(stance_configure(input.stance_models,(int)input.stance_enabled))stance_revision=input.stance_revision;
}
static int settings_lights=-1,settings_gps=-1,settings_special=-1,settings_whine=-1;
/* Profile controls are independent of tracking. Reject a malformed complete
 * command before changing either feature; never renew a pose or gear lease. */
static void game_settings(void){
    if(!input.settings_revision || input.settings_revision==settings_revision ||
       (input.settings_mask!=3u && input.settings_mask!=15u) || input.headlights>2u || input.gps>1u ||
       (input.settings_mask==15u && (input.special_vinyls>1u || input.gearbox_whine>1u)))return;
    settings_revision=input.settings_revision;
    void lightkey_set_mode(int mode);
    void gpsdistance_set_enabled(int enabled);
    void vinylcat_set_enabled(int enabled);
    void whine_set_enabled(int enabled);
    if(settings_lights!=(int)input.headlights){settings_lights=(int)input.headlights;lightkey_set_mode(settings_lights);}
    if(settings_gps!=(int)input.gps){settings_gps=(int)input.gps;gpsdistance_set_enabled(settings_gps);}
    if(input.settings_mask==15u){
        if(settings_special!=(int)input.special_vinyls){settings_special=(int)input.special_vinyls;vinylcat_set_enabled(settings_special);}
        if(settings_whine!=(int)input.gearbox_whine){settings_whine=(int)input.gearbox_whine;whine_set_enabled(settings_whine);}
    }
    fprintf(stderr,"[vr] game settings: headlights=%d gps=%d special=%d whine=%d\n",settings_lights,settings_gps,settings_special,settings_whine);
}
static VrFrame frame;
static int registered;
static int desktop_cockpit = -1;
static int cockpit_selected = 1;
static uint32_t cockpit_session;
static int saved_kind;
static unsigned ui_depth;
static int hud_active;
void ws_cockpit_hud(int active);
void vr_web_ui_begin(void){ ws_cockpit_hud(hud_active); ui_depth++; }
void vr_web_ui_end(void){ if (ui_depth) ui_depth--; }
int vr_web_ui_active(void){ return hud_active && ui_depth; }
static uint32_t saved_cam;
static uint32_t saved_excluded;
static float body_clip[16];
static uint32_t windows[7];
static int body_ready;
static unsigned body_frames;
static uint32_t gearbox_car, gearbox_driver, gearbox_flags, gearbox_epoch;
static int gearbox_tracking;
static double gearbox_at;
static VrReplay replay;
static int driver_raw_pedals;
static struct {
    uint32_t owner, epoch, cameras, timeline;
    unsigned slot;
    int selected, previous;
} replay_view;
static VrRoad road;
static uint32_t road_car;
static VrRearOwner rear_owned;
static uint32_t mirror_car;
static unsigned mirror_seen[3];
static uint32_t rear_saved_cam;
static uint32_t rear_plat;
static uint8_t rear_saved[CAM_VIEW_BYTES],rear_made[CAM_VIEW_BYTES];
static struct { uint32_t view; float saved,made; } lod_views[2];
/* Cache both accepted glass and negative batches. Original geometry is
 * immutable, while shader transforms and vertex-buffer offsets can change. */
void vr_web_mirror_mesh(const float (*positions)[3],uint32_t count){
    if(!saved_cam || !body_ready || !count || count>1536 || count%3)return;
    uint64_t hash=1469598103934665603ull;
    for(uint32_t i=0;i<count;i++)for(unsigned k=0;k<3;k++){
        if(!isfinite(positions[i][k]) || fabsf(positions[i][k])>20.f)return;
        uint32_t bits;memcpy(&bits,&positions[i][k],4);hash=(hash^bits)*1099511628211ull;
    }
    static struct { uint64_t key;uint32_t count[3];float glass[3][VR_MIRROR_VERTICES][3]; } cache[128];
    unsigned slot=(unsigned)(hash^(hash>>32))&127u;
    if(cache[slot].key!=hash){
        cache[slot].key=hash;uint32_t ix[1536];VrMirrorVertex out[VR_MIRROR_VERTICES];
        for(uint32_t i=0;i<count;i++)ix[i]=i;
        for(int part=0;part<3;part++){
            uint32_t n=vr_mirror_mesh(out,VR_MIRROR_VERTICES,positions,count,ix,count,(float[3]){0},part);
            cache[slot].count[part]=n;
            for(uint32_t i=0;i<n;i++)memcpy(cache[slot].glass[part][i],out[i].position,12);
        }
    }
    for(int part=0;part<3;part++)if(!mirror_seen[part] && cache[slot].count[part]){
        mirror_seen[part]=1;
        frame.mirrors.count[part]=cache[slot].count[part];
        memcpy(frame.mirrors.glass[part],cache[slot].glass[part],cache[slot].count[part]*12u);
    }
}
uint32_t look_driving_car(void);
/* Grid ownership lasts until first engages after GO. Pause retains the
 * selection; tracking/control opt-out yields for the remainder of this start. */
static struct { uint32_t car,race,stage,gear,disabled_car,disabled_race; } grid;
int vr_web_trace_body(void){
    const char *script = ENVC("NFSU2_INPUT_SCRIPT"), *trace = ENVC("NFSU2_TEST_VR_BODY_TRACE");
    return script && *script && trace && *trace == '1' && body_frames == 120;
}
static uint8_t saved_camera[CAM_VIEW_BYTES], made_camera[CAM_VIEW_BYTES];
static struct { int active; uint32_t saved; } light_streaks;
void vr_web_frame_end(void){
    if(light_streaks.active){
        if(!MR32(G_LIGHT_STREAKS))MR32(G_LIGHT_STREAKS)=light_streaks.saved;
        light_streaks.active=0;
    }
    for(unsigned i=0;i<2;i++){
        uint32_t v=lod_views[i].view;
        if(v && guest_ok(v,EVIEW_LOD_SCALE+3u) && MRF32(v+EVIEW_LOD_SCALE)==lod_views[i].made)
            MRF32(v+EVIEW_LOD_SCALE)=lod_views[i].saved;
        lod_views[i].view=0;
    }
    if(rear_saved_cam && guest_ok(rear_saved_cam,CAM_EXCLUDED_CAR+3u) && !memcmp(g_mem+rear_saved_cam,rear_made,CAM_VIEW_BYTES)){
        memcpy(g_mem+rear_saved_cam,rear_saved,CAM_VIEW_BYTES);
    }
    rear_saved_cam=0;
    rear_plat=0;
    if (saved_cam && guest_ok(saved_cam, CAM_EXCLUDED_CAR + 4u) && !memcmp(g_mem + saved_cam, made_camera, CAM_VIEW_BYTES)) {
        memcpy(g_mem + saved_cam, saved_camera, CAM_VIEW_BYTES);
        if (!MR32(saved_cam + CAM_EXCLUDED_CAR)) MR32(saved_cam + CAM_EXCLUDED_CAR) = saved_excluded;
    }
    saved_cam = 0;
    saved_kind = 0;
    body_ready = 0;
}

int vr_web_car(uint32_t car, VrCar *out){
    if (!guest_ok(car, CAR_RPM + 4)) return 0;
    uint32_t type = guest_rd32(car + CAR_TYPEINFO);
    if (!guest_ok(type, 16)) return 0;
    memset(out, 0, sizeof *out);
    guest_read_str(type, out->model, sizeof out->model);
    for (int r = 0; r < 3; r++) {
        for (int k = 0; k < 3; k++) out->transform[r*4+k] = MRF32(car + CAR_FLU + r*16u + k*4u);
        out->transform[12+r] = MRF32(car + CAR_BODY_ORIGIN + r*4u);
    }
    out->transform[15] = 1;
    for (int r = 0; r < 3; r++) {
        float norm = 0;
        for (int k = 0; k < 3; k++) norm += out->transform[r*4+k] * out->transform[r*4+k];
        if (!isfinite(norm) || norm < .8f || norm > 1.2f) return 0;
    }
    uint32_t ctl = guest_rd32(car + CAR_INPUT);
    if (guest_ok(ctl, INPUT_STEER + 2)) out->steer = (float)(int16_t)MR16(ctl + INPUT_STEER) / 32767.f;
    for (int i = 0; i < 16; i++) if (!isfinite(out->transform[i])) return 0;
    return 1;
}
static uint32_t local_car(void){
    if (MR32(G_FLOW) != 6u) return 0;
    uint32_t player = guest_rd32(SPLIT_PLAYERS_INDEX);
    return guest_ok(player, 8) ? guest_rd32(player + 4u) : 0;
}
static uint32_t race_stage(void){
    uint32_t race=guest_rd32(G_RACE);
    return guest_ok(race,4)?guest_rd32(race):0;
}
static int tracking_live(void){
    double age=nfsu2_now_ms()-input.at_ms;
    return input.active && isfinite(age) && age>=0 && age<300;
}
/* Insert the fitted cockpit at the wrap of the PC's five drive views. The
 * profile always contains a valid retail view; the extra selection is local
 * to this run. Options previews and player two cannot change this choice. */
int vr_web_cycle(uint32_t settings, int direction, unsigned last){
    if(desktop_cockpit<0)desktop_cockpit=setting_bool("NFSU2_VR_COCKPIT",0);
    if(settings!=G_PSETTINGS || !guest_ok(settings,PS_VIEW+4u) || last!=4u ||
       (direction!=1 && direction!=-1) || (!tracking_live() && !desktop_cockpit) || !look_driving_car())return 0;
    uint32_t slot=MR32(settings+PS_VIEW);
    if(slot>last)return 0;
    if(cockpit_selected){
        cockpit_selected=0;MR32(settings+PS_VIEW)=direction>0?0:last;
        return 1;
    }
    if((direction>0 && slot==last) || (direction<0 && slot==0)){
        cockpit_selected=1;return 1;
    }
    return 0;
}
/* Pad events can arrive after the render frame sampled the head pose. Read
 * command ownership again at the driver tick, so an old held detent cannot
 * overwrite the original gearbox's newly received shift-button edge. */
static uint32_t current_command(void){
    uint32_t seq=atomic_load_explicit(&box.seq,memory_order_acquire);
    if(!(seq&1u)) {
        VrMailbox latest;memcpy(&latest,&box,sizeof latest);
        if(seq==atomic_load_explicit(&box.seq,memory_order_acquire)) {
            double age=nfsu2_now_ms()-latest.at_ms;
            return latest.active && isfinite(age) && age>=0 && age<300?latest.command:0;
        }
    }
    return tracking_live()?input.command:0;
}
void vr_web_rumble(float low,float high){
    uint32_t car=local_car();
    if(!tracking_live() || !car || look_driving_car()!=car || !(MRF32(G_WORLDDT)>0)) {
        road=(VrRoad){0};road_car=0;return;
    }
    if(road_car!=car){road=(VrRoad){0};road_car=car;}
    vr_road_report(&road,nfsu2_now_ms(),low,high);
}
static uint32_t human_driver(uint32_t car){
    uint32_t driver=guest_ok(car,CAR_RPM+4u)?guest_rd32(car+CAR_INPUT):0;
    return guest_ok(driver,DRIVER_AUTO_REVERSE+1u) && guest_rd32(driver)==HUMAN_DRIVER_VT &&
        guest_rd32(driver+DRIVER_CAR)==car?driver:0;
}
static uint32_t replay_manager(void){
    uint32_t manager=guest_rd32(G_REPLAY);
    return guest_ok(manager,REPLAY_STREAM+3u)?manager:0;
}
static int replay_open(void){
    uint32_t owner=guest_rd32(G_REPLAY_UI);
    return guest_ok(owner,0xd4u) && guest_rd32(owner)==REPLAY_UI_VT;
}
static int replay_context(uint32_t player){
    uint32_t director=guest_rd32(G_RACESTATUS),owner=guest_rd32(G_REPLAY_UI);
    return replay_open() && !MR8(owner+REPLAY_UI_LEAVING) && MR32(G_FLOW)==6u &&
        guest_rd32(director)==5u && player && player==guest_rd32(SPLIT_PLAYERS_ORDER) && guest_ok(player,0x24fu);
}
void vr_web_replay_end(uint32_t owner){
    if(!owner || owner!=replay_view.owner)return;
    if(replay_view.selected)cockpit_selected=replay_view.previous;
    replay_view.selected=0;replay_view.owner=0;
    atomic_store_explicit(&box.replay_epoch,0,memory_order_release);
}
static void replay_sync(void){
    /* Seeking temporarily leaves director state 5 and displays PC_Loading.
     * Only the viewer's actual lifetime owns the choice and input epoch. */
    uint32_t owner=replay_open()?guest_rd32(G_REPLAY_UI):0;
    if(owner && MR8(owner+REPLAY_UI_LEAVING))owner=0;
    if(owner==replay_view.owner)return;
    vr_web_replay_end(replay_view.owner);
    replay_view.owner=owner;
    if(owner){
        if(!++replay_view.epoch)++replay_view.epoch;
        atomic_store_explicit(&box.replay_epoch,replay_view.epoch,memory_order_release);
    }
}
static uint32_t replay_mover(uint32_t player){
    uint32_t mover=guest_rd32(player+PLAYER_MAIN_MOVER),vt=guest_rd32(mover);
    return guest_ok(mover,MOVER_CAR+3u) && vt==DRIVE_MOVER_VT && guest_rd32(mover+MOVER_KIND)==1u &&
        guest_rd32(mover+MOVER_CAMERA)==guest_rd32(G_VIEW1+EVIEW_CAMERA) && guest_ok(vt,MOVER_GET_MODE+3u)?mover:0;
}
static void replay_apply(CPU *c,uint32_t player,int reset){
    unsigned slot=replay_view.slot==5?3:replay_view.slot+1;
    cockpit_selected=replay_view.slot==5;MR32(player+PLAYER_REPLAY_VIEW)=slot;
    uint32_t mover=replay_mover(player);
    if(reset || !mover){
        if(!guest_ok(guest_rd32(player+4u),CAR_RPM+3u))return;
        gcall(c,FN_REPLAY_CAMERA,player,1,(uint32_t[]){1});mover=replay_mover(player);
    }
    if(!mover)return;
    uint32_t vt=guest_rd32(mover),mode=guest_rd32(G_REPLAY_VIEWS+slot*4u);
    if(gcall(c,guest_rd32(vt+MOVER_GET_MODE),mover,0,NULL)!=mode)
        gcall(c,guest_rd32(vt+MOVER_SET_MODE),mover,1,&mode);
}
int vr_web_replay_cycle(CPU *c,uint32_t player){
    if(desktop_cockpit<0)desktop_cockpit=setting_bool("NFSU2_VR_COCKPIT",0);
    if(!c || (!desktop_cockpit && !tracking_live()) || !replay_context(player))return 0;
    replay_sync();
    if(!replay_view.selected){
        replay_view.previous=cockpit_selected;replay_view.slot=4;
        uint32_t mover=replay_mover(player);
        if(mover){
            uint32_t mode=gcall(c,guest_rd32(guest_rd32(mover)+MOVER_GET_MODE),mover,0,NULL);
            for(unsigned i=0;i<5;i++)if(guest_rd32(G_REPLAY_VIEWS+(i+1)*4u)==mode){replay_view.slot=i;break;}
        }
        replay_view.selected=1;
    }
    replay_view.slot=(replay_view.slot+1)%6;
    replay_apply(c,player,1);
    return 1;
}
int vr_web_replay_update(CPU *c,uint32_t player){
    if(!c || !replay_view.selected || replay_view.owner!=guest_rd32(G_REPLAY_UI) || !replay_context(player))return 0;
    replay_apply(c,player,0);return 1;
}
static void replay_commands(CPU *c){
    replay_sync();
    uint32_t cameras=input.replay_cameras-replay_view.cameras,timeline=input.replay_timeline-replay_view.timeline;
    replay_view.cameras=input.replay_cameras;replay_view.timeline=input.replay_timeline;
    if(!c || !tracking_live() || !replay_view.owner || input.replay_owner!=replay_view.epoch ||
       !replay_context(guest_rd32(SPLIT_PLAYERS_ORDER)))return;
    /* Discard stale/broken counters instead of replaying an unbounded queue. */
    if(cameras<=8)for(uint32_t i=0;i<cameras;i++)vr_web_replay_cycle(c,guest_rd32(SPLIT_PLAYERS_ORDER));
    if(timeline<=8 && (timeline&1u))gcall_main(c,FN_REPLAY_TIMELINE,replay_view.owner,0,NULL);
}
static VrReplayStep *replay_step(uint32_t manager){
    return manager?vr_replay_find(&replay,manager,MR32(manager+REPLAY_STREAM),MR32(manager+REPLAY_FIRST),
                                MR32(manager+REPLAY_STARTED),guest_rd32(G_WORLD_STEP)):NULL;
}
void vr_web_replay_record(uint32_t manager,uint32_t caller,uint32_t ticks){
    if(caller!=REPLAY_TICK_WRITE_RET || !manager || manager!=replay_manager() || !MR32(manager+REPLAY_RECORDING))return;
    uint32_t stream=MR32(manager+REPLAY_STREAM);
    if(!guest_ok(stream,0x2bu))return;
    vr_replay_record(&replay,manager,stream,MR32(manager+REPLAY_FIRST),MR32(manager+REPLAY_STARTED),guest_rd32(G_WORLD_STEP),ticks);
}
uint32_t vr_web_replay_ticks(uint32_t manager,uint32_t caller,uint32_t ticks){
    if(caller!=REPLAY_TICK_READ_RET || !manager || manager!=replay_manager() || !MR32(manager+REPLAY_PLAYING) || MR32(manager+REPLAY_ERROR))return ticks;
    VrReplayStep *step=replay_step(manager);
    return step && (step->ticks&255u)==ticks?step->ticks:ticks;
}
uint32_t vr_web_driver_before(uint32_t driver){
    uint32_t car=local_car();
    if(!car || driver!=human_driver(car))return 0;
    uint32_t before=MR32(driver+INPUT_GEAR_REQUEST),manager=replay_manager();
    VrReplayStep *step=replay_step(manager);
    if(manager && MR32(manager+REPLAY_PLAYING) && !MR32(manager+REPLAY_ERROR) && step && step->driver)
        MR32(driver+INPUT_GEAR_REQUEST)=step->before;
    return before;
}
void vr_web_driver_after(uint32_t driver,uint32_t before){
    uint32_t car=local_car();
    if(!car || driver!=human_driver(car))return;
    uint32_t manager=replay_manager();VrReplayStep *step=replay_step(manager);
    if(manager && MR32(manager+REPLAY_PLAYING)){
        if(!MR32(manager+REPLAY_ERROR) && step && step->driver){
            MR32(driver+INPUT_GEAR_REQUEST)=step->after;
            if(step->raw_pedals){
                MRF32(driver+INPUT_THROTTLE)=MRF32(car+CAR_THROTTLE)=MRF32(driver+DRIVER_RAW_GAS);
                MRF32(driver+INPUT_BRAKE)=MRF32(driver+DRIVER_RAW_BRAKE);
            }
        }
    }else if(!replay_open()){
        vr_web_driver(driver);
        if(manager && MR32(manager+REPLAY_RECORDING) && step){
            step->driver=1;step->before=before;step->after=MR32(driver+INPUT_GEAR_REQUEST);step->raw_pedals=(unsigned char)driver_raw_pedals;
        }
    }
}
static uint32_t manual_gears(uint32_t car,uint32_t driver){
    uint32_t mode=guest_rd32(driver+DRIVER_TRANSMISSION),spec=guest_rd32(car+CAR_SPEC);
    uint32_t count=guest_ok(spec,SPEC_GEARS+4u)?guest_rd32(spec+SPEC_GEARS):0;
    return (mode==1 || mode==3 || mode==4) && count>=4 && count<=6?count:0;
}
static void bump_gearbox(void){
    gearbox_epoch=(gearbox_epoch+1u)&0xffffffu;
    if(!gearbox_epoch)gearbox_epoch=1;
}
void vr_web_stage(uint32_t car,uint32_t stage,uint32_t previous){
    if(replay_open())return;
    uint32_t local=local_car();
    if(car!=local)return; /* A remote car's stage callback does not own our lever. */
    uint32_t race=guest_rd32(G_RACE),driver=human_driver(car);
    int before=stage==2 || stage==3;
    if((stage==1 || stage==2) && stage!=previous){
        grid.disabled_car=grid.disabled_race=0;
        if(stage==2 && grid.car==car)grid.car=0;
    }
    int enabled=local && driver && guest_rd32(G_RACETYPE) && manual_gears(car,driver) && tracking_live() && (input.command&128u);
    if(!enabled || (stage!=2 && stage!=3 && stage!=4 && stage!=6) || (grid.car && (grid.car!=car || grid.race!=race))) {
        if(grid.car){
            if(!enabled){grid.disabled_car=car;grid.disabled_race=race;}
            grid.car=0;bump_gearbox();
        }
        return;
    }
    int begin=before || (stage==4 && previous>=1 && previous<=3);
    if(!grid.car && begin && !(grid.disabled_car==car && grid.disabled_race==race) &&
       isfinite(MRF32(car+CAR_SPEED)) && fabsf(MRF32(car+CAR_SPEED))<1.f) {
        grid.car=car;grid.race=race;grid.gear=1;bump_gearbox();
    }
    if(grid.car)grid.stage=stage;
}
void vr_web_grid_apply(uint32_t driver){
    if(replay_open() || !driver || !grid.car || grid.car!=local_car() || driver!=human_driver(grid.car) || grid.stage==6 ||
       !tracking_live() || !(current_command()&128u) || !manual_gears(grid.car,driver))return;
    MR32(driver+INPUT_GEAR_REQUEST)=grid.gear;
}
uint32_t vr_web_gearbox(uint32_t car){
    double age = nfsu2_now_ms() - gearbox_at;
    return car && car == gearbox_car && isfinite(age) && age >= 0 && age < 300
        ? gearbox_epoch << 8 | gearbox_flags : 0;
}
/* After HumanDriver::Update (0x41e2c0), before physics consumes +0x1e4.
 * Retail shift buttons use the same request; the gearbox still engages it.
 * Epochs prevent a held lever from commanding a replacement car or a driver
 * whose transmission/input availability changed while the page was delayed. */
void vr_web_driver(uint32_t driver){
    driver_raw_pedals=0;
    if(replay_open())return;
    uint32_t car = local_car();
    if (!car || driver!=human_driver(car)) return;
    uint32_t spec = guest_rd32(car + CAR_SPEC);
    uint32_t count = guest_ok(spec, SPEC_GEARS + 4u) ? guest_rd32(spec + SPEC_GEARS) : 0;
    if (count < 4 || count > 6) count = 0;
    uint32_t mode = guest_rd32(driver + DRIVER_TRANSMISSION);
    int manual = mode == 1 || mode == 3 || mode == 4;
    uint32_t look_driving_car(void);
    int ready = guest_rd32(driver + DRIVER_SOURCE) != UINT32_MAX && !MR8(driver + DRIVER_GRID_LOCK)
        && !guest_rd32(driver + DRIVER_NO_INPUT) && look_driving_car() == car;
    uint32_t command=current_command();
    int owned=grid.car==car && grid.race==guest_rd32(G_RACE);
    if(owned && !(command&128u)) {
        grid.disabled_car=car;grid.disabled_race=grid.race;grid.car=0;owned=0;bump_gearbox();
    }
    if(owned && grid.stage==4 && ready && grid.gear==2 && guest_rd32(car+CAR_GEAR)==2)grid.car=0,owned=0;
    int grid_ready=owned && grid.stage!=6;
    uint32_t flags = count | (manual ? VR_GEAR_MANUAL : 0u) | (ready || grid_ready ? VR_GEAR_READY : 0u);
    double now = nfsu2_now_ms();
    int tracking = tracking_live();
    if (car != gearbox_car || driver != gearbox_driver || flags != (gearbox_flags&31u) || tracking != gearbox_tracking || now - gearbox_at >= 300)bump_gearbox();
    if(owned)flags|=VR_GEAR_GRID | (grid.stage<4?VR_GEAR_COUNTDOWN:0u) | (grid.gear==2?VR_GEAR_FIRST:0u);
    gearbox_car = car; gearbox_driver = driver; gearbox_flags = flags; gearbox_at = now; gearbox_tracking = tracking;
    uint32_t gear = (command & 15u) - 1u;
    if(owned) {
        if(grid_ready && tracking && command>>8==gearbox_epoch && (command&128u) && !(command&112u) && (gear==1 || gear==2)) {
            grid.gear=gear;
            gearbox_flags=(gearbox_flags&~VR_GEAR_FIRST)|(gear==2?VR_GEAR_FIRST:0u);
        }
        vr_web_grid_apply(driver);
        return; /* Countdown brake, throttle and launch bookkeeping stay retail. */
    }
    if (!tracking || !manual || !ready || !count || !(command & 128u) || (command & 112u) ||
        command >> 8 != gearbox_epoch || gear > count + 1u) return;
    /* Explicit gear direction keeps the accelerator as the accelerator in
     * reverse. Undo only the retail pedal swap, retaining other race filters. */
    if (!gear || !MR32(car + CAR_GEAR) || MR8(driver + DRIVER_AUTO_REVERSE) || !MR32(driver + INPUT_GEAR_REQUEST)) {
        float gas = MRF32(driver + DRIVER_RAW_GAS), brake = MRF32(driver + DRIVER_RAW_BRAKE);
        if (isfinite(gas) && isfinite(brake) && gas >= 0 && gas <= 1 && brake >= 0 && brake <= 1) {
            driver_raw_pedals=1;
            MRF32(driver + INPUT_THROTTLE) = MRF32(car + CAR_THROTTLE) = gas;
            MRF32(driver + INPUT_BRAKE) = brake;
        }
    }
    MR32(driver + INPUT_GEAR_REQUEST) = gear;
}
int vr_web_own_body(uint32_t render, uint32_t view){
    /* Inside materials apply only to the local driving camera. */
    uint32_t car = local_car();
    return car && guest_ok(view, EVIEW_CAMERA + 4) && (saved_cam && saved_kind==1 && MR32(view + EVIEW_ID) == 1u)
        && guest_ok(render, 4) && guest_rd32(render) == car;
}
int vr_web_inside_body(uint32_t ret, uint32_t lo, uint32_t hi){
    uint32_t car = local_car();
    uint32_t ri = guest_ok(car, CAR_RENDER_INFO + 4u) ? guest_rd32(car + CAR_RENDER_INFO) : 0;
    return (saved_cam && saved_kind==1) && ret == VR_BODY_BOUNDS_RET && guest_ok(ri, CAR_RENDER_HI + 16u)
        && guest_rd32(ri) == car && lo == ri + CAR_RENDER_LO && hi == ri + CAR_RENDER_HI;
}
uint32_t vr_web_mirror_target(void){return rear_saved_cam && frame.mirrors.active?frame.mirrors.target:0;}
void vr_web_rear_world(CPU *c){
    /* The PC's simplified rear pass omits the sky call made at 0x5cb227
     * in the main view. Queue that same sky on this rear camera/target,
     * then flush before the ordinary rear world and car geometry. */
    if(!vr_web_mirror_target() || !guest_ok(rear_plat,EVIEW_MATRICES-1u) || guest_rd32(c->esp)!=REAR_WORLD_RET || guest_rd32(c->esp+4u)!=G_VIEW3)return;
    /* The PC sky dome lies beyond the 600 m traffic capture. Put only that
     * background at clip z=w, so it is visible and retains the cleared far
     * depth used by mirror reprojection. World depth stays A+B/Z. */
    float keep[32];float *v=(float *)(g_mem+rear_plat),*p=v+16,*m=v+32;
    memcpy(keep,p,sizeof keep);p[10]=1.f;p[14]=0.f;
    for(int r=0;r<4;r++)for(int k=0;k<4;k++)m[r*4+k]=v[r*4]*p[k]+v[r*4+1]*p[4+k]+v[r*4+2]*p[8+k]+v[r*4+3]*p[12+k];
    uint32_t view=G_VIEW3;
    gcall(c,FN_SKY_DRAW,0,1,&view);
    gcall(c,FN_RENDER_FLUSH,0,0,NULL);
    memcpy(p,keep,sizeof keep);
}
int vr_web_mirror_mask(uint32_t texture){
    if(!texture)return 0;
    const uint32_t info[2]={guest_rd32(G_REAR_RIM),guest_rd32(G_REAR_MASK)};
    for(int i=0;i<2;i++){
        uint32_t plat=guest_rd32(info[i]);
        uint32_t tex=guest_ok(plat,TI_D3D_TEXTURE+3u)?guest_rd32(plat+TI_D3D_TEXTURE):0;
        if(guest_ok(tex,COM_TEXTURE_ID+3u) && guest_rd32(tex+COM_TEXTURE_ID)==texture)return 1;
    }
    return 0;
}
int vr_web_body_matrix(const float *x, const float *y, const float *w){
    /* Match all three position rows of the rigid local shell. World geometry,
     * animated wheels, other cars and reflection cameras have other matrices. */
    if(!body_ready || !saved_cam)return 0;
    for (int k = 0; k < 4; k++) {
        float tolerance = k == 3 ? .015f : .002f;
        if (!isfinite(x[k]) || !isfinite(y[k]) || !isfinite(w[k]) ||
            fabsf(x[k] - body_clip[k*4]) > tolerance ||
            fabsf(y[k] - body_clip[k*4+1]) > tolerance ||
            fabsf(w[k] - body_clip[k*4+3]) > tolerance)return 0;
    }
    frame.pad++;return 1;
}

int vr_web_window_texture(uint32_t texture){
    if (!texture) return 0;
    for (int i = 0; i < 7; i++) if (windows[i] == texture) return 1;
    return 0;
}
static void body_matrix(float clip[16],const float *m,const float *v,const float *p){
    float model_view[16];
    for (int r = 0; r < 4; r++) for (int k = 0; k < 4; k++) {
        double value = 0; for (int j = 0; j < 4; j++) value += (double)m[r*4+j] * v[j*4+k];
        model_view[r*4+k] = (float)value;
    }
    for (int r = 0; r < 4; r++) for (int k = 0; k < 4; k++) {
        float value = 0; for (int j = 0; j < 4; j++) value += model_view[r*4+j] * p[j*4+k];
        clip[r*4+k] = value;
    }
}
uint32_t vr_web_driver_matrix(uint32_t view,const float *x,const float *y,const float *w){
    int slot=split_view_slot(view);
    if(slot<0 || !(frame.views_mask&(1u<<slot)))return 0;
    const float *v=slot?frame.views[slot-1].view:frame.view;
    const float *p=slot?frame.views[slot-1].projection:frame.projection;
    /* Only called for a complete crossed-card mesh. Identify its owner in
     * this camera; the page removes it only when that driver's head is drawn. */
    for(uint32_t i=0;i<VR_CARS+2u;i++){
        const VrCar *car;
        if(i<VR_CARS){if(i>=frame.reserved[0])continue;car=&frame.cars[i];}
        else if(i==VR_CARS){if(!frame.local_valid)continue;car=&frame.local;}
        else {if(!frame.secondary_valid)continue;car=&frame.secondary;}
        float clip[16];body_matrix(clip,car->transform,v,p);int match=1;
        for(int k=0;k<4;k++){
            float tolerance=k==3?.015f:.002f;
            if(!isfinite(x[k])||!isfinite(y[k])||!isfinite(w[k])||
                fabsf(x[k]-clip[k*4])>tolerance||fabsf(y[k]-clip[k*4+1])>tolerance||fabsf(w[k]-clip[k*4+3])>tolerance)match=0;
        }
        if(match)return i+1;
    }
    return 0;
}
static void body_windows(uint32_t car){
    memset(windows,0,sizeof windows);
    uint32_t ri = guest_rd32(car + CAR_RENDER_INFO);
    if (!guest_ok(ri, CAR_WINDOW_REPLACEMENTS + 7u*16u)) return;
    static const uint32_t semantic[7] = {0x7b220ddfu,0x1b0763a0u,0xe7e4ef49u,0x4cdebfcau,0x60f8b13cu,0x0ab88f5du,0xd195be56u};
    for (int i = 0; i < 7; i++) {
        uint32_t entry = ri + CAR_WINDOW_REPLACEMENTS + i*16u, ti = MR32(entry + 8u);
        if (MR32(entry) != semantic[i] || !MR32(entry + 4u) || !guest_ok(ti, TI_SELF + 4u) ||
            MR32(ti + TI_HASH) != MR32(entry + 4u) || MR32(ti + TI_SELF) != ti) continue;
        uint32_t plat = guest_rd32(ti + TI_PLAT);
        uint32_t tex = guest_ok(plat, TI_D3D_TEXTURE + 4u) ? guest_rd32(plat + TI_D3D_TEXTURE) : 0;
        windows[i] = guest_ok(tex, COM_TEXTURE_ID + 4u) ? guest_rd32(tex + COM_TEXTURE_ID) : 0;
    }
    if (vr_web_trace_body()) fprintf(stderr, "[vr-body] windows: %u %u %u %u %u %u %u\n",windows[0],windows[1],windows[2],windows[3],windows[4],windows[5],windows[6]);
}
static void body_prepare(uint32_t car){
    body_frames++;body_matrix(body_clip,frame.local.transform,frame.view,frame.projection);body_ready=1;body_windows(car);
}

void vr_web_frame(CPU *c){
    uint32_t owner=local_car();
    if(owner!=mirror_car || !owner){memset(&frame.mirrors,0,sizeof frame.mirrors);mirror_car=owner;}
    frame.mirrors.active=frame.mirrors.target=frame.mirrors.zid=0;
    memset(mirror_seen,0,sizeof mirror_seen);
    frame.gps_metres = -1; frame.gps_metric = 0;
    float metres; int metric;
    if (MR32(G_FLOW) == 6u && gpsdistance_read(c, guest_rd32(SPLIT_PLAYERS_INDEX), &metres, &metric)) {
        frame.gps_metres = metres; frame.gps_metric = (uint32_t)metric;
    }
    vr_web_frame_end();
    /* A paused/UI-only frame may never set up the main world camera. Only
     * this frame's accepted cockpit camera may redirect its frontend draws. */
    hud_active = 0;
    if (MR32(G_FLOW) != 6u) { hud_active = 0; ws_cockpit_hud(0); }
    if (!registered){ nfsu2_register(8, &box, sizeof box); registered = 1; }
    uint32_t seq = atomic_load_explicit(&box.seq, memory_order_acquire);
    if (!(seq & 1u)) {
        VrMailbox sample;
        memcpy(&sample, &box, sizeof sample);
        if (seq == atomic_load_explicit(&box.seq, memory_order_acquire)) memcpy(&input, &sample, sizeof input);
    }
    game_settings();
    stance_settings();
    car_limit_settings();
    /* An overlapping writer keeps the last complete pose until its normal
     * expiry; it must not look like a focus change and reset a held lever. */
    double age = nfsu2_now_ms() - input.at_ms;
    if (!isfinite(age) || age < -100 || age > 300 || MR32(G_FLOW) != 6u) input.active = 0;
    for (int i = 0; i < 16; i++) if (!isfinite(input.head_view[i]) || fabsf(input.head_view[i]) > 10.f) input.active = 0;
    if (!isfinite(input.fov_y) || input.fov_y < .5f || input.fov_y > 2.8f) input.active = 0;
    /* Only a new immersive session selects the seat. Tracking loss, recenter
     * and pause must preserve a deliberately selected exterior camera. */
    if(tracking_live() && input.active!=cockpit_session){
        cockpit_session=input.active;cockpit_selected=1;
        if(replay_view.selected)replay_view.previous=1;
    }
    replay_commands(c);
    uint32_t car=local_car(),stage=race_stage();
    if(!tracking_live() || road_car!=car || stage!=4 || !(MRF32(G_WORLDDT)>0)){road=(VrRoad){0};road_car=0;}
    vr_web_stage(car,stage,stage);
    if(grid.car || (stage>=1 && stage<=3)) {
        uint32_t driver=human_driver(car);
        if(driver)vr_web_driver(driver);
    }
    if(desktop_cockpit<0)desktop_cockpit=setting_bool("NFSU2_VR_COCKPIT",0);
    int rear_change=vr_rear_update(&rear_owned,c,cockpit_selected && (desktop_cockpit || tracking_live()));
    if(rear_change)fprintf(stderr,"[vr-mirror] rear camera %s\n",rear_change>0?"attached":"released");
}
/* HUD updates precede camera setup. Use driving ownership and the same camera
 * eligibility to keep the original GPS text for flat/photo views only. */
int vr_web_gps_panel(void){
    if (desktop_cockpit < 0) desktop_cockpit = setting_bool("NFSU2_VR_COCKPIT", 0);
    if (!cockpit_selected || (!tracking_live() && !desktop_cockpit) || !local_car() || look_driving_car() != local_car()) return 0;
    int photo_view(uint16_t *, float *, float *);
    uint16_t fov; float roll, jitter[11];
    return !photo_view(&fov, &roll, jitter);
}
void vr_web_views(void){
    VrRearSnapshot s;
    if(!vr_web_gps_panel() || !vr_rear_snapshot(&s) || !s.main_active || !s.rear_valid || !s.rear_linked)return;
    uint32_t target=guest_rd32(G_VIEW3+EVIEW_TARGET);
    if(!guest_ok(target,TARGET_ACTIVE+3u))return;
    MR8(G_VIEW3+EVIEW_ACTIVE)=1;MR32(target+TARGET_ACTIVE)=1;
}
/* 0x5c80ad writes the angular detail scale, not a clip plane. The wide XR
 * culling lens must not also shorten scenery's LOD/dropout distances.
 * 0x5d64d0 uses this scale with each object's radius, before 0x5d6570 chooses
 * its model. Keep at least the original driving camera's angular detail. */
void vr_web_world_lists(uint32_t world){
    if(!saved_cam || !saved_kind || !guest_ok(world,WORLD_VIEW_COUNT+3u))return;
    unsigned count=MR32(world+WORLD_VIEW_COUNT);
    if(!count || count>12)return;
    uint16_t fov;memcpy(&fov,saved_camera+CAM_FOV,sizeof fov);
    float angle=fov*(6.283185307f/65536.f);
    if(angle<.5f || angle>2.7f)angle=1.221730476f; /* 70 degrees for an invalid camera lens. */
    float detail=256.f/tanf(angle*.5f);
    for(unsigned i=0;i<count;i++){
        uint32_t entry=world+i*WORLD_VIEW_STRIDE;
        if(!guest_ok(entry,WORLD_VIEW_FLAGS+3u))continue;
        uint32_t view=MR32(entry+WORLD_VIEW_OWNER);
        if(!guest_ok(view,EVIEW_CAMERA+3u))continue;
        unsigned id=MR32(view+EVIEW_ID);
        int slot=id==1u && MR32(view+EVIEW_CAMERA)==saved_cam?0:
            view==G_VIEW3 && rear_saved_cam && MR32(view+EVIEW_CAMERA)==rear_saved_cam?1:-1;
        if(slot<0)continue;
        float previous=MRF32(view+EVIEW_LOD_SCALE);
        if(isfinite(previous) && previous>0.f && previous<detail){
            if(!lod_views[slot].view){lod_views[slot].view=view;lod_views[slot].saved=previous;}
            lod_views[slot].made=detail;MRF32(view+EVIEW_LOD_SCALE)=detail;
        }
        /* The original tiny rear HUD omits whole scenery categories and
         * chooses a low reflection model. The cockpit glass shows those
         * omissions at arm's length. Retain ordinary object/frustum culling. */
        if(slot==1)MR32(entry+WORLD_VIEW_FLAGS)&=~0x1060u;
    }
}
int vr_web_skip_lens_rain(CPU *c, uint32_t view_id){
    /* 0x5c7ab0 composites Rain's lens drops over the finished image, without
     * depth or glass geometry. They cannot sit on a cockpit windshield and
     * cover the seats and hands too. Skip only this pass for an accepted seat
     * camera; world rain, wet roads and exterior cameras keep their weather.
     * The existing split-screen override owns the cdecl (one argument) call. */
    if(view_id!=1u || !saved_cam || saved_kind!=1 || !guest_ok(c->esp,4u))return 0;
    c->eip=MR32(c->esp);c->esp+=4u;
    return 1;
}
int vr_web_camera(uint32_t view, uint32_t cam, uint8_t *keep){
    if (desktop_cockpit < 0) desktop_cockpit = setting_bool("NFSU2_VR_COCKPIT", 0);
    if(view==G_VIEW3 && cam==guest_rd32(G_VIEW3+EVIEW_CAMERA) && vr_web_gps_panel()){
        VrRearSnapshot s;
        if(!vr_rear_snapshot(&s) || !s.main_active || !s.rear_valid || !s.rear_linked || !guest_ok(cam,CAM_EXCLUDED_CAR+3u))return 0;
        if(!rear_saved_cam){rear_saved_cam=cam;memcpy(rear_saved,g_mem+cam,CAM_VIEW_BYTES);}
        /* Keep the retail road/traffic camera independent of mirror trim.
         * Excluding the local shell also excludes its unfinished inside faces. */
        MR16(cam+CAM_FOV)=0x6800;MRF32(cam+CAM_NEAR)=.18f;MRF32(cam+CAM_FAR)=15000.f;
        MR32(cam+CAM_EXCLUDED_CAR)=local_car();
        memcpy(rear_made,g_mem+cam,CAM_VIEW_BYTES);
        return 2;
    }
    VrCar car;
    uint32_t look_driving_car(void);
    uint32_t stage=race_stage();
    int startline=stage>=1 && stage<=3 && guest_rd32(G_RACETYPE) && local_car();
    int replaying=replay_context(guest_rd32(SPLIT_PLAYERS_ORDER));
    uint32_t look_world_car(void);
    int driving=look_driving_car()!=0;
    int cinematic=input.active && !driving && look_world_car()==local_car() && local_car();
    if (!driving && !startline && !replaying && !cinematic) return 0;
    if ((!input.active && !desktop_cockpit) || !guest_ok(view, 8) || MR32(view + EVIEW_ID) != 1u || !guest_ok(cam, CAM_EXCLUDED_CAR + 4u) || !vr_web_car(local_car(), &car)) return 0;
    /* The photo camera has its own view, independently of the driving seat. */
    int photo_view(uint16_t *, float *, float *);
    uint16_t photo_fov; float photo_roll, photo_jitter[11];
    if (photo_view(&photo_fov, &photo_roll, photo_jitter)) return 0;
    int seated=cockpit_selected && !cinematic && (!replaying || (replay_view.selected && replay_view.owner==guest_rd32(G_REPLAY_UI)));
    if (!seated && !input.active) return 0;
    if (!seated) for(int k=0;k<16;k++){
        float v=MRF32(cam+k*4u);if(!isfinite(v) || fabsf(v)>1000000.f)return 0;
    }
    memcpy(keep, g_mem + cam, CAM_VIEW_BYTES);
    if (saved_cam == cam) return saved_kind;
    saved_cam = cam; memcpy(saved_camera, keep, CAM_VIEW_BYTES);
    saved_kind = seated ? 1 : 3;
    /* 0x5cbb00 accumulates lights in one screen-space history for view 1.
     * Replaying it for two moving eyes creates floating/doubled light trails.
     * The retail off branch draws the same light sources in the current world
     * view, without history. Scope this to an accepted tracked camera and
     * restore the player's option at Present (also for an interrupted frame). */
    if(input.active && !light_streaks.active){
        light_streaks.saved=MR32(G_LIGHT_STREAKS);light_streaks.active=1;
        MR32(G_LIGHT_STREAKS)=0;
    }
    saved_excluded = MR32(cam + CAM_EXCLUDED_CAR);
    if(seated)MR32(cam + CAM_EXCLUDED_CAR) = 0;
    /* Game view: x right, y down, z forward. The same storage represents the
     * game's row matrix and the transpose used by column-vector WebGPU. */
    float delta[16], result[16], sign[4] = { 1, -1, -1, 1 };
    for (int r = 0; r < 4; r++) for (int k = 0; k < 4; k++) delta[r*4+k] = input.active ? input.head_view[r*4+k] * sign[r] * sign[k] : (r == k ? 1.f : 0.f);
    if (!input.active) { delta[5] = delta[10] = cosf(.12f); delta[6] = sinf(.12f); delta[9] = -delta[6]; }
    const float *a = car.transform, *seat = vr_seat(car.model);
    float base[16] = {0}, eye[3]; base[15] = 1;
    for (int r = 0; r < 3; r++) {
        eye[r] = a[12+r] + a[r]*seat[0] + a[4+r]*seat[1] + a[8+r]*seat[2];
        base[r*4] = -a[4+r]; base[r*4+1] = -a[8+r]; base[r*4+2] = a[r];
    }
    for (int k = 0; k < 3; k++) base[12+k] = -(eye[0]*base[k] + eye[1]*base[4+k] + eye[2]*base[8+k]);
    if(!seated)memcpy(base,keep,sizeof base);
    for (int r = 0; r < 4; r++) for (int k = 0; k < 4; k++) {
        float v = 0; for (int j = 0; j < 4; j++) v += base[r*4+j] * delta[j*4+k]; result[r*4+k] = v;
    }
    memcpy(g_mem + cam, result, sizeof result);
    /* Camera's world eye and forward agree with its view matrix. */
    for (int i = 0; i < 3; i++) {
        MRF32(cam + CAM_EYE + i*4u) = -(result[12]*result[i*4] + result[13]*result[i*4+1] + result[14]*result[i*4+2]);
        MRF32(cam + CAM_FORWARD + i*4u) = result[i*4+2];
        MRF32(cam + CAM_LOOK_TARGET + i*4u) = MRF32(cam + CAM_EYE + i*4u) + result[i*4+2];
    }
    MR16(cam + CAM_FOV) = (uint16_t)((input.active ? input.fov_y : 1.6f) * (65536.f / 6.283185307f));
    memcpy(made_camera, g_mem + cam, CAM_VIEW_BYTES);
    return saved_kind;
}
void vr_web_projection(uint32_t plat, int changed){
    if (changed!=1 || !guest_ok(plat, EVIEW_MATRICES)) return;
    /* Stock driving clips at 0.5 m, through the radio and wheel. Keep world,
     * cabin and picking on the same 3 cm near plane and the game's far plane.
     * eViewPlat contains V, P, V*P (also used by CPU-transformed geometry). */
    float *v = (float *)(g_mem + plat), *p = v + 16, *m = v + 32;
    float far = p[10] > 1.f ? -p[14] / (p[10] - 1.f) : 15000.f;
    if (!isfinite(far) || far < 100.f || far > 30000.f || p[11] != 1.f) return;
    p[10] = far / (far - .03f); p[14] = -.03f * p[10];
    for (int r = 0; r < 4; r++) for (int k = 0; k < 4; k++)
        m[r*4+k] = v[r*4]*p[k] + v[r*4+1]*p[4+k] + v[r*4+2]*p[8+k] + v[r*4+3]*p[12+k];
}
void vr_web_capture(uint32_t view, uint32_t plat, uint32_t cam, const uint8_t *keep, int changed){
    if(guest_ok(view,EVIEW_ID+4u) && guest_ok(plat,EVIEW_MATRICES)){
        int slot=split_view_slot(MR32(view+EVIEW_ID));
        if(slot>=0){
            frame.views_mask|=1u<<slot;
            if(slot){
                memcpy(frame.views[slot-1].view,g_mem+plat,64);
                memcpy(frame.views[slot-1].projection,g_mem+plat+EVIEW_PROJ,64);
            }
        }
    }
    if(view==G_VIEW3 && changed==2 && guest_ok(plat,EVIEW_MATRICES)){
        rear_plat=plat;
        uint32_t texture=guest_rd32(G_REAR_TEXTURE),depth=guest_rd32(G_REAR_DEPTH);
        frame.mirrors.active=1;
        frame.mirrors.reserved=local_car();
        frame.mirrors.target=guest_ok(texture,COM_TEXTURE_ID+3u)?guest_rd32(texture+COM_TEXTURE_ID):0;
        frame.mirrors.zid=guest_ok(depth,COM_DEPTH_ID+3u)?guest_rd32(depth+COM_DEPTH_ID):0;
        memcpy(frame.mirrors.view,g_mem+plat,64);memcpy(frame.mirrors.projection,g_mem+plat+EVIEW_PROJ,64);
    }
    if (guest_ok(view, 8) && MR32(view + EVIEW_ID) == 1u && guest_ok(plat, EVIEW_MATRICES)) {
        frame.replay_active=changed && replay_open();
        hud_active = changed==1 || frame.replay_active; ws_cockpit_hud(hud_active);
        frame.magic = VR_MAGIC; frame.active = changed && input.active;
        memcpy(frame.view, g_mem + plat, 64);
        memcpy(frame.projection, g_mem + plat + EVIEW_PROJ, 64);
        memcpy(frame.head_view, input.head_view, 64);
        frame.reserved[1] = 8;
        frame.stance_available=0;
        frame.idle_rpm=frame.limit_rpm=frame.road_rumble=0;
        frame.reserved[0] = frame.peer_count = frame.racing = frame.local_valid = 0;
        frame.secondary_valid = 0;
        memset(&frame.secondary,0,sizeof frame.secondary);
        frame.pad = 0; body_ready = 0;
        uint32_t car = local_car();
        if (car) {
            uint32_t n = racecars_vr_cars(frame.cars, VR_CARS, frame.peers, &frame.peer_count);
            frame.racing = frame.peer_count != 0;
            frame.reserved[0] = frame.racing ? n : roam_game_vr_cars(frame.cars, VR_CARS);
            frame.local_valid = vr_web_car(car, &frame.local) ? (changed==1 ? 2u : 1u) : 0;
            if(frame.local_valid && !frame.racing)frame.secondary_valid=roam_game_vr_local(&frame.local,&frame.secondary);
            frame.local.gearbox = vr_web_gearbox(car);
            if (frame.local_valid) {
                StanceV value;int stock;
                if(stance_snapshot(car,&value,&stock)){
                    frame.stance_available=1;frame.stance_values[0]=value.fc;frame.stance_values[1]=value.rc;
                    frame.stance_values[2]=value.fo;frame.stance_values[3]=value.ro;frame.stance_values[4]=value.tw;frame.stance_stock_front=stock;
                }
                if (changed==1) body_prepare(car);
                frame.speed = MRF32(car + CAR_FWD_SPEED); frame.rpm = MRF32(car + CAR_RPM);
                frame.gear = (float)MR32(car + CAR_GEAR); frame.world_dt = MRF32(G_WORLDDT);
                uint32_t ctl = guest_rd32(car + CAR_INPUT);
                frame.throttle = guest_ok(ctl, INPUT_BRAKE + 4) ? MRF32(ctl + INPUT_THROTTLE) : 0;
                frame.brake = guest_ok(ctl, INPUT_BRAKE + 4) ? MRF32(ctl + INPUT_BRAKE) : 0;
                uint32_t spec=guest_rd32(car+CAR_SPEC);
                if(guest_ok(spec,SPEC_LIMIT_RPM+4u)) {
                    float idle=MRF32(spec+SPEC_IDLE_RPM),limit=MRF32(spec+SPEC_LIMIT_RPM);
                    if(isfinite(idle) && isfinite(limit) && idle>0 && limit>idle && limit<30000){frame.idle_rpm=idle;frame.limit_rpm=limit;}
                }
                if(changed && road_car==car)frame.road_rumble=vr_road_sample(&road,nfsu2_now_ms());
            }
        }
        frame.at_ms = nfsu2_now_ms();
    }
    (void)cam; (void)keep; /* Restored after Present, not before the car renderer. */
}
void vr_web_present(void *out){ memcpy(out, &frame, sizeof frame); frame.active = frame.reserved[0] = frame.local_valid = frame.peer_count = frame.racing = frame.secondary_valid = frame.views_mask = 0; }
