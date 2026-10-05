#!/usr/bin/env bash
# Benchmark the game inside the desktop shell (WebKitGTK) — the real "installed app" performance.
# Opens a window for ~40 s, prints the game's [BENCH] lines (fps + update/physics/render ms), quits.
#
#   scripts/dev/bench-desktop.sh                 # release binary, bundled assets, High, gameplay
#   scripts/dev/bench-desktop.sh medium          # quality preset
#   BB_DEV=1 scripts/dev/bench-desktop.sh        # debug binary against the dev server (npm run dev)
#   BB_GPU=integrated scripts/dev/bench-desktop.sh   # force the iGPU for comparison
#
# Extra game URL flags you can add via BB_FLAGS: skip=ui|post|env|dust|haze|props|landmarks|scrub|…
set -euo pipefail
cd "$(dirname "$0")/../.."
Q="${1:-high}"
FLAGS="bench&autostart&q=$Q${BB_FLAGS:+&$BB_FLAGS}"
if [ "${BB_DEV:-0}" = "1" ]; then
  BIN=./src-tauri/target/debug/bunker-busters
  URL="http://localhost:5173/play/?$FLAGS"
  [ -x "$BIN" ] || cargo build -q --manifest-path src-tauri/Cargo.toml
else
  BIN=./src-tauri/target/release/bunker-busters
  URL="tauri://localhost/play/index.html?$FLAGS"
  [ -x "$BIN" ] || npx tauri build --no-bundle
fi
BB_START_URL="$URL" BB_EXIT_AFTER="${BB_SECONDS:-40}" timeout $(( ${BB_SECONDS:-40} + 20 )) "$BIN" 2>&1 \
  | grep -E "bunker-busters\]|\[BENCH\]|rror" | sed 's#^.*CONSOLE [A-Z]* ##'
