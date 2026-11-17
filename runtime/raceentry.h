/* Original PC Online-browser entry and optional return to the career. */
#ifndef NFSU2_RACEENTRY_H
#define NFSU2_RACEENTRY_H
#include "cpu.h"
enum { RE_CAN_ENTER=4,RE_ACTIVE=8,RE_CAREER=16,RE_BUSY=32,RE_CAN_EXIT=64,RE_FAILED=128 };
unsigned raceentry_flags(void);
unsigned raceentry_enter(CPU *,double now);
unsigned raceentry_exit(CPU *,double now);
void raceentry_frame(CPU *,double now);
int raceentry_owns_input(void);
#endif
