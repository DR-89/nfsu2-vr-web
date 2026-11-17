#include "stance.h"
#include "web/vr_web.h"
#include "web/vr_replay.h"
#include "game.h"
#include "guest.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

uint8_t *g_mem;
uint8_t g_cbits[1u<<15];
enum { CAR=0x10000,DRIVER=0x12000,PLAYER=0x18000,SPEC=0x19000,MANAGER=0x20000,STREAM=0x24000,
    UI=0x28000,DIRECTOR=0x2c000,MOVER=0x30000,VT=DRIVE_MOVER_VT,CAM=0x38000,STACK=0x40000,GET=0x45000,SET=0x45010 };
void roam_game_set_car_limit(int limit){(void)limit;}
void lightkey_set_mode(int mode){(void)mode;}
void gpsdistance_set_enabled(int on){(void)on;}
void vinylcat_set_enabled(int on){(void)on;}
void whine_set_enabled(int on){(void)on;}
int stance_configure(const char *models,int enabled){(void)models;(void)enabled;return 1;}
int stance_snapshot(uint32_t car,StanceV *v,int *stock){(void)car;(void)v;(void)stock;return 0;}
static VrMailbox *box;
static double now=1000;
static int driving=1,toggles,mode,created;
void dispatch_indirect(CPU *c,uint32_t fn){
    if(fn==FN_REPLAY_CAMERA){MR32(PLAYER+PLAYER_MAIN_MOVER)=MOVER;MR32(MOVER)=VT;MR32(MOVER+MOVER_KIND)=1;MR32(MOVER+MOVER_CAMERA)=CAM;created++;}
    else if(fn==GET)c->eax=(uint32_t)mode;
    else if(fn==SET)mode=(int)MR32(c->esp+4);
    else if(fn==FN_REPLAY_TIMELINE){MR8(UI+REPLAY_UI_HIDDEN)^=1;toggles++;}
    else assert(!"unexpected call");
    c->esp+=4;
}
double nfsu2_now_ms(void){return now;}
int nfsu2_register(int kind,void *ptr,uint32_t size){assert(kind==8 && size==sizeof(VrMailbox));box=ptr;return 0;}
uint32_t look_driving_car(void){return driving?CAR:0;}
uint32_t look_world_car(void){return look_driving_car();}
void ws_cockpit_hud(int active){(void)active;}
int gpsdistance_read(CPU *c,uint32_t p,float *m,int *u){(void)c;(void)p;(void)m;(void)u;return 0;}
int photo_view(uint16_t *f,float *r,float *j){(void)f;(void)r;(void)j;return 0;}
uint32_t racecars_vr_cars(VrCar *o,uint32_t n,uint32_t *p,uint32_t *c){(void)o;(void)n;(void)p;*c=0;return 0;}
uint32_t roam_game_vr_cars(VrCar *o,uint32_t n){(void)o;(void)n;return 0;}
uint32_t roam_game_vr_local(VrCar *p,VrCar *s){ (void)p;(void)s;return 0; }
static void record(unsigned frame,unsigned ticks){MR32(G_WORLD_STEP)=frame;vr_web_replay_record(MANAGER,REPLAY_TICK_WRITE_RET,ticks);}
static void alive(CPU *c){
    box->active=1;box->at_ms=now;box->fov_y=1.9f;
    for(int k=0;k<16;k++)box->head_view[k]=k%5==0;
    vr_web_frame(c);
}
int main(void){
    /* The bounded history has no sparse allocations, stale race identity or
     * future data after an overwrite. Rewinding only reads the old steps. */
    VrReplay history={0};
    assert(!vr_replay_record(&history,1,2,100,3,101,900));assert(!history.capacity);
    for(unsigned i=0;i<262144;i++)assert(vr_replay_record(&history,1,2,100,3,100+i,i+300));
    assert(history.capacity==262144);assert(!vr_replay_record(&history,1,2,100,3,262244,900));
    assert(vr_replay_find(&history,1,2,100,3,123)->ticks==323);
    assert(!vr_replay_find(&history,1,4,100,3,123));assert(!vr_replay_find(&history,1,2,100,4,123));
    assert(!vr_replay_find(&history,1,2,100,3,99));
    assert(vr_replay_record(&history,1,2,100,3,103,888));assert(!vr_replay_find(&history,1,2,100,3,104));
    assert(vr_replay_record(&history,1,2,100,3,100,777));assert(history.count==1);free(history.steps);
    g_mem=calloc(1,0x1000000);assert(g_mem);
    for(unsigned p=0;p<0x1000000u>>14;p++)g_cbits[p>>3]|=1u<<(p&7);
    CPU cpu={.esp=STACK,.eax=0x7777};
    MR32(G_FLOW)=6;MR32(SPLIT_PLAYERS_INDEX)=MR32(SPLIT_PLAYERS_ORDER)=PLAYER;MR32(PLAYER+4)=CAR;
    MR32(CAR+CAR_INPUT)=DRIVER;MR32(CAR+CAR_SPEC)=SPEC;MR32(SPEC+SPEC_GEARS)=6;MR32(DRIVER)=HUMAN_DRIVER_VT;
    MR32(DRIVER+DRIVER_CAR)=CAR;MR32(DRIVER+DRIVER_TRANSMISSION)=1;MR32(CAR+CAR_GEAR)=2;
    MR32(G_REPLAY)=MANAGER;MR32(MANAGER+REPLAY_STREAM)=STREAM;MR32(MANAGER+REPLAY_FIRST)=100;
    MR32(MANAGER+REPLAY_STARTED)=777;MR32(MANAGER+REPLAY_RECORDING)=1;
    vr_web_frame(&cpu);alive(&cpu);vr_web_driver(DRIVER);
    unsigned gears[]={2,1,0,3,7};
    for(unsigned i=0;i<5;i++){
        record(100+i,300+i);MR32(DRIVER+INPUT_GEAR_REQUEST)=i+2;
        uint32_t before=vr_web_driver_before(DRIVER);assert(before==i+2);
        box->command=(vr_web_gearbox(CAR)&0xffffff00u)|128u|(gears[i]+1);
        MRF32(DRIVER+DRIVER_RAW_GAS)=.6f;MRF32(DRIVER+DRIVER_RAW_BRAKE)=.2f;
        vr_web_driver_after(DRIVER,before);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==gears[i]);
    }
    MR32(MANAGER+REPLAY_RECORDING)=0;MR32(MANAGER+REPLAY_PLAYING)=1;
    /* Snapshot seeks in arbitrary order restore both sides of driver update
     * and direction-specific pedals without a live headset or lever command. */
    box->active=0;vr_web_frame(&cpu);
    unsigned seeks[]={4,0,2,1,3,2};
    for(unsigned j=0;j<6;j++){
        unsigned i=seeks[j];MR32(G_WORLD_STEP)=100+i;MR32(DRIVER+INPUT_GEAR_REQUEST)=99;
        assert(vr_web_replay_ticks(MANAGER,REPLAY_TICK_READ_RET,(300+i)&255u)==300+i);
        assert(vr_web_replay_ticks(MANAGER,REPLAY_TICK_READ_RET,12)==12);
        assert(vr_web_replay_ticks(MANAGER,REPLAY_TICK_READ_RET+1,44)==44);
        vr_web_driver_before(DRIVER);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==i+2);
        MR32(DRIVER+INPUT_GEAR_REQUEST)=88;MRF32(DRIVER+INPUT_THROTTLE)=.2f;MRF32(DRIVER+INPUT_BRAKE)=.6f;
        vr_web_driver_after(DRIVER,99);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==gears[i]);
        if(!gears[i])assert(MRF32(DRIVER+INPUT_THROTTLE)==.6f && MRF32(DRIVER+INPUT_BRAKE)==.2f);
    }
    MR32(MANAGER+REPLAY_ERROR)=1;MR32(DRIVER+INPUT_GEAR_REQUEST)=99;
    assert(vr_web_replay_ticks(MANAGER,REPLAY_TICK_READ_RET,46)==46);
    vr_web_driver_before(DRIVER);vr_web_driver_after(DRIVER,99);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==99);
    MR32(MANAGER+REPLAY_ERROR)=0;MR32(MANAGER+REPLAY_STARTED)++;
    vr_web_driver_before(DRIVER);vr_web_driver_after(DRIVER,99);assert(MR32(DRIVER+INPUT_GEAR_REQUEST)==99);
    /* Each viewer has an epoch, including reuse of its exact address. */
    MR32(G_REPLAY_UI)=UI;MR32(UI)=REPLAY_UI_VT;MR32(G_RACESTATUS)=DIRECTOR;MR32(DIRECTOR)=5;driving=0;
    MR32(G_VIEW1+EVIEW_CAMERA)=CAM;MR32(VT+MOVER_GET_MODE)=GET;MR32(VT+MOVER_SET_MODE)=SET;
    unsigned modes[]={0,2,4,1,0,5};for(unsigned i=0;i<6;i++)MR32(G_REPLAY_VIEWS+4*i)=modes[i];
    alive(&cpu);uint32_t epoch=box->replay_epoch;assert(epoch);
    assert(!vr_web_replay_cycle(&cpu,PLAYER+4));assert(!created);
    assert(vr_web_replay_cycle(&cpu,PLAYER));assert(created==1 && mode==1 && MR32(PLAYER+PLAYER_REPLAY_VIEW)==3);
    assert(cpu.esp==STACK && cpu.eax==0x7777);
    for(unsigned i=1;i<=5;i++){assert(vr_web_replay_cycle(&cpu,PLAYER));assert(MR32(PLAYER+PLAYER_REPLAY_VIEW)==i && mode==(int)modes[i]);}
    MR32(PLAYER+PLAYER_MAIN_MOVER)=0;assert(vr_web_replay_update(&cpu,PLAYER));assert(MR32(PLAYER+PLAYER_MAIN_MOVER)==MOVER && mode==5);
    MR32(DIRECTOR)=3;MR32(G_FLOW)=5;alive(&cpu);assert(box->replay_epoch==epoch);assert(!vr_web_replay_update(&cpu,PLAYER));
    MR32(G_FLOW)=6;MR32(DIRECTOR)=5;alive(&cpu);assert(box->replay_epoch==epoch);assert(vr_web_replay_update(&cpu,PLAYER) && mode==5);
    box->replay_owner=epoch;box->replay_timeline++;alive(&cpu);assert(toggles==1);alive(&cpu);assert(toggles==1);
    box->replay_cameras+=2;alive(&cpu);assert(MR32(PLAYER+PLAYER_REPLAY_VIEW)==1);
    box->replay_owner=epoch+1;box->replay_timeline++;alive(&cpu);assert(toggles==1);
    vr_web_replay_end(UI);assert(!box->replay_epoch);assert(!vr_web_replay_update(&cpu,PLAYER));alive(&cpu);
    assert(box->replay_epoch && box->replay_epoch!=epoch);box->replay_owner=epoch;box->replay_timeline++;alive(&cpu);assert(toggles==1);
    box->replay_owner=box->replay_epoch;box->replay_timeline++;now+=301;vr_web_frame(&cpu);assert(toggles==1);
    MR8(UI+REPLAY_UI_LEAVING)=1;alive(&cpu);assert(!box->replay_epoch);assert(!vr_web_replay_cycle(&cpu,PLAYER));
    free(g_mem);puts("bounded replay history, full ticks, gear seeks, viewer epochs and camera ownership: OK");
}
