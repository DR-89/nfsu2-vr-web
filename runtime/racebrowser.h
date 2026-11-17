/* Copied PC race-browser data. Guest addresses, authentication fields and
 * passwords never leave the reader. All reads run on the guest main thread. */
#ifndef NFSU2_RACEBROWSER_H
#define NFSU2_RACEBROWSER_H
#include <stddef.h>
#include <stdint.h>

enum { RB_TRACK_LIMIT=512, RB_CHOICES=128, RB_PAGE=20, RB_PLAYERS=6, RB_TEXT_BYTES=128, RB_LABEL=384 };
typedef int (*RaceRead)(void *context,uint32_t address,void *out,size_t size);
typedef struct {
    uint32_t mode,track,reverse,min_laps,max_laps,max_players;
    /* UTF-8 decoded with the loaded PC character table and installed font
     * mapping. A missing/invalid label stays empty; reverse falls back. */
    char name[RB_LABEL],reverse_name[RB_LABEL];
} RaceChoice;
typedef struct { uint32_t count; RaceChoice choices[RB_CHOICES]; } RaceCatalog;
typedef struct {
    int32_t id;
    uint32_t players,min_players,max_players,custom_flags,system_flags,seed;
    char name[36],host[16],params[132];
    uint32_t parsed,compatible,mode,track,laps,reverse;
} RaceRow;
enum { RB_NONE=0, RB_WAITING, RB_LIST, RB_ROOM };
typedef struct {
    uint32_t source,listed,count,host,local_ready,startable;
    char persona[16];
    RaceRow current,rows[RB_PAGE];
    uint32_t players;
    char names[RB_PLAYERS][16];
    uint32_t flags[RB_PLAYERS];
} RaceLobby;

/* Returns 0 and clears the complete output on invalid or changing memory.
 * Catalogue rules match 0x4987c0 and the existing netrace.c overrides. */
int racebrowser_catalog(RaceRead,void *,const char *font_mapping,RaceCatalog *);
int racebrowser_lobby(RaceRead,void *,const RaceCatalog *,RaceLobby *);
/* Strict service PARAMS parser; parsed and locally playable are distinct.
 * An unknown mode/track remains visible but cannot be joined. */
int racebrowser_info(const RaceCatalog *,RaceRow *);
/* Stable identity check before a future join; occupancy may change, but the
 * ID, seed, host, settings and name must still describe the selected race. */
int racebrowser_same_race(const RaceRow *,const RaceRow *);
#endif
