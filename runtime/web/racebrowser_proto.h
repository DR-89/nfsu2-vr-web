/* HOST_KIND_RACES: guest-written snapshots plus a single page command slot.
 * request_seq is published last (even); the guest copies, validates, clears
 * the slot and acknowledges that sequence. No guest pointers or account
 * secrets cross this boundary; race passwords are input only. */
#ifndef NFSU2_RACEBROWSER_PROTO_H
#define NFSU2_RACEBROWSER_PROTO_H
#include "raceactions.h"
#define RB_MAGIC 0x31534252u
#define RB_VERSION 5u
typedef struct {
    uint32_t magic,version,size,seq;
    uint32_t catalog_valid,lobby_flags; /* bit 0: valid, bit 1: original dialog; raceentry.h flags above */
    RaceCatalog catalog;
    RaceLobby lobby;
    uint32_t epoch,ack,result,action;
    uint32_t request_seq;
    RaceCommand request;
} RaceBrowserBox;
_Static_assert(sizeof(RaceChoice)==792,"race choice ABI");
_Static_assert(sizeof(RaceRow)==236,"race row ABI");
_Static_assert(sizeof(RaceLobby)==5120,"race lobby ABI");
_Static_assert(sizeof(RaceCommand)==328,"race command ABI");
_Static_assert(offsetof(RaceBrowserBox,request_seq)==106540,"race snapshot ABI");
_Static_assert(sizeof(RaceBrowserBox)==106872,"race browser ABI");
#endif
