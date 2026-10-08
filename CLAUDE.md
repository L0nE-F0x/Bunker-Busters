# Bunker Busters: agent hand-off

First-person post-apocalyptic heist game (Three.js r186 WebGPU/WebGL2 + TSL shaders, Rapier physics, fully procedural, no art assets). It ships as:
- a **website**: https://bunker-busters.netlify.app/ (marketing/download page at `/`, browser build at `/play/`)
- a **desktop app**: Tauri 2. WebKitGTK on Linux, WebView2 on Windows. Downloads come from GitHub Releases.

Repo: https://github.com/L0nE-F0x/Bunker-Busters (public, branch `main`). Read `BUNKER_BUSTERS_SPEC.md` for the design and `NOTES.md` for the dev log and findings.

**Current phase:** v0.5.5 is live (combat from v0.5.0, then voices, scavenging, bullet marks/brass, and real Meshy models: the wolf, Kade's contractors with hard hats and respirators, the six Dry Creek locals, the rattlesnake and the scorpion). The owner has the desktop app installed. We are **refining and iterating**, and the big push now is **replacing procedural characters with Meshy models** (see "Next session" below). The owner cares most about visual quality ("make it look incredible"), then game feel. **Batch fixes; release only when the owner says "ship"** (then do it yourself with `scripts/release.sh`).

### Next session (handoff, 2026-10-08)
- **Meshy API:** the owner is on Pro; the key is in `~/.config/meshy/key` (chmod 600, verified: 1,080 credits on 2026-10-08). Read it from there (`Authorization: Bearer $(cat …)`); **never** copy it into the repo, a script default, or chat. Before spending credits on a batch, tell the owner the rough cost. API docs: https://docs.meshy.ai/api (async tasks: create → poll → download GLB; image/text-to-3D, remesh, **humanoid-only** rigging, a 678-clip humanoid animation library at `GET /openapi/v1/animations/library` (free to list), balance at `GET /openapi/v1/balance`).
- **First jobs, in order:**
  1. ~~Wolf death~~ **done in code** (2026-10-08): a timed collapse in `wolfSkin.ts` (`death(t)`): flinch, front legs buckle then hind, topple onto the side with a settle, go limp, one last twitch; a wolf shot mid-run skids. **Meshy's API can't help the wolf**: API rigging and its 678-clip animation library are humanoid-only, and web-app (quadruped) rigs aren't visible to the API. Quadruped clips (run, bite, death), if any, come from the Meshy *web app*, downloaded by the owner into `Assets/`.
  2. ~~Kade contractors, Dry Creek six, snake, scorpion~~ **done (v0.5.5)** from Grok's Meshy batch; read `Assets/MESHY_ASSETS.md` (inventory, clip names, measured offsets, known visual misses not to "fix"). Meshy balance after that batch: 178 credits.
  3. **Still open:** the camp four (Mara, Hollis, Pip, Dez + cap/headset GLBs are in `Assets/`) have no 3D place in the game; add them only if the owner wants camp figures. Contractor clips (walk/run/reload/throw) are in the source files but unused: the procedural skeleton drives the bodies. SeedBot and other machines are still procedural.
- **The pipeline for every model:** raw export into `Assets/`; `node scripts/models/prep-glb.mjs Assets/X.glb public/models/x.glb`; load it in `Game.build` **before** the shader warm-up; scale/orient from the bind pose like `WolfSkins`; check `renderer._pipelines.caches.size` is unchanged when it first appears; aim for ≤ ~20k tris per character; A/B with a URL flag. The owner may also drop files from Grok Imagine into `Assets/` (that's not an agent; nothing else touches the repo).
- **Desktop cost (measured 2026-10-08, `BB_DEV=1 BB_FLAGS=fight bench-desktop.sh high`):** procedural ~46 fps → Meshy models ~42 fps in a fight (render 7.2 → 8.5 ms). Bench again before adding more skinned characters; the next cut would be contractor shadows at range or a merged skinned mesh.

## Daily loop

```bash
npm run dev                  # http://localhost:5173  (site at /, game at /play/)
npm run typecheck && npm run build
npm run desktop              # desktop shell (dev) against the dev server
```

- Pushing to `main` redeploys the website on Netlify (about a minute). That covers the site and the `/play/` browser build.
- Desktop users only get changes through a **release**.
- After a milestone, add a short dated section to `NOTES.md` (what works, what's stubbed, next steps). The spec asks for this.
- The spec says: **ask the owner before adding heavy dependencies.**
- Commits end with the attribution line given in the session's system reminder.

## Releasing (how to ship a new version)

One command does the version bump, checks, commit, tag and push:

```bash
scripts/release.sh patch            # 0.1.0 → 0.1.1  (also: minor | major | 0.3.0)
scripts/release.sh patch --dry-run  # bump + verify, then restore files: nothing committed
```

What it does:
1. Requires a clean `main` that's in sync with `origin`.
2. Bumps the version in **all three places**: `package.json` (+lock), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (+`Cargo.lock`).
3. Runs `npm run build` and `cargo check`.
4. Commits `Release vX.Y.Z`, tags `vX.Y.Z`, and pushes both.

The tag triggers `.github/workflows/release.yml`:
1. Creates a draft release.
2. Builds **Linux** on ubuntu-22.04 and **Windows** in parallel.
3. Uploads assets with **fixed names**, then publishes once every platform has succeeded.

| Asset | Who it's for |
|---|---|
| `BunkerBusters-linux-x86_64.tar.gz` | Omarchy/Arch (recommended). Plain binary against the system WebKitGTK, plus `install.sh` |
| `BunkerBusters-linux-x86_64.AppImage` | any distro. Bundles an older WebKitGTK and is slower (~23 vs 35–50 fps) |
| `BunkerBusters-linux-amd64.deb` | Debian/Ubuntu |
| `BunkerBusters-windows-x64-setup.exe` | Windows 10/11, NSIS. **Unsigned**: SmartScreen shows "More info → Run anyway" |

| `BunkerBusters-linux-x86_64-update.bin` | in-app updater only: the tarball's raw binary, swapped in place |
| `latest.json` | in-app updater manifest (signatures + per-install-type URLs), built by `scripts/update-manifest.mjs` |

- **Don't rename the assets.** The website links to `releases/latest/download/<fixed name>` and asks the GitHub API which assets exist (`src/site/site.ts`).
- The version shown in the game title and the site footer comes from `package.json` (`__APP_VERSION__`, injected in `vite.config.ts`).

Release notes: add a `## vX.Y.Z` section to `CHANGELOG.md` **before** running the script (it refuses otherwise). It becomes the GitHub release notes and the "what's new" bullets in the in-app update card.

**In-app updates** (desktop, from v0.1.1). On the title screen the app checks `releases/latest/download/latest.json` and offers "Update & restart":
- **Code:** `src-tauri/src/update.rs` (commands `update_check` / `update_install` / `update_progress`) and `src/ui/Updater.ts` (the card).
- **How each install type updates:**
  - tarball binary: swapped in place, no root
  - AppImage: replaced in place
  - .deb: `dpkg` through a pkexec password prompt
  - Windows: NSIS installer in passive mode
- **Signing:**
  - Every download is verified against the public key in `tauri.conf.json`.
  - The private key is at `~/.tauri/bunker-busters.key` on the owner's machine (empty password) and in the repo secret `TAURI_SIGNING_PRIVATE_KEY`.
  - **If that key is lost, installed copies can never update again.** It must stay backed up.
- **Local builds:** `npm run desktop:build` now needs the key: `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/bunker-busters.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" npm run desktop:build`. `desktop:release`/`desktop:install` (`--no-bundle`) don't.
- **End-to-end test:** run an older binary with `BB_SELF_UPDATE=1 BB_EXIT_AFTER=30`. It checks, installs and restarts with no UI, printing `[update] …` to stdout.

After a release:
```bash
gh run watch $(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
gh release view vX.Y.Z --json assets --jq '.assets[].name'   # expect the 6 assets above
npm run desktop:install          # update the owner's installed copy (~/.local/bin + app launcher entry)
```

Rebuild a tag's release without retagging: Actions → Release → *Run workflow* with the tag. To fix a broken release, delete the release and tag (`gh release delete vX --cleanup-tag`) and run `scripts/release.sh` again.

## Code map

```
src/main.ts                 boot → createRenderer → Game.build()
src/engine/                 renderer (backend chain, canvas sizing), postfx (TSL post stack), audio (procedural
                            Web Audio: ambience, sfx) + ambient (positional loop voices) + foley/surface (footsteps by
                            surface, room reverb) + music (generative score), physics (Rapier), input, noise + noiseTex
src/game/Game.ts            orchestrator: modes title → charselect → playing, frame loop, items, saves, HUD feed
src/game/Story.ts           quest runtime (steps from flags, rewards, banter); data in content/quests.ts + story.ts
src/game/world/             Atmosphere (sky, fog, sun, day/night), Heightfield + Terrain, Props (rocks, trees, cars,
                            poles, billboards), Landmarks, Scrub (grass + Pebbles), Shrubs (streamed), flora (plant builders),
                            vehicles (buildCar: every wreck), Fauna (all animals, one mesh), effects (dust, haze, fire, light
                            cones, shockwave), materials (factories), kit (geometry, MeshBatch + buildFar, DistanceLod,
                            shadowProxy, Frame), lights (VirtualLight pool), npc (people)
src/game/town/              Dry Creek, The Cut and the wash (Settlement.ts: build half + NPC dialogue/quests half)
src/game/sites/             points of interest, one class each: jet, drivein, datacenter, tube (Site.ts: flag contract)
src/game/bunker/            GarageBuilder (Tier 1 geometry), Garage (locks, hazards, loot, taunts), Drone (SeedBot AI)
src/game/player/            Player (Rapier controller), FirstPersonCamera, Hands (procedural viewmodel + poses),
                            Arms (weapon models + viewmodel animation; hands are solved onto the weapon),
                            CharacterModel (third-person body, now a shadow-only caster), ThirdPersonCamera (unused)
src/game/combat/            Combat (hostile registry, hitscan, enemy fire vs the player capsule, explosions, noise,
                            damage hooks), PlayerArms (the player's guns + melee + takedowns), fx (tracers, debris,
                            flames), Humans (Kade contractors: one SkinnedMesh, procedural joints, Rapier ragdolls),
                            Recovery (squad AI, outposts, road patrols, loot), Outposts (props + cover points),
                            Machines (sentries, Hornet drones, mines). Wolves, snakes, scorpions live in world/Fauna
src/content/                data: items, skills, archetypes, world layout, bunkers/garage.ts (data-driven),
                            weapons.ts (guns, difficulty), recovery.ts (outposts, crews, barks, body loot)
src/ui/                     DOM HUD/menus (UI.ts), Lockpick/Circuit/Keypad minigames, Minimap, TouchControls (phones), styles.css
src/site/ + index.html      marketing page.   play/index.html: game page.   public/media + og.jpg: site art
src-tauri/                  desktop shell. main.rs: auto NVIDIA selection on hybrid Linux laptops, dev hooks. update.rs: in-app updater
scripts/                    release.sh, changelog.mjs, update-manifest.mjs, install-linux.sh, run-nvidia.sh, dev/* (test harness, below)
debug/                      dev-only pages (served by `npm run dev`, never deployed): hands lab, GPU canary, OG card
```

## Verifying changes (do this, don't guess)

The owner's machine: Omarchy (Arch + Hyprland/Wayland), Intel iGPU drives the screen, RTX 4050 dGPU, 144 Hz. Chrome is deliberately pinned to the Intel GPU by `~/.config/chrome-flags.conf`. Don't change that file.

Headless harness. It needs `npm run dev` running, and nothing appears on screen:
```bash
node scripts/dev/shot.mjs "http://localhost:5173/play/?webgl&autostart" out.png \
  --wait 3000 --eval "game.atmo.hour = 21.5" --wait 2000 --fps --shot night.png
node scripts/dev/hands-lab.mjs sheet.png "pose=reach" "pose=lockpick&look=engineer" "pose=idle&torch" "pose=flat&view=palm"
node scripts/dev/props-lab.mjs sheet.png "what=car&kind=pickup&hood=open" "what=tree&kind=joshua" "what=shrub&kind=all" "what=fauna"   # prop lab (debug/props.ts)
node scripts/dev/closeups.mjs outdir car tree grass rock pole wide   # in-game close-ups of the nearest of each
node scripts/dev/marketing-shots.mjs [hero night interior camp lockpick]   # regenerate site screenshots
node scripts/dev/og-card.mjs                                               # regenerate public/og.jpg
node scripts/dev/mobile-shot.mjs "http://localhost:5173/play/?webgl" out.png --tap 230,207 --twin "150,250,150,150;600,200,700,200"   # phone emulation + touch gestures
node scripts/dev/walk-probe.mjs 150 [--sprint]   # movement regression: logs every stall + contacts (FPS=144 env)
node scripts/dev/audio-capture.mjs "http://localhost:5173/play/?webgl&autostart" out.wav 60 --eval "game.atmo.hour = 22"   # record the mix + per-bus dB; then ffmpeg showspectrumpic
scripts/dev/bench-desktop.sh [high|medium]   # real desktop-app perf: opens a window ~40 s, self-closes
```

- The harness renders WebGL on the RTX 4050 headlessly (`GPU_MODE=nvidia|intel|soft`).
- Always pass `?webgl` in headless game URLs.
- `window.game` exposes everything: `game.player.teleport(v)`, `game.cam.snap(yaw,pitch)`, `game.atmo.hour`, `game.hands.setBase('lockpick')`, `game.garage.drone`, `game.state`, `game.ui`.
- Combat debug: `game.arms.equip('rifle')`, `game.arms.trigger()` / `reloadNow()`, `game.recovery.summon(game.player.position, game.cam.yaw, 18, 3)`, `game.recovery.census()`, `game.fauna.summonPack(game.player.position, 30, true, 4)`, `game.combat.difficulty = 'story'`, `game.combat.explode(pos, 4, 50)`. After a teleport, aim on the next frame: the camera only moves in the frame loop.
- **Look at the screenshots.** Visual quality is the product.

Game URL flags:
- `?autostart`: skip menus into a fresh run
- `?continue`: skip the title into the saved run (desktop tests can't aim a click at Continue)
- `?bench`: log fps and update/physics/render ms every 2 s
- `?q=low|medium|high|ultra`
- `?touch=1|0`: force the phone/touch build on or off (on-screen controls, compact layout, mobile quality caps)
- `?webgl`, `?gpu=high|low|reset`: backend override
- `?skip=ui,post,env,dust,haze,props,landmarks,scrub,fauna,garage,terrain,sky,shadows,fog`: subsystem bisecting
- `?fight`: drop a Recovery squad in front of you (Story difficulty, can't die), for benches
- `?interior=off`: never skip the exterior (A/B for interior mode). `?at=garage`: start the run inside the Garage

Desktop dev hooks (env vars):
- `BB_START_URL`: open another URL
- `BB_EXIT_AFTER=N`: auto-quit
- `BB_GPU=integrated`: skip NVIDIA selection
- `BB_SELF_UPDATE=1`: check for and install an update with no UI (updater test)
- Page flag `?trace` (or `?trace=A`, which shows a label): log clicks and keys reaching the page. Uncaught JS errors always go to the console, which is stdout in the app.

The webview's `console.log` goes to stdout.

## Hard-won rules (read before touching these areas)

- **GPU safety:** never launch a *headed* Chrome with its GPU process forced onto NVIDIA (render-node override + PRIME env). It froze the owner's session once. Headless tests are safe. New desktop GPU experiments: a short self-closing window first (`debug/canary.html`, `BB_EXIT_AFTER`), and warn the owner to save work.
- **WebGPU in Chrome on this machine:**
  - On NVIDIA the device is lost on first present (`vkAllocateMemory … OUT_OF_DEVICE_MEMORY`). That's a Chrome/Dawn/driver bug, not ours.
  - The backend chain in `src/engine/renderer.ts` falls back to Intel WebGPU, then WebGL2, and remembers the choice.
  - Detect device loss with `device.lost`, not just `uncapturederror`.
  - WebGPU canvas sizes are padded to 64 px × 128 rows (`fitCanvas`) for cross-GPU swapchain import.
- **Desktop GPU path (Linux hybrid):** PRIME offload + **XWayland + `WEBKIT_DISABLE_DMABUF_RENDERER=1` + `GDK_CORE_DEVICE_EVENTS=1`** is the only path that runs at full refresh. Without the last one, GTK under XWayland never delivers mouse clicks to the page, so the menu looks frozen. Native-Wayland dmabuf crashes with Error 71. `select_gpu()` in `src-tauri/src/main.rs` applies this automatically. WebKitGTK has **no WebGPU**, so the desktop app uses WebGL2.
- **Never use WebKit's pointer lock in the Linux app.** Its X grab freezes the window's presentation under XWayland/PRIME (the page keeps rendering, the screen doesn't). `Input` uses native capture (`mouse_capture` in `rawmouse.rs`); game code listens for `bb-lockchange`/`bb-lockerror`. **Verify desktop changes with screenshots** (grim + md5 every 0.5 s), never `?bench` alone.
- **Mouse look in the Linux app (XWayland):** WebKitGTK's pointer lock barely reports motion there. Mouse look comes from XInput2 raw motion (`src-tauri/src/rawmouse.rs` → `raw_mouse_delta` → `Input.pollRaw()`). It must announce XI ≥2.1, call `XInitThreads()` before GTK starts, and only accept *relative* slave pointers (XWayland's `xwayland-pointer` is absolute).
- **Performance in WebKit:**
  - The bottlenecks are draw-call submission and HTML/CSS compositing over the canvas, not the GPU.
  - Keep meshes merged: `MeshBatch` per material, and material factories are **memoized**, so equal calls return one instance.
  - **Never mutate a factory material.** Use `rustyMetalUnique`/`fabricUnique`.
  - No GTAO pass on WebGL.
  - **No CSS `filter`, `backdrop-filter` or `mix-blend-mode` in WebKitGTK**: they're redrawn on the CPU over the canvas every frame and took menus to ~13 fps. `html.lowfx` (auto in the Linux app, `?lowfx=1` to test) must neutralise any new ones. Throttle per-frame canvas/DOM updates.
- **Lights and distance:** never `new THREE.PointLight` in world code. Use `VirtualLight` (world/lights.ts): a fixed pool of real lights is lent to the nearest, so the light count (and every shader) never changes. New places get a `buildFar()` stand-in under a `DistanceLod` and a `shadowProxy()` for their static batch (skip anything that moves or hides).
- **Shader warm-up (desktop freezes):** WebKitGTK compiles shaders on the main thread, so a material seen for the first time freezes the app. Freezes like that made v0.3.0 feel like "can't move".
  - `Game.warmShaders` compiles everything that's in the scene at boot (during "Compiling shaders"), plus the hands, held items and body at run start.
  - Anything that joins the scene later compiles lazily. Add it at boot (hidden is fine) or add it to a warm-up.
  - Never create a light per instance or at runtime. Lit shaders key on each light's id (`torchLight()` is the shared torch).
  - Check with a pipeline-count hook on `renderer._pipelines.getForRender`, as in NOTES "can't move was shader compiles".
- **Interior mode** (`world/interiors.ts`):
  - Inside a sealed interior whose portals are all out of the frustum, `Game` hides the exterior around the render only, keeping the interior's own roots.
  - The interiors are the Garage, The Cut, the Tube's west tube and the data centre hall.
  - New outdoor systems must be added to `Game.exteriorRoots()`.
  - A new opening in a sealed interior must become a portal, or the exterior vanishes behind it.
  - A new sealed interior gets an `Interior` (sites: `Site.interior`).
  - Never let it hide an object holding a light (`hideExcept` guards this).
  - A/B with `?interior=off`; `?at=garage` starts inside.
- **Plants and animals** share `floraMaterial()` (per-vertex `fColor`: rgb + kind). Add new ones as `Plant` geometry (flora.ts) or a `Rig` (Fauna.ts), not new materials. Streamed scatter must be filled before the boot warm-up (`Game.build` calls each `update` with the boot camera).
- **TSL shaders:**
  - Put tweakable values in `uniform()`, not literals, so instances share one program. Unique literals mean one compile per material, which made loading take 73 s once.
  - Sample the baked noise atlas (`noise()`/`fbm2()` in `src/engine/noiseTex.ts`) instead of per-pixel `mx_*` noise.
  - In `positionNode` on InstancedMesh, instancing is already applied. Use `positionGeometry` for local values.
- **Hands** (`src/game/player/Hands.ts`):
  - Authored at real scale, scaled 1.3 (FP convention), then shrunk by `VIEW_SCALE` toward the eye so they never clip walls.
  - For a right hand palm-down, the thumb is on −x: `a = -side` for anatomy, `side` for screen mirroring.
  - Empty hands rest **off-screen** (`idle` = `DOWN`), like real arms, at the owner's request ("zombie hook hands"). They rise for actions, the torch, sprinting and falling.
  - Forearms come from two-bone IK, and poses blend through a critically damped spring. Keep the rim emissive tiny: near the lens it reads as a glowing outline.
  - Iterate with the hands lab (`&view=palm|side` to check anatomy), never blind.
- **Physics:**
  - The world steps by the frame `dt`.
  - The player is a kinematic controller with real gravity and acceleration limits (constants at the top of `Player.ts`).
  - Dynamic bodies (the EMP canister) are excluded from the controller's query (`EXCLUDE_DYNAMIC`).
  - Footsteps come from `FirstPersonCamera.onStep`, not the shadow body.
- **Combat** (`src/game/combat/`, v0.5):
  - Anything shootable is a `Hostile` from a `HostileProvider` registered with `Combat`. Give it a cheap bounding sphere (`center`, `radius`); `raycast` runs only after the sphere test.
  - Enemy shots go through `combat.enemyRound` (it handles cover, the player's capsule, whizzes and impacts). Damage to the player goes through `combat.hurtPlayer` (difficulty + HUD arc).
  - Muzzle flashes and blasts use VirtualLights owned by `Combat`, never new lights.
  - Contractors share one SkinnedMesh of 10 slots × 16 bones; a slot's gun is baked into its geometry (`SLOT_GUNS`). Bones have no parents: each bone's `matrixWorld` is written directly. More slots means more bones in the vertex uniforms; keep it modest for WebGL2.
  - Ragdolls are temporary Rapier bodies (collision groups 0x0002/0x0001, so parts don't collide with each other). They're removed once asleep.
  - The viewmodel gun is posed first and the hands follow (`Arms` → `Hands`). Don't move the hands independently while a gun is up, or they detach from it.
  - In the Linux app, mouse buttons and the wheel come from `raw_mouse_delta` while captured (the native grab keeps clicks from WebKit). Any new mouse input must read `Input.mouseDown` / `mousePressed` / `wheel`, not DOM events.
  - Iterate visuals with the hands lab (`&arm=…&ads&act=…`) and the prop lab (`what=human&pose=aim&walk=3.8`).
- **Voices** (v0.5.2): spoken lines are pre-rendered neural TTS clips (Kokoro, offline), never live synthesis (the owner rejected formant babble and browser TTS as uncanny).
  - Cast and text rules: `src/content/voices.ts` (speaker → Kokoro voice + fx: room/radio/megaphone/pa/bot). Player: `src/engine/voice.ts`, called from `UI.subtitle`, `pages` and the choice cards.
  - **After editing any dialogue, re-voice:** `node scripts/voice/extract.mjs && ~/.local/share/bb-tts/venv/bin/python scripts/voice/generate.py`. It only renders new or changed lines and deletes stale clips. Kokoro (venv + model) lives in `~/.local/share/bb-tts`, outside the repo.
  - Lines are matched by sentence, so runtime text (names, counts) is just skipped. New speakers need a `CAST` entry or they stay silent (notes, signs and the player are silent on purpose).
- **Models** (v0.5.4+): characters and big animals are real models (Meshy, owner's paid plan: private licence, no attribution). Raw exports live in `Assets/` (git-ignored, except the wolf). **Build game files with `scripts/models/build-glb.mjs`** (`out.glb base.glb --clips anims.glb:Src=role,… --size N`): it merges clips from companion files by bone name, drops scale/constant tracks, keeps only the colour map, strips emission, and repacks (prep-glb.mjs is the older single-file version). Every model loads in `Game.build` before the warm-up; each has an A/B flag and falls back to the procedural version if loading fails.
  - **Contractors** (`combat/humanSkin.ts`, `?prochuman`): the procedural skeleton in Humans.ts still does everything (gait on terrain, aim IK, reload, radio, flinch, hit tests, ragdoll); the crowd mesh now draws only the guns, and `HumanSkins` fits the Meshy rig onto it each frame (torso/head from the procedural frames, arms and legs by IK to the procedural wrists/ankles with the model's own limb lengths). Hard hat (leader orange via a uniform tint that masks the red badge) and respirator ride the Head bone, hidden beyond 40 m.
  - **Townsfolk** (`world/npcSkin.ts`, `?procnpc`): NpcCrowd swaps a named figure for its model; clips renamed to roles (`idle`, `alt`, `near`, `listen`), sampled by hand with crossfades; seated clips keep the hips anchored and sit on the game's seat height; head-turn layered on neck/Head. `neck(id)` still comes from the procedural figure.
  - **Snake / scorpion** (`world/creatureSkins.ts`, `?procfauna`): their Fauna bodies become ghosts (pose, don't draw). The snake model is skinned at load onto the 10 procedural spine segments; scorpions are rigid instances on the body root.
  - The wolf: `world/wolfSkin.ts`. One skinned clone per pack slot, one shared `MeshStandardNodeMaterial`. The baked walk clip is **sampled by hand** (track interpolants, every bone reset to bind first) and driven by the wolf's gait phase. Don't go back to `AnimationMixer`: it only writes a bone when the clip value changes, so layered turns accumulate once the clip weight is 0 (dead wolves curled into balls); crouch, head look, bite, howl, tail and death are layered as rotations about the body's own axes (bone axes don't matter). Loaded in `Game.build` before the warm-up; `?procwolf` A/Bs the old procedural wolf, which is also the fallback if loading fails.
  - Shooting still uses `Wolf.shape()` (capsule + head sphere), sized to match the model.
- Fonts are self-hosted via `@fontsource` (`src/fonts.ts`). Import paths have **no `.css` suffix** (the packages' export maps add it).
- In bash with `set -o pipefail`, don't use `grep -q` on a producer's output (SIGPIPE → false failure).
- Node scripts: use `fileURLToPath(new URL(…))`, not `.pathname`. The repo path contains a space.

## Backlog (owner priorities first)

0. **Real models via Meshy** (see "Next session" above): the Kade contractors, then other characters (the wolf's death is done in code; web-app quadruped clips are optional extras). The owner: "once we get all the different models brought in, this is gonna look insane."
1. **Visual polish:** (done since v0.5: bullet marks, brass, scavenging props; the Garage is already heavily dressed and dust storms exist in `Weather.ts`)
   - better hero/landing art (regenerate `marketing-shots.mjs` once the new models are in)
   - drone and laser VFX
   - character-select presentation
   - the midday grade is flat and washed out, but the owner likes the lighting, so ask before touching it
   - combat is confirmed working in the desktop app, and the owner is happy with time-to-kill and with the wolves by day
2. **Desktop performance:** the target is the 4050 hitting 60+ fps on High in the desktop app. Today it's about 35–50 fps (`scripts/dev/bench-desktop.sh`). Next: merge hand/body meshes, fewer per-frame DOM writes, instancing for repeated props, LOD for far terrain.
3. **Content per spec v0.2:**
   - Tier 2 "Apex Vault" and Tier 3 "The Panopticon"
   - a hacking minigame
   - a stealth/light model
   - crafting
   - Extract a generic bunker runtime from `Garage.ts` first.
4. **Distribution:**
   - Windows installer not yet tested on real hardware
   - code signing
   - a GitHub Actions cache for faster CI
   - optionally an AUR package
