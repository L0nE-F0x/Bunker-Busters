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

## Perf pass (2026-10-06)

The desktop app is CPU-bound in WebKitGTK: draw submission, uniform uploads and garbage, not the 4050 (GPU frame ~5 ms at 1600×900 by headless timer queries). So this pass cuts draws, the shadow pass above all, and per-frame JS. No colour shader changed.

**What changed:**
- **Shadow proxies** (`kit.ts`: `shadowProxy`, `plainCaster`, `SHADOW_LAYER`).
  - Three draws every caster in the sun's depth pass with one override material. So a static set's casters merge into one position-only mesh on layer 1 (shadow camera only), and the originals stop casting. The shadow map is the same.
  - Alpha-shaped materials (chain link) keep their own draw.
  - Used by the Garage (static set, each door, the lock, the tripwires), the gas station and the Spire.
- **Props shadow stream** (`ShadowStream` in `Props.ts`).
  - Rocks, trees, wrecks, poles, wires and billboards were ~12 shadow draws covering the whole map.
  - Their triangles sit in 32 m cells. Every 20 m of travel, the cells within 190 m are copied into one shadow-only mesh.
  - The buffer uses static usage on purpose: **three re-uploads any `DynamicDrawUsage` attribute on every draw**.
- **Far LOD**: the Garage, the gas station and the Spire swap to `buildFar()` stand-ins past ~140 m.
  - The Garage keeps its chain link. The gas station's tents keep their fabric, and its neon and sign stay drawn.
  - Checked by day and by night at the swap distance.
- **Garage**:
  - The interior's own draws (vault door, whiteboard, lasers, loot) are hidden while nobody can see in.
  - The additive lasers render in a single pass.
  - Floodlight cones skip their draw by day.
  - The tripwires are 3 shared meshes, re-merged on disarm through a handle whose `visible` does it.
  - `update()` allocates nothing.
- **Main pass**:
  - The 90 trees are one static mesh (was 3 instanced draws).
  - Billboard frames and backs are one batch.
  - Rocks draw only within size × 500 m (~2 px).
- **Renderer**: the shadow override material's `alphaTest` setter bumps its version whenever a caster's alpha test crosses 0.
  - With one alpha-tested caster in the sun's box (the sites' cut-out atlases), every shadow render object re-derived its cache key every frame. Inside the Garage that cost 0.44 ms + 440 KB/frame.
  - The bump is dropped on that material only.
- **JS**:
  - Rapier's per-step `mapNewSoftBodies()` makes a wasm→JS call per collider (~530). It now runs only after something is created or removed.
  - HUD markers are rebuilt at 20 Hz.
  - The minimap skips redraws while nothing changed: 0 standing still, was 20/s.
  - Tumbleweed zone checks run at 10 Hz.

**Numbers.** Headless Chrome, main @ 41f3ade vs this branch, interleaved runs, trimmed means. CPU measured at 480×270 so the GPU isn't the limit. Post is 22 draws in both.

| spot | draws (main/shadow) | render CPU ms | frame CPU ms | JS alloc KB/frame |
|---|---|---|---|---|
| spawn | 105 (41/42) → 82 (38/22) | 2.23 → 2.03 | 2.87 → 2.51 | 400 → 186 |
| spawn, facing the Garage | 165 (101/42) → 98 (54/22) | 3.25 → 2.18 | 3.84 → 2.60 | 450 → 187 |
| Garage gate | 185 (87/76) → 129 (67/40) | 3.03 → 2.67 | 3.64 → 3.17 | 439 → 214 |
| inside the Garage | 159 (57/80) → 128 (57/49) | 3.32 → 2.58 | 3.97 → 3.04 | 1110 → 206 |
| Dry Creek street | 118 (49/47) → 103 (47/34) | 2.45 → 2.35 | 3.06 → 2.76 | 403 → 193 |
| spawn at night | 104 (40/42) → 81 (37/22) | 2.30 → 2.04 | 2.90 → 2.43 | 349 → 169 |

- Triangles drop ~130–150k per frame (1.24M → 1.12M at spawn).
- Full-res fps on the Intel iGPU is GPU-bound (22–33) and unchanged within noise.

**Harness.** These scripts live in the perf agent's scratch dir, not the repo.
- `ab3.mjs` interleaves two dev servers per spot.
- `vcompare.mjs` shoots both builds with time pinned and diffs them. Pin time before diffing: cloud shadows, sand flow, scrub sway, the drone and the broken neon all move between runs.
- `performance.now()` is coarsened to 0.1 ms in headless Chrome, so use means, not medians.

**Next:**
- The third-person shadow body costs 16–17 shadow draws everywhere (`CharacterModel.ts`). Merging it is the biggest shadow-pass win left.
- Sites and town should call `shadowProxy(near)` on each near set. The drive-in alone adds 10 shadow draws as seen from the Garage.
- The post stack is a fixed 22 draws (`postfx.ts`).
- Terrain LOD was measured and deferred.
  - Halving the grid saves ~0.5 ms on the 4050 and ~2–3 ms on the iGPU, but the desktop is CPU-bound.
  - Coarse far terrain needs crack-free stitching and error-driven selection to keep silhouettes intact.
- Owner check in the desktop app: `scripts/dev/bench-desktop.sh high`.

## v0.3.0 overhaul: lead notes (2026-10-07)

**Why:** v0.2.0 (the Act I pass, cbace1a, written by another model) lagged badly on the desktop. Measured cause: six new point lights (16 in the scene; three.js evaluates every light in every lit fragment) and Dry Creek drawn in full from 200 m away. Its systems worked (radio, talk, camp and journal were clicked through without errors), but its new art was far below the Garage.

**Shared mechanisms every pass now relies on:**
- **`world/lights.ts`: VirtualLight + lightPool.** All point lights are data. A fixed set of real PointLights (2/3/4/5 by quality) is lent to the most important ones near the camera, with fades. The count never changes, so materials never recompile. Never `new THREE.PointLight` in world code.
- **`kit.ts`:**
  - `MeshBatch.buildFar()` + `DistanceLod`: one-draw stand-ins past ~140 m.
  - `shadowProxy()`: a static set casts through one depth-pass draw (perf pass).
  - `Frame`: a landmark's local-to-world frame.
- **`src/game/sites/`:** one class per point of interest.
  - Flag contract: `seen:<id>`, `site.<id>.found`, `site.<id>.done`. Quests in `content/quests.ts` hang off those flags.
  - The sites are `jet`, `drivein`, `datacenter`, `tube`.
- **`AmbientKind` (audio.ts):** names for positional loops. Places push `{ kind, pos }` into `landmarks.audioSpots`.
- **`engine/surface.ts`:** footstep surfaces. `surfaces.tag(collider, kind)` for rotated floors, `surfaces.zone()` for axis boxes.
- **The player's shadow body** is one SkinnedMesh whose bones are the animation joints (it was 16–17 casters).

**How it was built:** seven parallel agents, one git worktree each, with file ownership agreed up front:
- perf
- graphics
- town
- story
- sites A (jet, drive-in)
- sites B (data centre, Tube)
- audio

Merged one at a time and tested after each. `Settlement.ts` was split by function: the build half belongs to the town pass, the interaction half to the story pass. Conflicts came only in appended lists (NOTES, items).

**Numbers** (headless Chrome, Intel iGPU, 1600×900 High, draws per frame):

| spot | v0.1.9 | v0.2.0 | v0.3.0 |
|---|---|---|---|
| spawn | 93 | 117 | 67 |
| Garage gate | 173 | 173 | 109 |
| Dry Creek street | n/a | 139 | 92 |
| scene lights | 10 | 16 | 10 |

The iGPU is GPU-bound in this test (~30 fps) since the graphics pass. The desktop on the 4050 is CPU/draw-bound (~5 ms GPU per frame per the perf pass), so draws are the number that matters there. Load is ~17 s headless (it was ~13 s); the town canvas, the cave and four sites add to the build.

**Next:**
- Terrain LOD (deferred: ~0.5 ms GPU on the 4050).
- The post stack is a fixed 22 draws.
- Watch load time.
- The owner's ear on the ambience, and their eye on the night grade.

## Desktop: "can't move" was shader compiles (2026-10-07, v0.3.1)
- **Symptom (owner):** in the installed app, W "moves, but very slowly" and Shift doesn't run. Mouse look worked. "Everything looks beautiful, but I can't do anything."
- **Ruled out:**
  - Physics: `walk-probe` at 20 and 144 fps, stalls only at real obstacles.
  - Input: keys and the owner's save were fine headless and in the desktop shell. The owner's traced session showed W/Shift held, 3.3 m/s walking and 6.1 m/s sprinting.
- **Cause:** nothing compiled shaders ahead of time. The boot `compileAsync` only covered the title view, and it renders to a different target than the post stack's scene pass, so its programs didn't match.
  - Every material compiled the first time it came into view: turning, walking toward something, hands rising for a sprint, the torch. WebKitGTK compiles on the main thread, so each one froze the app.
  - The traced session (warm driver cache) froze 2.3 s on the first W and 0.6 s on the first sprint.
  - Cold cache (`__GL_SHADER_DISK_CACHE=0`), v0.3.0: a 7.8 s freeze entering the game and 0.3–1.3 s per camera turn.
  - Frame `dt` is capped at 50 ms, so time lost in a freeze isn't caught up. On the first launch of a new version that adds up to barely moving. Chrome hides most of it by compiling in parallel.
- **Second cause:** lit shaders key on each light's **id** (three's `LightsNode.customCacheKey`). Every `new Hands()` made a new torch SpotLight, and the title had none. Starting a run changed the light set and rebuilt lit materials.
- **Fix:**
  - **One torch light for the session.** `torchLight()` in Hands.ts is on the camera from boot.
  - **`Game.warmShaders(...roots)`** renders one real frame through the post stack with everything under the roots shown (plus hidden ancestors) and not frustum-culled, then restores it all. Lights are left alone.
  - At boot it runs on every renderable in 10 batches, one frame each, so the loading bar moves. At run start (`warmNext`, the first frame) it covers the camera subtree, with every held item staged by `Hands.stageItems()`, and the shadow body.
  - Gotcha: the scene pass runs once per animation frame (`nodeFrame.frameId`). A second `post.render()` in the same frame silently skips it, so a warm-up called from a click handler did nothing.
- **Verified:**
  - Headless: zero pipelines compiled mid-game across all eight landmarks (360° look at each), night, storm, lightning, walk, sprint and torch.
  - Desktop, cold cache: no stall over 64 ms in gameplay. That run covered walking, sprinting, a 180° turn and the torch at 44–49 fps.
  - The only pause left is about 2 s under the fade at run start. Load time to playable is unchanged (~28–31 s cold in the desktop app vs 28 s before), because the compile cost moved from play into the loading bar (~20 s of it in WebKit).
- **Tooling:**
  - `?continue` skips the title into the saved run, since desktop tests can't aim a click.
  - `?trace` now logs per second: speed, sprint/crouch/winded/stamina, frames, the longest frame gap and key auto-repeats.
  - Owner traced sessions run on a *copy* of the save. WebKit's localStorage file for the dev-server origin is `http_localhost_5173.localstorage` (copy `tauri_localhost_0.*` to that name under an isolated `XDG_DATA_HOME`).
- **Next:** loading is ~20 s in WebKit, mostly compiling about 160 pipelines. Fewer unique shaders would shorten it.

## Close-up detail pass: cars, flora, rocks, fauna (2026-10-07)
**Why (owner):** from a distance the world reads "borderline AAA", but walking up to props, trees, grass and cars it looked cheap. The owner asked for more detail and variety, plus fauna if it wouldn't hurt performance.

**What's new:**
- **Cars** (`world/vehicles.ts`, `buildCar`): one builder for the highway, Dry Creek, the data centre and the drive-in (four separate low-detail versions before).
  - The body is a loft: a superellipse section with tumblehome, a crease and a tucked rocker, with the arches pushed into it.
  - The greenhouse is patches whose cells are glass or paint, so pillars and frames fall out of one surface.
  - Detail: bumpers, quad headlights, grille, trim, door seams and handles, mirror, antenna, plates.
  - Lathe tyres with optional whitewalls, steel wheels, hubcaps or lug nuts, an interior, an engine bay under open or missing hoods, and a chassis for cars on their roof.
  - Kinds: sedan, coupe, wagon, pickup (real bed), van, convertible, burnt.
  - Wheel states (ok/flat/gone/blocks) settle the body's pitch and roll.
  - New materials: `carPaint` is a batch family (sun-bleached tops, peeling clear coat, primer, rust climbing from the rockers). `carGlass` has a dust film, wiper arcs and a spider-web crack.
  - Highway cars cast shadows through coarse hulls fed to the prop shadow stream. Collider boxes come from the hull's bounds.
- **Flora** (`world/flora.ts`, a `Plant` builder with indexed triangles and per-vertex `fColor` = rgb + kind):
  - Dead cottonwoods: gnarled, with root flare, limbs along the trunk and bleached twigs.
  - Joshua trees: a shaggy dead-leaf skirt and spiky rosettes.
  - Shrubs: creosote, sagebrush, dead brush, prickly pear, barrel cactus, yucca, ocotillo, mesquite.
  - Every plant (and every animal) shades with one `floraMaterial()`.
  - Trees are one static mesh. The shadow stream copies their lo LOD (`userData.shadowGeometry`, which `ShadowStream.take` now honours).
- **Shrubs stream** (`world/Shrubs.ts`): 16 m cells, deterministic. Near (≤38 m) is full detail and casts shadows; far (≤135 m) is lo. Two draws plus one shadow draw.
  - Species are weighted by moisture (height-based: the wash gets mesquite), slope (cacti, yucca and ocotillo on stony slopes) and clustering noise.
- **Grass** (`Scrub.ts`): more, finer blades, plus seed stalks and wildflowers per instance (`aVar`: greenness, stalks, flowers, hue).
  - Parts a tuft doesn't have collapse to a far point in the vertex shader, so they never rasterise.
  - It's greener and taller in low ground, where the flowers grow.
- **Pebbles** (`Pebbles` in `Scrub.ts`): an instanced, streamed 24 m gravel scatter, denser on stony patches and slopes.
- **Rocks:** fractured shapes (planar cuts and smooth normals instead of a faceted icosahedron) and a new `desertRock` material (bands, cracks, desert varnish, lichen). Stones are detail 2; a boulder mesh is detail 3.
- **Fauna** (`world/Fauna.ts`):
  - The cast:
    - vultures soaring by day
    - ravens perched on crossarms, billboards and car roofs; they caw and take off when you come within 10 m (16 m sprinting)
    - jackrabbits that sit and then bolt in zig-zag hops
    - lizards that dart in bursts
    - butterflies in the low green ground
    - flies over the nearest wreck, with a new `flies` ambient voice
    - a wolf pack that passes at a distance, stops to watch you, flees inside about 32 m and howls at night (positional, via `audio.howl`)
  - Nothing is hostile. Every animal is a rig of rigid procedural parts posed on the CPU into ONE shared dynamic mesh with the flora material: one draw plus one shadow draw, no new shader.
  - Debug: `game.fauna.census()`, `game.fauna.summonPack(game.player.position, 60)`.
- **Audio:** sfx `caw`, `flap`, `scurry`; `howl(pos)`; ambient kind `flies`.

**Performance** (headless, 1600×900 High; v0.3.1 → now):
- Draws: +10 (spawn 73 → 83, Garage gate 109 → 119). The parts: shrubs 2, fauna 1, pebbles 1, a boulder mesh, and the car batches' extra families (paint, glass, fabric).
- Triangles: ~1.1M → ~2.0–2.25M. Grass is the biggest share, then cars (~10k each), shrubs, trees.
- RTX 4050 headless: vsync-bound at 60 everywhere except the Garage gate (60 → 57).
- Intel iGPU: within ~0–10%, but noisy run to run because the owner's desktop shares that GPU. Interleaved per-system costs at spawn: grass 1.9 ms (about half of it new), cars 0.7, pebbles 0.5, rocks 0.4, fauna 0.25, shrubs 0.1.
- No new pipelines compile mid-game: the pipeline-count hook was checked against a positive control. `warmShaders` now forces count ≥ 1 on empty InstancedMeshes, so streamed scatter compiles at boot.

**Tools:**
- `debug/props.html` is a prop lab. `what=car|tree|shrub|rock|fauna`, plus kind/seed/hood/wheels/flip/burnt, and an orbit camera around tx/ty/tz.
- `scripts/dev/props-lab.mjs` makes contact sheets from it.
- `scripts/dev/closeups.mjs` takes in-game close-ups of the nearest car, tree, grass, rock and pole.

**Next:**
- Desktop bench (`scripts/dev/bench-desktop.sh high`) to confirm WebKit cost; +10 draws is the number to watch there.
- Car LOD (far highway cars could drop interiors and wheels detail) if the draw/tri budget tightens.
- Wolves as a threat is an open design question for the owner (it needs combat or evasion rules).
- More ground litter (bones, cans, tyres) in the same scatter style.

## Interior mode: the Garage skips the outside world (2026-10-07)
**Why (owner):** "zones with loading screens so it only draws what's needed". Outdoors that's already done seamlessly (DistanceLod, streamed scatter, culling). The one gap: inside a sealed building the whole exterior was still drawn and cast into the shadow map.

**How:**
- `Garage.hidesExterior(camera)` returns true when the camera is inside the house and the side door, the only opening (the roll-up is welded shut and the window slits are solid glow), is shut or out of view. The door test is a frustum test on the doorway's box, enlarged; it's conservative, so nothing pops.
- `Game` hides the exterior roots (sky, terrain, far terrain, props, landmarks/sites/town, grass, shrubs, pebbles, fauna, haze, streaks, dust devils, outdoor intel) only around `post.render()`, then restores them. No system's own visibility logic is touched, and the shadow pass skips them too. Dust motes, puffs, the drone, the player and the Garage group stay.
- No loading screen: everything was compiled at boot.
- Debug: `?interior=off` for an A/B; `?at=garage` starts a run inside the house; `game.interiorFrames` counts frames drawn in interior mode.

**Verified:**
- Inside the Garage (headless 4050): draws 144 → 64, triangles 2.36M → 0.13M.
- A 16-view 360° sheet with the mode off vs on: the pixel diff shows only animated things (laser sweep, tube flicker, monitor). No holes, no light leaks.
- With the side door open, the exterior is drawn whenever any sliver of the doorway is in frame.
- Desktop app (`BB_DEV=1 scripts/dev/bench-desktop.sh high`, 4050): inside the Garage, ~50 fps with 7.2 ms render submit → ~63 fps with 4.2 ms. Outdoors at spawn, with this session's detail and fauna: 51–58 fps, 5.1–6.3 ms.

**Then all four interiors** (`world/interiors.ts`: `Interior` = local frame + inside test + portal boxes + `keep` roots; `hideExcept` walks the path to each kept root and hides its siblings, and never hides anything holding a light, since that would change the light set and recompile every lit shader):
- **Garage** (`Garage.interior`): the house box; portal is the side door, while it's open.
- **The Cut** (`Settlement.caveInterior`): the chamber, pocket and neck ellipsoids plus the inner half of the mouth tunnel (the shapes `caveField` carves); portal is the mouth.
- **Tube** (`TubeSite.interior`): within R of the inner centreline (`TubeBuild.innerAxis`: torn mouth → break → bulkhead); portals are the torn mouth and the airlock. The station has glass walls, so it isn't an interior.
- **Data centre** (`DataCenterSite.interior`): the server hall (`INSIDE`, below the ceiling); portal is the lobby doorway. The lobby has glass walls, so it stays "outside".
- **Headless results** (draws off → on, k-tris): Garage 143 → 63 (2355 → 129), Cut 89 → 44 (1685 → 75), Tube 109 → 38 (2271 → 145), hall 114 → 57 (2066 → 227). Exterior was skipped in 16/16, 10/16, 10/16 and 12/16 of a 16-view sweep; the rest face a portal.
- **Pixel diffs off vs on** show only animated things (lasers, the fire's embers, LEDs).
- **No new pipelines** with the hook across all four.

## Hostiles: combat, enemies and stakes (2026-10-07, v0.5.0)
**Why (owner):** after v0.4.0 the wasteland "feels a little too easy". They asked for enemies that shoot and attack, aggressive wolves, other antagonists, guns plus melee plus stealth, and a real cost to dying. "Triple-A quality all the way."

**Player arms** (`src/content/weapons.ts`, `src/game/combat/PlayerArms.ts`, viewmodel in `src/game/player/Arms.ts`):
- Crowbar, Six-Shooter (.38), Pump Twelve (12 ga), Lever .30-30. Weapons are inventory items (`category: 'weapon'`), ammo items are `ammo38` / `shells` / `ammo3030`. Rounds loaded in each gun live in `data.arms.mags`.
- Controls: LMB fire/swing, RMB aim down the sights, R reload, Q last weapon, wheel cycle, X holster, V melee. A click is buffered 0.18 s.
- Hitscan with a spread cone (hip → sights, worse moving/airborne, bloom from recent shots, tighter with Firearms). Damage falls off past `range`. Head ×`headMult`, limbs ×0.72. Difficulty scales damage dealt/taken and enemy aim/reaction (`DIFFICULTY`).
- Camera recoil: a quick punch up, ~70% settles back. The viewmodel has its own bouncy recoil spring.
- Reloads are round by round (open → load × n → close) and interruptible: fire during a load finishes the round in hand and closes.
- Melee: a forgiving fan of rays; from behind an unaware target (`Hostile.unaware()` + facing) it's a silent takedown (no noise, only a squadmate within 7 m notices).
- **Viewmodel:** the weapon is posed first (hip / ADS / run / low / reload / swing frames, springs, sway, bob, breath), then the hands are solved onto it: right wrist = weapon · attach⁻¹ · grip⁻¹, left wrist = weapon · forend frame. `poseFromRoot` undoes the left hand's mirroring. Models use Hands' material kinds and `bakeParts(skinned)`, so moving parts (cylinder, hammer, pump, lever) are bones. Muzzle flash is one shared additive star material.
- ADS centres `sightY` on the view. Long guns needed raised sights (buckhorn/blade, ghost ring/post) or the receiver filled the screen.
- Iterate with the hands lab: `&arm=revolver|shotgun|rifle|crowbar&ads&act=fire|reload|load|close|swing|bash&at=0.3`.

**Combat hub** (`src/game/combat/Combat.ts`):
- `HostileProvider`s register; `Hostile` = sphere reject + exact `raycast` + `damage()` (+ optional `unaware`, `facing`, `awareness`).
- Player rounds: Rapier ray (excluding the player) vs every hostile's ray test; impacts pick fx and sound by the surface (`Acoustics.surfaceOfHit`).
- Enemy rounds resolve against the player's capsule and the world (cover works); near misses crack past (`whizz`).
- `noise(pos, radius, kind)`: gunshots carry 140–220 m and wake squads; cans and melee are local.
- `explode()`: fire, smoke, dirt, sparks, a blast VirtualLight; it hurts everything in range that isn't behind cover.
- FX (`fx.ts`): `Tracers` (additive ribbons, faded within a few metres of the eye), `Debris` (lit blood/dirt/dust/chunks/smoke), `Flames` (fireballs, muzzle stars, flash cores). One draw each; idle systems hide.

**Enemies:**
- **Wolves** (`Fauna.ts` Wolf/Pack): 2–5 per pack (bigger at night). Notice by noise/scent (range scales with night, sprinting, storms) → stalk → circle at 8–12 m → one lunge at a time (bite 12–15). Torchlight on a wolf adds fear (it won't lunge). Gunshots dent morale; deaths more. Packs abandon a hunt if you reach the camp (30 m), Dry Creek (75 m) or go indoors. Dead wolves roll onto their side.
- **Kade Recovery** (`Humans.ts` rig, `Recovery.ts` AI, `Outposts.ts` props, `content/recovery.ts` data):
  - One `SkinnedMesh` for all 10 slots (16 bones each; a slot's gun is baked in). Bones get world matrices built straight from procedurally placed joints (gait, crouch, lean, twist, IK arms onto the weapon, IK legs). Death = Rapier ragdoll: 11 capsules, ball joints and hinged knees/elbows; parts collide with the world but not each other (groups 0x0002/0x0001). The gun drops as its own body. Bodies sleep after ~1–7 s and the physics is removed.
  - Squads share knowledge (`known`, `knownT`). Perception every ~0.15 s: range 72 m idle / 130 m alert, ×0.42 at night without your torch (×1.5 with it), dust and crouching shrink it; LOS by ray to chest or eye. Detection meter → suspicious → engage.
  - Combat: cover from the outpost's list or sampled points (a ray toward the threat must hit something at 0.6 m), peek/duck cycles, bursts whose spread starts ~3.6× and settles over ~1.3 s, reloads, a flank every 10–16 s when you're hidden, and compliance charges (physics canisters, beep, 5.5 m blast). Morale breaks into a retreat.
  - Four outposts on flattened pads (Heightfield reads `OUTPOSTS`): Survey Camp (tier 1), Recovery Point 7 and Pipeline Camp 3 (tier 2), Kade Wellhead (tier 3, the aquifer). They wake within 240 m, sleep beyond 330 m, and respawn 30 play-minutes after a clear (`marks['cleared.<id>']`). Footlockers and searchable bodies feed ammo, water and the weapons you don't have yet.
  - Road patrols: a pair walks the highway past you every 5–7 minutes when you're near it, never near the camp or Dry Creek.
- **Machines** (`Machines.ts`): Compliance Sentry (scan arc, a polite line, then bursts down a visible laser; eye ×1.8 damage; EMP blinds; Electronics 1 pulls the rear breaker), Hornet (circles the pad, calls the crew, nail bursts, falls and burns when shot or EMP'd), property-line mines (blink within 14 m, click and 0.55 s beep, Demolition 1 disarms, a shot sets them off).
- **Critters** (`Fauna.ts`): rattlesnakes (coil → rattle → strike → slither off; bite + 26 s venom), bark scorpions at night near wrecks (sting + 14 s venom). Venom drains 0.6 hp/s; the snakebite kit (`antivenom`) clears it, a medkit halves it.
- SeedBot can be shot: each hit puts it on alert, four within 10 s knock it down for 25 s.

**Stakes:** death drops every non-weapon, non-story item in a pack at the spot (`data.pack`, orange beacon, map marker); a second death loses it. You wake at the camp six hours later with 45 hp. The view sags and rolls on the way down.

**HUD:** an ammo panel with round pips, a four-tick crosshair that opens with spread and vanishes when aimed, hit markers (white, gold head, red kill), red damage arcs toward the source, a "HOSTILES / BEING WATCHED" state on the detect eye, a venom pill and a takedown prompt. Touch builds get Fire / Aim / Reload / Swap.

**Audio** (`combatAudio.ts`): layered gunshots (crack, body thump, bark, desert slapback echo network); far shots arrive after their travel time at the speed of sound and lose their top; whizz/snap; impacts by surface with ricochets; reload foley; melee; wolf growls, snarls, bites and yelps; formant shouts and grunts; rattles; explosions; machine chimes and servos; heartbeat. A brick-wall limiter now sits after the makeup gain (gunfire clipped the output).

**Desktop:** the native X pointer grab swallowed mouse buttons, so clicks never reached WebKit while captured. `rawmouse.rs` now also reads XI2 raw button presses and the wheel (deduped by server time; XWayland reports one click from two devices). `raw_mouse_delta` returns `(dx, dy, held, pressed, wheel)`; `Input.pollRaw` maps them while locked. **Untested with real clicks on the owner's machine.**

**Verified (headless, RTX 4050):**
- No pipelines compiled mid-game across all four weapons (fire/reload/swing), a squad fight with ragdolls, a wolf fight, an explosion, night at two outposts with sentries/Hornet/mines, death and the pack beacon. The hook (`renderer._pipelines.caches.size`) catches a new textured material (positive control); wireframe/flatShading don't create programs here.
- 60 fps (vsync-bound) at 1600×900 High everywhere tested. Draws: spawn 86 (v0.4: 83), Recovery Point 7 fight 144, five-wolf fight 157, wellhead at night 135. Sentries are culled past 190 m, mines draw only within 120 m of a mined outpost, outpost banners/fires go with the near LOD.
- Save round-trip: equipped weapon, loaded rounds, the dropped pack and its beacon survive `?continue`.

**Desktop bench** (`BB_DEV=1 BB_FLAGS=fight scripts/dev/bench-desktop.sh high`, 4050, 936×1138 tiled window; `?fight` drops a 4-man squad in front of you on Story and keeps you alive): 46–50 fps in the fight vs 48–50 at the same spot without it; render submit ~6.4 ms either way.

**Next:**
- Real-click check of the new raw-button path in the Linux app.
- Balance from the owner's play: TTK, patrol frequency, wolf day-hunting odds.
- Ideas: enemy weapon pickups on the ground, decals, wolves vs contractors, a rival crew.

## 2026-10-08: voices (v0.5.2 batch)

- The owner rejected every synthesised voice (formant barks, the campfire/radio babble, browser TTS taunts). Removed the `Babbler`; the camp radio now plays static, Morse and a fingerpicked song, and campfires are heard through cups, creaks, logs and boots.
- Then real voices: 348 lines pre-rendered with Kokoro-82M (kokoro-onnx, Apache-2.0) into `public/voice/*.mp3` (11 MB, 48 kbps mono). 20 speakers, each with a voice and a chain baked in by ffmpeg: Mara and the camp on radio, Tanner through his megaphone, Hunter Vale and the AIs on a PA, Dry Creek in a small room, Kade crews on radio (4 voices, one per slot, squelch baked in).
- `scripts/voice/extract.mjs` finds lines in the source (rolldown's oxc parser; the project's TypeScript 7 has no JS API): `{speaker, text}` objects, `subtitle()` calls, `taunts`, BARKS, SENTRY_LINES. Template text keeps its literal pieces' complete sentences. The game splits displayed text the same way and plays the longest runs it has clips for.
- Music ducks under speech. Settings → Voices (on by default, migrated once via `voiceOn052`). Contractor barks are positional; Tanner's taunts come from the megaphone.
- Not voiced: the player (silent protagonist), notes/signs, and the jet's CVR/ExitPilot transcript pages (narration mixed with two speakers).
- Confirmed by the owner: voices play in the Linux desktop app (WebKitGTK decodes the mp3s via GStreamer). `?trace` logs `[voice] …` per line.


## 2026-10-08: scavenging + walls for walkers (v0.5.3 batch)

- Owner: ammo too scarce; wolves wander through town walls.
- **Walls:** `Combat.slide(from, to, r, knee)` is a knee-high ray against fixed colliders (terrain excluded), stop short and slide along. Wolves resolve it once per frame after the pack logic, whatever the state; contractors after `walkTo` and their stuck-jitter. A pinned wolf picks the roomiest heading near its goal (`Combat.openWay`) and commits for ~1 s. A fleeing pack drops unseen stragglers after 15 s. Test (Dry Creek, 5 hunting wolves, 20 s): 27 wall crossings → 0; ~1 wolf in 40 still gets boxed in by clutter (then despawns unseen).
- **Scavenging** (`content/scavenge.ts`, `world/Scavenge.ts`): 18 survivor stashes (ammo cans, footlockers, packs, Kade crates, coolers) marked by a red rag on a stick over a cairn; they refill after 35 min of play (leaner). All 17 highway wrecks are searchable once. Ammo rolls favour calibres for guns you carry. A full pack leaves the find in place. Mara explains the rag sign the first time one is within 30 m. One MeshBatch, 5 meshes, ~11k tris.
- **Combat polish:** bullet marks (`combat/marks.ts` `Marks`): one instanced decal pool (160), procedural hole + soot + halo per surface (stone, metal, wood, dirt), only on fixed colliders, pulled back 6 cm along the shot because visible surfaces stand proud of their collider boxes. Spent brass (`Brass`): lever rifle and shotgun pump eject on cycle, the revolver dumps its empties on reload; CPU-simulated bounce onto whatever a ray finds below, 40 s life. Brass is deliberately not fully metallic (it went dark brown with little to reflect). The Garage apron got a collider (casings were landing under the drawn slab). No new pipelines when firing (191 → 191).

## 2026-10-08: the Meshy wolf (v0.5.4 batch)

- Owner bought Meshy and made a desert wolf (image prompt → Meshy image-to-3D → quadruped rig + walk). Export: 19.7k tris, 27-bone rig, one 1 s in-place walk, 2048² colour map, armature scaled 0.01, and the colour map wired into emission at full strength (it would glow at night).
- `scripts/models/prep-glb.mjs`: drops emission/extensions, PNG → JPEG (4.9 → 1.5 MB). `world/wolfSkin.ts` normalises the model (1.02 m to the ear tips, feet at 0, head +Z), clones it per pack slot, drives the walk by the wolf's gait phase, and layers the hunt's poses about the body's own axes (fixed a death roll that folded the legs about the standing axis and left them pointing up).
- Checked: walk, run, stalk crouch, howl, bite snap, death to both sides, head look; no new pipelines when a pack appears (193 → 193); 60 fps headless with 5 wolves. Not yet: a desktop-app bench with a pack on screen (+5 skinned draws and their shadows).
- Next models from Meshy: run/attack clips would replace the sped-up walk; then the Kade contractors (Humans.ts would move from the procedural slot mesh to skinned clones the same way).
- 2026-10-08, live: the owner loves the new wolf ("this is gonna look insane"). Complaint: the death fall makes the legs flail. Fix with a Meshy death clip (see CLAUDE.md "Next session"). v0.5.4 shipped.
- 2026-10-08 (later): **wolf death rebuilt in code.** The flailing came from the walk clip blending back to the bind pose while the body rolled, plus an AnimationMixer trap: the mixer skips writing a bone whose value didn't change, so once the clip weight hit 0 the layered death turns accumulated every frame (real kills curled into balls; static test poses hid it). Now the clip is sampled by hand from bind each frame, and `death(t)` runs flinch → front buckle → hind buckle → topple + settle → limp (legs sag to the ground) → a last twitch; a running kill skids (wall-checked). Verified on real kills from both sides, plus walking and stalking; pipelines 193 → 193. Meshy API: 1,080 credits; rigging and animation are humanoid-only.

## 2026-10-08: Grok's Meshy batch wired in (v0.5.5)

- Source: `Assets/MESHY_ASSETS.md` (Grok's manual: inventory, clip names, measured offsets). New `scripts/models/build-glb.mjs` merges `_Animations` clips into `_Rigged` by bone name, renames them to roles, keeps the colour map only, repacks: contractor 2.06 MB (2k), townsfolk 1.4–2.0 MB each (1k), hat/respirator ~0.2 MB, snake/scorpion ~0.4 MB. `public/models` = 14 MB total.
- **Contractors** (`humanSkin.ts`): retarget, not clips. The procedural skeleton keeps every behaviour; the Meshy rig follows it (torso/head frames, IK limbs with the model's lengths), so hands stay on the (still procedural) guns, feet stay on the ground, hit tests match, ragdolls carry the model. Verified: relaxed/aim/revolver portraits, squads running/aiming, explosion ragdoll lying face-down; pipelines 196 → 196.
- **Townsfolk** (`npcSkin.ts`): six actors with idle/alt/near clips and a head turn; seated hips anchored per clip. Verified all six at talk distance, Sol by firelight at night; pipelines 198 → 198.
- **Snake/scorpion** (`creatureSkins.ts`): snake skinned at load onto the procedural spine (coiled, slither, dead belly-up checked); scorpion rigid on the body root (alive and dead checked at night).
- **Desktop** fight bench (dev build): 46 → 42 fps, render 7.2 → 8.5 ms.
- Not done: camp four (no 3D camp figures exist; owner's call), contractor mocap clips (unused; the procedural gait drives them), the known asset misses Grok listed (Dez headset, Nia's scarf colour, etc.).

## 2026-10-09: the camp four round the fire

- Mara, Pip, Hollis and Dez sit on the camp's two logs (`Landmarks.addCampPeople`, an NpcCrowd in the gas station's near set), with Hollis's trucker cap and Dez's headset (Grok's known pinched headset, as is) on the Head bone.
- Only Hollis came with a sitting clip; the others borrow Sol's, Ren's and Wick's. Meshy auto-rigs each character separately, so rest poses differ (Mara's Head is 133° from Sol's): `build-glb.mjs` now **retargets** borrowed clips in world space (play on the source skeleton, apply each bone's world change from rest to the target's rest, back to local) and scales the hip motion by hip height. Own-file clips pass through untouched.
- **Seated fix (owner screenshot: Sol's legs through his log):** the game's seated point is the seat (the procedural figure's hips sit over it, feet 0.44 m ahead), but the model was placed feet-first, so its hips sat 0.33 m behind. Seated actors now put their hips on the point. Fixed Sol, Ren, Wick and the camp. A short person on a high seat sits up with their feet off the ground (Pip).
- Pipelines unchanged at the camp (206 → 206), 60 fps headless.

## 2026-10-09: combat feel pass (swarm, combat & enemy AI)

- **Contractor hit reactions** (`Humans.ts` `Human.hit()`, driven from `Recovery` `Member.damage`): by zone. Head snaps back; body knocks the chest back and the knees give; a leg buckles that side (and hobbles them 7 s); an arm wrenches the gun off the aim. A hit costs the next shot and resettles their aim. The Meshy body follows (it's retargeted from these joints).
- **Deaths:** head shots drop where they stand (small snap on the head, the push on the chest), close shotgun blasts throw (chest + hips), leg shots twist down, blasts launch. ~60% of other body kills (and takedowns) **die on their feet** first (`Human.dyingT`: knees go, fold over the wound, free hand to it, 0.35–0.85 s) and then pitch forward into the ragdoll; another round puts them down at once (`Hostile.shootable()`). Ragdoll pushes now go to the chest/hips: the old code pushed the hit part, so a rifle round on an arm or a thigh (3–8 kg capsules) sent bodies cartwheeling.
- **Suppression:** `HostileProvider.whizz()` (called by `Combat.playerRound`): a round within ~2.4 m adds `supp`. Suppressed contractors drop back behind cover, cower in the open, shoot up to 2.8× wider, and are pinned (no fire) above 0.85.
- **Squad:** when you go to ground, one member (`Squad.suppressor`) lays covering bursts on your last position while another flanks; it shifts if its own cover is in the way. Badly hurt (<45% hp) contractors fall back to cover further off, with a "hurt" bark.
- **Wolves:** a lunge now has a tell (stop, coiled crouch facing you, growl, 0.3–0.6 s × difficulty react, then a snarl) and ends in a leap (`WolfPose.leap`: arc, nose up then down, forelegs reaching). Shooting a wolf mid-leap cancels the bite. Lungers are mostly picked from wolves in front of you. Between lunges a ringing wolf feints in and back out. Hits flinch on the model (jerk away, sag, head to the wound, tail tucked); any crouch now folds the model's legs. 30 s standing still on Normal: 8 lunges, 8 bites, 6 feints.
- **Player:** damage knocks the view on a spring away from the source (`FirstPersonCamera.punch`; bites/blasts hardest), separate from the aim. Below 40 hp the existing-but-never-called heartbeat plays, and the post stack drains colour and darkens/throbs the edges in time with it (`post.lowHp`).
- **Labs:** prop lab `what=human&meshy&pose=aim&hit=leg&at=0.12` / `&dying=0.5` / `&cower=1`; `what=wolf&leap=0.5` / `&low=1.4` / `&amp=0.45`.
- Verified headless (RTX 4050): poses in the labs; kill sequences (dying stumble, head/leg/shotgun deaths) in game; covering fire and suppression via census; a wolf lunge trace; pipelines 206 → 206 through squad fights, kills, a wolf fight and low health; 60 fps.
- Next: suppression barks (needs new voiced lines), wolves reacting to near misses, a "you're reloading, push" squad behaviour, a desktop-app check of the head-punch strength.

## 2026-10-09: SPLICE (hacking), Kade terminals, light and shadow

- **SPLICE** (`ui/Hack.ts` + `ui/hack.css`, daemons in `content/hacks.ts`): a 5×5/6×6 opcode matrix. Pick from the top row, then that cell's column, then its row… each pick fills a buffer; a daemon uploads when its sequence lands in order. Solvable by construction (grid, then a hidden path, daemons are windows onto it). The trace starts on the first pick or after 10 s of reading; ICE cells (difficulty 2+) cost 4 s; taking damage yanks you out (uploads kept). Electronics: +2.2 s trace per rank, buffer +1 at ranks 1/3/5, a sniffer dot on useful codes at rank 3; Hot Line/Overclock/Salvage apply (Game's `hack` wrapper). A Recovery Lanyard can be swiped first on Kade boxes (+1 slot, ×1.5 trace). DOM only, no filters/blend; the trace bar's transform is the only per-frame write (~12 Hz). Touch: tap the lit line. Desktop: WASD/arrows + Space, or the mouse; Esc jacks out, F spikes.
- **Kade field terminals** (`combat/terminals.ts`; prop in `Outposts.ts`: folding table, rugged laptop with a Kade OS screen drawn in glow quads, antenna, cable): Electronics 1, not mid-firefight, once per shift (`marks['term.<id>']` vs `respawn.<id>`). Daemons: SENTRY · STAND DOWN, PERIMETER · SAFE (mines go dark, the Hornet parks: new `parked` state), REQUISITION (cell, water, ammo for the guns you carry), ROSTER (every outpost on the map), ID PRINTER (2 lanyards). Lasting ones are re-applied when the crew spawns (`Recovery.onSpawn`), so they survive save/load. Traced: 6 damage, the crew is alerted, a voiced radio bark.
- **Also spliceable:** Tanner's vault keypad (Electronics 2: vault, SeedBot docks 40 s, lasers off; traced = alarm) and ColdStorage's core door (Electronics 1: core, solar reroute, the UPS ejects 2 cells; traced = 8 damage). New voiced lines rendered (Tanner, SeedBot, Nimbus, Kade radio ×4 voices).
- **Crafting:** Trace Spike (1 cell + 2 scrap → 2, Electronics 1): stalls the trace 6 s.
- **Stealth light model:** `combat.target.light` = 1 by day; at night it's the point light on your chest from the VirtualLight pool (`lightPool.illuminance`: inverse square, no occlusion, smoothed), or 1 with the torch. Contractor sight range ×(0.42 + 0.63·light) at night (was a flat 0.42, or 1.5 with the torch); their detection rate and aim scale with it, and so do sentries and the Hornet. HUD pill at night: IN SHADOW / LIT (hidden on touch with the rest of `.stance`). Measured at RP7 at 23:00: barrel 1.0, floodlight 0.99, yard 0.49, edge 0.08. A guard 45 m off never noticed you in the dark, and did with the torch.
- **Verified headless:** solver-driven full runs at difficulty 1–3 (all daemons uploaded), keyboard input, the trace failure (alert + damage + lockout), rewards and XP at Survey Camp and RP7, a stood-down sentry surviving save + `?continue`, the Garage and data-centre flows, and the phone landscape layout with real taps and a spike. Pipelines 209 → 209 at an outpost terminal and through a hack.
- **Not done / next:** no desktop-app (WebKitGTK) run of the overlay yet. Ideas: a daemon that turns a sentry on its own crew; Tier 2/3 bunkers built around SPLICE (the Panopticon's cameras); an occlusion ray for the brightest light.

## 2026-10-09: QA and UX pass (overnight swarm, QA agent)

Played headlessly end to end through `window.game`: new run, note, cooler, camp (rest, craft, radio, Pip's ledger, wait for night), the Garage (gate, side door, fuse, vault, crates, safe), death and pack recovery, the debrief (Act I → Act II), Dry Creek talks, stashes and wrecks, a squad + wolf fight, save/continue. No console errors. Every visible interactable was reached and focused from a free standing spot (105 checked), plus the hidden ones once their flags are set.

**Fixed:**
- The EXIT brochure at the jet was unreachable: its interactable applied the site frame twice (`Site.spot` is already world-space) and sat ~390 m north of the jet.
- Campfire embers drew as hard white squares (no shape mask); now soft round sparks.
- Escape in Settings or Controls also closed the pause menu under it and dropped you into the game. Only the topmost panel answers keys now; Controls closes on Escape.
- Two interaction prompts (E + F) ran into the subtitle box. Desktop prompts grow downward from their old spot; on phones the subtitle sits above two prompts.
- Loot toasted every item twice ("+3 Water" per item, then "3× Water, …"): a cooler made seven toasts. Per-item toasts are held to the end of the task and dropped when a summary toast, banner or intel card names them.
- Map: the quest goal's label printed on top of Dry Creek's; overlapping labels step down a line.
- Camp recipes said a skill requirement twice.

**New settings** (persisted; older settings load with defaults, bad values clamped): Field of view (50–90° vertical, shown as the horizontal angle for the window), Head bob (0–1, also scales strafe roll), Invert look (desktop), FPS counter (DOM written twice a second). The viewmodel keeps its authored size at any FOV: `FirstPersonCamera.viewmodelDepth()` scales the hands' camera-space z by tan(32°)/tan(fov/2) (the same projection as at 64°), easing back to 1 while aiming. The run starts at the chosen FOV (no zoom-in on load).

**Checked, fine:** the Meshy townsfolk and the camp four from four sides by day (no clipping found after the seat fix; Mara's feet hang a little on the camp log), Sol/Ren/Wick seats, Nia/Doc/Inez standing. walk-probe (150 lines, `DEV_ORIGIN` now picks the dev server): stalls only at real obstacles and slopes > 45°.

**Not fixed (for a next round):**
- Phone: the prompt rows overlap the Aim/Swap/Reload buttons when a gun is out (`.arms` sits right of centre at mid height); there's no free lane for a wide prompt at 844×390.
- Pipeline Camp 3's pipe collider (a 40 m box 0.85 m off the ground) can wedge the player underneath it.
- Mara's camp radio cites "the Spire blueprint" before you've read it (a dialogue edit means a re-voice).
- The camp panel always says Day 1,284.

## 2026-10-09: storms, SeedBot VFX, The Cut, the moon (swarm: world visuals)

- **Dust storms** (`Atmosphere`, `effects.ts`): the storm fog is no longer one flat murk. Its density rolls through in wind-advected banks (`Atmosphere.bank`: two atlas taps along the view ray, drifting on `uSandFlow`; ≈0.45×–1.9× the mean), thick banks shade darker and ruddier, and gusts (`uGust`, from a slow surge under the existing gust beat) close the air in for a few seconds and push the wind. Both live behind a uniform `If(uStorm > 0.02)`, so clear weather pays nothing. The storm colour takes over sooner (ease-out), so a half storm reads brown, not milky. The approaching wall is taller and boils (faster morphing, curls rolling upward, a dark skirt, a sunlit fringe). Storm haze sprites each get their own density/tone.
- **Debris and wisps** ride in `SandStreaks` (same sprite, same draw): the first 7 instances are tumbleweeds (bounding, rolling the way they cross the screen; also on windy days), the next 41 are litter (paper, leaf, plastic, twig from a canvas atlas; storms only), the next 90 are broad faint dust wisps. The amount thins the crowd per piece instead of ghosting it.
- **Visible dry lightning** (`StormLightning`): each stroke builds a forked channel 220–860 m out; the storm's flash pulses light it, so re-strikes keep their shape.
- **SeedBot** (`Drone.ts`): `ElectricArc` (effects.ts: crossed ribbons, up to N bolts in one additive mesh, CPU-rewritten only while arcing). Taser prongs under the chin crackle harder the longer you stay in reach (a tell before the zap); the zap is a forked bolt into your chest with sparks and a blue-white flash of its spotlight; EMP/brown-out arcs crawl over the shell. Each bullet hit sparks (`Drone.hit`, called from Game's SeedBot hostile) and adds damage that decays ~12 s a point: a shot-up drone trails dark smoke (`DustPuffs.emit(..., smoke=true)`, negative size = soot) and shorts at a motor. Rotor downwash lifts yard dust. LED rings under the motor pods take the eye's mood colour (folded into the nav-light mesh, uv.x = 2: no new draw).
- **The Cut** (`cave.ts` `caveMaterial`): no longer flat-shaded (the surface-nets facets read as a low-poly blob) and uses the terrain's sediment stack (same world-height layers, varnish), so it reads as a piece of the ridge. Inside unchanged.
- **Moon:** dimmer (the maria were blown out by bloom), stronger maria, soft gibbous terminator lit from the set sun.
- **Checked:** pipelines 208 at boot and unchanged through charge/zap/hits/EMP and lightning (the extra 2 vs 206 are compiled at boot); 60 fps headless (RTX 4050, WebGL) in storms. Screens: storm front/full/night, drone day/night (idle, charge, zap, smoke, EMP, down), The Cut day/night/inside, moon at three hours.
- **Not done / next:** perf of the storm fog taps on the desktop app (4 extra atlas taps per fogged fragment, storms only); the downwash is subtle at patrol height; the lasers and the Garage interior already looked right and were left alone; a storm-specific audio cue for gust surges (the visual gusts and the audio gusts are independent).

## 2026-10-09: audio and a living town (overnight swarm, audio agent)

- **Fight music** (`music.ts`): `SoundScene.combat` = max(`combat.heat`, 0.6 while anything hunts you). Over 0.3 (out under 0.12) the calm cue and the suspicion pulse give way to a fight stem on the same clock: a sixteenth-note palm-muted ostinato (3-3-2 accents, flat-two turn), low toms and kick, tremolo strings (Dm Dm Bb A, Bb over A on the turnaround). Hot (>0.7) adds a backbeat, shaker, tom fills and a low brass stab. A fight longer than 8 s ends on a short whistled lament. `game.audio.musicState` for the harness. Stem RMS ≈ −31 dB at the master, like a cue.
- **Gunshots by place** (`combatAudio.ts`): outdoors your shot gets a slow roll and a second swell off the far ground; in a room or the cave (`enclosed`) the desert slapback fades, the shot feeds the room reverbs, plus a low-mid boom. Rifle snap and barrel ring, revolver cylinder-gap spit, shotgun sub whump.
- **Deafening** (`AudioEngine.deafen(k)`): a master lowpass that closes to ~520 Hz and reopens over 1–4 s, under a beating ~4 kHz whine. Blasts within 16 m; a shotgun or rifle in an enclosed room, a little.
- **Wildlife** (`engine/wildlife.ts`): mourning doves (dawn, dusk), Gambel's quail and a cactus wren (morning), a poorwill (dusk/night), a great horned owl and a coyote family's yips (night). Outdoors only, no storms. `game.audio.wildlife.test('owl')`.
- **Dry Creek talks** (`content/townBarks.ts`, `town/barks.ts`): 12 lines each for Nia, Doc, Inez, Sol, Ren and Wick (hello / night / armed / distant shots / you fired near them), Kokoro-voiced with the existing cast (72 clips, 1.5 MB). Greetings fire on approach (within 5.6 m after being 9 m away), with line of sight, never during a card or over another subtitle, 90–150 s apart per person. Gunfire: the nearest person within 22 m remarks a beat later; every crowd within 160 m turns its heads to the shot (`NpcCrowd.startle`). Barks now duck the score to 0.7 (conversations still 0.45).
- **Town wind** (`ambient.ts`): `chimes` (scrap-pipe chimes, a small prop under the Till's porch roof, batched) and `shutter` (the Till loft's loose shutter banging in gusts).
- **Tooling:** `audio-capture.mjs` records the WAV after the limiter and prints an `out` level (clipping check). A blast at 4 m peaks at −0.1 dBFS out (the limiter holds); fights −0.5 to −1 dBFS.
- Not verified by ear: only levels and spectrograms were checked. Wanted from the owner: fight stem taste, tinnitus level, bird levels, how often the chimes ring.

## 2026-10-09: QA round 2, integration (overnight swarm)

Played the merged build headlessly (desktop 1280×720 and phone 844×390): Act I end to end (note, cooler, Mara, the Garage at night with the vault spliced, crates, safe, debrief, the broadcast ending), terminal hacks under wolf attack and at low health, death during a hack, save/continue with a spliced terminal, settings with corrupt values, storm + night + low health, SeedBot at night. No console errors. Pipelines 211 → 211 through SeedBot's alert at night.

**Fixed:**
- **Kade crews never left combat.** `search()` returns early for a squad in combat, so the "lost you: search, then stand down" branch never ran. A crew that lost you stayed in combat for good: HOSTILES on the HUD, never despawned, its terminal said "Not with them shooting at you" for the rest of the shift, and it marched to wherever it last had you (seen: Pipeline Camp walking toward Last Chance, 450 m). Now, 14 s after the last sighting, they let go of cover and flanks, search, and stand down 22 s later.
- **Corrupt settings stopped the game booting** (`quality: "potato"` → `makeQuality` threw on every launch). `loadSettings` now checks quality and difficulty, clamps the volumes, and ignores a stored value that isn't an object.
- **Phone, gun out:** prompts sit in the lane between the vitals and the weapon cluster (right-aligned against it, kbd chip beside the text), and the subtitle sits above them on the same side. `html.armed` comes from `TouchControls`. Venom and IN SHADOW / LIT now show under the clock on phones (the whole stance row was hidden on touch).
- **Pipeline Camp 3:** the pipe's collider reaches down to 0.3 m, so nothing fits under it. (I couldn't reproduce the wedge in 160 random approaches, crouched, jumping and sprinting, before or after.)
- **A calendar:** `SaveData.days` counts midnights (any backward step of the clock: ticking over, sleeping till dawn, the six-hour blackout). The camp panel and the run banner read Day 1,284 + days. Old saves start at 0.
- **Mara's radio** only quotes the Spire blueprint once you've read it. Before that she points you at the Spire (one new Kokoro clip).
- **SeedBot's spotlight counts as light** for the stealth model. The pill read IN SHADOW while the drone was spotting you.

**Seen, not changed:**
- A bite that yanks the cable out of a Kade terminal uses up its one go per shift. That's consistent with "uploads kept", but harsh. A design call.
- If you die mid-hack, death waits about a second for the hack's stamp to clear (`die()` needs `!busy`).
- Phone, first seconds of a run: the LAST CHANCE GAS banner runs over the three toasts top-left.
- A storm at night under low health is nearly black, which is by design. With the torch it's playable.

## 2026-10-09: three road favours and the Last Mile (overnight swarm, story agent)

- **Ten Minutes or Free** (Hollis, quest `hollis.rider`): Hollis's CB has lost Rider 9, a Dropt courier who kept delivering because the app never told him to stop. New site **The Last Mile** (`sites/courier.ts`, landmark `courier` at −158, −296 on the north flats past the Wellhead). It has his cargo e-bike on its side (taco'd front wheel, blinking tail light), the insulated box set up as a table with the DROPT decal and his "ORDER #1047 RUNNING LATE SORRY" sign, a tarp lean-to with him under a gold emergency blanket, a cold fire ring, a whip flag planted so he'd be found, and his phone on a folding solar panel still showing the streak (the screen's glow is a VirtualLight at night). Steps: read the phone (you get item `igniter`, his last order), deliver it to Nia (her stove lights first time and she sets a plate out for him), then tell Hollis straight (`q.rider.truth`) or kind (`q.rider.west`).
- **Badge Access** (Dez, quest `dez.badges`): starts when you first carry a Recovery Lanyard, or when you ask Dez. Three lanyards get you `dez_relay`. Patch it into the Spire's generator (`sites/errands.ts`: a red lunchbox with a whip antenna and a blinking LED). Then listen to Kade's crew channel at the fire (three HR-flavoured overheard lines). Either keep Dez listening (`q.dez.ears` → favour `dezEars`: he radios when a road pair spawns near you, via the new `Recovery.onPatrol`) or play the karaoke ballad into the channel (`q.dez.karaoke`, more loot). Dez now really trades three lanyards for a ration, as the item text always promised.
- **Survey Says** (Wick, quest `wick.survey`): pull three survey stakes (`STAKES` in quests.ts) on the slope from the Survey Camp toward the Cut. Take the field book off a folding table in the Survey Camp. Then burn it with Wick, or keep it for Mara (she gets a radio line about depth readings under the ridge).
- Quest steps can now point the map at a Kade outpost id (`Story.computeTarget`). The errand props are in the scene from boot (hidden parts too) and hide past ~160 m. The courier site has a far stand-in.
- **Voiced:** 37 new clips (Hollis, Dez, the Kade crew, Nia, Wick, Mara's banter, the quest wraps). Re-extracted after merging main: 465 clips, nothing stale.
- **Verified headless** (RTX 4050):
  - every step of all three quests, and all six outcomes, clicked through the real dialogue cards
  - the map target and corner text at each step
  - a save + `?continue` mid-quest for each quest: flags, quest items, and relay/stake/book visibility restored
  - rewards and standing
  - `[voice]` logs for the new lines
  - a real patrol spawn triggering Dez's call
  - pipelines 208 → 208 with the courier at night, the relay up and the stakes in view; 60 fps
  - the stakes, the relay and the courier are all reachable (slope-limited path search, ≤ 40°)
- **Next:** a Pip line if you lied to Hollis about Rider 9; after the karaoke outcome, Kade crews could bark about "the song" for a day.

## 2026-10-09: first impressions (title, character select, the first minute, the website)

- **Title** (`src/game/MenuDirector.ts`): three slow shots cut through a dip to black (the post stack's `fade`, no DOM layer): a push in under the canopy on the camp four at golden hour, a crane over the camp at blue hour, the Garage at sunset (the old orbit). Camp shots are authored in camp space (`Landmarks.campPoint`; the fire at (−8, 0, 5)) and keep their subject right of the logo. The boot warm-up now happens at the camp camera.
- **Character select**: New Game glides the camera down into the open south-west place at the fire (2.8 s, a lifted arc, the sky easing to 17.65). The four now notice you from 7 m (was 5–6), so they look up at you. The camera turns until the fire sits mid-way across the part of the screen the panel leaves free (measured from the panel, so the 66% phone panel works too). Each pick leans you in. **Take the radio** stands you up as the picture goes dark (0.9 s), then the briefing.
- **Six hand looks** (`HAND_LOOKS`): brute, fixer, scout and defector get their own gloves, sleeves and cuffs (they shared the infiltrator/engineer pairs). Colours ride in the merged hand meshes' attributes: 205 → 205 pipelines cycling all six.
- **The first minute**: a new run starts where you stood up (camp space (−12.3, 0), facing the fire and the four, the pump island with Mara's note on your left), at the hour you chose under (17.65; was 17.1 at SPAWN, 25 m away behind the station). `?autostart` keeps SPAWN.
- **No lazy shaders in the menus**: character select's hands (and their items) compile in the boot warm-up. Before: +6 pipelines at character select; now 0. Run start: +2 as before.
- **Website**: `marketing-shots.mjs` gains free-camera shots from the title screen (`cine(space, eye, at, fov, hour)`, camp or Dry Creek space) and `BB_MEDIA_OUT` for previews; `hands-lab`, `marketing-shots` and `og-card` take `BB_PORT`. New hero (the camp four at golden hour on a long lens, right of the headline), camp.jpg (blue hour), place-creek.jpg (Sol and Ren at dusk, Meshy models), combat.jpg (a Kade crew in hi-vis, the old city on the skyline). og.jpg regenerated. The site's "no textures, no asset packs" line now only claims the desert.
- **Not done / ideas**: the og card's tagline crosses the group's feet (the hero has no room to push them further right; a dedicated og background would fix it). A storm-front shot for feature 03 didn't read (the upwind horizon is mountains). The briefing is still "on the radio" while Mara sits in front of you (voiced text, left alone). Not checked in the desktop app (WebKitGTK): the glide and the title cuts are camera moves and a post uniform only, no new CSS.

## 2026-10-09: environment detail, round 2 (swarm: environment)

Toured the map headlessly by day and night (spawn, highway, shoulders, gas station from four sides, drive-in lot, outposts, open desert, hilltop vistas) and ranked the cheapest-looking spots: the gas station store (a bare box from three sides, at spawn), the ground cover (an even field of tufts like planted rows, one sand tone), the empty highway, and storms that only happened in the sky. Fixed those four:

- **Ground cover** (`Scrub.ts`, `Terrain.ts`): bunchgrass grows in bunches around clump hearts with bare sand between (cells can hold 1–3 tufts). The terrain has wind-stripped **desert pavement** (a matte cracked stone mosaic, dense varnished 3D pebbles, almost no grass) and pale **cracked silt** in shallow hollows. Both come from one low-frequency patch field; `groundPatchAt` is its CPU twin through `noiseAt()` (new in `noiseTex.ts`: a bilinear CPU read of the noise atlas), so the scatter agrees with the shader. Shader grit now lies in irregular drifts (the cell-shaped blobs of dots read as animal tracks). Pebbles fill nearest-first, so a full pool drops the farthest stones instead of one side. Note: pavement is matte (the grazing sand sheen washed its dark stones out), and it still reads pale at midday because of the grade, which I left alone.
- **Storm wall at ground level** (`effects.ts` `StormWall`, `Weather.wallDist/wallVis`): through the front phase a boiling dust wall rolls in from 1.1 km upwind (about 25–35 m/s). It's one depth-tested arc around the camera, so a ridge nearer than the front stands out against it and disappears once the front passes it. The head overhangs as it arrives, then the murk closes in (intensity jumps at 140 m; the air stays fairly clear until then so you can watch it come). It has lit puff tops, dark folds and skirt, a silver rim against the sun, and lightning inside. Unfogged, so it carries its own haze. Hidden when calm, compiled at boot.
- **Last Chance Gas** (`Landmarks.gasDressing`): stucco over a plinth, a fascia with a red stripe, a MARKET board on the parapet, a striped awning, a FIZZ soda machine and an ICE chest out front. On the east side: restrooms (one OUT OF ORDER) and a water heater. On the west: a propane cage and a roof ladder. Out back: a door, meter, condenser, dumpster, bags, tyres, pallets and a NO WATER / NO GAS / DON'T ASK plywood sign. On the roof: A/C units, vents and a dish. Everything uses family materials in the station's batch (so it's in the far LOD and the shadow proxy). The boards share the pylon sign's canvas (now 1024×1280) and material.
- **Highway furniture** (`world/roadside.ts`): leaning delineators with amber reflectors (some flattened), guardrail wherever the shoulder drops 1.6 m+ (three runs, one with a broken sagging section), bullet-holed signs (NEXT SERVICES 212 MI, LAST CHANCE GAS 1 MI, speed limits, curve warnings, KADE HOLDINGS PRIVATE AQUIFER at the Garage turn-off), mile markers, shredded truck tyres, and skid marks swerving off the road into six wrecks. The solids join the poles' MeshBatch. Printed faces use the shared site atlas (`atlasSolid`, new `paint()` entries registered at import), and the skids use its decal material.

**Checked:** pipelines are 213 at boot and stay there through every tour stop and a full storm (the +2 vs 211 is the wall, compiled at boot). Draw calls are within ±4 of before at every viewpoint. 60 fps headless (RTX 4050, WebGL, High). Storm sequences shot at 15:00 from the ground, at dusk from the hilltop, and at night.

**Not done / next:**
- A desktop-app bench, mainly for the storm wall's six atlas taps on a full-screen transparent arc during fronts.
- A gravel shoulder strip in the terrain shader.
- The drive-in lots already had oil and dirt decals and drifts, so I left them.
- Ideas: the wall could dim the sun as it passes overhead; skid marks on the side road and the wash; the jet and data-centre perimeters deserve the same four-sides tour.
## 2026-10-09: perf pass after the Meshy models (overnight swarm, perf agent)

The fight bench had dropped 46 → 42 fps with the Meshy models in. Measured first (headless Chrome at 480×270 so the CPU is the limit, a per-draw hook, a GL-call counter, CDP profiles), then cut what the numbers pointed at. No shader or look changed; pipelines 206 → 203 (fewer, none lazy).

**What changed:**
- **Uniform uploads (WebGL2, the big one).** Every program's render-group UBO (camera, sun, fog, time: ~80 uniforms, ~30 changing) went up as ~30 separate `bufferSubData` calls, for the shadow pass and again for the scene pass: ~1,350 GL calls a frame in a firefight. `renderer.ts coalesceUniformUploads` makes the backend upload the span from the first changed slot to the last in one call (same bytes; the CPU copy holds every value).
- **`DynamicDrawUsage` re-uploads.** Three re-uploads a dynamic attribute on *every draw*, changed or not. Tracers, debris, flames, puffs, sparks, arcs, marks, brass, tumbleweeds, jet shafts, scorpions and the fauna mesh all used it (~270 KB a frame, twice). All static now; they already set `needsUpdate` on emit. The fauna mesh uploads only the bodies it rewrote (update ranges). Rule: **never `setUsage(DynamicDrawUsage)` or `instancedDynamicBufferAttribute`**; set `needsUpdate` when you write.
- **Skinned models are culled.** The Meshy clones had `frustumCulled = false`, so all of them were drawn and cast shadows everywhere (a patrol 140 m away, the camp behind you). `kit.boundSkinned` gives each a world sphere per pose (pelvis / hips / body centre); both passes cull them. Their head props (rigid) cull by their own bounds.
- **One matrix pass a frame, visible only.** Three walked all ~1,600 objects (600 bones, more than half hidden) on each scene render (shadow + scene). `scene.matrixWorldAutoUpdate = false`; `kit.updateShownMatrices` runs once before rendering and skips hidden subtrees. A hidden object's matrixWorld refreshes the frame it's shown; code that needs one while hidden uses `getWorldPosition`/`updateWorldMatrix` (all current readers checked).
- **Contractors are one draw.** Hard hat + respirator are skinned into the body on the Head bone, one material picking body/mask/hat maps by a `gear` tag (crew/leader tint kept). 3 draws each → 1; the gear casts its shadow now. Checked close up by day and night, leader and crew.
- **Skin posing** (`humanSkin`, `npcSkin`, `wolfSkin`): no ancestor walk per bone, no per-frame allocations. Bone output bit-identical to before (compared across builds). `kit.viewCull` (camera frustum + the sun's box): a contractor or townsperson in neither isn't posed and is hidden (contractor AI and hit tests still run). Audited over full camera spins: 0 frames with one in view hidden; nothing inside the shadow box (~70 m) is ever skipped.
- **Fewer draws:** sentries and Hornets cast through shadow proxies (lasers, LEDs and the eye no longer cast); stashes through one proxy; halo sprites culled by a sphere round their halos (5 → 2 at spawn by night); marks, brass, puffs, snakes and scorpions draw nothing while there are none.

**Numbers (headless, 480×270, base → this branch, interleaved):**

| spot | frame CPU p25 ms | draws (shadow) | GL calls/frame |
|---|---|---|---|
| fight (`?fight`) | 6.1 → 4.7 | 150 (30) → 126 (21) | 3,180 → 1,710 |
| spawn camp | 6.1 → 4.6 | 130 (26) → 113 (17) | 2,860 → 1,550 |
| Dry Creek | 7.4 → 4.8 | 182 (46) → 151 (23) | 3,750 → 1,995 |

- **Desktop app** (debug shell vs the dev server, fight, High, 936×1138 window; the machine was shared with 5 other agents' headless GPUs, so treat fps as rough): render ms 9–10 → 6.5. One run loaded both builds in turn in an iframe: base ~29 fps, this branch 45–50 fps (39–43 late in the fight). Base alone at top level earlier: ~39–41 fps. The owner should re-run `scripts/dev/bench-desktop.sh high` (with `BB_FLAGS=fight`) on a quiet machine.

**Next:**
- Per-draw cost is now mostly three's own JS (bindings, node updates); fewer draws is still the lever. The viewmodel is 8 draws (hands per material kind + gun parts), rocks are 5 map-wide instanced draws, the gas station near set 7.
- GPU time couldn't be measured (other agents had the 4050 at 90%+). Worth a timer-query pass at 1080p on a quiet machine: scrub 457k tris, shrubs 520k, terrain 360k in two passes.
- Camp/town head props (Hollis's cap, Dez's headset) are still separate draws; the contractor `gear` merge would fold them in too.

**After merging main (08e1b8d, the other seven agents' work):** ElectricArc (SeedBot taser/EMP, storm lightning) dropped `DynamicDrawUsage`; the town's startle/barks logic sits inside the viewCull skip; errand props (relay, survey table and book, stakes) cast through shadow proxies. Pipelines stay flat through the camp at night, a fight with an explosion, a storm with the wall and three strikes, SeedBot's zap and EMP, and an outpost terminal hack (main 215 throughout, this branch 212 throughout). Re-measured against main, 5 interleaved rounds, mean frame CPU p25: fight 6.3 → 5.3 ms, spawn 6.4 → 5.0, Dry Creek 6.9 → 5.9; draws (shadow) 165 (31) → 141 (22), 145 (27) → 129 (18), 185 (46) → 154 (23); GL calls/frame 3,510 → 1,925, 3,215 → 1,810, 3,795 → 2,050.

## 2026-10-09: the bunker runtime (overnight swarm, bunker agent)

The backlog said "extract a generic bunker runtime from `Garage.ts` first". That's done, and the Garage is now one instance of it with no change in behaviour.

- **`game/bunker/Bunker.ts`** (abstract `Bunker<Shell>`):
  - Setup: a bunker class builds its shell, registers its drones with `guard()`, then calls `init()`. The shell is a `BunkerShell` (`shell.ts`): group, origin, `points`, `doors`, `innerBox`, `groundsBox`, tripwires, lasers, cameras, loot spots, lock meshes, an inside-only group and an LOD.
  - It runs whatever `content/bunkers/<id>.ts` → `security` describes:
  - **Entries:** each has a primary method and an optional secondary (one method, or a choice card).
    - Methods: `lockpick`, `circuit`, `keypad`, `splice`, `charge` and `open`.
    - `keypad` has hints driven by flags. Too many wrong codes locks it out and rings the alarm.
    - `splice` filters its daemons through `daemonPending`. What each daemon does lives in `onDaemon`.
    - `charge` is quiet at Demolition 4 when you're crouched, unless the data says `quiet: false`.
    - `open` is a known gap with nothing to beat.
    - `openEntry(id, {line, trauma})` is the only way a door opens.
  - **Hazards** (`hazards.ts`):
    - `Tripwires`, and `LaserGrid` with its power box.
    - `CameraGrid` (new): it sweeps, sees in a horizontal cone with line of sight, and calls the alarm once detection fills. Flag `<id>.cameras.off`.
    - Drone events: alarm, the zap (you're caught), sputter and reboot lines, crashes. EMP.
  - **Alarm** (`triggerAlarm`) and the **owner's voice** (greeting, taunts, alarm barks).
  - **Loot:** each container takes `guaranteed` or a slice of the roll table. Looting them all marks the bunker busted and fires `bunkerComplete`.
  - **Interior mode:** `interior` is built from `innerBox` plus the portal entries, and `cull` hides the inside-only draws.
  - **Save flags** come from ids and are unchanged for the Garage: `<id>.<entry>.open`, `<id>.<wire>.disarmed`, `<id>.lasers.off`, `<id>.cameras.off`, `<id>.loot.<spot>`, `<id>.complete`. Renaming an id orphans its flag in existing saves.
  - Hooks: `talk()` (intercoms), `onDaemon`, `daemonPending`, `frame`, `updateLights`, `objective`, `startAudio`.
- **The Garage** (`Garage.ts`, 860 → 270 lines):
  - Its data is in `content/bunkers/garage.ts` (`security`).
  - The class keeps:
    - Tanner's conversation and its effects
    - the SPLICE daemons (the vault line, SeedBot docking)
    - the lights
    - the objective text
  - Game sees the same API as before: `b`, `drone`, `houseBox`, `yardBox`, `playerInside`, `alarm`, `sparks`, `interior`, `emp`, `cull`, `update`, `outsidePoint`…
- **Voice clips:**
  - Spoken lines in bunker data are `{ speaker, text }`, so `scripts/voice/extract.mjs` finds them. Otherwise SeedBot's sputter, reboot and EMP lines would have been dropped as stale on the next re-voice.
  - Re-extracted: the same 466 clips.
  - Tanner's door and alarm lines were never voiced (they go through `taunt()`, which computes the speaker), and they still aren't.
- **Tier 2 skeleton, not placed in the world:**
  - `content/bunkers/apex.ts`: Vesper Kade's vault. A hangar door, an airlock (keypad or SPLICE), cameras, a laser corridor with a breaker, and the cistern room. A TODO list is in the file.
  - Her taunts are empty on purpose, so nothing placeholder gets voiced.
  - `bunker/apex/` holds a greybox `ApexBuilder` and `Apex`.
  - Nothing in Game imports it, and the build tree-shakes it out.
  - Two DAEMONS added: `airlock` and `cameras`.
  - Its placeholder location (−460, −80) is past the current map edge.
- **Proof** (headless, RTX 4050), run on the branch and again after merging main:
  - **Deterministic heist trace** (`/tmp/swarm-bunker/heist.mjs`):
    - Setup: the frame loop is frozen, `Math.random` is seeded, the clock is simulated and the minigame UIs are stubbed. A fresh Garage is driven by `update(1/60)` with a scripted player.
    - Coverage:
      - approach, greeting and 80 s of taunts; every intercom effect
      - picks on the gate, side door and vault; the gap
      - tripwires: crossed standing and crouched, disarmed, yanked loud and quiet
      - side door: shorted, and both charges
      - the fuse box at Electronics 0, 1 and 5; both lasers
      - keypad: lockout, hints, success
      - SPLICE: aborted, traced, vault; the vault charge
      - crates, the safe and the busted banner
      - SeedBot: patrol, alert, zap, EMP, reboot
      - objectives, and `applyFlags` from a save
      - interior `hides()` and `cull` from 64 views
    - Result: 774 events, identical to main's apart from the order of the interactables list.
  - **Real UI** (`realui.mjs`):
    - F at the vault opens the real choice card.
    - The real SPLICE matrix was solved by clicking: 3/3 daemons (vault open, lasers off, SeedBot docked).
    - The keypad was typed 1-2-3-4, and the intercom was used.
  - **Save from main:** a mid-heist save made on main, loaded with `?continue`, restores identical flags, doors, colliders, lasers, tripwires, lids and visible interactables.
  - **Screenshots at night** (gate, yard, hall with lasers, alarm, vault, interior mode): the pixel diffs are within the run-to-run noise floor. Draw counts are equal, and pipelines stay at 212.
  - **The Apex skeleton end to end** through the runtime (`apex.mjs`):
    - the greeting, a hangar pick, and a camera calling the alarm
    - keypad lockout, and SPLICE (cameras looped, airlock opened, a trace)
    - a laser trip, the breaker, and a vault charge
    - loot, ending in `apex.complete` and `bunkerComplete`
    - interior hiding, and flags restoring the world
- **Seen, not changed** (behaviour kept on purpose):
  - Every `applyFlags()` resets `greeted`, so Tanner repeats "Hey! You! This is a PRIVATE apocalypse" right after each door opens within 55 m, often over his own "My gate!" line. One-line fix: reset `greeted` only when `instant`.
  - Opening any door also resets the keypad's wrong-code count.
- **Next:**
  - Apex for real: a builder, a place, Vesper's dialogue on an intercom, Kade patrols as its guard layer, lights.
  - A `Bunker` registry in Game once there are two. Interactables, update/cull, interiors, `exteriorRoots`, EMP and the map markers all still name `garage`.

## 2026-10-09: loading and web delivery (overnight swarm)

- **Models 22.7 MB → 13.1 MB, same look** (`scripts/models/slim-glb.mjs`, run last by prep-glb/build-glb, every model re-packed): no tangents (nothing uses a normal map), 16-bit weights, 16-bit UVs, 8-bit normals (KHR_mesh_quantization), 16-bit rotation keys, 16-bit indices where they fit. Before/after renders in a fixed pose: mean difference < 0.4 grey levels; the wolf and contractor sheets in the prop lab are indistinguishable. 8-bit weights moved Inez's hair visibly, so weights stay 16-bit. Code that merges model geometry must expect normalized integer attributes (`humanSkin.gearUp` turns them into floats first).
- **Downloads start at boot** (`game/bootModels.ts` → `engine/models.ts`): every model is fetched before the renderer starts, three at a time in the order the boot parses them; the loaders parse the prefetched bytes (`loadGLB`). While boot waits on them, the bar moves with the bytes ("… · 6.3 / 13.1 MB").
- **Caching:** models and voice clips are requested with a content hash (`?v=`, computed in vite.config.ts), and netlify.toml gives `/models/*` and `/voice/*` a year, immutable. Tauri ignores the query string, so the desktop app is unaffected.
- **Measured** (`scripts/dev/load-bench.mjs`: serves dist like Netlify, throttled, headless; noisy while other agents share the GPU/CPU): cold load at 20 Mbit, bytes 23.9 → 15.3 MB; shader compile starts at ~9 s instead of ~14.3 s; title 24.0–24.5 s → 18.5–23.9 s. Phone profile (10 Mbit, 4× CPU): compile starts at 23.6 s instead of 34.5 s, title 81.8 → 52.2 s. Warm (cached) loads unchanged (~10–12 s, all shader warm-up), but now make no model requests at all. Pipelines 210 → 212 through title → New Game → Take the radio → play → a squad + pack, same as main.
- **Tried, dropped:** compiling the already-built scene while models download (pre-warm). Pipelines were reused, but the final warm-up got slower and the total didn't improve; reverted. Not done: moving Rapier's 4 MB base64 wasm out of the JS (1.33 → 1.0 MB brotli, but only if Netlify compresses `application/wasm`; unverified); downscaling the 2k contractor/wolf textures (visible up close).
- **Where boot time goes now:** shader warm-up, 6–9 s headless (≈5 s of it is three's TSL node building in JS, ≈1 s GL link). That's the next target, not bytes.

## 2026-10-09: environment detail, round 3: the sites (swarm: environment)

Toured every point of interest from four sides by day and night (jet, ColdStorage, drive-in, Tube, Spire, the four outposts) and ranked them. The Spire was the barest (a lattice tower, a shack and a generator on a bare mound, dark at night), then the outposts (props on a pad; the gate sign was a blank tin plate). The jet, the drive-in, ColdStorage and the Tube already held up and were left alone. Fixed those two, plus the storm sun:

- **Print atlas** (`world/printAtlas.ts`): the site atlas (jetKit) is full (shelf-packing threw at boot with 6 more entries), so printed art outside the sites goes in a second 2048×1024 canvas with one lit, double-sided material. The outposts' banner moved into it, so every outpost's prints are still one draw. It shares the banner's program (pipelines unchanged).
- **The Spire** (`world/spire.ts`, called from `Landmarks.radioTower`). It's now a cell-site compound: a chain-link fence with barbed wire and the gate left open with its chain cut, the north-east run flattened where the tower top came down, and a flap on the west side cut and peeled back (bolt cutters in the sand). There's a Hivemind Wireless site sign ("COVERAGE IS A HUMAN RIGHT*"), an RF plate with TOLD YOU sprayed on it, and equipment cabinets with blinking LEDs and a cable bridge to the tower. The site office got a door, a step, a "HARD HATS NOT PROVIDED" sign and a porch lamp (a VirtualLight at night, with a warm pool decal). Outside the fence is the truthers' camp the tower fell on: a flattened dome tent, a standing one, a foil-lined "faraday" lean-to, camp chairs round a fire ring, a cooler, a megaphone, a bedsheet banner (THE TOWER IS LISTENING) facing the east approach, placards (5G = MIND CONTROL; WE WERE RIGHT (MOSTLY) by the west cut where the road comes up), and solar fairy lights that come on at dusk. Colliders cover the fence runs, gate leaf, cabinets, tent and lean-to. The relay spot and the blueprint are untouched; the gate (3.4 m), the flap and the crushed corner are open ways in.
- **Outposts** (`combat/Outposts.ts`): each gate plate now prints the outpost's name and motto (WATER IS A SERVICE™, THE CREEK, NOW WITH OVERSIGHT…). Every outpost also got a YOUR COMPLIANCE KEEPS EVERYONE SAFE vinyl on the front sandbags, a "0 DAYS WITHOUT A RECOVERY INCIDENT" board, a CCTV mast (SMILE: YOU'RE A DATA ASSET) with a red tally light, a KADE COMFORT STATION ("your break is being timed"), jerry cans, a cable drum, and oil and dirt decals. Tier 2+ add water-filled barriers out front and a **field-office container**: Kade livery on the outside, a door with a step, a lit window, a door lamp (`OutpostBuild.nightGlow`, driven by Recovery at night while manned), and four cover points along its walls. Crew posts, sentries, mines, the terminal and the locker are all clear of it.
- **Storm sun** (`Atmosphere.sunShade`, fed `wallDist`/`wallVis` by Weather): the wall's ~250 m head dims the sun by up to 70% as it passes over (from ~280 m out). A low sun on the wall's side of the sky goes out much earlier (250/tan(elevation)). Before this, the sun only dimmed once the murk arrived at 140 m.

**Checked** (after merging main): typecheck and build pass. Pipelines stayed at 212 through 73 tour stops (four sides × day/night at the Spire and every outpost, plus close-ups) and a full storm front. Draw calls in A/B on the merged base (same views, my files reverted vs not): the Spire is +7..+10 near (print, decal, pool, chain link plus its shadow, fabric, wood), outposts +0..+6 (one print, one decal, plus window/plain families where new), and the far stand-ins are unchanged.

**Next:** the jet perimeter is empty sand from 50 m and nearly invisible at night except the strobe; ColdStorage's north and east sides are pitch dark at night (perimeter security lights on solar would suit NIMBUS). There's no walk-probe yet through the new Spire gate and flap. The site atlas is full, so new site art should go in the print atlas or a repack.

## 2026-10-09: Controllers and key rebinding (controls agent)

**What works:**
- **Gamepad** (standard Gamepad API, no dependency; `src/engine/gamepad.ts`, a no-op without the API or a pad). Left stick moves (radial deadzone 0.17, analog walk speed), right stick looks (deadzone 0.13, ^1.9 curve, ~170°/s at the rim plus a turn boost after 0.22 s, scaled by the existing sensitivity setting, ADS zoom and invert-Y because it goes through the mouse delta). LT aim, RT fire, A jump, B crouch (toggle), X use / hold X the other way in, Y reload / hold Y holster, LB/RB previous/next weapon, hold LB torch, L3 sprint (latches until you stop), R3 melee, d-pad hotbar, View kit / hold View map, Start pause. Rumble on firing, hits and blasts (Settings → Controls can switch it off).
- **Soft capture:** a pad can't request pointer lock (no user gesture) and shouldn't grab the X pointer in the Linux app, so `Input.requestLock()` with the pad as last device just sets `locked` (`input.soft`). A click on the view upgrades to a real capture; Escape releases it. `html.padplay` hides the cursor.
- **Menus** (`src/ui/PadNav.ts`): a focus ring on the top menu (overlay → character select → title), spatial d-pad/stick navigation with auto-repeat, A clicks, B is Escape (Back on character select), LB/RB flip the kit tabs, right stick scrolls, sliders/selects take left/right. Minigames are driven by synthetic key events dispatched from `document.body` (so panel capture listeners still stop them before the game's own listener on window): lockpick, scope, SPLICE, keypad. Minigame footers swap to pad hints under `html.pad`.
- **Glyphs:** prompts, hotbar labels, the skill-point badge and modal footers show the bound key, or the pad button (Xbox letters; PlayStation shapes for Sony pads) when a pad was used last (`Input.device`, `bb-device` event, `html.pad`).
- **Rebinding** (`src/engine/bindings.ts`, `src/ui/ControlsView.ts`; title/pause → Controls, or Settings → Controls…): 26 actions, two keyboard slots (keys or mouse buttons) and one controller button each (holding a button while binding binds a "hold"). A key another action had trades places with the one given up (with a note); Backspace clears; Reset to defaults. Saved as `Settings.binds`, sanitised on load (old settings get defaults; unknown actions, bad codes, Escape/Start and duplicate keys are dropped).
- Game code reads actions (`input.act('jump')`, `input.actPressed(...)`), never raw codes (Escape stays raw). Touch buttons press `act:<action>`, so phones never depend on the bindings.

**Verified (headless):** `scripts/dev/pad-test.mjs` (a fake pad via a `navigator.getGamepads` stub: title → character select → briefing → play; walk, half-stick walk, sprint latch, look, deadzone, crouch toggle, jump, ADS, fire + rumble, reload, holster, cycle, torch, hotbar, kit tabs, map, pause → settings slider → Controls → back out → resume; keypad, lockpick, scope, SPLICE) and `scripts/dev/controls-test.mjs` (migration of old and corrupt settings; rebind jump to G and play with it; conflict swap; mouse-button bind; clear; cancel; reset; keyboard/mouse regressions incl. pointer-locked LMB/RMB/look; touch crouch/kit buttons). All pass on the branch merged with main.

**Not done / next:** untested on real hardware and in WebKitGTK (its Gamepad support depends on the build; without it nothing changes). No aim assist yet (a slow-down over hostiles would help stick aiming). A pad press may not count as a user gesture for starting the AudioContext in browsers (the desktop app is fine). Tutorial toasts still name the default keys in prose.

## 2026-10-09: townsfolk out of lockstep, wrists and hands (NPC_ANIMATION_FIXES.md §2–3)

The owner: people sitting together played identical, synced loops and mirrored each other ("GTA 4 on a log"), and some hands faced the wrong way. Worked from `Assets/NPC_ANIMATION_FIXES.md` (BunkerBustersBot's diagnosis). Code and rebuilt models only; no Meshy credits (the doc's §4, ~51 credits of own-rig seated clips, is still optional).

- **Desync** (`world/npcSkin.ts`, `world/npc.ts`): a tempo per person (0.9–1.1×); a running clock per looping clip from a random start (a switch crossfades into wherever that clip is; nothing restarts at t = 0); idle pools (`idle*`) drifted between every 12–30 s with 0.8–1.2 s crossfades; one-shot gestures (`ins*`) dropped in now and then; a 0.2–1.2 s beat before reacting. Crowd: each figure notices you at its own radius (def ± 1 m, leaving 0.75 m further out), heads follow after a 0.15–0.6 s beat at their own speed with small gaze darts, bigger turns take more neck and then the chest. A coordinator per crowd: figures within 4.5 m (a campfire circle) never start one motion (`src`) within 3 s of each other, are steered away from what the others play, and a loop picked up while a neighbour plays it (or its mirror) runs half a loop apart. Seated chatters (Sol and the camp) mix their talk loop into their idles. Breathing for all; a slow weight shift for those standing.
- **Wrists** (`world/limbTwist.ts`): Meshy rigs have no twist bones, so a clip's forearm roll (Inez's Checkout_Gesture −134°, Doc's talk +102°, Ren's drink −97°) wrung the wrist skin. `WristTwist` splits the hand's change since bind into roll-about-the-forearm and bend (twist on the left: the hand ends exactly where the clip put it, checked < 1e-5°), moves 55% of the roll into the forearm, clamps the rest (50°) and the bend (70°). `HAND_FIX` (per person/role) is empty: nothing needed it yet.
- **Retarget** (`scripts/models/build-glb.mjs`, rig math in `rig.mjs`): borrowed clips were world deltas onto a different rest pose (arms 8–35° apart, mitts up to ~60°). Now the target's rest is turned onto the source's first: limbs by the shortest arc between bone directions, hands by mitt frame. Lab check: Pip's drink reaches the face like Ren's (it was off to the side), Hollis and Dez land their hands where Wick does. `--mirror f:Src=dst` mirrors world deltas across the midplane with a Left↔Right swap. Clips carry `extras.src` (the library motion) → `clip.userData.src`.
- **Mitt frames** (`mittFrame`, both in rig.mjs and limbTwist.ts): the PCA's longest axis is not the fingers (spread fingers and a thumb make a mitt as wide as long; sleeves skinned to the hand pull it down). What works: vertices weighted > 0.9 within 25 cm of the wrist; long = wrist → centroid (within 5–29° of the forearm on every rig); palm = thinnest axis. A mitt's shape doesn't say which face is the palm (third-moment "thumb" heuristics flipped L/R on Hollis, Mara, Doc), so the palm side is a hint: snapped to the source's for retargets, set by eye for props.
- **Models** (`scripts/models/build-npcs.sh`, new: the build commands weren't written down): idle pools and mirrors per person; Dez plays mirror images of everything (Hollis beside him plays the originals); Inez's Checkout_Gesture is an occasional gesture, not her loop; Listening_Gesture is a second talk loop for Nia, Doc and Inez; Hollis may doze (Wick's). Doc lost Hand_on_Hip_Gesture (it lifts the clipboard over his head). +0.4 MB over the ten.
- **Hand props:** Ren's and Pip's mug across the right palm, Doc's clipboard gripped by its edge in his left hand, placed in the mitt frame; one vertex-coloured material made before the warm-up.
- **Contractors** (`combat/humanSkin.ts`, `Humans.ts`): the hand copied the forearm (a paddle), and the forearm's roll came from the chest's forward axis, which an aiming arm points along (it flipped; world +Z when degenerate). Now arms roll with the elbow's bend (hinge axis from the IK; bind taken as bending forward), each hand is aimed along the procedural hand with its palm toward the procedural +Z (measured against the mitt at bind), and the wrist roll is spread like the townsfolk's. The procedural support hand cradles the forend palm up and lies across under it. Standing still, contractors breathe and shift their weight on their own clocks (pelvis 1–3 cm, < 1 cm aiming).
- **Verified (headless, RTX 4050):** `scripts/dev/npc-sync.mjs camp`: walking in past the camp, out and back in, no two people start one motion within 1 s, no neighbours within 3 s, heads turn one by one (7.3 / 8.0 / 8.3 / 9.1 s); after a 5-minute fast-forward, same-motion pairs sit 2–6 s apart. The prop lab (wrists at the doc's frames, Ren/Pip and Wick/Hollis/Dez side by side, props over every clip, contractors across aim yaw ±90° / pitch ±40°, reload, radio, revolver). Pipelines 213 → 213 at the camp, Ren, Doc and Inez. `scripts/dev/human-drift.mjs`: the model holds steady on a ragdoll. `?procnpc` and `?prochuman` load clean. Headless `?bench&fight` update time 1.2–1.4 ms, same as v0.5.6; crowd update 0.054 → 0.08 ms for the camp's four.
- **Not done / next:** no desktop-app bench (it opens a window; the headless numbers say the cost is noise). Not checked on the owner's screen. Sit_and_Drink brings the hand to the brow more than the mouth (the clip pitches the head down), so the mug reads as "drinking" from the side, less so head-on; a mug lies on its side in an open palm. The contractor's support arm falls 11–20 cm short of the forend at full aim (the model's arms are shorter than the procedural ones; unchanged by this pass; the mitt covers it). Own-rig seated clips (§4, ~51 credits, or 21 for Mara, Dez and Pip) would remove the borrowing altogether.
- **Tools:** prop lab `what=npc&id=inez&clip=idle&t=3` (`&ids=a,b&clip=x,y` side by side, `&seat=`, `&raw` without the wrist fixes, `&axes` mitt frames, `clip=bind`); `what=human&meshy&pose=aim&ay=0.9&ap=0.5` (also `&rel=1.1` reload, `&still=6` idle sway, `&gaps`).

## 2026-10-10: sky, horizon, grass and night (overnight swarm 2: visuals)

Surveyed first (24 fixed views: the camp at six hours plus a storm, the sky up, the highway, Dry Creek, The Cut, the jet, ColdStorage, ground close-ups) and ranked what looked weakest: the faceted needle peaks of the bounding range, smeared clouds, grass that turned into black spikes against the sun, a night sky like snowfall, and the dark sides of two sites. Fixed in that order. The midday grade is untouched (no day grade or exposure keys changed).

- **Horizon** (`Heightfield.canyon`, `Terrain.buildFar`): the edge range was ridged noise (needle "dunce cap" peaks), and the far ring cut it into 20–40 m triangles. Now a soft ceiling (~50–110 m, wandering over a km) and broad terraces (steep risers, flat benches every ~22 m) turn it into tablelands that the strata shader bands as cliffs. This applies only above ~18–36 m in the edge band (so a basin or flat out there stays flat) and not within 70–120 m of The Cut (its ridge is as built). The far ring went from 160×40 to 512×96 cells (one draw, +~85k triangles). The edge collision changes too (walls at 412 m; it's mountains either way).
- **Clouds** (`Atmosphere.buildSky`): a cumulus layer under the cirrus. It's a warped fBm field cut at a cover threshold that wanders over tens of minutes (`atmo.uCloudCover`; pin it with `game.atmo.cloudCover = 0.6`), lit by a second tap toward the sun: bright flanks, shaded far sides, grey bases overhead at noon, a silver lining against the sun. The clouds stay lit a few minutes past sunset (pink decks at 18.1–18.3), go dark with a moon rim at night, and melt into the haze at the horizon. The cirrus is finer and fainter. Five atlas taps per sky pixel.
- **Cloud shadows**: the sun's `colorNode` (`Atmosphere.cloudShadow`) dims sunlight where the same field covers a point (world-anchored, 1.5 km up, along the sun ray). About 250 m patches, 45% at most, none at night or in a storm. Every lit material picks it up (three taps); `game.atmo.uCloudShadow.value = 0` turns it off live. Subtle on purpose; strongest seen from the air.
- **Grass** (`Scrub.ts`): tuft normals lean 60% toward world up, plus toward the sun as you face it. Backlit tufts now take real sunlight (the shadow map still applies, so tufts in a mesa's shadow stay dark) instead of turning into black spikes, with a faint emissive glow on top. **Flora** (`floraMaterial`): daytime backlight through foliage (it fades out as the existing golden-hour rim comes in), and leaves flutter in the wind (vertex shiver plus sway, foliage kind only; `uFloraWind` is set by the Atmosphere).
- **Night**: fewer, varied stars (most faint, a few bright) and a stronger milky way with dust lanes. The moon's direct light is up (0.75→1.15) and the hemisphere fill down (0.42→0.3), so moonlit faces and moon shadows model the ground. Gameplay reads `uNight`, not light levels.
- **Sites at night** (from the 2026-10-09 "Next"): ColdStorage gets seven solar security wall packs on its back, east and west walls (wash, pool and halo on the night channel, two VirtualLights `back`/`east`, two far halos). The jet gets a staked line of 24 green chemlights outside both berms (glow pools, night-channel halos, every third on the far stand-in, one green VirtualLight). **Bug fixed** on the way: the jet's and drive-in's near halos were given world positions on a sprite that rides the site's transformed root, so they were drawn at twice the site offset (off the map). They're site-local now (the jet's strobe halo shows again).
- **Road mirage** (`Terrain.ts`): on hot afternoons (`gradeU.heat`), the far asphalt at grazing angles turns into a wobbling pool of sky colour (from 30–90 m out, road only, emissive).

**Verified** (headless WebGL on the 4050, with a scratchpad harness: one browser, fixed teleports, cameras and hours): before/after pairs at identical views for every change. Pipelines were 213 in every view before and after (title, camp, sites, night, storm, Garage). Draw calls didn't change beyond noise (camp noon 132/132, highway golden hour 133–135, aerial 129–132). Headless uncapped render ms, base vs after, alternating builds (the GPU was shared with other agents, so it's noisy): camp noon 3.4–7.5 vs 3.7–9.8, highway golden hour 3.9–8.2 vs 3.9–7.8, aerial 4.9–8.1 vs 5.2–13.3. All within noise. `npm run build` passes.

**Not done / next:** no desktop-app bench (the extra cost is GPU texture taps, and the GPU isn't WebKit's bottleneck). Cloud shadows could be stronger if the owner likes them. Mesa cliff lips show V-shaped sand tongues (the rock mask against a 2 m grid); they read fine as sand spill but could be smoothed. I didn't check the drive-in halo fix by eye at night (the marquee wasn't in my views). The far city skyline is still flat grey boxes. Marketing shots were re-rendered to the scratchpad, not to `public/media`.
