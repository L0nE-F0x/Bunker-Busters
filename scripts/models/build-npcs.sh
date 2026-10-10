#!/usr/bin/env bash
# Build the townsfolk models (public/models/<id>.glb) from the raw Meshy exports in Assets/.
#   scripts/models/build-npcs.sh            all of them
#   scripts/models/build-npcs.sh pip dez    just these
#
# Roles (world/npcSkin.ts): idle* loop (each person drifts between them), near* loop while you're
# within talking range, ins* play once now and then. `--mirror` adds a mirror image (`_m`): neighbours
# get opposite versions, so the camp's pairs never show one pose. Seated people with no clip of their
# own borrow from a Dry Creek rig (retargeted, rest-aligned: build-glb.mjs). Textures 1024², colour only.
set -euo pipefail
cd "$(dirname "$0")/../.."
A=Assets/Meshy_AI_
DC=${A}DryCreek_
CP=${A}Camp_
PN=${A}Panopticon_
build() { local id=$1; shift; node scripts/models/build-glb.mjs "public/models/$id.glb" "$@" --size 1024; }

ids=("$@")
on() { [ ${#ids[@]} -eq 0 ] && return 0; for i in "${ids[@]}"; do [ "$i" = "$1" ] && return 0; done; return 1; }

# --- Dry Creek, standing (Nia at her counter, Doc with his clipboard, Inez at the till)
on nia && build nia ${DC}Nia_Rigged.glb \
  --clips ${DC}Nia_Animations.glb:Idle=idle,Talk_with_Hands_Open=near,Listening_Gesture=near2,Stand_and_Chat=ins_chat \
  --mirror ${DC}Nia_Animations.glb:Idle=idle_m
# (Hand_on_Hip_Gesture lifts the clipboard hand over his head: left out)
on doc && build doc ${DC}Doc_Rigged.glb \
  --clips ${DC}Doc_Animations.glb:Idle=idle,Talk_with_Right_Hand_Open=near,Listening_Gesture=near2,Shrug=ins_shrug \
  --mirror ${DC}Doc_Animations.glb:Idle=idle_m
# (Checkout_Gesture was her loop; its wrist is the worst in the set, so it's an occasional gesture)
on inez && build inez ${DC}Inez_Rigged.glb \
  --clips ${DC}Inez_Animations.glb:Idle=idle,Talk_with_Left_Hand_on_Hip=near,Listening_Gesture=near2,Checkout_Gesture=ins_checkout \
  --mirror ${DC}Inez_Animations.glb:Idle=idle_m

# --- Dry Creek, seated (Sol and Ren side by side at the fire, Wick in his cave)
on sol && build sol ${DC}Sol_Rigged.glb \
  --clips ${DC}Sol_Animations.glb:Chair_Sit_Idle_M=idle,Sitting_Answering_Questions=near \
  --mirror ${DC}Sol_Animations.glb:Chair_Sit_Idle_M=idle_m
on ren && build ren ${DC}Ren_Rigged.glb \
  --clips ${DC}Ren_Animations.glb:Sit_and_Drink=idle,Chair_Sit_Idle_M=idle2
on wick && build wick ${DC}Wick_Rigged.glb \
  --clips ${DC}Wick_Animations.glb:Sit_and_Doze_Off=idle,Chair_Sit_Idle_M=idle2,Sitting_Answering_Questions=near

# --- the camp's four on two logs: Mara and Pip on one, Hollis and Dez on the other
on mara && build mara ${CP}Mara_Rigged.glb \
  --clips ${DC}Sol_Animations.glb:Chair_Sit_Idle_M=idle,Sitting_Answering_Questions=near \
  --mirror ${DC}Sol_Animations.glb:Chair_Sit_Idle_M=idle_m
on pip && build pip ${CP}Pip_Rigged.glb \
  --clips ${DC}Ren_Animations.glb:Sit_and_Drink=idle \
  --mirror ${DC}Ren_Animations.glb:Chair_Sit_Idle_M=idle2_m
on hollis && build hollis ${CP}Hollis_Rigged.glb \
  --clips ${CP}Hollis_Animations.glb:Chair_Sit_Idle_M=idle \
  --clips ${DC}Wick_Animations.glb:Sit_and_Doze_Off=idle2,Sitting_Answering_Questions=near
on dez && build dez ${CP}Dez_Rigged.glb \
  --mirror ${DC}Wick_Animations.glb:Chair_Sit_Idle_M=idle_m,Sitting_Answering_Questions=near_m

# --- the Panopticon: Ezra on his feet at the monitor wall; Ada and two reviewers at their desks
# (Ezra borrows Sol's standing idle and talk loops; the reviewers borrow Sol's and Ada's seated clips)
on ezra && build ezra ${PN}Ezra_Rigged.glb \
  --clips ${DC}Sol_Animations.glb:Idle=idle,Talk_with_Hands_Open=near,Listening_Gesture=near2 \
  --clips ${PN}Ezra_Animations.glb:Scheming_Hand_Rub=idle2,Look_Around_Dumbfounded=ins_look,Stand_Talking_Angry=talk_hard \
  --mirror ${DC}Sol_Animations.glb:Idle=idle_m
on ada && build ada ${PN}Ada_Rigged.glb \
  --clips ${PN}Ada_Animations.glb:Chair_Sit_Idle_F=idle,Sit_Hands_on_Head_Lean_Back=ins_lean,Sit_to_Stand_Transition_F=stand \
  --clips ${DC}Sol_Animations.glb:Sitting_Answering_Questions=near \
  --clips ${PN}Ada_Walking_Basic.glb:walking_man=walk
on rev1 && build rev1 ${PN}Reviewer1_Rigged.glb \
  --clips ${DC}Sol_Animations.glb:Chair_Sit_Idle_M=idle,Sitting_Answering_Questions=near \
  --clips ${PN}Ada_Animations.glb:Sit_Hands_on_Head_Lean_Back=ins_lean \
  --mirror ${DC}Sol_Animations.glb:Chair_Sit_Idle_M=idle_m
on rev2 && build rev2 ${PN}Reviewer2_Rigged.glb \
  --clips ${PN}Ada_Animations.glb:Chair_Sit_Idle_F=idle \
  --clips ${DC}Sol_Animations.glb:Sitting_Answering_Questions=near \
  --mirror ${PN}Ada_Animations.glb:Chair_Sit_Idle_F=idle_m
true
