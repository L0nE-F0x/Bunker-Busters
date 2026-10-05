#!/usr/bin/env bash
# Install Bunker Busters for the current user (no root): binary → ~/.local/bin, launcher entry → your
# app menu (Omarchy/walker, GNOME, KDE…). Works from the release tarball or from a repo checkout
# after `npm run desktop:release`.   Uninstall:  ./install.sh --uninstall
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
BIN_DST="$HOME/.local/bin/bunker-busters"
ICON_DST="$HOME/.local/share/icons/hicolor/256x256/apps/bunker-busters.png"
DESK_DST="$HOME/.local/share/applications/bunker-busters.desktop"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$BIN_DST" "$ICON_DST" "$DESK_DST"
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  echo "Bunker Busters uninstalled. (Saves live in ~/.local/share/dev.bunkerbusters.game)"
  exit 0
fi

BIN="$here/bunker-busters-bin"                                        # tarball layout
[ -f "$BIN" ] || BIN="$here/../src-tauri/target/release/bunker-busters" # repo checkout
ICON="$here/icon.png"
[ -f "$ICON" ] || ICON="$here/../src-tauri/icons/128x128@2x.png"
[ -f "$BIN" ] || { echo "Can't find the game binary. In a repo checkout, run: npm run desktop:release"; exit 1; }

if ! ldconfig -p 2>/dev/null | grep 'libwebkit2gtk-4.1.so.0' >/dev/null; then  # (no -q: avoid SIGPIPE under pipefail)
  echo "Bunker Busters needs WebKitGTK 4.1. On Omarchy/Arch:  sudo pacman -S --needed webkit2gtk-4.1"
  exit 1
fi

install -Dm755 "$BIN" "$BIN_DST"
install -Dm644 "$ICON" "$ICON_DST"
mkdir -p "$(dirname "$DESK_DST")"
cat > "$DESK_DST" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Bunker Busters
GenericName=Heist Game
Comment=They built bunkers. You brought lockpicks.
Exec=$BIN_DST
Icon=bunker-busters
Categories=Game;ActionGame;
Terminal=false
StartupWMClass=bunker-busters
DESKTOP
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
echo "Installed. Launch \"Bunker Busters\" from your app launcher (or run: $BIN_DST)"
