#ifndef NFSU2_VR_WEB_H
#define NFSU2_VR_WEB_H
#include <stdint.h>
#include <stdatomic.h>
#include "cpu.h"

#define VR_MAGIC 0x3152564eu
#define VR_VERSION 4u /* version 4 adds a live free-roam car limit */
#define GW_K_VR 1792u
typedef struct {
    uint32_t magic, version;
    _Atomic uint32_t seq;
    uint32_t active;           /* nonzero session id while tracked; survives pose gaps, changes on VR entry */
    double at_ms;
    float head_view[16];       /* inverse head pose, WebXR coordinates */
    float fov_y;               /* conservative symmetric culling FOV, radians */
    uint32_t command;          /* epoch << 8 | 0x80 enabled | (requested gear + 1); 0 releases */
    float rear_origin[3];      /* reflected optical eye in fitted cabin coordinates */
    uint32_t rear_car;         /* exact live owner from scene.mirrors.reserved */
    double rear_at_ms;         /* independent of the tracking heartbeat */
    _Atomic uint32_t replay_epoch; /* runtime-owned viewer lifetime; zero outside replay */
    uint32_t replay_owner, replay_cameras, replay_timeline; /* input-owned epoch and cumulative action counts */
    uint32_t settings_revision, settings_mask, headlights, gps, special_vinyls, gearbox_whine;
    uint32_t stance_revision, stance_enabled;
    char stance_models[4096];  /* v1 model defaults; NUL-terminated, validated as one command */
    uint32_t cars_revision;
    int32_t cars_limit;        /* -1 Auto, 0..64 manual; independent of tracking */
} VrMailbox;
typedef struct {
    uint32_t vip, peer_id;
    float steer;
    uint32_t gearbox;          /* local only: epoch << 8 | count | VR_GEAR_* */
    float transform[16];      /* car forward, left, up, rendered body origin */
    char model[16];
} VrCar;
#define VR_CARS 64
#define VR_MIRROR_VERTICES 192
typedef struct {
    uint32_t active,target,zid,reserved;
    float view[16],projection[16];
    uint32_t count[3],pad;
    float glass[3][VR_MIRROR_VERTICES][3]; /* car-relative right/up/back metres */
} VrMirrors;
typedef struct {
    uint32_t magic, active, reserved[2];
    float projection[16], head_view[16], view[16];
    VrCar cars[VR_CARS];       /* reserved[0]: count; reserved[1]: scene layout 8 */
    VrCar local;
    uint32_t local_valid, racing, peer_count, peers[8], pad;
    float speed, rpm, throttle, brake, gear, world_dt;
    double at_ms;
    float idle_rpm,limit_rpm,road_rumble,feedback_reserved;
    float gps_metres;          /* -1 when disabled, inactive or this HUD has no arrow */
    uint32_t gps_metric, replay_active, gps_reserved;
    VrMirrors mirrors;
    uint32_t stance_available;
    int32_t stance_values[5],stance_stock_front;
    uint32_t stance_reserved;
    VrCar secondary;           /* second local co-op car; its own endpoint id */
    uint32_t secondary_valid, secondary_reserved;
    struct { float view[16], projection[16]; } views[5]; /* extra local player cameras */
    uint32_t views_mask, views_reserved; /* bits in split_view_id seat order, refreshed every Present */
} VrFrame;
_Static_assert(sizeof(VrMailbox) == 4272, "VR mailbox layout");
_Static_assert(sizeof(VrCar) == 96 && sizeof(VrFrame) == 14416, "VR frame layout");
uint32_t roam_game_vr_cars(VrCar *out, uint32_t capacity);
uint32_t roam_game_vr_local(VrCar *primary, VrCar *secondary);
uint32_t racecars_vr_cars(VrCar *out, uint32_t capacity, uint32_t *peers, uint32_t *peer_count);
int vr_web_car(uint32_t car, VrCar *out);
void vr_web_driver(uint32_t driver);
uint32_t vr_web_driver_before(uint32_t driver);
void vr_web_driver_after(uint32_t driver,uint32_t before);
void vr_web_replay_record(uint32_t manager,uint32_t caller,uint32_t ticks);
uint32_t vr_web_replay_ticks(uint32_t manager,uint32_t caller,uint32_t ticks);
void vr_web_replay_end(uint32_t owner);
int vr_web_replay_cycle(CPU *c,uint32_t player);
int vr_web_replay_update(CPU *c,uint32_t player);
void vr_web_rumble(float low,float high);
void vr_web_stage(uint32_t car, uint32_t stage, uint32_t previous);
void vr_web_grid_apply(uint32_t driver);
enum { VR_GEAR_MANUAL=8, VR_GEAR_READY=16, VR_GEAR_GRID=32, VR_GEAR_COUNTDOWN=64, VR_GEAR_FIRST=128 };
uint32_t vr_web_gearbox(uint32_t car);
void vr_web_frame(CPU *c);
void vr_web_views(void);
void vr_web_world_lists(uint32_t world);
void vr_web_rear_world(CPU *c);
void vr_web_frame_end(void);
void vr_web_ui_begin(void);
void vr_web_ui_end(void);
int vr_web_ui_active(void);
int vr_web_gps_panel(void);
int vr_web_cycle(uint32_t settings, int direction, unsigned last);
int vr_web_own_body(uint32_t render, uint32_t view);
int vr_web_inside_body(uint32_t ret, uint32_t lo, uint32_t hi);
int vr_web_body_matrix(const float *x, const float *y, const float *w);
uint32_t vr_web_driver_matrix(uint32_t view,const float *x,const float *y,const float *w);
int vr_web_window_texture(uint32_t texture);
int vr_web_trace_body(void);
void vr_web_mirror_mesh(const float (*positions)[3],uint32_t count);
uint32_t vr_web_mirror_target(void);
int vr_web_mirror_mask(uint32_t texture);
/* Camera ownership: 0 unchanged, 1 fitted cockpit, 2 rear capture, 3 tracked stock view. */
int vr_web_camera(uint32_t view, uint32_t cam, uint8_t *keep);
int vr_web_skip_lens_rain(CPU *c, uint32_t view_id);
void vr_web_projection(uint32_t plat, int changed);
void vr_web_capture(uint32_t view, uint32_t plat, uint32_t cam, const uint8_t *keep, int changed);
void vr_web_present(void *out);
#endif
