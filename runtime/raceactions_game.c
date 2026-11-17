#include "guest.h"
#include "game.h"
#include "widescreen.h"

static int all_races;
uint32_t raceactions_game_call(void *context,uint32_t fn,uint32_t self,unsigned n,const uint32_t *args){
    int previous=all_races;
    if(fn==FN_RB_SEARCH)all_races=1;
    uint32_t result=gcall_main((CPU *)context,fn,self,(int)n,args);
    all_races=previous;return result;
}
/* Only the overlay's synchronous search builder uses broad masks. Both LAN
 * and Online then return all public, unstarted modes; retail Filter keeps
 * its own masks. The LAN server compares (flags & mask) to the unmasked
 * query (server.dll 0x1001787d), so the broad query must clear CUSTFLAGS
 * too. These instructions precede the original TagField writes. */
int raceactions_hook(CPU *c,uint32_t ip){
    if(!all_races)return 0;
    switch(ip){
    case HOOK_SITE(0x0059066e):c->eax=0;return 1;
    case HOOK_SITE(0x00590689):c->esi=0x100;return 1;
    case HOOK_SITE(0x005906c9):MR32(c->esp)=0x80000;return 1;
    default:return 0;
    }
}
