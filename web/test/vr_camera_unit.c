#include "stance.h"
#include "web/vr_web.h"
#include "game.h"
#include "guest.h"
#include "web/vr_occlusion.h"
#include "web/vr_mirror_mesh.h"
#include <assert.h>
#include <stdlib.h>
#include <stdio.h>

uint8_t *g_mem;
uint8_t g_cbits[1u << 15];
static int sky_calls,flush_calls;
void dispatch_indirect(CPU *c,uint32_t addr){
    if(addr==FN_SKY_DRAW){assert(MR32(c->esp+4u)==G_VIEW3);assert(MRF32(0x20000+64+40)==1 && MRF32(0x20000+64+56)==0);sky_calls++;}
    else if(addr==FN_RENDER_FLUSH){assert(sky_calls==flush_calls+1);flush_calls++;}
    else assert(!"unexpected guest call");
    c->eax=0x1234;c->esp+=4;c->ecx=0x5678;
}
static int live_lights=-1,live_gps=-1,live_special=-1,live_whine=-1,lights_changes;
static int live_cars=-2,car_changes;
void roam_game_set_car_limit(int limit){live_cars=limit;car_changes++;}
void lightkey_set_mode(int mode){live_lights=mode;lights_changes++;}
void gpsdistance_set_enabled(int on){live_gps=on;}
void vinylcat_set_enabled(int on){live_special=on;}
void whine_set_enabled(int on){live_whine=on;}
static int stance_calls,stance_enabled;
int stance_configure(const char *models,int enabled){if(strcmp(models,"v1"))return 0;stance_calls++;stance_enabled=enabled;return 1;}
int stance_snapshot(uint32_t car,StanceV *v,int *stock){(void)car;(void)v;(void)stock;return 0;}
static VrMailbox *mailbox;
static double now = 1000;
static int driving = 1, photo, cinematic;
static int hud_layout;
void ws_cockpit_hud(int active){ hud_layout = active; }
int gpsdistance_read(CPU *c,uint32_t p,float *m,int *units){ (void)c;(void)p;*m=1500.f;*units=1;return 1; }
enum { CAR = 0x10000, RI = 0x12000, CAM = 0x14000, VIEW = 0x16000, PLAYER = 0x18000, TYPE = 0x19000 };
double nfsu2_now_ms(void){ return now; }
int nfsu2_register(int kind, void *ptr, uint32_t size){ assert(kind == 8 && size == sizeof(VrMailbox)); mailbox = ptr; return 0; }
uint32_t look_driving_car(void){ return driving ? CAR : 0; }
uint32_t look_world_car(void){ return driving || cinematic ? CAR : 0; }
int photo_view(uint16_t *f, float *r, float *j){ (void)f; (void)r; (void)j; return photo; }
uint32_t racecars_vr_cars(VrCar *o, uint32_t n, uint32_t *p, uint32_t *c){ (void)o; (void)n; (void)p; *c = 0; return 0; }
static int remote_car;
uint32_t roam_game_vr_cars(VrCar *o, uint32_t n){
    if(!remote_car||!n)return 0;
    memset(o,0,sizeof *o);o->vip=1;o->peer_id=33;
    for(int k=0;k<4;k++)o->transform[k*5]=1;
    o->transform[12]=-3;o->transform[13]=-2;return 1;
}
static uint32_t driver_slot(uint32_t id,const float *car,const float *view,const float *projection){
    float mv[16]={0},clip[16]={0},x[4],y[4],w[4];
    for(int r=0;r<4;r++)for(int c=0;c<4;c++)for(int k=0;k<4;k++)mv[r*4+c]+=car[r*4+k]*view[k*4+c];
    for(int r=0;r<4;r++)for(int c=0;c<4;c++)for(int k=0;k<4;k++)clip[r*4+c]+=mv[r*4+k]*projection[k*4+c];
    for(int k=0;k<4;k++){x[k]=clip[k*4];y[k]=clip[k*4+1];w[k]=clip[k*4+3];}
    return vr_web_driver_matrix(id,x,y,w);
}
static int secondary;
uint32_t roam_game_vr_local(VrCar *p,VrCar *s){
    p->peer_id=77;
    if(!secondary)return 0;
    *s=*p;s->peer_id=88;s->transform[12]+=2;
    return 1;
}

int main(int argc, char **argv){
    (void)argv;
    g_mem = calloc(1, 0x1000000); assert(g_mem);
    for (unsigned p = 0; p < 0x1000000u >> 14; p++) g_cbits[p >> 3] |= 1u << (p & 7);
    MR32(G_FLOW) = 6; MR32(SPLIT_PLAYERS_INDEX) = PLAYER; MR32(PLAYER + 4) = CAR;
    MR32(CAR + CAR_TYPEINFO) = TYPE; memcpy(g_mem + TYPE, "LANCEREVO8", 11);
    MR32(CAR + CAR_RENDER_INFO) = RI; MR32(RI) = CAR;
    for (int k = 0; k < 3; k++) MRF32(CAR + CAR_FLU + k*20u) = 1;
    MR32(VIEW + EVIEW_ID) = 1; MR32(VIEW + EVIEW_CAMERA) = CAM;
    MR32(CAM + CAM_EXCLUDED_CAR) = CAR;
    uint8_t keep[CAM_VIEW_BYTES], original[CAM_VIEW_BYTES];
    memset(g_mem + CAM, 0x5a, CAM_VIEW_BYTES); memcpy(original, g_mem + CAM, CAM_VIEW_BYTES);
    vr_web_frame(NULL);
    assert(mailbox->version==4 && sizeof *mailbox==4272);
    mailbox->cars_revision=1;mailbox->cars_limit=64;
    atomic_fetch_add(&mailbox->seq,1);vr_web_frame(NULL);assert(!car_changes);
    atomic_fetch_add(&mailbox->seq,1);vr_web_frame(NULL);assert(car_changes==1 && live_cars==64);
    vr_web_frame(NULL);assert(car_changes==1);
    mailbox->cars_revision=2;mailbox->cars_limit=65;vr_web_frame(NULL);assert(car_changes==1);
    mailbox->cars_limit=-2;vr_web_frame(NULL);assert(car_changes==1);
    mailbox->cars_limit=-1;vr_web_frame(NULL);assert(car_changes==2 && live_cars==-1);
    mailbox->cars_revision=3;mailbox->cars_limit=0;vr_web_frame(NULL);assert(car_changes==3 && live_cars==0 && !mailbox->active);
    mailbox->stance_revision=1;mailbox->stance_enabled=1;strcpy(mailbox->stance_models,"v1");
    atomic_fetch_add(&mailbox->seq,1);vr_web_frame(NULL);assert(!stance_calls);
    atomic_fetch_add(&mailbox->seq,1);vr_web_frame(NULL);assert(stance_calls==1 && stance_enabled==1);
    vr_web_frame(NULL);assert(stance_calls==1);
    mailbox->stance_revision=2;mailbox->stance_enabled=2;vr_web_frame(NULL);assert(stance_calls==1);
    mailbox->stance_enabled=0;memset(mailbox->stance_models,'a',sizeof mailbox->stance_models);vr_web_frame(NULL);assert(stance_calls==1);
    strcpy(mailbox->stance_models,"bad");vr_web_frame(NULL);assert(stance_calls==1);
    strcpy(mailbox->stance_models,"v1");vr_web_frame(NULL);assert(stance_calls==2 && stance_enabled==0);
    mailbox->settings_revision=1;mailbox->settings_mask=3;mailbox->headlights=2;mailbox->gps=1;
    vr_web_frame(NULL);assert(live_lights==2 && live_gps==1 && !mailbox->active);
    mailbox->settings_revision++;mailbox->headlights=3;mailbox->gps=0;
    vr_web_frame(NULL);assert(live_lights==2 && live_gps==1);
    mailbox->headlights=2;vr_web_frame(NULL);assert(live_gps==0 && lights_changes==1);
    mailbox->settings_revision++;mailbox->headlights=0;mailbox->gps=1;
    atomic_fetch_add(&mailbox->seq,1);vr_web_frame(NULL);assert(live_lights==2 && live_gps==0);
    atomic_fetch_add(&mailbox->seq,1);vr_web_frame(NULL);assert(live_lights==0 && live_gps==1);

    mailbox->settings_revision++;mailbox->settings_mask=15;mailbox->special_vinyls=1;mailbox->gearbox_whine=1;
    vr_web_frame(NULL);assert(live_special==1 && live_whine==1);
    mailbox->settings_revision++;mailbox->gps=0;mailbox->special_vinyls=2;
    vr_web_frame(NULL);assert(live_gps==1 && live_special==1 && live_whine==1);
    mailbox->special_vinyls=0;mailbox->gearbox_whine=3;
    vr_web_frame(NULL);assert(live_gps==1 && live_special==1 && live_whine==1);
    mailbox->gearbox_whine=0;vr_web_frame(NULL);assert(live_gps==0 && live_special==0 && live_whine==0);
    mailbox->settings_revision++;mailbox->settings_mask=3;mailbox->special_vinyls=1;mailbox->gearbox_whine=1;
    vr_web_frame(NULL);assert(live_special==0 && live_whine==0);

    if (argc > 1) {
        mailbox->active = 1; mailbox->at_ms = now; mailbox->fov_y = 1.9f;
        for (int k = 0; k < 16; k++) mailbox->head_view[k] = k % 5 == 0;
        vr_web_frame(NULL);
    }
    MR32(G_LIGHT_STREAKS)=1;
    CPU rain_cpu={0};rain_cpu.esp=0x38000;rain_cpu.ecx=0x12345;MR32(rain_cpu.esp)=0x5ca000;MR32(rain_cpu.esp+4)=1;
    CPU rain_before=rain_cpu;
    assert(!vr_web_skip_lens_rain(&rain_cpu,1));
    assert(vr_web_camera(VIEW, CAM, keep));
    assert(!vr_web_skip_lens_rain(&rain_cpu,2));assert(!vr_web_skip_lens_rain(&rain_cpu,3));
    assert(!memcmp(&rain_cpu,&rain_before,sizeof rain_cpu));
    assert(vr_web_skip_lens_rain(&rain_cpu,1));
    rain_before.eip=0x5ca000;rain_before.esp+=4;
    assert(!memcmp(&rain_cpu,&rain_before,sizeof rain_cpu));assert(MR32(rain_cpu.esp)==1); /* caller pops the argument */
    assert(MR32(G_LIGHT_STREAKS)==(argc>1?0u:1u));
    assert(vr_web_camera(VIEW, CAM, keep)); /* a repeated setup must not save the temporary zero */
    assert(vr_web_gps_panel());
    assert(MR32(CAM + CAM_EXCLUDED_CAR) == 0);
    assert(vr_web_own_body(RI, VIEW));
    assert(vr_web_inside_body(VR_BODY_BOUNDS_RET, RI + CAR_RENDER_LO, RI + CAR_RENDER_HI));
    assert(!vr_web_inside_body(VR_BODY_BOUNDS_RET + 1, RI + CAR_RENDER_LO, RI + CAR_RENDER_HI));
    assert(!vr_web_inside_body(VR_BODY_BOUNDS_RET, RI + 0x110, RI + 0x120));
    /* The real renderer matches the rigid shell's clip transform and resolves
     * only semantic window materials through the live PC TextureInfo chain. */
    uint32_t plat = 0x20000, ti = 0x21000, texture_plat = 0x22000, tex = 0x23000;
    memcpy(g_mem + plat, g_mem + CAM, 64);
    for (int k = 0; k < 16; k++) MRF32(plat + 64u + k*4u) = k % 5 == 0;
    MR32(RI + CAR_WINDOW_REPLACEMENTS) = 0x7b220ddfu;
    MR32(RI + CAR_WINDOW_REPLACEMENTS + 4u) = 123;
    MR32(RI + CAR_WINDOW_REPLACEMENTS + 8u) = ti;
    MR32(ti + TI_HASH) = 123; MR32(ti + TI_SELF) = ti; MR32(ti + TI_PLAT) = texture_plat;
    MR32(texture_plat + TI_D3D_TEXTURE) = tex; MR32(tex + COM_TEXTURE_ID) = 77;
    /* Only the original rounded mirror mask/rim are omitted from the rear
     * capture. Sky and other depth-disabled surfaces keep their draws. */
    assert(!vr_web_mirror_mask(77));
    MR32(G_REAR_MASK)=ti; assert(vr_web_mirror_mask(77));
    assert(!vr_web_mirror_mask(0) && !vr_web_mirror_mask(78));
    MR32(G_REAR_MASK)=0;MR32(G_REAR_RIM)=ti;assert(vr_web_mirror_mask(77));
    MR32(G_REAR_RIM)=0xfffffff0u;assert(!vr_web_mirror_mask(77));MR32(G_REAR_RIM)=0;
    vr_web_capture(VIEW, plat, CAM, keep, 1);
    assert(hud_layout && !vr_web_ui_active());
    vr_web_ui_begin(); assert(vr_web_ui_active());
    vr_web_ui_begin(); vr_web_ui_end(); assert(vr_web_ui_active());
    vr_web_ui_end(); vr_web_ui_end(); assert(!vr_web_ui_active());
    vr_web_capture(VIEW,plat,CAM,keep,0); assert(!hud_layout);
    vr_web_ui_begin(); assert(!vr_web_ui_active()); vr_web_ui_end();
    vr_web_capture(VIEW,plat,CAM,keep,1); assert(hud_layout);
    uint32_t spec=0x24000;MR32(CAR+CAR_SPEC)=spec;MRF32(spec+SPEC_IDLE_RPM)=850;MRF32(spec+SPEC_LIMIT_RPM)=7500;
    MRF32(G_WORLDDT)=.016f;
    vr_web_rumble(1,.2f);now+=4;vr_web_rumble(0,0);
    vr_web_capture(VIEW,plat,CAM,keep,1);VrFrame feedback;vr_web_present(&feedback);
    assert(feedback.reserved[1]==8 && feedback.idle_rpm==850 && feedback.limit_rpm==7500);
    assert(feedback.local.peer_id==77 && !feedback.secondary_valid);
    MRF32(plat+64+44)=1;MRF32(plat+64+60)=0;
    const float *testv=(float *)(g_mem+plat),*testp=(float *)(g_mem+plat+64);
    secondary=remote_car=1;vr_web_capture(VIEW,plat,CAM,keep,1);
    float second_car[16];memcpy(second_car,feedback.local.transform,sizeof second_car);second_car[12]+=2;
    assert(driver_slot(1,feedback.local.transform,testv,testp)==65);
    assert(driver_slot(1,second_car,testv,testp)==66);
    VrCar remote;roam_game_vr_cars(&remote,1);
    assert(driver_slot(1,remote.transform,testv,testp)==1);
    assert(!driver_slot(4,remote.transform,testv,testp));
    remote.transform[12]+=1;assert(!driver_slot(1,remote.transform,testv,testp));
    float saved_view_x=MRF32(plat+48);
    MR32(VIEW+EVIEW_ID)=2;MRF32(plat+48)=123.f;vr_web_capture(VIEW,plat,CAM,keep,0);
    assert(driver_slot(2,second_car,(float *)(g_mem+plat),(float *)(g_mem+plat+EVIEW_PROJ))==66);
    assert(!driver_slot(1,second_car,(float *)(g_mem+plat),(float *)(g_mem+plat+EVIEW_PROJ)));
    MR32(VIEW+EVIEW_ID)=4;MRF32(plat+48)=456.f;vr_web_capture(VIEW,plat,CAM,keep,0);
    MR32(VIEW+EVIEW_ID)=1;MRF32(plat+48)=saved_view_x;vr_web_present(&feedback);
    assert(feedback.views_mask==3 && feedback.views[0].view[12]==123.f);
    assert(feedback.secondary_valid==1 && feedback.secondary.peer_id==88 && feedback.secondary.transform[12]==feedback.local.transform[12]+2);
    vr_web_present(&feedback);assert(!feedback.local_valid && !feedback.secondary_valid && !feedback.views_mask);
    MRF32(plat+64+44)=0;MRF32(plat+64+60)=1;
    remote_car=secondary=0;vr_web_capture(VIEW,plat,CAM,keep,1);vr_web_present(&feedback);
    assert(feedback.gps_metres==1500.f && feedback.gps_metric==1);
    assert(feedback.road_rumble==(argc>1?1.f:0.f));
    now+=70;vr_web_capture(VIEW,plat,CAM,keep,1);vr_web_present(&feedback);assert(feedback.road_rumble==0);
    float x[4], y[4], w[4];
    for (int k = 0; k < 4; k++) { x[k] = MRF32(CAM + k*16u); y[k] = MRF32(CAM + k*16u + 4u); w[k] = MRF32(CAM + k*16u + 12u); }
    assert(vr_web_body_matrix(x,y,w)); x[3] += .1f; assert(!vr_web_body_matrix(x,y,w));
    const float glass[6][3]={{-.12f,1.06f,-.25f},{.12f,1.06f,-.25f},{.12f,1.14f,-.25f},
        {-.12f,1.06f,-.25f},{.12f,1.14f,-.25f},{-.12f,1.14f,-.25f}};
    vr_web_mirror_mesh(glass,6);vr_web_present(&feedback);
    assert(feedback.mirrors.count[0]==6 && !feedback.mirrors.count[1] && !feedback.mirrors.count[2]);
    assert(fabsf(feedback.mirrors.glass[0][0][2]+.248f)<1e-6f);
    /* Cached geometry survives changing source buffers; a large body panel,
     * malformed triangle list or nonfinite position is never glass. */
    float side[6][3];memcpy(side,glass,sizeof side);
    for(int i=0;i<6;i++){side[i][0]=side[i][0]*.7f-.8f;side[i][1]-=.35f;side[i][2]-=.1f;}
    vr_web_mirror_mesh(side,6);vr_web_present(&feedback);assert(feedback.mirrors.count[1]==6);
    VrMirrorVertex selected[192];uint32_t ix[6]={0,1,2,3,4,5};
    for(int i=0;i<6;i++)side[i][0]*=10;
    assert(!vr_mirror_mesh(selected,192,side,6,ix,6,(float[3]){0},1));
    assert(!vr_mirror_mesh(selected,192,glass,6,ix,5,(float[3]){0},0));
    ix[2]=6;assert(!vr_mirror_mesh(selected,192,glass,6,ix,6,(float[3]){0},0));
    assert(vr_web_window_texture(77)); assert(!vr_web_window_texture(78)); assert(!vr_web_window_texture(0));
    MR32(ti + TI_HASH) = 124; vr_web_capture(VIEW, plat, CAM, keep, 1);
    assert(!vr_web_window_texture(77));
    MR32(VIEW + EVIEW_ID) = 2; assert(!vr_web_own_body(RI, VIEW));
    assert(!vr_web_camera(VIEW, CAM, keep)); MR32(VIEW + EVIEW_ID) = 1;
    vr_web_frame_end();
    assert(!vr_web_skip_lens_rain(&rain_cpu,1));
    assert(MR32(G_LIGHT_STREAKS)==1);
    assert(MR32(CAM + CAM_EXCLUDED_CAR) == CAR);
    assert(!memcmp(original, g_mem + CAM, CAM_VIEW_BYTES));
    assert(!vr_web_inside_body(VR_BODY_BOUNDS_RET, RI + CAR_RENDER_LO, RI + CAR_RENDER_HI));
    photo = 1; assert(!vr_web_camera(VIEW, CAM, keep)); assert(!vr_web_gps_panel()); photo = 0;
    assert(MR32(G_LIGHT_STREAKS)==1);
    driving = 0; assert(!vr_web_camera(VIEW, CAM, keep)); assert(!vr_web_gps_panel()); driving = 1;
    /* The intro/countdown can aim its retail cinematic mover at an opponent.
     * The opted-in cockpit still fits the local car, for either transmission. */
    MR32(G_RACE)=0x25000;MR32(G_RACETYPE)=1;driving=0;
    for(unsigned stage=1;stage<=3;stage++) {
        MR32(0x25000)=stage;assert(vr_web_camera(VIEW,CAM,keep));vr_web_frame_end();
        assert(!memcmp(original,g_mem+CAM,CAM_VIEW_BYTES));
    }
    MR32(0x25000)=6;assert(!vr_web_camera(VIEW,CAM,keep));MR32(0x25000)=3;
    MR32(G_RACETYPE)=0;assert(!vr_web_camera(VIEW,CAM,keep));MR32(G_RACETYPE)=1;
    photo=1;assert(!vr_web_camera(VIEW,CAM,keep));photo=0;MR32(0x25000)=4;driving=1;
    /* Frame-local suppression preserves an already disabled preference, yields
     * to another writer, and restores even if Present was skipped. */
    MR32(G_LIGHT_STREAKS)=0;
    assert(vr_web_camera(VIEW,CAM,keep));vr_web_frame_end();
    assert(!MR32(G_LIGHT_STREAKS));
    MR32(G_LIGHT_STREAKS)=1;
    assert(vr_web_camera(VIEW,CAM,keep));MR32(G_LIGHT_STREAKS)=2;vr_web_frame_end();
    assert(MR32(G_LIGHT_STREAKS)==2);
    MR32(G_LIGHT_STREAKS)=1;
    assert(vr_web_camera(VIEW,CAM,keep));vr_web_frame(NULL);
    assert(MR32(G_LIGHT_STREAKS)==1);
    MR32(G_FLOW) = 3; assert(!vr_web_camera(VIEW, CAM, keep)); MR32(G_FLOW) = 6;
    if (argc > 1) { now += 301; vr_web_frame(NULL); assert(!vr_web_camera(VIEW, CAM, keep)); }
    assert(MR32(G_LIGHT_STREAKS)==1);
    const float cards[8][4] = {{-.23f,.39f,1.1f,1},{.09f,.39f,.7f,1},{.09f,.39f,1.1f,1},{-.23f,.39f,.7f,1},
        {-.07f,.15f,1.1f,1},{-.07f,.63f,.7f,1},{-.07f,.63f,1.1f,1},{-.07f,.15f,.7f,1}};
    const uint32_t indices[12] = {1,0,3,4,5,6,5,4,7,0,1,2};
    for (int variant = 0; variant < 24; variant++) {
        float moved[8][4], angle = variant*.261799388f; memcpy(moved, cards, sizeof moved);
        for (int v = 0; v < 8; v++) {
            float a = cards[v][0]+.07f, b = cards[v][1]-.39f;
            moved[v][0] = cosf(angle)*a-sinf(angle)*b-.07f;
            moved[v][1] = sinf(angle)*a+cosf(angle)*b-.39f; moved[v][2] += .5f;
        }
        assert(vr_driver_cards(moved, indices));
    }
    for (int variant = 0; variant < 5; variant++) {
        float bad[8][4]; memcpy(bad,cards,sizeof bad);
        if (variant == 0) bad[0][0] = NAN;
        if (variant == 1) for (int v=0; v<8; v++) bad[v][2] *= 2;
        if (variant == 2) for (int v=0; v<8; v++) bad[v][1] = .39f;
        if (variant == 3) bad[0][3] = 0;
        if (variant == 4) bad[0][2] -= .1f;
        assert(!vr_driver_cards(bad,indices));
    }
    /* Pause can render FEng without another main-camera setup. */
    vr_web_capture(VIEW,plat,CAM,keep,1);assert(hud_layout);
    vr_web_frame(NULL);vr_web_ui_begin();assert(!vr_web_ui_active() && !hud_layout);vr_web_ui_end();
    /* The optical request is owner-bound and has its own heartbeat. A flat
     * cockpit can move the rear capture without claiming tracked controls. */
    enum { MAIN=0x28000,REAR=0x29000,RCAM=0x2c000 };
    MR32(G_FLOW)=6;MR32(G_RACETYPE)=0;MR32(0x25000)=4;
    MR32(SPLIT_PLAYERS_COUNT)=1;MR32(SPLIT_PLAYERS_ORDER)=PLAYER;
    MR32(PLAYER+PLAYER_MAIN_VIEW)=1;MR32(PLAYER+PLAYER_REAR_VIEW)=3;
    MR32(PLAYER+PLAYER_MAIN_MOVER)=MAIN;MR32(PLAYER+PLAYER_REAR_MOVER)=REAR;
    MR32(MAIN+MOVER_KIND)=1;MR32(MAIN+MOVER_VIEW_ID)=1;MR32(MAIN+MOVER_VIEW)=G_VIEW1;
    MR32(MAIN+MOVER_CAMERA)=MR32(G_VIEW1+EVIEW_CAMERA)=CAM;MR32(MAIN+MOVER_CAR)=CAR;MR32(G_VIEW1+EVIEW_MOVERS)=MAIN+4;
    MR32(REAR)=REAR_MOVER_VT;MR32(REAR+MOVER_KIND)=6;MR32(REAR+MOVER_VIEW_ID)=3;MR32(REAR+MOVER_VIEW)=G_VIEW3;
    MR32(REAR+MOVER_CAR)=CAR;MR32(REAR+MOVER_CAMERA)=MR32(G_VIEW3+EVIEW_CAMERA)=RCAM;MR32(G_VIEW3+EVIEW_MOVERS)=REAR+4;
    MR32(G_VIEW3+EVIEW_TARGET)=0x2e000;MR32(G_VIEW3+EVIEW_ID)=3;
    for(int i=0;i<16;i++)MRF32(RCAM+i*4u)=i%5==0;
    MR32(RCAM+CAM_EXCLUDED_CAR)=CAR;memcpy(original,g_mem+RCAM,CAM_VIEW_BYTES);
    mailbox->rear_car=CAR;mailbox->rear_origin[0]=.1f;mailbox->rear_origin[1]=.2f;mailbox->rear_origin[2]=-.5f;mailbox->rear_at_ms=now;
    mailbox->at_ms=now;mailbox->fov_y=1.9f;mailbox->active=argc>1;vr_web_frame(NULL);
    vr_web_views();assert(MR8(G_VIEW3+EVIEW_ACTIVE)==1 && MR32(0x2e000+TARGET_ACTIVE)==1);
    assert(vr_web_camera(G_VIEW3,RCAM,keep)==2);assert(MR16(RCAM+CAM_FOV)==0x6800 && MRF32(RCAM+CAM_NEAR)==.18f && MRF32(RCAM+CAM_FAR)==15000.f);
    assert(MR32(RCAM+CAM_EXCLUDED_CAR)==CAR && !vr_web_own_body(RI,G_VIEW3));
    /* A stale or fresh reflected-eye request cannot move the shared source. */
    assert(!memcmp(original,g_mem+RCAM,64));
    assert(MRF32(RCAM+CAM_EYE)==0 && MRF32(RCAM+CAM_EYE+4)==0 && MRF32(RCAM+CAM_EYE+8)==0);
    /* The wide capture lens must not shorten object lifetime. A six-metre
     * scenery bound at 100 m crosses the retail 16-pixel dropout threshold
     * with the XR lens's scale, but remains above it with the driving lens. */
    enum { WORLD=0x40000,OTHER_VIEW=0x42000 };
    MR16(CAM+CAM_FOV)=0x3000;assert(vr_web_camera(VIEW,CAM,keep)==1);
    MR32(WORLD+WORLD_VIEW_COUNT)=3;
    MR32(WORLD+WORLD_VIEW_OWNER)=VIEW;MR32(WORLD+WORLD_VIEW_FLAGS)=0x601a;
    MR32(WORLD+WORLD_VIEW_STRIDE+WORLD_VIEW_OWNER)=G_VIEW3;
    MR32(WORLD+WORLD_VIEW_STRIDE+WORLD_VIEW_FLAGS)=0x1078;
    MR32(WORLD+2*WORLD_VIEW_STRIDE+WORLD_VIEW_OWNER)=OTHER_VIEW;
    MR32(WORLD+2*WORLD_VIEW_STRIDE+WORLD_VIEW_FLAGS)=0x1078;
    MR32(OTHER_VIEW+EVIEW_ID)=2;MRF32(OTHER_VIEW+EVIEW_LOD_SCALE)=77.f;
    MRF32(VIEW+EVIEW_LOD_SCALE)=180.f;MRF32(G_VIEW3+EVIEW_LOD_SCALE)=77.f;
    MR32(WORLD+WORLD_VIEW_COUNT)=13;vr_web_world_lists(WORLD);
    assert(MRF32(VIEW+EVIEW_LOD_SCALE)==180.f && MR32(WORLD+WORLD_VIEW_STRIDE+WORLD_VIEW_FLAGS)==0x1078);
    MR32(WORLD+WORLD_VIEW_COUNT)=3;
    vr_web_world_lists(WORLD);
    float detail=256.f/tanf(0x3000*(6.283185307f/65536.f)*.5f);
    assert(fabsf(MRF32(VIEW+EVIEW_LOD_SCALE)-detail)<.01f);
    assert(MRF32(G_VIEW3+EVIEW_LOD_SCALE)==MRF32(VIEW+EVIEW_LOD_SCALE));
    assert(180.f*6.f/94.f<16 && detail*6.f/94.f>16);
    assert(MR32(WORLD+WORLD_VIEW_STRIDE+WORLD_VIEW_FLAGS)==0x18);
    assert(MR32(WORLD+WORLD_VIEW_FLAGS)==0x601a);
    assert(MR32(WORLD+2*WORLD_VIEW_STRIDE+WORLD_VIEW_FLAGS)==0x1078 && MRF32(OTHER_VIEW+EVIEW_LOD_SCALE)==77.f);
    vr_web_world_lists(WORLD);assert(MRF32(VIEW+EVIEW_LOD_SCALE)==detail);
    MR32(G_REAR_TEXTURE)=tex;vr_web_capture(G_VIEW3,plat,RCAM,keep,2);float sky_projection[32];memcpy(sky_projection,g_mem+plat+64,sizeof sky_projection);
    CPU sky_cpu={0};sky_cpu.esp=0x38000;sky_cpu.ecx=0x12345;CPU saved_cpu=sky_cpu;
    MR32(sky_cpu.esp)=REAR_WORLD_RET;MR32(sky_cpu.esp+4)=G_VIEW1;vr_web_rear_world(&sky_cpu);assert(!sky_calls);
    MR32(sky_cpu.esp+4)=G_VIEW3;MR32(sky_cpu.esp)=REAR_WORLD_RET+1;vr_web_rear_world(&sky_cpu);assert(!sky_calls);
    MR32(sky_cpu.esp)=REAR_WORLD_RET;vr_web_rear_world(&sky_cpu);assert(sky_calls==1 && flush_calls==1 && !memcmp(&sky_cpu,&saved_cpu,sizeof sky_cpu));
    assert(!memcmp(sky_projection,g_mem+plat+64,sizeof sky_projection));
    vr_web_frame_end();assert(!memcmp(original,g_mem+RCAM,CAM_VIEW_BYTES));assert(MR32(RCAM+CAM_EXCLUDED_CAR)==CAR);
    assert(MRF32(VIEW+EVIEW_LOD_SCALE)==180.f && MRF32(G_VIEW3+EVIEW_LOD_SCALE)==77.f);
    MR32(WORLD+WORLD_VIEW_STRIDE+WORLD_VIEW_FLAGS)=0x1078;
    vr_web_world_lists(WORLD);assert(MR32(WORLD+WORLD_VIEW_STRIDE+WORLD_VIEW_FLAGS)==0x1078);
    vr_web_rear_world(&sky_cpu);assert(sky_calls==1);
    /* Orientation and the road near plane remain independent of glass trim. */
    memset(g_mem+RCAM,0,64);MRF32(RCAM+8)=-1;MRF32(RCAM+16)=1;MRF32(RCAM+36)=-1;MRF32(RCAM+60)=1;
    vr_web_frame(NULL);assert(vr_web_camera(G_VIEW3,RCAM,keep)==2);
    assert(MRF32(RCAM+CAM_NEAR)==.18f);vr_web_frame_end();
    memcpy(g_mem+RCAM,original,CAM_VIEW_BYTES);
    mailbox->rear_car=CAR+4;vr_web_frame(NULL);assert(vr_web_camera(G_VIEW3,RCAM,keep)==2);assert(MRF32(RCAM+CAM_EYE)==0);vr_web_frame_end();
    mailbox->rear_car=CAR;mailbox->rear_at_ms=now-301;vr_web_frame(NULL);assert(vr_web_camera(G_VIEW3,RCAM,keep)==2);assert(MRF32(RCAM+CAM_EYE)==0);vr_web_frame_end();
    /* The extra view never enters retail profile data. Both directions wrap
     * through every PC camera, and only the driving player can select it. */
    MR32(G_PSETTINGS+PS_VIEW)=2;
    assert(!vr_web_cycle(G_PSETTINGS+PS_SIZE,1,4));
    assert(!vr_web_cycle(G_PSETTINGS,0,4) && !vr_web_cycle(G_PSETTINGS,1,5));
    driving=0;assert(!vr_web_cycle(G_PSETTINGS,1,4));driving=1;
    assert(vr_web_cycle(G_PSETTINGS,1,4) && MR32(G_PSETTINGS+PS_VIEW)==0);
    assert(!vr_web_gps_panel());
    for(unsigned i=0;i<4;i++){assert(!vr_web_cycle(G_PSETTINGS,1,4));MR32(G_PSETTINGS+PS_VIEW)++;}
    assert(vr_web_cycle(G_PSETTINGS,1,4) && MR32(G_PSETTINGS+PS_VIEW)==4);
    assert(vr_web_gps_panel());
    assert(vr_web_cycle(G_PSETTINGS,-1,4) && MR32(G_PSETTINGS+PS_VIEW)==4);
    for(unsigned i=4;i>0;i--){assert(!vr_web_cycle(G_PSETTINGS,-1,4));MR32(G_PSETTINGS+PS_VIEW)--;}
    assert(vr_web_cycle(G_PSETTINGS,-1,4) && MR32(G_PSETTINGS+PS_VIEW)==0);
    assert(vr_web_cycle(G_PSETTINGS,1,4) && MR32(G_PSETTINGS+PS_VIEW)==0);
    /* Tracked stock views keep their eye, body exclusion and ordinary HUD.
     * Only the head delta is added; camera bytes restore after Present. */
    memset(g_mem+CAM,0,CAM_VIEW_BYTES);for(int k=0;k<16;k++)MRF32(CAM+k*4u)=k%5==0;
    MRF32(CAM+48)=-2;MR32(CAM+CAM_EXCLUDED_CAR)=CAR;memcpy(original,g_mem+CAM,CAM_VIEW_BYTES);
    mailbox->head_view[12]=-.2f;mailbox->at_ms=now;vr_web_frame(NULL);
    int changed=vr_web_camera(VIEW,CAM,keep);assert(changed==(argc>1?3:0));
    assert(!vr_web_skip_lens_rain(&rain_cpu,1)); /* tracked exterior keeps retail lens rain */
    assert(MR32(CAM+CAM_EXCLUDED_CAR)==CAR && !vr_web_own_body(RI,VIEW));
    assert(!vr_web_inside_body(VR_BODY_BOUNDS_RET,RI+CAR_RENDER_LO,RI+CAR_RENDER_HI));
    if(argc>1){assert(fabsf(MRF32(CAM+48)+2.2f)<1e-6f);assert(vr_web_camera(VIEW,CAM,keep)==3);}
    vr_web_capture(VIEW,plat,CAM,keep,changed);vr_web_present(&feedback);
    assert(!hud_layout && feedback.local_valid==1 && feedback.active==(unsigned)(argc>1));
    vr_web_frame_end();assert(!memcmp(original,g_mem+CAM,CAM_VIEW_BYTES));
    /* Crash/jump cameras keep retail framing in stereo, never a flat cinema.
     * HUD/menu eligibility and photo mode still reject unrelated cameras. */
    driving=0;cinematic=1;vr_web_frame(NULL);
    changed=vr_web_camera(VIEW,CAM,keep);assert(changed==(argc>1?3:0));
    vr_web_capture(VIEW,plat,CAM,keep,changed);vr_web_present(&feedback);
    assert(feedback.active==(unsigned)(argc>1) && !hud_layout);
    vr_web_frame_end();assert(!memcmp(original,g_mem+CAM,CAM_VIEW_BYTES));
    photo=1;vr_web_frame(NULL);assert(!vr_web_camera(VIEW,CAM,keep));photo=0;
    cinematic=0;vr_web_frame(NULL);assert(!vr_web_camera(VIEW,CAM,keep));
    driving=1;vr_web_frame(NULL);assert(vr_web_camera(VIEW,CAM,keep)==(argc>1?3:0));vr_web_frame_end();
    MR32(G_PSETTINGS+PS_VIEW)=4;assert(vr_web_cycle(G_PSETTINGS,1,4));
    driving=0;cinematic=1;vr_web_frame(NULL);assert(vr_web_camera(VIEW,CAM,keep)==(argc>1?3:0));vr_web_frame_end();
    driving=1;cinematic=0;vr_web_frame(NULL);assert(vr_web_camera(VIEW,CAM,keep)==1);vr_web_frame_end();
    if(argc>1){
        /* A new session enters the cockpit even if the guest missed the
         * inactive write between sessions. Pose gaps retain the chosen view. */
        assert(vr_web_cycle(G_PSETTINGS,1,4));
        mailbox->active=0;vr_web_frame(NULL);assert(!vr_web_camera(VIEW,CAM,keep));
        mailbox->active=1;mailbox->at_ms=now;vr_web_frame(NULL);
        assert(vr_web_camera(VIEW,CAM,keep)==3);vr_web_frame_end();
        mailbox->active=2;vr_web_frame(NULL);
        assert(vr_web_camera(VIEW,CAM,keep)==1);vr_web_frame_end();
        assert(vr_web_cycle(G_PSETTINGS,1,4));
        mailbox->active=3;vr_web_frame(NULL);
        assert(vr_web_camera(VIEW,CAM,keep)==1);vr_web_frame_end();
        assert(MR32(G_PSETTINGS+PS_VIEW)==0); /* no extra view in the save */
    }
    free(g_mem); puts("camera lifetime, local body, bounds, other views, photo/menu, crash stereo and stale XR: OK");
    return 0;
}
