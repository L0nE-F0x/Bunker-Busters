# Changelog

Each `## vX.Y.Z` section becomes the GitHub release notes and the "what's new" list in the in-app
update notice (the first few bullets). `scripts/release.sh` refuses to release a version without one.

## v0.3.0
- **Smooth again, and lighter than ever.** v0.2.0 lit every pixel with sixteen lights and drew Dry Creek from across the map. Lights are now shared from a small pool, far places swap to cheap stand-ins, and shadows draw in a fraction of the passes. About 40% fewer draw calls than v0.1.9, with far more world
- **Four new places to break into.** The Exit Strategy, a founder's private jet that tried to leave early. Starlite Drive-In, where you can restart the projector and watch the last keynote at night. ColdStorage, a data centre with an AI that still answers. The Tube, a hyperloop test track you can power up and ride to the broken end
- **Dry Creek and The Cut, rebuilt.** Real buildings with dressed interiors (the diner has booths and a menu board), people who breathe and turn to look at you, and a cave that is an actual cave
- **A new look.** Clearer air and real skies, a Milky Way at night, rock that shows its layers, dust that settles on everything after a storm, a time-of-day colour grade, and a drone that scans with a soft beam
- **Places sound like places.** Cave drips, server hum, a radio murmuring to itself, voices round the fire, footsteps that know sand from metal, and an echo when you step indoors
- **Act I has a real ending.** Find out who Tanner actually pays, why Dry Creek went dry, and whose name is on the last page of the Seed Manifest. Then Vesper Kade cuts into the debrief with an offer, and you decide what the camp does with the ledger
- **A quest log.** The journal (J) tracks the main story and ten favours: one for each person in Dry Creek and the Cut, one for each new place on the map, and Pip's water ledger at the camp. Track one and the corner of the screen follows it
- **People remember.** Every favour ends on a choice, and the town keeps score: a free plate at the diner, house calls, cheaper water, a better pick recipe, and who says yes when you ask them to walk west with you
- **Two new people can take the radio.** Juno Reyes, a county ranger who walks far on very little, and Theo Vance, a founder who gave his bunker seat back. Character select now shows all six at once
- **Skill trees.** Skills get their own screen (K). Every skill branches at rank 2 (a focus) and again at rank 4 (a capstone, such as a bump key that opens any three-pin lock, or an exit plan that makes getting tased free)

## v0.2.0
- **Dry Creek.** West of the highway: a diner, a clinic, a store, and a motel, with people who are not the job. Nia, Doc, Inez, Sol, and Ren each ask for a different skill
- **The closet is a stair.** In the Till, lockpicking 3, a charge, or enough conversation that Inez admits to the key. The page at the top cannot be read from the ground floor
- **The wash, north of the spire.** Posts lead up the ridge to a cave, The Cut. Wick lives in it. A pocket in the rock stays shut until you spend a charge
- **A focus at rank 2.** Six skills, and once a skill is rank 2 the point can shape it instead of raising it: shorter locks, a pick that sometimes holds, a simpler bypass, a quieter step, a charge that does not wake the street
- **The radio has a reason now.** Day 1,284. The camps are thirsty. The job is the cistern and the Seed Manifest. Four people can take it. Hunger, thirst, and the pack are part of the walk. At the end of the debrief, Vesper Kade names Apex Vault. That door is not in this release

## v0.1.9
- **Real music.** A generative soundtrack in the spirit of a spaghetti western: plucked guitar with echo, warm pads, bass and a whistled main theme on the title screen. Out in the wasteland it plays in pieces of a minute or two with quiet stretches between them, so it never wears thin
- **Music follows the action:** a tense pulse and heartbeat rise as SeedBot gets suspicious, drums kick in when the alarm goes off, plus stingers for busting the vault and getting caught. The Music slider in Settings now does something
- **The wind no longer drones on.** A soft breeze with gusts that swell and pass, quiet lulls in between, and wildlife: cicadas on hot afternoons, crickets and distant coyotes at night. The desert goes muffled when you're inside the bunker. Dust storms still roar
- **Play on your phone.** Open the site on a phone and tap Play: the game goes full screen in landscape with touch controls. Drag on the left to walk (push past the ring to sprint), drag on the right to look, plus buttons for jump, crouch, use, flashlight, kit, map and pause. Prompts and hotbar items are tappable too
- Lockpicking, the oscilloscope and keypads all work by touch (press and hold a pin to lift it)
- Phones start on Low graphics and render below native resolution to keep the frame rate up. On iPhone, use Share → Add to Home Screen for full screen
- Menus, the kit, the map and the minigames fit short landscape screens; panels have a close (✕) button

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
