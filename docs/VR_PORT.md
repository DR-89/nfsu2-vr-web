# nfsu2-vr-web

Independent fork of th0mk/nfsu2-web, public revision
`9e0230212776f6c9a4d0db30c1963e9730138553`. Original upstream credits and
MIT notices remain in README.md and LICENSE. Game data is supplied separately.

## Target

Port the native cockpit mod to the PC browser runtime. PCVR and monitor players
use the same server and game session. Remote free-roam and LAN/Online race cars display their
occupants' cockpit, head and hands. CopChase work is deferred.

## Current implementation

- WebXR session lifecycle with headset capability detection, recentering,
  tracking-loss reset and return to the desktop session.
- Direct WebGPU projection layers where available, and a WebGL2 presentation
  bridge for browsers that expose WebXR without `XRGPUBinding`. Both use the
  WebGPU scene renderer; legacy projection depth is converted once at the XR boundary.
- Stereo replays share immutable pixel constants by draw-record offset as well
  as geometry. Skipped reflection/HUD draws do not shift the second eye's
  constants; frame identity is checked before reuse. Cockpit scene updates run
  once per stereo frame. The WebGL bridge keeps its texture storage at a fixed
  size and queries its texture limit only at creation. These reduce transfer
  and CPU work without changing the selected eye resolution.
- **Start in VR** prepares the headset's WebGL context before starting the game
  or acquiring its WebGPU device. `makeXRCompatible()` can switch GPUs on hybrid
  laptops and invalidate an existing device. The bridge reuses the prepared
  context, creates GL resources only after compatibility completes, and releases
  it if the session ends or startup fails.
- Before starting, **VR & media → Headset resolution** selects 50%, 75%, 100%,
  125%, 150% or 200% of the headset's recommended width and height per eye.
  The default is 100%. The choice is saved locally in `settings.ini` as
  `vr_render_scale` and applies on the next VR entry. Both output paths render
  the scene at the actual eye viewport size, bounded by the GPU's texture limit;
  the browser may cap the requested size. Game menus keep their original source
  image size. This device-specific setting is excluded from cloud profile sync.
- Head-pose mailbox into the WASM runtime. Head motion changes the main camera
  before the game's culling/projection setup. Per-frame camera matrices are
  recorded alongside the draw stream.
- Separate eye draw replays with the headset's asymmetric projections and eye
  positions. The compositor receives browser-owned textures within its XR frame.
- Accepted tracked world cameras use the retail current-frame light path instead
  of the mono light-streak history. This avoids head-motion ghosts while retaining
  light sources and surface illumination. The frame restores the user's streak
  option at Present or at the next frame; flat/photo views keep their setting.
- Visible local and remote interiors from the native mod's authored cockpit and
  glove meshes, with per-car fitting and anonymous helmet heads. Remote interiors
  share world depth, with glass drawn over them. Up to 16 nearby interiors within 45 m.
- The local cockpit retains the stock hood, pillars, roof and body. Its rigid shell
  is rendered from both sides, with semantic window filtering for a clear view.
  The authored cabin uses the native mod's separate final-pass depth. The same
  own-body treatment applies inside the cockpit's rear capture; other players'
  car materials remain unchanged.
- Race intro and countdown also stay in the local cockpit, with the original
  body visible. The temporary intro AI keeps its original driving behaviour.
- Original PC instruments, NOS and turbo dial on the fitted dashboard, with
  the original map on the native circular mount. Standings, lap count and times
  use the right window; other race messages use the windshield. PC frontend
  crops retain the full map rim and turbo dial. The map can be gripped, moved
  and tilted/turned ±45°; its position is also adjustable on the website.
  A blue rim signals contact. X/A over it opens the original world map, with
  grip priority and no simultaneous shift/nitrous action.
- Optional GPS strip beneath the map, with the native bitmap font, live PC
  destination distance and speedometer units. It follows the moved map and
  disappears for inactive/invalid navigation. Ordinary/photo views retain the
  existing GPS label; the cockpit uses the strip. Snapshot layout 4 preserves
  existing telemetry and haptics and accepts earlier scene layouts.
- Semantic FEng draw tagging (GPU protocol v8) keeps weather/post-processing in
  the scene. GPU and CPU frontend paths share a transparent 1280x960 HUD capture;
  both eyes sample it without applying an eye transform to the captured UI.
  Original RGB blending retains its coverage independently, with premultiplied
  panel compositing. The gauge covers baked trim before the rim/hands draw.
  Non-cockpit frontend layout restores its original widescreen anchoring.
- Three original mirror glass surfaces use reflected optical eyes and the rear
  capture's real depth. The retail rear camera draws world/traffic, sky and the
  player's shell; the fitted cabin writes matching depth into the same capture.
  A near plane behind the mirror assemblies prevents their backs from hiding
  the view. The mono capture is reused for both eyes of one guest frame, with
  depth reprojection for eye position and mirror angle; stale captures are hidden.
- Grip a mirror to adjust it with wrist rotation or a push at the grabbed edge.
  The native mechanical stops, 35 ms response and tracking rebase are retained;
  outside mirrors share opposing yaw. Changed angles save per vehicle model once
  on release or interruption, and return when switching back to that model.
  The website has a car selector, four angle sliders and reset for that car.
  Capture widths of 256, 512, 1024,
  2048 or 4096 pixels travel with the encrypted profile. The default is 1024;
  leaving the cockpit restores the original target size. Scene layout 5 adds
  bounded mirror geometry/matrices and keeps earlier layouts readable.
- Per-frame, interpolated car transforms and authenticated sender IPs are exported
  from actual visible roam slots and admitted race peers. Hidden, blocked, parked and departed cars
  do not acquire floating avatars. Client-supplied avatar car IDs are not used.
- Head/hand interpolation, missing-tracking removal, and neutral driver poses for
  monitor players. A profile setting can stop transmitting poses.
- Native open/grip/point glove geometry: free hands open, held wheel/lever/screen
  contacts grip, and hands near cockpit buttons point. Matching index pads press
  the screen buttons without a trigger; swept contact catches fast pokes and
  withdrawal rearms them. Bounded finger weights interpolate on remote drivers;
  missing tracking still removes the hand and older clients keep their grip.
- A start-page **VR & media** tab: interior visibility, pose sharing, world scale,
  seat height/forward offset, media volume, screen placement/opacity, LED colours,
  music pulse, shift cues and haptics. These live in
  settings.ini and use the existing encrypted cloud-save synchronization when
  the player has enabled it. Shared VR controls update the active session;
  opting into the cockpit at startup applies on the next launch. Media sliders
  also update the page player immediately.
- A local audio/video folder picker with remembered directory permission where
  supported, recursive playlists, previous/next and browser playback. Audio can
  feed the existing in-game radio. File handles and media bytes stay local; no
  media files are uploaded into the cloud profile.
- The Play click prepares local media audio before entering XR. Video playback
  does not wait on a suspended audio context; a refused play remains retryable
  and a menu cancellation preserves the file. A video-only folder clears the
  inapplicable music-only choice. The screen keeps its buttons and highlights
  without drawing a pointer circle. Fingertip and trigger presses share a hold,
  rearmed by withdrawal and trigger release; tracking loss cannot repeat it.
- The retail lens-drop composite is omitted only for an accepted cockpit
  camera. Its depthless full-screen drops would cover the cabin and hands.
  Outdoor rain and wet-road rendering remain active; exterior cameras keep
  their lens drops. This does not add a windshield droplet simulation.
- Fixed fingertip stereo controls below the movable screen: volume,
  previous/play-pause/next, scrolling title/artist and LED/page keys. Stock EA
  TRAX and folder audio use the original music stream; video uses its existing
  media element. The radio mailbox adds a bounded command queue and a checked,
  music-only PCM window for the visualizer and LED pulse. A retail pause is
  never resumed by a radio command; owned pauses track the player and voice.
  Track requests enter the original next-song path and obey its enabled list.
  Volume zero keeps transport running; releasing the slider saves the profile.
- Four seat buttons above the driver's armrest move the personal view forward/back/up/down
  by 1 cm, with native limits and cloud persistence. Seat and stereo touches
  share index-pad contact/rearming and yield to held controls while accelerator
  and brake remain independent. The active manual shifter uses its native
  pickup radius and optional gesture zone.
  The strip lies flat along the middle of the door handle's inner top on either
  drive side, clear of the door trim behind it.
  One row contains forward/back/up/down, shown only as
  seat/arrow icons. The 52 x 208 mm base strip uses 39 mm circles, 47 mm touch
  targets and inactive gaps. Drawing and fingertip contact
  use the same fitted armrest plane.
- Versioned avatar messages on the existing authenticated LAN socket. The earlier
  police protocol remains dormant: the app always joins with cops=false.
- Local driving cockpit with the native wheel pivot/steering animation and LED
  seams. LED colour changes directly beside the screen; music pulse, green
  shifter zone and red upshift/blue downshift cues follow real playback/tracking
  and actual gear engagement. Shift light cues default to off; the website and
  in-game VR switch can enable and save them in the profile. Appearance bits
  travel with remote driver poses.
- Native H-pattern and sequential I-pattern controls, with reverse, neutral,
  configurable directions and travel, and optional no-grip single/double flicks.
  Zone radius, movement axis, wrist angle, travel and speed thresholds live in
  the web/cloud profile. A fitted gate guide can be always visible, shown near
  the lever, or hidden. Gas, brake and clutch pedals and the lever/gaiter animate;
  their bounded values travel with the driver to other players.
- Wheel contact is automatic by default: either hand attaches within 8 cm of
  the rim and releases beyond 12 cm, avoiding grip flicker at the boundary.
  Missing poses release contact; recovery and tracking gaps rebase steering.
  Occupied hands stay with their other cockpit control. `vr_wheel_grip = on`
  restores release-to-arm grip-button steering, available in both settings
  menus and the cloud profile. Changing modes preserves the current wheel angle.
- Media and seat controls use only physical fingertip contact in VR. Accelerator
  and brake triggers stay independent of hovering and tapping either control
  or dragging the radio sliders, including repeated taps while a pedal is held.
  Controller rays and trigger
  clicks neither highlight nor operate the radio. Hand ownership still prevents
  a radio or seat touch from grabbing the panel or shifter. Panel grips retain
  their separate trigger capture.
- Manual gear requests go through HumanDriver's requested-gear field after its
  retail update. The original gearbox engages them. Driver epochs, manual/input
  eligibility and a 300 ms mailbox expiry reject stale commands. A tracking-loss
  epoch rejects a held command after a page stall; overlapping seqlock writes
  retain the last complete pose only until that expiry. Explicit reverse
  preserves separate accelerator/brake input. On the starting grid only neutral
  and first are selectable: neutral holds after GO until first engages, while
  preset first survives the start. The retail driver unlock and launch logic
  still run; automatic transmission and ordinary controls retain their start.
  The driver reads current command ownership before applying a held detent,
  preventing a late button edge from being overwritten by an older render-frame
  sample. Ownership is published before the separate controller input mailbox.
- One media element drives both the website and cockpit screen. The rightmost
  cockpit button switches media/telemetry without restarting playback; the
  other buttons select previous/play-pause/next and LED colour. Telemetry uses
  real RPM, acceleration and brake histories. External playback suppresses EA
  Trax through the radio mailbox while retaining vehicle sound effects.
- Optional screen grabbing with grip, translation, pitch/yaw and right-stick
  resize. Map and screen use the native contact pivot: the grabbed point stays
  beneath the palm through wrist rotation, and screen resizing scales contact
  in its plane only. Changed placement saves once on release/tracking loss;
  source changes and tracking gaps require a fresh grip. Placement/page/colour changes are saved beside the profile, through
  the existing cloud-save path. Controller zone rumble and shift impulses use
  optional browser haptic actuators.
- Engine feedback uses the native curve and each car's actual idle/redline.
  Engine and road/collision feedback mix on both controllers by default, including
  left-stick steering without wheel contact. Brief road impacts last 65 ms;
  contact and shift clicks mix with this background. Confirmed shifts click only the shifting hand. Engine rumble, feedback
  restricted to wheel/lever contact, shift vibration and the original native
  shift sound are independent profile settings. The master vibration switch
  stops the motors; ordinary controllers remain supported.
- Desktop Chromium does not expose XR controller vibration actuators. The optional
  Windows helper in `tools/pcvr-haptics` supplies a loopback output connection and
  a per-user OpenXR output layer restricted to Chrome/Edge. The start page offers
  the installer ZIP, connection status and one-time local permission setup. The
  helper starts at Windows sign-in; ordinary website visits use the player's
  existing browser profile. The game and all rendering/input remain in the browser.
  Quest Browser keeps direct actuator output. The shared native effect curves,
  click durations, focus stop and finite-pulse expiry apply to both paths.
- Race avatars use the authenticated race car slots. The server grants pose
  delivery from its Online roster or live free-roam discovery links, independent
  of the extension's room label. Hostless LAN requires reciprocal peer consent
  from the original race and both players' LAN connections to be open.
- Free-roam co-op publishes two independently matched car endpoints from one
  browser. Server grants filter each pose by its original discovery link;
  removing one endpoint clears that pose while preserving the other. Local
  views render the other driver's cabin and avatar with their own camera and
  world depth. Semantic eView tags select the pass and its viewport/scissor.
  Scene layout 8 is 14416 bytes and carries up to six player cameras; separate
  uniform banks prevent later cameras from overwriting an earlier view.
- Original menus, movies and loading screens use a stationary 4.8 m cinema
  screen at 3 m, preserving the PC picture's aspect. Its pose updates at every
  headset frame even when the game draws more slowly. Both sticks navigate
  menus; A/B/X/Y retain their menu actions. Held faces and sticks must first
  release/centre when crossing between driving and menus.
- Tap Y to downshift or hold it for 650 ms to pause, including runtimes that
  reserve the controller's Menu button. Both stick clicks recenter once per
  released chord and release wheel, lever and panel contacts. An old head pose
  cannot overwrite a recenter requested during the same frame.
- X opens the native-sized VR settings panel from pause or the main menu.
  Either stick selects and adjusts; A advances/activates, Y resets the selected
  field and B returns to the original menu. It shares the website's labels,
  validation and live settings, including per-car mirror profiles. Held edits
  save on release or interruption through the encrypted cloud profile path;
  unrelated hand-adjusted placements keep their full precision. German panel,
  website-to-headset changes, input ownership and reload were tested in game.
- Original PC text fields open a 4 × 10 controller keyboard in the headset.
  Either stick moves, A selects, X switches uppercase/lowercase/punctuation/Latin
  banks, Backspace deletes and OK accepts; B cancels. Password fields are masked
  unless Y is held. The PC's character and length rules remain in charge, including
  seven-character career names. Tracking loss clears the displayed text and
  requires buttons to release before editing continues.
- **Mods → Stance** opens the native nine-row paused editor for the current
  car. Global on/off, model override, front/rear camber, front/rear offset,
  tire width and model reset share the website's Mods controls. Camber is
  0–15° in 0.5° steps, offsets −40 to +80 mm and tire width 80–130%.
  The bounded `stance_models` setting stores up to 46 model overrides in the
  encrypted cloud profile. Edits save before publication; failed saves retain
  the previous values. Website and cockpit edits serialize through SettingsFile.
  Existing per-car `MODPARTS.DAT` entries remain intact and become effective
  again when the model override is removed. Only the draw path changes wheels;
  positions, widths and camber constants restore before physics continues.
  Mailbox version 3 and scene layout 6 carry independently validated model
  updates and the local car's current values, with earlier layouts readable.
- The VR settings **World** subpage selects the main world, World 1–4 or a named
  world entered with the controller keyboard. It uses the same saved/live change
  as the website, including World 4's ghost rule and cloud settings. A world
  change during an outrun/lobby/race waits in the original runtime until free
  roam; a run started without free roam takes the choice at the next launch.
- **Online profiles** on the website and in VR keeps up to eight named
  connections with a world, selection, rename and confirmed deletion. Its
  `xyz-profiles.json` catalogue is separate from the career and travels in the
  encrypted cloud archive. An existing eight-word passphrase links only that
  connection: its derived claim token stays encrypted in device-local IndexedDB,
  outside the save archive. Empty input removes the local sign-in. The name
  reservation guide returns to the website's existing Online controls.
  Connecting in career free roam waits for the original game's applied name
  before opening the new authenticated socket. Disconnect remains off across
  activity changes; kicks, bans, forced renames and active LAN/Online sessions
  retain their original restrictions. Race browsing inside LAN/Online lobbies
  and direct selected-profile entry from the main menu or paused career are implemented, with return to the original career position or main menu.
- Both XR presentation paths use a far plane beyond the largest original
  camera and its float32 projection rounding. The retail sky remains visible
  in stereo; the game's frustum tests remain active.
- Right stick click cycles all five PC drive views and the cockpit; left click
  holds the original rear view outside the cabin. The two-click recenter chord
  consumes both clicks through release. Stock cameras receive head tracking
  without cockpit body/HUD overrides, and exterior driving keeps stick
  steering, pedals and shift buttons. The extra view never writes an invalid
  camera slot into a PC profile.
- Replay retains the original timeline, snapshots and stream. Right stick click
  cycles five manual replay views plus the fitted cockpit, and the selected view
  survives seeking. B tap toggles the timeline; holding B for 500 ms returns
  through the original menu. The complete timeline sits on one stereo plane,
  rather than the driving instruments' separate mounts. Viewer lifetime tokens
  reject old actions, including reuse of the same guest address. A bounded
  in-memory history restores physical gear requests, reverse pedal direction
  and full simulation ticks after snapshot seeks; original error and checksum
  checks remain active. Leaving restores the driving camera selection.
- The native master sound trim (−12 to +12 dB) scales game audio, shift clicks
  and local media together, with short gain ramps. The live website/headset
  setting travels with the encrypted profile; media volume remains independent.
- Private game-data preparation that expands retail `SDATA/sdat.viv` into the
  browser's `speech` and `pfdata` directories without editing the PC installation.

## Work still required before a complete mod release

- Physical headset acceptance of screen effects, reflection views, HUD,
  tracking comfort and performance. CPU and GPU perspective world draws now
  share eye correction; semantic eView ownership excludes other cameras and
  constant-w screen effects.
- Finish the remaining acceptance findings in [VR_PARITY.md](VR_PARITY.md).
- Investigate an intermittent original track-streaming wait after replay rewind
  (`0x5e6c10`). Subsequent complete VR runs at 60 and 30 FPS pass, but the
  earlier stalled run remains an open stability finding.
- CopChase is explicitly deferred, including simulation and visible vehicles.
- Hostless LAN uses mutual consent, not a central authoritative race roster.
- Physical mixed VR/flat sessions, late joins, opt-in/out and long races, then
  browser/headset performance acceptance.

## Protocol

LAN binary kind 34: `[34, 0, 0, 0]` followed by UTF-8 JSON, at most 16 KiB.
The switch supplies sender identity. Room labels grant no avatar access.
Request/event schemas live in `web/src/vr/protocol.ts` and
`web/server-rs/crates/vr/src/lib.rs`. The browser publishes at 10 Hz, sharing the
existing 20 Hz control budget. The extension caps membership at 1024 browsers.
Head/hand poses use car-local metres (right, up, backwards); missing
tracking is `null`. Optional `fingers` contains left curl/index extension then
right curl/index extension, four finite values in [0,1].

The switch queries actual free-roam discovery links and Online race membership
every 250 ms for participating browsers. Directed discovery remains directed;
Online membership takes precedence over free roam. Outside either host's
membership, LAN requires both connections to be open and reciprocal `peers`
lists (at most eight addresses). The browser clears these claims after one
second without a fresh original-game scene. Withdrawing consent removes the
LAN grant immediately. This is mutual consent for hostless LAN, not a centrally
verified LAN roster.

Grants expire one second after the host query starts. Each host has at most
one outstanding query; expiration continues if it stalls, and late answers
cannot renew grants. Connection identity and membership generation are checked
again when answers arrive. Removed grants send `gone`; newly granted peers
receive only cached poses younger than two seconds. An Online race survives
ordinary lobby TCP closure. Physical connection loss revokes its grant, and
only the switch's verified private resume token restores that connection's
race membership.

Clients remove silent avatars after two seconds. No extra listening port or
identity token is introduced. Accepted updates are acknowledged to their sender;
a tab whose membership has expired must rejoin before publishing again.
CopChase remains excluded. Its inactive legacy protocol scaffold retains
room-scoped authority epochs and complete police snapshots; it does not grant
avatar access in the production switch.

## Development

Use the upstream build commands in README.md. Windows builds run in WSL on its
Linux filesystem. Keep the supplied PC game directory external to the checkout.
No game files, generated C or WASM are checked in.

On Windows, with Ubuntu, Rust, Node.js 24, Python/venv, rsync, a C compiler and
wasi-sdk 34 installed in WSL:

```powershell
.\tools\start-vr-web.ps1 -GameData 'D:\Games\Need for Speed Underground 2 v1.2'
```

The launcher mirrors the source into `~/nfsu2-vr-web`, prepares private data in
that mirror's `out/vr-game-data`, builds what changed and serves
`http://localhost:8611`. Close the running server with Ctrl+C before restarting.
`-Port` and `-Distribution` select another port or WSL distribution. The local
address needs no certificate; other PCs need the upstream HTTPS deployment setup.

### Virtual Desktop performance

For hybrid laptops, check both `[gpu] renderer attached` and `[vr] presentation
GPU` in the log during the actual headset session. WebGPU's high-performance
request is a preference; a desktop test can still select integrated graphics.
In Windows **System → Display → Graphics**, select the browser and choose the
NVIDIA/high-performance GPU, then fully restart that browser. This affects
other pages in that browser too. See [Microsoft's GPU preference instructions](https://support.microsoft.com/en-au/windows/hardware/display-graphics/optimizations-for-windowed-games-in-windows-11).

At 120 Hz, SSW can display 120 images using 60 real application frames and
60 generated images. It does not turn a 45 FPS application into one rendering
120 real frames. See [Qualcomm's SSW explanation](https://www.qualcomm.com/developer/blog/2022/09/virtual-boost-vr-rendering-performance-synchronous-space-warp).
Measure with Virtual Desktop's performance overlay, distinguishing application
FPS from headset refresh. For a 60 FPS target the application has 16.67 ms per
frame; for native 120 FPS it has 8.33 ms. Synthetic XR tests exclude VDXR,
streaming and headset composition, so their results cannot establish either
minimum on a real headset.

For a GPU-limited session, try **Headset resolution 75%** and **Mirror resolution
512**, then re-enter VR. 75% of both eye dimensions renders about 56% as many
scene pixels. These are starting points, not a guaranteed frame rate; reduce
to 50% if necessary. Keep the frame-rate setting at Auto or 120 for a 120 Hz
headset. Measure actual 120 FPS with SSW disabled; for 60 real FPS plus SSW,
the fixed 60 FPS setting avoids unnecessary game frames. Laptop comparisons
should use AC power and the same moving scene, resolution and graphics settings.

Transfer checks (14 November 2026): hardware GPU pixel tests verify one pixel
constant upload for a stereo pair, fresh uploads on frame changes, and identical
pixels when the second eye skips prepasses with different alpha thresholds.
Interop checks verify retained texture storage across fresh frames, asymmetric
eyes and layout changes. A ten-second driving sample on RTX 3050 Laptop with
simulated 120 Hz XR at 2016 × 2208 per eye measured 119.2 completed frames/s;
the preceding bundle measured 119.4. Both pass capture, return to flat play and
normal exit with zero GPU errors. This confirms reduced duplicate work without
an observed FPS gain in that capped sample; it does not reproduce or resolve a
45 FPS VDXR session. Physical-headset performance remains unverified.
TypeScript and the page build pass; the Windows fast suite passes 863 tests
with 37 environment skips and no failures.

For checks from the Windows source checkout, build the test server once in WSL,
then run the page and GPU tests in Windows Node:

```powershell
wsl --exec bash web/server-rs/build.sh
Set-Location web
npm run check
npm run build
npm run test:fast
```

The test tools translate Windows paths before invoking Bash or the WASI compiler
in WSL. They use the SDK in this checkout's `deps/`, or in the launcher's
`~/<checkout-name>/deps/` mirror. Set `WASI` to an SDK directory to override it,
and `NFSU2_WSL_DISTRO` to use a non-default distribution. The server build above
must use that same distribution (`wsl -d <name> --exec ...`). No game data is
needed for these checks; tests requiring retail data or a native host compiler
report an explicit skip when those dependencies are unavailable.

**Play** starts the usual monitor session. The separate **Start in VR** button
requests the headset directly from its click and transfers that session to the
renderer when the game is ready; a rejected request does not start a desktop game.
Without a detected headset the VR button stays visible but disabled, with an
explanation. Connecting a headset refreshes its availability. The in-game
**Enter VR** button also remains available. Keyboard/gamepad input remains
available. Cockpit display controls accept fingertip touch in VR and mouse clicks on desktop.
With **Drive with VR controllers** enabled, squeeze near the rim to grip with
one or both hands. The right trigger accelerates; the left brakes. Left X shifts
up; tap Y to shift down, or hold Y for 650 ms to pause. Right A/B activate
nitrous/handbrake. Rotation, sensitivity,
return speed and steering deadzone are stored with the VR profile. Turn the
option off to drive with an ordinary gamepad or wheel while wearing the headset.
The right stick enters an event/shop or challenges a racer with up or right,
opens career status with down, and opens messages with left. Each deflection sends one short pulse, with the dominant
axis choosing the action. Return to center before repeating. While holding the
screen, the right stick changes its size; shortcuts resume only after release
and returning both axes to center.
Entering VR selects the cockpit, including after leaving VR during a race.
Tracking loss and recentering preserve the chosen camera.
Click the right stick to cycle the five PC views and the cockpit. Hold the left
stick click for the rear view outside the cockpit. Click both sticks to recenter;
release both before another camera action. In exterior views the left stick
steers and the triggers/shift buttons remain available. In the pause or main
menu, X opens VR settings; B closes that panel before returning to the game.
In Replay, tap right B to show/hide the timeline, hold it for 500 ms to go back,
and click the right stick to change camera. The selected camera stays while
skipping backward or forward. Loading and lost tracking require a fresh release.
For the physical shifter, select manual transmission in the game. In H mode,
grip the knob, return through the neutral rail to change lanes, then engage the
next gear; first gear requires the full forward stop. I mode uses a configurable
push/pull stroke. Optional gestures need no grip inside the active zone: pause
briefly after entering, flick and return to centre before the next shift. Double
downshift mode requires two distinct flicks within 550 ms. The countdown starts
in neutral; select first before GO or engage it afterward to launch. Remaining
native features are listed in the parity inventory. CopChase is deferred.

## Verified development checks

- WASM runtime and Rust server build successfully.
- TypeScript check and translation-key check pass.
- Browser fast suite: 755 passed, zero failed, 15 environment-dependent checks
  skipped. The GPU interop test skips WSL's software adapter and passes separately
  on Windows Chrome with a hardware adapter.
- Real Chrome/WebGPU with simulated XR cycles all five stock views and back
  into the cockpit, holds rear view, accelerates and brakes while moving, and
  recenters with staggered click releases without changing camera. Every view
  reports zero GPU errors and the game exits normally. The original automatic
  reverse behavior remains intact; a stationary brake press can drive backward.
- The German in-headset settings panel captures controller input, changes a
  wheel setting on the website, receives a live website edit, and preserves it
  after the game exits and the same profile reloads.
- Original HUD capture passes in real career driving with GPU vertex shaders
  (39–42 frontend draws) and the CPU vertex path, and in a Quick Race (36 draws).
  Speed/RPM respond to acceleration; the full PC map and turbo dial are visible,
  and standings/laps/times render on the fitted right window. Pause restores the
  ordinary frontend; resuming recaptures the instruments. Each scenario exits
  normally with zero GPU errors. GPU readback separately checks alpha coverage,
  capture reuse across eyes, identity on GPU frontend vertices, and 1/4-sample
  panel pipelines.
- The live career map test reads 2418 metres from the original GPS, displays
  2.4 KM / 1.5 MI with the game's units, moves/turns the map, resizes the screen,
  opens the original world map through controller A, deactivates GPS and exits
  normally with zero GPU errors. Hand poses are synthetic, not a headset test.
  Unit tests cover X/A capture, grip priority, circular contact, wrist rotation
  across the Euler wrap, resize anchoring, interruption/save and invalid GPS.
  Five German minimap sliders retain their values after a real page reload;
  desktop/mobile layouts were checked. Their translations cover all 20 languages.
- Native C fixtures exercise cockpit camera restoration, local-only body culling,
  shader position matching, window texture validation, sampled shader stages and
  the native crossed-card driver filter. The real-game media test also requires
  actual retail body draws, acceleration and braking. Its initial career phone
  call must finish before input is enabled.
- The real 350Z cockpit is checked looking forward, left, right, backwards and
  up. The four additional views feed synthetic poses through the live tracking
  mailbox and require actual body draw calls. Video/telemetry page switching,
  LED colour, screen movement and transparency pass with zero WebGPU errors.
  These checks exercise the real renderer, without claiming headset acceptance.
- Rust VR/LAN suites: 140 passed, zero failed, six optional tests ignored;
  workspace clippy with warnings denied and rustfmt check pass.
- Real Windows Chrome renders a scripted Quick Race, exits normally and reports
  1,649 rendered frames with zero WebGPU validation errors at 640 × 480. This
  run shared the machine with builds/tests and is not a headset FPS benchmark.
- A separate game scenario reaches Quick Race and quits at frame 4,772.
- Windows Chrome's GPU test preserves distinct left/right eye pixels through
  the production WebGPU-to-WebGL bridge. Only the XR hardware is mocked.
- Session tests cover tracking loss, end/detach during asynchronous startup,
  depth conventions, same-frame shift command publication and returning to the desktop session.
- Network tests cover mixed-display poses, opt-in isolation, authority handover,
  stale epochs, reconnects and socket-owned identity.
- Avatar routing tests exercise directed discovery, immediate world/block
  changes, Online roster precedence, reciprocal LAN consent, consent withdrawal,
  one outstanding query during a stalled host, expiry, late answers, membership
  generations and private-token reconnection. Actual two-game free roam rejects
  a forged extension room after world separation and restores poses on rejoin.
- The routed Online sprint delivers 201 VR and 200 monitor avatar samples,
  reaches results and preserves the career car, bank and position on return;
  both games exit normally with zero GPU errors. The routed LAN drag delivers
  391 VR and 394 monitor samples and passes website/headset search, create,
  join, readiness, start, results and return. Only tracking and the original
  test driving/finish commands are simulated. The controller probe waits for
  released tracking frames after menu changes before pressing its next button.
- Actual co-op acceptance uses two PC browser games and three cars, with one
  synthetic VR pose and a separate flat pose in the same browser. Both exact
  endpoint matches, privacy off/on and departure of the second driver pass;
  both games exit normally with zero GPU errors. The split-view capture was
  inspected after correcting an unowned full-target pass that misplaced a
  cabin. GPU readback verifies that two cameras in one submit match separate
  renders pixel for pixel. The build passes 829 fast tests (15 environment
  skips), TypeScript, WASM and JS compilation. No physical headset is claimed.
- Stereo pass acceptance uses the actual PC renderer with GPUVS=1 and GPUVS=0,
  plus simulated XR. Samples contain 575–581 GPU world draws or about 660 CPU
  world draws, all tagged with their original main camera and perspective
  projection; captured HUD stays separate. Both runs include head rotation,
  inspected stereo images, normal exit and zero GPU errors. Hardware readback
  shows identical stereo pixels for CPU/GPU vertices, unchanged screen effects
  and other views, and unchanged offscreen reflection capture. The build passes
  830 fast tests (15 environment skips), TypeScript, WASM and JS compilation.
- Hand tests cover both authored index pads in moved/rotated screens, fast
  pokes, deep penetration, withdrawal rearming, occupied controls and tracking
  loss. GPU readback distinguishes open/grip/point geometry on both hands and
  removes lost hands; packet tests reject invalid weights and preserve legacy
  clients and late arrivals.
- Python archive tests cover bounded payloads, path traversal and isolation of
  the original installation.

Additional cockpit/media checks:

- The actual game plays a local video on the dashboard, switches to live
  telemetry and back with pointer clicks on the cockpit PAGE button, changes
  LED colour, and exits normally with zero WebGPU errors. Moving the screen
  above the dash at 35% opacity is checked visually; GPU readback checks
  its depth occlusion and alpha blending.
- Local video checks use Chrome's normal autoplay policy and start directly
  from a selected folder. Decoded-frame counts and cockpit canvas pixels must
  advance while the start page is hidden; play/pause, PAGE and LED clicks run
  in the actual game with forced rain. Browser regressions cover video-only
  folders with a remembered music choice, blocked audio resume, refused play,
  source switches and manual pause. Native camera tests cover lens-pass return
  and argument handling, other views, exterior cameras and frame-end cleanup.
- The original 0.5 m driving near plane is reduced to 3 cm only for cockpit
  views. The game projection and combined matrix, extra geometry and pointer
  picking share that projection. The mirror capture uses its own rear camera
  and reflected-eye origin; photo views retain their original camera.
- Two real Online and two real LAN game sessions finish their sprints with avatars mapped to each
  actual opponent. Different free-roam room choices converge to the same race
  pose room; both monitor and moving synthetic VR poses are received.
- A further complete LAN sprint checks the physical wheel angle extension:
  the monitor client receives moving wheel angles with the opponent's head
  and both hands, while the VR pose client still receives the ordinary driver's
  avatar without that optional field. Both reach results and exit normally;
  neither reports a GPU error.
- The hand-pose LAN sprint delivers 891 VR avatar samples with all three right
  hand poses to the monitor player, and 891 monitor driver samples in the other
  direction. Both finish and exit normally with zero GPU errors.
- The corresponding Online sprint delivers 780 samples in each direction and
  all three hand poses, then returns through results and rankings and exits
  normally. Both clients report zero GPU errors.
- A subsequent LAN sprint checks the shifter/pedal extension too: the monitor
  client receives 826 avatar samples, including 737 moving-lever and 655 pedal
  samples, attached to the actual opponent. The other client receives 826 monitor
  driver samples. Both finish and exit without GPU errors. The moving poses are
  synthetic; the authenticated connections, race cars and renderer are real.
- Controller tests cover screen grabbing, bounded pitch/yaw/scale, saving on
  tracking loss, PAGE/LED edge triggers, gear cues and race-room transitions.
- The real-game wheel scenario sends synthetic tracked controllers through the
  production session and input mailbox: both steering directions, two attached
  gloves, gas, actual acceleration, braking, release, contact/engine haptic
  requests and clean exit pass with zero WebGPU errors. It does not emulate
  physical haptic actuators. Unit checks cover hand changes, pose jumps/loss,
  rotation limits, return/catch, deadzone, source changes, captured triggers,
  recenter release and the 250 ms input heartbeat.
- That scenario also checks open hands after release, gripping on the wheel,
  index pointing at the screen and a physical PAGE press without a trigger.
  Holding the fingertip in place does not repeat the page change.
- The real-game shifter scenario runs H-pattern, neutral crossings, reverse,
  both I-pattern directions, no-grip single flicks and double downshift strokes
  through the production tracking/mailbox/driver path. Reverse acceleration and
  braking, confirmed shift clicks, zone rumble and red/blue LEDs pass, followed
  by clean game exit with zero GPU errors. Only the tracked poses are synthetic;
  this does not test a physical haptic actuator.
- The same real-game scenario verifies the native 20 ms shift sound through
  the actual Web Audio output, independent sound/click switches, idle-to-full-
  throttle vibration, no-grip zone entry/exit, both-controller engine mode and
  engine disable. A real game force-feedback event reaches both controller
  callbacks at amplitude 0.659 with engine feedback disabled; master off stops
  both. All pass with zero GPU errors. Unit checks also cover impact expiry,
  motor replacement/stop, ordinary gamepad routing and old telemetry layouts.
- X/Y change actual gears through the controller input path; the right stick
  sends career actions without releasing the lever or changing the pedals. Unit checks cover dominant-axis career shortcuts, source/clock changes,
  resize capture through release, two-axis controllers and the cross-mailbox
  ownership handover. These use synthetic controller poses and real PC input.
- Four real Quick Race starts separately check neutral after GO under full
  throttle, preset first through the countdown, automatic VR controls and a
  manual monitor session. First engages through the original gearbox; second
  becomes available without dropping the held lever. All four exit normally
  with zero GPU errors. The tracked starts also record cockpit body draws
  during the intro, countdown and launch.
  The test selects the player's transmission preference, leaving the temporary
  intro AI and the original handover to HumanDriver intact.
- C and TypeScript checks cover grid/pause transitions, stale targets, first-only
  selection, button/control opt-out, non-human controllers and moving cars.
- Unit checks cover four/five/six-speed gates, blocked diagonal movements,
  RHD lane order, first-gear stop, gesture deadzones/rearming/timeouts, occupied
  hands, stale driver epochs, return through neutral, clutch travel and relay
  bounds. GPU readback checks moving cabin parts and the transparent gate guide.

- Two real Windows Chrome game instances complete career free roam and see each
  other's cockpit, helmet and hands. One publishes moving synthetic XR poses,
  the other uses the monitor driver's neutral pose; both exit normally with
  zero WebGPU errors. This exercises real authenticated sockets and game car
  transforms, but does not substitute for a physical headset test.
- GPU readback tests verify authored meshes, distinct eye transforms, world
  depth occlusion and pose opt-out, using shared WASM-style memory.
- Browser UI checks cover German desktop/mobile layouts, slider persistence,
  local folder audio/video filtering, blob playback and media volume/opacity.
  The hand-control toggle and four wheel sliders also survive a real page reload.
  All eleven shifter/gesture/guide controls also survive a real German-page reload.
  The four haptic/sound options survive reload too, with checked German desktop
  and mobile layouts.
- An encrypted vault round trip restores the VR settings, per-car mirror angles and GPS distance into another
  profile while retaining that browser's device-specific graphics options.
- The real PC game with simulated XR passes the German Stance editor's five
  adjustments, live website updates, model reset, resumed driving and persisted
  page reload, with zero GPU errors. Desktop and 390 px controls were inspected.
  The original Body Shop Stance scenario still passes. Parser, mailbox bounds,
  asynchronous persistence, cloud round trip and render-state restoration tests
  cover the new model overrides.
- Real career tests operate all four armrest seat buttons and all three mirror
  grips, then reload the same profile to verify seat and per-car mirror values.
  German desktop/mobile controls independently edit/reset two car profiles and
  the defaults; another car's profile remains intact.
- The real EA TRAX player passes fingertip previous/pause/resume/next, silent
  volume without stream loss, volume sliding and one save on withdrawal,
  LED colour and dashboard page changes, then profile reload. Music-only PCM
  supplies the spectrum; sound-effect readers are excluded. Retail frontend
  pause and track replacement keep their own ownership: a replaced stream
  never inherits an old voice's pause/resume action.
- Two complete real-game VR replay runs at 60 FPS and one at 30 FPS verify
  recorded physical neutral/forward/reverse shifts, six views, timeline,
  tracking interruption, rewind, original checksums and return to the driving
  cockpit. All exit with zero GPU errors. The separate original monitor replay
  scenarios also pass at normal and 240 FPS. XR poses are simulated.
- Actual Chrome audio graphs verify master trim on both game and local-video
  output at −12, 0, +6 and +12 dB, followed by clean exit and profile reload.
  The German desktop/mobile controls are visually checked; encrypted vault
  tests restore the trim on another profile.
- A real Chrome/WebGPU career run with a simulated XR session exercises both
  eye renders through the WebGL bridge, the stationary pause screen, held-Y
  pause, B return and both-click recenter. It exits normally with zero GPU
  errors. Inspection confirms the sky in both eyes after the far-depth fix;
  hardware GPU readback separately checks menu orientation, stereo disparity,
  surrounding space and head movement. This is not a physical headset test.
- CSP permits local blob media while keeping remote media restricted.
- European-only car data selects the original European car tables. This avoids
  a career-load stall when the NA executable is paired with data lacking the
  Civic and RSX; no supplied game files are replaced.

Headset optics, stereo comfort, controller interaction and physical-headset
multiplayer still require acceptance. CopChase remains deferred.

Checks: `npm run check`, `npm run test:fast` in web; `cargo test -p nfsu2-vr`,
`cargo fmt --check` and workspace clippy in web/server-rs; `web/build.sh` for WASM.
No successful headset run should be inferred from compilation or unit tests.

The global race browser has a copied PC data path in `racebrowser.c` and
`web/racebrowser_web.c`. It runs on the guest main loop, samples lobby changes
four times per second and caches the immutable track catalogue until its or
the language table's identity changes. `HOST_KIND_RACES` is a separate,
versioned sequence-lock snapshot; `RaceReader` returns owned copies and does
not retain guest pointers. A publication contains at most 128 track choices,
20 displayed games and six room members. Track captions are decoded against
the loaded PC character table before publication as UTF-8. The bounded reader
matches the original converter at `0x50d3c0`, including its multibyte lookup
and byte-mode bypass; only installed custom-font packs apply their documented
glyph substitutions. Each label accepts at most 127 source bytes and reserves
384 bytes for UTF-8. Missing or malformed labels retain the track-number fallback.

The PC filter was checked against `0x4987c0`, the track records against
`0x5d3e80`, and lane limits against `0x4b3110`. Existing `netrace.c` network
rules apply: six players outside Drag, three lanes for 4402 and four for other
Drag tracks; two laps for Circuit/URL/stadium Drift, four for Street X, one
for Sprint/Drag/downhill Drift. The service's track/direction/lap fields are
parsed strictly and checked against this local catalogue. Unknown races can
remain listed with `compatible=false`. Changing or malformed list/roster
memory fails closed; string tails and the original record's AUTH field are
excluded. A host may start only when the minimum player count and every other
player's ready flag are satisfied.

The guest-thread command slot in `raceactions.c` / `raceactions_game.c` and
`RaceReader.send()` adds search, create, join/password, ready, start and leave.
Its ABI is version 5 (106,872 bytes, with a 106,540-byte output snapshot). The lobby flags publish original FE
dialog ownership and the entry/return trip state; actions 7 and 8 request
entry and return. A command carries the screen/connection
epoch and a copied race identity; the runtime re-reads the lobby before
executing it. Requests are single-slot and acknowledged after their input
bytes are cleared; acknowledgement means queued, not that the network has
completed. Unknown commands cannot make the next snapshot unreadable.
The acknowledgement publishes the lobby state after executing the command,
so a search receipt does not briefly expose the old list as idle. LAN reads
the original LAN persona field; Online uses its separate persona field.

The original room constructor owns creation and its selected car; the original
callbacks and coordinator own joins, readiness, starts, exits and results.
Only the overlay's synchronous search builder broadens its filter to all
public, unstarted races. Original Filter keeps its own masks. Create settings
are bounded by the loaded track rules, including the PC's three-player
minimum for ranked games. A settings lease restores each field only if it
still holds the temporary value; account, persona and login state are outside
that lease. Race passwords are input only, never part of a published snapshot.

`app/race-browser.ts` supplies one controller for the website and headset. It keeps
a selected service identity across row reordering and occupancy changes, drops
replaced identities, and follows the loaded track's lap/direction/player
limits. A single outstanding command survives a transient snapshot read;
passwords clear on submit, cancellation and connection/screen changes.
`app/race-view.ts` supplies their shared list/detail/create/room rows.
The website's Race browser button is available in the main menu, paused
career and original LAN/Online lobby or room; it hides while driving/loading. X → Race browser reaches the same pages in the VR settings
menu. Both support paging, refresh, the eight bounded creation fields,
masked password entry, readiness, start and leave. Original dialogs regain
input until dismissed; held buttons cannot spill into the returning overlay.
Selection survives transient waiting snapshots and reordered lists. The first
completed search selects its first result. Tracking loss clears the headset
password editor. The website uses the existing modal focus/gamepad capture
and fits a 390 px viewport without horizontal overflow.
`raceentry.c` uses the original pause QuitYes, Online login, lobby switch,
logoff and Resume Career/Explore handlers. Entry authenticates the selected
connection profile first, including when free-roam multiplayer is off. It
checks the guest epoch again after asynchronous profile preparation. Closing
the overlay cannot submit a late entry. The trip waits for original save and
error dialogs, releasing input to them; it never confirms them itself. Return
preserves the career's position and conditionally restores its temporary
Quick Race car/category pair. Early careers can resume directly into the
world without visiting the crib. Their borrowed prologue car is absent from
the front-end database, so it keeps the normal race-car selection; owned cars
use the existing checked lookup. The general browser does not award career
money, charge fees, change performance or auto-start a race. Actual-game checks
compare all 100 track choices and reverse names against English, German,
Russian, Japanese, Korean, Chinese and Thai files, then create/leave a room
and return to the main menu in each language. Russian, Japanese and Thai
captions are also visually checked in the website race controls. Unit fixtures
cover custom-font substitutions, sparse/overflowing tables, malformed
multibyte sequences and maximum-length UTF-8 output.
The existing `mprace.c` free-roam trip keeps its separate prize and performance policy. `online-pair.mjs --page app
--race-browser-check` observes the real original Online flow; its probe never
writes guest memory or supplies fake lobby records. The companion
`--race-browser-actions` probe drives the actual command slot instead of
using the original Create/Join buttons.

The real two-browser Online Drag scenario passes this probe: both catalogues
match all 100 loaded choices; the joiner reads the host's live listing; both
see the two-player roster, the joiner's ready flag and the host's start
permission. Lobby data clears during racing, the original results/return flow
finishes, both processes exit normally and the existing simulated-pose avatar
probe passes. Native C tests (also run with address/undefined-behaviour
sanitizers) cover sparse memory, changing tables, duplicate identities, bounds,
strict PARAMS and roster ownership. C-to-TypeScript ABI tests cover torn
publications, owned copies, malformed counts and Latin-1 room names.
The command-driven Online Drag run also passes: passworded create, leave and
recreate, public search, passworded join, ready off/on, host start, results,
return and normal exits for both games. Invalid/stale requests, password and
option bounds, pending-slot ownership and conditional settings restoration
are covered by C/TypeScript tests; the C actions pass ASan/UBSan. The same
command path also passes a two-browser LAN Drag run with the lifted original
server.dll, including passworded create/recreate/join, readiness, start,
results and return. The broad search clears its requested custom flags as
well as broadening its masks: the original LAN server compares masked game
flags to the unmasked requested value. All three instruction hooks are scoped
to this controller's synchronous search, leaving retail Filter unchanged.
The same Online and LAN scenarios also pass through `GameSession.raceBrowser`:
the shared controller creates the form options, owns the selected record and
submits all nine host/joiner commands. Both original games reach results and
return normally. The dedicated menu flow also passes in both Online and LAN:
the host uses website buttons and its masked password input; the guest uses
the installed GameSession VR menu and controller keyboard with simulated
tracking. Create/leave/recreate, passworded join, ready off/on, start, results
and return are exercised. The original scripts own only login and the
race/results flow. `--race-browser-ui` selects this test; desktop, 390 px and
headset-overlay captures are inspected. This is real browser/game integration,
with synthetic controllers and poses, not a physical headset acceptance run.
The Online `--race-browser-ui-reject` case also rejects a wrong password in
the original dialog, dismisses it with the controller, joins with the correct
password and completes the race/return. Its readiness requests are verified
as on/off/on against the same controller snapshot that the menu presents.
The current check/build pass includes 813 fast checks, zero failures and 15
platform skips. No physical headset run is implied.

Music-source acceptance: actual career playback switches between Auto, Custom only and EA TRAX only; quiet menus, original EA metadata on return, preserved video position and manual pause, website changes and profile reload pass. The German 390 px layout was inspected.

The headset Mods subpage uses the website catalogue and shared control choices.
It writes the same settings.ini/cloud keys, saves held edits on release and
returns to VR settings with B before closing the panel. Original / Off / High
beam controls the local car's lamps and road projection through the existing
lightkey implementation, including free-roam peer sharing. GPS, headlights, gearbox whine and Special vinyl availability
apply live; the category changes on the next shop opening. The other mod choices
show the next-launch notice. The
160-byte VR mailbox extends the legacy tracking/replay layouts with a bounded,
revisioned settings command independent of tracking; older mailbox sizes remain
accepted by the frontend. A GPS switch-off hides existing ordinary HUD labels.

Actual-career acceptance: simulated XR controllers enter the German Mods page,
cycle the original car lamps off and onto high beam, enable GPS, return through
both menus, and change GPS/lights from the website. The runtime lamp byte,
original high-beam log, live GPS scene data, zero GPU errors, normal game exit
and profile reload pass. The stereo panel and website screenshots were inspected.
Encrypted cloud round trips include the headlight choice.

Optional data is staged by `tools/prepare_vr_mods.py` (see `VR_ASSETS.md`):
39 validated PC pack files and 43 music entries, with retained retail music.
Eight preparation/import checks pass on Windows and Linux, including rejection
of bad packs, changed music event graphs/buffer sizing, modified targets and
paths outside the prepared folder. Repeating the real import copies no files.

Native optional choices include independent HUD/map combinations (Original,
Map only, HUD only, both), regional cars and special vinyls. Regional unlocks
require both PC car sets; European-only data keeps its original selection even
with the option off. Special vinyls are off initially and do not remove fitted
parts. The shared car-count selector covers Auto and 0–64, including the native
six-car choice. Website and headset changes now update the running free-roam
car count. Lowering releases surplus slots; increasing uses the existing
demand-grown Cars pool and updates peer-link limits. Race, lobby, loading and
photo states retain the latest request until safe free roam. Switching back to
Auto restarts its frame measurements without changing the saved device defaults.

Live whine starts its asynchronous PCM loader on first enable, fades its own
mix when disabled and reuses the loaded sounds on re-enable. Synthetic C checks
cover missing sounds, fading, invalid settings, regional table integrity and
vinyl category filtering without modifying fitted parts. Actual career checks
with simulated XR pass HUD-only loading (no map replacement), headset selection
of special vinyls and six cars, live website whine toggles, one sound load,
profile reload, normal exit and zero GPU errors. The stereo menu and cockpit
captures were inspected. Cloud tests include regional and special vinyl choices.

The real PC Graphics Shop was also exercised without restarting: Sponsor is
the final category with the option off, Special appears after enabling and
reopening, and Sponsor is final again after disabling. All three captures were
inspected; the game exits normally with zero GPU errors. German desktop and
390 px website checks pass the four texture choices and 66 car-count choices
without horizontal overflow.

The 160-byte mailbox advertises version 2 for live Special/whine controls.
The frontend still reads older layouts; version 1 receives only its original
lights/GPS command and keeps the reserved words untouched. Both paths are
checked; the real version 2 runtime registers and loads/toggles whine normally.
HUD/map choices and the car limit are included in the encrypted cloud profile,
alongside the other native mod choices. Auto still resolves for each device;
its local render/FPS preferences remain local.


Controller text/world acceptance: 766 fast checks pass (15 environment skips),
TypeScript and JS builds pass. Actual PC profile creation through simulated XR
covers mixed case, delete, the seven-character limit, one-press acceptance of a
prefilled name, cancellation and tracking loss. The German World panel changes
World 4's ghost rule and a custom mixed-case room on the virtual LAN; the original
runtime takes the new room, returning to driving works, and a page reload keeps
the choice. Both-eye screenshots were inspected, the game exits normally and
reports zero GPU errors. Encrypted cloud restore overrides another device's world
choice. These runs simulate XR poses/controllers; no physical headset is claimed.


Live car-count acceptance: the version-4 VR settings mailbox is 4272 bytes;
its separate revision and signed limit leave tracking, replay and other controls
untouched. Older layouts retain compatibility. WASM and JS builds, TypeScript
and 817 fast checks pass (15 environment skips). Two actual browser games
exercise website 6/0/64/Auto changes, disappearance and return of a peer car,
photo-mode deferral, controller adjustment in the installed Mods menu, resumed
driving and persisted reload. Both exit normally with zero GPU errors. XR
controllers are simulated; this is not a physical-headset acceptance test.

The live-count stress run uses 64 simulated network clients with all 31 stock
model names and a real PC game/renderer. This European data set lacks Civic
and RSX; a cached geometry/texture availability check now skips those types
before slot assignment and also handles changed peer configurations, preventing
the original loader from waiting on absent model files. The run displayed 60
peer cars, passed 6 → 64 → 6 → 64 → 0 → 6 without restarting and exited normally
with zero GPU errors and no failed car loads. The initial Cars pool was sufficient
for these stock models; this run did not require an extra pool block.


`node web/tools/race-entry-check.mjs --base http://localhost:8611` exercises
selected-profile entry with two real PC games: a paused prologue career and a
main-menu player with free-roam multiplayer off. It uses the website and
installed headset race pages (synthetic controller tracking), passworded
create/join, readiness, a sprint, mapped remote cockpit/head/hand poses,
results and return. Its artifacts include action receipts, avatar samples,
career car/bank/position comparisons and exit/GPU status. The test uses the
original test autopilot and race-finish command; it does not write game memory
or invent lobby records.


Remote-driver exterior acceptance: the runtime identifies complete original
crossed-card meshes against the current player camera and per-car transform.
The draw records carry a bounded scene index. The page replaces those cards
only for heads actually included in that view; privacy, tracking loss, distance
and the avatar display option retain the original. This avoids overlapping flat
and spatial heads while preserving bodywork, window tint and other cars.
Three-car co-op checks cover independent VR/monitor poses, opt-out/restore and
second-seat departure; the actual games exit normally with zero GPU errors.
Original photo mode accumulates a still picture: visibility comparisons must
refresh that picture after changing poses or sharing.

The website identifies the fork as nfsu2-vr-web, retains upstream credits, and
passes 840 narrow-layout views across all 21 supported languages. The Linux
bundle includes license notices, a static server for its stated architecture
and a checksum manifest of the actual files. It excludes game data, source
maps and test routes. Docker deployment requires an explicitly selected fork
image. A local production-bundle smoke run verifies the page, both start
buttons and cockpit assets. These checks do not publish a server.

VR startup checks (10 November 2026): TypeScript and page builds pass on Windows
and WSL. The fast suite passes 821 checks with 36 environment skips; 28 targeted
checks cover startup ordering, cancellation, preparation failures, context reuse,
and actual WebGPU-to-WebGL pixel transfer on Intel Gen-12LP. A production-page
smoke run with simulated XR tracking/composition reaches the German title screen,
renders 350 frames with zero GPU errors and exits with code 0. Game code, data
and both graphics APIs are real in that run. A physical-headset GPU transition
still needs device acceptance.

PCVR performance acceptance (13 November 2026): the compatibility bridge imports
both full-resolution eyes together and retains them between new game frames.
The spectator canvas reuses an eye during ordinary driving; screenshots and
photo/readback frames retain their original camera. Stereo uploads shared
geometry once, and bounded caches reuse crop and primary-depth allocations.
Changing target size still clears depth, preserving the renderer's occlusion
semantics. Controller polling avoids a page-wide selector scan.

Auto cadence follows 72/80/90/120 Hz while the display clock belongs to XR;
fixed limits, cutscene caps and desktop rate selection remain intact. Session
entry requests 90 Hz when supported and the current rate is lower. Choosing
120 or 240 FPS on the website requests a supported 120 Hz mode instead. Auto
preserves a headset already configured at 120 Hz. Unsupported requests are
avoided, and a rejected request retains the usable current mode. The nominal
headset rate is kept separate from dropped application frames.

Windows Chrome on an RTX 3050 Laptop, actual PC game and GPU APIs, with simulated
90 Hz XR callbacks: 1280 x 1440 per eye improved from 13.4 to 85.4 new game
frames/s; 2016 x 2208 improved from 10.5 to 83.6. The simulated callback loop
delivered about 86 ticks/s. These are stationary cockpit samples of ten seconds
after warm-up, not a claim of sustained hardware-headset or crowded-race FPS.
Both-eye images, an original-camera capture and return to monitor play passed
with zero GPU errors and normal game exit. Windows fast checks pass 826 tests
(36 environment skips); Linux fast checks pass 849 (15 environment skips),
including the additional cadence test. Actual Intel GPU tests also verify
asymmetric eye sizes, atlas orientation, stale-frame reuse and depth occlusion.
Physical-headset acceptance remains pending because the headset was disconnected.
A subsequent acceleration run passed capture, monitor return and normal exit
with zero GPU errors, but measured 40.0/67.0 frames/s in its two windows. Windows
reported battery operation (PowerOnline=false) during that check; it is not a
controlled comparison with the stationary samples. Driving performance on AC
power and sustained 90 Hz in the actual headset still need measurement.

120 Hz follow-up (13 November 2026): mono offscreen reflection passes before
the world are shared between eyes when their colour and depth targets survive
the remainder of that frame. Screen-dependent and subsequently overwritten
targets still replay per eye. Rear-view ownership retains its separate checks.
GPU pixel tests compare complete left/right images against full replay across
consecutive changing frames and an overwritten-target case; the pixels match
exactly. Dependency checks also cover aliased cube faces and shared depth.

On AC power, the same RTX 3050 Laptop with real game rendering and simulated
120 Hz XR callbacks measured 110.8 and 108.3 new game frames/s in stationary
ten-second samples at 1280 x 1440 and 2016 x 2208 per eye respectively. The
preceding build measured 86.7 and 56.0 in the corresponding windows, with run
variance; this is not a hardware-headset comparison. The new build measured
92.2 frames/s while accelerating to about 48 m/s and 114.1 in a subsequent
window after the car reached a wall. The latter is not a moving-race result.
Selected eye resolutions are unchanged. Capture, return to monitor play and
normal exit pass with zero GPU errors. Sustained 120 FPS, compositor overhead
and crowded races still require a connected headset measurement.
TypeScript checks pass. Fast checks pass 831 tests on Windows (37 environment
skips) and 853 on Linux (15 skips), including the reflection dependency and
pixel comparisons, 120 Hz negotiation and preserving an existing 120 Hz mode.

Xbox cockpit appearance parity (13 November 2026): cabin, separate wheel and
textured gloves use `quest_cockpit_vk.inc`'s mesh-space vertex shade
`0.78 + 0.22 * max(dot(n, normalize(-0.3, 0.9, -0.2)), 0)`, squared in the
fragment stage and multiplied by RGB `(0.51, 0.49, 0.54)`. Fitted cabin normals
follow the native deformation; wheel lighting uses its authored normal before
the steering model rotation. Alpha cutouts follow the native material. LEDs
are added after this grade; video, telemetry and instruments are not dimmed.
GPU readback compares cabin, wheel and glove pixels against the native formula
for lit/shadowed normals and different world orientations, while verifying that
the screen's source colours remain intact.

The glove basis matches `quest_xr.c:poll_wheel_grips`: mesh +X maps to grip +Z,
mesh +Y/fingertips to grip -Y, and mesh +Z/back to grip +X for the right hand or
-X for the left. Free hands, lever contacts, physical fingertip picking and
remote rendering share that basis. Wheel contacts retain the native rim basis;
untracked drivers' resting poses are expressed in the corresponding grip space.
Tests cover translated and rotated controllers, both hands, lever placement,
network pose reconstruction and physical PAGE touches.
TypeScript and fast checks pass: Windows 833 tests (37 environment skips),
Linux 855 (15 skips). An actual-game run with simulated stereo XR verifies
three controller orientations against the native matrices with zero error,
two-hand wheel contact, LED on/off, retained bodywork, image capture and return
to monitor play. GPU errors remain zero and the game exits normally. Physical
headset acceptance is separate from this simulated tracking check.

Screen controls and frame delivery (13 November 2026): the cockpit screen owns
playback, page selection and LED colour controls. The separate radio panel and
its contact targets are removed. Mouse and fingertip input share
the volume and seek sliders. Elapsed/total time stays visible on the video and
telemetry pages. Seeking preserves pause and rejects an outdated track ID.
Local video/audio and custom-folder radio support seeking; original EA TRAX
exposes elapsed time but has no seekable duration. Folder seeks use protocol v5:
the mixer freezes both readers, acknowledges the new position, then resumes
after the producer has filled the ring. Only the current decoded song is kept.

New game frames can render into owned eye textures between XR callbacks using
copied eye optics; browser-owned XR targets are accessed only during their
callback. The two-frame queue bound remains intact. Presentation rotates cached
eye images to the latest head orientation, including asymmetric projections,
without repeating their WebGPU-to-WebGL upload. This is rotational reprojection,
not depth-based correction of positional motion or external-compositor artifacts.
The desktop spectator updates at 30 Hz during stereo driving; headset resolution,
headset cadence, captures and photo-mode rendering retain their selected values.
The visualizer reuses FFT storage and avoids recopying unchanged audio samples.

Gameplay camera eligibility accepts a valid local car during crash/jump camera
transitions while retaining menu/photo exclusions. Those transitions use the
game's camera in stereo and restore the selected cockpit afterwards; driving
input eligibility remains restricted to the driving mover. Camera lifecycle
tests cover that transition and restoration. A physical crash sequence still
needs headset acceptance.

Actual-game checks with simulated XR tracking pass mouse volume/seek, local
video and audio, custom-folder radio seek while paused, resumed playback,
telemetry page switching, timestamps, capture, return to flat play and normal
exit with zero GPU errors. TypeScript checks pass. The complete fast suite
passes 838 tests on Windows (37 environment skips) and 860 on Linux (15 skips).
GPU readback verifies both presentation paths, per-eye rotation, asymmetric
optics and reuse without another image import. Radio/camera C tests pass.

On the RTX 3050 Laptop with actual game rendering and simulated 120 Hz XR,
the 1280 x 1440-per-eye driving sample rose from 94.3 to 115.6 completed
frames/s (112.6 fresh stereo imports/s). A separate fresh-start driving sample
at 2016 x 2208 per eye measured 119.4 completed frames/s and 112.0 fresh stereo
imports/s, reaching 34.8 m/s. Each sample lasts ten seconds after warm-up;
these are not sustained race benchmarks. Callback CPU time was about 0.2 ms
at the median. The samples exclude physical-headset composition/streaming and
do not establish sustained 120 FPS on an RTX 4060 Ti with Virtual Desktop/VDXR.

Scenery visibility (13 November 2026): the retail camera setup derives an
angular detail scale at eView +0x0c as 256 / tan(FOV / 2). The world selector
uses it with each object's radius for LOD and omission thresholds. Feeding
the wide tracking/culling lens into that calculation reduced the main scale
to 183.1 and the rear capture to 77.7 in the airport fixture. The primary
world-list setup retains at least the original driving camera's detail scale
(about 355.5 while moving in that fixture), independently of XR's optics.
Per-frame ownership restores the game's scales after presentation and leaves
other players' views, menus, photo mode and inactive VR alone.

The cockpit rear capture uses the main view's 15 km far plane. Its world
context removes the tiny retail HUD mirror's low-reflection-model and scenery
omission flags, while retaining frustum tests and ordinary object LOD. Local
body/interior exclusion and independent mirror trim remain unchanged. The
existing world-list hook applies this before object selection; there are no
new lifted hooks or changes to streaming budgets, physics or saves.
Addresses/flag meaning were checked against the PC executable; the reflection
LOD locations are also documented by
[NFS HD Reflections](https://github.com/AeroWidescreen/NFSHDReflections/blob/main/SOURCE/NFSU2/dllmain.cpp).

Camera sanitizer tests cover distant-object thresholds, malformed context
counts, untouched other views, repeated setup, restoration and inactive VR.
Actual-game before/after rear captures show restored trees, lamps and street
detail. Both runs complete head rotation, original-camera capture, return to
flat play and normal exit with zero GPU errors. A ten-second driving sample at
2016 x 2208 per eye, real rendering on the RTX 3050 Laptop with simulated
120 Hz XR, measured 114.6 completed frames/s and 114.1 fresh stereo imports/s.
The preceding sample measured 106.3/101.2; run variance means this is not a
speed-up claim. More scenery increases rendering work. Physical-headset
acceptance and visibility through every original streaming boundary remain
separate from this controlled airport check.

Headset settings navigation (13 November 2026): the VR and Mods lists show a
persistent right-hand scrollbar whenever there is more than one page. The
thumb reflects the visible rows' fraction and position in the complete list;
arrows brighten when more entries are available in that direction. Row labels
and values reserve space for it. The existing stick navigation and row counter
remain available. Canvas previews cover the start, middle and end in German,
English and Japanese, including the shorter final page.

Local media folder access (13 November 2026): the existing IndexedDB directory
handle is reused on each visit. A granted read permission restores the playlist
without a prompt. Otherwise the media panel offers Allow folder access, calling
requestPermission directly from that click. Denial retains the handle, without
opening another picker; Choose media folder remains available for replacement.
A late startup scan cannot overwrite a new choice. The folder name, handles and
files stay local and are not part of cloud settings. Browsers limited to a file
input, or unable to store the handle, explain that selection is needed next time.
Browser permission lifetime and clearing site data still apply. Reload tests use
real IndexedDB and directory handles with controlled permission responses;
physical OS permission dialogs remain a browser-controlled step.

Quest startup (14 November 2026): a physical Quest 3 running Browser 156 stayed
at frame 11 with XR visibility `visible`, `document.hasFocus() === false` and
the original game marked inactive. Input focus now follows the XR session from
adoption through visibility changes and end, independently of window focus.
Covered/hidden sessions deactivate immediately, even without another XR frame;
ending XR restores the ordinary window rules. Lifecycle checks cover startup
attachment order, desktop blur/visibility events, system menus and teardown.

The same browser identifies as Linux x86_64 with a fine pointer, despite running
on the standalone ARM headset. OculusBrowser identification selects mobile
defaults (16 remote cars, no default HQ vinyls, anisotropy or FSAA) and excludes
the desktop heap extension. Desktop browsers driving PCVR retain PC defaults.

The published build was retested on the physical Quest: startup passed the
intros and profile selection into GarageMain and Quick Race menus, with the
window still unfocused, XR visible and the game active. Initial WASM memory
was 1 GiB instead of 2 GiB; no GPU validation errors were reported. The player
confirmed that the game starts. This verifies startup, not a standalone racing
frame-rate target. Desktop real-game checks also cover covered/hidden XR,
resuming, exit to an unfocused window and restoration of ordinary focus.

Headset pixel readout (14 November 2026): the website's resolution row shows
actual per-eye render targets from the active XR viewports, after the renderer's
GPU dimension cap. It records the layer's creation scale, not a future setting.
The last measurement persists locally outside cloud profiles. Other percentage
choices show estimates based on that session's viewport and GPU cap; runtime
rounding/caps or a different headset can change the next measurement. No pixel
size is invented before the first VR session. Measurements are published only
when their dimensions change, and ending VR labels the result as historical.


VR scene resolution (14 November 2026): Quest 3 measurements showed 1680x1760
per eye at 100% and a capped 2520x2640 at a requested 200%. The game also copied
its scene through full-screen post-effect textures at the window's 1280x586.
XR output layers now request at most 100%; larger selected scales rasterize
independently, then resolve into the supported output layer. Scales below 100%
still reduce both the scene and the output. Pixel measurements record the
output layer scale separately from the actual scene scale, including GPU caps.
Full-screen render targets reached by copies from the screen or dependent
effect draws have cached eye-sized variants. Smaller bloom targets, reflections
and ordinary desktop rendering retain their original sizes. Variants are keyed
by texture lifetime and size, with at most two sizes per original, reused by
both eyes and across the desktop spectator. GPU tests preserve one-pixel stripes
through a screen-copy/effect/composite chain and verify the desktop return.

Media playback and radio contact (14 November 2026): a folder containing videos
uses the browser playlist for both video and audio. A remembered game-radio
switch cannot filter its videos out; audio-only folders retain the PCM radio
option. Playback reserves the music source before reading the next file, and
stale ended events cannot advance a newly selected track. A selected video
shows loading or playback failure on the cockpit screen instead of a spectrum;
EA TRAX-only mode does not display an old paused video.

The screen's transport buttons are individual circles with 112 px touch targets,
about 25 mm on the default 230 mm-wide display. The page button has a larger
88 px circle inset from the edge; the other circles are 72 px wide. Both sliders
have 16 px rails, 48 px knobs and 80 px tall touch areas. Volume spans 224 px.
Video fits the full 1024 x 640 screen with its aspect ratio preserved and keeps
that size while controls appear or fade. The buttons, time, progress and volume overlay the video;
telemetry and the visualizer reserve space for the same controls. Sliders and
buttons share their drawing and hit coordinates.
On video, the buttons, time and sliders fade out after three seconds without
pointing or interaction. A fingertip within 9.5 cm of the display reveals them again; controller rays
and triggers do not highlight, reveal or activate media controls. Mouse hover also reveals them; active drags keep them visible. A new video starts
with visible controls, and telemetry and audio keep theirs visible throughout.
Fingertip contact takes priority over acquiring a panel grip, including angled
wrists whose palms overlap the video area. A poke behind or sideways off the
display retains its touch latch until withdrawal in front, preventing a second
track skip; pedal trigger changes never affect that latch. Browser tests decode MP4
and WebM into the actual cockpit canvas and cover mixed folders, natural endings
and stale events; simulated hand tests cover both sides and angled contact.
Physical-headset acceptance remains separate from these automated checks.

Controller and session regression (15 November 2026):
`web/tools/vr-session-check.mjs` enters and exits a real career drive three times
with simulated XR sessions. Every entry restores the cockpit; recentering and
temporary pose loss retain a deliberately selected exterior view. A right-stick
down deflection opens career status without shifting, and B returns to driving.
The real gearbox/haptics check also passes X upshift, Y tap downshift, engine
feedback, collision feedback and master stop. Both runs exit normally with zero
GPU errors. Motor feel still requires a controller check.
