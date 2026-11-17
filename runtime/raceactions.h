/* Original PC lobby actions, called only on the guest main thread. */
#ifndef NFSU2_RACEACTIONS_H
#define NFSU2_RACEACTIONS_H
#include "racebrowser.h"
enum { RA_SEARCH=1,RA_CREATE,RA_JOIN,RA_READY,RA_START,RA_LEAVE,RA_ENTER,RA_EXIT };
enum { RA_IDLE=0,RA_ACCEPTED,RA_INVALID,RA_STALE,RA_UNAVAILABLE,RA_BUSY,RA_FAILED };
typedef struct {
    uint32_t mode,track,laps,min_players,max_players,reverse,collision,catchup,ranked,private_game,unrestricted;
} RaceOptions;
typedef struct {
    uint32_t epoch,action,value;
    RaceRow selected;
    RaceOptions options;
    char password[33];
    uint8_t reserved[3];
} RaceCommand;
typedef struct {
    RaceRead read;
    int (*write)(void *,uint32_t,const void *,size_t);
    uint32_t (*call)(void *,uint32_t,uint32_t,unsigned,const uint32_t *);
    void *context;
    uint32_t arena; /* 256 checked guest bytes, retained by the caller */
} RaceActionGuest;
/* Only restore fields that still equal this action's value. Login state and
 * account/persona bytes are never captured or written. */
typedef struct { uint8_t previous[0x49],written[0x49]; uint32_t fields; } RaceSettingsLease;
int raceactions_options(const RaceCatalog *,const RaceOptions *,const char password[33],int lan);
unsigned raceactions_execute(const RaceActionGuest *,const RaceCatalog *,const RaceLobby *,uint32_t epoch,
                             const RaceCommand *,RaceSettingsLease *);
int raceactions_release(const RaceActionGuest *,RaceSettingsLease *);
#endif
