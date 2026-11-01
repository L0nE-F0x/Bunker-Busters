#!/usr/bin/env bash
# Build the townsfolk models (public/models/<id>.glb) from the raw Meshy exports in Assets/.
#   scripts/models/build-npcs.sh            all of them
#   scripts/models/build-npcs.sh pip dez    just these
#
# Standing people idle on Listening_Gesture, not the library's Idle: that one is a hunched look-round
# whose hips swing through 93° of yaw (they'd turn their back on you mid-loop). 2026-10-12.
# Seated people sit up cross-legged, not in Chair_Sit_Idle_M: that one is a chin-on-hand "thinker"
# hunch, and seven people sharing it made the fires look like everyone was staring into their shirts.
# 2026-10-28.
#
# Roles (world/npcSkin.ts): idle* loop (each person drifts between them), near* loop while you're
# within talking range, ins* play once now and then. `*_up`: only the arms and head play, over the
# seated loop underneath (the people round the fires talk with their own standing talk loop, since
# the library's one seated talk, Sitting_Answering_Questions, throws the arms wide and leans back). `--mirror` adds a mirror image (`_m`): neighbours
# get opposite versions, so the camp's pairs never show one pose. Seated people with no clip of their
# own borrow from a Dry Creek rig (retargeted, rest-aligned: build-glb.mjs). Textures 1024², colour + normal.
set -euo pipefail
cd "$(dirname "$0")/../.."
A=Assets/Meshy_AI_
DC=${A}DryCreek_
CP=${A}Camp_
PN=${A}Panopticon_
SP=${A}Spire_
DM=${A}Dome_
CT=${A}Cathedral_
FT=${A}Fortress_
# library clips bought for the townsfolk (2026-10-28, on Gil's rig): Sit_Cross_Legged, Idle_3,
# Short_Breathe_and_Look_Around, Sit_Hands_on_Head_Lean_Back (Sit_on_Chair_Arms_Crossed and Idle_9 are
# in the file but unused: the crossed arms came out as an X held off the chest; Idle_9 loops every 2 s)
TI=${A}Town_Idles_Animations.glb
# Normals smoothed across Meshy's splits (it shades every patch of triangles on its own, like a cut gem)
# and the normal map kept (the folds, seams and the shape of the face): owner, 2026-11-01, "all the
# models look terrible … weird and blocky".
build() { local id=$1; shift; node scripts/models/build-glb.mjs "public/models/$id.glb" "$@" --size 1024 --maps normal --nsize 1024 --smooth 89; }

# Everyone's idling, talking and gestures are Mixamo motion capture (owner, 2026-11-01: "all the models
# look terrible … the way they move isn't organic and natural"; then "yes for all the people in the game").
# MX: seated, recorded on chairs; MS: standing, desk work and talk. Built by scripts/models/fbx-to-glb.mjs
# from Assets/mixamo/*.fbx (git-ignored: Adobe's licence allows them in the game, not as raw files) and
# retargeted onto each Meshy rig here. Scripted clips (walks, falls, pick/carry, Noor's sleep and wake,
# the stand-ups, Hunter's slump) and a few character gestures stay the Meshy ones.
MX=Assets/mixamo/sit.glb
MS=Assets/mixamo/stand.glb
ids=("$@")
on() { [ ${#ids[@]} -eq 0 ] && return 0; for i in "${ids[@]}"; do [ "$i" = "$1" ] && return 0; done; return 1; }

# --- Dry Creek, standing (Nia at her counter, Doc with his clipboard, Inez at the till)
on nia && build nia ${DC}Nia_Rigged.glb \
  --clips ${MS}:st_breathe=idle,st_shift=idle2,st_look=idle3,tk_general=near,tk_two=near2,g_nod=ins_nod,g_shrug=ins_shrug \
  --mirror ${MS}:st_breathe=idle_m
# (Hand_on_Hip_Gesture lifts the clipboard hand over his head: left out)
on doc && build doc ${DC}Doc_Rigged.glb \
  --clips ${MS}:st_idle_a=idle,st_neutral=idle2,g_think=idle3,tk_one=near,g_nod_thought=ins_nod \
  --mirror ${MS}:st_idle_a=idle_m
# (Checkout_Gesture was her loop; its wrist is the worst in the set, so it's an occasional gesture)
on inez && build inez ${DC}Inez_Rigged.glb \
  --clips ${MS}:st_neutral=idle,st_shift=idle2,st_look=idle3,tk_two=near,g_nod=ins_nod \
  --clips ${DC}Inez_Animations.glb:Checkout_Gesture=ins_checkout \
  --mirror ${MS}:st_neutral=idle_m

# --- Dry Creek, seated (Sol and Ren side by side at the fire, Wick in his cave)
on sol && build sol ${DC}Sol_Rigged.glb \
  --clips ${MX}:sit_breathe=idle,look_around=idle2,sit_still=idle3,talk_a=near,laugh=ins_laugh,rub_arm=ins_rub \
  --mirror ${MX}:sit_breathe=idle_m
on ren && build ren ${DC}Ren_Rigged.glb \
  --clips ${MX}:sit_thighs=idle,look_around=idle3 \
  --clips ${DC}Ren_Animations.glb:Sit_and_Drink=idle2
on wick && build wick ${DC}Wick_Rigged.glb \
  --clips ${DC}Wick_Animations.glb:Sit_and_Doze_Off=idle \
  --clips ${MX}:sit_still=idle2,talk_b=near

# --- the camp's four on two logs: Mara and Pip on one, Hollis and Dez on the other
# (no Sit_Hands_on_Head_Lean_Back for anyone on a log: it lies back 37° against a chair back that isn't
# there; the owner, 2026-11-01: "still looks terrible". Ada keeps hers, in Doc's chair)
# (Pip doesn't drink: Sit_and_Drink, made on a grown-up, takes her mug to her forehead. She holds it)
# The camp four sit on Mixamo's motion capture, recorded on chairs (owner, 2026-11-01: "they do all
# these really unnatural, weird movements"; Sit_Cross_Legged is a floor sit leaning back on the hands,
# and on a log its hands swung forward to the ground with the elbows locked backwards). MX is built by
# scripts/models/fbx-to-glb.mjs from Assets/mixamo/*.fbx (git-ignored: Adobe's licence allows them in
# the game, not as raw files); retargeted onto each Meshy rig by build-glb.mjs.
on mara && build mara ${CP}Mara_Rigged.glb \
  --clips ${MX}:sit_breathe=idle,sit_thighs=idle2,talk_a=near,laugh=ins_laugh,rub_arm=ins_rub \
  --mirror ${MX}:sit_breathe=idle_m
on pip && build pip ${CP}Pip_Rigged.glb \
  --clips ${MX}:sit_thighs=idle,girl_swing=idle2,fidget_feet=idle3,talk_b=near,laugh=ins_laugh \
  --mirror ${MX}:sit_thighs=idle_m
on hollis && build hollis ${CP}Hollis_Rigged.glb \
  --clips ${MX}:sit_still=idle,sit_thighs=idle2,look_around=idle3,talk_b=near,disapproval=ins_finger \
  --mirror ${MX}:sit_still=idle_m
# (Dez rests his palms down, unlike the others: --palm; a mitt can't give a thumbs-up, so no Sitting Thumbs Up)
on dez && build dez ${CP}Dez_Rigged.glb --palm 0,-1,0 \
  --clips ${MX}:waiting=idle,look_around=idle2,sit_breathe=idle3,talk_a=near,laugh=ins_laugh,rub_arm=ins_rub \
  --mirror ${MX}:waiting=idle_m

# --- the Panopticon: Ezra on his feet at the monitor wall; Ada and two reviewers at their desks
# (Ezra borrows Sol's standing idle and talk loops; the reviewers borrow Sol's and Ada's seated clips)
on ezra && build ezra ${PN}Ezra_Rigged.glb \
  --clips ${MS}:st_idle_b=idle,g_think=idle2,tk_general=near,tk_argue=talk_hard \
  --clips ${PN}Ezra_Animations.glb:Scheming_Hand_Rub=idle3,Look_Around_Dumbfounded=ins_look \
  --mirror ${MS}:st_idle_b=idle_m
on ada && build ada ${PN}Ada_Rigged.glb \
  --clips ${MX}:sit_breathe=idle \
  --clips ${MS}:sd_write=idle2,sd_talk=near \
  --clips ${PN}Ada_Animations.glb:Sit_Hands_on_Head_Lean_Back=ins_lean,Sit_to_Stand_Transition_F=stand \
  --clips ${PN}Ada_Walking_Basic.glb:walking_man=walk
on rev1 && build rev1 ${PN}Reviewer1_Rigged.glb \
  --clips ${MS}:sd_type=idle,sd_meet_m=near \
  --clips ${MX}:sit_breathe=idle2 \
  --mirror ${MS}:sd_type=idle_m
on rev2 && build rev2 ${PN}Reviewer2_Rigged.glb \
  --clips ${MS}:sd_type=idle,sd_write=idle2,sd_meet_f=near \
  --mirror ${MS}:sd_type=idle_m

# --- the Alignment Spire: Prudence on her feet in the top room, Noor asleep at her eval desk (`sleep`;
# she wakes, sits up, and later walks out; afterwards she sits at Nia's counter in Dry Creek), Benny standing at his plant. Prudence's headache and Noor's
# sleep and waking are their own clips; the rest are borrowed (Sol, Doc, Nia, Ada)
on prudence && build prudence ${SP}Prudence_Rigged.glb \
  --clips ${MS}:st_breathe=idle,st_shift=idle2,g_think=idle3,tk_two=near,g_nod_thought=ins_chat \
  --clips ${SP}Prudence_Animations.glb:Headache_Relief=ins_head \
  --mirror ${MS}:st_breathe=idle_m
on noor && build noor ${SP}Noor_Rigged.glb \
  --clips ${SP}Noor_Animations.glb:Sleep_on_Desk=sleep,Wake_Up_and_Look_Up=wake \
  --clips ${MX}:sit_breathe=idle \
  --clips ${MS}:sd_talk=near \
  --clips ${PN}Ada_Animations.glb:Sit_to_Stand_Transition_F=stand \
  --clips ${SP}Noor_Walking_Basic.glb:walking_man=walk
on benny && build benny ${SP}Benny_Rigged.glb \
  --clips ${MS}:st_idle_a=idle,st_look=idle2,st_shift=idle3,tk_one=near,g_shrug=ins_shrug \
  --mirror ${MS}:st_idle_a=idle_m

# --- the Singularity Dome: HUNTER (beta), the founder twin, as a hologram on the all-hands stage (his own
# talk loops; Sol's standing idle between lines); Hunter Vale himself slumped over the guard hut's desk
# (the same model: Noor's Sleep_on_Desk, pinned, no breath); Gil at the on-call desk (his own doze and
# answering clips, Sol's chair idle); the Ascend Helpers (Sol's idle, their own walk and fall)
on hunter && build hunter ${DM}Hunter_Rigged.glb \
  --clips ${MS}:st_idle_b=idle,tk_general=near \
  --clips ${DM}Hunter_Animations.glb:Talk_Passionately=near2,Talk_with_Left_Hand_Raised=ins_raise \
  --clips ${SP}Noor_Animations.glb:Sleep_on_Desk=slump \
  --mirror ${MS}:st_idle_b=idle_m
on gil && build gil ${DM}Gil_Rigged.glb \
  --clips ${MS}:sd_type=idle,sd_talk=near \
  --clips ${DM}Gil_Animations.glb:Sit_and_Doze_Off=idle2 \
  --clips ${PN}Ada_Animations.glb:Sit_to_Stand_Transition_F=stand
on helper && build helper ${DM}Helper_Rigged.glb \
  --clips ${MS}:st_idle_a=idle \
  --clips ${DM}Helper_Walking_Basic.glb:walking_man=walk \
  --clips ${DM}Helper_Animations.glb:falling_down=fall

# --- the Cloud Cathedral: Orrin on his feet at the office desk (on the phone to nobody; afterwards he
# may be down on the floor picking), and the associates (one model, four people: Lo at the lead's
# desk, two pickers at their stations, one carrying totes). Pick, carry and the breathe-and-look are
# the associate's own clips (carry walks in place: `!`); the rest are borrowed
on orrin && build orrin ${CT}Orrin_Rigged.glb \
  --clips ${MS}:st_idle_b=idle,phone_m=idle2,st_look=idle3,tk_general=near \
  --clips ${DC}Inez_Animations.glb:Checkout_Gesture=ins_checkout \
  --clips ${CT}Associate_Animations.glb:Female_Bend_Over_Pick_Up_Inspect=pick \
  --mirror ${MS}:st_idle_b=idle_m
on assoc && build assoc ${CT}Associate_Rigged.glb \
  --clips ${MS}:st_breathe=idle,tk_two=near \
  --clips ${CT}Associate_Animations.glb:Short_Breathe_and_Look_Around=idle2,Female_Bend_Over_Pick_Up_Inspect=pick,Carry_Heavy_Object_Walk=carry! \
  --clips ${CT}Associate_Walking_Basic.glb:walking_man=walk \
  --mirror ${MS}:st_breathe=idle_m

# --- the Chip Fortress: Kit in her chair at the allocation desk (seated clips only), and the cooling
# technicians (one model, a respirator on the head bone; Sol's idle, their own walk and look-round,
# the Helper's fall)
on kit && build kit ${FT}Kit_Rigged.glb \
  --clips ${MS}:sd_type=idle,sd_write=idle3,sd_meet_f=near \
  --clips ${DM}Gil_Animations.glb:Sit_and_Doze_Off=idle2 \
  --mirror ${MS}:sd_type=idle_m
on tech && build tech ${FT}Tech_Rigged.glb \
  --clips ${MS}:st_idle_a=idle \
  --clips ${CT}Associate_Animations.glb:Short_Breathe_and_Look_Around=idle2 \
  --clips ${FT}Tech_Walking_Basic.glb:walking_man=walk \
  --clips ${FT}Tech_Animations.glb:Walk_Slowly_and_Look_Around=look \
  --clips ${DM}Helper_Animations.glb:falling_down=fall

# --- Bunker Zero: Agnes on her feet at the drafting table (all borrowed: Sol's standing idle and
# talk, Inez's counter gesture for working at the table)
ZR=${A}Zero_
on agnes && build agnes ${ZR}Agnes_Rigged.glb \
  --clips ${MS}:st_neutral=idle,g_think=idle2,st_shift=idle3,tk_two=near \
  --clips ${DC}Inez_Animations.glb:Checkout_Gesture=ins_checkout \
  --mirror ${MS}:st_neutral=idle_m
true
