# BUNKER BUSTERS — Spec v0.1

## 1. Pitch
Post-apocalyptic open-world heist game. You are a scavenger in a desolate wasteland. The tech elite built luxury doomsday bunkers and sealed themselves in. Explore, scout, and break into each bunker, each one a unique puzzle-and-security gauntlet, to take the resources you need to survive. Every success unlocks skills and gear for harder targets, until you become the **Bunker Master**.

Tone: darkly satirical, stylish, a little absurd. Think Fallout meets Hitman meets Mr. Robot.

## 2. Creative note: the billionaires
The bunker owners are **fictional satirical characters**, archetypes inspired by the AI-scaling era rather than real named individuals. This keeps the game safe to publish and lets the writing be freer and funnier. Starter roster (rename or reskin freely):

| Bunker | Owner archetype | Theme / defense style |
|---|---|---|
| Tier 1: "The Garage" | Failed-startup prepper | Low-tech: padlocks, trip wires, a guard drone with 12% battery |
| Tier 2: "Apex Vault" | Rocket-and-EV mogul who tweets constantly | Chaotic, overbuilt, half-broken automation, memes on the walls |
| Tier 3: "The Panopticon" | Social-network founder, surveillance-obsessed | Cameras, line of sight, facial recognition; stealth puzzles |
| Tier 4: "Alignment Spire" | Safety-obsessed AI lab CEO | Ethics-quiz door locks, tripwire "guardrails," polite but lethal turrets |
| Tier 5: "Singularity Dome" | Accelerationist hyperscaler founder | Rogue AI runs the bunker; adaptive defenses that learn your habits |
| Tier 6: "Cloud Cathedral" | Retail/cloud-infrastructure emperor | Logistics maze, conveyor/warehouse puzzles, drone swarms |
| Tier 7: "The Chip Fortress" | GPU baron | Heat/power puzzles, cooling systems, shortage-themed loot rationing |
| Final: "Bunker Zero" | The Bunker Master's legacy / secret owner | Combines mechanics from all prior bunkers |

## 3. Core loop
1. **Explore** the wasteland (scavenge, avoid hazards, find clues, meet NPCs).
2. **Recon** a bunker (find entrances, observe patrols, gather intel, steal blueprints).
3. **Plan** a loadout (tools, consumables, skills).
4. **Breach** (puzzle + stealth/action gauntlet unique to that bunker).
5. **Loot and escape** (resources, new tech, skill points, story).
6. **Upgrade** and repeat on a harder bunker.

## 4. Systems
- **Open world map**: large wasteland with biomes (dust flats, ruined city, salt lake, irradiated forest, coast). Fog-of-war map, fast-travel to discovered camps, bunker markers revealed via rumors and intel.
- **Character select**: 3–4 starting archetypes (Hacker, Infiltrator, Engineer, Brute), each with different starting stats, a signature skill, and a different approach to bunkers.
- **Skills tree**: Hacking, Lockpicking, Stealth, Electronics, Demolition, Social Engineering, Survival.
- **Inventory**: grid or slot-based; weight limit; crafting from scrap; consumables (EMP, lockpicks, decoys, medkits, water, rations).
- **Survival layer (light)**: hunger, thirst, radiation, gear durability. Keep it forgiving; it is pressure, not chore.
- **Bunker security model**: each bunker is data-driven (see §6) with layered defenses: perimeter, entry, interior, vault. Multiple valid solutions per layer (stealth, hack, brute force, social).
- **Progression gating**: bunker difficulty tied to required tools and skills, not just stats.
- **Save/load**: localStorage / IndexedDB.

## 5. Tech stack
- **Three.js with WebGPURenderer** (`three/webgpu`, TSL for shaders) with automatic WebGL2 fallback.
- **TypeScript + Vite**. Single-page app, deployable to static hosting (Netlify).
- **Physics**: Rapier (WASM) for character controller and collisions.
- **ECS**: bitECS or a light hand-rolled entity/component system.
- **UI**: HTML/CSS overlay (inventory, map, dialogue) over the canvas; keeps UI fast to iterate.
- **Audio**: Web Audio API; procedural ambience plus a few synthesized stingers to start.
- **Assets**: start fully **procedural** (no Blender/Unreal needed). Terrain from noise, bunkers from composed primitives plus custom shaders, stylized low-poly with strong lighting, fog, dust particles, bloom, and a good post-processing stack for the "AAA look." Optionally add glTF assets later.
- **Visual direction**: stylized-realistic. Hazy orange/teal skies, volumetric-ish fog, strong rim lighting, emissive neon accents on the bunkers against a drab world.

## 6. Data-driven bunker format
Each bunker is a JSON/TS definition so new ones are cheap to add:

```ts
interface Bunker {
  id: string;
  name: string;
  owner: { name: string; archetype: string; bio: string; taunts: string[] };
  tier: number;
  location: { biome: string; position: [number, number, number] };
  requirements: { skills?: Record<string, number>; items?: string[] };
  layers: SecurityLayer[];      // perimeter -> entry -> interior -> vault
  loot: LootTable;
  intel: IntelItem[];           // clues discoverable in the world
}
interface SecurityLayer {
  type: 'perimeter' | 'entry' | 'interior' | 'vault';
  obstacles: Obstacle[];        // cameras, turrets, locks, puzzles, patrols
  solutions: Solution[];        // stealth / hack / force / social routes
}
```

## 7. MVP (build this first)
Goal: a playable vertical slice in a few sessions.
1. Vite + TS + Three.js WebGPU boilerplate, with fallback.
2. Third-person character controller on procedurally generated terrain, day/dusk lighting, fog, dust.
3. Small wasteland map with 2 landmarks and a minimap.
4. **One bunker (Tier 1: "The Garage")** with a perimeter, a lock-picking minigame, one patrol drone, and a loot room.
5. Basic inventory UI, 3 items, 2 skills, XP and level-up.
6. Character select screen (2 archetypes).
7. Save/load.

## 8. Roadmap
- **v0.2**: Tier 2–3 bunkers, hacking minigame, stealth detection model, crafting.
- **v0.3**: Full open-world map with biomes, fast travel, survival layer, NPC traders and rumors.
- **v0.4**: Tiers 4–7, adaptive AI bunker (Tier 5), better audio and music, polish pass.
- **v0.5**: Final bunker, endgame "Bunker Master" hub (your own bunker you can upgrade), New Game+.
- **Stretch**: glTF asset pipeline, procedural bunker generation, gamepad support, leaderboard/speedrun mode.

## 9. Instructions for the implementing agent
- Work incrementally; get the MVP running in the browser before adding systems.
- Keep all content (bunkers, items, skills, dialogue) in data files separate from engine code.
- Prioritize **game feel and visuals** early: lighting, post-processing, and camera work make the biggest difference.
- Keep the code modular (`/engine`, `/game`, `/content`, `/ui`).
- After each milestone, write a short `NOTES.md` update listing what works, what's stubbed, and next steps.
- Ask before adding heavy dependencies.

## 10. Open questions (decide as you iterate)
- Third-person vs first-person camera?
- Real-time action vs more stealth/puzzle-forward pacing?
- Mouse+keyboard only, or gamepad from the start?
- How dark/satirical should the writing be?
