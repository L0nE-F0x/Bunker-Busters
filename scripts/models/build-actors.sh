#!/usr/bin/env bash
# Build non-NPC character, gear, and creature GLBs (contractor, gear props, snakes, scorpions) with full PBR maps.
set -euo pipefail
cd "$(dirname "$0")/../.."
A=Assets/Meshy_AI_

# Contractor: 1024 colour+normal, 512 metallic-roughness, grip-curled hands, same-rig gait/idle clips
node scripts/models/build-glb.mjs public/models/contractor.glb ${A}Kade_Contractor_Rigged.glb \
  --clips ${A}Kade_Contractor_Animations.glb:Idle,Alert,Cautious_Crouch_Walk_Forward_inplace=crouchwalk \
  --clips ${A}Kade_Contractor_Walking_Basic.glb:walking_man=walk \
  --clips ${A}Kade_Contractor_Running_Basic.glb:running=run \
  --size 1024 --maps all --nsize 1024 --mrsize 512 --smooth 89 --curl-hands grip

# Rigid head/accessory props with full PBR maps
for pair in \
  "hardhat:${A}Kade_HardHat.glb" \
  "respirator:${A}Kade_Respirator.glb" \
  "headset:${A}Camp_Dez_Headset.glb" \
  "truckercap:${A}Camp_Hollis_TruckerCap.glb"; do
  id=${pair%%:*}
  src=${pair#*:}
  node scripts/models/build-glb.mjs "public/models/$id.glb" "$src" --size 512 --maps all --nsize 512 --mrsize 512 --smooth 89
done

# Desert fauna creatures with full PBR maps
for pair in \
  "rattlesnake:${A}Rattlesnake.glb" \
  "scorpion:${A}Scorpion.glb"; do
  id=${pair%%:*}
  src=${pair#*:}
  node scripts/models/build-glb.mjs "public/models/$id.glb" "$src" --size 512 --maps all --nsize 512 --mrsize 512 --smooth 89
done
