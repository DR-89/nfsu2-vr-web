#include "../../runtime/whine.c"
#include <assert.h>

uint8_t *g_mem;
uint8_t g_cbits[1u<<15];
static int probes;
int fileio_mod_pack(const char *rel,char *out,size_t n){(void)rel;(void)out;(void)n;probes++;return 0;}
int split_render_limit(void){return 1;}
static float mix_peak(unsigned frames){
    float *pcm=calloc(frames*2,sizeof(float));assert(pcm);whine_mix(pcm,frames,48000);
    float peak=0;for(unsigned i=0;i<frames*2;i++)if(fabsf(pcm[i])>peak)peak=fabsf(pcm[i]);
    free(pcm);return peak;
}
int main(void){
    unsetenv("NFSU2_GEARBOX_WHINE");whine_frame();assert(!probes && !g_started);
    whine_set_enabled(1);whine_frame();assert(probes==1 && g_ready==-1);
    whine_set_enabled(0);whine_set_enabled(1);whine_frame();assert(probes==1);
    /* Synthetic constant PCM isolates the extra mix from the game's engine. */
    static const uint8_t pcm[32]={0x40,0x1f,0x40,0x1f,0x40,0x1f,0x40,0x1f,0x40,0x1f,0x40,0x1f,0x40,0x1f,0x40,0x1f,
        0x40,0x1f,0x40,0x1f,0x40,0x1f,0x40,0x1f,0x40,0x1f,0x40,0x1f,0x40,0x1f,0x40,0x1f};
    for(int i=0;i<W_N;i++)g_wav[i]=(Wav){pcm,16,48000};g_ready=1;
    g_mem=calloc(1,0x1000000);assert(g_mem);
    for(unsigned p=0;p<0x1000000u>>14;p++)g_cbits[p>>3]|=1u<<(p&7);
    MR32(G_FLOW)=6;MRF32(G_WORLDDT)=1.f/60;
    MR32(SPLIT_PLAYERS_INDEX)=0x10000;MR32(0x10004)=0x20000;
    MR32(0x20000+CAR_GEAR)=2;MRF32(0x20000+CAR_SPEED)=20;
    MRF32(G_VOLUMES)=MRF32(G_VOLUMES+0x14)=1;
    whine_frame();assert(mix_peak(4800)>.001f);
    whine_set_enabled(0);whine_frame();mix_peak(96000);assert(mix_peak(4800)<1e-6f);
    whine_set_enabled(7);assert(!g_on && mix_peak(4800)<1e-6f);
    whine_set_enabled(1);whine_frame();assert(mix_peak(4800)>.001f && probes==1);
    assert(MR32(0x20000+CAR_GEAR)==2 && MRF32(0x20000+CAR_SPEED)==20);
    free(g_mem);puts("lazy whine loading, live fade, re-enable and invalid setting: OK");
}
