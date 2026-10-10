# NPC_ANIMATION_FIXES.md: making the Meshy people move like people

For Claude Code. Written 2026-10-09 by BunkerBustersBot against `main` at `ed4eb13` (v0.5.6). The owner's complaint: (1) people sitting or standing together play identical, synced loops and mirror each other ("GTA 4 on a log"); (2) some gestures look unnatural, and some hands face the wrong way. Every number below was measured from `public/models/*.glb` and the raw `Assets/*_Animations.glb` (FK on the clips) or read from the code. **No asset needs regenerating.** Everything in sections 2 and 3 is code or `build-glb.mjs` work at zero credit cost. Section 4 is an optional ~51-credit spend; quote it to the owner before spending.

Read `CLAUDE.md` (models + the AnimationMixer rule) and `Assets/MESHY_ASSETS.md` §3.6 first.

---

## 1. Diagnosis

### 1.1 Why they mirror each other

| # | Cause | Evidence |
|---|---|---|
| A | **Everyone on a seat plays the same two clips.** After the borrowing in `b71f981`, `idle` = Chair_Sit_Idle_M (10.667 s) and `near` = Sitting_Answering_Questions (9.667 s) for **Sol, Mara, Hollis and Dez**. Wick's `alt` and Pip's `alt` are Chair_Sit_Idle_M too, and Pip's `idle` is Ren's Sit_and_Drink. | Clip list of the built files: `dez/hollis/mara/sol: idle 10.667, near 9.667`; `pip: idle 11.167, alt 10.667`; `ren: idle 11.167, alt 10.667`; `wick: alt 10.667, idle 17.3, near 9.667`. Source match (per-bone world deltas, 0.0° = identical): Mara idle/near ← **Sol's**; Dez idle/near ← **Wick's**; Hollis near ← **Wick's** (idle is his own, 12° from Wick's); Pip idle ← Ren Sit_and_Drink, alt ← Ren Chair_Sit_Idle_M. |
| B | **Hollis and Dez are the worst pair.** They sit on the same log 1.2 m apart with the same yaw, and their `near` clip comes from the **same source (Wick)**. | `world/Landmarks.ts:457-458` (`seat('hollis', -6.8, 4.65)`, `seat('dez', -6.8, 3.45)`), yaw from `:451` (both face the fire). |
| C | **Any state change restarts the clip at t = 0, for everyone at once.** The camp's `notice` radii are 7–7.5 m round a ~3 m fire, so all four cross into `near` in the same frame and start Sitting_Answering_Questions at t = 0 together. When you walk away they all go back to `idle` at t = 0 together. From then on they're frame-locked forever: same duration, same speed, same start. | `world/npcSkin.ts:167` (`this.tCur = 0` in `play()`); `:178` (near → `play('near')`); `:180` (back to idle); `world/npc.ts:524` (near = plain distance test, same radius for the group); `Landmarks.ts:450,455` (`notice = 7` / 7.5). |
| D | The initial desync is weak and is wiped out by C. The start phase is `Math.random() * 3` s on 10–17 s clips, and there's no per-instance speed. | `npcSkin.ts:137` (`tCur = Math.random() * 3`), `:188` (`tCur + dt`, rate 1.0 for everyone). |
| E | `alt` also restarts at 0, and there's only one variation per person. | `npcSkin.ts:181-186`. |
| F | Heads snap round together: the same smoothing constant, no reaction delay, and all inside one notice radius. | `npc.ts:501` (`k = 1 - exp(-4·dt)` for all), `:509-519`. |
| G | Contractors standing still are statues. The procedural gait phase only advances with speed, so a standing squad holds one identical relaxed pose (no breathing or weight shift on the body). | `combat/Humans.ts:266` (random phase) but `:366` (`phase += sp/stride…`, frozen at sp = 0). |

Not a cause: layer build-up. `npcSkin.sample()` resets every bone to bind each frame (`npcSkin.ts:121`) before the head turn (`:205-211`), and `humanSkin.setWorld()` writes absolute rotations (`humanSkin.ts:336-344`). Neither uses an `AnimationMixer`. Keep it that way (see CLAUDE.md, the r186 mixer trap).

### 1.2 Why hands face the wrong way

**Townsfolk (`npcSkin.ts`, clip-driven):**

| # | Cause | Evidence |
|---|---|---|
| H1 | **No forearm twist bone, so the library's forearm roll lands entirely on the `Hand` joint.** Meshy rigs have 24 joints and no twist or finger bones. Palm-up and drinking gestures spin the mitt 80–135° about the forearm axis at the wrist while the forearm skin stays put: a candy-wrapper wrist and a mitt that points the wrong way. It's the same on every rig, so it comes from the library mocap, not from our code. | Max hand twist relative to the forearm (vs bind), measured per clip. **Checkout_Gesture (Inez's looping `idle`!) L −134° at 3.0 s, the worst by far**; Talk_with_Right_Hand_Open (Doc `near`) R +102° at 1.3 s; Sit_and_Drink (Ren and Pip `idle`) L −93°, R −97°; Talk_with_Hands_Open (Nia `near`) L −90°, R +83°; Chair_Sit_Idle_M (every seated person) L ≈ +80° at 6.0 s; Sitting_Answering_Questions L ≈ +55°, R ≈ −55°. Unused contractor clips are as bad (Side_Shot L −147°, Rifle_Charge L −142°), so don't adopt them without H1's fix. |
| H2 | **Borrowed clips are retargeted as world deltas onto a different rest pose.** `build-glb.mjs:209` does `target = (srcWorld · srcRest⁻¹) · tgtRest`. That's right only if both A-poses match. They don't: rest arm directions differ by 8–35° and hand mitts by up to ~60° between Meshy auto-rigs, so the borrowed clip lands that much off on every frame. Hands miss the thigh or knee, palms roll, and Pip's drinking hand ends up in the wrong place. | Rest upper-arm / forearm angle, target vs source: **Pip vs Ren L 35° / 22°, R 13° / 24°**; **Dez vs Wick L 13° / 29°, R 15° / 24°**; Mara vs Sol 10–17°; Hollis vs Wick 8–10°. Forearm roll is inflated after retarget: Dez `idle` R forearm twist 64° vs 44° on Wick's own rig. Rest mitt long axis Sol L (−0.28, −0.70, 0.66) vs Ren L (0.55, −0.15, 0.82): about 60° apart. |
| H3 | **Clips that imply a prop play with an empty mitt.** Ren's and Pip's `idle` is Sit_and_Drink: the right hand comes to 0.17 m / 0.19 m from the Head joint at 4.2 s / 4.6 s, drinking from nothing. Doc's game pose is `clipboard` with no clipboard. Only head props are attached. | `npcSkin.ts:19-23` (`NPC_PROPS`: Hollis cap and Dez headset only), `:150`. |
| H4 | **Inez's loop is a one-shot gesture.** Checkout_Gesture (6.47 s, worst wrist in the set) is her `idle` and her plain Idle is `alt`, so she repeats the bad wrist every 6.5 s. | `inez.glb` clips: `alt 4.000 (Idle) | near 5.167 | listen 9.333 | idle 6.467 (Checkout_Gesture)`. |

**Contractors (`humanSkin.ts`, IK onto the procedural skeleton, no clips):**

| # | Cause | Evidence |
|---|---|---|
| H5 | **The hand never bends at the wrist; it copies the forearm's rotation.** The procedural hand frame (wrist→grip, palm hint) is ignored, so mitts are paddles in line with the forearm and roll with it. | `humanSkin.ts:315-320` (the hand = forearm world rot · bind offset; `m[P[2]]` is only used for feet); the procedural hand frame is built at `Humans.ts:487` (+Z = −side·cl). |
| H6 | **The forearm roll hint degenerates when aiming.** The twist reference is the procedural +Z column, which for arms is the chest forward `cf` (`Humans.ts:485-486`). An aiming left forearm points almost along `cf`, so the orthogonalised hint is tiny and flips with small aim changes. When it's below 1e-6 it falls back to **world** +Z (`humanSkin.ts:55`), which depends on which way the contractor faces. The bind side assumes world +Z too (`humanSkin.ts:327`). Result: support-hand mitts that roll or flip as the aim moves. | `humanSkin.ts:303, 306-307, 52-58, 327`. |

---

## 2. Desync fixes (townsfolk; all in `npcSkin.ts` / `npc.ts`, zero credits)

1. **Random phase and speed per instance.** In the `NpcActor` constructor: `this.rate = 0.9 + Math.random() * 0.2;` and `this.tCur = Math.random() * this.cur.dur;` (the whole clip, not 0–3 s). Advance with `dt * this.rate` (`npcSkin.ts:188, 192`).
2. **Keep a clock per clip; never restart at 0.** Replace `tCur`/`tPrev` with `clock: Map<clipName, number>`, seeded randomly for every clip. `play()` crossfades to the target's own running clock (looping clips) and never writes 0 (`npcSkin.ts:167`). One-shots (`alt`, transitions) can start at 0, but with a random 0.2–1.2 s **delay** before the switch (store `pending = {name, at}`).
3. **A pool of idle variants on random timers.** Turn `idle`/`alt` into `idles: string[]` (every role whose name starts with `idle`; build them as `idle`, `idle2`, `idle_m`, …). Every 12–30 s (random per actor), pick a different idle, weighted away from the current one, with a 0.8–1.2 s smoothstep crossfade (today it's a fixed 0.6 s, `:189`). Use one-shots (Shrug, Scheming_Hand_Rub, Confused_Scratch, Checkout_Gesture) as **inserts**: play once, then fade back to the idle's running clock.
4. **Left-right mirrored clips (free variety).** Bake mirrored copies offline in `build-glb.mjs` (new `--mirror Src=dst_m`) so runtime cost stays zero. Meshy bone frames are **not** mirror-symmetric (Mara's Head rest is 133° from Sol's), so mirror **world deltas**, not local tracks:
   - Name swap map: `Left↔Right` for `Shoulder, Arm, ForeArm, Hand, UpLeg, Leg, Foot, ToeBase`. `Hips, Spine02, Spine01, Spine, neck, Head, head_end, headfront` map to themselves.
   - Work in model space (scene root, the model faces **+Z**, the person's left is **+X**; apply the `Armature` node's rotation when you do FK). Mirroring across the YZ plane (x → −x): position `(x, y, z) → (−x, y, z)`; rotation quaternion `(qx, qy, qz, qw) → (qx, −qy, −qz, qw)`.
   - Per frame, per bone B: `Δ_src(t) = W_src(t) · Wrest_src⁻¹` for `src = swap(B)`; `W_B(t) = mirrorQ(Δ_src(t)) · Wrest_B`; then local = `W_parent⁻¹ · W_B`. Hips translation: mirror x of the clip's Hips position, then re-anchor (npcSkin re-measures `clip.hips` at load, `:106-110`).
   - Give each neighbour pair opposite versions: **Dez gets `idle_m` and `near_m`**, Hollis the originals; Pip gets the mirror of whatever Mara plays. Mirroring Sit_and_Drink also moves the empty drinking hand to the left, so do it only once the mug prop exists.
5. **Additive life layers** (after `sample()`, before the head turn; use `turn()` about world or body axes so bone axes don't matter, as `npcSkin.ts:221-228` does):
   - Breathing: `Spine02` and `Spine01` pitch `±1.2–2°`, period 3.5–5 s, random phase; `neck` counter-pitch at −50% so the head stays level.
   - Weight shift (standing only: Nia, Doc, Inez): Hips roll ±1.5° and Spine counter-roll at 0.06–0.12 Hz, random phase.
   - Head look-at: keep `npc.ts`'s yaw and nod, but give each figure a **reaction delay** of 0.15–0.6 s and its own smoothing rate (`k` from `1 - exp(-(2.5..5)·dt)`, `npc.ts:501`). Add a small saccade jitter (±3°, every 1–3 s) while it's looking at you. Bigger turns should use more neck: today it's a fixed 40/60 split (`npcSkin.ts:209-210`).
6. **Neighbours never pick the same clip at the same time.** Give `NpcCrowd` a small coordinator: `lastSwitch: Map<id, {clip, t}>`. Before an actor switches, it asks the crowd; if a figure within 2.5 m switched to the **same source clip** (use a `src` tag per role, e.g. `chair_idle`, `answer`, since mirrored and borrowed clips share one) within the last 3 s, pick another variant or wait 0.4–1.5 s. Also stagger `near`: don't let a whole group flip on one distance line. Give each figure `notice + rand(−1, +1)` m and a hysteresis of 0.75 m (enter at r, leave at r + 0.75), so they turn to you one by one (`npc.ts:524`, `Landmarks.ts:450`).
7. **Contractors at rest:** add per-person breathing and weight shift to the procedural pose when `sp < 0.2`. Advance a separate `idlePhase` with dt (not speed) and use it in `Humans.ts` near `:366-393` (a small pelvis sway and chest pitch), so a squad standing around isn't one frozen pose.

---

## 3. Hand and wrist fixes

1. **Spread the wrist twist into the forearm (fixes H1, the biggest visual win).** Bake it in `build-glb.mjs` (a `--twist-split 0.5` pass, zero runtime cost), or do it at runtime after `sample()`. Per frame and side:
   - `rel = (ForeArmW⁻¹ · HandW)`, `dev = relBind⁻¹ · rel` (in the hand's bind frame).
   - Swing-twist about the forearm axis `a` (bind ForeArm→Hand direction expressed in the hand's bind frame): `twist = normalize((a·dev.xyz)a, dev.w)`, `swing = dev · twist⁻¹`.
   - Rotate the ForeArm by `+k·θ` about its own axis (k = 0.5–0.6) and give the Hand `relBind · swing · twist(θ·(1−k))`.
   - Clamp the hand's remaining twist to ±50° and swing to ±70°.
   - Check it on Inez's Checkout_Gesture (3.0 s), Doc's `near` (1.3 s), Ren's `idle` (2.0 s and 7.7 s) and Nia's `near` (1.0–1.2 s).
2. **Retarget with rest alignment (fixes H2).** In `build-glb.mjs:209`, change the target world from `Δ · tgtRest` to `Δ · S_B · tgtRest`, where `S_B` (world) rotates the target's rest frame onto the source's at bind:
   - Arms and legs: the shortest arc that maps the target rest bone direction (joint → child joint) onto the source's.
   - Hands: the full frame from the mitt's PCA (long axis = largest variance of the vertices with > 0.6 weight on that Hand; palm normal = smallest). Snap the palm normal's sign to the source's.
   - Spine, neck, head: identity is fine.
   - Rebuild mara, pip, dez and hollis and compare them side by side with their source characters at the same clip time (the hands should land on the same body landmarks: thigh, knee, chin).
   - Even better, stop borrowing: the §4 clips give every camp person their own seated set on their own rig, so no retarget is needed.
3. **Corrective quaternions per character and clip (polish, after 1–2).** `HAND_FIX: Record<id, Record<clipRole, {L?: [ax, ay, az, deg], R?: [...]}>>`, applied as `hand.quaternion.multiply(fix)` (local, post-multiply = about the hand's own axes) right after `sample()` and before the head turn. Tune it with the prop lab. Start empty; add entries only where a screenshot shows a miss.
4. **Reset before layering.** Keep `sample(..., reset = true)` from bind every frame (`npcSkin.ts:121, 193, 197`). Any new layer (breathing, fix quats, prop IK) goes **after** it and is recomputed from scratch each frame. Never `+=` onto `bone.quaternion` across frames, and no `AnimationMixer` (CLAUDE.md; MESHY_ASSETS §3.6). If a mixer ever comes back, cache the post-mixer quaternion and restore it before layering.
5. **Props in hands (fixes H3).** Add a hand-prop path beside `NPC_PROPS` (`npcSkin.ts:19-23, 150`): `{ bone: 'RightHand', file | procedural, pos, rot, scale }`.
   - Bone space is **cm** (Armature 0.01), so wrap game-scale props in a ×100 group, as the head props do.
   - Orient props in the **mitt frame**, not raw bone axes (hand bone axes differ per rig; rest mitts differ by up to ~60°). Compute the PCA frame at load (same as 2) and build the prop's basis from it.
   - Ren and Pip: a mug on `RightHand` (Sit_and_Drink brings it to the face at 4.2 s / 4.6 s; reuse npc.ts's cylinder + torus). Doc: a clipboard on `LeftHand` while his clip keeps that hand low.
   - Hide the mug in clips that don't drink if it looks odd (a per-role visibility table).
6. **Inez (fixes H4, free).** Swap roles in her build: `Idle=idle`, `Checkout_Gesture=alt` (an occasional insert, after 1's wrist fix).
7. **Contractors (H5, H6) in `humanSkin.ts`:**
   - Hand: aim the Hand like the arm bones. Direction = wrist → procedural hand point (`-Y` of `m[P[2]]`); hint = the procedural hand +Z (`Humans.ts:487`). Replace `:315-320` with `this.aim(be, sd + 'Hand', dir, handHint)`, after adding `seg(Hand)` bind data (bind hand direction = forearm→hand continued, as there's no child bone). Calibrate one constant correction per side so the palm closes on the grip; check it in the prop lab `what=human&meshy&pose=aim`.
   - Twist hint: don't use `cf` for the forearm when the arm points along it. Use a body-relative hint that's never parallel: for arms, `hint = normalize(cross(boneDir, chestUp))` (signed by side), blended with `cf` by `|dot(boneDir, cf)|`. Make the bind-side reference the same construction on the bind pose (not world +Z at `:327`), and change the fallback at `:55` to the body's `cl`, not world Z.

---

## 4. Optional credit spend (about 3 credits a clip; 178 left; nothing spent yet)

Action ids and names from `GET /openapi/v1/animations/library` (678 clips, fetched 2026-10-09). Preview each before buying: `https://cdn.meshy.ai/webapp-assets/feature-demo/animation/preview/biped/<Name>.gif`. Run them on each character's **own rig** (the rig task ids are in BunkerBustersBot's ledger on its box, so ask it to run these), so no retargeting is needed (H2 goes away for these).

| Who | Clips (action_id: name) | Why | Credits |
|---|---|---|---|
| Mara | 32: Chair Sit Idle Female; 307: Sitting Answering Questions; 364: Sit on Chair Arms Crossed | Her own seated set; no longer Sol's | 9 |
| Dez | 33: Chair Sit Idle Male; 307: Sitting Answering Questions | His own set; breaks the Hollis/Dez twin | 6 |
| Pip | 32: Chair Sit Idle Female; 356: Sit Hands on Head Lean Back | A kid's fidget; no longer Ren's drink | 6 |
| Hollis | 307: Sitting Answering Questions; 364: Sit on Chair Arms Crossed | His own `near`; a second idle | 6 |
| Sol | 364: Sit on Chair Arms Crossed | A second seated idle by the fire | 3 |
| Ren | 356: Sit Hands on Head Lean Back | A second seated idle (with the mug, Sit_and_Drink stays) | 3 |
| Nia | 245: Idle 5; 249: Idle 9 | Standing idle pool (counter) | 6 |
| Doc | 243: Idle 3; 336: Long Breathe and Look Around | Standing idle pool | 6 |
| Inez | 244: Idle 4; 251: Idle 11 | Replaces the Checkout loop as her base idle | 6 |
| **Total** | 17 clips | | **51** (127 left) |

Cheaper cut: Mara, Dez and Pip only (21 credits). That fixes the camp, which is what the owner sees first (title, character select, camp). Wick needs nothing (three seated clips of his own). Contractors need nothing (no clips are used).

---

## 5. Test checklist

- [ ] `npm run typecheck && npm run build` pass. Pipelines unchanged when the camp and Dry Creek first appear (206 → 206).
- [ ] **Camp desync:** stand 15 m away, walk in past 7 m, out, and in again. No two people start the same clip in the same second. Hollis and Dez never show the same pose at once (record 60 s with `scripts/dev/shot.mjs` at 2 fps and diff the pairs by eye).
- [ ] **Persistence:** after 5 minutes idle at the camp, the four are still out of phase (speeds 0.9–1.1, per-clip clocks).
- [ ] Head turns arrive one by one (staggered 0.15–0.6 s), not as one snap.
- [ ] **Wrists:** in `closeups.mjs` at talk distance, check Inez at Checkout 3.0 s, Doc `near` 1.3 s, Ren `idle` 2.0 s / 7.7 s, Nia `near` 1.0 s, each seated person at Chair_Sit_Idle 6.0 s. No candy-wrapped wrists, and mitts follow the forearm line.
- [ ] **Borrowed clips** (if still used): Pip/Ren, Dez/Wick and Mara/Sol side by side at the same clip time: the hands touch the same landmarks.
- [ ] Mirrored clips: the person stays on the seat (hips re-anchored), the feet don't cross through the log, and the head prop (cap or headset) follows.
- [ ] Props: the mug is in Ren's and Pip's right hand at the drink frame, oriented upright and not through the face; Doc's clipboard sits on his left hand.
- [ ] **Contractors:** prop lab `what=human&meshy&pose=aim`, `&pose=reload`, `&pose=radio`, a revolver, and sweeping the aim yaw ±90° and pitch ±40°: the support-hand mitt never flips, and the wrist bends toward the forend.
- [ ] **No build-up:** hold any pose for 30 s, then kill a contractor and watch the ragdoll for 10 s. Nothing drifts (the mixer-trap check).
- [ ] `?procnpc` and `?prochuman` still fall back cleanly.
- [ ] `BB_FLAGS=fight scripts/dev/bench-desktop.sh` before and after: the extra layers should cost < 0.2 ms.
- [ ] Add a NOTES.md entry and CHANGELOG bullets ("townsfolk no longer move in lockstep; wrists fixed"). Release only when the owner says "ship".
