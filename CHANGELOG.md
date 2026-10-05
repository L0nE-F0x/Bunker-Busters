# Changelog

Each `## vX.Y.Z` section becomes the GitHub release notes and the "what's new" list in the in-app
update notice (the first few bullets). `scripts/release.sh` refuses to release a version without one.

## v0.1.3
- **Linux desktop app is 3–4× faster in menus**: title screen 13 → 50+ fps, menus 14 → 45 fps on an RTX 4050 laptop (blur and glow effects that WebKitGTK redraws on the CPU every frame are swapped for flat equivalents there; browser and Windows keep the full look)

## v0.1.2
- **Fixed: menu clicks did nothing in the Linux desktop app** on NVIDIA laptops under Wayland (Hyprland/Omarchy), so you couldn't get past the title screen
- **Fixed: the app launcher showed a placeholder icon** for tarball installs (re-run `install.sh` to refresh the menu entry)

## v0.1.1
- **Natural hands**: rebuilt anatomy and poses; empty hands rest out of view and come up when you use them
- **Real physics**: true gravity, momentum and air drag, fall damage, hard landings, stamina and breathing
- **In-app updates**: the desktop app tells you when a new version is out and installs it for you
- **Physical EMP canister** that bounces and rolls; SeedBot crashes out of the sky when it's hit
- Footsteps in sync with your stride, dust kicked up by landings and sprints, and a fix for physics running too fast on high-refresh screens

## v0.1.0
- First public release: The Garage (Tier 1), Infiltrator and Engineer, lockpicking, circuit bypass and keypad minigames, SeedBot, day/night cycle.
