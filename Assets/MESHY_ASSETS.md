# MESHY_ASSETS.md: integrating the Meshy models

> **2026-10-09:** NPCs moving in lockstep or with wrong-facing hands? See `Assets/NPC_ANIMATION_FIXES.md` (diagnosis, code fixes, optional clips).

For the agent that wires the files in `Assets/` into the game. Written 2026-10-08 against `main` at `845e810` (v0.5.4 + wolf-death fix). Every number below was measured from these files (GLB parse, forward kinematics, texture sampling) or read from the code. Anything marked **est.** is an estimate; confirm it on screen. Read `CLAUDE.md` first; this file only adds what's specific to these assets.

- `Assets/` is untracked: all 31 GLBs show `??` in `git status`, including the wolf's raw export. Only `public/models/wolf.glb` is committed. Keep it that way unless the owner says otherwise.
- Nothing here is wired in except the wolf.

---

## 1. Quick start

### Pipeline (`scripts/models/prep-glb.mjs`, no npm deps, needs `ffmpeg`)
```bash
node scripts/models/prep-glb.mjs Assets/X.glb public/models/x.glb [--size 2048] [--q 4]
```
| What it does (from the code) | Note |
|---|---|
| Deletes `emissiveTexture`, `emissiveFactor`, `extensions` on every material | Needed for the wolf (emissive was wired to base colour). The human/prop files have **no emissive**; harmless. |
| Forces `metallicFactor 0`, `roughnessFactor 0.9` | Any MR texture is still multiplied by these. |
| Drops `specular` and `ior` entries from `extensionsUsed` | |
| Re-encodes **every** image to JPEG, scaled to `--size`² (square, lanczos), `-q:v` `--q` | Meshy's human/prop maps are **already 2048² JPEG** (the wolf's was PNG), so this is a second lossy pass. |
| Geometry, skin and animations pass through untouched | It does **not** strip unused maps or merge files. |

Measured prep output (MB):

| Input | Raw | `--size 2048` | `--size 1024` |
|---|---|---|---|
| Kade_Contractor_Rigged | 9.2 | 2.39 | 1.64 |
| Kade_Contractor_Animations | 5.2 | 2.20 | 1.71 |
| DryCreek_Nia_Rigged | 8.5 | 2.17 | 1.52 |
| Rattlesnake | 8.0 | 1.32 | 0.48 |
| Kade_HardHat | 5.5 | 0.77 | 0.35 |
| Camp_Hollis_TruckerCap | 1.9 | 0.48 | 0.22 |

Output goes to `public/models/<name>.glb`, loaded from `` `${import.meta.env.BASE_URL}models/<name>.glb` ``.

### How `world/wolfSkin.ts` does it (the pattern to copy)
1. `GLTFLoader().loadAsync(URL)` inside `static async load()`. On failure it logs a warning and returns `null`, and the caller keeps the procedural version.
2. It replaces the loader's material with **one** shared `MeshStandardNodeMaterial({ map, roughness 0.92, metalness 0 })`. Only `map` is used, so the normal and MR maps are dropped at runtime. It also sets `castShadow`/`receiveShadow` and `frustumCulled = false` (skinned bounds don't follow the pose).
3. It normalises from the **bind pose**:
   - `Box3.setFromObject`, then scale `k = HEIGHT / size.y`.
   - Feet at y 0, body centred.
   - Heading from Hips→`head`, turned to face +Z.
4. It makes one `SkeletonUtils.clone` per slot, wrapped in groups (`root` → `tilt` → `inner` → `fit`).
5. Bones are collected by name into a record. The clip is **sampled by hand** each frame: every bone is reset to bind, then the track interpolants are evaluated. There is **no AnimationMixer**; see §3.6 for why.
6. Gameplay poses are layered as rotations about the body's world axes (`turn(bone, axis, angle)`).
7. It loads in `Game.build` before the shader warm-up (via `Fauna`: `this.skins = await WolfSkins.load(n)`). `?procwolf` A/Bs the old procedural wolf.

### Recommended per-asset flow
1. Prep: `prep-glb.mjs` → `public/models/`. Character bodies need clips merged first (§3.5).
2. Write a `XxxSkins` class modelled on `WolfSkins`: load, shared material, normalise, clone per slot, `hide(i)`/`pose(i, …)`.
3. Keep the current procedural path as the fallback, and add an A/B URL flag (e.g. `?prochuman`, `?procnpc`, `?procfauna`).
4. Load in `Game.build` before warm-up. Check that `renderer._pipelines.caches.size` doesn't change when the model first appears.
5. Screenshot it (`scripts/dev/shot.mjs`, `closeups.mjs`), bench it (`bench-desktop.sh`), then write the NOTES entry (§8).

---

## 2. Inventory (`Assets/`)

Tris are from the index count. Bytes are exact. All images are 2048² JPEG unless noted. **Maps:** B = base colour, MR = metallic-roughness, N = normal.

| File | What | Replaces / target in code | Type | Tris | Bytes |
|---|---|---|---|---|---|
| Meshy_AI_Kade_Contractor_Rigged.glb | Kade Recovery contractor, mesh + rig | `combat/Humans.ts` `HumanCrowd` bodies (looks from `Recovery.ts lookFor`) | skinned, 24 j, B+MR+N | 12,401 | 9,242,060 |
| Meshy_AI_Kade_Contractor_Animations.glb | 10 clips (§4.1) | same | skinned, 24 j, B | 12,401 | 5,167,332 |
| Meshy_AI_Kade_Contractor_Walking_Basic.glb | rig-task bonus walk, `Armature\|walking_man\|baselayer` 1.067 s | patrol walk (§4.1) | skinned, B+MR+N | 12,401 | 9,222,308 |
| Meshy_AI_Kade_Contractor_Running_Basic.glb | rig-task bonus run, `Armature\|running\|baselayer` 0.667 s | optional | skinned, B+MR+N | 12,401 | 9,211,696 |
| Meshy_AI_Kade_HardHat.glb | white hard hat, red KADE badge | `HumanLook.helmet` | static, B+MR+N | 2,595 | 5,548,092 |
| Meshy_AI_Kade_Respirator.glb | half-face respirator + canisters | mask kit ("masked soldier", CLAUDE.md) | static, B+MR+N | 2,977 | 5,755,868 |
| Meshy_AI_DryCreek_Nia_Rigged / _Animations | Nia, diner cook, 1.70 m | `world/npc.ts` `NpcCrowd` figure `nia` (`town/creek.ts`) | skinned | 12,436 | 8,499,260 / 4,587,476 |
| Meshy_AI_DryCreek_Doc_* | Doc, 1.79 m | `doc` (creek.ts) | skinned | 12,404 | 9,743,204 / 5,116,308 |
| Meshy_AI_DryCreek_Inez_* | Inez, the Till, 1.72 m | `inez` (creek.ts) | skinned | 12,274 | 9,175,296 / 4,901,104 |
| Meshy_AI_DryCreek_Sol_* | Sol, 1.82 m | `sol` (creek.ts) | skinned | 12,473 | 8,714,416 / 4,951,916 |
| Meshy_AI_DryCreek_Ren_* | Ren, 1.68 m | `ren` (creek.ts) | skinned | 12,449 | 8,244,820 / 4,674,300 |
| Meshy_AI_DryCreek_Wick_* | Wick, hermit, 1.75 m | `wick` (`town/cave.ts`) | skinned | 12,457 | 8,796,760 / 5,033,860 |
| Meshy_AI_Camp_Mara_* | Mara, 1.68 m | **none today**: `content/camp.ts` says camp people are panel-only, "no 3D figures" | skinned | 12,347 | 9,229,832 / 4,919,664 |
| Meshy_AI_Camp_Hollis_* | Hollis, 1.80 m | none today | skinned | 12,469 | 10,137,348 / 5,652,828 |
| Meshy_AI_Camp_Pip_* | Pip (12, girl), 1.45 m | none today | skinned | 12,505 | 9,118,356 / 4,937,224 |
| Meshy_AI_Camp_Dez_* | Dez, 1.75 m | none today | skinned | 12,468 | 9,342,032 / 4,800,016 |
| Meshy_AI_Camp_Hollis_TruckerCap.glb | trucker cap | Hollis head prop | static, B+MR+N | 1,390 | 1,881,212 |
| Meshy_AI_Camp_Dez_Headset.glb | headset (KNOWN ISSUE, §5) | Dez head prop | static, B+MR+N | 2,566 | 6,079,508 |
| Meshy_AI_Rattlesnake.glb | rattlesnake, straight, no rattle | `world/Fauna.ts` `snakeRig()` / `Snake` | static, B+MR+N | 3,084 | 7,992,360 |
| Meshy_AI_Scorpion.glb | scorpion | `Fauna.ts` `scorpionRig()` / `Scorpion` | static, B+MR+N | 3,131 | 7,710,196 |
| Meshy_AI_Lone_Wolf_Walking.glb | wolf, 27 j, 1 clip `Armature\|Unreal Take\|baselayer` 1.000 s, PNG | **done**: `public/models/wolf.glb` (1,519,576 B, JPEG) | skinned | 19,683 | 4,936,324 |

All characters together come to 31 files, about 12.3–12.5k tris each. That's under the CLAUDE.md target of ≤ ~20k per character.

---

## 3. Shared facts (all 11 humans)

### 3.1 Skeleton
| Item | Value |
|---|---|
| Joints | **24**, identical names in every rig, no `mixamorig:` prefix, **no finger bones**. Hands are rigid mitts, so a held prop rides `LeftHand`/`RightHand` as is. |
| Hierarchy | `Hips` → `Spine02` → `Spine01` → `Spine` → { `neck` → `Head` → (`head_end`, `headfront`) ; `Left/RightShoulder` → `…Arm` → `…ForeArm` → `…Hand` }. `Hips` → `Left/RightUpLeg` → `…Leg` → `…Foot` → `…ToeBase`. |
| Scene tree | `Armature` (scale **0.01**) → `char1` (SkinnedMesh) + `Hips`. 26 nodes, the same order in Rigged and Animations. |
| Units | Bone locals are in **cm** (the contractor's Hips rest is ≈ (0.77, 99.6, 0.51)). The inverse bind matrices carry ×100, so the **mesh renders at true metres**. Anything parented to a bone inherits the 0.01, so **1 unit = 1 cm** there. |
| Height | Bind mesh height = requested height (m): see the Height column in §4.2 and §4.3. `town/people.ts` heights (1 = 1.75 m) match: nia 0.97 → 1.70, doc 1.02 → 1.79, inez 0.98 → 1.72, sol 1.04 → 1.82, ren 0.96 → 1.68, wick 1.00 → 1.75. |
| Facing | **+Z**. Left is **+X**: the contractor's bind LeftHand x = +0.465 m and RightHand x = −0.462 m. This matches the `Humans.ts` convention "+X = the person's left". |
| Bind pose | **A-pose**. |
| `head_end` | Placement varies by rig (low on Mara, Dez and Pip). It's a leaf under `Head`; ignore it. |

### 3.2 Rigged vs Animations files
| | `_Rigged.glb` | `_Animations.glb` |
|---|---|---|
| Material | `Material_0`: B + MR + N (2048² JPEG), no emissive | B only (2048² JPEG) |
| Clips | one empty `Armature\|clip0\|baselayer` (duration 0) | the named clips (§4) |
| Mesh | same vertex count as its pair (checked on all 11) | same |
| Skeleton parity (all 11 pairs) | node TRS diff ≤ 9.3e-5 cm / 6.2e-6 (quat); IBM diff ≤ 0.0035 | |
| Animation payload | n/a | 263–636 KB per character. The rest of the file is a duplicate mesh (0.78–1.20 MB) and a duplicate colour map (3.1–4.2 MB raw). |

### 3.3 Track facts (every clip)
| Fact | Consequence |
|---|---|
| 72 channels per clip: translation, rotation and scale on all 24 joints; 30 fps; LINEAR + STEP | |
| STEP samplers have exactly 2 keys: across all 11 files, 890 of 1,022 hold one value, 132 jump once | A mixer writes these bones at most once or twice per loop (§3.6). |
| Scale tracks are 1 within 3e-5 | Drop every `.scale` track at load. |
| Translation tracks on every joint except `Hips` are constant (range 0 cm) | Drop the non-Hips `.position` tracks. That leaves 24 quaternion tracks + `Hips.position`. |

### 3.4 Materials and texture budget
- **No emissive** on any human or prop file. prep-glb's emissive strip only mattered for the wolf.
- GPU cost is computed for uncompressed RGBA8 (how JPEG uploads) with mips ×4/3:

| Map size | Per map | Map-only character (wolf style) | B + N + MR |
|---|---|---|---|
| 2048² | 21.3 MiB | 21.3 MiB | 64 MiB |
| 1024² | 5.3 MiB | 5.3 MiB | 16 MiB |

- All 10 contractors share one texture set, but the 6 Dry Creek locals are 6 distinct sets: map-only that's 128 MiB at 2k vs 32 MiB at 1k.
- **Suggested:** contractors at 2k map-only (seen up close in fights); townsfolk at `--size 1024` first, then compare in `closeups.mjs` at talk distance (their `notice` radius is 5–6 m). Add the normal map only if screenshots show the gain.
- **JPEG via prep-glb is the path that exists.** KTX2/Basis needs an encoder (toktx or gltf-transform) and the transcoder files copied into `public/`. That's new tooling, so **ask the owner first**. KTX2 support in WebKitGTK/WebGL2 is not measured.

### 3.5 Merging clips into one file (recommendation)
| Option | Deps | Cost | Verdict |
|---|---|---|---|
| A. Load both GLBs at runtime; use the Rigged scene + the Animations `animations` (tracks bind by bone name) | none | Downloads a duplicate mesh + colour map: about +1.7–2.2 MB per character after prep (measured: contractor Animations 2.20 MB at 2k, 1.71 MB at 1k) | OK for a first spike |
| **B. A small `scripts/models/merge-clips.mjs`** in prep-glb's style: copy the `animations` (+ their accessors/bufferViews) from `_Animations` into `_Rigged`, map `target.node` **by node name** (the order is identical on the pairs checked, but don't rely on it), drop the `.scale` and non-Hips translation channels and the empty `clip0`, then run prep-glb | none | One file: mesh + 3 maps + clips | **Recommended** |
| C. `@gltf-transform/cli` merge/prune/dedup | **new devDependency** | One file, same as B | Ask the owner first (CLAUDE.md: ask before heavy deps) |

The same script can append the contractor's `walking_man` clip from `_Walking_Basic.glb` (same skeleton and mesh). Renaming it on merge (e.g. `Walk_Basic`) is optional.

### 3.6 Runtime: cloning, mixers, crossfades
| Topic | Rule |
|---|---|
| Clones | `SkeletonUtils.clone(scene)` per instance. Geometry and materials are shared by reference; replace the material **once** on the source before cloning, as wolfSkin does. One shared material = one program. |
| Contractor count | 10 slots (`SLOT_GUNS`). Today that's 1 skinned draw (10 slots × 16 bones, `Humans.ts`); as clones it becomes 10 skinned draws + 10 shadow draws + props. **Bench before and after** (`BB_FLAGS=fight scripts/dev/bench-desktop.sh`). The desktop cost of a 5-wolf pack is still unmeasured (CLAUDE.md). |
| Mixer per instance | `new AnimationMixer(clone)` per instance, `clipAction(clip)`, `crossFadeTo(next, 0.2–0.3 s, false)` for state changes. |
| **The mixer trap** (CLAUDE.md + three r186 `PropertyMixer.apply`, line 233: `setValue` only when `buffer[i] !== buffer[i+stride]`) | A bone the mixer doesn't rewrite keeps last frame's value. Any rotation you **layer on top** (aim, head-look) then **accumulates** on STEP or unchanging tracks, during held poses and at weight 0. This is how dead wolves curled into balls. Two safe patterns: **(1)** do what wolfSkin does: sample interpolants by hand from bind each frame, and blend two clips yourself for crossfades. **(2)** Keep the mixer but, for every bone you layer on: restore the cached post-mixer quaternion → `mixer.update(dt)` → cache it → apply the layer. Never let layered bones drift. |
| Layered bones | aim/look: `Spine02`/`Spine01`/`Spine`/`neck`/`Head`. Use world-axis turns like `WolfSkins.turn()`, so bone axis orientation doesn't matter. |
| Root drift | Hips X/Z, cm; table per clip in §4. In-place loops: flatten Hips X/Z to frame 0 at load. One-shots that travel: bake the end offset into the root when the clip ends. |

---

## 4. Per-character sections
Clip durations are as three.js reports them (max track time). Drift is Hips start→end in cm, (X, Y, Z); any clip not listed with drift moves < 1 cm. `Casual_Walk_inplace` drifts about 1 cm in Y on every rig. "Stance speed" is the backward speed of the planted foot, from FK. It's the ground speed at `timeScale = 1` (**est.**, heuristic: median foot speed while within 3 cm of its lowest point; tune by eye for foot slide).

### 4.1 Kade contractor (1.78 m; bind Head at (0.004, 1.518, 0.019) m)
| Clip | s | Stance m/s | Drift |
|---|---|---|---|
| Idle | 4.000 | | |
| Alert | 4.000 | | |
| Casual_Walk_inplace | 4.133 | 0.69 | |
| Rifle_Charge_inplace | 0.500 | 5.55 | |
| Cautious_Crouch_Walk_Forward_inplace | 1.133 | 1.36 | |
| Walk_Forward_While_Shooting_inplace | 3.267 | 0.27 | |
| Side_Shot | 4.000 | | |
| Standing_Reload | 3.300 | | |
| Crouch_Pull_and_Throw | 5.800 | | **+32.16, −4.77, −29.53** |
| Gunshot_Reaction | 3.000 | | +1.60, −1.01, −8.59 |
| `Armature\|walking_man\|baselayer` (Walking_Basic file) | 1.067 | 1.45 | |
| `Armature\|running\|baselayer` (Running_Basic file) | 0.667 | 4.79 | |

Game state → clip. Speeds come from `Recovery.ts`; poses come from `Humans.ts` `HumanPose = relaxed | ready | aim | reload | throw | radio | sit`.

| Game | Clip | timeScale / note |
|---|---|---|
| `idle`, standing, `relaxed` | Idle | Head-look (`h.look`) layered on neck/Head |
| `suspicious`/`search` standing, `ready` | Alert | |
| Patrol `walkTo` 1.4 m/s (also 1.5, investigate 1.7, search 2.2) | **walking_man** | ≈ speed / 1.45 (1.4 → 0.97). Casual_Walk would need ≈ 2.0× at 1.4 m/s. |
| `runSpeed` 4.6 m/s (advance ×0.8 = 3.68) | Rifle_Charge_inplace | ≈ speed / 5.55 (4.6 → 0.83) |
| Crouched and moving (`crouch` > ~0.5) | Cautious_Crouch_Walk_Forward_inplace | ≈ speed / 1.36 |
| `aim` while moving | Walk_Forward_While_Shooting_inplace | Native speed is only 0.27 m/s; above ~1 m/s, prefer the run/walk legs with layered spine aim |
| `aim` standing | Side_Shot | **Check visually** that it reads as a frontal aim. Aim yaw/pitch is layered on the spine (CLAUDE.md: "aiming via an upper-body bone turn"). |
| `reload` (`GUNS.reload`: rifle 2.8, shotgun 3.2, revolver 2.4 s) | Standing_Reload | timeScale = 3.3 / reload (1.18 / 1.03 / 1.38) |
| `throw` (compliance charge) | Crouch_Pull_and_Throw | 5.8 s and big drift: flatten X/Z, play a trimmed window, find the release frame visually |
| Flinch (`flinch`/`flinchK`) | Gunshot_Reaction | Short partial play or a blend; flatten X/Z |
| `radio` (leader) | **no clip** | Idle + layered left arm, or keep it procedural |
| `sit` role (Recovery sets `crouch = 1`) | **no clip** | Crouch walk frozen at weight, or keep it procedural |
| Death | **Rapier ragdoll** (keep it) | Map bones to the ragdoll below |

Ragdoll / hit-test bone map:
- `Human.joints` is filled for hit tests: `pelvis`, `neck`, `shL`/`shR`, `elL`/`elR`, `wrL`/`wrR`, `hipL`/`hipR`, `knL`/`knR`, `ftL`/`ftR`, plus `headPos`, `chestPos`, `eye` and `muzzle`.

| `Humans.ts` BONE / joint | Meshy bone |
|---|---|
| hips / pelvis | Hips |
| chest / chestPos | Spine (top of the spine chain) |
| head / headPos; neck | Head; neck |
| uArmL, fArmL, handL / shL, elL, wrL | LeftArm, LeftForeArm, LeftHand |
| uArmR, fArmR, handR / shR, elR, wrR | RightArm, RightForeArm, RightHand |
| thighL, shinL, footL / hipL, knL, ftL | LeftUpLeg, LeftLeg, LeftFoot (same on R) |
| weapon | Separate gun mesh on `RightHand`. Its local space is cm, so wrap it in a ×100 group. The grip offset/rotation is **not measured** (Meshy hand axes ≠ the procedural "barrel −Z" convention). |

Per-slot variation from `lookFor()`:
- `height` 0.95–1.03 becomes a root uniform scale.
- Helmet colour: slot 0 (the leader) is `#e05a1a`, the others are near-white. See §5.
- Vest/uniform/skin colours have no per-slot path with one shared material. Keep it one look unless the owner wants tints (as uniforms, never literals).

Visual misses: **don't "fix"** these; regenerating costs credits and is the owner's call.

| Miss | Handled by |
|---|---|
| No hard hat, respirator, goggles, lanyard or logo | Hard hat + respirator props (§5) |
| Holster-like geometry on the hips | Leave it |

### 4.2 Dry Creek locals (`town/people.ts` LOOKS, placed in `town/creek.ts`/`cave.ts`)
`NpcCrowd` today:
- One mesh and one material for all of a site's figures, posed once.
- The vertex shader breathes, sways and turns the head toward the camera:
  - yaw clamp ±1.05 rad, nod −0.35..0.3;
  - notice radius `notice` (5–6 m);
  - idle glances otherwise.
- `neck(id)` returns crowd-space interaction spots and must keep working.
- The material adds the game's rim term (`rimColor`/`rimStrength`); the wolf's doesn't. Decide on purpose.

Shared clips (all six):

| Clip | s |
|---|---|
| Idle | 4.000 |
| Listening_Gesture | 9.333 |
| Casual_Walk_inplace | 4.133 |

Stance speed for Casual_Walk_inplace: Nia 0.63, Sol 0.69, Ren 0.64, Wick 0.66 m/s.

| Id | Height | Game pose (seat / surface) | Extra clips (s) | Suggested mapping |
|---|---|---|---|---|
| nia | 1.70 | `counter`, surface 1.05 | Talk_with_Hands_Open 3.967, Stand_and_Chat 5.167 | Idle behind the counter; Talk while she speaks; Listening while the player picks a reply |
| doc | 1.79 | `clipboard` | Talk_with_Right_Hand_Open 3.733, Shrug 1.967, Hand_on_Hip_Gesture 5.000 | No clipboard clip. Optionally reuse npc.ts's clipboard boxes as a prop on LeftHand (est.). |
| inez | 1.72 | `tend`, surface 1.0 | Talk_with_Left_Hand_on_Hip 5.167, Checkout_Gesture 6.467 | Checkout_Gesture at the till |
| sol | 1.82 | `warm`, seat 0.44 | Talk_with_Hands_Open 3.967, Chair_Sit_Idle_M 10.667, Sitting_Answering_Questions 9.667, Sit_to_Stand_Transition_M 6.167 (drift **+8.91, +27.20, +35.13**) | Chair_Sit_Idle_M; Sitting_Answering_Questions while talking |
| ren | 1.68 | `mug`, seat 0.42 | Talk_with_Hands_Open 3.967, Sit_and_Drink 11.167, Chair_Sit_Idle_M 10.667, Sit_to_Stand_Transition_M 6.167 (drift **+8.77, +26.78, +34.59**), Thoughtful_Walk 4.700 (in place within 3.5 cm; stance 0.53 m/s) | Sit_and_Drink + the npc.ts mug (cylinder + torus) on a hand |
| wick | 1.75 | `warm`, seat 0.40 (cave) | Talk_with_Hands_Open 3.967, Chair_Sit_Idle_M 10.667, Sit_and_Doze_Off 17.300, Sitting_Answering_Questions 9.667, Elderly_Shaky_Walk_inplace 2.833 (stance 0.18) | Sit_and_Doze_Off when nobody's near; Sitting_Answering_Questions when talking |

**Seated clips sit at different Hips offsets.** Measured Hips world (x, y, z) m, which stays constant through each loop:

| Rig | Chair_Sit_Idle_M | Sitting_Answering_Questions | Sit_and_Drink / Sit_and_Doze_Off | Standing Idle |
|---|---|---|---|---|
| Sol | (0.16, 0.71, −0.33) | (−0.12, 0.80, −0.31) | n/a | (0.00, 0.97, −0.04) |
| Ren | (0.17, 0.62, −0.30) | n/a | Drink (0.01, 0.56, −0.01) | (0.01, 0.88, −0.01) |
| Wick | (0.19, 0.61, −0.25) | (−0.13, 0.72, −0.23) | Doze (0.00, 0.57, 0.03) | (0.01, 0.91, 0.08) |
| Hollis | (0.20, 0.67, −0.36) | n/a | n/a | (−0.00, 0.97, −0.02) |

- A raw crossfade Chair_Sit_Idle_M ↔ Sitting_Answering_Questions slides the body about **0.28–0.32 m sideways**. Offset the model root per clip so the Hips line up, or crossfade with a root-offset lerp.
- The feet stay on y ≈ 0 (ankle joints 0.06–0.16 m) in every seated clip.
- The implied seat height is **not measured** (the buttock contact isn't a joint). Fit it against the game's seat (0.40–0.44 m) on screen.
- Sit_to_Stand ends standing about 0.26–0.29 m behind the origin. Bake that into the root at the end.

Visual misses (**don't "fix"**):

| Who | Miss |
|---|---|
| Nia | Pinkish-red headscarf can read as dyed hair; skin lighter than the medium-brown `#8a5e44` |
| Doc | Glasses painted on, not modelled (otherwise fine) |
| Inez | No braid (long loose hair) |
| Sol | Short jacket, not a duster; scarf not visible |
| Ren | Scarf not visible |
| Wick | Blanket worn as a hood; no beanie |

### 4.3 Last Chance camp (no 3D figures in the game today)
`content/camp.ts`: "They live in the camp panel (no 3D figures)". **Don't add them to the world unless the owner asks.** They're ready for a future campfire scene.

Clips: Idle 4.000, Talk (see each row), Listening_Gesture 9.333, Casual_Walk_inplace 4.133 (Pip's stance speed 0.54 m/s).

| Id | Height | Talk clip | Extra | Misses (**don't "fix"**) |
|---|---|---|---|---|
| Mara | 1.68 | Talk_with_Hands_Open 3.967 | Phone_Call_Gesture 10.033 | No vest; headphones on her ears, not round her neck |
| Hollis | 1.80 | Talk_with_Right_Hand_Open 3.733 | Chair_Sit_Idle_M 10.667 | No cap (→ prop) or denim jacket; hip holster |
| Pip | 1.45 | Talk_with_Hands_Open 3.967 | Confused_Scratch 11.500 (drift −1.87, −0.13, +8.35) | Reads as an older/teen boy; no pencil |
| Dez | 1.75 | Talk_with_Hands_Open 3.967 | Scheming_Hand_Rub 3.300 | No headset (→ prop); wires unclear; hip holster |

---

## 5. Head props (parent to the `Head` bone; numbers are Head-local, **1 unit = 1 cm**, **est.** from bind-pose bounds, so check on screen)
Every prop is authored about ±0.95 units in its longest axis (Meshy's normalised export).

| Prop | Raw bbox (units) | Fit on | pos (cm) | rot XYZ (°) | scale | Notes |
|---|---|---|---|---|---|---|
| Kade_HardHat | x ±0.69, y −0.567..0.565, z ±0.95; brim +Z | contractor | (−1.5, 20, −5) | 0 | ≈15 | Contractor cranium centre (−2.0, 19.2, −7.4), size 16.9×12.8×20.3 cm; head top 1.78 m |
| Kade_Respirator | x ±0.81, y −0.638..0.631, z ±0.95; mask/canisters +Z, strap −Z | contractor | (−1.3, 10, −4) | 0 (contractor head is level at bind; check) | 14–15 | Face centre (−1.3, 9.6, 2.2); nose tip z +6.3 |
| Camp_Hollis_TruckerCap | x −0.646..0.638, y −0.518..0.506, z −0.94..0.947; brim +Z | Hollis | (−1.7, 20.3, 2.6) | (−7.5, 3.2, 3.6) | 16 (≈20.5×16.4×30.2 cm) | Hollis Head world (0.0039, 1.5353, −0.0213), head pitched ~7°; head top 1.80 m |
| Camp_Dez_Headset | x ±0.95, y ±0.75, z ±0.38; cups face ±X | Dez | (−1.0, 10.3, −14.2) | (−20.9, 2.3, 3.3) | 13.5 | Dez Head world (0, 1.512, 0.0341), pitched ~21°; head top 1.75 m |

```ts
const hat = hatSrc.clone();             // shares geometry + material
hat.position.set(-1.5, 20, -5);         // cm: Head bone space
hat.scale.setScalar(15);
bones.Head.add(hat);                     // follows the animation for free
```

**Hard hat tint.** The leader (slot 0) wears `#e05a1a`; the others wear near-white (`HELMETS`). Measured on the base colour:
- The shell is near neutral: median saturation 0.025.
- The red KADE badge is about **2.4 %** of texels, mean RGB (0.93, 0.14, 0.16); saturation > 0.5 picks exactly it (2.37 %).
- **The tint must mask out the badge**:
  `col = mix(tex * tint, tex, smoothstep(0.3, 0.5, sat(tex)))`, with `tint` as a `uniform()`.
- Otherwise orange × red muddies the logo.
- Two hat materials (white/orange) on one node graph keep one program.
- The badge also came out larger than "small". It's accepted; don't "fix" it.

**Dez headset: KNOWN ISSUE.** The cups are pinched together at the bottom:
- Left cup x −0.544..0.105 (centre −0.224); right cup x 0.114..0.710 (centre 0.437).
- They touch near x ≈ 0.11. Scaled ×13.5, the band spans about 16.7 cm vs Dez's hair width of 23.1 cm.
- It would need each cup spread about 0.45–0.55 units (~7 cm) outward.
- The antenna sticks up-left off the band; the "mic" is a sideways +X stub.
- **Don't fix it in code or regenerate it.** BunkerBustersBot may fix the asset later. If it's integrated before then, accept the fit or leave it off.

Props add one draw (+ shadow) per instance each. Use one shared material per prop type, created before warm-up.

---

## 6. Static fauna props (rattlesnake, scorpion)
Both files are unskinned single meshes with B+MR+N 2k maps, long axis Z (±0.95 units), **head +Z**. The game uses +Z forward (`facing() = (sin yaw, 0, cos yaw)`).

| | Rattlesnake | Scorpion |
|---|---|---|
| Model | Straight, mild S-bend (±0.12 units); eyes + forked tongue at +Z; tail −Z; **no rattle** | Pincers/head +Z; tail −Z, curled up |
| Today (`Fauna.ts`) | `snakeRig()`: 10 tube segments × 0.11 m (~1.1 m), radius ≤ 0.036 m, head blob at +Z, 4-blob rattle. `Snake.pose` writes per-segment yaw/pitch for `coiled`/`rattle`/`strike`/`slither`; `dead` rolls 2.6 rad (belly up). | `scorpionRig()`: body, 5 tail segments + sting, 2 claws, 6 legs; `b.place(…, 1.8)` (drawn ×1.8); tail curls, legs scuttle, claws sway; `dead` rolls π |
| Recommended | **Skin it at load** (no deps): make 10 bones along Z, give each vertex weights by its Z (linear blend between neighbouring segments), then drive the bones with the **same** per-segment angles `Snake.pose` already computes. Scale to ≈1.1–1.2 m (k ≈ 0.6, **est.**). Keep the procedural rattle on the tail tip or leave it out (the sound already exists). | Rigid swap first: whole-body place/yaw/scale, a sting as a quick body pitch, and a small bob during `scuttle` (visible < 25 m, night only). Skin the tail and legs by region later if the owner wants. |
| Shooting | Keep `raycast` spheres (snake r 0.22, scorpion r 0.14) sized to the new model | same |

- **Material rule:** CLAUDE.md says animals share `floraMaterial()` in one mesh. Textured Meshy fauna breaks that, as the wolf did, so each type is a separate mesh + material.
- Warm them before boot. Check the pipeline count; tell the owner it costs extra draws.
- Prep with `--size 1024` (snake: 1.32 → 0.48 MB); they're small on screen.

---

## 7. Wolf: already integrated, don't redo
| Item | Value |
|---|---|
| Files | `Assets/Meshy_AI_Lone_Wolf_Walking.glb` (raw, PNG) → `public/models/wolf.glb` (committed, JPEG, 1.52 MB), 19,683 tris, 27 joints, 1 clip 1.000 s |
| Code | `world/wolfSkin.ts` (`WolfSkins`), loaded from `Fauna` (`WolfSkins.load(pack.wolves.length)`); `?procwolf` A/B / fallback |
| Death | Done in code today (`845e810`): `death(t)` phases flinch → front then hind buckle → topple + settle → limp → twitch |
| Limits | Meshy's API rigging and animation library are **humanoid-only**. Quadruped clips can only come from the Meshy web app (the owner downloads them). Shooting uses `Wolf.shape()`. |

---

## 8. Integration order and checklist

### Order
| # | Asset | Why |
|---|---|---|
| 1 | Merge script (§3.5 B) + prep for the contractor | Unblocks everything; zero deps |
| 2 | Kade contractor + hard hat + respirator → `HumanSkins` replacing the `HumanCrowd` visuals | Owner priority (CLAUDE.md "Next session" #2). Keep the AI (`Recovery.ts`), hit tests (`joints`) and ragdoll. |
| 3 | Dry Creek six → replace the `NpcCrowd` figures (keep `neck(id)`, head-look, notice) | CLAUDE.md #3 "town NPCs" |
| 4 | Rattlesnake, then scorpion | Smaller visual win |
| 5 | Camp four + cap/headset | Only if the owner asks for 3D camp figures |

### Checklist (per asset; don't guess, look)
- [ ] `npm run typecheck && npm run build` pass.
- [ ] Loaded in `Game.build` **before** warm-up. `renderer._pipelines.caches.size` is the same before and after the model first appears (wolf: 193 → 193).
- [ ] A/B URL flag works, and a failed load falls back to the procedural version.
- [ ] Screenshots read by eye, day and night:
  - `shot.mjs` with `?webgl&autostart`
  - contractors via `?fight` / `game.recovery.summon(game.player.position, game.cam.yaw, 18, 3)`
  - townsfolk via `closeups.mjs` at talk distance
- [ ] Contractors: idle, patrol (no foot slide), run, crouch, aim, reload, throw, flinch, and death (ragdoll from the current pose). Hit tests line up with the body; muzzle flashes come out of the gun.
- [ ] No layered-bone accumulation: hold a pose for 10+ s and stand dead bodies still (the mixer trap, §3.6).
- [ ] `BB_FLAGS=fight scripts/dev/bench-desktop.sh` before and after; report fps. Target 60+ on High on the 4050 (CLAUDE.md backlog #2).
- [ ] `NOTES.md`: a short dated section (what works, numbers, what's stubbed, next).
- [ ] `CHANGELOG.md`: player-facing bullets go in the next `## vX.Y.Z` section. Releases only happen when the owner says "ship"; `scripts/release.sh` refuses to run without that section.
- [ ] **Ask the owner before adding dependencies**: `@gltf-transform/*` (even as a devDependency), KTX2/Basis tooling, meshoptimizer.
- [ ] Commits end with the session's attribution line. Never commit the Meshy key (`~/.config/meshy/key`).
- [ ] Credits: Meshy balance after these jobs was **178** (2026-10-08). Quote the cost to the owner before any regeneration.
