# Bunker Busters — Dev Notes

## Milestone: v0.1 MVP vertical slice

### Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/ (Netlify-ready, see netlify.toml)
```

URL flags: `?webgl` forces WebGL2. `?gpu=high` / `?gpu=low` force WebGPU on the discrete / integrated GPU. `?gpu=reset` forgets the stored backend choice. `?q=low|medium|high|ultra` overrides quality. `?skip=props,landmarks,scrub,dust,haze,env,post,garage,terrain,sky,shadows,fog` disables subsystems (for GPU debugging).

**Renderer backend chain.** The game tries WebGPU on the discrete GPU first, then WebGPU on the integrated GPU, then WebGL2. It catches early device loss or repeated device errors, remembers the result per browser and reloads one step down the chain.

**This machine (Chrome 153, hybrid Intel + RTX 4050, Hyprland/Wayland):**
- Chrome's GPU process is deliberately pinned to the Intel iGPU by `~/.config/chrome-flags.conf`. That's the right call for desktop use: the panel is wired to Intel. So WebGL2 always runs on Intel.
- Chrome still lets WebGPU pick the NVIDIA card through Vulkan (Dawn). That device is lost on its first present with `vkAllocateMemory failed with VK_ERROR_OUT_OF_DEVICE_MEMORY`. It happens even for a bare clear-screen test, so it's a Chrome/Dawn/NVIDIA-driver interop problem, not this game. Unaligned canvas sizes additionally fail the cross-GPU swapchain import (`Requested allocation size … smaller than the image requires`). The drawing buffer is now padded to 64 px × 128 rows on WebGPU and cropped, which fixes that part.
- WebGPU on the Intel iGPU works. Headless at 1280×720: High runs at WebGPU 30 fps vs WebGL2 27 fps, Medium at 45 vs 42.
- Pinning all of Chrome to NVIDIA (render-node override + PRIME offload) froze the desktop session during testing. Don't do that on a live session.

### Invisible walls in the open desert + no jumping at high fps (2026-10-06)
The owner reported walking in a straight line across open sand and being stopped dead, "like an invisible wall". There was nothing in the way. `scripts/dev/walk-probe.mjs` (new) holds W from random spots and logs every stall with the contacts: **122–136 of 150 lines stalled** on bare 5–10° slopes, touching only the heightfield.
- **Cause 1 (the wall):** while grounded we pushed down at 2 m/s to hug the terrain. The Rapier controller slides that push along the slope, which moves you downhill a little every frame. The "blocked by a wall" check (`actual < velocity − 0.05` → velocity = actual) then read every upslope as a wall, and the cut was bigger than a frame of acceleration, so speed decayed to zero. Higher fps stalls on gentler slopes, because acceleration per frame shrinks while the cut doesn't: about 2° at 144 Hz, about 6° at 40 fps.
- **Fix:** grounded frames ask for no vertical motion (`snapToGround` already keeps the feet planted). Velocity is cut only against contacts flatter than the 50° climb limit (walls and too-steep faces), and only the part going into them. A fallback zeroes it when you keep under 25% of the motion (pinned on a boulder's shoulder, whose contact reads as floor).
- **Cause 2 (no jumping at ≥ 100 fps):** one frame of jump rise (2.3 cm at 144 Hz) is less than the controller's 3 cm skin, so it still reported grounded and the landing branch reset vy. Now you're never grounded while vy > 0. The jump apex is 0.50–0.54 m from 30 to 240 fps.
- **After:** the probe covers 10.9 km instead of 3.7–5.2 km on the same 150 lines at 40/60/144 fps. The remaining ~33 stalls are all real: rocks, wrecks, the Garage fence and terrain faces over 45°. Average sprint speed over rough ground went from 3.2–3.8 to 5.1 m/s. No new airborne flicker or false landings.

### Garage graphics & VFX pass (2026-10-06)
- **Set dressing** (`src/game/bunker/garageDressing.ts`, called from `GarageBuilder`):
  - Building: ribbed roll-up door with guide rails and an inside barrel housing, plinth, roof fascia, gutters and downspouts, a meter box and conduit, a fake CCTV camera with a blinking LED, barred windows, roof AC unit, vents, a hatch and sandbags.
  - Yard: fuel drums (one tipped and leaking), jerry cans, a cable-reel table, pallets and cartons, tyre stacks, the "Executive Restroom" porta-john, sawhorses, a drone-dock pylon with cables, fence signs, and the tarp truck on visible wheels.
  - Workshop: ceiling slab with steel joists and fluorescent fixtures, pegboard tools, bench clutter, a rolling tool chest, two shelving units of supplies, a standing desk with monitors, and a fridge.
  - Vault: steel cladding, shelving with cash and gold, a cash pallet, a hooded founder mannequin behind a velvet rope, an alarm beacon, and a rebuilt vault door (frame, rivets, spoked wheel, hinges, bolts).
  - Bigger props have colliders. Interaction points and gameplay colliders are unchanged.
- **Decal atlas** (`garageAtlas.ts`): one 2048² canvas holds every painted detail (oil, tracks, cracks, hazard stripes, posters, signs, graffiti, light pools, wall washes).
  - All decals merge into one lit mesh and one additive mesh.
  - Light pools and neon washes follow `uPoolNight` and the neon flicker.
- **Draw-call tools:**
  - `GlowPalette` (`materials.ts`) puts every small static glow in ONE material. Each slot is a colour/intensity entry in a uniform array, picked by the geometry's uv.x. Blinkers write `slot.intensity.value`.
  - `GlowSprites` (`effects.ts`) is a single instanced sprite of soft halos. Each halo reads a channel (`CH` in `garageDressing.ts`) that `Garage.updateLights` sets, so halos stay in sync with blinkers, night, tubes, alarm and lasers.
- **VFX:**
  - `Sparks` (GPU streaks with gravity and floor skid) fire on drone brown-outs, crashes and EMP hits, and when the fuse box is cut.
  - The EMP `Shockwave` has a crackling shell, a ground shock ring, a core flash, re-striking arcs and electric sparks. `Game` passes `garage.sparks` and the camera position.
  - Light cones fade near the camera.
  - Lasers have a crisp core, shimmer, dust glints and a red line on the floor.
- **SeedBot:** parts are merged per material (~20 meshes down to ~7). It gains skids, rotor guards, counter-rotating props, nav lights with a strobe, an eye halo that cross-fades by state, motor sparks, and smoke while knocked out.
- **Fixes:**
  - `concrete()` streak stains no longer paint diagonal stripes across floors (they only apply to walls now).
  - The ceiling slab seals the light gap under the tilted roof.
  - The graffiti subtitle no longer overflows its canvas.
- **Draw calls** (headless, `renderer.info.render.drawCalls`, same views): about 25–35 fewer at most Garage views, despite ~2.5× the triangles (e.g. exterior 338 → 311, yard at night 322 → 298, workshop 307 → 296, roofline 367 → 334). Garage + drone objects went from 117 to 103.
- **Next:**
  - concertina wire
  - interior dust motes in the tube light
  - the alarm beacon as a rotating light cone
  - Test the WebGPU path, since `uniformArray` is indexed per vertex in `GlowPalette` and `GlowSprites`. Only WebGL2 was verified headless.

### First-person update (v0.1.1)
- The player is now first-person. `FirstPersonCamera` handles eye-height crouch easing, gait head-bob, strafe roll, landing spring, sprint FOV and trauma shake.
- `Hands` is a procedural viewmodel: gloved hands with articulated fingers and thumb, knuckle armour, wrist straps, sleeves, and a wrist gadget in the archetype accent colour.
  - Looks per archetype: black tactical gloves (Infiltrator) and tan work gloves (Engineer).
  - Poses blend: idle, crouch, run, lockpick, keypad, reach/grab, EMP hold → wind-up → throw, eat, and a torch grip.
  - Look-sway inertia, bob and landing dip are layered on top.
  - The hands are authored at real scale and shrunk toward the eye (`VIEW_SCALE`), so they never clip through walls.
- Held items: lockpick and tension wrench, EMP canister, ration bar, flashlight. Flashlight is on **L**. It's a camera-mounted spotlight, and SeedBot spots you 1.6× faster while it's on.
- The old third-person body still walks around but renders only into the sun's shadow map (layer 1), so you see your own long evening shadow.
- Character select is now a kneeling-at-the-campfire close-up of your character's hands and gear.
- Interaction targeting follows your gaze. Banners are queued. The hotbar moved bottom-right so it doesn't sit on the hands.
- Dev tool: `http://localhost:5173/debug/hands.html?pose=lockpick&look=engineer&torch` renders the hands alone in a studio (dev server only, not part of the build).

### Overnight merge + test-harness lesson (2026-10-06)
- Merged three agent branches: perf (draw-call batching), weather/world (dust storms, sky, skyline), and the Garage graphics/VFX pass. Their own NOTES sections are below.
- Conflicts resolved by hand:
  - Tumbleweeds: both branches instanced them; kept the weather version.
  - `Drone.ts`: took the Garage rebuild and re-applied the weather branch's storm-visibility changes.
  - Garage roof: removed a duplicate `rb.build('roof')` (perf folds the roof into the static batch).
  - Light cones: keep both the near-camera fade and the storm murk.
- **Harness lesson:** a "wallpaper / transparent window" frame turned out to be the test app closing on its `BB_EXIT_AFTER` timer (Hyprland's fade-out) while the grim loop was still running. Each grim+md5 step takes ~0.75 s, not the 0.4 s sleep. Make `BB_EXIT_AFTER` comfortably longer than the capture loop.
- Also added (harmless): `alpha: false` on the renderer, an opaque black webview/window background in the shell, and `?hour=N` to set the time of day on start.

### Desktop freeze: the real cause (2026-10-06, overnight)
- The owner's "frozen" reports were never input or game logic. **The window stopped presenting frames** while the page kept rendering, and `?bench` still said 50 fps. Found with a screenshot oracle: `grim` the window every 0.5 s and compare md5s.
- Trigger: **WebKitGTK's own pointer lock** (its X grab from the UI-process connection). Entering gameplay requests pointer lock, so the picture froze at Continue / Enter the Wasteland.
  - A grab held by a *separate* X client (same hidden cursor, same confine-to) leaves presentation live.
  - Rarely, it also stalled without a lock while tiled. It hasn't reproduced since.
- Fix: in the Linux app `Input` uses **native capture**. `mouse_capture(on)` in `rawmouse.rs` grabs the pointer on our window from its own X connection (invisible cursor, confined, no events), and mouse look comes from XI2 raw motion.
  - Escape and window blur release it, since there's no browser Escape handling.
  - Game code listens for `bb-lockchange` / `bb-lockerror`, which fire for either capture kind.
- Also fixed: XWayland exposes the mouse as `xwayland-pointer` (absolute) and `xwayland-relative-pointer`. Summing the absolute device's raw values spun the camera ~19 turns. Only relative slave pointers count now.
- Verified with screenshots at 1512×910: 60 s captured, 120/120 frames changed; walking and looking work; 51–54 fps. Earlier dead ends: native Wayland on NVIDIA (Error 71 / ~25 fps), Intel native Wayland (~18 fps on High).
### Weather and world atmosphere (2026-10-06)
- **Dust storms** (`src/game/world/Weather.ts`): calm (first storm 3.5–6 min into a session, then every 7–12 min) → *front* (a ragged brown wall rises on the upwind horizon, ~50 s) → *storm* (1.5–3 min) → *clearing*. Only scheduled while playing with no modal open.
  - Everything reads two numbers off the Atmosphere (`storm`, `stormFront`), so the storm is uniforms, not meshes. Fog thickens to ~60 m visibility, the sky becomes one brown dome with a pale sun disc, the sun dims (shadows go soft) and the hemi light turns dusty.
  - `SandStreaks` (effects.ts) is one sprite draw call, and only while windy. Ground haze, dust motes, terrain sand ribbons, scrub (stiff stems, faster flutter), tumbleweeds (bigger hops) and a storm audio layer (hiss, whistling howl, buffeting rumble) all scale with it.
  - Stealth: `DroneSense.visibility` (from `atmo.visibility`) shrinks SeedBot's sight range (to ~45 %) and slows detection. Toasts announce the front and the clearing.
  - Dry lightning in thick storms (every 9–31 s): a few rapid flash pulses light the dust from inside (`uFlash`) and thunder follows after a delay that depends on distance (`audio.thunder(k)`). `game.weather.strike()` triggers one.
  - Debug: `game.weather.storm(v, instant?)`, `game.weather.rollIn()` (natural cycle now), `game.weather.auto()`, URL `?storm` / `?storm=0.6`.
- **Sky/light:** exposure now follows sun elevation (`atmo.exposure` → `post.exposure`; 0.78 at noon to 1.55 at night). The day sky is a deeper blue, with darker haze and less ambient, and terrain albedos are mid-tones, so noon no longer bleaches to white. Twilight has an afterglow under the set sun and a pink anti-twilight arch. At night there's a milky way, two star layers, a cratered moon and brighter moonlight.
- **Horizon:** the far city is now a dead megacity of supertall ruins that clears the bounding mountains. At night a few windows glow and roof beacons blink. Still one mesh.
- **Dust devils** (`DustDevils`, effects.ts): up to four slim spinning sand columns wander the flats on bright, calm afternoons (none in storms). One sprite draw call, placed on the GPU and world-anchored. `game.devils.pin(x, z)` parks one for screenshots.
- **Ground:** pebble/grit patches in the terrain shader. Tumbleweeds are hollow twig balls in one InstancedMesh (−18 draw calls when they're in view).
- **Gotchas found:**
  - three skips per-object uniform refreshes for *plain* (non-node) materials whose object and lights didn't change. Object-group fog uniforms went stale on the far city while the sun stood still. All Atmosphere uniforms are now in `renderGroup`.
  - `pow()` of a negative base is NaN in GLSL, and `NaN * 0` is still NaN. One NaN pixel blacks out the whole frame through bloom. Clamp pow bases.
  - `wind × time` in shaders jumps whenever the wind changes. Integrate offsets on the CPU (`uCloudDrift`, `uSandFlow`, Scrub `uGust`).
- Draw calls are unchanged or slightly lower: golden-hour spawn view 282 → 276, camp at night 197 → 185, storm +1. Headless fps is pinned at 60 before and after, including 1440p Ultra.
- Next: dust settling on surfaces after a storm, weather in the save file.

### Desktop mouse look (2026-10-05)
- Symptom (owner): "can't move, nothing works" in the installed app. The `?trace` log from the owner's real session showed:
  - Pointer lock engaged, but real mouse motion arrived as 3–15 px/s (vs ~600 px/s unlocked), so the view never turned.
  - Keys did arrive. W was pressed mostly while the Pause menu was open (after Escape), so nothing moved.
- Cause: WebKitGTK's X11 pointer lock (`PointerLockManagerX11.cpp`, fetched from Arch debuginfod) measures motion from the lock point and recentres with `XWarpPointer`. Under XWayland an X client can't move the real cursor, so it pins at the window edge.
- Fix: `src-tauri/src/rawmouse.rs` reads XInput2 **raw** motion on its own X connection (`x11-dl`, already in the tree). `Input.pollRaw()` polls `raw_mouse_delta` every frame while locked and ignores browser `movementX` once raw motion flows. WebKit's lock still hides and confines the cursor. Two gotchas:
  - Announce XI **≥2.1**. Under 2.0 rules, raw events don't reach root listeners while another client (WebKit) holds the grab.
  - Call `XInitThreads()` before GTK opens its display, because Xlib is now used from two threads.
- Measured with XTest: 1000 px of motion → 2.14 rad of yaw via raw. WebKit's own events delivered ~440 px of it.
- Pointer-lock requests can fail (e.g. the window isn't focused). `pointerlockerror` now shows "Click to resume", and clicking the view retries.
- Ruled out along the way:
  - The `WebKitWebProcess` core dumps are an NVIDIA EGL crash during *teardown* (`GLContext::~GLContext` from `stopRunLoop`) after the window closes. Harmless.
  - Native Wayland on NVIDIA either aborts (dmabuf: Error 71, still with WebKitGTK 2.52.6 / driver 610) or runs ~25 fps (no dmabuf).
- Test tooling: an XTest injector (`xt`) drives the XWayland window. Focus the window via Hyprland first, or WebKit denies pointer lock and keys go nowhere. Run the app via `systemd-run --user … stdbuf -oL` for the launcher environment and an unbuffered log. `?pr=1.25` caps the render pixel ratio.

### Desktop menu performance (2026-10-05)
- The owner reported a few fps in menus in the installed app. Measured in the app at their window size (1512×910 logical, 1.25 scale): title 12–14 fps, menu open ~14 fps.
- Cause: CSS `backdrop-filter: blur` on every `.panel`, big blurred `drop-shadow` filters on the logo, `mix-blend-mode` glitch/scanlines, and animated overlays. WebKitGTK re-rasterises these on the CPU over the live WebGL canvas every frame.
- Fix: `html.lowfx` (set in `src/main.ts` for WebKitGTK; override with `?lowfx=0|1`) swaps them for flat equivalents. Result: title 50–55 fps, menus ~45 fps, in-game ~51 fps on High (~54 on Medium).
- Debug: `?open=controls|settings` opens a menu over the title for benchmarking.
- Benchmarking a real-size window from a script: float and resize it with `hyprctl dispatch 'hl.dsp.window.float({ action = "set", window = "class:Bunker-busters" })'` and `'hl.dsp.window.resize({ x = 1512, y = 910, window = "class:Bunker-busters" })'`. Windows on hidden workspaces aren't rendered, so it must stay visible.

### Desktop click fix (2026-10-05)
- Symptom: in the installed app the title menu looked frozen. Clicking Continue or New Game did nothing; the game itself ran fine with `?autostart`.
- Cause: on the NVIDIA/XWayland path (`GDK_BACKEND=x11`), GTK3's XInput2 handling never delivered mouse button events to WebKit. `?trace` showed key presses arriving but no pointerdown, mousedown or click at all.
- Fix: `GDK_CORE_DEVICE_EVENTS=1` alongside `GDK_BACKEND=x11` (`select_gpu()` and `run-nvidia.sh`). Tested side by side with the owner: XWayland + this flag beat native Wayland on Intel for both speed and looks.
- Uncaught JS errors and unhandled rejections are now logged to the console, so they reach stdout in the desktop app. `?trace` (or `?trace=A`, which shows a label) logs input events.
- The launcher entry uses an absolute icon path. Omarchy's launcher doesn't resolve theme icon names from `~/.local`.
- Driving the desktop window from a script: focus it with `hyprctl dispatch 'hl.dsp.focus({ window = "class:Bunker-busters" })'` (this Hyprland uses the Lua dispatch syntax). `wtype` keys reach the XWayland window as Escape, so for real clicks, ask the owner.

### In-app updates (2026-10-05)
- The desktop app checks GitHub for a newer signed release on the title screen and shows an "Update available" card. It lists the CHANGELOG bullets and offers **Update & restart** with a progress bar.
- Built on `tauri-plugin-updater`, wrapped in our own commands (`src-tauri/src/update.rs`), so no capability files or JS plugin API are needed. The browser build never shows it.
- Install types:
  - The tarball binary (Omarchy) is swapped in place without root.
  - The AppImage is replaced in place.
  - The .deb goes through pkexec.
  - Windows runs the NSIS installer in passive mode.
- The bundler stamps the bundle type ("deb", "appimage"…) into a *copy* of the binary for each package. `target/release/bunker-busters` stays "unknown", so the tarball updates as a plain binary. CI checks this. Don't rewrite markers by string replace: on CI's compiler the other type names are match literals in the binary.
- CI signs everything with `TAURI_SIGNING_PRIVATE_KEY` and publishes `latest.json` (`scripts/update-manifest.mjs`). The release notes come from `CHANGELOG.md` (`scripts/changelog.mjs`), and `release.sh` requires an entry.
- v0.1.0 installs have no updater, so they need one manual download of v0.1.1. Updates are in-app from then on.

### Realism pass (2026-10-05)
Owner feedback: the hands looked like "zombie hook hands", and falling and other physics weren't believable.

**Hands (`Hands.ts`, rebuilt)**
- Anatomy:
  - The palm is a remapped rounded box: tapers to the wrist, arched back, thenar and hypothenar pads.
  - Knuckles sit on an arc, with the middle finger furthest forward and the pinky set back.
  - Joints are full spherical caps, so bent fingers don't open gaps.
  - DIP flexion is about ⅔ of PIP, like real tendons. A single curl value cascades: the index finger stays straightest and the pinky curls most.
  - The thumb sits on the correct side and lies along the index finger.
- Forearms use two-bone IK (`SHOULDER`/`UPPER`/`FORE`, elbow pole down and out), plus an upper-arm sleeve for big reaches. The wrist now bends against a forearm that heads toward a real elbow, instead of the forearm being glued to the hand.
- Presentation:
  - Empty hands hang out of view, like real arms. The `idle` pose is `DOWN`, and lowered rigs skip their ~30 draw calls.
  - Hands rise for actions, the torch, a sprint arm-pump (counter-phase with the stride) and a falling/balance reflex.
- Pose blending is a critically damped spring per channel, so the hands accelerate and settle. The off-hand lags slightly.
- Landing drops the arms through a spring. The flashlight beam follows the torch hand.
- Fresnel rim emissive cut from 0.35 to 0.08. It was the glowing red outline in the owner's night screenshot. Bump strength was retuned for the shrunken viewmodel.
- Interactions fire when the hand arrives (~0.25 s), not on the keypress. A new action fires the interrupted action's pending callback, so an interrupted eat still heals. E/F are ignored while the hands are busy.
- Lab: `&view=side|palm|top&hand=r|l` orbit camera, `&frame={…}` movement state, `&t=` sim time.

**Movement physics (`Player.ts`)**
- Real gravity (9.81, it was 19). Jump apex is ~0.55 m (it was ~0.95 m); the low laser at 0.32 m is still easy to clear.
- Acceleration-limited movement with mass:
  - 10 m/s² from a standstill, 5 m/s² building into a sprint, 16 m/s² braking.
  - 1.2 m/s² of air steering. In the air, momentum carries.
- Quadratic air drag, terminal velocity ~55 m/s.
- Walking off a ledge starts the fall from rest, not from the −2 m/s ground-snap velocity.
- Landing:
  - A recovery beat before the next jump (no bunny-hopping).
  - Horizontal speed bleeds off on hard impacts.
  - A stumble after more than 6 m/s: slowed, no sprint.
- Fall damage above 7.7 m/s impact (~3 m): (v − 7.7) × 11, scaled by toughness. 5 m ≈ 28 HP and 9 m ≈ 80 HP for the Infiltrator.
- Crouching in mid-air tucks the legs: the feet rise and the head stays put (`onTuck` → `cam.shiftEye`).
- Slower backpedal and strafe. Speed follows the terrain grade (uphill slower).
- Stamina: ~14 s of sprinting, recovered in ~5 s standing. Run dry and you're winded until it's back to 40%. No HUD bar: procedural breathing (`audio.breathe`) and a view heave tell you.
- Measured headless: apex 0.52 m; impact 6.7 / 9.5 / 13.0 m/s from 2.5 / 5 / 9 m (ideal 7.0 / 9.9 / 13.3; the gap is drag).

**Camera**
- Footsteps fire at the low point of the first-person stride (`cam.onStep`), so sound and head-bob agree. Before, they ran on the hidden body's own clock.
- Landing dip scales with impact speed (knees absorb up to ~24 cm, plus a nod). Hard landings add shake.

**World physics**
- `physics.world.timestep = dt` every frame. It was a fixed 1/60 per rendered frame, so physics ran 2.4× fast at 144 Hz.
- The EMP canister is a real Rapier rigid body: ~0.5 kg, restitution 0.32, CCD, spin on release. It inherits the player's velocity and makes impact sounds (`bounce`) and dust. The character controller ignores dynamic bodies (`EXCLUDE_DYNAMIC`), so you can walk into it and nudge it.
- SeedBot has a thrust model:
  - Lift ∝ rotor spin² under a PD altitude controller.
  - An EMP drops it like a stone (rotors spin down, ~0.4 s): it crashes, bounces, rests tilted, then spins up, lifts off and rights itself.
  - Brownouts sag and wobble on stuttering thrust.
  - It banks into acceleration, not velocity.

**FX / audio**
- `DustPuffs` (`effects.ts`): one sprite draw call with a GPU-animated ring buffer (drag, wind drift, rise, growth, fade, soft-particle depth fade, haze lighting). Fired on landings, sprint footfalls on sand, canister bounces and the drone crash.
- New sounds: `thud` (painful landing / crash), `bounce` (small steel can), richer `land`, and breathing.

**Next**
- The owner should play-test the feel: acceleration, stamina length, fall-damage curve and hidden idle hands are tuning knobs at the top of `Player.ts` and in `POSES`.
- Not done: dust storms, footstep surface types beyond sand/metal, a ragdoll for the shadow body.

### Hand-off & tooling (2026-10-05)
- `CLAUDE.md` is the agent hand-off: daily loop, release procedure, code map, verification harness, hard-won rules, backlog.
- `scripts/release.sh patch|minor|major|X.Y.Z [--dry-run]` bumps all three version files, verifies, commits, tags and pushes.
- `scripts/dev/` is the headless test harness (`shot.mjs`, `hands-lab.mjs`, `marketing-shots.mjs`, `og-card.mjs`) plus `bench-desktop.sh`. Dev dependency: `playwright-core` (uses an installed Chrome).
- The version shown in-game and on the site comes from `package.json` via `__APP_VERSION__`.

### Distribution (2026-10-05)
- **Site:** `index.html` (root) is the marketing/download page, built from `src/site/*`, with screenshots in `public/media/`. `/play/` is the browser build. Netlify deploys `main`.
- **Download buttons** point at `releases/latest/download/<fixed asset name>`. The page asks the GitHub API which assets exist and falls back to "play in browser" before the first release.
- **Releases:** push a `v*` tag and `.github/workflows/release.yml` builds:
  - `BunkerBusters-linux-x86_64.tar.gz`: plain binary against the system WebKitGTK, plus `install.sh` (recommended for Omarchy/Arch)
  - `BunkerBusters-linux-x86_64.AppImage`
  - `BunkerBusters-linux-amd64.deb`
  - `BunkerBusters-windows-x64-setup.exe`: NSIS, unsigned, so SmartScreen warns
- **GPU:** the Linux desktop app picks the NVIDIA GPU by itself on hybrid laptops (`select_gpu()` in `src-tauri/src/main.rs`).
- **Local install:** `npm run desktop:install` builds the release binary and runs `scripts/install-linux.sh` (~/.local/bin + app-launcher entry). `--uninstall` removes it.
- **Verified on this machine (v0.1.0 CI builds):** the tarball binary and the AppImage both launch and auto-select NVIDIA. The AppImage is slower (~23 fps vs 35–50 for the tarball on the system's newer WebKitGTK 2.52), so the tarball stays the recommended Omarchy download.
- **Not yet verified:** the Windows installer on real hardware.
- The repo is public (2026-10-05). All four `releases/latest/download/…` links work anonymously, and the live site shows v0.1.0 with OS-matched buttons.

### Desktop shell (Tauri) — GPU findings (2026-10-05)
- `src-tauri/` hosts the same web game in WebKitGTK on Linux. `npm run desktop`, `npm run desktop:nvidia` (via `scripts/run-nvidia.sh`), `npm run desktop:build`.
- WebKitGTK has **no WebGPU**, so the game uses the WebGL2 backend there.
- Presentation paths on Intel + RTX 4050 under Hyprland (10 s WebGL canary, `debug/canary.html`):

  | path | result |
  |---|---|
  | native Wayland + dmabuf | Wayland "Error 71", WebKit aborts (the compositor rejects NVIDIA buffers) |
  | native Wayland, no dmabuf | works on NVIDIA, frames copied through RAM, ~45 fps cap |
  | XWayland + dmabuf | GBM allocation fails, no frames |
  | **XWayland, no dmabuf** | **works on NVIDIA at full 144 Hz**: the default in `run-nvidia.sh` |

- Full game on NVIDIA in the desktop shell, window 936×1138: High 27.5 fps with the HUD (39.5 without), Medium 47 fps. Intel in the same shell: ~13.5 fps on the title screen.
- The bottleneck is WebKit overhead, not the GPU. GPU utilisation sits around 50%. Per-frame costs:
  - **draw-call submission:** render call 13–25 ms, from ~5k calls/frame on High.
  - **HTML/CSS compositing over the canvas:** worst on the title screen, where hiding the UI doubled fps.
- Next optimisation targets:
  - share materials across instances so meshes merge
  - drop the GTAO pre-pass on WebGL
  - merge the character/hand meshes
  - throttle the minimap canvas
  - remove CSS filters/backdrop-blur from always-on HUD layers
- Debug URL flags: `?bench` logs fps and update/physics/render ms every 2 s to the console (the desktop shell prints console output to stdout). `?autostart` skips the menus. `?skip=…,ui` hides the HTML overlay.

### What works

**Engine (`src/engine`)**
- Three.js r186 `WebGPURenderer` with automatic WebGL2 fallback (backend shown on the title screen).
- Post stack (`postfx.ts`, all TSL): ambient-only GTAO pre-pass → raymarched shadow-map godrays (bilateral-blurred, additive) → bloom → orange/teal split-tone grade → ACES → SMAA → radial chromatic aberration, warm vignette, film grain. Gameplay overlays: damage flash, detection pulse, EMP static/tearing, fade.
- Quality presets low/medium/high/ultra (pixel ratio, shadow map size, AO, godrays, dust count, grass density), switchable live in Settings.
- Rapier (WASM) physics: heightfield terrain, static colliders, kinematic character controller (autostep, snap-to-ground, slope limits).
- Fully procedural Web Audio: wind bed with gusts, ambient synth pad that opens up with tension, HRTF-spatialised loops (drone hum, campfire crackle, neon buzz, generator), ~30 synthesised one-shots, an alarm siren, and optional speech-synthesis megaphone taunts.
- Input with pointer lock, a typed event bus, and seeded noise utilities.

**World (`src/game/world`)**
- Single shared `Heightfield`: dunes, terraced mesas, a dry wash, bounding mountains, and flattened pads for the roads, landmarks and bunker. A far-terrain ring and a ruined city skyline fill out the horizon.
- Terrain shader: sand with wind ripples, cracked salt flats, layered rock strata on slopes, scrub patches, a crumbling highway (cracks, faded dashes, sand drifts) and dirt tracks. Detail comes from surface-gradient bump mapping.
- Time of day: a full 26-minute day/night cycle keyed on sun elevation. It drives the procedural sky (sun disk, cirrus, stars, moon), analytic height fog that shares the sky's haze colour, sun or moon shadows, hemisphere fill, a cube-camera environment map and the rim light.
- Props: instanced rocks and dead trees, wrecked sedans, leaning telephone poles with sagging wires, three satirical billboards, rolling tumbleweeds, and wind-swaying scrub streamed around the player.
- FX: GPU dust motes lit by forward scattering, drifting ground haze (soft particles), a campfire with embers and a flickering light, volumetric light cones, and an EMP shockwave.
- Landmarks: **Last Chance Gas**, a camp with a flickering neon sign and string lights (spawn point, rest/save). **The Spire**, a collapsed lattice tower with a blinking aviation light.

**Bunker: Tier 1 "The Garage" (`src/game/bunker`, data in `src/content/bunkers/garage.ts`)**
- Perimeter: razor-wire fence with a padlocked gate (3-pin lockpick) or a secret NE gap that is only usable once you have the blueprint intel. Three tin-can tripwires: crouch to step over them, or disarm them with Electronics 1.
- SeedBot, the guard drone: patrol → suspicious → alert → search state machine, a vision cone with line of sight, and a detection meter that accounts for distance, stance, night and archetype. It browns out every ~25s (12% battery), is knocked out by EMP, and catching you means a taser zap and waking up outside the fence.
- Entry: side door with a 4-pin padlock, or short the keypad (Electronics 1, oscilloscope minigame).
- Interior: two laser tripwires (jump the low beam, crouch under the high one) or cut them at the fuse box. Without Electronics this costs you health.
- Vault: 5-pin lock, or the keypad (code hinted on the whiteboard and in the blueprint; 3 wrong guesses trigger the alarm). Three loot containers roll the data-driven loot table, then the "BUNKER BUSTED" finale plays.
- Megaphone taunts from Tanner Pivotson with subtitles. Floodlights at night, alarm lighting, and the roof is cut away while you're inside.

**Gameplay / UI**
- Character select (Infiltrator / Engineer) with a live 3D preview at the campfire. Each archetype has its own model look, stats, starting kit and signature perk.
- Procedural character: primitive-built scavenger with a walk/run/crouch/jump/interact procedural animation, plus coat, scarf and antenna secondary motion.
- Third-person camera: collision, shoulder offset, sprint FOV kick, trauma shake, tighter framing indoors.
- HUD: objective tracker, toasts, segmented health, XP and level, hotbar, rotating minimap with compass and fog of war, clock and day phase, detection eye, stance pills, interaction prompts, subtitles, banners, level-up burst.
- Inventory and skills panel (grid, item details, use, carry weight, skill point spending), world map with intel log, intel reader, pause, settings, controls.
- Minigames: pin-tumbler lockpicking (find the binding pin by feel, sweet spot, overset strain, picks break), signal-match circuit bypass, keypad.
- Progression: XP from locks, intel, discovery and loot; level-ups grant skill points; 2 skills (Lockpicking, Electronics) with per-level effects.
- Save/load: localStorage autosave every 60s, saving on rest, manual save from the pause menu, and Continue on the title screen. Fog of war is RLE-encoded into the save.

### Stubbed / simplified
- Only 2 skills and 2 archetypes (per the MVP spec). Hacker and Brute are not in yet.
- The survival layer (hunger, thirst, radiation) is not implemented. Rations and shakes only heal.
- Grenade bounce uses a ray-reflect approximation, not a real rigid body.
- Drone pathing is a waypoint loop with wall-sliding avoidance, not navmesh pathfinding.
- No NPCs or traders yet; intel is delivered as world notes.
- No gamepad support.

### Next steps (v0.2 per spec)
- Tier 2 "Apex Vault" and Tier 3 "The Panopticon" as new `Bunker` data files plus builders.
- Hacking minigame v2, a proper stealth model (light and shadow sampling, noise propagation), crafting from scrap.
- Extract the generic bunker runtime (layers, obstacles and solutions) from `Garage.ts` so new bunkers are mostly data.
- Performance: chunk the terrain into LODs, impostor far props, GPU-instanced scrub via compute.

## Mobile / touch pass (2026-10-06, v0.1.9)

**What works**
- `src/engine/device.ts` detects phones and tablets (mobile UA or coarse pointer with touch; `?touch=1|0` overrides) and sets `html.touch`. Touch devices get:
  - fullscreen + landscape lock on the first tap (`pointerup` is the gesture that counts for touch; `pointerdown` isn't)
  - a "turn your phone sideways" screen in portrait
  - `lowfx` CSS
- **Input:** on touch, "locked" means "touch controls live". `requestLock`/`exitLock` flip it synchronously, so the pause/modal flow is unchanged.
  - `bb-lockchange` is now dispatched in a microtask, for every capture kind. Callers like `exitLock(); openInventory()` get the panel up before `onLockChange` decides whether to open the pause menu. Native capture on Linux used to dispatch synchronously.
  - `Input.moveX/moveZ` carry the analog stick. `Player` scales speed by how far the stick is pushed.
- **`src/ui/TouchControls.ts`:**
  - a floating move stick on the left 42% (dragging past 1.4× the ring, forward, sprints) and drag-to-look on the right
  - buttons for jump, crouch (a toggle), use (lit when there's a prompt), ALT (the secondary action), torch, pause, kit and map
  - Any element with `data-key` acts as a button: the HUD prompts and hotbar slots on touch.
- **Minigames** use pointer events: press on a pin to choose and lift it. The scope follows a drag. Lockpick, circuit and keypad have on-screen Back/Abort/Leave buttons on touch.
- **Layout:** a `@media (max-height: 560px)` block compacts the title, character select, modals, settings and minigames for phones in landscape (also short desktop windows). Every modal header now has a ✕.
- **Rendering on phones:** quality defaults to Low. Pixel ratio is capped per preset (`MOBILE_PR`: 1.25/1.5/2/2.5), with SMAA forced on, shadow maps ≤ 2048, and dust and grass cut by 30–40%.
- **iPhone:** Safari has no element fullscreen, so the title shows an "Add to Home Screen" tip. `play/index.html` links `play.webmanifest` (`display: fullscreen`, `orientation: landscape`, scope `/play/`), so the installed icon opens fullscreen. Android's "Install app" uses the same manifest.
- **Site:** phones were detected as Linux (Android) or Mac (iPhone). They're now `mobile`, and the main button reads "Play on your phone".
- **Harness:** `scripts/dev/mobile-shot.mjs` emulates a phone in landscape (844×390 @3x, touch, Android UA) and drives taps, drags, holds and two-finger gestures through CDP.

**Not verified:** real-phone frame rates. Headless emulation renders on the 4050, so its fps means nothing for a phone. If a phone struggles, the next levers are:
- a lower `MOBILE_PR` for Low
- skipping godrays/bloom on mobile
- fewer scrub instances

## Sound pass (2026-10-06, v0.1.9)

The owner found the constant wind annoying and could never hear any music. Both were real problems:
- **Wind:** the old bed was two band-passed noise layers plus a 90 Hz rumble that never stopped (about −25 dB).
- **Music:** the old "music" was a single four-oscillator drone at 6% gain, low-passed to 500 Hz and buried under the wind.

**What works**
- **Ambience** (`audio.ts`):
  - a soft breeze on a random walk, with near-silent lulls
  - discrete **gusts**: a swelling band-pass sweep with a faint whistle, drifting across the stereo field; more frequent in strong wind
  - wildlife: crickets after 19:30 and at the campfire, cicadas on afternoons, an occasional distant coyote (sometimes answered) at night
  - indoors (`garage.playerInside`) the ambience bus low-passes to 650 Hz and drops about 5 dB
  - storm layers unchanged
  - the campfire loop lost its noise roar: now a soft flicker with crackle clusters and pops
- **Music** (`music.ts`): a beat-clock scheduler (72 BPM, 350 ms lookahead).
  - Instruments: Karplus-Strong guitar, bass and palm-muted strings rendered into cached buffers (tuning measured within 5 cents up to E5), detuned-saw pads, a gliding sine whistle with vibrato and breath, synth kick/snare/hat/tom.
  - A dotted-eighth echo and the shared reverb.
  - Moods come from `Game.frame`:
    - `title`: written 8-bar theme, then a guitar variation
    - `camp`: sparse night guitar
    - `play`: a cue (pad → arpeggios → bass → melody → outro, 26–34 bars), then 10–21 bars of rest
  - Stems on the same clock: a palm-muted pulse with a heartbeat (from drone suspicion) and drums (alarm).
  - Stingers: `audio.sting('busted' | 'caught')`.
  - Mood changes fade the bus and kill held voices.
- **Levels** (headless capture, master tap before the compressor):

  | Scene | Music | Ambience |
  |---|---|---|
  | Title | about −31 dB RMS | −45 dB |
  | Daytime cue | −31 to −35 dB | −39 to −50 dB |
  | Alarm | about −27 dB | |
  | Campfire | −36.5 dB | fire −39 dB |

  A 1.5× makeup gain after the master compressor brings the quieter mix back to a normal level.
- **Tooling:** `scripts/dev/audio-capture.mjs` records the master mix to a WAV, with per-bus dB once a second. `--during` scripts the scene. `ffmpeg … showspectrumpic` turns the WAV into a spectrogram to look at. `browser.mjs`'s `launch()` takes extra Chrome args.

**Not verified:** how it actually sounds. Nobody has listened yet; only levels, spectrograms and pitch were checked. Owner feedback decides the next tuning (melody taste, whistle level, gust frequency).

## Story and systems pass (2026-10-06)

The Garage is still the only building. This pass is about why you are standing outside it, and about the sheet you bring. Shaders, materials, and the world look were left alone.

**What works** (headless Chrome, clicked through on the dev server):
- A new game opens on Mara Voss's radio. Four pages: the camps are thirsty, the job is Tanner's cistern and the Seed Manifest, your own reason, and where to start. Skip finishes the call. `?autostart` and any save that already heard the intro skip it, so the harness and old runs are not stuck on the radio. The wasteland stays quiet until she hangs up.
- Four people can take the radio. Rue Calder (locks, quiet), Nash Okonkwo (circuits), Paz Duarte (charges, a heavier pack, louder feet), Len Cho (he already knows how to talk). Each has a motive, a partial skill line, one unspent point, and a different pocket. On a short screen all four cards are on the page and the write-up scrolls.
- Six skills, five ranks, and a careful Garage run will not fill the sheet. Lockpicking and electronics do what they did. Stealth changes how loud you are and how fast SeedBot fills. Demolition is the loud door, and the quiet one if you crouch at rank 4. Survival is hunger, thirst, falls, and the pack. Social engineering is what Tanner will admit on the intercom, one rank at a time, up to the vault code said out loud.
- Hunger and thirst drain while you walk. The hotbar is EMP, ration, water, medkit. A dry mouth slows you. Overburdening slows you further, and the story loot still comes with you. Dying is a debt: half a life back at the fire, not a nap. Only Survival 5 sleeps you all the way back.
- The campfire is one panel. Rest and save, five scrap recipes, and the radio. Before the job, Mara repeats it. After the vault, she reads the names. Vesper Kade cuts in and names Apex Vault, west of the salt. That door is not on this map. The objective says so.
- J opens the journal. The corner objective changes with what you have actually learned: the pump note, the cooler, the fence he never paid for, the intercom, the debrief.
- A v1 save migrates. Hunger and thirst get a default, the four new skills start at zero, and an old `intro` flag counts as already briefed.

**Stubbed**
- Apex is a name on the radio. No second bunker, no hacking minigame, no new stealth lighting.
- Camp craft is the five recipes. No bench.

**Next**
- Walk the Garage once as each person. The numbers want a human pass before they are trusted: which door is free, which one is miserable.
- The owner asked to ship this for a live playtest. That walk is now the playtest. See the v0.2.0 section.

## Dry Creek, the wash, and focuses (2026-10-06)

The sheet from the systems pass had nowhere new to be spent, and the map still had one building. This pass copies the gas-station kit (memoized materials, batched boxes, canvas signs, neon, string lights) into more places. It does not add a shader, and it is not six copies of the Garage.

**What works** (headless Chrome on the dev server, teleports plus screenshots):
- Dry Creek, west of the highway: diner, clinic, the Till, a three-room motel, a water tower, a shed. Nia, Doc Ivers, Inez, Sol, Ren. Doors are 1.5 m and 2.15 m tall. The closet in the Till opens onto a stair (lockpicking 3, a charge, or Social 4 with Inez). The page is on the loft. A player on the ground floor cannot reach that prompt. The loft floor holds the capsule.
- The clinic generator is an electronics check. The freezer is a harder one. The motel's middle door is a 3-pin. The boarded room wants a charge. Stealth 2 crouches the till. Survival forages the wash behind the motel and, with 4 or a quiet 3, the crate under the tower.
- The Cut is a cave on the north ridge. The mountain beside it is still a cliff (about 80°). The way up is a carved wash north of the spire, posted, max grade about 19° on the centerline. The player stands on it and does not slide. Wick is in the main chamber. A charge opens the side pocket. The cave marker stays off the map until someone tells you, or until you walk into it.
- At rank 2 a skill offers two focuses. The point spends and the rank stays. Feeler, Spare Tension, and the other ten are wired (locks, EMP, noise, town social checks, food, rest). Rue can buy one on day one.
- `?autostart` still lands in play with no radio call.

**Stubbed**
- Apex Vault is still a name on the radio. Not in this release.
- Town people are batched primitive figures, the same language as the props, not a second character model.
- The wash is a grade cut into the heightfield. It is a path, not a switchback trail with handrails.

**Next**
- The owner's live pass: which Dry Creek door is free, which one is miserable, and whether the wash is obvious enough from the spire.

## Ambience pass (2026-10-06)

Places should sound like places. Every reserved `AmbientKind` now has a voice, footsteps know what they land on, rooms ring, and the outdoor bed follows the weather. Everything is still procedural: native Web Audio nodes only, no worklets, no samples.

**What works**
- **Positional voices** (`src/engine/ambient.ts`). Each is a handful of nodes on the shared noise buffer:

  | Kind | What you hear |
  |---|---|
  | `drip` | Three drip points on irregular clocks. Each drop is a rising sine "plink" (the bubble resonance), with the odd low plop, through a short dark echo. |
  | `hum` | 120 Hz with harmonics, two near-unison partials beating slowly (~0.4 and ~0.9 Hz), fan air, and a faint coil whine that wanders and drops out. |
  | `wind-hollow` | Noise into narrow pipe resonances (f0, 2f0, and a whistle at 3f0). Level and pitch ride the weather wind and gusts. |
  | `radio` | AM-band babble under static: a sawtooth through two moving formants, in syllables with a falling phrase pitch. It fades like a far station, with a tuning sweep every 25–60 s. |
  | `projector` | One rendered second of 24 fps claw-and-sprocket clatter on a loop, a motor whir, a cooling fan, and a speed that wanders ±1.5%. |
  | `crowd` | Two voice chains taking turns among three speakers, muffled to a murmur and sparse. Every 30–80 s someone laughs, and another often joins in. |
  | `sparks` | Quiet, then runs of arcing: a stuttering 120 Hz buzz, crackle, and a pop. |

  The four old kinds (drone, fire, neon, generator) moved here unchanged, except the generator (see below).
- **Distance gating** (`SpotManager`):
  - A spot has no nodes until the listener is inside its kind's range (14 m for neon … 90 m for the drone).
  - It fades in over the last 30% of the range. Beyond 1.08× the range it is torn down: sources stopped, panner disconnected.
  - Intermittent sounds are scheduled from `tick()` with a 0.15 s lookahead, so they stop with the spot.
  - `audio.loop()` keeps its handle API (`setPosition/setGain/setPitch/stop`).
- **Footsteps by surface** (`src/engine/surface.ts` + `src/engine/foley.ts`). One Rapier ray goes down per step.
  - **Terrain:** sand by default. Asphalt on the highway (< 3.9 m from `HIGHWAY`), gravel on the dirt tracks and the ridge wash, rock on slopes over ~30°.
  - **Floors on the terrain:** most floors in this world are visual slabs on the terrain, so terrain under an *enclosed* player takes the landmark's interior floor: Garage concrete, Dry Creek wood, the Cut rock, and the sites from a table. The gas forecourt and the Garage apron are concrete zones.
  - **Other colliders:** first a tag or zone, then the landmark table, then the collider's shape: balls are boulders (rock), cylinders are wood, loose boxes are car wrecks (metal). Sites that want exact floors can use `surfaces.tag(collider, kind)` or `surfaces.zone(min, max, kind)` from `@/engine/surface`.
  - **The sounds:** seven surfaces, each a heel knock, the surface's own voice and a toe scuff. Crouched steps roll the foot: 5–8 dB quieter, darker, no scuff. Jumps push off. Landings put both feet down with a surface layer (grit spray, board boom, plate ring).
  - Sprinting now raises dust only on sand and gravel.
- **Rooms:**
  - **The probe:** `Acoustics.update` casts one ray up and a fan of 12 rays at 2.6 m above the feet, half of them every 0.15 s. At 2.6 m the fan clears pumps and cars and passes over door lintels. Most roofs have no collider, so the walls decide.
  - **Probe tour:** 1.0 in every Dry Creek room, the Garage house and the cave; 0.0 on the forecourt, the Garage yard, the street and open ground.
  - **Two convolution reverbs:** small (0.5 s RT, bright) and large (1.9 s, dark), blended by mean wall distance. A rock floor pushes toward the large one. Each reverb is connected only while it's being fed, and disconnects once its tail has rung out, so outdoors it costs nothing.
  - Footsteps, loops and positional one-shots feed the reverbs through a 150 Hz high-pass.
  - Enclosure also drives the old indoor muffle and switches off the crickets.
- **Outdoor bed:**
  - Gusts also ride the weather's own surges (the wind above its running mean), so you hear the storm's gusts when the dust leans.
  - Night adds a quiet two-band insect chorus behind the crickets.
  - A distant hawk calls on hot days, every 2–5 min. The coyote is rarer (every 100–260 s).
  - The storm layers, plus a new sand-grain tick, are built when a storm starts and torn down after it clears. They used to run silent all session.
  - The storm wall on the horizon (`Weather.front`) brings a low roar, panned from upwind.

**Changes to existing sound**
- **Generator loop: −9 dB.** It was −18.6 LUFS at 4 m, 17 LU over the fire, and pumped the master compressor.
- **Footsteps are drier outdoors.** Their hall send went from 0.35 to about 0.1. Their level matches the old `step` sfx (offline renders, mean RMS).
- **Indoors, the desert bed drops 7 dB** (was 5).

**Levels** (headless, master tap, each loop 4 m away with ambience and music muted, EBU R128):

| Voice | LUFS |
|---|---|
| fire (reference) | −36.7 |
| generator (after −9 dB) | −27.6 |
| drip | −41.8 |
| hum | −36.5 |
| wind-hollow (calm) | −41.6 |
| radio | −38.4 |
| projector | −40.1 |
| crowd | −36.0 |
| sparks | −38.9 (peaks like the fire's crackle) |

- **Night bed:** ambience −41 to −48 dB RMS against music at −34 to −35.
- **Storm front:** −36 to −38 dB.

**CPU**
- **Frame update:** `?bench` with 20 loops on the map (the game's 10 plus 10 test loops) gives update 0.42–0.52 ms whether all are far or all 10 are within 9 m. The audio engine's own per-frame JS is 0.03–0.05 ms.
- **DSP:** `game.audio.benchVoices(kinds, secs)` renders offline with incremental scheduling. Each voice costs about 1–9 ms per second of audio (radio and crowd cost the most); all 11 at once is about 60 ms/s. In play, only the 1–3 spots near you exist.

**Tooling**
- `audio-capture.mjs` also taps the new `foley` bus (footsteps + loops).
- `game.audio.spotStats`: how many spots exist, how many are live, and the reverb state.
- `game.acoustics.room` / `.surface`: the probe's current reading.

**Not verified**
- How any of it sounds. As before, only spectrograms, R128 loudness and offline renders were checked.
- The desktop app's (WebKitGTK) audio thread was not measured.
- `sparks` runs on its own clock, so a site's visual sparks won't line up with it unless they share a trigger.

**Next**
- The owner's ear: voice taste (the radio and crowd babble especially), the night chorus level, the generator cut.
- Sites can tag exact floors with `surfaces.zone(...)` and place spots by kind. Nothing else is needed.

## Graphics pass (2026-10-06)

The baseline looked milky by day, one-note orange at golden hour, and flat on the ground. Most of that was the air, not the models. This pass changes shaders, the sky, the fog and the post chain. It adds no draw calls, no lights and no passes.

**What changed** (headless WebGL on the dev server, same cameras before and after; WebGPU on the Intel iGPU spot-checked):
- **Godrays had no phase function.** The raw march is "how much lit air is on this ray", so it laid an even veil over every view, noon included. It is now weighted toward the light direction, so shafts gather toward a low sun and the rest of the frame stays clear.
- **Fog:** a clear near zone (the first tens of metres stay crisp, except in storms), aerial perspective that tints far ridges with the horizon colour, lighter day haze. At golden hour the haze is golden only on the sun's side and cools to rose-blue away from it.
- **Grade** (`gradeU` in `postfx.ts`, keyed on sun elevation in `Atmosphere.GRADE`): a split tone in scene-linear light, a contrast pivot at mid grey, ACES, then saturation. Teal shadows and amber light at golden hour. Blue, desaturated moonlit darks at night, while lamps, neon and fire keep their colour (saturation follows luminance). Storms grade to one warm murk. Exposure is applied before bloom, so the threshold means the same at noon and at night. AgX was tried: neon and sunsets went grey, so ACES stays.
- **Lens:** chromatic aberration falls off with r², so the centre is clean. The vignette is neutral; its warm tint was what turned the moon peach.
- **Sky:** white sunlit cirrus. A milky way with a bright core, dust lanes and a warm centre. Round, anti-aliased stars with a real magnitude spread (the old ones were square cells, too many and fringed). A crisp silver moon. The whole night block sits behind a uniform branch, so it costs nothing by day.
- **Terrain** (material code only):
  - Rock reads as rock: an irregular stack of sediment layers from the atlas instead of sine stripes, plus desert varnish streaking down the cliffs.
  - A baked cavity texture (height minus its blur at two radii) darkens and dampens hollows, bleaches ridges, and occludes sky light in folds through `aoNode`.
  - Sand: ripples are anti-aliased (they made moiré bands mid-ground). A broader ripple field catches low sun. Wind streaks, and a soft sheen.
  - The highway is grey, sun-bleached asphalt with alligator cracking in patches, tar repairs, wheel paths and oil. The old crack network everywhere read as paving tiles.
- **Materials** (`settle()` in `materials.ts`, every family):
  - Sand settles on upward faces. There is more after a storm (`atmo.dustCover`), and it blows off over minutes.
  - The sides of anything standing on the ground get a grimy, sand-stained foot and contact occlusion. This uses the terrain height texture, which `heightTexture()` now memoizes and registers. WebGL has no GTAO, so this is the fake AO.
  - Concrete has bug holes and a few hairline cracks instead of a cell mosaic.
  - The fake sun rim switches off at night. It was the blue glow on fabric indoors.
  - At golden hour, backlit silhouettes get a thin warm rim.
- **VFX:**
  - `lightCone` now falls off from the lamp, carries two layers of dust, and fades softly where it meets geometry. All its parameters are uniforms, so it is one program instead of four. SeedBot's beam is a readable volume, not a blown-out disc, and it sends sonar rings (slow on patrol, fast when it is looking for you).
  - The campfire is a turbulent teardrop with tongues and a heat ramp, instead of a white streak.
  - Heat shimmer over distant ground on clear afternoons. It is folded into the lens pass's existing taps.
- **Storms:** the dome uses exactly the fog colour, so far ridges melt into it. The storm fog term no longer follows the lighter day density.

**Cost** (`ab.mjs`, Intel iGPU, 1600×900 High, 7 spots, main vs this branch):
- Draw calls are identical at every spot, and render CPU ms is within noise.
- GPU time is about +1–2 ms on the iGPU (fps noise is about ±1.5). That is after merging taps: terrain masks share fetches, the dust layer takes its grain from one tap, and the stars use two hashes per cell.
- The desktop target (4050 in WebKitGTK) is bound by draw-call submission, so this should not move it.

**Not done:**
- The Garage lasers live in `GarageBuilder.ts` (perf agent's file) and are unchanged. A heat-shimmer or dust-glint upgrade belongs there.
- No edge wear: flat-shaded boxes give the shader no curvature to find edges with.
- Sand glints in sunlight were skipped: emissive can't know the shadow, so they would sparkle in shade.

**Next:**
- Look at it in the desktop app: the grade, the night exposure and the shimmer at 144 Hz.
- Tune the `GRADE` keys with the owner. Each is a one-line edit.

## Story & systems pass 2 (2026-10-06)

Act I now has a plot, a quest log, people who keep score, real skill trees, and six people to pick from. No new shaders or geometry: this pass is content, game state and UI.

**What works** (headless Chrome on the dev server: scripted playthroughs as all six people, plus a v1 and a v2 save loaded through Continue):
- **The arc.** Day 1,284. Last Chance has three days of water and SeedBot lifts the camp's jugs. *Middle:* Dry Creek's creek was signed away to Kade Holdings the summer before the Pivot (permit 7-K, a clipboard on the highway west of camp, approved "M. Voss"). A valve tag on the dirt spur, or Tanner on the intercom (Social 2/3), shows that Bunkr.ly resold seats in Vesper Kade's Apex Vault and paid her in water (waitlist #4,012). *Turn:* the manifest's last page is the Seed, the people Vesper keeps, and Mara is on it. Vesper cuts into the debrief and offers twenty jugs a week for the ledger. *End:* read every name on the open net, keep it as leverage, or take the deal. Each ending pays differently and moves standing, and all three land on the same hook: the water is on a clock and the rest of it is in Apex Vault, west of the salt.
- **Delivery.** Mara's camp radio is progress-aware (and owns up to the permit). Tanner has new branches and taunts. Banter (`content/banter.ts`) is one-shot subtitle lines from Mara or from you, gated on places and flags, at least 40 s apart, never over another subtitle, never in menus or alarms.
- **Quests** (`content/quests.ts`, runtime `game/Story.ts`). Steps are pure functions of flags, so fresh, loaded and migrated runs agree. Progress is stored as flags (`q:<id>`, `q:<id>:<step>`, `q:<id>:done`). A toast per step; a banner plus XP, items and standing on completion. The corner objective follows the tracked quest, else the main story; the Garage's own advice still wins while you stand at it. The current step's landmark gets a gold map marker.
- **Ten favours.** Nia (who is drinking her water: tell her, cover with 2 bottles, or Social 3 peace), Doc (power, then a medkit for Wick: deliver it or keep it), Inez (the Till's deed: to her or to the town), Sol (his pick roll: return it or unroll it), Ren and the drive-in (tell Ren how the keynote ended, or say it was static), Wick (the rockfall, then Vesper's crate: take it or leave it), Pip's ledger at the camp, and three site quests (the jet via Wick, ColdStorage via Mara, the Tube via Inez). Site quests only read `seen:<id>`, `site.<id>.found` and `site.<id>.done`.
- **Standing** (`content/people.ts`) for twelve people and two places (Dry Creek, the Compact). Favours unlock services: Nia's plate and Doc's house calls (once per rest), Inez's price (2, 3 or 4 scrap), Sol's lesson (the picks recipe makes 3), Wick's seep, Ren as the camp's lookout. After Act I anyone at standing 2+ joins the crew for Apex. The camp panel lists Hollis, Pip and Dez (and Ren); Dez packs an EMP from a cell and scrap.
- **Six archetypes.** New: Juno Reyes, Scout (Survival 2, Stealth 1; Long Walk: needs drain 25% slower, falls hurt 25% less) and Theo Vance, Defector (Electronics 1, Social 1; Insider: Tanner hears one Social rank more, Dry Creek one less). Scout borrows the work gloves, Defector the thin ones (`handArchetype()`).
- **Skill trees.** Ranks 1–5, a focus at rank 2, a capstone at rank 4 (one of two, costs a point, no rank). All twelve capstones are wired and were checked in the page: Bump Key, Master's Hands, Salvage, Overclock, Shadow, Exit Plan, Bench Chemist, Blast Proof, Camel, Pack Rat, Handler, Word of Mouth. Minigame effects live in Game's `makeContext` wrappers, so every lock and board gets them. Fixed: Hot Line made the fuse box harder (its difficulty floor was 1).
- **Screens.** Kit, Skills (K) and Journal (J) are one modal with tabs; the key for the open tab closes it. Skills: six skills on the left, the selected tree with costs on the right. Journal: quests (track, steps, hints, how it ended), people (standing, what they think of you and of each other, favours), the story so far. Dialogue and radio cards show a monogram, role and standing; Vesper's say "unknown carrier".
- **Character select** shows all six cards at 1280×720 and up: a 3×2 roster over one sheet (motive, playstyle, skill line, build bars, pocket, passive). Arrows and Enter work.
- **Save v3** adds `capstones`, `rep`, `tracked`, `rests` and `marks`. v1/v2 saves load with defaults; a v2 run that already heard the debrief counts as "read the names"; Sol's roll and the deed are handed over if that room or loft was already looted; finished quests catch up quietly (XP and standing, no second pile of loot) with one toast.
- Fixed: "info" toasts were 220 px tall (the kit card's `.info` rule matched them).

**Stubbed**
- Act II is a quest with a crew step and a locked "Reach Apex Vault" step. No Apex yet.
- The four sites are built by other passes. Their quests trust the three flags and nothing else.
- The camp's people have no 3D figures. Ren "walks to Last Chance" but still stands in Dry Creek.

**Next**
- Play Act I end to end as two different builds and cut any line that runs long as a subtitle.
- Once the sites land, tune each site quest's wrap line to what its secret actually is.

## Sites: Exit Strategy & Starlite (2026-10-06)

Two points of interest by the same founder. Hunter Vale (Ascend, "EXIT: evacuation as a service") launched at the Starlite with a keynote, then left early in his own jet, alone, by parachute. Code: `src/game/sites/jet.ts`, `drivein.ts`, art in `jetArt.ts` / `driveinArt.ts`, shared kit in `jetKit.ts`.

**What works** (headless Chrome, teleports, scripted walks, screenshots by day, golden hour and night):
- **The Exit Strategy** (−300, 255). A business jet broken in three along a ploughed gouge: the nose dug into a sand mound (airstair down, galley, a cockpit you can see out of), the cabin (cream leather club seats, divan, credenza, oxygen masks, a roof tear and windows that let the sun in as shafts), the tail (lav, wardrobe, baggage hold, T-tail with a red ELT strobe). The right wing stands tip-down in the dune. The SafeExit airframe parachute lies half-inflated on the slope behind, gold and cream, trailing risers to the tail: it is the silhouette from the road, and you can walk under it. Debris: suitcases, champagne crates, seats, an exercise bike, the gold EXIT brochure.
- Jet interactions: the napkin on the yoke, the flight recorder (Electronics 1 + circuit; the transcript gives the hold code), the Ascend concierge sat phone (Social 2 remote-opens the hold), the hold itself (Lockpicking 2 pick, Demolition 2 charge, or the keypad code `0000`), the go bag inside (crouch in), the raft survival kit (Survival 2), the galley, the brochure. Flags: `site.jet.found` (inside the cabin), `.note`, `.cvr`, `.code`, `.phone`, `.hold`, `.done` (go bag taken), `.raft`, `.galley`, `.brochure`.
- **Starlite Drive-In** (−20, −132). Rotation changed 0.2 → −0.45 so the screen faces the spawn, the gas station and the west highway instead of a 22 m mesa; flatten r 38 → 46. A 30 × 14 m screen on a lattice tower with missing and hanging panels and the faded ASCEND print; four arcs of car ramps with procedural rusted cars and speaker posts; snack bar and projection booth (menu, popcorn machine, projector with reels, rewind bench); generator; ticket booth and barrier; the STARLITE marquee with missing letters, a pink/cyan neon header and a chaser-bulb star; fence, light poles, playground.
- **The signature**: power the generator (Electronics 1 circuit, or swap in a Lithium Cell), get into the booth (Lockpicking 2, Demolition 1, or the staff key from the manager's wagon with Survival 1), start the projector. A volumetric beam (rounded frustum, dust, flicker) throws a 62 s keynote loop (film leader, slides, an APPLAUSE sign, a backstage hot mic), drawn on a 512×240 canvas at ~10 fps, onto the screen as emission. The screen tints a 90 m light over the cars, and subtitles run while you are in the lot. The hot mic points at the jet ("wheels up at eleven, north-west, one passenger").
- Drive-in flags: `site.drivein.found` (in the rows), `.power`, `.key`, `.booth`, `.screening` (projector on; it toggles), `.started`, `.done` (heard the hot mic in the lot), `.reel`, `.note`, `.tickets`, `.snacks`.
- New items: `exit_pass` (EXIT Platinum Pass), `keynote_reel` (Keynote Reel, Uncut).
- Ambience: static `wind-hollow`, `radio`, `sparks` (jet) and `wind-hollow`, `neon` (drive-in). The drive-in starts its own `generator`, `projector` and `crowd` loops only while powered or screening.
- Colliders are oriented Rapier boxes and trimeshes (sand drifts, ramps) built from the same geometry. Walks tested: every jet section in and out (ramps, airstair, crouching into the hold); the drive-in side doors, booth, ramps and entrance lane.
- Draw calls (A/B against `?skip=sites`, same camera): jet heart +28, drive-in heart +25 (+27 at night with the projector), snack bar +31, each far stand-in ≤ 4, nothing past ~650 m.

**Stubbed**
- Doors snap to their flags on load. The keynote has no audio of its own beyond the audio agent's `crowd`/`projector` voices and the subtitles.

**Next**
- The owner's eye on the beam strength at night and on the golden-hour backlight (the sun sets behind the screen).
- Story hooks: `site.drivein.done` points at the jet. `exit_pass` and `keynote_reel` are trinkets with no use yet.

## Sites: ColdStorage & The Tube (2026-10-06)

Two new points of interest, each one class plus a builder and an art atlas: `src/game/sites/datacenter*.ts` and `tube*.ts`. `datacenterAtlas.ts` holds the shared bits: `SiteAtlas` (one canvas per site for signs, screens, posters, grime, pools; a lit "paint" material, alpha decals, unlit screen channels, additive pools), `pvMaterial`, `glassMaterial`, `flipInside`, and `SplitBatch` (feeds the far stand-in only what is visible from outside).

**ColdStorage** (290, −262): a 52 × 18 m hyperscale hall. It has a rooftop sign that is the site's beacon by day and night, dry coolers whose fans spin on the sun, two water tanks, a transformer yard that arcs every few seconds, three transmission towers marching off west, a comms mast, a solar car park, a fence with a gatehouse, and a loading dock with a trailer ("Egress fees apply").
- Inside: ~200 racks with perforated doors and blinking LEDs (one GlowPalette), yellow fibre trays, a contained cold aisle that is frosted, with icicles and mist, the plant area with the last SRE's camp, a glass core room, and a battery cage.
- The core room holds **NIMBUS**, an assistant still answering on solar (`converse`).
- Flags: `site.datacenter.found` is set on the raised floor. `site.datacenter.done` is set when NIMBUS gives up the dispatch logs, which name Apex Vault, west of the salt, and Vesper Kade's air-gapped copy of it. Sub-flags: `.log`, `.core`, `.power`, `.cage`, `.cells`, `.tap`, `.ai.talked/.captcha/.told/.weights/.killed`.
- Paths:
  - Core door: PIN 9995 (the SLA on the lobby whiteboard, hinted in the gate log), Electronics 2 (circuit), or Demolition 1 (charge).
  - NIMBUS: Social 2 persuades it, Electronics 2 tricks it, Demolition 1 + a charge shuts it down (it tells you everything first, then the core goes dark).
  - Switchgear: Electronics 1 lights the hall and lets NIMBUS open the cage.
  - Cage: Lockpicking 2 or a charge.
  - Cooling loop: Survival 1 fills bottles; anyone can drink the glycol side.
- New item: `last_checkpoint` (a drive with NIMBUS's weights).

**The Tube** (318, 118): LOOPR's Station Zero, a silver vault on stilts.
- The station: an open pod bay with POD-01 (gull-wing door, virtual "windows" showing a rendered beach, a flight recorder), a glass control room, a side airlock into the sealed tube, a 22-step stair, a billboard and a 24 m loop tower.
- The track: 300 m of tube on pylons (PV on top, a running-light strip on both flanks) from a portal headwall in the east hill to a torn end 230 m west, with bare pylons beyond. The span 60 m west collapsed into a V: walk in at the bottom, up the fallen span, through the tube to the airlock.
- **Signature:** power the station (Electronics 1, or slot a Lithium Cell) and the pod lurches 1.5 m against its clamps and springs back, while the running lights race outward down the track and keep sending pulses into the dark.
- Flags: `site.tube.found` is set on the deck or inside the tube. `site.tube.done` is set by reading the flight recorder (needs power): Run 001 topped out at 41 km/h, and the founder's "private extension" runs through the hill to a Terminus. Sub-flags: `.power`, `.airlock`, `.bag`, `.cabinet`, `.locker`, `.terminus`, `.blackbox`, `.ride`.
- Other paths: the maintenance cabinet (Lockpicking 1), the founders' locker on the portal (Demolition 2 + a charge: go-bag, Terminus card), the gift bag (new item `boarding_pass`), and **Run 002**, a fade-and-teleport ride to the end of the line.

**Cost** (headless WebGL, site shown vs hidden at the same view, after merging main):

| | ColdStorage | The Tube |
|---|---|---|
| Heart, day / night | 26 / 27 draws | 27 / 29 draws |
| 60 m away | 32 draws | 29 draws |
| 300 m away (stand-in) | 3 draws | 2 draws |
| Past the hide distance | 0 | 0 |

- The Tube uses a `LineLod` measured from the track, not a centre, so the whole 300 m line keeps its detail wherever you stand along it and drops out cleanly. Its running lights are not drawn at all until it has power.
- Light: VirtualLights only (7 + 6). Custom TSL values are uniforms.

**Walkability:** 17 scripted routes drive the real controller through every entrance in both directions: lobby, aisles, core, cage, gatehouse, yard, stair, pod, airlock → tube → break and back, the portal. All pass. Floors are tagged for footsteps: the raised floor is metal; the station deck and apron are concrete.

**Next:**
- Hear the new ambience spots in place: hum ×2 + sparks at ColdStorage; hum + wind-hollow ×2 at the Tube.
- From 300 m the Tube is a thin line by day; the loop tower and the powered lights carry it at night.
- The east portal headwall is plain. A tunnel interior would need terrain carving (not possible from a site).

## Dry Creek rebuild (2026-10-06)

Dry Creek, The Cut and the wash were grey slabs, boxes and box people. They are rebuilt to the Garage's standard. Spot, door and blocker ids are unchanged, so the story half of `Settlement.ts` did not move.

**What works** (headless Chrome, screenshots by day, golden hour and night, plus a controller walk test):
- **Town kit** (`src/game/town/townKit.ts`): a `Site` batches lit geometry, painted boards, alpha decals and additive light pools, plus halos, lights and colliders, in the site's frame. `wall()` builds walls with real openings: exterior and interior skins, a dado, casings, sills, bars, shutters, curtains, boards, and two-pane glass. The street side glows at night; the room side shows daylight by day and goes dark at night. There are also decks, sheet roofs (every slope runs along Z, so all corrugated roofs share one family draw), gutters, posts and railings.
- **One atlas** (`townAtlas.ts`) holds every sign, menu, poster, map, grime decal, floor pattern and light pool. Three materials sample it: lit boards (the top rows glow after dark), decals, and pools.
- **Buildings** (`creek.ts`, props in `townProps.ts`):
  - Diner: canopy, kick band and roof sign with neon and lamps. Inside: checker floor, three booths, a counter with stools, a back bar with an urn, a griddle and a hood, the menu board, the keypad freezer, and a dead jukebox.
  - Clinic: barred windows, a stoop with handrails, solar panels and a tank on the roof, and a generator yard with sandbags. Inside: cots, a curtain, a drip stand, a cabinet, an exam table, a sink, a desk lamp and an eye chart. The glass, tubes and light follow `creek.power`.
  - The Till: a clapboard false front with the painted sign, a porch, and stocked shelves. Inside: a bronze till, a stove, lanterns, the back room, and a loft with a bedroll, maps and the page shelf.
  - Motel: a canopy walkway and a pylon sign. Three rooms: A open and lived in, B locked, C boarded and trashed.
  - Around the street: water tower, shed, fire circle, poles and wires, streetlamps, string lights, two wrecks, laundry, drifts and grime.
- **People** (`src/game/world/npc.ts`, looks in `people.ts`): posed with IK and baked into one mesh per site. The vertex shader breathes, sways and turns head and shoulders toward you. That is 1 draw (+1 shadow) for the whole town.
- **The Cut** (`cave.ts`):
  - An SDF rock mass with the chamber, mouth tunnel and side pocket carved out, meshed with surface nets and smoothed.
  - Per-vertex sky occlusion feeds `aoNode`, so the inside stays dark and the fire lights it.
  - The collider is the same trimesh (FIX_INTERNAL_EDGES), so there are no invisible walls.
  - Wick's camp has a log seat, a cookfire with a spit, pots on a line, a radio and a lantern, water jugs, firewood and the pocket paint.
  - The build takes about 0.3 s at load.
- **The wash** (`wash.ts`): lamp posts that light up at night, cairns, a rope rail on the steepest segment, and a worn-path ribbon on the heightfield.
- **Draw calls** (`renderer.info`, 1280×720, high):
  - Town share at the street: 37 → 33.
  - A/B against main at 1600×900: creek-street 131 → 122, creek-out 124 → 113, render CPU 3.5 → 3.0 ms.
  - cave-trail 101 → 106 (the wash is richer).
  - The far LOD from 200 m: 6.
- **Walk test** (real controller at 30/60/144 fps): every door, the street lines, the walkway, the tower, the shed, the fire ring, the cave and the pocket all pass. The closet, room B, room C and the rockfall block until opened.
  - The stair has 0.25 m risers over a smooth 36° ramp collider. Autostep missed those risers at 144 fps.
  - Floors are tagged for footsteps: tile and concrete in `surfaces`, wood by default.

**Stubbed / known:**
- Faces are stylized and small. They read at talking distance, but they are not portraits.
- Windows are glow panes, not see-through interiors.
- Loading takes about 0.6 s more: the town atlas and the cave field.

**Next:**
- Owner pass in the desktop app: night exposure of the signs and windows under the new grade.
- Whether the pocket is easy to spot.
