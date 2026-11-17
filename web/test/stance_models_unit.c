#include "stance_models.h"
#include "cpu.h"
#include "guest.h"
#include "game.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

uint8_t *g_mem;
uint8_t g_cbits[1u<<15];
enum { TYPES=0x10000,REC=0x30000,CAR=0x40000,RIDE=0x41000 };
uint32_t garage_find(uint32_t db,uint32_t h){return db==G_FECARS&&h==7?REC:0;}
uint32_t modparts_car_type(int p,uint32_t r){return p==0&&r==REC?MR32(r+0x20):0;}
uint32_t coop_p2_car(void){return 0;}
int coop_racing_together(void){return 0;}
int modpacks_others_original(void){return 0;}
int plates_fe_ours(void){return 1;}
const char *plates_fe_screen(void){return "GarageMain.fng";}
void stance_draw_begin(CPU *c);
void stance_draw_end(void);

int main(void){
    StanceModels models={0};assert(stance_models_parse("v1|350Z:35,0,-40,80,130",&models));
    assert(models.count==1&&models.car[0].value.fo==-40);
    const char *bad[]={"v2","v1|","v1|350z:0,0,0,0,100","v1|350Z:0,0,0,0,100|350Z:0,0,0,0,100",
      "v1|350Z:151,0,0,0,100","v1|350Z:0,-1,0,0,100","v1|350Z:0,0,-41,0,100","v1|350Z:0,0,0,81,100",
      "v1|350Z:0,0,0,0,79","v1|350Z:0,0,0,0,131","v1|350Z:9999999999999,0,0,0,100","v1|350Z:0,0,0,0,100x",
      "v1|ABCDEFGHIJKLMNOP:0,0,0,0,100","v1|350Z:0,0,0,0","v1|350Z:+0,0,0,0,100"};
    for(unsigned i=0;i<sizeof bad/sizeof bad[0];i++){StanceModels before=models;assert(!stance_models_parse(bad[i],&models));assert(!memcmp(&before,&models,sizeof models));}
    char big[4097];memset(big,'a',sizeof big-1);big[sizeof big-1]=0;assert(!stance_models_parse(big,&models));
    char list[4096]="v1";for(int i=0;i<46;i++){char row[80];snprintf(row,sizeof row,"|CAR%d:150,150,-40,80,130",i);strcat(list,row);}
    assert(stance_models_parse(list,&models)&&models.count==46);strcat(list,"|EXTRA:0,0,0,0,100");assert(!stance_models_parse(list,&models));

    g_mem=calloc(1,0x1000000);assert(g_mem);memset(g_cbits,0xff,sizeof g_cbits);
    MR32(G_CARTYPES)=TYPES;strcpy((char*)g_mem+TYPES,"350Z");MR32(TYPES+0xd0)=0x1234;
    strcpy((char*)g_mem+TYPES+0x890,"SKYLINE");MR32(TYPES+0x890+0xd0)=0x5678;
    MR32(G_GAMEMODE)=1;MR32(G_CAREER_CAR)=7;MR32(REC+0x20)=0x1234;
    MR32(CAR+CAR_TYPEINFO)=TYPES;MR32(CAR+0x10)=RIDE;MR8(RIDE+0x363)=1;
    setenv("NFSU2_STANCE","1",1);setenv("NFSU2_STANCE_MODELS","v1|350Z:50,10,3,4,110",1);
    assert(stance_on());stance_loaded(0,"");uint32_t entry[8]={7,0x1234,70,0,100,0,0,STANCE_KIND};assert(stance_load(0,entry));
    assert(stance_mine(0)->fc==50&&stance_mine(0)->tw==110);
    StanceV value;int stock;assert(stance_snapshot(CAR,&value,&stock)&&stock==35&&value.fc==50);
    uint32_t saved[2][8];assert(stance_entries(0,saved,2)==1&&!memcmp(saved[0],entry,sizeof entry));
    assert(!stance_configure("v1|350Z:900,0,0,0,100",0));assert(stance_on()&&stance_mine(0)->fc==50);
    assert(stance_configure("v1|350Z:50,10,3,4,110",0));assert(!stance_on()&&!stance_mine(0));
    assert(stance_snapshot(CAR,&value,&stock)&&value.fc==50);
    assert(stance_configure("v1",1));assert(stance_mine(0)->fc==70);assert(stance_entries(0,saved,2)==1&&!memcmp(saved[0],entry,sizeof entry));
    assert(stance_configure("v1|350Z:20,0,0,0,100|SKYLINE:80,40,6,7,120",1));
    MR32(REC+0x20)=0x5678;MR32(CAR+CAR_TYPEINFO)=TYPES+0x890;assert(stance_mine(0)->fc==80);
    assert(stance_snapshot(CAR,&value,&stock)&&value.tw==120);assert(!stance_snapshot(0,&value,&stock));
    /* Model defaults use the original visual-only draw path: wheel positions,
     * tire widths and camber constants restore byte-for-byte before physics. */
    enum { RI=0x45000,PLAYER=0x46000,STACK=0x47000,WHEELS=0x48000 };
    MR32(G_FLOW)=6;MR32(SPLIT_PLAYERS_INDEX)=PLAYER;MR32(PLAYER+4)=CAR;MR32(RI)=CAR;MR32(RI+4)=RIDE;
    for(int i=0;i<8;i++)MRF32(RI+0x400+i*4)=i%2?.8f:-.8f;
    for(int i=0;i<4;i++){MRF32(RI+0x420+i*4)=.2f;for(int j=0;j<16;j++)MRF32(WHEELS+i*64+j*4)=j%5==0;}
    MRF32(0x7a6750)=.5f;MRF32(0x7a6754)=7;MRF32(0x7a6758)=.03f;
    MR32(STACK+0x14)=WHEELS;MR32(STACK+0x1c)=WHEELS+256;memcpy(g_mem+WHEELS+256,g_mem+WHEELS,256);
    uint8_t before_ri[0x430],before_wheels[512],before_camber[12];memcpy(before_ri,g_mem+RI,sizeof before_ri);memcpy(before_wheels,g_mem+WHEELS,sizeof before_wheels);memcpy(before_camber,g_mem+0x7a6750,sizeof before_camber);
    CPU cpu={0};cpu.ecx=RI;cpu.esp=STACK;stance_draw_begin(&cpu);
    assert(MRF32(0x7a6754)==8 && fabsf(MRF32(RI+0x400)+.806f)<1e-6f && fabsf(MRF32(RI+0x420)-.24f)<1e-6f);
    assert(memcmp(before_wheels,g_mem+WHEELS,sizeof before_wheels));stance_draw_end();
    assert(!memcmp(before_ri,g_mem+RI,sizeof before_ri)&&!memcmp(before_wheels,g_mem+WHEELS,sizeof before_wheels)&&!memcmp(before_camber,g_mem+0x7a6750,sizeof before_camber));
    assert(stance_configure("v1|SKYLINE:80,40,6,7,120",0));stance_draw_begin(&cpu);assert(!memcmp(before_ri,g_mem+RI,sizeof before_ri));stance_draw_end();
    free(g_mem);puts("stance model defaults: atomic parsing, precedence, stock snapshot and original garage saves OK");return 0;
}
