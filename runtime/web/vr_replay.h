#ifndef NFSU2_VR_REPLAY_H
#define NFSU2_VR_REPLAY_H
#include <stdint.h>
#include <stdlib.h>

/* Physical gear requests arrive after the original pad recorder. Keep them
 * beside its in-memory stream, indexed by simulation frame so snapshot seeks
 * recover the same input. The stream, snapshots and save format stay retail. */
typedef struct {
    uint32_t ticks, before, after;
    unsigned char driver, raw_pedals;
} VrReplayStep;
typedef struct {
    VrReplayStep *steps;
    size_t count, capacity;
    uint32_t manager, stream, first, started;
} VrReplay;
static inline int vr_replay_matches(const VrReplay *r,uint32_t manager,uint32_t stream,uint32_t first,uint32_t started){
    return r->manager==manager && r->stream==stream && r->first==first && r->started==started;
}
static inline VrReplayStep *vr_replay_record(VrReplay *r,uint32_t manager,uint32_t stream,uint32_t first,
                                           uint32_t started,uint32_t frame,uint32_t ticks){
    if(frame==first || !vr_replay_matches(r,manager,stream,first,started)){
        r->manager=manager;r->stream=stream;r->first=first;r->started=started;r->count=0;
    }
    if(frame<first)return NULL;
    size_t i=frame-first;
    /* At most 4 MiB; malformed or discontinuous frame numbers never allocate
     * a sparse history. The original bounded stream ends recording first. */
    if(i>r->count || i>=262144)return NULL;
    if(i==r->capacity){
        size_t capacity=r->capacity?r->capacity*2:256;
        VrReplayStep *steps=realloc(r->steps,capacity*sizeof *steps);
        if(!steps)return NULL;
        r->steps=steps;r->capacity=capacity;
    }
    r->count=i+1;r->steps[i]=(VrReplayStep){.ticks=ticks};
    return &r->steps[i];
}
static inline VrReplayStep *vr_replay_find(VrReplay *r,uint32_t manager,uint32_t stream,uint32_t first,
                                         uint32_t started,uint32_t frame){
    if(!vr_replay_matches(r,manager,stream,first,started) || frame<first || frame-first>=r->count)return NULL;
    return &r->steps[frame-first];
}
#endif
