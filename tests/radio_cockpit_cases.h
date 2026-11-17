#define CONTROL_PLAYER 0x440000u
TEST(folder_seek__freezes_both_channels_and_preserves_heard_time){
    page_listens();folder_song_plays_in_main_menu();pg.silent=1;
    uint32_t before=g_song.read[0],heard=g_page.song_ms;
    RadioCockpit *p=&g_page.cockpit;p->seek_track=g_song.seq;p->seek_frame=100;p->seek_seq=1;
    steps(2);
    expect(p->seek_ack==1 && g_song.seek==1,"mixer acknowledged seek");
    expect(g_song.read[0]==before && g_song.read[1]==before,"both readers freeze until ready");
    expect(g_page.song_ms==heard,"waiting is not heard time");
    g_page.reply.written=100+STEP_FRAMES*4;p->seek_ready=1;steps(1);
    expect(!g_song.seek && g_song.read[0]==100+STEP_FRAMES && g_song.read[1]==g_song.read[0],"stereo resumes at requested frame");
    game_pauses();p->seek_frame=400;p->seek_seq=2;steps(1);
    g_page.reply.written=400+STEP_FRAMES*4;p->seek_ready=2;steps(1);
    expect(g_music.paused && g_song.read[0]==400 && g_song.read[1]==400,"seek preserves music pause");
    p->seek_track=g_song.seq-1;p->seek_seq=3;steps(1);expect(p->seek_ack==2,"stale song cannot seek");
    p->seek_track=g_song.seq;p->seek_frame=g_page.reply.total;steps(1);expect(p->seek_ack==2,"out-of-range seek rejected");
}
void dispatch_indirect(CPU *c, uint32_t addr){
    expect(g.noyield > 0, "music control guest call cannot yield");
    if (addr == FN_SOUND_SETTINGS) {
        expect(c->ecx == FLOW && MR32(c->esp + 4) == G_SOUND_SETTINGS, "retail music settings call");
    } else if (addr == FN_MUSIC_PAUSE) {
        int paused = MR32(c->esp + 8) != 0;
        for (unsigned i = 0; i < g_music.count; i++) MR32(g_music.reader[i] + READER_SPEED) = paused ? 0 : 0x10000;
    } else if (addr == FN_MUSIC_START) {
        int index = (int)MR32(c->esp + 8);
        sub_004580e0(c);
        g.last_index = index; g.restart = 0; g.pending = READERS_APPEAR_AFTER;
    } else expect(0, "unknown radio guest call");
}
static void cockpit_ready(void){
    in_race(); game_song_starts(3); steps(SETTLED);
    MR32(FLOW + MUSIC_SYSTEM_SETTINGS) = G_SOUND_SETTINGS;
    MR32(FLOW + MUSIC_SYSTEM_PLAYER) = CONTROL_PLAYER;
    MR32(CONTROL_PLAYER) = MUSIC_PLAYER_VT;
    MR32(CONTROL_PLAYER + MUSIC_MODE) = 6;
    MR32(CONTROL_PLAYER + MUSIC_CURRENT) = 3;
    MR32(CONTROL_PLAYER + MUSIC_RACE_MASK) = (1u << 1) | (1u << 3) | (1u << 7);
    g_page.cockpit.enabled = 1; g_page.cockpit.volume = 32768;
    steps(1);
}
static void cockpit_command(uint32_t action){
    RadioCockpit *r = &g_page.cockpit;
    r->commands[r->write++ & 7u] = action;
    steps(1);
}
TEST(cockpit__pause_resume_only_music_and_preserve_cpu){
    cockpit_ready();race_sounds_start();steps(1);
    CPU before = cpu;
    cockpit_command(RADIO_TOGGLE);
    expect(g_music.paused && (g_page.cockpit.state & 6u) == 6u, "owns the music pause");
    expect_race_sounds();
    expect(!ear[0].game_song && !ear[1].game_song,"music alone is paused");
    expect(!memcmp(&before, &cpu, sizeof cpu), "transport restores mixer CPU");
    expect(MRF32(GAME_MUSIC_VOLUME) == .5f, "native music level");
    cockpit_command(RADIO_TOGGLE);
    expect(!g_music.paused && !g_cockpit_radio.paused, "music resumes");
    g_page.cockpit.volume = 0; steps(1);
    expect(MRF32(GAME_MUSIC_VOLUME) > 0 && MRF32(GAME_MUSIC_VOLUME) < 1e-6f, "silent gain keeps transport alive");
}
TEST(cockpit__previous_next_use_enabled_retail_playlist){
    cockpit_ready();
    cockpit_command(RADIO_PREVIOUS); steps(SETTLED);
    expect(MR32(CONTROL_PLAYER + MUSIC_CURRENT) == 1, "previous skips disabled songs");
    cockpit_command(RADIO_PREVIOUS); steps(SETTLED);
    expect(MR32(CONTROL_PLAYER + MUSIC_CURRENT) == 7, "previous wraps");
    cockpit_command(RADIO_NEXT); steps(SETTLED);
    expect(MR32(CONTROL_PLAYER + MUSIC_CURRENT) == 1, "next wraps");
    expect(cockpit_music_next(0, 0, 1) == -1 && cockpit_music_next(-1, 8, 1) == 3, "empty and unknown playlists");
}
TEST(cockpit__frontend_pause_and_changed_voice_are_not_owned){
    cockpit_ready(); cockpit_command(RADIO_TOGGLE);
    g.paused=0;for(unsigned i=0;i<g_music.count;i++)MR32(g_music.reader[i]+READER_SPEED)=0x10000;
    steps(1);expect(g_music.paused,"retail resume does not cancel the player's radio pause");
    MR8(CONTROL_PLAYER + MUSIC_GAME_PAUSED) = 1;
    g_page.cockpit.enabled = 0; steps(1);
    expect(g_music.paused, "leaving cockpit cannot undo frontend pause");
    MR8(CONTROL_PLAYER + MUSIC_GAME_PAUSED) = 0; steps(1);
    expect(!g_music.paused, "release its pause when frontend allows");
    g_page.cockpit.enabled = 1; steps(1); cockpit_command(RADIO_TOGGLE);
    MR32(STREAM + STREAM_VOICE) += 256; MR32(VOICES + VOICE_SIZE) += 256;
    g_page.cockpit.enabled = 0; steps(1);
    expect(g_music.paused && !g_cockpit_radio.paused, "recycled voice is never resumed");
}
TEST(cockpit__busy_invalid_and_full_queue){
    cockpit_ready(); MR32(SOUND_API_BUSY) = 1;
    cockpit_command(RADIO_TOGGLE);
    expect(g_page.cockpit.read != g_page.cockpit.write && !g_music.paused, "busy music API retries");
    MR32(SOUND_API_BUSY) = 0; steps(1);
    expect(g_music.paused, "one queued toggle consumed");
    g_page.cockpit.write += 99; steps(1);
    expect(g_page.cockpit.read == g_page.cockpit.write && g_music.paused, "malformed queue discarded");
    MR32(CONTROL_PLAYER) = 0; cockpit_command(RADIO_TOGGLE);
    expect(!g_page.cockpit.state, "wrong player type rejected");
}
TEST(cockpit__late_metadata_listener_gets_the_current_race_song){
    cockpit_ready();
    game_song_has_tags(3);g_page.listen=2;steps(1);
    expect(song_text_is("Snoop Dogg", "Riders on the Storm", "Need for Speed Underground 2"), "late cockpit listener reads current track");
}
TEST(cockpit__music_samples_exclude_other_readers_and_reject_bad_ranges){
    cockpit_ready();
    for (unsigned i = 0; i < 256; i++) MRF32(OUT + i * 4u) = i & 1 ? 16384.f : -16384.f;
    cockpit_radio_samples(&g_page, g_music.reader[0], OUT, 256, 256);
    expect(g_page.cockpit.pcm[511] == .5f && g_page.cockpit.pcm[510] == -.5f, "real music samples normalized");
    uint32_t seq = g_page.cockpit.pcm_seq;
    cockpit_radio_samples(&g_page, 1, OUT, 256, 256);
    cockpit_radio_samples(&g_page, g_music.reader[0], 0xfffffff0u, 256, 256);
    expect(g_page.cockpit.pcm_seq == seq, "non-music and invalid samples ignored");
    g_music.paused = 1;
    cockpit_radio_samples(&g_page, g_music.reader[0], OUT, 256, 256);
    expect(g_page.cockpit.pcm[511] == 0, "paused music is silent");
}
