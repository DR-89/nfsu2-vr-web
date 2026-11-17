#include "racebrowser.h"
#include "game.h"
#include "web/racebrowser_proto.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { MEMORY=0x900000, TRACKS=0x10000, STRINGS=0x20000, TABLE=0x30000, LIST=0x40000, NODES=0x41000, RECORDS=0x50000 };
static unsigned char mem[MEMORY];
static uint32_t fail_at,change_at,reads;
static int read_mem(void *ctx,uint32_t at,void *out,size_t n){
    (void)ctx;assert(at && n && at<=UINT32_MAX-(n-1));reads++;
    if(at>=MEMORY || n>MEMORY-at || (fail_at && at<=fail_at && n>fail_at-at))return 0;
    memcpy(out,mem+at,n);if(at==change_at)mem[at]^=1;return 1;
}
static void put(uint32_t at,uint32_t v){ assert(at+4<=MEMORY);memcpy(mem+at,&v,4); }
static void short_at(uint32_t at,uint16_t v){ memcpy(mem+at,&v,2); }
static void str(uint32_t at,const char *v){ strcpy((char *)mem+at,v); }
static int zero(const void *v,size_t n){const unsigned char *p=v;for(size_t i=0;i<n;i++)if(p[i])return 0;return 1;}
static uint32_t hash(const char *s){uint32_t h=UINT32_MAX;while(*s)h=h*33+(unsigned char)*s++;return h;}
static void track(unsigned index,unsigned id,unsigned flags,int reverse,int point,int disabled){
    uint32_t at=TRACKS+index*0x128;short_at(at+0x8a,(uint16_t)id);put(at+0x94,flags);put(at+0x80,(unsigned)point);
    mem[at+0x86]=(unsigned char)reverse;mem[at+0x88]=(unsigned char)disabled;
    str(at,"PRIVATE_DEVELOPMENT_LABEL");
}
static void catalog_fixture(void){
    memset(mem,0,sizeof mem);fail_at=change_at=reads=0;
    put(G_TRACK_CATALOG,TRACKS);put(G_TRACK_CATALOG+4,9);
    track(0,4101,1,1,0,0);track(1,4201,4,0,1,0);track(2,4402,2,0,1,0);
    track(3,4301,8,0,1,0);track(4,4501,8,1,0,0);track(5,4601,0x2800,1,0,0);
    track(6,4801,1,0,0,0);track(7,4400,0,0,0,0);track(8,4400,0,0,0,1);
    put(G_TEXT_BYTE_MODE,1);put(G_LANGUAGE_TABLE,1);put(G_LANGUAGE_TABLE+4,STRINGS);put(G_LANGUAGE_TABLE+8,TABLE);
    put(TABLE,hash("TRACK_NAME_4101"));put(TABLE+4,STRINGS);str(STRINGS,"K\366nig-Stra\337e");
}
static RaceCatalog catalog;
static RaceLobby lobby;
static void catalog_tests(void){
    catalog_fixture();assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(catalog.count==7);
    assert(!strcmp(catalog.choices[0].name,"K\xc3\xb6nig-Stra\xc3\x9f" "e"));assert(!strcmp(catalog.choices[0].reverse_name,catalog.choices[0].name));
    assert(catalog.choices[0].mode==0 && catalog.choices[0].track==4101 && catalog.choices[0].min_laps==2 && catalog.choices[0].max_players==6);
    assert(catalog.choices[1].mode==1 && catalog.choices[1].min_laps==1 && catalog.choices[1].max_laps==1);
    assert(catalog.choices[2].mode==2 && catalog.choices[2].max_players==3);
    assert(catalog.choices[3].mode==3 && catalog.choices[3].max_laps==1);
    assert(catalog.choices[4].mode==3 && catalog.choices[4].min_laps==2);
    assert(catalog.choices[5].mode==4 && catalog.choices[5].min_laps==2);
    assert(catalog.choices[6].mode==10 && catalog.choices[6].min_laps==4);
    assert(catalog.choices[1].name[0]==0);
    for(unsigned i=0;i<catalog.count;i++)assert(!strstr(catalog.choices[i].name,"PRIVATE"));
    short_at(TRACKS+2*0x128+0x8a,4401);assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(catalog.choices[2].max_players==4);
    short_at(TRACKS+8*0x128+0x8a,4101);assert(!racebrowser_catalog(read_mem,0,"",&catalog));assert(zero(&catalog,sizeof catalog));
    catalog_fixture();fail_at=TRACKS+0x128+0x80;assert(!racebrowser_catalog(read_mem,0,"",&catalog));assert(zero(&catalog,sizeof catalog));
    fail_at=0;change_at=G_TRACK_CATALOG;assert(!racebrowser_catalog(read_mem,0,"",&catalog));assert(zero(&catalog,sizeof catalog));
    catalog_fixture();change_at=G_LANGUAGE_TABLE;assert(!racebrowser_catalog(read_mem,0,"",&catalog));
    catalog_fixture();memset(mem+STRINGS,'x',RB_LABEL);assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!catalog.choices[0].name[0]);
    catalog_fixture();put(TABLE+4,UINT32_MAX-16);assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!catalog.choices[0].name[0]);
    catalog_fixture();put(G_TRACK_CATALOG,UINT32_MAX-64);assert(!racebrowser_catalog(read_mem,0,"",&catalog));
    catalog_fixture();put(G_TRACK_CATALOG+4,513);assert(!racebrowser_catalog(read_mem,0,"",&catalog));
    catalog_fixture();mem[TRACKS+0x86]=2;assert(!racebrowser_catalog(read_mem,0,"",&catalog));
    catalog_fixture();put(G_TRACK_CATALOG+4,129);
    for(unsigned i=0;i<129;i++)track(i,5000+i,1,1,0,0);
    assert(!racebrowser_catalog(read_mem,0,"",&catalog));assert(zero(&catalog,sizeof catalog));
    catalog_fixture();assert(racebrowser_catalog(read_mem,0,"",&catalog));
}
/* Synthetic conversion tables exercise the original single-byte/lead-byte
 * algorithm without shipping game strings, fonts or extracted tables. */
static void caption_tests(void){
    enum { CHARS=0x60000 };
    catalog_fixture();put(G_TEXT_BYTE_MODE,0);put(G_LANGUAGE_TABLE+12,CHARS);
    short_at(CHARS+4+0x81*2,0x2019);str(STRINGS,"A\201B");
    assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!strcmp(catalog.choices[0].name,"A’B"));
    short_at(CHARS+4+0x81*2,0x30ab);assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!strcmp(catalog.choices[0].name,"AカB"));
    short_at(CHARS+4+0x80*2,3);short_at(CHARS+2*(3*128+0xfe)-0xfc,0xc774);str(STRINGS,"\200\376");
    assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!strcmp(catalog.choices[0].name,"이"));
    str(STRINGS,"\200x");assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!strcmp(catalog.choices[0].name,"_"));
    str(STRINGS,"\200");assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!catalog.choices[0].name[0]);
    str(STRINGS,"\200\377");assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!strcmp(catalog.choices[0].name,"_"));
    str(STRINGS,"\200\376");fail_at=CHARS+2*(3*128+0xfe)-0xfc;
    assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!catalog.choices[0].name[0]);fail_at=0;
    str(STRINGS,"\201");short_at(CHARS+4+0x81*2,0xd800);assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!catalog.choices[0].name[0]);
    short_at(CHARS+4+0x81*2,0x30ab);memset(mem+STRINGS,0x81,127);mem[STRINGS+127]=0;
    assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(strlen(catalog.choices[0].name)==381);
    put(G_LANGUAGE_TABLE+12,UINT32_MAX-4);assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!catalog.choices[0].name[0]);
    put(G_TEXT_BYTE_MODE,1);str(STRINGS,"\366");assert(racebrowser_catalog(read_mem,0,"",&catalog));assert(!strcmp(catalog.choices[0].name,"ö"));
    change_at=G_TEXT_BYTE_MODE;assert(!racebrowser_catalog(read_mem,0,"",&catalog));assert(zero(&catalog,sizeof catalog));
    static const struct {const char *font,*input,*output;} cases[]={
        {"polish","\xbf\xee\xe2\xe7\xe9\xe1\xeb\xf1\xc7\xfa\xda\xfd\xc8\xc9\xd1","ęłśąćżźńĘŁŚĄĆŻŃ"},
        {"turkish","\xed\xff\xfd\xcd\xfe\xdd","ışğİŞĞ"},
        {"hungarian","\xf5\xd5\xfb\xdb","őŐűŰ"},
        {"ukrainian","\xe2\xe3\xe4\xe5\xe6\xe7","ІіЇїЄє"},
        {"slovak","\x8a\x9a\xbe\xe8\xf2\x9d\x9e","Ššľčňťž"},
        {"greek","\xa1\xa2\xa9\xa8\xaa","ΆΈ©ΐΑ"},
    };
    for(unsigned i=0;i<sizeof cases/sizeof cases[0];i++){
        catalog_fixture();str(STRINGS,cases[i].input);assert(racebrowser_catalog(read_mem,0,cases[i].font,&catalog));
        assert(!strcmp(catalog.choices[0].name,cases[i].output));
    }
    catalog_fixture();assert(racebrowser_catalog(read_mem,0,"",&catalog));
}
static RaceRow row(unsigned mode,const char *params){
    RaceRow r={.id=7,.players=2,.min_players=2,.max_players=6,.custom_flags=mode,.seed=10};
    strcpy(r.name,"Room");strcpy(r.host,"Host");strcpy(r.params,params);return r;
}
static void params_tests(void){
    RaceRow r=row(0x04000003,"TRACK=4101 DIR=1 LAPS=2");assert(racebrowser_info(&catalog,&r)&&r.compatible);
    RaceRow b=r;b.players++;assert(racebrowser_same_race(&r,&b));b.seed++;assert(!racebrowser_same_race(&r,&b));
    b=r;b.params[0]='X';assert(!racebrowser_same_race(&r,&b));b=r;b.host[0]='X';assert(!racebrowser_same_race(&r,&b));
    const char *bad[]={"TRACK=4101 DIR=0 LAPS=2 LAPS=3","TRACK=4101 DIR=0","TRACK=4294967296 DIR=0 LAPS=2",
        "TRACK=4101 DIR=-1 LAPS=2","TRACK=4101 DIR=0 LAPS=2x","TRACK=4101 DIR=0 LAPS=2 AUTH=secret","TRACK=4101 DIR=0 LAPS=0"};
    for(unsigned i=0;i<sizeof bad/sizeof bad[0];i++){strcpy(r.params,bad[i]);assert(!racebrowser_info(&catalog,&r));assert(!r.parsed&&!r.compatible&&!r.track);}
    strcpy(r.params,"\tDIR=1\n LAPS=3\r TRACK=4101 ");assert(racebrowser_info(&catalog,&r)&&r.compatible);
    r.custom_flags=0x0c000000;assert(racebrowser_info(&catalog,&r)&&r.parsed&&!r.compatible&&r.mode==UINT32_MAX);
    r=row(0x10000000,"TRACK=4402 DIR=0 LAPS=1");r.max_players=4;assert(racebrowser_info(&catalog,&r)&&!r.compatible);
    r.max_players=3;assert(racebrowser_info(&catalog,&r)&&r.compatible);
    strcpy(r.params,"TRACK=4402 DIR=1 LAPS=1");assert(racebrowser_info(&catalog,&r)&&!r.compatible);
    r=row(0x20000000,"TRACK=4301 DIR=0 LAPS=2");assert(racebrowser_info(&catalog,&r)&&!r.compatible);
    r=row(0x40000000,"TRACK=4601 DIR=0 LAPS=3");assert(racebrowser_info(&catalog,&r)&&!r.compatible);
    r=row(0x04000000,"TRACK=9999 DIR=0 LAPS=2");assert(racebrowser_info(&catalog,&r)&&r.parsed&&!r.compatible);
    memset(r.params,'A',sizeof r.params);assert(!racebrowser_info(&catalog,&r));
}
static void record(uint32_t at,unsigned id,const char *host,unsigned players){
    memset(mem+at,0xa5,0x1c0);put(at,id);memset(mem+at+4,0x65,36);str(at+4,"Room");str(at+0x38,host);
    str(at+0x48,"PRIVATE_AUTH_TOKEN");str(at+0x8c,"TRACK=4101 DIR=0 LAPS=2");put(at+0x110,0x04000003);
    put(at+0x114,0);put(at+0x118,2);put(at+0x11c,6);put(at+0x120,42);put(at+0x1bc,players);
}
static void list_fixture(unsigned n){
    catalog_fixture();assert(racebrowser_catalog(read_mem,0,"",&catalog));
    put(G_FLOW,3);put(G_GAMEMODE,8);put(G_ONLINE_PROFILE+0x50,0x11);str(G_ONLINE_PROFILE+0x6c,"Host");
    put(G_LOBBY_MANAGER+0x44,0x60000);put(G_LOBBY_GAMES+0xc,CB_PC_LOBBY);put(G_LOBBY_GAMES+0x10,0x70000);
    put(G_LOBBY_GAMES+8,LIST);put(LIST+0x14,n);put(LIST+0x18,n);put(LIST+0x40,NODES);
    for(unsigned i=0;i<n;i++){put(NODES+i*4,NODES+0x100+i*4);put(NODES+0x100+i*4,RECORDS+i*0x200);record(RECORDS+i*0x200,100+i,"Host",2);}
}
static void lobby_tests(void){
    list_fixture(21);assert(racebrowser_lobby(read_mem,0,&catalog,&lobby));assert(lobby.source==RB_LIST&&lobby.listed==21&&lobby.count==20);
    assert(lobby.rows[19].id==119&&lobby.rows[0].compatible);assert(zero(lobby.rows[0].name+5,31));
    static unsigned char before[MEMORY];memcpy(before,mem,MEMORY);
    assert(racebrowser_lobby(read_mem,0,&catalog,&lobby));assert(!memcmp(before,mem,MEMORY));
    put(RECORDS+0x200,100);assert(!racebrowser_lobby(read_mem,0,&catalog,&lobby));assert(zero(&lobby,sizeof lobby));
    list_fixture(2);fail_at=NODES+0x104;assert(!racebrowser_lobby(read_mem,0,&catalog,&lobby));assert(zero(&lobby,sizeof lobby));
    list_fixture(2);put(LIST+0x18,1);assert(!racebrowser_lobby(read_mem,0,&catalog,&lobby));
    list_fixture(2);put(LIST+0x40,UINT32_MAX-2);assert(!racebrowser_lobby(read_mem,0,&catalog,&lobby));
    list_fixture(2);change_at=LIST;assert(!racebrowser_lobby(read_mem,0,&catalog,&lobby));
    list_fixture(2);change_at=G_LOBBY_GAMES+0xc;assert(!racebrowser_lobby(read_mem,0,&catalog,&lobby));
    list_fixture(0);assert(racebrowser_lobby(read_mem,0,&catalog,&lobby)&&lobby.source==RB_LIST&&!lobby.count);
    put(G_GAMEMODE,0x200);memset(mem+G_ONLINE_PROFILE+ONLINE_PERSONA,0,16);str(G_ONLINE_PROFILE+LAN_PERSONA,"LanHost");
    assert(racebrowser_lobby(read_mem,0,&catalog,&lobby)&&lobby.source==RB_LIST&&!strcmp(lobby.persona,"LanHost"));
    str(G_ONLINE_PROFILE+ONLINE_PERSONA,"WrongAccount");
    assert(racebrowser_lobby(read_mem,0,&catalog,&lobby)&&!strcmp(lobby.persona,"LanHost"));
    put(G_LOBBY_MANAGER+0x4c,123);assert(racebrowser_lobby(read_mem,0,&catalog,&lobby)&&lobby.source==RB_WAITING&&!lobby.persona[0]);
    put(G_FLOW,6);assert(racebrowser_lobby(read_mem,0,&catalog,&lobby)&&zero(&lobby,sizeof lobby));
    list_fixture(1);put(G_LOBBY_GAMES+0xc,CB_PC_GAME_ROOM);record(G_LOBBY_GAMES+0x1c,999,"Host",2);
    str(G_LOBBY_GAMES+0x1e0,"Host");str(G_LOBBY_GAMES+0x1e0+0x64,"Guest");
    put(G_LOBBY_GAMES+0x218,0);put(G_LOBBY_GAMES+0x218+0x64,0x08000000);
    assert(racebrowser_lobby(read_mem,0,&catalog,&lobby));assert(lobby.source==RB_ROOM&&lobby.host&&lobby.startable&&!lobby.local_ready);
    put(G_GAMEMODE,0x200);str(G_ONLINE_PROFILE+ONLINE_PERSONA,"Unrelated");str(G_ONLINE_PROFILE+LAN_PERSONA,"Host");
    assert(racebrowser_lobby(read_mem,0,&catalog,&lobby)&&lobby.host&&lobby.startable);
    put(G_GAMEMODE,8);str(G_ONLINE_PROFILE+ONLINE_PERSONA,"Host");
    put(G_LOBBY_GAMES+0x218+0x64,0);assert(racebrowser_lobby(read_mem,0,&catalog,&lobby)&&!lobby.startable);
    str(G_ONLINE_PROFILE+0x6c,"Guest");put(G_LOBBY_GAMES+0x218+0x64,0x08000000);
    assert(racebrowser_lobby(read_mem,0,&catalog,&lobby)&&!lobby.host&&!lobby.startable&&lobby.local_ready);
    str(G_LOBBY_GAMES+0x1e0+0x64,"Host");assert(!racebrowser_lobby(read_mem,0,&catalog,&lobby));assert(zero(&lobby,sizeof lobby));
}
int main(int argc,char **argv){
    catalog_tests();caption_tests();params_tests();lobby_tests();
    list_fixture(2);assert(racebrowser_lobby(read_mem,0,&catalog,&lobby));
    if(argc>1){RaceBrowserBox box={.magic=RB_MAGIC,.version=RB_VERSION,.size=sizeof box,.seq=2,.catalog_valid=1,.lobby_flags=1};
        box.catalog=catalog;box.lobby=lobby;FILE *f=fopen(argv[1],"wb");assert(f);assert(fwrite(&box,1,sizeof box,f)==sizeof box);fclose(f);}
    puts("PASS PC catalogue, sparse reads, PARAMS, lobby identity, roster, ownership, read-only ABI");return 0;
}
