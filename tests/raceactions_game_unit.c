#include "guest.h"
#include "game.h"
#include <assert.h>
#include <stdio.h>

uint8_t *g_mem;
static uint8_t memory[0x10000];
static unsigned searches;
uint32_t raceactions_game_call(void *,uint32_t,uint32_t,unsigned,const uint32_t *);
int raceactions_hook(CPU *,uint32_t);

static void filters(CPU *c,int broad){
    c->eax=0xf0;c->esi=0x1f0;MR32(c->esp)=0xc0000;
    assert(raceactions_hook(c,0x59066e)==broad);
    assert(raceactions_hook(c,0x590689)==broad);
    assert(raceactions_hook(c,0x5906c9)==broad);
    assert(c->eax==(broad?0:0xf0));assert(c->esi==(broad?0x100:0x1f0));
    assert(MR32(c->esp)==(broad?0x80000:0xc0000));
    if(broad){
        /* The original LAN predicate uses unmasked query flags. A public,
         * passworded Drag race and a ranked Circuit race must both match;
         * private or already started races must not. */
        assert((0x100000f3u & c->esi)==c->eax);
        assert((0x04000033u & c->esi)==c->eax);
        assert((0x100001f3u & c->esi)!=c->eax);
        assert((0x10000u & MR32(c->esp))==0);
        assert((0x40000u & MR32(c->esp))==0);
        assert((0x80000u & MR32(c->esp))!=0);
    }
    assert(!raceactions_hook(c,0x590660));
}
void dispatch_indirect(CPU *c,uint32_t fn){
    assert(MR32(c->esp)==GUEST_RET_MAINLOOP);
    if(fn==FN_RB_SEARCH){
        searches++;filters(c,1);
        /* A synchronous nested guest call must preserve the outer scope. */
        raceactions_game_call(c,FN_RB_STAGE,0,0,0);filters(c,1);
    }else{assert(fn==FN_RB_STAGE);filters(c,searches!=0);}
    c->eax=42;
}
int main(void){
    g_mem=memory;CPU c={0};c.esp=sizeof memory-16;filters(&c,0);
    CPU saved=c;assert(raceactions_game_call(&c,FN_RB_STAGE,0,0,0)==42);
    assert(!memcmp(&c,&saved,sizeof c));
    assert(raceactions_game_call(&c,FN_RB_SEARCH,0,0,0)==42);
    assert(!memcmp(&c,&saved,sizeof c));filters(&c,0);
    puts("PASS scoped LAN and Online search filters");return 0;
}
