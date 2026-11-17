# Changelog

What changed for players, newest first: the start page's Changelog button shows this file (web/build.mjs turns it
into /changelog.json).

Each day with a release gets one section, written when its module is built: `## <date> (<commit>)`, the commit being
the last one the day's releases bring, so the next section covers the commits after it. Source bundles from a working checkout omit the commit; their bundle.json records the shipped file hashes. A second release on the same
day adds its lines to that day's section and moves its commit on (web/build.mjs stops on a date twice). One line per
change, in plain text, as `- **Area:** what changed`, written for players: new things and noticeable improvements
first, then under `### Fixes` what was broken and works now, which the popup keeps folded. Left out: the server's
insides, the forum bot, logs, tests, docs and cheat checks. A change that may or may not belong here is asked about
before the release, not guessed.

## 2026-11-15

### Fixes

- **VR vibration:** engine vibration blends with bumps, collisions and gear changes. Both controllers receive engine feedback by default, including when steering with the thumbstick. Turn off Engine feedback near controls in an existing profile to use this behavior.
- **VR controls:** thumbsticks respond to short menu presses and world prompts. The right stick opens nearby interactions with up or right, career status with down, and messages with left.
- **VR camera:** leaving VR and entering it again returns to the cockpit during a race or free roam. Brief tracking interruptions keep the camera view you selected.

## 2026-11-14

- **Custom music:** local songs and cockpit videos play in random order by default, with every file played once before the next shuffle. Previous returns to the last played track.
- **PCVR vibration:** the start page offers a Windows helper with setup instructions and a connection status. After one-time setup it starts with Windows, so the normal website works in your usual Chrome or Edge profile without a separate game starter.
- **PCVR performance:** both eyes reuse more frame data, and Virtual Desktop presentation reuses its texture storage between frames.
- **VR shifting:** the active shifter zone defaults to a 10 cm radius. Saved custom radii are kept.
- **VR steering:** hands grip the wheel automatically when held near its rim and release when moved away. Require grip for steering restores holding the controller's grip button; the website and in-game VR setting saves with your profile.
- **Cockpit LEDs:** shift light cues are off by default. Enable Shift light cues in the website or in-game VR settings to show shifter-zone colours and gear-change flashes.
- **Headset resolution:** the website shows the measured render dimensions in pixels per eye. The last measurement stays on this device; changing the percentage previews an estimated size for the next VR start.

### Fixes

- **PCVR vibration:** the Windows helper can load inside Chrome and Edge's protected VR process, with a dedicated local data channel. The website distinguishes an installed helper from a loaded VR connection and flags older helper versions.
- **Cockpit rain:** removed camera droplets that covered the interior and hands. Rain outside the car and wet roads remain visible.
- **Cockpit videos:** local videos start without waiting for browser audio approval. Video-only folders no longer get blocked by a remembered music-only choice, and interrupted playback can resume.
- **Cockpit controls:** removed the pointer circle from the monitor. Fingertip and trigger input share one press; trigger jitter, sideways movement and tracking interruptions no longer cause a second click.

- **VR shifting:** holding the accelerator through a manual shift no longer loses throttle when the hand points across the cockpit screen. A held pedal cannot become a media click; release it before clicking the screen.

- **VR lights:** removed the accumulated light-streak effect that leaves floating or doubled light spots when moving your head. Current-frame lights and surface reflections remain; monitor play keeps its graphics setting.

- **VR image clarity:** full-screen graphics effects keep the eye render resolution instead of reducing the world to the browser window size. Values above 100% supersample the scene even when the headset browser caps its output layer.

- **Quest browser:** a visible VR session keeps the game active even when the browser window loses focus, fixing a stall at the startup loading screen. Opening the headset system menu pauses the game; returning resumes it. Standalone Quest uses mobile memory and graphics defaults instead of desktop allocations.

## 2026-11-13

- **Local music and videos:** the remembered media folder reopens automatically when access is allowed. If the browser needs permission again, use Allow folder access without choosing the folder again. Files stay on your device; browsers that cannot keep the folder show a notice.
- **VR settings:** a visible scrollbar shows your position and how much of the settings list remains, with arrows indicating more options above or below.
- **Cockpit media:** volume, a seek bar and elapsed/total time are on the screen, usable with the mouse, controller ray or fingertip. Seeking supports local videos and music, including custom game-radio tracks. The duplicate controls below the screen are removed.
- **PCVR responsiveness:** game frames can render between headset callbacks. Cached eye images follow new head rotations, and the separate desktop spectator updates at 30 Hz to leave more time for the headset.
- **PCVR performance:** less rendering work and fewer graphics transfers for the two eyes, without reducing the selected resolution. The monitor view reuses an eye image while VR is active, and matching reflections are calculated once for both eyes.
- **VR frame rate:** Auto follows 72, 80 and 90 Hz headsets as well as 120 Hz. Selecting 120 FPS also requests 120 Hz from supported headsets; an existing 120 Hz headset setting is preserved.

### Fixes

- **VR scenery:** the wider headset lens no longer shortens scenery detail distances. Cockpit mirrors retain distant scenery and show world objects omitted by the original small rear-view display.
- **VR crash camera:** crashes and jumps remain in 3D with their original camera framing; returning to driving restores the chosen cockpit view.
- **VR:** missed headset frames no longer lower the game's automatic target frame rate.
- **Cockpit:** cabin, steering wheel and gloves use the Xbox VR mod's darker material and lighting. LED strips and screens remain illuminated.
- **Hands:** free and shifter hands use the Xbox VR mod's controller orientation, including pointing and the hands other players see.

## 2026-11-10

- **nfsu2-vr-web:** a dedicated VR start button, with monitor play still available in the same game.
- **Cockpit:** fitted interiors inside the original car body, tracked hands, working instruments, adjustable mirrors and a movable minimap.
- **Controls:** grabbable steering with a deadzone, H-pattern and reversible sequential shifting, optional wrist gestures and engine/shift haptics.
- **Media:** choose a local music/video folder; switch between media and live telemetry directly in the cockpit. Move, rotate, resize and fade the screen.
- **Interior lights:** selectable LED colours, music pulse, shifter-zone feedback and red/blue shift flashes, with a cockpit colour button.
- **Multiplayer:** visible cockpits, helmet heads and hands in free roam, LAN and Online races; both local co-op seats have separate driver poses.
- **Settings:** shared website and controller menus, saved VR preferences in cloud profiles, and in-cockpit race and connection selection.

### Fixes

- **Cockpit screen:** a screen moved in front of the steering wheel stays in front, with correct depth and opacity.

- **Mirrors:** removed interior self-reflections; mirrors show the road and traffic. Adjusting the centre mirror no longer moves the side-mirror capture.

- **Multiplayer:** each split-screen view uses its own camera; a shared driver replaces the original flat driver model only while its head is visible.
- **VR:** original bodywork stays around the cockpit, and both CPU and GPU rendering paths receive the correct stereo transform.
- **Mirrors:** depth edges no longer create scattered fragments and false surfaces in the reflected view.

## 2026-11-08 (314555b)

- **Free roam:** your own license plate (up to 8 letters and digits, Settings, Online), seen by everyone in free roam.
- **Mods:** Stance, Archie (AR4I)'s mod: each car's camber, wheel offset and tire width in the Body Shop (off by default).
- **Lobby races:** the Corolla has a little less power in circuit, sprint and URL races.
- **Mods:** Crash Damage, Chrystian Farias's Crashing Foreign Cars: dents, scratches and lost parts, looks only (off by default).
- **Mods:** HQ Vinyls & Doorlines, AdrienShadow's mod: sharper vinyls on a computer (off by default).
- **Graphics:** anti-aliasing for smoother edges, on for new players on a computer.
- **Mods:** Rubberbanding, by 007hacky007: the career races' catch-up as original, No boost or Off.
- **Free roam:** Join in Friends takes you right behind your friend's car.
- **Free roam:** Tracks in F9: drive the race tracks with other players.
- **Races:** other players' cars sound with their own engines.
- **Mods:** Transmission Whine, ropi's mod: NFS Carbon's gearbox whine (off by default).
- **Graphics:** sharper roads and buildings at an angle on a computer.
- **Minimap:** hides other players when the world map's legend does.
- **Start page:** with free roam on, it says to play the career to meet others.

### Fixes

- **Free roam:** error 134 at a race's results or in a busy free roam.
- **Free-roam races:** the host's Restart works every time, and slow players are no longer sent to the main menu between heats.
- **Dyno:** setups are kept with autosave off.
- **Cameras:** your view comes back after a drift race.
- **Saves:** a modded game's profile loads, its extra cars shown as stock cars.
- **Free-roam races:** the crib's menu no longer covers a career win's movie.
- **Free roam:** nitrous purges keep their kit's colour at car meets.
- **Free roam:** exhaust tips keep their own colour.
- **Controllers:** a touch pad no longer keeps the view turned.
- **Saves:** Art Factory 28 to 34 vinyls are kept beside your profile.

## 2026-11-07 (b58448b)

- **Free roam:** pick a world in F9 or on the start page, with each one's player count: the main world with everyone, World 1 to 4, or your own by name. Ghost mode stays off in World 4.
- **Page menu:** Controls open inside the F9 menu, as Crews and Friends.
- **iPhone:** performance and stability improvements.
- **Free roam:** when other players can't be reached, the game says why: a blocked connection, one that keeps dropping, or too many players on your network.

### Fixes

- **Free roam:** a "memory access out of bounds" crash as other players' cars with Art Factory vinyls came in is fixed.
- **Free roam:** other players' engines show under an open hood.
- **Controllers:** the Xbox One S pad with its 2016 firmware works in Chrome on Android.
- **Car Specialties:** Stock gauges can be picked again, and the gauge list opens on the ones fitted.
- **Car Specialties:** leaving Trunk Audio keeps your place in the list.

## 2026-11-06 (b3be4d1)

- **Mods:** GPS Distance: the distance to your destination under the GPS arrow, in your Speedometer Units (off by default).
- **Friends:** in the page menu (F9) in free roam: requests, your friends and Add a player by name. Requests from afar show at the top (F accepts).
- **Friends:** a list holds 250 friends; the start page shows them in pages, with a filter.
- **Crews:** invite a friend in free roam to one of your crews from Friends; they press Z to join. The Crews box says how to start one.
- **Page menu:** F9 is a short list showing each setting's state. Quit game warns when you haven't saved in 10 minutes.
- **Page menu:** Crews and Friends open inside the F9 menu instead of a box over it; Esc or B goes back.
- **Free roam:** the notes over the game share one look; invites and friend requests have a lime border.
- **Free roam:** new players with Ghost mode off are told where to turn it on.
- **Start page:** a lime dot on Friends & crews when requests or messages wait.
- **Loading screens:** nfsu2.xyz in the corner.

### Fixes

- **iPhone and iPad:** no more one-second freeze every 10 to 20 seconds in a busy free roam.
- **Garage:** Split Screen no longer locks career slots 6 to 10 and loses their cars.
- **Vinyls:** Special shows Street Reaper, Japan Tuning, David Choe, Snoop Dogg and The Doors only on the cars they were made for.
- **Controllers:** Xbox Bluetooth triggers drive and brake in Firefox on a Mac.
- **Phones:** POCO M7 Pro and other PowerVR B-Series phones start in the window, where they don't crash.
- **Career:** no more error 134 after trading a car when the career car was missing.
- **Races:** the lobby speedometer counts how the race evens out the engines, so an upgraded car no longer reads deep in the red.
- **Races:** joining a race after using Options or Car Select in the Online menu no longer hangs for 3 minutes.
- **Photo mode:** the camera no longer spins on its own; Reset stops Auto-turn.
- **iPhone:** turning the car with two fingers in the garage works again.
- **Free roam:** Enter at a shop, race or cover shoot no longer stops working until a reload.
- **Keyboard:** Alt, Shift and Ctrl work in Firefox with privacy protection on.
- **Keyboard:** AltGr on German, French, Turkish and other layouts no longer shifts down with the nitrous.
- **Controls:** Site keys can use the debug camera's keys, and keys whose game control you moved.
- **Controls:** picking Xbox or PlayStation button names no longer changes the Controller setting.
- **Controllers:** the Zikway HID gamepad's buttons work right.
- **Free roam:** other players' cars make tyre smoke again.

## 2026-11-05 (0e56c9b)

- **Races:** several lobbies can wait at one start: E shows the next, B opens your own beside them, and the card starts on one a friend or crew-mate is in. Hosts can invite friends (Z), who join from wherever they are. Lobbies you can't join no longer show on the map or at the start.
- **Races:** lobbies keep out players past the host's stage unless the host lets everyone in (V); friends and crew can always join. A cleaner lobby card with a speedometer of the fastest car against yours, and its keys on a controller's D-pad.
- **Free roam:** the box at the top left shows only when it says something: a new message, at a race, shop or outrun, and for a moment at the start and after a menu.
- **Touch controls:** Reset shows only when the car is slow, and Pressurize and Bounce only when they can be used; the other buttons stay where they are.
- **Vinyls:** Art Factory 28 to 34, Sha_Do's designs that only the Japanese release had, on every car after Art Factory 27.
- **Languages:** Czech, Slovak and Greek, the game and the start page.
- **Music:** scrobble the songs you hear, EA Trax and the Radio, to Last.fm: Settings, Game.
- **Controllers:** the Steam Controller (the 2015 and the 2026 one) and a Steam Deck's controls work without Steam in Chrome and Edge: Controls, Controller, Connect a Steam Controller.
- **Start page:** a Mods tab: every mod in the game with its makers, its switch where it has one, and an (i) for what it does. The Other tab's settings are now at the end of Game.
- **Mods:** thelink2012's Visual Reputation Remover: the career's visual rating comes from the stage, not your car's parts, and the shops have no Visual Rating box. Off by default, in Mods.
- **Free roam:** a second player on the same computer joins your career's free roam, the screen split in two: pause, Add Player 2, then START on a controller or the keyboard's left half, and a car from your garage. Online they show as your name and " 2".
- **Free roam:** with player 2 in, a career race asks Together or Alone (only player 1's place counts), and the two of you can outrun each other.
- **Free roam:** at a busy car meet the cars around you stay shown, and on a slow connection they show up sooner.
- **Free roam:** the cars of the players nearest you stay shown instead of coming and going, and friends' cars load faster.
- **Photo mode:** the panel in tabs: Camera, Picture, Scene and Controls. The camera can glide, turn by itself, keep its height and play through up to 8 points for clips. Shutter blurs what moves, Fisheye bends the picture, and pictures can be up to 4 times as big. Scene picks which cars show (yours, friends, crews, players, traffic, racers), their headlights, and dry or rain.
- **Free roam:** with others is on from the start, without the question at the first Play.
- **Free roam:** Players' cars shown starts on Auto on a computer: 32, then 48 or 64 while the game has frames to spare.
- **Free roam:** O (D-pad down held) opens the hood, then the trunk, then the doors, one at a time.
- **Free roam:** F10 hides the HUD and the names over cars; Controls, Site has it and a Free look row to turn stick looking off.
- **Free roam:** the Bank shows only for a while after it changes.
- **Horns:** six more: Dixie, an old car, a broken horn, The Car (1977) and a sputtering one, and every horn as loud as the next.
- **Quick chat:** I need NOS! and ten film quotes in a new Quotes category.
- **Options:** Show Player Names in Gameplay hides the names over other players' cars.
- **Settings:** Music in drag and drift races, off as in the original.
- **Friends:** add your Discord username in Friends & crews; only friends see it and can copy it.
- **Saves:** screenshots first, the newest one big; profiles can be deleted, and the time you have played shows.
- **Screenshots:** Delete all.
- **Menus, HUD and maps:** Map only, the Detailed Map without the Upscaled HUD.
- **Your flag:** Quebec.
- **Bans:** a ban shows its number, name and date; someone on a banned player's network or VPN can still play, only not race.
- **Firefox:** the game's extra memory on a computer, as in the other browsers.
- **Names:** with a claimed name you always play as it, whatever Your name says, so friends find you by it.

### Fixes

- **Races:** other players' cars no longer bounce, stand on their tails or flip over.
- **Ghost mode:** near misses with traffic on Everything give nitrous again.
- **Menus:** the cars' paint and chrome reflect the studio's walls and lights, as on the PC, instead of black.
- **Free roam:** an error 134 crash with country flags shown after a shop or race is fixed.
- **Quick chat:** on a controller, saying a phrase no longer switches the headlights or turns the view.

## 2026-11-04 (af448e5)

- **Races:** other players' cars come straight from their games every frame; close ones drive on the game's physics and bump back.
- **Headlights:** G turns them off or on, hold it for high beam; other players see them.
- **Free roam:** a country flag before your name: pick yours on the start page, in Online, Your flag.
- **Free roam:** up to 64 players' cars shown: Online, Players' cars shown.
- **Quick Race:** up to 127 laps and 5 opponents.
- **Split screen:** two players on one keyboard, on the arrows and WASD.
- **Camera:** the drift races' camera in every drive (C).
- **Vinyls:** the game's hidden Special vinyls.
- **Controls:** this site's keys and buttons are set in Controls, Site.
- **Saves:** Play without saving where the browser's storage stops answering.
- **iPhone:** sound in Silent mode.
- **Start page:** plainer error messages.

### Fixes

- **Free roam:** your car keeps its brakes, exhaust tips and spoiler after a shop.
- **Free roam:** a car reset past the career's red walls goes back on its roads.
- **Ghost mode:** the camera no longer hops over traffic on Everything.
- **Horns:** follow the game's Master Volume.
- **Free roam:** fewer error 134 crashes in a crowded free roam; on a computer the game has more memory for it.
- **Firefox:** the game no longer stops with a graphics error a few seconds after Play.

## 2026-11-03 (a5892ba)

- **Split screen:** 2 to 4 players on one screen, each with their own controller: Split Screen in the main menu, after Quick Race. A port of mihaits' NFSU2-SplitScreen mod by BirdSentinel (Zack).
- **Free roam:** lobby races count in your career, as Solo races do: win a race of your stage you haven't won yet, or finish one a friend or crew-mate wins. A star in the lobby shows whom a race counts for.
- **Free roam:** a lobby warns you when its stage's cars are usually much faster than yours, and quitting a race costs more at stages 4 and 5.
- **Free roam:** races start for everyone at once, about 10 seconds after the host's Enter (was 20 to 30), and no longer get stuck at the start for the host.
- **Free roam:** at a race's marker, Join is picked where a lobby waits, and no second lobby opens beside one that isn't full.
- **Free roam:** no outrun offers in a crowd (4 or more players within 25 m), and Ghost mode on Everything covers outruns too.
- **Free roam:** drift battles: with drift mode on, challenge a player as for an outrun. The most drift points in 90 seconds wins $100 from the other.
- **Drift mode:** on a controller, hold D-pad down a second while driving. The car no longer slides more after drift mode is off.
- **Races:** other players' cars in Online, LAN and free-roam races keep to their line and point the right way, your game no longer speeds up and slows down to follow the host, and a car whose connection stalls drives on instead of stopping and jumping.
- **World map:** shows up to 4096 players (2048 on phones), and a car meet takes 20 parked players (was 24).
- **Maps:** Upscaled (Settings, Game, Display) also shows JeansBig's Detailed Map: the minimap and world map sharp at high resolutions, with the missing shortcuts.
- **Quick chat:** a Countdown phrase: 5, 4, 3, 2, 1, GO! on screen for everyone within 50 m.
- **Music:** Settings, Game, Songs: Original plays the EA Trax songs as the game shipped them, in place of the uncensored ones, and F7 skips to the next song.
- **Controllers:** the right stick looks around the car while driving (straight down looks back), and a click of it opens quick chat. If you steer or brake with the right stick in the game's controls, the left stick looks around instead.
- **Steering wheels:** Fanatec bases get their own layouts, and separate USB pedals of any make work with a wheel.
- **Photo mode:** the camera reaches twice as far.
- **Phones:** Android phones whose graphics driver can't show the game now say so, instead of asking to press Play again.
- **Start page:** Safari before 26 is told to update, and the page says when an antivirus or network blocks the game.

### Fixes

- **Free roam:** a game file that won't open no longer stops friends' cars loading or hangs the way to the garage.
- **Free roam:** among many players, a car closing its trunk, hood or doors no longer freezes the game or stops it with error 134.
- **Free roam:** friends' cars no longer run wide in bends.
- **Free roam:** a hit that throws a car impossibly far is undone.
- **Free roam:** an open trunk shows its speakers and amps.
- **Online:** Personal Stats show your new rating right after a ranked race.
- **Graphics:** Enhanced Contrast no longer draws flickering lines along the screen's edges, and is as sharp as the original.

## 2026-11-02 (d4fa27f)

- **Free roam:** on a highway, the players shown are the ones on your road before the ones on the street below, and the other way round.
- **Free roam:** the weather is the same for everyone: it rains in the same places at the same time.
- **Free roam:** front bumpers count for Add friend at an angle too, up to 60 degrees off head-on.
- **Free roam:** Save in the pause menu (Esc), second from the left: standing still, the career is saved where you are, with no trip to the garage, and Resume Career starts you there.
- **World map:** spots where 24 or more players have been parked for a minute show as car meets. The legend's Car meets row picks one, and C starts the GPS there.
- **Free roam:** parked, press O (on a controller, hold D-pad down) to open the trunk, then the hood, then the doors, and show your car off. Other players see them open.
- **Photo mode:** cars keep their full detail however far away, and a still camera smooths the picture's edges. New in the panel: Blur and Focus (a real lens blur), Brightness, Vignette, filters, Crop with a Grid, which players' cars show, and Freeze time (on at first; off, the world drives on). Pictures have nfsu2.xyz in a corner; a box in the panel turns it off.
- **Career:** once you have beaten Caleb, the shops have the wide body kits, and the other unique hoods, spoilers, rims and vinyls, for every car in your career.
- **Languages:** Ukrainian, for the game (its text and subtitles) and this page. Turkish is translated anew, by hand, the online menus too.
- **Free roam:** up to 48 players' cars at once, each costing less of the frame rate. Players' cars shown (Settings, Online tab) starts at 32 on computers, 24 on tablets and 16 on phones.
- **Free roam:** Ghost mode (Settings, Online, and the page menu, F9) is Off, Players or Everything. Everything also lets traffic and the game's tuners drive through you, and driving through them is not a near miss.
- **Free roam:** names over cars no longer pile up in a crowd. Friends' and crews' come first, and names fade out between 25 and 60 m.
- **Minimap:** every player near you gets an arrow, not only those whose cars your game shows.
- **Quick chat:** works in races with other players too (free-roam race spots, the Online menu and LAN), and no longer needs free roam to be on.
- **Online races:** a ranked race counts when the others run out of time, and from 1 December Last Month's Leaderboard shows last month's leaders.
- **Touch controls:** a lighter look while driving, Pressurize and Bounce buttons for a car with hydraulics, gear buttons in Performance Tuning's drag test runs, and Steering moved in, for big phones.
- **Controllers:** the right stick turns the car in the garage and the shops. On Hotplug, a controller that switches off and on again keeps its buttons.
- **Saves:** when the browser deletes this site's data during a game, your saves come back (from cloud saves, or as they were when you pressed Play) and saving goes on. A restore or a cloud copy cut short never loses a profile, and each cloud-saves choice has its own button under its card.

### Fixes

- **Free roam:** a friend opening their trunk, hood or doors no longer crashes the game (error 134) in the next garage, car lot, cover shoot or race lobby.
- **Free roam:** a car that went missing (only the HUD drawn, an empty minimap) is put back where it last was, and a profile saved that way loads again.
- **Free roam:** an outrun between two players no longer ends when a crowd comes between you.
- **Radio:** the end of a track no longer stops the radio or crashes the game.
- **Phones:** Play after an earlier game no longer fails with "could not allocate memory" or "Out of memory".
- **Profiles:** in Chinese, Japanese, Korean, Thai, Polish and Hungarian a new profile's name no longer begins with broken letters.

## 2026-10-31 (d079aff)

- **Free roam:** touch front bumpers with another player for 3 seconds to add them as a friend, or add a claimed name on this page. Your friends are listed in this page's Friends & crews tab, with where they play and Join. Both of you need a claimed name.
- **Friends:** write to each other. In free roam press I (on a touch screen, tap the message or quick chat's Message a friend); on this page, the envelope next to a friend. A friend who is away gets it when they are back.
- **Free roam:** friends stand out: their names over their cars show at any distance, in pale lime, as do their arrows on the minimap and world map. When a friend comes into free roam a notice says so, and the page menu (F9) has Join.
- **Messages:** the offer to add a friend and the line's messages (a place freed up, the server full) show at the top of the screen, as the page's other messages do.
- **Touch controls:** Steering on the left or right, Nitro on the steering side, and a Career status button in free roam. Hold Steering to open the touch settings. No Quick chat button when quick chat is off.
- **Free roam:** the game's outrun challengers are grey on the minimap and the world map, so they no longer look like players.
- **Cloud saves:** offered sooner, and your browser can keep the passphrase with your passwords.
- **Names:** a claimed name stays yours as long as the passphrase does, instead of 180 days after your last game.
- **Profiles:** your first profile's name starts as the one under "Your name", so one Enter takes it.
- **This page:** a Changelog button at the top, tabs for the big panel and for About, and Playing now under Play. Edge, Brave, Opera and Safari no longer get "Only Chrome and Firefox are tested". Shorter texts, and "Changes from the original" is now at the top of About.

### Fixes

- **Frame rate:** slower PCs get back the frames they lost with the 29 October update.
- **Keys:** a key held while the game lost focus works again without pressing it again.

## 2026-10-30 (b1f5c1a)

- **Languages:** Hungarian, for the game and this page.
- **World map:** other players' markers glide to their new place.
- **This page:** says why the server can't be reached, instead of "Offline".

### Fixes

- **Free roam:** your car keeps its spoiler and exhaust tips after a shop.
- **Photo mode:** Tab and N switch back again. With names on, your own name shows too.
- **Wheels:** with a wheel connected, keyboard steering no longer turns to full lock at speed.
- **Menus:** on touch screens the help bar on Auto no longer covers the paint list or part names.
- **Trade Car:** says "80% of its cost" instead of "800f its cost".

## 2026-10-29 (dd32a0a)

- **Free roam:** invite links to a room or a crew, and rooms you can change while playing.
- **Free roam:** shorter Loading screens: friends' cars wait until the city has loaded.
- **World map:** up to 2048 players, moving while the map is open. The legend can hide players and their races.
- **Career:** a setting shows the hidden races on the map, as MaxHwoy's Show Hidden Races Mod.
- **Drift mode:** the drift races' handling and your car's Drift tuning, nitrous included.
- **Controllers:** less input lag with controllers and touch controls. RC radios drive as a wheel.
- **Photo mode:** the camera goes farther, and names show over friends' cars.
- **Touch controls:** fewer buttons, a Drift button, and the 4:3 HUD on phones.

### Fixes

- **Free roam:** the game's tuners challenge you to outruns again with other players around.
- **Cover shoots:** a failed save no longer garbles your profile's name.

## 2026-10-28 (b21bec2)

- **Career:** the garage keeps up to 10 cars, 2 more slots each stage, and Trade Car sells one for 80% of what it cost.
- **Display:** Exposure and White Level sliders, for a picture that is too bright.
- **Replays:** play to the end at 120 and 240 fps.
- **Online races:** other players' cars jump around less.
- **Names:** claim yours with your cloud saves' passphrase, so no one else plays under it and your EA Messenger friends and blocks stay yours.
- **Free roam:** a Blocked players list under More online settings.
- **Game data:** the world loads faster in Chrome and Firefox on Windows.

### Fixes

- **Radio:** your songs no longer play slow and low on PCs the game rates as slower.
- **This page:** long button labels wrap on phones, and nothing scrolls sideways.

## 2026-10-27 (5958562)

- **Quick chat:** 152 phrases; pick your sixteen under Settings, Online.
- **Cloud saves:** a lost upload no longer looks like a conflict. A real conflict shows both versions, asks, and keeps a copy.
- **Radio:** picks up where it left off, in the menus and while driving, and a Shuffle switch in the Playlist.
- **Pause menu:** Replay is back, with Photo Mode as its own item after it.
- **Languages:** Turkish for the radio and the newer texts on this page.

### Fixes

- **Photo mode:** the flash no longer leaves the screen white.
- **Sound:** a movie no longer repeats its last second while the game's window is in the background.
- **Phones:** Rumble off also stops the touch buttons' tick.

## 2026-10-26 (b0280a5)

- **Photo mode:** F12 freezes the world and frees the camera.
- **Free roam:** up to 32 players' cars shown; phones start at 16 and tablets at 24.
- **Cloud saves:** your fifth Play asks whether to turn them on.
- **Drag races:** the cars are evened out all the way.
- **Race lobbies:** a lobby closes when its host seems away for 2 minutes.
- **Phones:** lighter graphics to start with, and sound that no longer chops up.
- **Download log:** names and addresses are replaced, so the log is safe to post.

### Fixes

- **Free roam:** no more stutters once many friends' cars have come and gone.
- **Free roam:** friends' engines, nitrous and hydraulics follow your volume sliders.
- **Drift mode:** free roam's music plays on.
- **Menus:** spinners turn at the same speed at 120 and 240 fps.
- **Firefox:** no more black or half-drawn picture.
