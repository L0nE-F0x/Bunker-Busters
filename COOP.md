# Co-op — parked until after 1.0

**Status: do not build.** Written 2026-10-10. The owner wants a two-player mode eventually, and only after 1.0.0 is released and the game is being marketed. Until then this file is a plan, not a task. No networking code, no second player, no `?buddy` flag.

A friend on the job is a good idea. A shared simulation of this game is not. The difference is the whole plan.

## What the game actually is

One body, one eye, one save, all inside the browser. Nothing is networked. The wasteland is an 840 m square from `WORLD_SEED` (`src/content/world.ts`), so two clients already build the same desert without talking. The live simulation cannot be shared as it stands:

- `Game.frame` steps weather, the player, Kade, SeedBot, wolves, and the renderer on one variable `dt` (`Math.min(1/20, frameGap)`). Rapier's 1/60 step is overwritten every frame with that `dt`. Two frame rates diverge immediately. Lockstep will not work.
- Combat, contractors, and machines roll `Math.random` for aim, barks, flanks, loot, and think-timers. There is no gameplay RNG to checksum.
- Enemies perceive one person. `Combat.target` is a single `PlayerTarget` (feet, chest, eye, noise, torch, crouch, light, reloading). Recovery, SeedBot, and the stealth light model all read it.
- Interior culling, grass, shrubs, fog of war, and the HUD follow one camera. Each of those can stay local. The perception struct cannot.
- The save is one archetype, one inventory, one skill build, one flag set, in `localStorage`.
- `Game.ts` owns the renderer. It cannot be lifted onto a headless server without splitting the game in two and keeping both. Desktop frame time is already the budget that matters. Two players are a few kilobytes a second; bandwidth is not the constraint.

## The shape that fits

The host's machine stays the game. The guest is a second body. Desert, shaders, wind, and music keep running on each side from the same seed. Only gameplay mutations cross the wire.

- **Host simulates.** Doors, alarms, damage, loot, contractor deaths, and quest flags happen once, on the host.
- **Guest owns their movement.** They send a control snapshot (move, look, crouch, sprint, weapon, aim, fire, interact) at about 20 Hz, predict their own kinematic body, and correct if the host disagrees by more than about half a metre. Do not predict the world.
- **Hitscan is resolved on the host.** The guest draws their own tracer immediately; the host confirms the hit. Rewind lag compensation waits until friend-to-friend latency actually feels wrong.
- **Presentation does not sync.** Decals, dust, brass, and music may differ. Contractor positions, the drone, and opened doors must match. The contractor pool is twelve slots plus SeedBot.

### Backend

WebRTC data channel, host-authoritative. A tiny signaling rendezvous (a Cloudflare Worker or a PartyKit room) exchanges the invite and then goes away. A TURN relay covers the NAT cases hole-punching misses. No game server, no Netlify Function in the sim, no physics off-machine. Poses can be unreliable and unordered. Shots, hits, doors, items, and flags want a reliable ordered channel. Voice stays in Discord.

The first spike, before any design commitment, is `RTCPeerConnection` inside the Linux app's WebKitGTK webview. If the desktop build cannot open a data channel to a browser, the plan changes before combat does.

### Rules that keep solo intact

- **The host's save is the story.** The guest visits with their own archetype and a kit. Bunker completion, quest flags, and the journal belong to the host. When the guest leaves, the run is unchanged. A shared save would damage the game.
- **Mara still talks to one person.** The guest gets barks and subtitles, not the briefing or the debrief. Co-op is a specialist brought on the job, not a second protagonist.
- **Stealth sees both bodies.** The job gets louder. That is the point: one person works the lock while the other holds SeedBot. Friendly fire stays off.
- **A minigame does not freeze the other player.** Inventory already leaves the world running. A lockpick stays local to the person doing it.
- **One bunker before the wasteland.** The Garage is the prototype: one interior, one drone, a few locks, a clear start and end. Each client keeps culling from its own eye. Fast travel, fog, outposts, wolves, and survival learn about two bodies only after two people have finished the Garage and the owner still wants it.

## Order of work, when 1.0 is out

1. **A local second body, no network.** Another kinematic capsule in the Garage, driven by a recorded input or a second pad. `Combat.target` becomes "which body is this enemy looking at." One shared flag set for the session. Done when the partner can be seen, shot at, shoot a contractor, and open a door the host walks through, while a minigame leaves the other person free. Feature-flag it. This is the whole risk.
2. **WebRTC on that message list.** Invite code, host correction, guest prediction. Spike the desktop webview on day one.
3. **Session rules.** Visitor kit, host-owned flags. Guest death respawns at the breach or spectates. Host death fails the run the way it does now.
4. **The wasteland, only if the Garage was fun.** That is a version of its own, not a patch on 1.0.

Phase 1 is a week or two and it touches the solo combat path. Phase 2 is about another week if the messages are already explicit. Sunshine or Moonlight already lets someone watch a run; that is not co-op, and it needs no game changes.

## Explicitly out

- Deterministic lockstep.
- A dedicated server running `Game.ts`.
- Syncing Rapier, grass, audio, or the whole `Game` object.
- Folding any of this into a pre-1.0 patch.
- Starting it while visual quality and game feel are still the work.
