#include "raceactions.h"
#include "game.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static uint8_t memory[0x900000];
static uint32_t fail_at,functions[16],arguments[16][4],selves[16],calls;
static int32_t call_result;
static RaceCatalog catalog;
static RaceLobby lobby;
static RaceSettingsLease lease;
enum { SCREEN=0x10000,ARENA=0x20000,EPOCH=27 };
static int rd(void *c,uint32_t a,void *out,size_t n){
    (void)c;if(a>sizeof memory || n>sizeof memory-a || (fail_at>=a && fail_at<a+n))return 0;
    memcpy(out,memory+a,n);return 1;
}
static int wr(void *c,uint32_t a,const void *in,size_t n){
    (void)c;if(a>sizeof memory || n>sizeof memory-a || (fail_at>=a && fail_at<a+n))return 0;
    memcpy(memory+a,in,n);return 1;
}
static void put(uint32_t a,uint32_t v){assert(wr(0,a,&v,4));}
static uint32_t get(uint32_t a){uint32_t v;assert(rd(0,a,&v,4));return v;}
static uint32_t invoke(void *ctx,uint32_t fn,uint32_t self,unsigned n,const uint32_t *args){
    (void)ctx;assert(calls<16 && n<=4);functions[calls]=fn;selves[calls]=self;
    if(n)memcpy(arguments[calls],args,n*4);calls++;
    if(fn==FN_RB_STAGE)put(G_ONLINE_PROFILE+0x50,args[0]);
    if(fn==FN_RB_JOIN){assert(!strcmp((char *)memory+args[0],lobby.rows[0].name));assert(!strcmp((char *)memory+args[1],"Join_Secret"));}
    return (uint32_t)call_result;
}
static RaceActionGuest guest={rd,wr,invoke,0,ARENA};
static void reset(int room){
    memset(memory,0,sizeof memory);memset(&lease,0,sizeof lease);memset(&lobby,0,sizeof lobby);
    fail_at=calls=0;call_result=1;
    put(G_FLOW,3);put(G_GAMEMODE,8);put(G_ONLINE_PROFILE+0x50,17);put(G_LOBBY_MANAGER+0x44,0x1234);
    memory[G_LOBBY_MANAGER+0x48]=1;put(G_LOBBY_GAMES+0xc,room?CB_PC_GAME_ROOM:CB_PC_LOBBY);
    put(G_LOBBY_GAMES+0x10,SCREEN);put(SCREEN+4,0x783000);put(SCREEN+(room?0x1170:0x108),G_LOBBY_GAMES);
    put(G_RB_ROOM_NAME,0x783100);memset(memory+G_ONLINE_PROFILE+0x58,0x5a,0x38);
    catalog=(RaceCatalog){.count=2,.choices={{.mode=0,.track=4101,.reverse=1,.min_laps=2,.max_laps=10,.max_players=6},
        {.mode=2,.track=4402,.min_laps=1,.max_laps=1,.max_players=3}}};
    RaceRow r={.id=100,.seed=900,.players=2,.min_players=2,.max_players=6,.custom_flags=0x04000003,
        .name="Room",.host="Host",.params="TRACK=4101 DIR=0 LAPS=2"};
    assert(racebrowser_info(&catalog,&r)&&r.compatible);
    lobby.source=room?RB_ROOM:RB_LIST;lobby.rows[0]=r;lobby.current=r;lobby.count=1;lobby.listed=1;
    lobby.host=lobby.startable=1;
}
static RaceCommand command(unsigned action){
    RaceCommand c={.epoch=EPOCH,.action=action,.selected=lobby.current,
        .options={.mode=0,.track=4101,.laps=2,.min_players=2,.max_players=6,.collision=1,.catchup=1,.unrestricted=1}};
    if(action==RA_JOIN)strcpy(c.password,"Join_Secret");return c;
}
static unsigned run(RaceCommand *c){return raceactions_execute(&guest,&catalog,&lobby,EPOCH,c,&lease);}
int main(void){
    reset(0);RaceCommand c=command(RA_CREATE);
    assert(raceactions_options(&catalog,&c.options,c.password,0));
    c.options.ranked=1;assert(!raceactions_options(&catalog,&c.options,c.password,0));
    c.options.min_players=3;assert(raceactions_options(&catalog,&c.options,c.password,0));
    assert(!raceactions_options(&catalog,&c.options,c.password,1));c.options.ranked=0;
    c.options.track=4402;c.options.mode=2;c.options.laps=1;c.options.max_players=3;
    assert(raceactions_options(&catalog,&c.options,c.password,0));
    c.options.reverse=1;assert(!raceactions_options(&catalog,&c.options,c.password,0));c.options.reverse=0;
    c.options.max_players=4;assert(!raceactions_options(&catalog,&c.options,c.password,0));
    reset(0);c=command(RA_CREATE);strcpy(c.password,"Create_123");
    uint8_t before[0x90];memcpy(before,memory+G_ONLINE_PROFILE,sizeof before);
    assert(run(&c)==RA_ACCEPTED && calls==1 && functions[0]==FN_RB_SWITCH && arguments[0][1]==0x783100);
    assert(get(G_ONLINE_PROFILE+8)==0 && memory[G_ONLINE_PROFILE]==6 && memory[G_ONLINE_PROFILE+1]==2);
    assert(!strcmp((char *)memory+G_ONLINE_PROFILE+0x1c,c.password));
    assert(!memcmp(before+0x58,memory+G_ONLINE_PROFILE+0x58,0x38));
    /* Another UI edit wins over our lease; all unchanged fields restore. */
    put(G_ONLINE_PROFILE+8,3);assert(raceactions_release(&guest,&lease) && get(G_ONLINE_PROFILE+8)==3);put(G_ONLINE_PROFILE+8,0);
    assert(!memcmp(before,memory+G_ONLINE_PROFILE,sizeof before));assert(!lease.fields);
    reset(0);c=command(RA_CREATE);strcpy(c.password,"too-long-pass");assert(run(&c)==RA_INVALID && !calls);
    strcpy(c.password,"bad=tag");assert(run(&c)==RA_INVALID && !calls);
    memset(c.password,'A',33);assert(run(&c)==RA_INVALID && !calls);
    reset(0);c=command(RA_SEARCH);c.value=40;
    assert(run(&c)==RA_ACCEPTED && calls==2 && functions[0]==FN_RB_SEARCH && functions[1]==FN_RB_STAGE);
    assert(get(ARENA)==40 && get(ARENA+4)==20 && get(ARENA+12)==UINT32_MAX && get(SCREEN+0x100)==2);
    assert(arguments[0][2]==CB_RB_SEARCH && arguments[0][3]==SCREEN && get(G_ONLINE_PROFILE+0x50)==18);
    reset(0);c=command(RA_SEARCH);c.value=1;assert(run(&c)==RA_INVALID && !calls);
    c.value=4100;assert(run(&c)==RA_INVALID && !calls);c.value=0;c.epoch=EPOCH-1;assert(run(&c)==RA_STALE && !calls);
    c.epoch=EPOCH;put(G_RB_DIALOG,1);assert(run(&c)==RA_BUSY && !calls);put(G_RB_DIALOG,0);
    put(G_LOBBY_MANAGER+0x4c,1);assert(run(&c)==RA_BUSY && !calls);put(G_LOBBY_MANAGER+0x4c,0);
    fail_at=SCREEN+0x108;assert(run(&c)==RA_UNAVAILABLE && !calls);fail_at=0;
    put(G_FLOW,6);assert(run(&c)==RA_UNAVAILABLE && !calls);
    reset(0);c=command(RA_JOIN);c.selected.seed++;assert(run(&c)==RA_STALE && !calls);
    c.selected=lobby.rows[0];lobby.rows[0].players=6;assert(run(&c)==RA_UNAVAILABLE && !calls);
    lobby.rows[0].players=3;assert(run(&c)==RA_ACCEPTED && functions[0]==FN_RB_JOIN);
    assert(get(G_ONLINE_PROFILE+4)==1 && !memory[ARENA] && !memory[ARENA+64]);
    assert(memory[G_ONLINE_PROFILE+0x1c]==0 && !memcmp(memory+G_ONLINE_PROFILE+0x58,before+0x58,0x38));
    /* Callback's expected options are reserved; arbitrary later values survive. */
    memcpy(memory+G_ONLINE_PROFILE+0x38,lease.written+0x38,8);put(G_ONLINE_PROFILE+8,4);
    assert(raceactions_release(&guest,&lease) && get(G_ONLINE_PROFILE+8)==4 && get(G_ONLINE_PROFILE+0x38)==0);
    reset(0);c=command(RA_JOIN);call_result=-1;assert(run(&c)==RA_FAILED && !lease.fields && !memory[ARENA+64]);
    reset(0);c=command(RA_JOIN);fail_at=G_ONLINE_PROFILE+4;
    assert(run(&c)==RA_FAILED && !calls && !memory[ARENA] && !memory[ARENA+64]);
    reset(0);c=command(RA_CREATE);fail_at=G_ONLINE_PROFILE+0x3a;assert(run(&c)==RA_FAILED && !calls);
    fail_at=0;assert(!lease.fields && memory[G_ONLINE_PROFILE]==0);
    reset(1);c=command(RA_READY);c.value=1;assert(run(&c)==RA_ACCEPTED && functions[0]==FN_RB_READY && memory[SCREEN+0x11bf]==1);
    c.value=2;assert(run(&c)==RA_INVALID && calls==1);
    c=command(RA_START);lobby.startable=0;assert(run(&c)==RA_UNAVAILABLE && calls==1);
    lobby.startable=1;lobby.host=0;assert(run(&c)==RA_UNAVAILABLE && calls==1);
    lobby.host=1;assert(run(&c)==RA_ACCEPTED && functions[1]==FN_RB_START && selves[1]==SCREEN);
    c=command(RA_LEAVE);c.selected.id++;assert(run(&c)==RA_STALE && calls==2);
    c.selected=lobby.current;assert(run(&c)==RA_ACCEPTED && functions[2]==FN_RB_LEAVE && selves[2]==SCREEN);
    puts("PASS original PC lobby actions, stale ownership, bounds and conditional restore");return 0;
}
