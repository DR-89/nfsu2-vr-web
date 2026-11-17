#!/bin/bash
# Builds the bundle that runs the server on a VPS without Docker:
#
#   web/deploy/pack.sh [--out <dir>] [--no-build] [--data "<game folder>"] [--arch amd64|arm64] [--server <binary>]
#
# out/web/deploy/nfsu2-vr-web-<rev>-<content>-<arch>.tar.gz holds nfsu2-vr-web/ with
#   nfsu2-server      the server: one static binary for Linux on --arch (default amd64), built in Docker by
#                     web/server-rs/Dockerfile's binary stage (as the image's, cross-compiled: no emulation), or
#                     --server's (a Linux binary of your own, such as /app/nfsu2-server out of the image)
#   web/dist/         the page (the test pages and source maps are in web/dist-dev, never copied)
#   out/web/          the game module (nfsu2.wasm, nfsu2.json), built here with web/build.sh
#   deploy/           nfsu2-vr-web.service (systemd), Caddyfile (an example), cloudflared.yml (an example),
#                     cloudflare-origin-pull-ca.pem (for Caddy behind Cloudflare's proxy)
#   README.md         how to set it up
#   LICENSE, licenses/ copyright and third-party notices
# The server finds the page and the module in the folder NFSU2_REPO names (the unit sets /opt/nfsu2-vr-web).
# The bundle NEVER holds the game folder or anything from it: the files are copied from a
# fixed list, and the bundle is refused if any file in it has the name and size
# of a file in the game folder (--data, else $NFSU2_DATA, when it is there),
# carries the game's file names, or names this machine (host name, home folder).
# The archive's owner is root, its modes 644/755, without macOS metadata.
# --no-build: use web/dist as it is (default: rebuild it with node build.mjs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/out/web/deploy" BUILD=1 DATA="${NFSU2_DATA:-}" ARCH=amd64 SERVER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --data) DATA="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --server) SERVER="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "pack.sh: unknown option $1"; exit 2 ;;
  esac
done
case "$ARCH" in amd64|arm64) ;; *) echo "pack.sh: --arch amd64 or arm64, not $ARCH"; exit 2 ;; esac
[ -z "$DATA" ] && [ -d "$HOME/projects/nsfu2/Need for Speed - Underground 2" ] && DATA="$HOME/projects/nsfu2/Need for Speed - Underground 2"
cd "$ROOT"
REV="$(git rev-parse --short HEAD 2>/dev/null || printf source)"
if [ "$REV" != source ] && [ -n "$(git status --porcelain --untracked-files=normal -- runtime web tools docs)" ]; then REV="$REV+work"; fi
[ -f out/web/nfsu2.wasm ] && [ -f out/web/nfsu2.json ] || { echo "no game module: build it first (web/build.sh)"; exit 1; }
if [ "$BUILD" = 1 ]; then (cd web && node build.mjs >/dev/null 2>&1) || { echo "the page did not build (cd web && node build.mjs)"; exit 1; }; fi

mkdir -p "$OUT"
STAGE="$(mktemp -d "$OUT/stage.XXXXXXXX")"
trap 'rm -rf -- "$STAGE"' EXIT
mkdir -p "$STAGE/nfsu2-vr-web"
B="$STAGE/nfsu2-vr-web"
mkdir -p "$B/out/web" "$B/deploy"
# ---- the server ----
if [ -n "$SERVER" ]; then
  cp "$SERVER" "$B/nfsu2-server"
else
  command -v docker >/dev/null || { echo "no docker to build the server in: install it, or give one with --server"; exit 1; }
  echo "building the server for linux/$ARCH (docker build --target binary; the first build takes a few minutes)"
  docker build -q -f web/server-rs/Dockerfile --platform "linux/$ARCH" --target binary --output "type=local,dest=$STAGE/bin" . >/dev/null \
    || { echo "the server did not build (docker build -f web/server-rs/Dockerfile --target binary)"; exit 1; }
  mv "$STAGE/bin/nfsu2-server" "$B/nfsu2-server"; rm -rf "$STAGE/bin"
fi
# A bundle must run without the builder's libc and match the advertised CPU.
node -e '
  const b=require("fs").readFileSync(process.argv[1]),arch=process.argv[2];
  const fail=m=>{console.error("pack.sh: "+m);process.exit(1)};
  if(b.length<64||b.subarray(0,4).toString("hex")!=="7f454c46"||b[4]!==2||b[5]!==1)
    fail("the server must be a little-endian ELF64 executable");
  if(b.readUInt16LE(18)!==({amd64:62,arm64:183})[arch])fail("server architecture differs from --arch");
  if(![2,3].includes(b.readUInt16LE(16))||!b.readBigUInt64LE(24))fail("the server is not executable");
  const start=Number(b.readBigUInt64LE(32)),size=b.readUInt16LE(54),count=b.readUInt16LE(56);
  if(!Number.isSafeInteger(start)||!count||size<56||start+size*count>b.length)fail("invalid ELF program headers");
  for(let i=0;i<count;i++)if(b.readUInt32LE(start+i*size)===3)fail("the server needs a dynamic loader; supply a static musl build");
' "$B/nfsu2-server" "$ARCH"
# ---- the fixed list ----
# the page: everything web/dist has (node build.mjs puts the test pages and source maps in web/dist-dev;
# they are left out here too, should an older build have left them in web/dist)
(cd web/dist && find . -type f ! -path './test/*' ! -name '*.map' -print) | while read -r f; do
  mkdir -p "$B/web/dist/$(dirname "$f")"; cp "web/dist/$f" "$B/web/dist/$f"
done
cp out/web/nfsu2.wasm out/web/nfsu2.json "$B/out/web/"
cp web/deploy/nfsu2-vr-web.service web/deploy/Caddyfile web/deploy/cloudflared.yml "$B/deploy/"
cp web/server-rs/crates/headers/cloudflare-origin-pull-ca.pem "$B/deploy/"
cp web/deploy/README.md "$B/README.md"
cp LICENSE "$B/LICENSE"
cp -R licenses "$B/licenses"
# Record the actual files, including uncommitted port changes. A source commit
# alone cannot identify a bundle assembled from a working checkout.
CONTENT="$(node - "$B" "$REV" "$ARCH" <<'NODE'
const fs=require('fs'),path=require('path'),crypto=require('crypto'),root=process.argv[2];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),files={};
function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){
  const p=dir?dir+'/'+e.name:e.name;
  if(e.isDirectory())walk(p);else if(e.isFile())files[p]=sha(fs.readFileSync(path.join(root,p)));
}}
walk('');const digest=sha(JSON.stringify(files));
fs.writeFileSync(path.join(root,'bundle.json'),JSON.stringify({project:'nfsu2-vr-web',revision:process.argv[3],arch:process.argv[4],sha256:digest,files},null,2)+'\n');
console.log(digest.slice(0,12));
NODE
)"

# ---- refusals ----
fail() { echo "pack.sh: REFUSED: $*"; rm -rf "$STAGE"; exit 1; }
[ -z "$(find "$B" -type l -print -quit)" ] || fail "a symbolic link in the bundle"
GAME_NAMES='(^|/)SPEED2\.EXE$|\.(BUN|BIN|LZC|VIV|MUS|ASF|VP6|ABK|GIN|CSI|MPF|AUD|LZW|DLL|EXE)$'
bad="$(cd "$B" && find . -type f | grep -iE "$GAME_NAMES" || true)"
[ -z "$bad" ] || fail "game file names: $bad"
if [ -n "$DATA" ] && [ -d "$DATA" ]; then
  # name + size of every game file against every bundle file
  node -e '
    const fs = require("fs"), path = require("path");
    const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p); } return out; };
    const game = new Set(walk(process.argv[1]).map(p => path.basename(p).toLowerCase() + ":" + fs.statSync(p).size));
    const hit = walk(process.argv[2]).filter(p => game.has(path.basename(p).toLowerCase() + ":" + fs.statSync(p).size));
    if (hit.length) { console.log(hit.join("\n")); process.exit(1); }' "$DATA" "$B" || fail "files that match the game folder"
  echo "checked against the game folder: no file of it is in the bundle"
  # what the server leaves out of the game folder (GAME_ENTRIES, web/server-rs/src/app/manifest.rs): copy only the
  # rest to the VPS
  others="$(node -e '
    const fs = require("fs");
    const m = /const GAME_ENTRIES: \[&str; \d+\] = \[([^\]]*)\]/.exec(fs.readFileSync(process.argv[2], "utf8"));
    if (!m) process.exit(0);
    const keep = new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
    console.log(fs.readdirSync(process.argv[1]).filter(n => !n.startsWith(".") && !keep.has(n.toLowerCase())).join(", "));' "$DATA" web/server-rs/src/app/manifest.rs)"
  [ -z "$others" ] || echo "NOTE: the server serves only the game's own files; these of your game folder it never serves (leave them off the VPS): $others"
fi
HOSTNAME_SHORT="$(hostname | sed 's/\.local$//')"
for needle in "$HOME" "$HOSTNAME_SHORT"; do
  hit="$(grep -rlaF "$needle" "$B" || true)"
  [ -z "$hit" ] || fail "names this machine ($needle) in: $hit"
done
SIZE_MB=$(( $(du -sk "$B" | cut -f1) / 1024 ))
[ "$SIZE_MB" -lt 200 ] || fail "$SIZE_MB MB: more than the server, the page and the module"

# ---- the archive ----
find "$B" -type d -exec chmod 755 {} +; find "$B" -type f -exec chmod 644 {} +; chmod 755 "$B/nfsu2-server"
mkdir -p "$OUT"
TGZ="$OUT/nfsu2-vr-web-$REV-$CONTENT-$ARCH.tar.gz"
# owner root, no extended attributes: bsdtar (macOS) and GNU tar (Linux, WSL) spell it differently
if tar --version 2>/dev/null | grep -q bsdtar; then
  TAR_OWNER=(--no-mac-metadata --no-xattrs --uid 0 --gid 0 --uname root --gname root)
else
  TAR_OWNER=(--no-xattrs --owner=root:0 --group=root:0)
fi
COPYFILE_DISABLE=1 tar -C "$STAGE" "${TAR_OWNER[@]}" -czf "$TGZ" nfsu2-vr-web
rm -rf "$STAGE"
echo "$TGZ"
echo "  $(du -h "$TGZ" | cut -f1), $(tar -tzf "$TGZ" | grep -vc '/$') files, sha256 $(shasum -a 256 "$TGZ" | cut -d' ' -f1)"
