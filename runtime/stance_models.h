/* Model-wide visual defaults for the native VR editor. The page keeps this
 * versioned ASCII value in settings.ini; game-specific garage entries remain
 * in MODPARTS.DAT. Parsing is all-or-nothing, including duplicate names. */
#ifndef NFSU2_STANCE_MODELS_H
#define NFSU2_STANCE_MODELS_H
#include "stance.h"
#include <string.h>

#define STANCE_MODELS_MAX 46
#define STANCE_MODELS_BYTES 4096
typedef struct { char name[16]; StanceV value; } StanceModel;
typedef struct { unsigned count; StanceModel car[STANCE_MODELS_MAX]; } StanceModels;

static inline int stance_model_name(int c){return (c>='A'&&c<='Z') || (c>='0'&&c<='9') || c=='_';}
static inline int stance_model_number(const char **at,int *out){
    const char *p=*at;int sign=1,n=0,count=0;
    if(*p=='-'){sign=-1;p++;}
    while(*p>='0'&&*p<='9'){if(++count>3)return 0;n=n*10+(*p++-'0');}
    if(!count)return 0;*at=p;*out=sign*n;return 1;
}
static inline int stance_models_parse(const char *text,StanceModels *out){
    StanceModels next={0};
    if(!text || !out || strnlen(text,STANCE_MODELS_BYTES)>=STANCE_MODELS_BYTES)return 0;
    if(!*text){*out=next;return 1;}
    if(text[0]!='v'||text[1]!='1'||(text[2]&&text[2]!='|'))return 0;
    const char *p=text+2;
    while(*p){
        if(*p++!='|' || next.count>=STANCE_MODELS_MAX)return 0;
        StanceModel *m=&next.car[next.count];unsigned n=0;
        while(stance_model_name((unsigned char)*p)){if(n==15)return 0;m->name[n++]=*p++;}
        if(!n || *p++!=':')return 0;
        for(unsigned i=0;i<next.count;i++)if(!strcmp(m->name,next.car[i].name))return 0;
        int v[5];
        for(unsigned i=0;i<5;i++)if(!stance_model_number(&p,&v[i]) || (i<4 && *p++!=','))return 0;
        if(v[0]<0||v[0]>150||v[1]<0||v[1]>150||v[2]<-40||v[2]>80||v[3]<-40||v[3]>80||v[4]<80||v[4]>130)return 0;
        m->value=(StanceV){(int16_t)v[0],(int16_t)v[1],(int16_t)v[2],(int16_t)v[3],(uint16_t)v[4]};
        next.count++;
    }
    *out=next;return 1;
}
static inline const StanceV *stance_models_find(const StanceModels *models,const char *name){
    for(unsigned i=0;i<models->count;i++)if(!strcmp(models->car[i].name,name))return &models->car[i].value;
    return 0;
}
#endif
