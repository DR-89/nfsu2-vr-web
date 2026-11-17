# nfsu2-vr-web: the server bundle

This folder runs the game's web server on a Linux VPS, with HTTPS in front, so
friends can play with you in Chrome, without Docker.

It holds the server, the page, the game module and license notices. **It does not hold the game.**
You copy your own NFS Underground 2 folder to the VPS yourself.

1. **Nothing to install first.** The server is one static binary, `nfsu2-server`, for
   the VPS's processor: the bundle's name ends in amd64 (Intel, AMD) or arm64.
2. **The bundle.**
   `sudo mkdir -p /opt && sudo tar -C /opt -xzf nfsu2-vr-web-<rev>-<content>-<arch>.tar.gz`
   This gives `/opt/nfsu2-vr-web`. `bundle.json` records a SHA-256 digest for
   every shipped file; the archive name includes the content digest.
3. **The game folder.** This is the one with `SPEED2.EXE`. From your own computer, inside that folder, copy
   only the game's own files (the server serves nothing else), then make them readable on the VPS:
   `rsync -rlt SPEED2.EXE server.dll server.cfg CARS CREDITS FRONTEND GLOBAL LANGUAGES memcard MOVIES NIS pfdata SOUND speech SUBTITLES TRACKS root@<vps>:/srv/nfsu2/game/`
   `ssh root@<vps> chmod -R u=rwX,go=rX /srv/nfsu2/game`
   The other languages' voices and movies, if you built them (`LANGPACKS`), the same
   way: `rsync -rlt LANGPACKS root@<vps>:/srv/nfsu2/game/`, then the `chmod` again.
   Before you copy any packs (`LANGPACKS`, `VINYLPACKS`, `MODPACKS`, `TEXPACKS`), check them as the game reads
   them, from the repository: `python3 tools/packcheck.py "<your game folder>"`. It names each file that is wrong
   and exits with 1; copy them only when it says `all good`.
4. **TLS**, in one of these ways:
   - Caddy in front: `deploy/Caddyfile`. Simplest: a Let's Encrypt certificate,
     renewed by Caddy.
   - The server itself on port 443 with a certificate: `deploy/nfsu2-vr-web.service`,
     variant B.
   - A Cloudflare Tunnel: `deploy/cloudflared.yml`, and the service's variant D.
5. **The service.**
   `sudo cp /opt/nfsu2-vr-web/deploy/nfsu2-vr-web.service /etc/systemd/system/`
   Pick its `ExecStart` line (A, D or B) and put your name in `--host`, then run:
   `sudo systemctl daemon-reload && sudo systemctl enable --now nfsu2-vr-web`
   Its log: `journalctl -u nfsu2-vr-web -f`.
6. **Play.** Open `https://<your name>/` in Chrome.

**Who can play:** the server has no accounts or passwords. Anyone who can reach
it can play, and can download the game files from it. Your firewall decides who
that is. Behind Cloudflare's proxy, let only Cloudflare's addresses reach 80 and
443, and turn on Authenticated Origin Pulls (SSL/TLS, Origin Server): any
Cloudflare customer connects from those addresses too, so Caddy (its Cloudflare
variant, with `deploy/cloudflare-origin-pull-ca.pem`) or the server (variant B
with `--trusted-proxies cloudflare`) asks them for Cloudflare's certificate.

**SSH:** log in with a key only.

For Docker, build this fork from the repository with
`docker build -f web/server-rs/Dockerfile -t nfsu2-vr-web:local .` and set
`NFSU2_IMAGE=nfsu2-vr-web:local` next to `compose.yml`. The image is required:
upstream images do not contain this port. `release.sh` requires `NFSU2_REPO`
to name your own published image repository. Its undo operation uses the saved
image reference. Keep `LICENSE` and `licenses/` with redistributed builds.

The start page's optional Windows PCVR vibration download is built on Windows:
run `tools/pcvr-haptics/build.ps1` with OpenXR headers, then `package.ps1 -Url`
with this deployment's HTTPS origin. Copy the resulting
`out/pcvr-haptics/nfsu2-vr-haptics-windows.zip` into `web/dist` before packing the
release. Its installer accepts only that origin. Include the ZIP in bundle.json;
it contains the helper binaries, installation/removal scripts, source and license.
See [the helper's instructions](../../tools/pcvr-haptics/README.md).
