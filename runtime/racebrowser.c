#include "racebrowser.h"
#include "game.h"
#include <stdio.h>
#include <string.h>

static int bytes(RaceRead read,void *ctx,uint32_t at,void *out,size_t size){
    return read && at && size && size<=UINT32_MAX && at<=UINT32_MAX-(uint32_t)(size-1) && read(ctx,at,out,size);
}
static uint32_t u32(const void *p){ uint32_t v;memcpy(&v,p,4);return v; }
static uint16_t u16(const void *p){ uint16_t v;memcpy(&v,p,2);return v; }
static int word(RaceRead r,void *c,uint32_t a,uint32_t *v){ return bytes(r,c,a,v,4); }
static uint32_t mode_mask(uint32_t mode){
    switch(mode){case 0:return 1;case 1:return 4;case 2:return 2;case 3:return 8;case 4:return 0x2000;case 10:return 0x800;default:return 0;}
}
static int text(const char *s,size_t cap,int empty){
    const char *end=memchr(s,0,cap);if(!end || (!empty && end==s))return 0;
    for(const unsigned char *p=(const unsigned char *)s;p<(const unsigned char *)end;++p)if(*p<32 || *p==127)return 0;
    return 1;
}
static int persona(const char s[16]){
    if(!text(s,16,0))return 0;size_t n=strlen(s);if(n<3)return 0;
    for(size_t i=0;i<n;i++){unsigned char ch=(unsigned char)s[i];
        if(!((ch>='a'&&ch<='z')||(ch>='A'&&ch<='Z')||(ch>='0'&&ch<='9')||ch=='_'||ch=='-'))return 0;}
    return 1;
}
/* The supplied custom-font packs repurpose some single-byte glyphs. Their
 * mapping takes precedence over the base file's unrelated legacy glyphs;
 * Russian/CJK/Thai use the original character table without substitutions. */
static uint16_t font_letter(const char *font,uint8_t b){
    if(!font || !*font || b<128)return 0;
    static const uint8_t pl_bytes[]={0xe7,0xe9,0xbf,0xee,0xf1,0xe2,0xeb,0xe1,0xfd,0xc8,0xc7,0xfa,0xd1,0xda,0xc9};
    static const uint16_t pl[]={0x105,0x107,0x119,0x142,0x144,0x15b,0x17a,0x17c,0x104,0x106,0x118,0x141,0x143,0x15a,0x17b};
    static const uint8_t tr_bytes[]={0xed,0xcd,0xff,0xfe,0xfd,0xdd};
    static const uint16_t tr[]={0x131,0x130,0x15f,0x15e,0x11f,0x11e};
    static const uint8_t hu_bytes[]={0xf5,0xd5,0xfb,0xdb};
    static const uint16_t hu[]={0x151,0x150,0x171,0x170};
    if(!strcmp(font,"polish")){for(unsigned i=0;i<sizeof pl_bytes;i++)if(b==pl_bytes[i])return pl[i];}
    else if(!strcmp(font,"turkish")){for(unsigned i=0;i<sizeof tr_bytes;i++)if(b==tr_bytes[i])return tr[i];}
    else if(!strcmp(font,"hungarian")){for(unsigned i=0;i<sizeof hu_bytes;i++)if(b==hu_bytes[i])return hu[i];}
    else if(!strcmp(font,"ukrainian") && b>=0xe2 && b<=0xe7){
        static const uint16_t uk[]={0x406,0x456,0x407,0x457,0x404,0x454};return uk[b-0xe2];
    }else if(!strcmp(font,"slovak")){
        static const uint16_t cp1250[128]={
            0x20ac,0xfffd,0x201a,0xfffd,0x201e,0x2026,0x2020,0x2021,0xfffd,0x2030,0x160,0x2039,0x15a,0x164,0x17d,0x179,
            0xfffd,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0xfffd,0x2122,0x161,0x203a,0x15b,0x165,0x17e,0x17a,
            0xa0,0x2c7,0x2d8,0x141,0xa4,0x104,0xa6,0xa7,0xa8,0xa9,0x15e,0xab,0xac,0xad,0xae,0x17b,
            0xb0,0xb1,0x2db,0x142,0xb4,0xb5,0xb6,0xb7,0xb8,0x105,0x15f,0xbb,0x13d,0x2dd,0x13e,0x17c,
            0x154,0xc1,0xc2,0x102,0xc4,0x139,0x106,0xc7,0x10c,0xc9,0x118,0xcb,0x11a,0xcd,0xce,0x10e,
            0x110,0x143,0x147,0xd3,0xd4,0x150,0xd6,0xd7,0x158,0x16e,0xda,0x170,0xdc,0xdd,0x162,0xdf,
            0x155,0xe1,0xe2,0x103,0xe4,0x13a,0x107,0xe7,0x10d,0xe9,0x119,0xeb,0x11b,0xed,0xee,0x10f,
            0x111,0x144,0x148,0xf3,0xf4,0x151,0xf6,0xf7,0x159,0x16f,0xfa,0x171,0xfc,0xfd,0x163,0x2d9,
        };return cp1250[b-128];
    }else if(!strcmp(font,"greek") && b>=0xa1){
        static const uint8_t keep[]={0xa9,0xab,0xae,0xb7,0xbb,0xbc,0xd1};
        unsigned index=0;
        for(unsigned k=0xa1;k<=b;k++){
            int kept=0;for(unsigned i=0;i<sizeof keep;i++)kept|=k==keep[i];
            if(kept){if(k==b)return 0;}else if(k<b)index++;
        }
        for(unsigned c=0x386;c<=0x3ce;c++)if(c==0x386 || (c>=0x388&&c<=0x38a) || c==0x38c ||
           (c>=0x38e&&c<=0x3a1) || c>=0x3a3){if(!index--)return (uint16_t)c;}
    }
    return 0;
}
/* Bounded equivalent of the PC converter at 0x50d3c0. Read only the table
 * entries needed for this label, never assume a particular pack/table size. */
static int caption(RaceRead read,void *ctx,const char *font,uint32_t table,int direct,const uint8_t *src,unsigned n,char out[RB_LABEL]){
    unsigned at=0,o=0;
    while(at<n){
        uint8_t b=src[at++];uint16_t c=font_letter(font,b);
        if(!c){
            c=b;
            if(b>=128 && !direct){
                uint32_t offset=4u+2u*b;
                if(!table || table>UINT32_MAX-offset || !bytes(read,ctx,table+offset,&c,2))return 0;
                if(!c)c=b;
                else if(c<128){
                    if(at==n)return 0; /* never consume the next string after a dangling lead */
                    uint8_t second=src[at++];
                    if(second<128)c='_';
                    else{
                        offset=2u*((uint32_t)c*128u+second)-0xfcu;
                        if(table>UINT32_MAX-offset || !bytes(read,ctx,table+offset,&c,2))return 0;
                        if(!c)c='_';
                    }
                }
            }
        }
        if(c<32 || (c>=127&&c<160) || (c>=0xd800&&c<=0xdfff) || c>=0xfffe)return 0;
        if(c<128)out[o++]=(char)c;
        else if(c<2048){out[o++]=(char)(0xc0|(c>>6));out[o++]=(char)(0x80|(c&63));}
        else{out[o++]=(char)(0xe0|(c>>12));out[o++]=(char)(0x80|((c>>6)&63));out[o++]=(char)(0x80|(c&63));}
    }
    out[o]=0;return o!=0;
}
static int label(RaceRead read,void *ctx,const uint32_t lang[4],const char *font,int direct,uint32_t id,int reverse,char out[RB_LABEL]){
    if(!lang[0] || lang[0]>200000 || !lang[1] || !lang[2] || lang[2]>UINT32_MAX-lang[0]*8)return 0;
    char key[48];snprintf(key,sizeof key,reverse?"REVERSE_TRACK_NAME_%u":"TRACK_NAME_%u",id);
    uint32_t hash=UINT32_MAX;for(const unsigned char *p=(const unsigned char *)key;*p;p++)hash=hash*33+*p;
    uint32_t lo=0,hi=lang[0],pair[2],adj;
    while(lo<hi){uint32_t mid=lo+(hi-lo)/2;if(!bytes(read,ctx,lang[2]+8*mid,pair,8))return 0;
        if(pair[0]<hash)lo=mid+1;else hi=mid;}
    if(lo==lang[0] || !bytes(read,ctx,lang[2]+8*lo,pair,8) || pair[0]!=hash || pair[1]<lang[1] || pair[1]>UINT32_MAX-RB_TEXT_BYTES)return 0;
    if(lo && (!word(read,ctx,lang[2]+8*(lo-1),&adj) || adj>=hash))return 0;
    if(lo+1<lang[0] && (!word(read,ctx,lang[2]+8*(lo+1),&adj) || adj<=hash))return 0;
    uint8_t value[RB_TEXT_BYTES]={0};
    for(unsigned i=0;i<RB_TEXT_BYTES;i++){
        if(!bytes(read,ctx,pair[1]+i,value+i,1))return 0;
        if(!value[i]){char decoded[RB_LABEL]={0};if(!caption(read,ctx,font,lang[3],direct,value,i,decoded))return 0;memcpy(out,decoded,sizeof decoded);return 1;}
        if((unsigned char)value[i]<32 || (unsigned char)value[i]==127)return 0;
    }return 0;
}
int racebrowser_catalog(RaceRead read,void *ctx,const char *font,RaceCatalog *out){
    if(!out)return 0;memset(out,0,sizeof *out);
    uint32_t cat[2],again[4],lang[4],direct,after;
    if(!bytes(read,ctx,G_TRACK_CATALOG,cat,sizeof cat) || !cat[0] || !cat[1] || cat[1]>RB_TRACK_LIMIT ||
       cat[0]>UINT32_MAX-cat[1]*0x128u || !bytes(read,ctx,G_LANGUAGE_TABLE,lang,sizeof lang) || !word(read,ctx,G_TEXT_BYTE_MODE,&direct))return 0;
    /* Copy once, then build all six lists. The only duplicate ID in stock
     * data is an unused placeholder; no playable duplicate is accepted. */
    uint8_t records[RB_TRACK_LIMIT][0x98];
    const uint32_t masks=1|2|4|8|0x2000|0x800;
    for(unsigned i=0;i<cat[1];i++){
        uint8_t *b=records[i];if(!bytes(read,ctx,cat[0]+i*0x128u,b,0x98))goto bad;
        unsigned id=u16(b+0x8a);if(!id || id>INT16_MAX)goto bad;
        int enabled=id!=4000 && id!=4801 && !b[0x88] && (u32(b+0x94)&masks);
        for(unsigned j=0;j<i;j++)if(u16(records[j]+0x8a)==id &&
            (enabled || (id!=4000 && id!=4801 && !records[j][0x88] && (u32(records[j]+0x94)&masks))))goto bad;
        if(enabled && (u32(b+0x80)>1 || b[0x86]>1))goto bad;
    }
    const unsigned modes[]={0,1,2,3,4,10};
    for(unsigned m=0;m<6;m++)for(unsigned i=0;i<cat[1];i++){
        const uint8_t *b=records[i];unsigned id=u16(b+0x8a),mode=modes[m];
        if(id==4000 || id==4801 || b[0x88] || !(u32(b+0x94)&mode_mask(mode)))continue;
        if(out->count==RB_CHOICES)goto bad;
        RaceChoice *t=&out->choices[out->count++];t->mode=mode;t->track=id;t->reverse=b[0x86];
        t->max_players=mode==2?(id==4402?3:4):6;
        t->min_laps=mode==1 || mode==2 || (mode==3 && u32(b+0x80))?1:mode==10?4:2;
        t->max_laps=t->min_laps==1?1:10;
        label(read,ctx,lang,font,direct!=0,id,0,t->name);
        if(!t->reverse || !label(read,ctx,lang,font,direct!=0,id,1,t->reverse_name))memcpy(t->reverse_name,t->name,RB_LABEL);
    }
    if(!bytes(read,ctx,G_TRACK_CATALOG,again,sizeof cat) || memcmp(cat,again,sizeof cat) ||
       !bytes(read,ctx,G_LANGUAGE_TABLE,again,sizeof lang) || memcmp(lang,again,sizeof lang) || !word(read,ctx,G_TEXT_BYTE_MODE,&after) || direct!=after)goto bad;
    return out->count!=0;
bad:memset(out,0,sizeof *out);return 0;
}
static int space(char c){ return c==' ' || c=='\t' || c=='\n' || c=='\r'; }
int racebrowser_info(const RaceCatalog *cat,RaceRow *row){
    if(!row)return 0;row->parsed=row->compatible=row->track=row->laps=row->reverse=0;row->mode=UINT32_MAX;
    if(!memchr(row->params,0,sizeof row->params))return 0;
    const char *p=row->params;unsigned fields=0,track=0,laps=0,reverse=0;
    while(*p){
        while(space(*p))p++;if(!*p)break;
        unsigned bit,value=0;
        if(!strncmp(p,"TRACK=",6)){bit=1;p+=6;}
        else if(!strncmp(p,"DIR=",4)){bit=2;p+=4;}
        else if(!strncmp(p,"LAPS=",5)){bit=4;p+=5;}
        else return 0;
        if((fields&bit) || *p<'0' || *p>'9')return 0;
        while(*p>='0'&&*p<='9'){unsigned d=(unsigned)(*p++-'0');if(value>(UINT32_MAX-d)/10)return 0;value=value*10+d;}
        if(*p && !space(*p))return 0;
        if(bit==1)track=value;else if(bit==2)reverse=value;else laps=value;fields|=bit;
    }
    if(fields!=7 || !track || track>INT16_MAX || reverse>1 || !laps || laps>10)return 0;
    row->parsed=1;row->track=track;row->laps=laps;row->reverse=reverse;
    switch(row->custom_flags&0xfe000000u){
    case 0x04000000:row->mode=0;break;case 0x08000000:row->mode=1;break;case 0x10000000:row->mode=2;break;
    case 0x20000000:row->mode=3;break;case 0x40000000:row->mode=10;break;case 0x80000000:row->mode=4;break;default:return 1;
    }
    if(!cat || cat->count>RB_CHOICES)return 1;
    for(unsigned i=0;i<cat->count;i++){
        const RaceChoice *t=&cat->choices[i];if(t->track!=track || t->mode!=row->mode)continue;
        row->compatible=laps>=t->min_laps && laps<=t->max_laps && (!reverse || t->reverse) &&
            row->min_players>=2 && row->min_players<=row->max_players && row->max_players<=t->max_players && row->players<=row->max_players;
        break;
    }return 1;
}
static int decode_row(RaceRead read,void *ctx,uint32_t address,const RaceCatalog *cat,RaceRow *out){
    uint8_t b[0x1c0];if(!bytes(read,ctx,address,b,sizeof b))return 0;
    out->id=(int32_t)u32(b);memcpy(out->name,b+4,36);memcpy(out->host,b+0x38,16);memcpy(out->params,b+0x8c,132);
    out->custom_flags=u32(b+0x110);out->system_flags=u32(b+0x114);out->min_players=u32(b+0x118);
    out->max_players=u32(b+0x11c);out->seed=u32(b+0x120);out->players=u32(b+0x1bc);
    if(out->id<0 || !text(out->name,36,0) || !persona(out->host) || !memchr(out->params,0,132) ||
       out->players>out->max_players || out->min_players>out->max_players || out->max_players>8)return 0;
    /* Blank the tail after each terminator: retail may reuse the same record
     * for another game. Only the displayed text belongs in a snapshot. */
    memset(out->name+strlen(out->name),0,36-strlen(out->name));memset(out->host+strlen(out->host),0,16-strlen(out->host));
    memset(out->params+strlen(out->params),0,132-strlen(out->params));racebrowser_info(cat,out);return 1;
}
int racebrowser_same_race(const RaceRow *a,const RaceRow *b){
    return a && b && a->id>=0 && a->id==b->id && a->seed==b->seed && a->min_players==b->min_players &&
        a->max_players==b->max_players && a->custom_flags==b->custom_flags && a->system_flags==b->system_flags &&
        !memcmp(a->name,b->name,sizeof a->name) && !memcmp(a->host,b->host,sizeof a->host) && !memcmp(a->params,b->params,sizeof a->params);
}
int racebrowser_lobby(RaceRead read,void *ctx,const RaceCatalog *cat,RaceLobby *out){
    if(!out)return 0;memset(out,0,sizeof *out);
    uint32_t flow,mode,stage,protocol,pending,cb,screen;
    if(!word(read,ctx,G_FLOW,&flow) || !word(read,ctx,G_GAMEMODE,&mode))return 0;
    if(flow!=3 || (mode!=8 && mode!=0x200))return 1;
    out->source=RB_WAITING;
    if(!word(read,ctx,G_ONLINE_PROFILE+0x50,&stage) || !word(read,ctx,G_LOBBY_MANAGER+0x44,&protocol) ||
       !word(read,ctx,G_LOBBY_MANAGER+0x4c,&pending) || !word(read,ctx,G_LOBBY_GAMES+0xc,&cb) ||
       !word(read,ctx,G_LOBBY_GAMES+0x10,&screen))goto bad;
    if(stage!=0x11 || !protocol || pending || !screen || (cb!=CB_PC_LOBBY && cb!=CB_PC_GAME_ROOM))return 1;
    if(!bytes(read,ctx,G_ONLINE_PROFILE+(mode==0x200?LAN_PERSONA:ONLINE_PERSONA),out->persona,16) || !persona(out->persona))goto bad;
    memset(out->persona+strlen(out->persona),0,16-strlen(out->persona));
    if(cb==CB_PC_LOBBY){
        uint32_t list,head[17],check[17];
        if(!word(read,ctx,G_LOBBY_GAMES+8,&list) || !bytes(read,ctx,list,head,sizeof head) ||
           head[5]>head[6] || head[6]>4096 || (head[5] && (!head[16] || head[16]>UINT32_MAX-head[5]*4)))goto bad;
        out->listed=head[5];out->count=out->listed>RB_PAGE?RB_PAGE:out->listed;
        for(unsigned i=0;i<out->count;i++){
            uint32_t node,record;
            if(!word(read,ctx,head[16]+i*4,&node) || !word(read,ctx,node,&record) || !decode_row(read,ctx,record,cat,&out->rows[i]))goto bad;
            for(unsigned j=0;j<i;j++)if(out->rows[i].id==out->rows[j].id)goto bad;
        }
        if(!bytes(read,ctx,list,check,sizeof check) || memcmp(head,check,sizeof head))goto bad;
        out->source=RB_LIST;
    }else{
        if(!decode_row(read,ctx,G_LOBBY_GAMES+0x1c,cat,&out->current) || !out->current.compatible ||
           !word(read,ctx,G_LOBBY_GAMES+0x1d8,&out->players) || !out->players || out->players>RB_PLAYERS ||
           out->players!=out->current.players)goto bad;
        unsigned local=0;
        for(unsigned i=0;i<out->players;i++){
            if(!bytes(read,ctx,G_LOBBY_GAMES+0x1e0+i*0x64,out->names[i],16) || !persona(out->names[i]) ||
               !word(read,ctx,G_LOBBY_GAMES+0x218+i*0x64,&out->flags[i]))goto bad;
            for(unsigned j=0;j<i;j++)if(!strcmp(out->names[i],out->names[j]))goto bad;
            memset(out->names[i]+strlen(out->names[i]),0,16-strlen(out->names[i]));
            if(!strcmp(out->names[i],out->persona)){local++;out->local_ready=(out->flags[i]&0x08000000u)!=0;}
        }
        if(local!=1 || strcmp(out->current.host,out->names[0]))goto bad;
        out->host=!strcmp(out->persona,out->names[0]);out->startable=out->host && out->players>=out->current.min_players;
        for(unsigned i=1;i<out->players;i++)if(!(out->flags[i]&0x08000000u))out->startable=0;
        out->source=RB_ROOM;
    }
    uint32_t after;
    if(!word(read,ctx,G_FLOW,&after) || after!=flow || !word(read,ctx,G_GAMEMODE,&after) || after!=mode ||
       !word(read,ctx,G_LOBBY_MANAGER+0x44,&after) || after!=protocol || !word(read,ctx,G_LOBBY_MANAGER+0x4c,&after) || after ||
       !word(read,ctx,G_LOBBY_GAMES+0xc,&after) || after!=cb || !word(read,ctx,G_LOBBY_GAMES+0x10,&after) || after!=screen ||
       !word(read,ctx,G_ONLINE_PROFILE+0x50,&after) || after!=stage)goto bad;
    return 1;
bad:memset(out,0,sizeof *out);return 0;
}
