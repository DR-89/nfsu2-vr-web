#ifndef NFSU2_FRAMERATE_RATE_H
#define NFSU2_FRAMERATE_RATE_H

/* These headset rates divide the 3600 Hz tick base exactly. Desktop auto
 * keeps its existing rates; a fixed player-selected limit bypasses this. */
static inline int hfr_auto_rate(int hz, int immersive){
    if (immersive && (hz == 72 || hz == 80 || hz == 90)) return hz;
    if (hz >= 239) return 240;
    if (hz >= 119) return 120;
    if (hz > 0 && hz <= 31) return 30;
    return 60;
}
#endif
