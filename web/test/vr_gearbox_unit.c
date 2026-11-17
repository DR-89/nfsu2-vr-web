#include "stance.h"
#include "web/vr_web.h"
#include "web/vr_feedback.h"
#include "game.h"
#include "guest.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

uint8_t *g_mem;
uint8_t g_cbits[1u << 15];
void dispatch_indirect(CPU *c,uint32_t addr){ (void)c;(void)addr;assert(!"unexpected guest call"); }
void roam_game_set_car_limit(int limit){(void)limit;}
void lightkey_set_mode(int mode){(void)mode;}
void gpsdistance_set_enabled(int on){(void)on;}
void vinylcat_set_enabled(int on){(void)on;}
void whine_set_enabled(int on){(void)on;}
int stance_configure(const char *models,int enabled){(void)models;(void)enabled;return 1;}
int stance_snapshot(uint32_t car,StanceV *v,int *stock){(void)car;(void)v;(void)stock;return 0;}
static VrMailbox *box;
static double now = 1000;
static int driving = 1;
void ws_cockpit_hud(int active){ (void)active; }
int gpsdistance_read(CPU *c,uint32_t p,float *m,int *units){ (void)c;(void)p;(void)m;(void)units;return 0; }
enum { CAR=0x10000, DRIVER=0x12000, PLAYER=0x18000, SPEC=0x19000 };
double nfsu2_now_ms(void){ return now; }
int nfsu2_register(int kind, void *ptr, uint32_t size){ assert(kind==8 && size==sizeof(VrMailbox));box=ptr;return 0; }
uint32_t look_driving_car(void){ return driving?CAR:0; }
uint32_t look_world_car(void){return look_driving_car();}
int photo_view(uint16_t *f,float *r,float *j){ (void)f;(void)r;(void)j;return 0; }
uint32_t racecars_vr_cars(VrCar *o,uint32_t n,uint32_t *p,uint32_t *c){ (void)o;(void)n;(void)p;*c=0;return 0; }
uint32_t roam_game_vr_cars(VrCar *o,uint32_t n){ (void)o;(void)n;return 0; }
uint32_t roam_game_vr_local(VrCar *p,VrCar *s){ (void)p;(void)s;return 0; }
static void publish(uint32_t command){
    box->active=1;box->command=command;box->at_ms=now;box->fov_y=1.9f;
    for(int k=0;k<16;k++)box->head_view[k]=k%5==0;
    vr_web_frame(NULL);
}
static void request(uint32_t token,unsigned gear){ publish((token&0xffffff00u)|128u|(gear+1u));vr_web_driver(DRIVER); }
int main(void){
    /* A 4-ms impact survives display sampling at 30/72/120 Hz. */
    for(int i=0;i<3;i++) {
        VrRoad r={0};vr_road_report(&r,1,1,.2f);vr_road_report(&r,5,0,0);
        const int frame_ms[]={33,14,8};assert(vr_road_sample(&r,frame_ms[i])==1);
        assert(vr_road_sample(&r,67)==0);
    }
    VrRoad r={0};
    for(int t=0;t<2000;t+=16){vr_road_report(&r,t,.18f,.13f);assert(vr_road_sample(&r,t)>.04f && vr_road_sample(&r,t)<.08f);}
    assert(vr_road_sample(&r,2250)==0);vr_road_report(&r,2300,NAN,INFINITY);assert(vr_road_sample(&r,2300)==0);
    g_mem=calloc(1,0x1000000);assert(g_mem);
    for(unsigned p=0;p<0x1000000u>>14;p++)g_cbits[p>>3]|=1u<<(p&7);
    MR32(G_FLOW)=6;MR32(SPLIT_PLAYERS_INDEX)=PLAYER;MR32(PLAYER+4)=CAR;
    MR32(CAR+CAR_INPUT)=DRIVER;MR32(CAR+CAR_SPEC)=SPEC;MR32(CAR+CAR_GEAR)=2;
    MR32(SPEC+SPEC_GEARS)=6;MR32(DRIVER)=HUMAN_DRIVER_VT;MR32(DRIVER+DRIVER_CAR)=CAR;MR32(DRIVER+DRIVER_TRANSMISSION)=1;
    MRF32(DRIVER+DRIVER_RAW_GAS)=.5f;MRF32(DRIVER+DRIVER_RAW_BRAKE)=.25f;
    vr_web_frame(NULL);publish(0);vr_web_driver(DRIVER);
    uint32_t token=vr_web_gearbox(CAR);assert((token&255u)==30u && (token>>8));
    request(token,1);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==1);assert(MR32(CAR+CAR_GEAR)==2);
    request(token,7);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==7);
    /* A button arrives between frame sampling and HumanDriver::Update. */
    box->command=0;MR32(DRIVER+INPUT_GEAR_REQUEST)=3;vr_web_driver(DRIVER);
    assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==3);
    request(token,7);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==7);
    request(token,8);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==7);
    request(token,0);assert(!MR32(DRIVER+INPUT_GEAR_REQUEST));
    assert(MRF32(DRIVER+INPUT_THROTTLE)==.5f && MRF32(DRIVER+INPUT_BRAKE)==.25f && MRF32(CAR+CAR_THROTTLE)==.5f);
    MR32(DRIVER+INPUT_GEAR_REQUEST)=2;publish(0);vr_web_driver(DRIVER);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==2);
    MR32(DRIVER+DRIVER_TRANSMISSION)=2;request(token,5);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==2);
    assert(!(vr_web_gearbox(CAR)&8u));
    MR32(DRIVER+DRIVER_TRANSMISSION)=1;request(token,5);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==2);
    token=vr_web_gearbox(CAR);request(token,5);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==5);
    driving=0;request(token,3);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==5);assert(!(vr_web_gearbox(CAR)&16u));
    driving=1;request(token,3);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==5);
    token=vr_web_gearbox(CAR);MR8(DRIVER+DRIVER_GRID_LOCK)=1;request(token,2);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==5);
    MR8(DRIVER+DRIVER_GRID_LOCK)=0;vr_web_driver(DRIVER);token=vr_web_gearbox(CAR);
    request(token,3);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==3);
    box->seq=1;box->command=(token&0xffffff00u)|128u|6u;now+=16;
    vr_web_frame(NULL);vr_web_driver(DRIVER);
    assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==3 && (vr_web_gearbox(CAR)>>8)==(token>>8));
    box->seq=2;publish((token&0xffffff00u)|128u|4u);vr_web_driver(DRIVER);
    /* The worker keeps ticking during a page stall. Expiry must invalidate
     * the epoch even though the driver metadata itself stays fresh. */
    for(int i=0;i<20;i++){now+=16;vr_web_frame(NULL);vr_web_driver(DRIVER);}
    assert(vr_web_gearbox(CAR)>>8 != token>>8);
    MR32(DRIVER+INPUT_GEAR_REQUEST)=2;request(token,3);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==2);
    token=vr_web_gearbox(CAR);request(token,3);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==3);
    box->active=0;vr_web_frame(NULL);vr_web_driver(DRIVER);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==3);
    publish((token&0xffffff00u)|128u|5u);now+=301;vr_web_frame(NULL);vr_web_driver(DRIVER);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==3);
    assert(!vr_web_gearbox(CAR+4));
    /* Real stage ordering: the stage listener runs before the director stores
     * stage 4. A locked driver may not poll or have an input source yet. */
    const uint32_t race=0x1a000;MR32(G_RACE)=race;MR32(race)=2;MR32(G_RACETYPE)=1;
    MR32(DRIVER+DRIVER_SOURCE)=UINT32_MAX;MR8(DRIVER+DRIVER_GRID_LOCK)=1;MR32(DRIVER+DRIVER_NO_INPUT)=1;
    driving=0;MR32(CAR+CAR_GEAR)=1;MR32(DRIVER+INPUT_GEAR_REQUEST)=1;
    MRF32(DRIVER+INPUT_THROTTLE)=.4f;MRF32(DRIVER+INPUT_BRAKE)=1.f;
    MRF32(CAR+CAR_SPEED)=2.f;publish(128u);assert(!(vr_web_gearbox(CAR)&VR_GEAR_GRID));
    MRF32(CAR+CAR_SPEED)=0.f;publish(128u);token=vr_web_gearbox(CAR);
    assert((token&(VR_GEAR_GRID|VR_GEAR_COUNTDOWN|VR_GEAR_READY))==(VR_GEAR_GRID|VR_GEAR_COUNTDOWN|VR_GEAR_READY));
    assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==1);
    request(token,7);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==1);
    assert(MRF32(DRIVER+INPUT_THROTTLE)==.4f && MRF32(DRIVER+INPUT_BRAKE)==1.f);
    vr_web_stage(CAR+4,5,4);assert(vr_web_gearbox(CAR)==token);
    vr_web_stage(CAR,3,2);MR32(race)=3;vr_web_driver(DRIVER);assert(vr_web_gearbox(CAR)==token);
    vr_web_stage(CAR,4,3);MR32(DRIVER+INPUT_GEAR_REQUEST)=2;vr_web_grid_apply(DRIVER);
    assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==1); /* retail first-gear call cannot launch neutral */
    MR32(race)=4;MR8(DRIVER+DRIVER_GRID_LOCK)=0;MR32(DRIVER+DRIVER_NO_INPUT)=0;MR32(DRIVER+DRIVER_SOURCE)=0;driving=1;
    vr_web_driver(DRIVER);assert((vr_web_gearbox(CAR)>>8)==(token>>8));assert(!(vr_web_gearbox(CAR)&VR_GEAR_COUNTDOWN));
    request(token,2);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==2 && MR32(CAR+CAR_GEAR)==1);
    assert(vr_web_gearbox(CAR)&VR_GEAR_FIRST);
    MR32(CAR+CAR_GEAR)=2;vr_web_driver(DRIVER);assert(!(vr_web_gearbox(CAR)&VR_GEAR_GRID));
    assert((vr_web_gearbox(CAR)>>8)==(token>>8));request(token,7);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==7);
    /* A new countdown clears the old target. Preset first survives GO, and
     * pause preserves the selection without writing through its input lock. */
    MR32(race)=2;driving=0;MR8(DRIVER+DRIVER_GRID_LOCK)=1;vr_web_stage(CAR,2,4);vr_web_driver(DRIVER);
    request(token,2);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==1);token=vr_web_gearbox(CAR);
    request(token,2);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==2);
    vr_web_stage(CAR,6,2);MR32(race)=6;MR32(DRIVER+INPUT_GEAR_REQUEST)=1;vr_web_driver(DRIVER);
    assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==1);assert((vr_web_gearbox(CAR)&(VR_GEAR_GRID|VR_GEAR_FIRST))==(VR_GEAR_GRID|VR_GEAR_FIRST));
    vr_web_stage(CAR,2,6);MR32(race)=2;vr_web_driver(DRIVER);token=vr_web_gearbox(CAR);request(token,2);
    vr_web_stage(CAR,4,2);MR32(race)=4;MR8(DRIVER+DRIVER_GRID_LOCK)=0;driving=1;vr_web_grid_apply(DRIVER);
    assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==2);vr_web_driver(DRIVER);assert(!(vr_web_gearbox(CAR)&VR_GEAR_GRID));
    /* Opt-out during the countdown yields to the usual controls for this
     * start, even if the headset continues publishing afterward. */
    MR32(race)=2;driving=0;vr_web_stage(CAR,2,4);vr_web_driver(DRIVER);assert(vr_web_gearbox(CAR)&VR_GEAR_GRID);
    publish(0);assert(!(vr_web_gearbox(CAR)&VR_GEAR_GRID));publish(128u);assert(!(vr_web_gearbox(CAR)&VR_GEAR_GRID));
    vr_web_stage(CAR,4,3);MR32(DRIVER+INPUT_GEAR_REQUEST)=2;vr_web_grid_apply(DRIVER);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==2);
    MR32(DRIVER+DRIVER_TRANSMISSION)=2;vr_web_stage(CAR,2,1);MR32(race)=2;publish(128u);assert(!(vr_web_gearbox(CAR)&VR_GEAR_GRID));
    MR32(DRIVER+DRIVER_TRANSMISSION)=1;MR32(G_RACETYPE)=0;vr_web_stage(CAR,2,1);publish(128u);assert(!(vr_web_gearbox(CAR)&VR_GEAR_GRID));
    /* A replacement AI controller cannot be mistaken for HumanDriver. */
    MR32(DRIVER)=0x123456;MR32(G_RACETYPE)=1;vr_web_stage(CAR,2,1);publish(128u);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==2);
    free(g_mem);puts("gear requests, original gearbox, reverse pedals, manual-only, driver epochs and stale input: OK");
}
