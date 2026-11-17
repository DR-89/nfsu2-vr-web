/* The distance to the GPS destination under its arrow (settings.ini gps_distance, the Mods tab's GPS Distance; off at
 * first): in a straight line, not by road, in m/km or ft/mi as Speedometer Units has it, under the arrow of each
 * player on this computer whose HUD has one, from their own car (co-op's player 2's HUD has none: the GPS is player
 * 1's in the game; tests/scripts/gps_distance_coop.txt).  The text is a copy of the HUD's ONLINE_PLAYER_1 named
 * GPS_DISTANCE (roam_game_clone_hud_text), the HUD package's own: freed with it, and looked up by its name every
 * frame, so no pointer outlives a HUD (shops, races, pause).  "[gps]" log line when one is made. */
#include "cpu.h"
#include "guest.h"
#include "game.h"
#include "splitscreen_mem.h"
#include "gpsdistance_format.h"
#include "gpsdistance.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <strings.h>

uint32_t roam_game_clone_hud_text(CPU *, uint32_t, uint32_t, const char *);

/* a guest function with ecx and stack arguments, returning to itself, 512 bytes below the hook's stack (guest.h) */
static uint32_t call(CPU *c, uint32_t fn, uint32_t self, int n, const uint32_t *args){
    return guest_call_ex(c, fn, self, c->edx, n, args, fn, 512u);
}
static uint32_t one(CPU *c, uint32_t fn, uint32_t self, uint32_t arg){ return call(c, fn, self, 1, &arg); }

static int enabled = -1,ever_enabled;
void gpsdistance_set_enabled(int on){if(on==0 || on==1){enabled=on;if(on)ever_enabled=1;}}
static int gps_enabled(void){
    if (enabled < 0){
        const char *v = getenv("NFSU2_GPS_DISTANCE");
        enabled = v && (!strcmp(v, "1") || !strcasecmp(v, "on") || !strcasecmp(v, "true"));
    }
    if(enabled)ever_enabled=1;
    return enabled;
}
int gpsdistance_read(CPU *c, uint32_t pl, float *metres, int *metric){
    if (!gps_enabled() || !guest_ok(pl, PLAYER_HUD + 3u)) return 0;
    unsigned seat = 0;
    while (seat < SPLIT_PORT_CAPACITY && guest_rd32(SPLIT_PLAYERS_INDEX + seat * 4u) != pl) ++seat;
    if (seat == SPLIT_PORT_CAPACITY) return 0;
    uint32_t hud = guest_rd32(pl + PLAYER_HUD), car = guest_rd32(pl + 4u);
    uint32_t part = guest_ok(hud, HUD_GPS_PART + 3u) ? guest_rd32(hud + HUD_GPS_PART) : 0;
    if (!guest_ok(car, CAR_WORLD_POS + 7u) || !guest_ok(part, 0x1fu) || !MR8(G_GPS_ACTIVE) || MR32(G_RACETYPE) ||
        !((MR32(part + 0x10u) & MR32(part + 0x18u)) || (MR32(part + 0x14u) & MR32(part + 0x1cu)))) return 0;
    uint32_t state = call(c, FN_GPS_STATE, G_GPS, 0, NULL);
    if (state != 0 && state != 3) return 0;
    float distance = hypotf(MRF32(G_GPS_TARGET) - MRF32(car + CAR_WORLD_POS), MRF32(G_GPS_TARGET + 4u) - MRF32(car + CAR_WORLD_POS + 4u));
    if (!isfinite(distance) || distance >= 1000000.f) return 0;
    *metres = distance; *metric = MR8(G_SPEED_UNITS) == 1;
    return 1;
}
void gpsdistance_hud(CPU *c){
    /* A live switch-off must hide a label already owned by this HUD. Never
     * create or search for one when this launch has never enabled it. */
    if (!gps_enabled() && !ever_enabled) return;
    /* The destination is shared; distance and arrow visibility belong to
     * the Player whose HUD has just updated. Some HUDs have no GPS part. */
    uint32_t pl = c->esi;
    unsigned seat = 0;
    while (pl && seat < SPLIT_PORT_CAPACITY && MR32(SPLIT_PLAYERS_INDEX + seat * 4u) != pl) ++seat;
    if (!pl || seat == SPLIT_PORT_CAPACITY) return;
    if (!guest_ok(pl, PLAYER_HUD + 3u)) return;
    uint32_t hud = guest_rd32(pl + PLAYER_HUD);
    if (!guest_ok(hud, HUD_GPS_PART + 3u)) return;
    uint32_t pkg = MR32(hud + 0x10u), part = MR32(hud + HUD_GPS_PART);
    if (!pkg || !part) return;
    /* Scratch is above the guest-call stack, never kept by a setter. */
    uint32_t scratch = (c->esp - 256u) & ~15u;
    static uint32_t hash;
    if (!hash){
        strcpy((char *)g_mem + scratch, "GPS_DISTANCE");
        hash = one(c, FN_FE_HASH, 0, scratch);
    }
    uint32_t args[2] = {pkg, hash};
    uint32_t obj = call(c, 0x537a10u, 0, 2, args);
#ifdef __wasm__
    int vr_web_gps_panel(void);
    if (vr_web_gps_panel()){ if (obj) one(c, FN_FE_HIDE, 0, obj); return; }
#endif
    float distance; int metric;
    if (!gpsdistance_read(c, pl, &distance, &metric)){
        if (obj) one(c, FN_FE_HIDE, 0, obj);
        return;
    }
    int made = !obj;
    if (!obj){
        strcpy((char *)g_mem + scratch, "ONLINE_PLAYER_1");
        args[1] = one(c, FN_FE_HASH, 0, scratch);
        uint32_t source = call(c, 0x537a10u, 0, 2, args);
        if (!source) return;
        /* Use the same ownership-checked clone path as multiplayer HUD labels.
         * GPS_SEARCH_Text belongs to the native error/search group and
         * Distance_Number to outrun; neither is an unused navigation label. */
        obj = roam_game_clone_hud_text(c, pkg, source, "GPS_DISTANCE");
        if (!obj) return;
        MR32(obj + 0x6cu) = (MR32(obj + 0x6cu) & ~0xfu) | 5u; /* centred */
        MR32(obj + 0x1cu) |= 0x100u;
        for (int i = 0; i < 4; ++i) MR32(scratch + 4u * i) = 255;
        uint32_t av[2] = {scratch, 0};
        call(c, 0x517e20u, obj, 2, av);
        MRF32(scratch) = 0.f; MRF32(scratch + 4u) = -55.f; MRF32(scratch + 8u) = 0.5f;
        call(c, 0x517c10u, obj, 2, av);
        MRF32(scratch) = MRF32(scratch + 4u) = 0.7f; MRF32(scratch + 8u) = 1.f;
        call(c, 0x517db0u, obj, 2, av);
    }
    char text[32];
    gpsdistance_format(text, sizeof text, distance, metric);
    /* FEString's setter only runs when the displayed distance changes. Its
     * UTF-16 buffer is owned by the object, so no stale host-side cache. */
    uint32_t str = MR32(obj + 0x64u);
    int same = str != 0;
    for (unsigned i = 0; same; ++i){
        if (MR16(str + i * 2u) != (unsigned char)text[i]) same = 0;
        if (!text[i]) break;
    }
    if (!same){
        strcpy((char *)g_mem + scratch, text);
        one(c, FN_FE_SETSTR, obj, scratch);
        MR32(obj + 0x1cu) |= 2u;
    }
    one(c, 0x50ca50u, 0, obj);
    if (made) fprintf(stderr, "[gps] distance under the arrow for player %u: %s\n", seat + 1, text);
}
