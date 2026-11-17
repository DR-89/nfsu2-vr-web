# Browser controller vibration on Windows

The game, graphics and controls stay in the browser. This optional Windows x64
helper carries the existing engine/load, road impacts, shifting and touch
vibrations to PCVR controllers. Quest Browser uses its own motors directly and
does not need this helper.

## Install once, then open the normal website

1. Download the ZIP from **Controller vibration on PC** beside the website's
   VR start button. Extract the entire ZIP and double-click **Install.cmd**.
   Installation is for your Windows account; administrator access is not needed.
2. Close Chrome or Edge completely once, including background browser processes,
   then reopen the website in your usual browser profile. Setup does not close
   your browser, move saves or create another profile.
3. Click **Connect vibration** on the website and allow its local connection
   when the browser asks. Start Virtual Desktop/your PCVR connection and use
   **Start in VR** as usual. Keep VR vibration enabled in the game's settings.

On subsequent visits, just open the website. The helper starts quietly when you
sign in to Windows; no game launcher is required. Each browser profile needs its
own one-time website connection permission. Installation itself does not grant
browser permissions. The game remains playable if the helper is absent.

The website shows whether the helper is reachable and whether a focused VR
session has attached the vibration action. “Ready” confirms the software
connection, not that someone has felt the controller motors. Test engine revs
with a hand near the wheel/shifter, bumps, gear changes and touches in the car.
If the helper is connected but VR never becomes ready, restart the entire
browser, check the headset connection and keep the game focused in VR. If local
access was denied, change this website's local network permission in the browser
site settings, then reconnect. The helper accepts only the website in site.json.

To stop automatic connections in a browser, click **Disconnect** on the website.
To remove the Windows integration, run **Uninstall.cmd** from the extracted ZIP
or `%LOCALAPPDATA%\NFSU2VR\WebHaptics`. It stops the helper and removes its startup
entry and layer registration. Restart the browser; the remaining installation
folder can then be deleted. Browser profiles, game saves and the selected OpenXR
runtime are untouched. To update, close Chrome/Edge and run the new Install.cmd.

## What is installed

- `%LOCALAPPDATA%\NFSU2VR\WebHaptics`: helper, output DLL, scripts and manifest.
- HKCU `Software\Microsoft\Windows\CurrentVersion\Run`, entry
  `NFSU2VR Web Haptics`: hidden background startup at Windows sign-in.
- HKCU `SOFTWARE\Khronos\OpenXR\1\ApiLayers\Implicit`, entry pointing to
  `implicit-layer.json`: enables the output layer for this Windows user.

The DLL passes non-Chrome/Edge applications through unchanged. In browser XR
processes it adds an output action set alongside the browser's original input
actions. It does not switch the OpenXR runtime; Virtual Desktop remains usable.
The default runtime and other users' registrations are never modified.

Chrome's normal VR process uses a Windows AppContainer. Setup grants only the
browser's XR AppContainer identities read/execute access to the helper folder
and read access to the per-user implicit-layer key. Only `channel.bin`, the
4096-byte vibration mailbox, has read/write access and a low integrity label.
The DLL resolves this file beside itself; sandbox-redirected LocalAppData and
named-object namespaces are not used for automatic mode. No browser sandbox
switches or global permission changes are needed. `xr-access.json` records the
registry access rules owned by the installer for removal during uninstall.

The helper listens only on `127.0.0.1:28765`. Only the exact configured HTTPS
origin can discover a fresh random capability via a CORS-protected request with
a custom header. Pulses and status require that capability, sent in a header.
The page stores only the automatic-connection preference, not the capability.
It reconnects after a helper restart. There is no telemetry or remote listener.
Browser protections remain enabled. Each motor request is bounded to 100 ms;
the layer rejects expired packets and stops output when VR loses focus.
Status reports whether a live browser process loaded the layer, bound output
paths, received packets and successful/rejected runtime output calls. A reachable
HTTP helper alone is not reported as a working VR connection. Older helper
versions and browsers still using an old background VR process get explicit
update/restart instructions on the page.

## Build and verify

Requires Windows x64, Visual Studio C++ tools, CMake and OpenXR SDK headers:

```powershell
./tools/pcvr-haptics/build.ps1 -OpenXRHeaders C:/path/to/OpenXR-SDK/include
./tools/pcvr-haptics/package.ps1 -Url https://your-game.example/
node tools/pcvr-haptics/test-http.mjs
```

Serve `out/pcvr-haptics/nfsu2-vr-haptics-windows.zip` at the website's download
URL. The ZIP includes source code, license and SHA-256 checksums. No game assets
are included. The binaries are not code-signed; Windows may identify the
publisher as unknown. Do not change Windows or browser security settings to
install them.

CTest exercises the DLL with a fake OpenXR dispatch chain: preserved input,
separate hands, short clicks, expiry, focus loss, ownership and shutdown.
The HTTP test uses actual Chrome HTTPS/CORS, origin/token rejection and malformed
commands. After installation, set HAPTICS_TEST_URL to the website and run
`node tools/pcvr-haptics/test-http.mjs --automatic --xr` to check normal Chrome
discovery without launcher environment variables. `--xr` needs a working local
OpenXR runtime; it does not request a headset session or prove physical output.
Browser integration checks explicitly enable Chromium's sandbox. Playwright's
unsandboxed default cannot validate the player's ordinary browser configuration.

The developer-only `start.ps1` and explicit `layer.json` remain available for
isolated diagnostics; they are not part of the installed player workflow.

Desktop Chromium's missing WebXR actuator path is visible in its
[XRInputSource implementation](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/xr/xr_input_source.h).
Per-user implicit registration follows the
[OpenXR loader](https://github.com/KhronosGroup/OpenXR-SDK-Source/blob/main/src/loader/manifest_file.cpp).
