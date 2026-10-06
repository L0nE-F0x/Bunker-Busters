# Changelog

Each `## vX.Y.Z` section becomes the GitHub release notes and the "what's new" list in the in-app
update notice (the first few bullets). `scripts/release.sh` refuses to release a version without one.

## v0.1.8
- **Fixed: invisible walls in the open desert.** Walking up even a gentle dune could slow you to a dead stop with nothing in the way (worse at high frame rates). You now walk and sprint freely over the sand, and only real obstacles stop you
- **Fixed: jumping did nothing at high frame rates** (100+ fps, e.g. the browser build on a 144 Hz screen)

## v0.1.7
- **Dust storms** roll in and out: brown-out visibility, blowing sand, howling wind, dry lightning with distant thunder, and SeedBot's optics are half-blind in them (a stealth opportunity)
- **Sky and light**: eye adaptation, deeper day sky, longer twilight afterglow, a milky way and a cratered moon; dust devils on calm afternoons; a dead megacity skyline on the horizon; pebbles and grit underfoot
- **The Garage, rebuilt in detail**: ribbed roll-up door, neon spilling onto the door and yard, razor wire, yard clutter, a lived-in workshop (ceiling joists, pegboard, shelving, posters), a proper vault with cash and gold, red alarm beacons that sweep the rooms
- **Effects**: a new EMP blast (arcs, shock ring, sparks), sharper lasers with dust glints, SeedBot nav lights, sparks and smoke when it browns out or crashes
- **Performance**: far fewer draw calls (batched materials, the hands, SeedBot and the campfire merged, instanced tumbleweeds, cheaper HUD and minimap updates)
- Fixed: a stripe artifact across concrete floors and ceilings

## v0.1.6
- **Fixed: the 3D view could fill only part of the window** if the window was resized while the game was loading (common with tiling window managers): the game now re-fits whenever the window size changes

## v0.1.5
- **Fixed: the Linux desktop app froze the moment you entered the game.** Capturing the mouse stopped the window from showing new frames (the game kept running behind a frozen picture). The app now captures the mouse itself, so the picture stays live
- **Fixed: mouse look spun wildly** in the desktop app (it was reading screen positions as movement)
- Escape or switching away from the window releases the mouse and pauses

## v0.1.4
- **Fixed: mouse look was dead in the Linux desktop app** (XWayland on NVIDIA laptops), so the game seemed frozen once you were in: the app now reads raw mouse motion itself
- If the game can't capture the mouse it now says "Click to resume" instead of silently ignoring the mouse

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
