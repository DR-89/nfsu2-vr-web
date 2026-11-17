/* game.h -- the game's addresses and struct offsets that many runtime files
 * use (SPEED2.EXE): its globals, the functions the runtime calls, the car's
 * fields.  A file's own addresses stay in the file.
 *
 * Not part of cpu.h: the lifted shards do not use these, and cpu.h is in
 * every shard's hash (web/build.sh HDRSUM).  The hook sites (HOOK_SITE) and
 * the lifted functions' names (sub_XXXXXX) stay written out where they are
 * used: tools/genstamp.sh finds them there. */
#ifndef NFSU2_GAME_H
#define NFSU2_GAME_H

/* ---- the game's state ---------------------------------------------------- */
#define G_CAR_REGION 0x00864f24u  /* 0: NA car selection/AI table; 1: European */
#define G_FLOW          0x008654a4u   /* TheGameFlowManager's state: 3 the front end, 4/5 loading, 6 in the world */
#define G_GAMEMODE      0x00850078u   /* the front end's game mode: 1 career, 2 the main menu, 4 a split race, 8 Online, 0x200 LAN */
#define G_RACEPARAMS    0x0089e7a0u   /* the race's parameters, filled before a track loads: +0 the track, +0x10 its type
                                       * (G_RACETYPE), +0x20 local humans, +0x70 the racers' records, +0x74 their count */
#define G_RACETYPE      0x0089e7b0u   /* the race's type: 0 free roam, 7 an outrun */
#define G_GPS          0x00838590u   /* GPS navigation singleton */
#define G_GPS_TARGET   0x008385a0u   /* destination x/y in world metres */
#define G_GPS_ACTIVE   0x008385b9u   /* byte: navigation requested */
#define G_SPEED_UNITS  0x0083aa1au   /* byte: 1 metric, otherwise imperial */
#define FN_GPS_STATE   0x00501100u   /* GPS::GetState: 0/3 active, 1/2 no satellite/path, 4 off */
#define HUD_GPS_PART   0x5cu        /* HUD's navigation arrow part */
#define PLAYER_HUD     0x9a4u       /* Player's HUD pointer */
#define CAR_WORLD_POS  0x50u        /* Car's rendered position x/y/z, used by GPS distance */
#define G_DRIFTRACE     0x0089e7d9u   /* byte: a drift event (the race's parameters +0x39) */
#define G_RACE          0x00890118u   /* the race status: +0 its state (3 countdown, 4 racing, free roam too, 6 paused),
                                       * +0x14 its clock (1/4000 s), +0x24 the racers' count, +0x30 the racers (0x1F0 each:
                                       * +0 the car, +0x10 completion), +0xBD0 the racers' entries */
#define G_WORLD         0x00890080u   /* World*: +0/+4 its car list (a car's first two dwords are its node; the World is
                                       * the list's head and end), +0x10 the cars' count */
#define G_HOTPOS        0x00890140u   /* the hot-position jump (Player 0x600E10 -> Car 0x5FBD60), within the loaded map: where
                                       * (float[3]), */
#define G_HOTPOS_ANGLE  0x008900d0u   /* ...the heading (u16), */
#define G_HOTPOS_JUMP   0x008900cdu   /* ...1: jump there (the player's next update), */
#define G_HOTPOS_VALID  0x008900ceu   /* ...1: the place is set */
#define G_WORLDDT       0x00865154u   /* float: this frame's world step (s), 0 while the world stands */
#define G_WORLD_STEP    0x007fb724u   /* simulation frame, incremented by 0x57a100 and restored by replay snapshots */
#define G_REPLAY        0x008650b8u   /* original in-memory recorder */
#define REPLAY_PLAYING  0x00u
#define REPLAY_RECORDING 0x04u
#define REPLAY_ERROR    0x08u
#define REPLAY_FIRST    0x78u
#define REPLAY_STARTED  0x84u
#define REPLAY_STREAM   0x8cu
#define REPLAY_TICK_WRITE_RET 0x005ea396u /* World::Update channel 1, eight bits in the original stream */
#define REPLAY_TICK_READ_RET  0x005ea37bu
#define G_REPLAY_UI     0x008363ecu   /* ReplayControl*, registered by 0x4c0aa0, cleared by 0x4a4b70 */
#define REPLAY_UI_VT    0x0079055cu
#define REPLAY_UI_HIDDEN 0x74u
#define REPLAY_UI_LEAVING 0xd2u
#define PLAYER_REPLAY_VIEW 0x21cu
#define G_REPLAY_VIEWS  0x00802130u   /* automatic, far, close, bumper, hood, drift */
#define FN_REPLAY_CAMERA 0x005fa820u  /* Player::SetupDriveCamera(reset) */
#define FN_REPLAY_TIMELINE 0x004a5200u /* ReplayControl::ToggleTimeline() */
#define MOVER_SET_MODE  0x20u        /* virtual slots of the retail drive camera */
#define MOVER_GET_MODE  0x2cu
#define DRIVE_MOVER_VT  0x00787f28u   /* DriveCameraMover, virtual GetMode 0x44de80 / SetMode 0x445b10 */
#define G_WORLDTIMER    0x0086518cu   /* WorldTimer: the race clock, 1/4000 s, a new value each world step */
#define G_REALTIMER     0x008651acu   /* RealTimer: the game's clock, 1/4000 s */
#define G_RACESTATUS    0x008900d8u   /* the race status's event machine (FN_POSTEVENT's this): event 10, SwitchTrack, runs
                                       * free roam's setup (0x540780) again and the flow step (0x581820) loads its track */
#define G_TRACKINFO     0x00883dacu   /* the loaded track's TrackInfo (0x128 bytes: +0 its name, +0x40 its region, L4RA ...) */
#define G_VIEW1         0x00832e50u   /* eView 1 (player 1's): +0x40 its camera (+0x40 position, +0x50 forward) */
#define G_VIEW3         0x00832f30u   /* eView 3: player 1's rear camera, eViews have stride 0x70 */
#define EVIEW_MOVERS    0x44u        /* intrusive camera mover list; node is mover + 4 */
#define EVIEW_ACTIVE    0x08u        /* byte, set by per-frame view layout */
#define EVIEW_TARGET    0x58u        /* render target descriptor (enabled, width, height at +16) */
#define TARGET_ACTIVE   0x10u
#define G_REAR_TEXTURE  0x008708a4u   /* rear-view D3D texture object, created by 0x5ba1a0 */
#define G_REAR_DEPTH    0x008708acu   /* rear-view depth surface object */
#define G_REAR_RIM      0x008707e8u   /* TextureInfo*: flat mirror frame, drawn at 0x5caf72 */
#define G_REAR_MASK     0x008707ecu   /* TextureInfo*: rounded mirror mask, drawn at 0x5cafaa */
#define G_LIGHT_STREAKS 0x00870ce0u   /* g_LightStreaksEnable: 0x5caad0 chooses accumulated or current-frame lights */
#define FN_SKY_DRAW     0x0060f880u   /* queues the current time-of-day sky for an eView */
#define FN_RENDER_FLUSH 0x005cf420u   /* drains the game's queued material draws */
#define REAR_WORLD_RET  0x005cae6du   /* rear-world pass, after its target was selected */
#define COM_DEPTH_ID    52u          /* explicit depth/stencil surface renderer ID */
#define CAM_NEAR        0xbcu
#define CAM_FAR         0xc0u
#define PLAYER_MAIN_VIEW 0x18u
#define PLAYER_REAR_VIEW 0x1cu
#define PLAYER_MAIN_MOVER 0x238u
#define PLAYER_REAR_MOVER 0x244u
#define MOVER_KIND      0x0cu
#define MOVER_VIEW_ID   0x10u
#define MOVER_VIEW      0x18u
#define MOVER_CAMERA    0x1cu
#define MOVER_CAR       0x2cu
#define REAR_MOVER_VT   0x00787d98u   /* RearViewCameraMover, constructed by 0x44ba10 */
#define FN_PLAYER_REAR 0x005f1e10u   /* Player::SetRearView(this, enabled); replaces/deletes the current rear mover */
#define EVIEW_ID        0x04u        /* eView's id: 1 is the main player view */
#define EVIEW_LOD_SCALE 0x0cu        /* 256 / tan(Camera FOV / 2), copied to world view +0x80 */
#define WORLD_VIEW_COUNT 0x6c0u     /* 0x5b9c20's world visibility contexts, at most 12 */
#define WORLD_VIEW_STRIDE 0x90u
#define WORLD_VIEW_OWNER 0x40u
#define WORLD_VIEW_FLAGS 0x44u      /* 0x1000 low reflection LOD; derived 0x40 and rear-only 0x20 omissions */
#define EVIEW_CAMERA    0x40u        /* eView's Camera pointer */
#define CAM_EYE         0x40u        /* Camera world position, float[3], following the view matrix */
#define CAM_FORWARD     0x50u        /* Camera forward direction, float[3] */
#define CAM_LOOK_TARGET 0x60u        /* Camera look-at point in world space */
#define CAM_FOV         0xc4u        /* Camera vertical field of view, u16 binary angle */
#define CAM_VIEW_BYTES  0xc8u        /* Camera state through its FOV, saved/restored during view setup */
#define CAM_EXCLUDED_CAR 0x280u      /* Car skipped by eView's vehicle pass (0x631782) */
#define VR_BODY_BOUNDS_RET 0x006212cbu /* own-body point-in-box check after the camera's +0.5 m test */
#define CAR_RENDER_INFO 0x554u      /* CarRenderInfo*, its first word points back to Car */
#define CAR_RENDER_LO   0x10u       /* CarRenderInfo's car-space bounding box */
#define CAR_RENDER_HI   0x20u
#define CAR_WINDOW_REPLACEMENTS 0x708u /* seven 16-byte source/replacement/TextureInfo entries, 0x638190 */
#define TI_SELF         0x6cu        /* TextureInfo's self pointer */
#define TI_D3D_TEXTURE  0x18u        /* TextureInfoPlat's D3D texture object */
#define COM_TEXTURE_ID  28u          /* COM texture object's renderer ID */
#define EVIEW_PROJ      0x40u        /* eViewPlat projection matrix, after its view matrix */
#define EVIEW_MATRICES  0xc0u        /* eViewPlat's three 4x4 matrices */

/* ---- the career ---------------------------------------------------------- */
#define G_CAREER        0x0085ad40u   /* the career: +0x8730 the career race being run (G_CAREER_RACE) */
#define C_SPOT_SET      0x8744u       /* Career: byte, the kept spot below is where free roam's setup (0x540780) puts the car */
#define C_SPOT          0x8750u       /* Career: float[3], the kept spot: leaving free roam keeps the car's place there (0x513B30,
                                       * an outrun's end 0x513950), the profile saves it (0x514530) */
#define C_SPOT_HEADING  0x8760u       /* Career: u16, its heading */
#define G_START_KEEP    (G_CAREER + C_SPOT_SET)       /* 0x863484: the same fields, as the world's load reads them */
#define G_START_POS     (G_CAREER + C_SPOT)           /* 0x863490 */
#define G_START_HEAD    (G_CAREER + C_SPOT_HEADING)   /* 0x8634A0 */
#define G_CAREER_RACE   0x00863470u   /* the career race being run, 0 free roam */
#define G_CAREER_CAR    0x00863480u   /* the career car's handle (CAREER_SLOT_n) */
#define G_RACES         0x008383e0u   /* the career's race table: [G_NRACES] races of 0x88 bytes */
#define G_NRACES        0x008383e4u

/* ---- network races ------------------------------------------------------- */
#define G_NET_HOST      0x00866a14u   /* the host's race state, > 0: this game created the network race */
#define G_NET_CLIENT    0x008669f4u   /* the client's race state, > 0 in a network race */
#define G_NET_ONLINE    0x0089cf69u   /* byte: an online session */
#define G_NETPLAYERS    0x0089cf50u   /* the network race's players by car slot: 6 pointers, each +0x12 its LAN name */
#define G_ONLINE_PROFILE 0x00850080u /* original LAN/Online settings; login stage +0x50, persona +0x6c */
#define ONLINE_PERSONA  0x6cu       /* 0x5031f0: Online persona */
#define LAN_PERSONA     0xa8u       /* 0x5031f0: distinct LAN persona, not the Online login */
#define G_LOBBY_MANAGER 0x0086a388u /* 0x58a0e0: protocol +0x44, connected byte +0x48, pending request +0x4c */
#define G_LOBBY_GAMES   0x0086a858u /* display list +8, callback/context +0xc/+0x10, current GameRecord +0x1c */
#define CB_PC_LOBBY     0x004d17f0u /* PC_OL_Lobby callback */
#define CB_PC_GAME_ROOM 0x004d2760u /* PC_OL_GameRoom callback */
#define FN_RB_SEARCH    0x005904c0u /* this games (search settings, performance, callback, context) */
#define CB_RB_SEARCH    0x0049ec60u /* original PC lobby search reply */
#define FN_RB_JOIN      0x0058d6b0u /* this games (name, password, callback, context) */
#define CB_RB_JOIN      0x0049eb10u /* original PC lobby join reply */
#define FN_RB_READY     0x0058ad20u /* this games (ready) */
#define FN_RB_START     0x004bb6e0u /* this GameRoom: original Start Race */
#define FN_RB_LEAVE     0x004bb930u /* this GameRoom: original Leave Game */
#define FN_RB_STAGE     0x005031b0u /* this Online profile (stage) */
#define FN_RB_SWITCH    0x00537980u /* cdecl (from package, to package, 0) */
#define G_RB_ROOM_NAME  0x007f44b4u /* pointer to PC_OL_GameRoom.fng */
#define G_RB_DIALOG     0x00838974u /* active original FE dialog handle, zero when closed */
#define MSG_RB_QUIT_YES 0x30ed2368u /* original pause-menu QuitYes */
#define MSG_RB_EXPLORE 0x451e768eu /* original career-crib Explore */
#define FN_RB_SEND      0x0055dda0u /* cdecl (message, package name): original FE message dispatch */
#define FN_RB_LOGIN     0x004effd0u /* cdecl (package): owned by online.c */
#define FN_RB_DISCONNECT 0x004a0140u /* cdecl (package or zero): original Online/LAN logoff */
#define FN_RB_RESUME    0x00495a30u /* cdecl (1): original Resume Career */
#define FN_RB_RESET_PARAMS 0x005ed5f0u /* this race parameters: front-end defaults */
#define S_RB_MAIN       0x0078f530u /* UI_Main.fng */
#define S_RB_OLMAIN     0x0078f240u /* UI_OLMAIN.fng */
#define S_RB_LOBBY      0x0078f320u /* PC_OL_Lobby.fng */
#define G_QR_CAR_CATEGORY 0x0083aac0u /* quick race car category, 4 Career */
#define G_PROFILE_SNAPSHOT 0x00851148u /* crib's original profile snapshot */
#define G_PROFILE_AUTOSAVE 0x00844ad8u /* original autosave option */
#define G_TRACK_CATALOG 0x00883da0u /* TrackInfo pointer/count pair, records of 0x128 bytes (0x5d3e80) */
#define G_TEXT_BYTE_MODE 0x00838530u /* original 0x50d3c0: bypass the multibyte character table */
#define G_LANGUAGE_TABLE 0x008383d0u /* count, string pool, sorted {hash, pointer} table, character conversion table */

/* ---- the front end ------------------------------------------------------- */
#define G_FENG          0x008384c4u   /* cFEng: +8 the package manager (+0xE4 the top package, +0xC its name) */
#define G_FEMGR         0x008637b4u   /* the FE manager's screens: n = [it]; until n == it: screen [n - 4 + 0x14], n = [n] */
#define G_DLG           0x00838974u   /* the dialog up now, 0 none */
#define G_TXT_ON        0x0083a9c0u   /* byte: the game's text entry (0x83A7B0) takes the typing ... */
#define G_TXT_REC       0x0083a9c4u   /* ... for this record (0: none) */
#define G_PROFILE_NAME  0x0083a9e0u   /* player 1's profile (FEDatabase +0x10): +0 its name (32 bytes), +0x20 1: one is loaded */
#define G_VOLUMES       0x0083aa28u   /* the Audio options' volumes (floats 0 .. 1): +0 Master, +0x10 Sound Effects, +0x14 Engine */
#define G_PSETTINGS     0x0083aa64u   /* PlayerSettings of players 1 and 2, PS_SIZE each (in profiles): +PS_VIEW the camera view */
#define PS_SIZE         0x28u
#define PS_VIEW         0x10u         /* 0 .. 3 the camera key's views, 4 the drift camera (cameras.c) */
#define G_QR_CAR        0x0083aab8u   /* each player's car handle in Quick Race, LAN, Online (+4 player 2) */
#define G_FE_RIDE       0x008392c0u   /* the front end's ride of the car: +0 car type, +0x590 + 4 x slot its parts */
#define G_FECARS_SZ     0xab4cu       /* a player's front-end cars: player 2's G_FECARS + this (garage.c CARS_SZ) */
#define G_FECARS        0x0083ad90u   /* player 1's front-end cars (FEDatabase +0x3C0): +0x9BD8 0x5B record pointers,
                                       * a record's +8 its handle */

/* ---- cars ---------------------------------------------------------------- */
#define G_CARTYPES      0x008a1cccu   /* CarTypeInfo[] (0x890 bytes each): +0 the name, +0x20 the name its textures go by,
                                       * +0xC0 the make, +0xD0 the name's hash */
#define CARTYPE_SIZE    0x890u        /* a CarTypeInfo's size */
#define CARTYPE_TEXNAME 0x20u         /* ... the name its textures go by ("350Z": CARS/350Z/, 350Z_<texture>) */
#define G_CARPARTDB     0x008a2b68u   /* the car part database */

/* ---- textures ------------------------------------------------------------ */
/* a TextureInfo: +0 its platform record (+0x18 the port's D3D texture object, com.c: +28 its GPU texture id) */
#define TI_PLAT         0x00u
#define TI_HASH         0x24u         /* its name's hash (bStringHash) */
#define TI_WIDTH        0x44u         /* u16 */
#define TI_HEIGHT       0x46u         /* u16 */
#define PLAT_D3DTEX     0x18u
#define D3DTEX_ID       28u
/* a car (the World's list, [player + 4]) */
#define CAR_FWD_SPEED   0x42cu        /* float: its speed, m/s forward */
#define CAR_SPEED       0x430u        /* float: its speed, m/s, as the engine sound takes it */
#define CAR_GEAR        0x434u        /* its gear: 0 reverse, 1 neutral, 2 first .. */
#define CAR_THROTTLE    0x438u        /* processed accelerator, after driver direction handling */
#define CAR_RPM         0x440u        /* float: its engine's rpm */
#define CAR_SPEC        0x20u
#define SPEC_GEARS      0x1c8u        /* installed forward gear count, 0x408024/0x408027 */
#define SPEC_IDLE_RPM   0x1f0u        /* engine idle clamp at 0x598bb3 */
#define SPEC_LIMIT_RPM  0x1f8u        /* engine sound divides car RPM by it at 0x5f6716 */
#define CAR_TYPEINFO    0x0cu         /* CarTypeInfo pointer */
#define CAR_INPUT       0x30u         /* controller pointer */
#define CAR_BODY_ORIGIN 0x50u         /* rendered body position, distinct from physics centre */
#define CAR_FLU         0x90u         /* forward, left, up: three padded float3 rows */
#define INPUT_STEER     0x1e0u        /* signed 16-bit steering */
#define INPUT_GEAR_REQUEST 0x1e4u     /* 0x407fc0/0x4080b0 submit R=0, N=1, first=2 */
#define INPUT_THROTTLE  0x20cu
#define INPUT_BRAKE     0x214u
#define DRIVER_CAR          0x2a8u   /* HumanDriver, tick 0x41e2c0 */
#define HUMAN_DRIVER_VT     0x00784fc8u /* constructor 0x425fc0; grid lock +0x1c, first gear +0x30 */
#define DRIVER_SOURCE       0x2acu   /* -1: no input source */
#define DRIVER_GRID_LOCK    0x2b4u   /* byte: countdown locks the human driver */
#define DRIVER_NO_INPUT     0x2b8u
#define DRIVER_TRANSMISSION 0x2c0u   /* 1/3/4 manual; 0/2 automatic */
#define DRIVER_RAW_GAS      0x2d4u
#define DRIVER_RAW_BRAKE    0x2dcu
#define DRIVER_AUTO_REVERSE 0x2f0u   /* brake-to-reverse latch in 0x407a30 */

/* PC music player: constructor 0x459b80; system links it at 0x4865c0. */
#define MUSIC_SYSTEM_PLAYER 0xa0u
#define MUSIC_SYSTEM_SETTINGS 0x38u
#define MUSIC_PLAYER_VT     0x00789db4u
#define MUSIC_PLAYER_BYTES  0xd4u
#define MUSIC_CURRENT      0x14u
#define MUSIC_PREVIOUS     0x18u
#define MUSIC_MENU_MASK    0x84u
#define MUSIC_RACE_MASK    0x8cu
#define MUSIC_GAME_PAUSED  0xa6u
#define MUSIC_MODE         0xc0u
#define G_SOUND_SETTINGS   0x0083aa28u
#define FN_MUSIC_PAUSE     0x00739030u /* cdecl (music group mask, paused) */
#define FN_MUSIC_START     0x004580e0u /* stdcall (music group mask, track index) */
#define FN_SOUND_SETTINGS  0x00469050u /* thiscall sound system (settings) */

/* ---- the game's functions the runtime calls ------------------------------ */
#define FN_NEW          0x00575620u   /* cdecl (size): operator new */
#define FN_POSTEVENT    0x00601020u   /* thiscall race status (event, arg): an event of G_RACESTATUS's */
#define FN_FE_HASH      0x00505450u   /* cdecl (name) -> an FE object name's hash */
#define FN_FE_PACKAGE   0x0052cef0u   /* cdecl (package name) -> FEPackage*, 0: not loaded */
#define FN_PKG_FIND     0x00517f80u   /* thiscall package (hash) -> its object, 0: none */
#define FN_FE_SETSTR    0x00535fe0u   /* thiscall string object (char*): its text */
#define FN_FE_HIDE      0x0050ca00u   /* cdecl (FE object, 0: none) */
#define FN_FE_SHOW      0x0050ca50u   /* cdecl (FE object, 0: none): shown again */
#define FN_ITEM         0x0051f670u   /* thiscall (icon, label, 0; ret 0xC): a menu item's constructor */
#define FN_RIDE_INIT    0x00610270u   /* thiscall ride (car type, 0 or 1, 0, 0) */
#define FN_RIDE_SKINS   0x0061c280u   /* thiscall ride (n): DUMMY_SKIN<n>, WHEEL, SPINNER */
#endif
