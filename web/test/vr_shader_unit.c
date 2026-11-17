#include "vsemu.h"
#include <assert.h>
#include <stdio.h>
int main(void){
    /* PS 1.1 tex t1; PS 1.4 texld r3,t0; PS 2.0 texld r0,t0,s2.
     * Coordinates and stale bindings do not identify the sampled texture. */
    const uint32_t shader[][6] = {
        {0xffff0101,0x42,0xb00f0001,0xffff},
        {0xffff0104,0x42,0x800f0003,0xb0e40000,0xffff},
        {0xffff0200,0x03000042,0x800f0000,0xb0e40000,0xa0e40802,0xffff},
        {0xfffe0101,0x1,0xc00f0000,0x90e40000,0xffff},
    };
    const unsigned masks[] = {2,8,4,0};
    for (int i = 0; i < 4; i++) {
        VSProg *p = vs_compile(shader[i],6); assert(p);
        assert(ps_texture_stages(p) == masks[i]); vs_free(p);
    }
    assert(!ps_texture_stages(NULL)); puts("sampled shader stages: OK"); return 0;
}
