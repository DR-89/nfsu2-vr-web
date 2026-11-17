#include "web/vr_rear.h"
#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
uint8_t *g_mem;
uint8_t g_cbits[1u<<15];
enum { PLAYER=0x10000,CAR=0x14000,MAIN=0x18000,REAR=0x1c000,CAM=0x20000,RCAM=0x24000,OTHER=0x28000 };
static unsigned calls;
static int fail;
static void rear(uint32_t mover){
    MR32(PLAYER+PLAYER_REAR_MOVER)=mover;MR32(G_VIEW3+EVIEW_MOVERS)=mover?mover+4:G_VIEW3+EVIEW_MOVERS;
    if(!mover)return;
    MR32(mover)=REAR_MOVER_VT;MR32(mover+MOVER_KIND)=6;MR32(mover+MOVER_VIEW_ID)=3;
    MR32(mover+MOVER_VIEW)=G_VIEW3;MR32(mover+MOVER_CAMERA)=RCAM;MR32(mover+MOVER_CAR)=CAR;
}
void dispatch_indirect(CPU *c,uint32_t address){
    assert(address==FN_PLAYER_REAR && c->ecx==PLAYER && MR32(c->esp)==GUEST_RET_MAINLOOP);
    calls++;if(!fail)rear(MR32(c->esp+4)?REAR:0);
    c->eax=42;c->esp+=8;c->edx=1;
}
int main(void){
    g_mem=calloc(1,0x1000000);assert(g_mem);
    for(unsigned p=0;p<0x1000000u>>14;p++)g_cbits[p>>3]|=1u<<(p&7);
    MR32(G_FLOW)=6;MR32(SPLIT_PLAYERS_INDEX)=MR32(SPLIT_PLAYERS_ORDER)=PLAYER;MR32(SPLIT_PLAYERS_COUNT)=1;
    MR32(PLAYER+4)=CAR;MR32(PLAYER+PLAYER_MAIN_VIEW)=1;MR32(PLAYER+PLAYER_REAR_VIEW)=3;MR32(PLAYER+PLAYER_MAIN_MOVER)=MAIN;
    MR32(MAIN+MOVER_KIND)=1;MR32(MAIN+MOVER_VIEW_ID)=1;MR32(MAIN+MOVER_VIEW)=G_VIEW1;
    MR32(MAIN+MOVER_CAMERA)=MR32(G_VIEW1+EVIEW_CAMERA)=CAM;MR32(MAIN+MOVER_CAR)=CAR;
    MR32(G_VIEW1+EVIEW_MOVERS)=MAIN+4;MR32(G_VIEW3+EVIEW_CAMERA)=RCAM;rear(0);
    CPU c={0};c.esp=0x40000;c.ecx=0x1234;c.edx=0x5678;CPU saved=c;VrRearOwner owned={0};
    assert(!vr_rear_update(&owned,&c,0) && !calls);
    assert(vr_rear_update(&owned,&c,1)==1 && calls==1 && owned.rear==REAR && !memcmp(&saved,&c,sizeof c));
    assert(!vr_rear_update(&owned,&c,1) && calls==1);
    assert(vr_rear_update(&owned,&c,0)==-1 && calls==2 && !owned.rear && !memcmp(&saved,&c,sizeof c));
    /* Existing profile camera, a different list owner and cinematic main
     * cameras remain untouched, regardless of cockpit selection. */
    rear(OTHER);assert(!vr_rear_update(&owned,&c,1));assert(!vr_rear_update(&owned,&c,0));assert(calls==2);
    rear(0);MR32(G_VIEW3+EVIEW_MOVERS)=OTHER;assert(!vr_rear_update(&owned,&c,1));assert(calls==2);
    rear(0);MR32(G_VIEW1+EVIEW_MOVERS)=OTHER;assert(!vr_rear_update(&owned,&c,1));MR32(G_VIEW1+EVIEW_MOVERS)=MAIN+4;
    MR32(SPLIT_PLAYERS_ORDER)=OTHER;assert(!vr_rear_update(&owned,&c,1));MR32(SPLIT_PLAYERS_ORDER)=PLAYER;
    fail=1;assert(!vr_rear_update(&owned,&c,1) && calls==3 && !owned.rear);fail=0;
    assert(vr_rear_update(&owned,&c,1)==1 && calls==4);
    rear(OTHER);assert(!vr_rear_update(&owned,&c,0) && calls==4 && !owned.rear);
    rear(0);assert(vr_rear_update(&owned,&c,1)==1);MR32(G_FLOW)=3;
    assert(!vr_rear_update(&owned,&c,0) && !owned.rear && calls==5);MR32(G_FLOW)=6;
    assert(!vr_rear_update(&owned,&c,0) && calls==5); /* Not ours after a loading transition. */
    rear(0);assert(vr_rear_update(&owned,&c,1)==1);MR32(MAIN+MOVER_CAR)=OTHER;
    assert(!vr_rear_update(&owned,&c,0) && !owned.rear && calls==6);MR32(MAIN+MOVER_CAR)=CAR;
    rear(0);assert(vr_rear_update(&owned,&c,1)==1);MR32(G_VIEW3+EVIEW_MOVERS)=OTHER;
    assert(!vr_rear_update(&owned,&c,0) && calls==7);MR32(G_VIEW3+EVIEW_MOVERS)=REAR+4;
    assert(vr_rear_update(&owned,&c,0)==-1 && calls==8);
    free(g_mem);puts("rear camera ownership, foreign movers, recycled owners and CPU preservation: OK");
}
