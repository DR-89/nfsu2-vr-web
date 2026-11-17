#include "raceactions.h"
#include "game.h"
#include <string.h>

static const struct {unsigned offset,size;} fields[]={
    {0,2},{4,4},{8,4},{0xc,1},{0x18,1},{0x19,1},{0x1a,1},
    {0x1b,29},{0x38,2},{0x3a,2},{0x3c,4},{0x48,1}
};
static int read_at(const RaceActionGuest *g,uint32_t at,void *out,size_t n){
    return g && g->read && at && n && n<=0x1000 && at<=UINT32_MAX-(n-1) && g->read(g->context,at,out,n);
}
static int write_at(const RaceActionGuest *g,uint32_t at,const void *in,size_t n){
    return g && g->write && at && n && n<=0x1000 && at<=UINT32_MAX-(n-1) && g->write(g->context,at,in,n);
}
static int word(const RaceActionGuest *g,uint32_t at,uint32_t *v){return read_at(g,at,v,4);}
static void put32(uint8_t *b,uint32_t v){memcpy(b,&v,4);}
static void put16(uint8_t *b,uint32_t v){uint16_t s=(uint16_t)v;memcpy(b,&s,2);}
static int password_valid(const char p[33],unsigned limit){
    if(!p || !memchr(p,0,33) || strlen(p)>limit)return 0;
    for(const unsigned char *s=(const unsigned char *)p;*s;s++)
        if(!((*s>='a'&&*s<='z') || (*s>='A'&&*s<='Z') || (*s>='0'&&*s<='9') || *s=='_' || *s=='-'))return 0;
    return 1;
}
int raceactions_options(const RaceCatalog *cat,const RaceOptions *o,const char password[33],int lan){
    if(!cat || !o || !cat->count || cat->count>RB_CHOICES || !password_valid(password,12) ||
       o->reverse>1 || o->collision>1 || o->catchup>1 || o->ranked>1 || o->private_game>1 || o->unrestricted>1 ||
       (lan && o->ranked) || o->min_players<2+o->ranked || o->min_players>o->max_players ||
       ((o->mode==3 || o->mode==10) && o->catchup))return 0;
    for(unsigned i=0;i<cat->count;i++){
        const RaceChoice *t=&cat->choices[i];
        if(t->mode==o->mode && t->track==o->track)return o->laps>=t->min_laps && o->laps<=t->max_laps &&
            o->max_players<=t->max_players && (!o->reverse || t->reverse);
    }return 0;
}
int raceactions_release(const RaceActionGuest *g,RaceSettingsLease *lease){
    if(!lease)return 0;
    for(unsigned i=0;i<sizeof fields/sizeof *fields;i++)if(lease->fields&(1u<<i)){
        uint8_t b[29];unsigned off=fields[i].offset,n=fields[i].size;
        if(!read_at(g,G_ONLINE_PROFILE+off,b,n))return 0;
        int ours=!memcmp(b,lease->written+off,n);memset(b,0,sizeof b);
        if(ours && !write_at(g,G_ONLINE_PROFILE+off,lease->previous+off,n))return 0;
        lease->fields&=~(1u<<i);
    }
    memset(lease,0,sizeof *lease);return 1;
}
/* Reserve the exact callback-written fields for joins; their expected values
 * come from the freshly validated service record, not the page. */
static int apply(const RaceActionGuest *g,RaceSettingsLease *lease,const RaceOptions *o,const char *password,int join){
    if(lease->fields || !read_at(g,G_ONLINE_PROFILE,lease->previous,sizeof lease->previous))return 0;
    memcpy(lease->written,lease->previous,sizeof lease->written);uint8_t *b=lease->written;
    put32(b+4,join?1:0);put32(b+8,o->mode);b[0x18]=(uint8_t)o->ranked;
    b[0x19]=(uint8_t)o->catchup;b[0x1a]=(uint8_t)o->collision;
    put16(b+0x38,o->track);put16(b+0x3a,o->laps);put32(b+0x3c,o->reverse);
    b[0x1b]=password[0]!=0;memset(b+0x1c,0,28);
    /* Joins pass the separate 32-byte password to DirtySock; its profile's
     * smaller Create-password fields must not truncate or overwrite it. */
    if(!join){
        b[0]=(uint8_t)o->max_players;b[1]=(uint8_t)o->min_players;b[0xc]=(uint8_t)o->unrestricted;
        memcpy(b+0x1c,password,strlen(password));memcpy(b+0x29,password,strlen(password));b[0x48]=(uint8_t)o->private_game;
    }
    unsigned reserve=join?((1u<<1)|(1u<<2)|(1u<<4)|(1u<<5)|(1u<<6)|(1u<<7)|(1u<<8)|(1u<<9)|(1u<<10)):0xfffu;
    for(unsigned i=0;i<sizeof fields/sizeof *fields;i++)if(reserve&(1u<<i)){
        /* Retail writes the seven race options after a successful gjoi. */
        if(!join || i==1 || i==7){
            if(!write_at(g,G_ONLINE_PROFILE+fields[i].offset,b+fields[i].offset,fields[i].size)){
                raceactions_release(g,lease);return 0;
            }
        }
        lease->fields|=1u<<i;
    }
    return 1;
}
static int join_fits(const char *name,const char *password){
    size_t n=16;
    for(unsigned i=0;i<2;i++){
        int spaces=0;
        for(const unsigned char *p=(const unsigned char *)(i?password:name);*p;p++){
            spaces|=*p==' ';n+=*p<32 || *p==127 || strchr("=\":%^",*p)?3:1;
        }if(spaces)n+=2;
    }return n<=95;
}
unsigned raceactions_execute(const RaceActionGuest *g,const RaceCatalog *cat,const RaceLobby *l,uint32_t epoch,
                             const RaceCommand *cmd,RaceSettingsLease *lease){
    if(!g || !g->call || !cmd || !lease || !l || cmd->action<RA_SEARCH || cmd->action>RA_LEAVE)return RA_INVALID;
    if(!epoch || cmd->epoch!=epoch)return RA_STALE;
    uint32_t flow,mode,stage,protocol,pending,callback,screen,owner,pack,dialog;uint8_t connected;
    if(!word(g,G_FLOW,&flow) || !word(g,G_GAMEMODE,&mode) || flow!=3 || (mode!=8 && mode!=0x200) ||
       !word(g,G_ONLINE_PROFILE+0x50,&stage) || !word(g,G_LOBBY_MANAGER+0x44,&protocol) || !protocol ||
       !read_at(g,G_LOBBY_MANAGER+0x48,&connected,1) || !connected ||
       !word(g,G_LOBBY_MANAGER+0x4c,&pending) || !word(g,G_LOBBY_GAMES+0xc,&callback) ||
       !word(g,G_LOBBY_GAMES+0x10,&screen) || !screen)return RA_UNAVAILABLE;
    if(!word(g,G_RB_DIALOG,&dialog))return RA_UNAVAILABLE;
    if(stage!=17 || pending || dialog)return RA_BUSY;
    int room=cmd->action>=RA_READY;
    if((room?l->source!=RB_ROOM:l->source!=RB_LIST) || callback!=(room?CB_PC_GAME_ROOM:CB_PC_LOBBY) ||
       !word(g,screen+(room?0x1170:0x108),&owner) || owner!=G_LOBBY_GAMES ||
       !word(g,screen+4,&pack) || !pack)return RA_UNAVAILABLE;
    if(room && !racebrowser_same_race(&cmd->selected,&l->current))return RA_STALE;
    if(room && (l->current.system_flags&0x80000u))return RA_BUSY;
    uint32_t args[4];int32_t result;
    switch(cmd->action){
    case RA_SEARCH:{
        if(cmd->value>4095 || cmd->value%RB_PAGE)return RA_INVALID;
        uint8_t settings[24]={0};put32(settings,cmd->value);put32(settings+4,RB_PAGE);
        settings[8]=1;put32(settings+12,UINT32_MAX);settings[19]=1;
        if(!write_at(g,g->arena,settings,sizeof settings))return RA_FAILED;
        args[0]=g->arena;args[1]=0;args[2]=CB_RB_SEARCH;args[3]=screen;
        result=(int32_t)g->call(g->context,FN_RB_SEARCH,G_LOBBY_GAMES,4,args);
        if(result<0)return RA_FAILED;
        uint32_t page=cmd->value/RB_PAGE;
        if(!write_at(g,screen+0x100,&page,4))return RA_FAILED;
        args[0]=18;g->call(g->context,FN_RB_STAGE,G_ONLINE_PROFILE,1,args);return RA_ACCEPTED;
    }
    case RA_CREATE:{
        uint32_t target;
        if(!raceactions_options(cat,&cmd->options,cmd->password,mode==0x200))return RA_INVALID;
        if(!word(g,G_RB_ROOM_NAME,&target) || !target || !apply(g,lease,&cmd->options,cmd->password,0))return RA_FAILED;
        /* The original room constructor owns gcre, its callback, car choice,
         * waiting dialog and errors. No replacement network coordinator. */
        args[0]=pack;args[1]=target;args[2]=0;g->call(g->context,FN_RB_SWITCH,0,3,args);return RA_ACCEPTED;
    }
    case RA_JOIN:{
        if(cmd->value>=l->count || !racebrowser_same_race(&cmd->selected,&l->rows[cmd->value]))return RA_STALE;
        const RaceRow *r=&l->rows[cmd->value];
        if(!r->compatible || !r->players || r->players>=r->max_players || (r->system_flags&0x80000u))return RA_UNAVAILABLE;
        if(!password_valid(cmd->password,32) || !join_fits(r->name,cmd->password))return RA_INVALID;
        RaceOptions o={.mode=r->mode,.track=r->track,.laps=r->laps,.reverse=r->reverse,
            .collision=r->custom_flags&1,.catchup=(r->custom_flags>>1)&1,.ranked=(r->system_flags>>18)&1};
        uint8_t clear[100]={0};
        if(!write_at(g,g->arena,r->name,sizeof r->name) || !write_at(g,g->arena+64,cmd->password,33) ||
           !apply(g,lease,&o,cmd->password,1)){
            write_at(g,g->arena,clear,sizeof clear);return RA_FAILED;
        }
        args[0]=g->arena;args[1]=g->arena+64;args[2]=CB_RB_JOIN;args[3]=screen;
        result=(int32_t)g->call(g->context,FN_RB_JOIN,G_LOBBY_GAMES,4,args);
        write_at(g,g->arena,clear,sizeof clear);
        if(result<0){raceactions_release(g,lease);return RA_FAILED;}
        args[0]=18;g->call(g->context,FN_RB_STAGE,G_ONLINE_PROFILE,1,args);return RA_ACCEPTED;
    }
    case RA_READY:
        if(cmd->value>1)return RA_INVALID;
        args[0]=cmd->value;result=(int32_t)g->call(g->context,FN_RB_READY,G_LOBBY_GAMES,1,args);
        if(result<0)return RA_FAILED;
        {uint8_t ready=(uint8_t)cmd->value;if(!write_at(g,screen+0x11bf,&ready,1))return RA_FAILED;}
        return RA_ACCEPTED;
    case RA_START:
        if(!l->host || !l->startable)return RA_UNAVAILABLE;
        g->call(g->context,FN_RB_START,screen,0,0);return RA_ACCEPTED;
    case RA_LEAVE:
        g->call(g->context,FN_RB_LEAVE,screen,0,0);return RA_ACCEPTED;
    default:return RA_INVALID;
    }
}
