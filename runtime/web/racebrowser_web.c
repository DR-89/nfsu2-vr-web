#include "racebrowser_proto.h"
#include "host_abi.h"
#include "guest.h"
#include "game.h"
#include "raceentry.h"
#include <string.h>
#include <stdio.h>

const char *language_font_map(void);

static RaceBrowserBox box={.magic=RB_MAGIC,.version=RB_VERSION,.size=sizeof(RaceBrowserBox)};
static RaceCatalog catalog;
static RaceLobby lobby;
static uint32_t signature[7];
static unsigned catalog_valid;
static int registered;
static double next_read;
static uint32_t owner[5],epoch,arena,ack,result,action;
static RaceSettingsLease lease;
static int lease_transition;
uint32_t raceactions_game_call(void *,uint32_t,uint32_t,unsigned,const uint32_t *);

/* Each read is smaller than a guest page; check both ends and overflow
 * before touching sparse guest memory. Catalogue/table walks read one
 * bounded record at a time, never a span with unchecked interior pages. */
static int read_guest(void *ctx,uint32_t at,void *out,size_t size){
    (void)ctx;
    if(!size || size>0x1000 || !at || at>UINT32_MAX-(uint32_t)(size-1) || !guest_ok_bytes(at,(uint32_t)size))return 0;
    memcpy(out,g_mem+at,size);return 1;
}
static int write_guest(void *ctx,uint32_t at,const void *in,size_t size){
    (void)ctx;
    if(!size || size>0x1000 || !at || at>UINT32_MAX-(uint32_t)(size-1) || !guest_ok_bytes(at,(uint32_t)size))return 0;
    memcpy(g_mem+at,in,size);return 1;
}
static int update_owner(void){
    uint32_t identity[5]={guest_rd32(G_FLOW),guest_rd32(G_GAMEMODE),guest_rd32(G_LOBBY_MANAGER+0x44),
        guest_rd32(G_LOBBY_GAMES+0xc),guest_rd32(G_LOBBY_GAMES+0x10)};
    if(!memcmp(identity,owner,sizeof owner))return 0;
    memcpy(owner,identity,sizeof owner);if(!++epoch)++epoch;return 1;
}
void racebrowser_web_frame(CPU *cpu){
    if(!registered){nfsu2_register(HOST_KIND_RACES,&box,sizeof box);registered=1;}
    raceentry_frame(cpu,nfsu2_now_ms());
    int changed=update_owner();
    uint32_t serial=__atomic_load_n(&box.request_seq,__ATOMIC_ACQUIRE);
    int command=serial && !(serial&1u) && serial!=ack;
    double now=nfsu2_now_ms();if(!changed && !command && now<next_read)return;next_read=now+250;
    uint32_t current[7];
    int have=read_guest(0,G_TRACK_CATALOG,current,8) && read_guest(0,G_LANGUAGE_TABLE,current+2,16) && read_guest(0,G_TEXT_BYTE_MODE,current+6,4);
    if(!have || !catalog_valid || memcmp(signature,current,sizeof current)){
        catalog_valid=have && racebrowser_catalog(read_guest,0,language_font_map(),&catalog);
        if(!catalog_valid)memset(&catalog,0,sizeof catalog);
        else{memcpy(signature,current,sizeof signature);fprintf(stderr,"[races] PC track catalogue: %u choices\n",catalog.count);}
    }
    unsigned valid=racebrowser_lobby(read_guest,0,catalog_valid?&catalog:0,&lobby);
    RaceActionGuest guest={read_guest,write_guest,raceactions_game_call,cpu,arena};
    if(lease.fields){
        if(lobby.source!=RB_LIST)lease_transition=1;
        /* Keep race options until the original coordinator returns. Release
         * on the lobby or a disconnected front end, never during loading. */
        if(owner[0]==3 && ((lease_transition && valid && lobby.source==RB_LIST) || owner[1]==2)){
            if(raceactions_release(&guest,&lease))lease_transition=0;
        }
    }
    if(command){
        RaceCommand request;memcpy(&request,&box.request,sizeof request);
        if(serial==__atomic_load_n(&box.request_seq,__ATOMIC_ACQUIRE)){
            if(!arena && valid && (lobby.source==RB_LIST || lobby.source==RB_ROOM)){
                uint32_t size=256;arena=gcall_main(cpu,FN_NEW,0,1,&size);guest.arena=arena;
            }
            if(request.action==RA_ENTER || request.action==RA_EXIT){
                result=request.epoch!=epoch?RA_STALE:request.value || memcmp(&request.selected,&(RaceRow){0},sizeof request.selected) ||
                    memcmp(&request.options,&(RaceOptions){0},sizeof request.options) || request.password[0]?RA_INVALID:
                    request.action==RA_ENTER?raceentry_enter(cpu,now):raceentry_exit(cpu,now);
            }else result=valid?raceactions_execute(&guest,catalog_valid?&catalog:0,&lobby,epoch,&request,&lease):RA_UNAVAILABLE;
            action=request.action<=RA_EXIT?request.action:0;
            memset(&box.request,0,sizeof box.request);ack=serial;
            fprintf(stderr,"[races] action %u: %u\n",action,result);
            /* Acknowledgement includes the post-command state. Publishing
             * the pre-command list would briefly offer Join/Create again
             * while the original search or room transition is in flight. */
            update_owner();valid=racebrowser_lobby(read_guest,0,catalog_valid?&catalog:0,&lobby);
            next_read=0;
        }
        memset(&request,0,sizeof request);
    }
    uint32_t flags=valid|(guest_rd32(G_RB_DIALOG)?2u:0u)|raceentry_flags();
    if(box.catalog_valid==catalog_valid && box.lobby_flags==flags &&
       box.epoch==epoch && box.ack==ack && box.result==result && box.action==action &&
       !memcmp(&box.catalog,&catalog,sizeof catalog) && !memcmp(&box.lobby,&lobby,sizeof lobby))return;
    __atomic_add_fetch(&box.seq,1,__ATOMIC_SEQ_CST);
    box.catalog_valid=catalog_valid;box.lobby_flags=flags;
    memcpy(&box.catalog,&catalog,sizeof catalog);memcpy(&box.lobby,&lobby,sizeof lobby);
    box.epoch=epoch;box.ack=ack;box.result=result;box.action=action;
    __atomic_add_fetch(&box.seq,1,__ATOMIC_RELEASE);
}
