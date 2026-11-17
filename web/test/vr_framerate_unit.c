#include "cpu.h"
#include <assert.h>
#include <stdlib.h>
#include <time.h>
/* Use the web rate policy with native test memory, without linking the game. */
#define __wasm__ 1
#define CLOCK_UPTIME_RAW CLOCK_MONOTONIC
uint64_t clock_gettime_nsec_np(clockid_t id);
#include "framerate.c"

uint8_t *g_mem;
static int hz=90, immersive=0;
int metal_display_hz(void){return hz;}
int metal_display_immersive(void){return immersive;}

int main(void){
    g_mem=calloc(1,0x900000);assert(g_mem);
    MRF32(A_CAP_DEF)=MRF32(A_CAP)=1.f/120.f;
    g_fix_hi=FX_ALL;g_fix_lo=0;
    setenv("NFSU2_FPS","auto",1);parse_mode();
    assert(mode_rate()==60);
    immersive=1;
    for(int r=0;r<3;r++){
        hz=(int[]){72,80,90}[r];
        assert(mode_rate()==hz && content_rate()==hz);
        assert(TICK_HZ%hz==0 && fix_for_rate(mode_rate())==FX_ALL);
        MRF32(A_CAP)=1.f/30.f;assert(content_rate()==30);
        MRF32(A_CAP)=MRF32(A_CAP_DEF);
    }
    setenv("NFSU2_FPS","60",1);parse_mode();assert(content_rate()==60);
    setenv("NFSU2_FPS","30",1);parse_mode();assert(content_rate()==30);
    setenv("NFSU2_FPS","auto",1);parse_mode();assert(content_rate()==90);
    immersive=0;assert(content_rate()==60);
    hz=144;assert(content_rate()==120);hz=240;assert(content_rate()==240);
    hz=30;assert(content_rate()==30);
    free(g_mem);puts("VR cadence, fixed limits, cutscenes and desktop return: OK");
}
