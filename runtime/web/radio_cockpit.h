/* Included by radio.c: its mixer owns transport, checked live readers and samples.
 * No music pointers supplied by the page are followed. Guest calls preserve the
 * mixer CPU and cannot yield inside the sound event system (same as song stop). */
static struct {
    uint32_t player, owner, handle, voice, volume, pending;
    int paused, enabled;
    float pcm[RADIO_PCM];
    unsigned frames;
} g_cockpit_radio;

static uint32_t cockpit_music_player(void){
    uint32_t system = MR32(GAME_FLOW);
    if (!in_guest(system, MUSIC_SYSTEM_PLAYER + 4u) || MR32(system + MUSIC_SYSTEM_SETTINGS) != G_SOUND_SETTINGS) return 0;
    uint32_t player = MR32(system + MUSIC_SYSTEM_PLAYER);
    return in_guest(player, MUSIC_PLAYER_BYTES) && MR32(player) == MUSIC_PLAYER_VT ? player : 0;
}
static void cockpit_music_call(CPU *c, uint32_t fn, uint32_t self, int n, const uint32_t *args){
    guest_noyield(+1);
    gcall(c, fn, self, n, args);
    guest_noyield(-1);
}
static void cockpit_music_pause(CPU *c, int pause){
    cockpit_music_call(c, FN_MUSIC_PAUSE, 0, 2, (uint32_t[]){MR32(g_music.owner + OWNER_SONG_GROUPS), (uint32_t)pause});
    follow_music_inputs(host_status_radio());
}
static int cockpit_music_next(int current, uint32_t mask, int direction){
    if (current < 0 || current >= RADIO_TRACKS) current = direction > 0 ? RADIO_TRACKS - 1 : 0;
    for (int i = 0; i < RADIO_TRACKS; i++) {
        current = (current + RADIO_TRACKS + direction) % RADIO_TRACKS;
        if (mask & (1u << current)) return current;
    }
    return -1;
}
static void cockpit_radio_step(CPU *c, HostStatusRadio *r){
    RadioCockpit *p = &r->cockpit;
    int requested = __atomic_load_n(&p->enabled, __ATOMIC_ACQUIRE) != 0;
    if (!requested && !g_cockpit_radio.enabled && !g_cockpit_radio.paused) return;
    follow_music_inputs(r);
    uint32_t player = cockpit_music_player();
    if (player != g_cockpit_radio.player) { g_cockpit_radio.pending = 0; g_cockpit_radio.frames = 0; }
    int same = player && player == g_cockpit_radio.player && g_music.count &&
        g_music.owner == g_cockpit_radio.owner && g_music.handle == g_cockpit_radio.handle && g_music.voice == g_cockpit_radio.voice;
    if (!same) g_cockpit_radio.paused = 0;
    int native_pause = player && (MR8(player + MUSIC_GAME_PAUSED) || MR32(player + MUSIC_MODE) == 5u);
    int active = requested && player && MR32(G_FLOW) == 6u;
    uint32_t write = __atomic_load_n(&p->write, __ATOMIC_ACQUIRE), read = p->read;
    int api = MR8(SOUND_API_ACTIVE) && !MR32(SOUND_API_BUSY) && !g_radio.stopping &&
        in_guest(g_music.owner, OWNER_SONG_GROUPS + 4u);
    if (!active) {
        g_cockpit_radio.pending = 0;
        __atomic_store_n(&p->read, write, __ATOMIC_RELEASE);
        if (same && g_cockpit_radio.paused && !native_pause && api) {
            cockpit_music_pause(c, 0);
            if (!g_music.paused) g_cockpit_radio.paused = 0;
        }
        g_cockpit_radio.enabled = 0;
        __atomic_store_n(&p->state, 0, __ATOMIC_RELEASE);
        return;
    }
    if (g_cockpit_radio.paused && !native_pause && !g_music.paused && api) cockpit_music_pause(c, 1);
    uint32_t kind = g_song.who == SONG_GAME ? RADIO_SONG_GAME : g_song.who == SONG_FOLDER ? RADIO_SONG_FOLDER : RADIO_SONG_NONE;
    if (listening(r) && g_music.count && !g_cockpit_radio.pending &&
        (!r->song_seq || g_heard.index != MR32(player + MUSIC_CURRENT) + 1u || g_heard.kind != kind))
        song_heard_start(r, kind, MR32(player + MUSIC_CURRENT));
    uint32_t volume = __atomic_load_n(&p->volume, __ATOMIC_ACQUIRE);
    if (api && volume <= 65536u && (!g_cockpit_radio.enabled || volume != g_cockpit_radio.volume)) {
        /* The same volume applied by retail's options. Positive silent gain
         * preserves stream lifetime at zero, while integer output is silent. */
        MRF32(GAME_MUSIC_VOLUME) = fmaxf((float)volume / 65536.f, 0x1p-24f);
        cockpit_music_call(c, FN_SOUND_SETTINGS, MR32(GAME_FLOW), 1, (uint32_t[]){G_SOUND_SETTINGS});
        g_cockpit_radio.volume = volume;
        g_cockpit_radio.enabled = 1;
    }
    if (write - read > RADIO_COMMANDS) read = write;
    /* Consume at most one action per mixer step; a busy retail API retries.
     * Frontend pauses discard commands instead of seeking when it closes. */
    if (native_pause || (!g_music.count && !g_cockpit_radio.pending)) read = write;
    else if (read != write && api && g_music.count && !g_cockpit_radio.pending) {
        uint32_t action = p->commands[read & (RADIO_COMMANDS - 1u)];
        read++;
        if (action == RADIO_TOGGLE) {
            if (g_cockpit_radio.paused) { cockpit_music_pause(c, 0); g_cockpit_radio.paused = g_music.paused; }
            else if (!g_music.paused) {
                cockpit_music_pause(c, 1);
                g_cockpit_radio.paused = g_music.paused;
            }
        } else if (action == RADIO_PREVIOUS || action == RADIO_NEXT) {
            int next = cockpit_music_next((int)MR32(player + MUSIC_CURRENT), MR32(player + MUSIC_RACE_MASK), action == RADIO_NEXT ? 1 : -1);
            if (next >= 0 && (!g_music.paused || g_cockpit_radio.paused)) {
                if (g_cockpit_radio.paused) cockpit_music_pause(c, 0);
                g_cockpit_radio.paused = 0;
                if (!g_music.paused) {
                    g_cockpit_radio.pending = (uint32_t)next + 1u;
                    g_radio.stop = "cockpit track selection";
                    stop_game_song(c);
                    g_cockpit_radio.frames = 0;
                }
            }
        }
    }
    __atomic_store_n(&p->read, read, __ATOMIC_RELEASE);
    g_cockpit_radio.player = player;
    g_cockpit_radio.owner = g_music.owner; g_cockpit_radio.handle = g_music.handle; g_cockpit_radio.voice = g_music.voice;
    __atomic_store_n(&p->state, (g_music.count ? 1u : 0u) | (g_music.paused ? 2u : 0u) | (g_cockpit_radio.paused ? 4u : 0u), __ATOMIC_RELEASE);
}
/* The original player opens the next stream after its stop event has been
 * polled. Supply our selection at that normal start, preserving the retail
 * owner activation and plaque; starting early races its automatic playlist. */
static void cockpit_radio_select(CPU *c){
    uint32_t pending = g_cockpit_radio.pending;
    if (!pending) return;
    g_cockpit_radio.pending = 0;
    uint32_t player = cockpit_music_player();
    if (pending > RADIO_TRACKS || player != g_cockpit_radio.player || !player || MR32(G_FLOW) != 6u) return;
    MR32(c->esp + TRAX_START_INDEX) = (MR32(c->esp + TRAX_START_INDEX) & 0xffff0000u) | (pending - 1u);
    MR32(player + MUSIC_CURRENT) = pending - 1u;
}
static void cockpit_radio_samples(HostStatusRadio *r, uint32_t reader, uint32_t out, uint32_t n, uint32_t got){
    if (!__atomic_load_n(&r->cockpit.enabled, __ATOMIC_ACQUIRE) || !g_music.count || reader != g_music.reader[0] ||
        n > MIXER_MAX_FRAMES || !in_guest(out, n * 4u)) return;
    unsigned take = (int32_t)got < 0 ? 0 : got < n ? got : n;
    if (take > RADIO_PCM) { out += (take - RADIO_PCM) * 4u; take = RADIO_PCM; }
    if (!take) return;
    unsigned keep = g_cockpit_radio.frames;
    if (keep + take > RADIO_PCM) keep = RADIO_PCM - take;
    memmove(g_cockpit_radio.pcm, g_cockpit_radio.pcm + g_cockpit_radio.frames - keep, keep * sizeof(float));
    for (unsigned i = 0; i < take; i++) {
        float sample = MRF32(out + i * 4u) / PIPELINE_SCALE;
        g_cockpit_radio.pcm[keep + i] = !g_music.paused && isfinite(sample) ? fmaxf(-1.f, fminf(1.f, sample)) : 0.f;
    }
    g_cockpit_radio.frames = keep + take;
    RadioCockpit *p = &r->cockpit;
    uint32_t seq = p->pcm_seq + 1u;
    __atomic_store_n(&p->pcm_seq, seq, __ATOMIC_RELAXED); __atomic_thread_fence(__ATOMIC_RELEASE);
    p->pcm_rate = MR16(MIXER_RATE); p->pcm_frames = g_cockpit_radio.frames;
    memcpy(p->pcm, g_cockpit_radio.pcm, g_cockpit_radio.frames * sizeof(float));
    __atomic_store_n(&p->pcm_seq, seq + 1u, __ATOMIC_RELEASE);
}
