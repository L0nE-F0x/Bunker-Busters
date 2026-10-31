#!/usr/bin/env bash
# Install Bunker Busters for the current user (no root): binary → ~/.local/bin, launcher entry → your
# app menu (Omarchy/walker, GNOME, KDE…). Works from the release tarball or from a repo checkout
# after `npm run desktop:release`.   Uninstall:  ./install.sh --uninstall   (your saves are kept)
# In-app updates replace the binary only; this script is just for the first install.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_DST="$HOME/.local/bin/bunker-busters"
ICON_DST="$DATA/icons/hicolor/256x256/apps/bunker-busters.png"
DESK_DST="$DATA/applications/bunker-busters.desktop"
DOC_DST="$DATA/doc/bunker-busters"
SAVES="$DATA/dev.bunkerbusters.game"

if [ "${1:-}" = "--uninstall" ]; then
  # (also the ~/.local/share paths, in case an older install went there while XDG_DATA_HOME was set)
  rm -f "$BIN_DST" "$ICON_DST" "$DESK_DST" \
    "$HOME/.local/share/icons/hicolor/256x256/apps/bunker-busters.png" "$HOME/.local/share/applications/bunker-busters.desktop"
  rm -rf "$DOC_DST"
  update-desktop-database "$DATA/applications" 2>/dev/null || true
  echo "Bunker Busters uninstalled. Your saves are kept in $SAVES (delete that folder to remove them too)."
  exit 0
fi

BIN="$here/bunker-busters-bin"                                        # tarball layout
[ -f "$BIN" ] || BIN="$here/../src-tauri/target/release/bunker-busters" # repo checkout
ICON="$here/icon.png"
[ -f "$ICON" ] || ICON="$here/../src-tauri/icons/128x128@2x.png"
LICENSES="$here/licenses.txt"
[ -f "$LICENSES" ] || LICENSES="$here/../public/licenses.txt"
[ -f "$BIN" ] || { echo "Can't find the game binary. In a repo checkout, run: npm run desktop:release"; exit 1; }

if ! ldconfig -p 2>/dev/null | grep 'libwebkit2gtk-4.1.so.0' >/dev/null; then  # (no -q: avoid SIGPIPE under pipefail)
  echo "Bunker Busters needs WebKitGTK 4.1:"
  echo "  Omarchy/Arch:     sudo pacman -S --needed webkit2gtk-4.1"
  echo "  Debian/Ubuntu:    sudo apt install libwebkit2gtk-4.1-0   (or use the .deb, which pulls it in)"
  echo "  Fedora:           sudo dnf install webkit2gtk4.1"
  exit 1
fi

install -Dm755 "$BIN" "$BIN_DST"
install -Dm644 "$ICON" "$ICON_DST"
if [ -f "$LICENSES" ]; then install -Dm644 "$LICENSES" "$DOC_DST/licenses.txt"; fi
mkdir -p "$(dirname "$DESK_DST")"
# Absolute icon path: some launchers (Omarchy's) don't resolve theme icon names from ~/.local.
# StartupWMClass matches the window (X11 class / Wayland app id "bunker-busters"), so docks group it.
# No PrefersNonDefaultGPU: the app picks the GPU itself (select_gpu in src-tauri/src/main.rs), and a
# launcher that sets the PRIME variables makes it skip the XWayland settings NVIDIA laptops need.
cat > "$DESK_DST" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Bunker Busters
GenericName=Heist Game
Comment=First-person heist game: break into the tech elite's doomsday bunkers
Exec=$BIN_DST
TryExec=$BIN_DST
Icon=$ICON_DST
Terminal=false
Categories=Game;ActionGame;
Keywords=heist;bunker;post-apocalyptic;wasteland;stealth;lockpicking;first-person;shooter;open world;
StartupWMClass=bunker-busters
DESKTOP
update-desktop-database "$DATA/applications" 2>/dev/null || true
gtk-update-icon-cache -q "$DATA/icons/hicolor" 2>/dev/null || true
echo "Installed. Launch \"Bunker Busters\" from your app launcher (or run: $BIN_DST)"
