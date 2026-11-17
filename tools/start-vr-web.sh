#!/usr/bin/env bash
# Windows source checkout -> private Linux build mirror. Game data stays outside.
set -euo pipefail
source_root=$(realpath "${1:?source checkout}")
game_root=$(realpath "${2:?PC game directory}")
port=${3:-8611}
mod_root=${4:-}
build_root="$HOME/nfsu2-vr-web"
[[ -f "$source_root/web/build.sh" && -f "$game_root/SPEED2.EXE" ]] || { echo 'Source checkout or PC game missing.'; exit 1; }
[[ "$port" =~ ^[0-9]+$ && "$port" -ge 1024 && "$port" -le 65535 ]] || exit 1
[[ "$source_root" != "$build_root" ]] || { echo 'The source and build mirror must be separate.'; exit 1; }
mkdir -p "$build_root"
rsync -a --exclude=.git --exclude=.venv --exclude=node_modules --exclude=target --exclude=gen --exclude=out --exclude=deps --exclude=dist "$source_root/" "$build_root/"
cd "$build_root"
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
if [[ -x deps/node/bin/node ]]; then export PATH="$PWD/deps/node/bin:$PATH"; fi
command -v cargo >/dev/null || { echo 'Install Rust in WSL with rustup first.'; exit 1; }
command -v node >/dev/null || { echo 'Install Node.js 24 or newer in WSL first.'; exit 1; }
[[ -x .venv/bin/python ]] || { python3 -m venv .venv; .venv/bin/pip install -r requirements.txt; }
if ! web/tools/gencheck.sh >/dev/null 2>&1; then web/gen.sh "$game_root/SPEED2.EXE"; fi
python3 tools/prepare_vr_data.py "$game_root" "$build_root/out/vr-game-data"
if [[ -n "$mod_root" ]]; then python3 tools/prepare_vr_mods.py "$mod_root" "$build_root/out/vr-game-data"; fi
exec web/start.sh --data "$build_root/out/vr-game-data" --http-port "$port"
