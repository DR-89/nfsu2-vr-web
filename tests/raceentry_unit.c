#include "raceentry.h"
#include "raceactions.h"
#include "guest.h"
#include "game.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
uint8_t *g_mem,g_cbits[1u<<15];
static uint8_t memory[0x900000];
static const char *pack;
static int online=1,saving,alone=1,exploring=1,other,owned=1;
static unsigned calls,last_fn,last_arg;
int career_fe_active(const char *name){return pack&&!strcmp(pack,name);}
int savegame_busy(void){return saving;}
int winsock_online(void){return online;}
int roam_game_alone(void){return alone;}
int roam_exploring(void){return exploring;}
int mprace_car_ok(void){return owned;}
unsigned mprace_phase(void){return (unsigned)other;}
void dispatch_indirect(CPU *c,uint32_t fn){
    assert(MR32(c->esp)==GUEST_RET_MAINLOOP);calls++;last_fn=fn;last_arg=MR32(c->esp+4);
    switch(fn){
    case FN_NEW: assert(last_arg==128);c->eax=0x10000;break;
    case FN_RB_LOGIN: assert(last_arg==S_RB_MAIN&&MR32(G_GAMEMODE)==8);pack="UI_OLMAIN.fng";break;
    case FN_RB_SWITCH:
        if(last_arg==S_RB_OLMAIN){assert(MR32(c->esp+8)==S_RB_LOBBY);pack="PC_OL_Lobby.fng";}
        else{assert(last_arg==S_RB_MAIN);assert(!strcmp((char*)g_mem+MR32(c->esp+8),"UI_StartCareer.fng"));pack="UI_StartCareer.fng";}
        break;
    case FN_RB_SEND:
        if(last_arg==MSG_RB_QUIT_YES){assert(!strcmp((char*)g_mem+MR32(c->esp+8),"UI_Pause.fng"));}
        else{assert(last_arg==MSG_RB_EXPLORE);assert(!strcmp((char*)g_mem+MR32(c->esp+8),"UI_CareerCrib.fng"));}
        break;
    case FN_RB_DISCONNECT: assert(last_arg==S_RB_LOBBY);pack="UI_Main.fng";MR32(G_GAMEMODE)=2;break;
    case FN_RB_RESET_PARAMS: assert(c->ecx==G_RACEPARAMS);MR32(G_RACEPARAMS)=2000;MR32(G_RACETYPE)=0;MR32(G_RACEPARAMS+0x74)=0;break;
    case FN_RB_RESUME: assert(last_arg==1);pack="UI_CareerCrib.fng";MR32(G_GAMEMODE)=1;break;
    default: assert(!"unexpected guest call");
    }
}
static void main_menu(void){pack="UI_Main.fng";MR32(G_FLOW)=3;MR32(G_GAMEMODE)=2;}
int main(void){
    g_mem=memory;memset(g_cbits,255,sizeof g_cbits);CPU c={0};c.esp=0x80000;CPU before=c;
    main_menu();strcpy((char*)g_mem+G_PROFILE_NAME,"Career");MR32(G_PROFILE_NAME+32)=1;
    assert(raceentry_flags()==RE_CAN_ENTER);
    online=0;assert(!raceentry_flags());assert(raceentry_enter(&c,0)==RA_UNAVAILABLE);online=1;
    saving=1;assert(!raceentry_flags());saving=0;MR32(G_RB_DIALOG)=1;assert(!raceentry_flags());MR32(G_RB_DIALOG)=0;
    assert(raceentry_enter(&c,0)==RA_ACCEPTED);assert(raceentry_enter(&c,0)==RA_UNAVAILABLE);assert(raceentry_owns_input());
    raceentry_frame(&c,200);assert(last_fn==FN_RB_LOGIN);assert(raceentry_owns_input());
    MR32(G_ONLINE_PROFILE+0x50)=17;raceentry_frame(&c,400);assert(last_fn==FN_RB_SWITCH);assert(raceentry_flags()==(RE_ACTIVE|RE_CAN_EXIT));
    assert(!raceentry_owns_input());assert(raceentry_exit(&c,500)==RA_ACCEPTED);raceentry_frame(&c,700);assert(last_fn==FN_RB_DISCONNECT);
    raceentry_frame(&c,2300);assert(raceentry_flags()==RE_CAN_ENTER);assert(!memcmp(&c,&before,sizeof c));
    /* A paused career uses QuitYes, then the original resume and Explore.
     * Save/dialog handoffs pause the timeout and never issue guest calls. */
    pack="UI_Pause.fng";MR32(G_FLOW)=6;MR32(G_GAMEMODE)=1;MR32(G_RACESTATUS)=0x20000;MR32(0x20000)=6;MR32(G_RACEPARAMS+0x20)=1;
    MR32(G_CAREER_CAR)=123;MR32(G_QR_CAR)=456;MR32(G_QR_CAR_CATEGORY)=2;
    alone=0;assert(!raceentry_flags());alone=1;MR32(G_CAREER_RACE)=55;assert(!raceentry_flags());MR32(G_CAREER_RACE)=0;
    assert(raceentry_enter(&c,3000)==RA_ACCEPTED);unsigned count=calls;saving=1;raceentry_frame(&c,200000);assert(calls==count&&!raceentry_owns_input());saving=0;
    MR32(G_RB_DIALOG)=1;raceentry_frame(&c,300000);assert(calls==count&&!raceentry_owns_input());MR32(G_RB_DIALOG)=0;
    raceentry_frame(&c,300010);assert(last_arg==MSG_RB_QUIT_YES);
    main_menu();MR8(G_START_KEEP)=1;memset(g_mem+G_START_POS,7,12);MR16(G_START_HEAD)=0x1234;
    raceentry_frame(&c,302000);raceentry_frame(&c,302200);assert(MR32(G_QR_CAR)==123&&MR32(G_QR_CAR_CATEGORY)==4);
    assert(raceentry_flags()==(RE_ACTIVE|RE_CAREER|RE_CAN_EXIT));
    assert(raceentry_exit(&c,302400)==RA_ACCEPTED);raceentry_frame(&c,302600);raceentry_frame(&c,304200);raceentry_frame(&c,304400);
    assert(last_fn==FN_RB_SWITCH&&MR32(G_QR_CAR)==456&&MR32(G_QR_CAR_CATEGORY)==2);
    raceentry_frame(&c,304600);assert(last_fn==FN_RB_RESUME);MR32(G_PROFILE_AUTOSAVE)=1;count=calls;
    raceentry_frame(&c,305000);raceentry_frame(&c,310000);assert(calls==count);
    MR32(G_PROFILE_SNAPSHOT)=0x30000;MR8(G_START_KEEP)=0;memset(g_mem+G_START_POS,0,12);MR16(G_START_HEAD)=0;
    raceentry_frame(&c,310200);assert(last_arg==MSG_RB_EXPLORE);assert(MR8(G_START_KEEP)==1&&MR16(G_START_HEAD)==0x1234);for(int i=0;i<12;i++)assert(MR8(G_START_POS+i)==7);
    MR32(G_FLOW)=6;MR32(0x20000)=4;pack="HUD_SingleRace.fng";raceentry_frame(&c,310400);assert(raceentry_flags()==0);
    /* A borrowed prologue car is absent from the front-end database; leave
     * the original Quick Race car alone and accept a direct world return. */
    owned=0;pack="UI_Pause.fng";MR32(0x20000)=6;assert(raceentry_enter(&c,320000)==RA_ACCEPTED);
    raceentry_frame(&c,320200);main_menu();raceentry_frame(&c,322000);raceentry_frame(&c,322200);
    assert(MR32(G_QR_CAR)==456&&MR32(G_QR_CAR_CATEGORY)==2);
    assert(raceentry_exit(&c,322400)==RA_ACCEPTED);raceentry_frame(&c,322600);raceentry_frame(&c,324200);raceentry_frame(&c,324400);raceentry_frame(&c,324600);
    MR32(G_FLOW)=6;MR32(0x20000)=4;pack="HUD_SingleRace.fng";raceentry_frame(&c,324800);assert(raceentry_flags()==0);
    /* A player choosing a different career car in the original room keeps
     * both that choice and its category; the trip no longer owns the pair. */
    owned=1;pack="UI_Pause.fng";MR32(0x20000)=6;assert(raceentry_enter(&c,330000)==RA_ACCEPTED);
    raceentry_frame(&c,330200);main_menu();raceentry_frame(&c,332000);raceentry_frame(&c,332200);
    MR32(G_QR_CAR)=789;assert(raceentry_exit(&c,332400)==RA_ACCEPTED);raceentry_frame(&c,332600);raceentry_frame(&c,334200);raceentry_frame(&c,334400);
    assert(MR32(G_QR_CAR)==789&&MR32(G_QR_CAR_CATEGORY)==4);
    raceentry_frame(&c,334600);MR32(G_FLOW)=6;MR32(0x20000)=4;pack="HUD_SingleRace.fng";raceentry_frame(&c,334800);assert(raceentry_flags()==0);
    /* Loading another game profile releases ownership without restoring any
     * bytes into the new profile; a stalled login releases input on timeout. */
    main_menu();assert(raceentry_enter(&c,400000)==RA_ACCEPTED);raceentry_frame(&c,400200);
    strcpy((char*)g_mem+G_PROFILE_NAME,"Changed");count=calls;raceentry_frame(&c,400400);assert(!raceentry_flags()&&calls==count);
    main_menu();assert(raceentry_enter(&c,500000)==RA_ACCEPTED);raceentry_frame(&c,500200);MR32(G_ONLINE_PROFILE+0x50)=1;
    raceentry_frame(&c,621000);assert(raceentry_flags()&RE_FAILED);assert(!raceentry_owns_input());
    assert(!memcmp(&c,&before,sizeof c));puts("PASS original race browser entry and career return");return 0;
}
