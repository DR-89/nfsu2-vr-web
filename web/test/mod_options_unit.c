/* Synthetic PC region tables and vinyl records: no retail data. */
#include "../../runtime/regional.c"
#include "../../runtime/vinylcat.c"
#include <assert.h>

uint8_t *g_mem;
uint8_t g_cbits[1u<<15];
enum { FE=0x10000, VT=0x11000, TYPE=0x20000, PART=0x40000, NAME=0x41000, METHOD=0x70000 };
static int calls,added;
uint32_t language_add_text(const char *name,const char *text){(void)name;(void)text;return 42;}
void language_game_letters(const char *text,char *out,size_t n){snprintf(out,n,"%s",text);}
const char *language_name(void){return "english";}
uint32_t language_text(uint32_t hash){(void)hash;return 0;}
void language_texts_frame(CPU *c){(void)c;}
void dispatch_indirect(CPU *c,uint32_t fn){
    calls++;
    if(fn==METHOD)c->eax=0;
    else if(fn==FN_PART_FIRST)c->eax=PART;
    else if(fn==FN_PART_NEXT){uint32_t p=MR32(c->esp+4);c->eax=p==PART?PART+32:0;}
    else if(fn==FN_PART_NAME)c->eax=NAME+(c->ecx==PART?0:32);
    else if(fn==FN_ADD_CAT){
        assert(MR32(c->esp+4)==CAT_HIDDEN && MR32(c->esp+12)==42);
        assert(MR8(PART+P_CAT)==0x5c && MR8(PART+32+P_CAT)==0x5f);
        added++;c->eax=0;
    }else assert(!"unexpected guest call");
}
static void tables(void){
    g_on=0;MR32(G_CAR_REGION)=0;
    MR32(LOCKED_NA)=T_CORSA;MR32(LOCKED_NA+4)=T_PEUGOT106;
    MR8(AI_CARS_NA+AI_CARS_NA_N-2)=5;MR8(AI_CARS_NA+AI_CARS_NA_N-1)=18;
    MR16(AI_CARS_NA+AI_CARS_NA_N)=0;
}
int main(void){
    g_mem=calloc(1,0x1000000);assert(g_mem);
    for(unsigned p=0;p<0x1000000u>>14;p++)g_cbits[p>>3]|=1u<<(p&7);
    for(int on=0;on<=1;on++)for(int na=0;na<=1;na++)for(int eu=0;eu<=1;eu++){
        tables();regional_setup(na,eu,on);
        assert(MR32(G_CAR_REGION)==(uint32_t)(eu&&!na));
        assert(g_on==(na&&eu&&on));
        CPU c={.esi=AI_CARS_NA,.ebp=AI_CARS_NA_N};
        regional_hook(&c,HOOK_SITE(0x004febad));
        assert(c.ebp==AI_CARS_NA_N+(g_on?2:0));
        assert(MR32(LOCKED_NA)==(g_on?0xffffffffu:T_CORSA));
    }
    tables();MR32(LOCKED_NA)=99;regional_setup(1,1,1);assert(!g_on && MR32(LOCKED_NA)==99);
    CPU c={.esp=0xf00000,.esi=FE};CPU before=c;
    /* Off, the hook must not even inspect an absent front end. */
    unsetenv("NFSU2_SPECIAL_VINYLS");assert(vinylcat_hook(&c,HOOK_SITE(0x0054625c)) && !calls);
    MR32(G_FECAR)=FE;MR32(FE)=VT;MR32(VT+4)=METHOD;
    MR32(G_CARTYPES)=TYPE;memcpy(g_mem+TYPE,"COROLLA",8);
    MR32(G_SLOT_KIND+4*SLOT_VINYL)=16;
    MR8(PART+P_KIND)=MR8(PART+32+P_KIND)=16;
    MR8(PART+P_CAT)=MR8(PART+32+P_CAT)=0x5c;
    strcpy((char*)g_mem+NAME,"D3");strcpy((char*)g_mem+NAME+32,"DEBUG VINYL");
    vinylcat_set_enabled(1);vinylcat_hook(&c,HOOK_SITE(0x0054625c));
    assert(added==1 && MR8(PART+32+P_CAT)==0x5c && !memcmp(&c,&before,sizeof c));
    int prior=calls;vinylcat_set_enabled(0);vinylcat_hook(&c,HOOK_SITE(0x0054625c));
    assert(calls==prior && MR8(PART+P_CAT)==0x5c);
    vinylcat_set_enabled(9);vinylcat_hook(&c,HOOK_SITE(0x0054625c));assert(calls==prior);
    vinylcat_set_enabled(1);vinylcat_hook(&c,HOOK_SITE(0x0054625c));assert(added==2);
    free(g_mem);puts("regional data safety, optional vinyl category and preserved parts: OK");
}
