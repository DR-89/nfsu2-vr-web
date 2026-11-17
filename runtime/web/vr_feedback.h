#ifndef NFSU2_VR_FEEDBACK_H
#define NFSU2_VR_FEEDBACK_H
#include <math.h>
/* Native quest_haptics.h: retain a short impact across rendered frames,
 * expire absent reports, and keep the two motor channels independent of hands. */
typedef struct { float current,peak; double reported,peaked; int received; } VrRoad;
static inline void vr_road_report(VrRoad *r,double now,float low,float high){
    float a=fmaxf(isfinite(low)?low:0,isfinite(high)?high:0);
    a=fminf(1,fmaxf(0,a));a*=.15f+.85f*a;
    if(!r->received || a>r->peak || now-r->peaked>=65){r->peak=a;r->peaked=now;}
    r->current=a;r->reported=now;r->received=1;
}
static inline float vr_road_sample(VrRoad *r,double now){
    if(!r->received)return 0;
    double age=now-r->reported;
    if(!isfinite(age) || age<0 || age>=250){*r=(VrRoad){0};return 0;}
    return fmaxf(r->current,now-r->peaked<65?r->peak:0);
}
#endif
