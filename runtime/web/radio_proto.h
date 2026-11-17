/* The radio's words shared with the page (runtime/radio.c, web/src/radio.ts, RadioLink in web/src/app/status.ts).
 * Word order and size are the page's layout; web/test/radio.test.mjs checks the order. */
#ifndef NFSU2_RADIO_PROTO_H
#define NFSU2_RADIO_PROTO_H
#include <stdint.h>

#define RADIO_TRACKS 27            /* the game's EA Trax table */
#define RADIO_PLACES 2             /* 0 menus, 1 driving */
#define RADIO_TAG    44            /* bytes of one line of text: the plaque's 40 characters and the NUL, in whole words */
#define RADIO_RATE   44100         /* the game mixer's rate */
#define RADIO_MAGIC  0x31444152u   /* "RAD1": a runtime with the radio writes it first in the block */
#define RADIO_VERSION 5u           /* 5: acknowledged folder seek; all version 4 offsets stay unchanged */
#define RADIO_SONG_NONE   0u       /* song_kind: no song (between two, a race without music, the Radio's silence) */
#define RADIO_SONG_GAME   1u       /* one of the game's EA Trax songs; song_text is its table entry */
#define RADIO_SONG_FOLDER 2u       /* the Radio's track from the folder; song_text is the tags the page gave for it */

#define RADIO_COMMANDS 8u
#define RADIO_PCM 512u
enum { RADIO_PREVIOUS = 1, RADIO_TOGGLE, RADIO_NEXT };
typedef struct {
    uint32_t enabled;              /* page: cockpit wants transport and spectrum */
    uint32_t volume;               /* page: 0..65536, applied only after enabled */
    uint32_t write, read;          /* page producer / mixer consumer, bounded command ring */
    uint32_t commands[RADIO_COMMANDS];
    uint32_t state;                /* runtime: bit 0 live, bit 1 paused, bit 2 owns pause */
    uint32_t pcm_seq;              /* runtime: sequence lock of the latest music-only mono window */
    uint32_t pcm_rate, pcm_frames;
    float pcm[RADIO_PCM];
    uint32_t seek_seq, seek_track, seek_frame; /* page: publish sequence last */
    uint32_t seek_ack, seek_ready; /* mixer freezes both readers before ack; page refills before ready */
} RadioCockpit;
_Static_assert(sizeof(RadioCockpit) == 84 + 4 * RADIO_PCM, "cockpit radio layout");

typedef struct {
    uint32_t radio_magic;          /* RADIO_MAGIC, written when the runtime starts; the page uses nothing below without it */
    uint32_t radio_version;        /* RADIO_VERSION */
    uint32_t on;                   /* odd: on.  Every switch adds one, so the runtime starts afresh at each switch-on; it adds one itself when it cannot go on */
    struct {                       /* written by the page: the next track of each place */
        uint32_t tag_seq;          /* sequence lock of offer_text, odd while the page writes; 0: no text yet */
        uint32_t places;           /* bit k: the page has a track for place k */
    } offer;
    struct {                       /* written by the runtime: the game started a song */
        uint32_t req_seq;          /* counts the requests */
        uint32_t req_index;        /* the place */
    } request;
    struct {                       /* written by the page: the track of request req_seq */
        uint32_t ready_seq;        /* the page serves track req_seq: total is set and written counts from 0 */
        uint32_t failed_seq;       /* the page cannot serve track req_seq */
        uint32_t total;            /* frames of the track; the page lowers it to `read` to end the track early */
        uint32_t written;          /* frames written since the track began */
    } reply;
    struct {                       /* two rings of floats (left, then right) */
        uint32_t ring;             /* address in the module's memory, set by the runtime */
        uint32_t ring_frames;      /* a power of two */
        uint32_t read;             /* frames taken by the runtime */
    } rings;
    uint32_t skip;                 /* written by the page: counts the presses of the next-song key (F7); the runtime stops the playing song once for each, radio on or off */
    /* the song playing, for the page's scrobbles (web/src/app/lastfm.ts); nothing of it is kept up while `listen` is 0 */
    uint32_t listen;               /* written by the page: nonzero while it wants the words below */
    uint32_t song_seq;             /* sequence lock of song_kind and song_text, odd while the runtime writes; +2 at each song the game starts */
    uint32_t song_kind;            /* RADIO_SONG_* */
    uint32_t song_ms;              /* how long the song has been heard: mixed, not paused (the pause menu, a paused tab) */
    uint32_t song_end;             /* the song_seq of the song that played to its end */
    char offer_text[RADIO_PLACES][3][RADIO_TAG];   /* per place: artist, title, album, NUL-padded ASCII */
    char song_text[3][RADIO_TAG];  /* the song playing: artist, title, album, NUL-padded, as the game has them (Latin-1) */
    RadioCockpit cockpit;          /* appended so version 3 text/ring offsets stay unchanged */
} HostStatusRadio;

_Static_assert(sizeof(HostStatusRadio) == 80 + (RADIO_PLACES + 1) * 3 * RADIO_TAG + sizeof(RadioCockpit), "page layout (status.ts)");
#endif
