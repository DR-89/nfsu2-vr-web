/* Generated from the authored cabin fits by tools/pack_vr_assets.py. */
#ifndef VR_SEATS_H
#define VR_SEATS_H
#include <string.h>
static const struct { const char *name; float seat[3]; } vr_seats[] = {
    {"DEFAULT", {-0.1f, 0.35f, 0.95f}},
    {"240SX", {0.02871f, 0.387445f, 0.783809f}},
    {"3000GT", {-0.150781f, 0.394046f, 0.862829f}},
    {"350Z", {-0.243177f, 0.435649f, 0.897662f}},
    {"A3", {-0.065582f, -0.431989f, 0.975869f}},
    {"CELICA", {-0.1161f, 0.447042f, 0.869052f}},
    {"CIVIC", {0.026244f, 0.386362f, 0.890257f}},
    {"COROLLA", {0.069241f, 0.393654f, 1.060295f}},
    {"ECLIPSE", {-0.066512f, 0.447042f, 0.858775f}},
    {"ESCALADE", {0.311899f, 0.459092f, 1.123207f}},
    {"FOCUS", {-0.123566f, 0.426007f, 0.971427f}},
    {"G35", {0.028441f, 0.435649f, 0.961768f}},
    {"GOLF", {-0.101768f, 0.426007f, 0.917057f}},
    {"GTO", {0.093413f, 0.449788f, 0.964516f}},
    {"HUMMER", {0.194274f, 0.475757f, 1.143913f}},
    {"IMPREZAWRX", {0.07193f, 0.428578f, 0.926136f}},
    {"IS300", {0.211067f, 0.442142f, 0.899061f}},
    {"LANCEREVO8", {0.1051f, 0.377847f, 0.839308f}},
    {"MIATA", {-0.306802f, 0.392122f, 0.811262f}},
    {"MUSTANGGT", {-0.125446f, 0.44941f, 0.969603f}},
    {"NAVIGATOR", {0.313362f, 0.461932f, 1.404233f}},
    {"PEUGOT", {-0.1f, 0.35f, 0.95f}},
    {"RSX", {-0.053459f, 0.396328f, 0.917057f}},
    {"RX7", {-0.275228f, 0.377847f, 0.803363f}},
    {"RX8", {-0.021926f, 0.426007f, 0.917057f}},
    {"SENTRA", {0.108678f, 0.472644f, 0.931158f}},
    {"SKYLINE", {0.034015f, -0.424885f, 0.908227f}},
    {"SUPRA", {-0.176109f, 0.501648f, 0.869052f}},
    {"TIBURON", {-0.106063f, 0.383905f, 0.895097f}},
    {"TT", {-0.233893f, 0.429573f, 0.865928f}},
};
static inline const float *vr_seat(const char *name){
    for (unsigned i = 0; i < sizeof vr_seats / sizeof *vr_seats; i++) if (!strcmp(name, vr_seats[i].name)) return vr_seats[i].seat;
    return vr_seats[0].seat;
}
#endif
