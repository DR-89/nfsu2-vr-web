#ifndef NFSU2_GPS_DISTANCE_H
#define NFSU2_GPS_DISTANCE_H
#include "cpu.h"
/* Enabled navigation for this player's visible GPS arrow. Outputs are valid
 * only on success; the guest CPU is preserved across GPS::GetState. */
int gpsdistance_read(CPU *c, uint32_t player, float *metres, int *metric);
#endif
