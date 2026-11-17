#ifndef NFSU2_VR_REAR_H
#define NFSU2_VR_REAR_H
#include "guest.h"
#include "game.h"
#include "splitscreen_mem.h"
#include <string.h>

typedef struct { uint32_t player,car,main,rear; } VrRearOwner;
typedef struct { VrRearOwner owner; int main_active,rear_empty,rear_valid,rear_linked; } VrRearSnapshot;

/* Re-read the live registry before touching a mover. Race transitions can
 * recycle both Player and camera allocations while the page still has a pose. */
static int vr_rear_snapshot(VrRearSnapshot *s){
    memset(s,0,sizeof *s);
    if(guest_rd32(G_FLOW)!=6)return 0;
    uint32_t player=guest_rd32(SPLIT_PLAYERS_INDEX),count=guest_rd32(SPLIT_PLAYERS_COUNT);
    if(!count || count>SPLIT_PORT_CAPACITY || !guest_ok(player,PLAYER_REAR_MOVER+3u))return 0;
    int registered=0;
    for(uint32_t i=0;i<count;i++)if(guest_rd32(SPLIT_PLAYERS_ORDER+4*i)==player)registered=1;
    if(!registered || guest_rd32(player+PLAYER_MAIN_VIEW)!=1 || guest_rd32(player+PLAYER_REAR_VIEW)!=3)return 0;
    s->owner=(VrRearOwner){player,guest_rd32(player+4u),guest_rd32(player+PLAYER_MAIN_MOVER),guest_rd32(player+PLAYER_REAR_MOVER)};
    uint32_t main=s->owner.main,rear=s->owner.rear;
    if(!guest_ok(s->owner.car,CAR_RENDER_INFO+3u) || !guest_ok(main,MOVER_CAR+3u) ||
       guest_rd32(main+MOVER_KIND)!=1 || guest_rd32(main+MOVER_VIEW_ID)!=1 ||
       guest_rd32(main+MOVER_VIEW)!=G_VIEW1 || guest_rd32(main+MOVER_CAR)!=s->owner.car ||
       !guest_rd32(G_VIEW1+EVIEW_CAMERA) || guest_rd32(main+MOVER_CAMERA)!=guest_rd32(G_VIEW1+EVIEW_CAMERA))return 0;
    s->main_active=guest_rd32(G_VIEW1+EVIEW_MOVERS)==main+4;
    uint32_t head=guest_rd32(G_VIEW3+EVIEW_MOVERS);
    s->rear_empty=!head || head==G_VIEW3+EVIEW_MOVERS;
    s->rear_linked=rear && head==rear+4;
    s->rear_valid=guest_ok(rear,MOVER_CAR+3u) && guest_rd32(rear)==REAR_MOVER_VT &&
        guest_rd32(rear+MOVER_KIND)==6 && guest_rd32(rear+MOVER_VIEW_ID)==3 &&
        guest_rd32(rear+MOVER_VIEW)==G_VIEW3 && guest_rd32(rear+MOVER_CAR)==s->owner.car &&
        guest_rd32(G_VIEW3+EVIEW_CAMERA) && guest_rd32(rear+MOVER_CAMERA)==guest_rd32(G_VIEW3+EVIEW_CAMERA);
    return 1;
}
static int vr_rear_same(const VrRearOwner *a,const VrRearOwner *b){
    return a->player==b->player && a->car==b->car && a->main==b->main;
}
/* The original setter deletes an existing rear mover. Only create in an
 * empty view, and only remove the exact mover this feature created. */
static int vr_rear_update(VrRearOwner *owned,CPU *c,int selected){
    VrRearSnapshot s;
    if(!vr_rear_snapshot(&s)){memset(owned,0,sizeof *owned);return 0;}
    if(!vr_rear_same(owned,&s.owner) || owned->rear!=s.owner.rear)memset(owned,0,sizeof *owned);
    uint32_t enabled=1;
    if(c && selected && s.main_active && !s.owner.rear && s.rear_empty){
        gcall_main(c,FN_PLAYER_REAR,s.owner.player,1,&enabled);
        VrRearSnapshot next;
        if(vr_rear_snapshot(&next) && vr_rear_same(&s.owner,&next.owner) && next.rear_valid && next.rear_linked){
            *owned=next.owner;return 1;
        }
    }else if(c && !selected && owned->rear && s.rear_valid && s.rear_linked){
        enabled=0;gcall_main(c,FN_PLAYER_REAR,s.owner.player,1,&enabled);
        memset(owned,0,sizeof *owned);return -1;
    }
    return 0;
}
#endif
