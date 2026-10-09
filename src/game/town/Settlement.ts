import * as THREE from 'three/webgpu';
import { Interior } from '../world/interiors';
import type { Heightfield } from '@/game/world/Heightfield';
import type { Physics } from '@/engine/physics';
import type { Landmarks } from '@/game/world/Landmarks';
import type { GameContext, Interactable, Action } from '@/game/context';
import { LANDMARKS } from '@/content/world';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import { STAKES } from '@/content/quests';
import { DistanceLod, Frame, shadowProxy } from '@/game/world/kit';
import { Fire } from '@/game/world/effects';
import { NpcCrowd, type NpcDef } from '@/game/world/npc';
import { Site, HALO } from './townKit';
import { buildDryCreek, type Hooks, type CreekLive } from './creek';
import { buildCut } from './cave';
import { buildWash } from './wash';
import { uTownNight } from './townAtlas';
import { TownBarks } from './barks';
import { STATIONS, AWAY } from '@/content/routines';

type Col = ReturnType<Physics['addBox']>;

interface Swing {
  id: string;
  pivot: THREE.Object3D;
  collider: Col;
  /** Signed radians, inward. */
  sign: number;
  open: number;
  target: number;
  /** Collider state last sent to Rapier (toggling it every frame dirties the broadphase). */
  solid: boolean;
}

/** Batched glow and lit windows never need to throw a sun shadow. */
function noGlowShadows(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardNodeMaterial | undefined;
    if (m && (m as unknown as { emissiveNode?: unknown }).emissiveNode && m.color?.getHex?.() === 0x050505) (o as THREE.Mesh).castShadow = false;
  });
}

/**
 * Dry Creek and the ridge cave.
 *
 * The build half lives in ./creek.ts (buildings, interiors, street), ./townKit.ts (walls with
 * openings, roofs, decks, the Site that batches everything), ./townProps.ts (furniture, vehicles,
 * poles) and ./townAtlas.ts (one canvas for every sign, poster, stain and light pool). People are
 * one animated mesh per site (src/game/world/npc.ts).
 *
 * Door gaps are 1.56–1.6 m and 2.2 m tall. The player capsule is 0.66 m wide and 1.66 m tall.
 * Stair risers are 0.25 m, under the 0.45 m autostep. The loft cache sits high enough that the
 * ground floor cannot reach the prompt.
 */
export class Settlement {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  /** Feet positions a harness can teleport to. */
  readonly spots: Record<string, THREE.Vector3> = {};
  /** Landmark yaw. Camera yaw `-look.creek` faces local −Z. */
  readonly look: Record<string, number> = {};

  private doors: Swing[] = [];
  private blockers: { id: string; obj: THREE.Object3D; collider: Col }[] = [];
  private synced = false;
  /** Detail up close, a one-draw silhouette from the highway. */
  private lods: DistanceLod[] = [];
  private readonly world = new Map<string, THREE.Vector3>();
  private crowds: NpcCrowd[] = [];
  private sites: Site[] = [];
  private creek: CreekLive | null = null;

  constructor(private ctx: GameContext, private landmarks: Landmarks) {
    this.group.name = 'settlement';
    this.buildCreek();
    this.buildCave();
    this.buildTrail();
    this.buildInteractables();
    this.landmarks.group.add(this.group);
    this.barks = new TownBarks(this.crowds);
  }

  /** Townsfolk talking in passing and reacting to gunfire (Game sets its host). */
  readonly barks: TownBarks;

  private get hf(): Heightfield { return this.ctx.hf; }
  private get physics(): Physics { return this.ctx.physics; }
  private get s() { return this.ctx.state; }

  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    this.s.events.emit('toast', { text, kind });
  }

  private social() {
    const s = this.s;
    return s.skill('social') + (s.focus('social') === 'known' ? 1 : 0);
  }

  private frameFor(id: string) {
    const lm = LANDMARKS.find((l) => l.id === id);
    if (!lm) throw new Error(`missing landmark ${id}`);
    const [x, , z] = lm.position;
    this.look[id === 'creek' ? 'creek' : 'cave'] = lm.rotation;
    return new Frame(x, this.hf.heightAt(x, z), z, lm.rotation);
  }

  private spot(id: string, f: Frame, x: number, y: number, z: number) {
    const p = f.p(x, y, z);
    this.world.set(id, p);
    this.spots[id] = p;
    return p;
  }

  private pos(id: string) {
    const p = this.world.get(id);
    if (!p) throw new Error(`missing spot ${id}`);
    return p;
  }

  /** What a site builder may touch: spots, doors and blockers keep their gameplay ids. */
  private hooks(f: Frame, npcs: NpcDef[]): Hooks {
    return {
      spot: (id, x, y, z) => { this.spot(id, f, x, y, z); },
      door: (id, pivot, collider, sign) => { this.doors.push({ id, pivot, collider, sign, open: 0, target: 0, solid: true }); },
      blocker: (id, obj, collider) => { this.blockers.push({ id, obj, collider }); },
      npc: (d) => { npcs.push(d); },
      audio: (kind, x, y, z) => { this.landmarks.audioSpots.push({ kind, pos: f.p(x, y, z) }); },
      flicker: (fl) => { this.landmarks.flickers.push(fl); },
    };
  }

  /**
   * Everything under `root` except `keep` becomes the near set; `far` is the batch's stand-in.
   * Fires, the big signs and the halo sprites stay out of it so the town still reads from the road.
   */
  private split(root: THREE.Group, f: Frame, radius: number, far: THREE.Object3D | null, keep: THREE.Object3D[]) {
    const near = new THREE.Group();
    near.name = root.name + '-near';
    for (const c of [...root.children]) if (!keep.includes(c)) near.add(c);
    root.add(near);
    if (far) root.add(far);
    this.lods.push(new DistanceLod(new THREE.Vector3(f.x, f.y, f.z), radius, near, far));
  }

  /** Turns a finished Site into meshes under its root: batch, signs, decals, pools, halos, people. */
  private finish(S: Site, root: THREE.Group, name: string, npcs: NpcDef[], withFar = true) {
    const far = withFar ? S.b.buildFar(name + '-far') : null;
    const near = S.b.build(name);
    noGlowShadows(near);
    // static batches cast through one depth-pass draw (doors, boards and people keep their own)
    shadowProxy(near);
    root.add(near);
    const signs = S.s.build(name + '-signs');
    shadowProxy(signs);
    const decals = S.d.build(name + '-decals', false, false);
    decals.traverse((o) => { o.renderOrder = 2; });
    const pools = S.p.build(name + '-pools', false, false);
    pools.traverse((o) => { o.renderOrder = 3; });
    const halos = S.halos.build();
    root.add(signs, decals, pools, halos);
    if (npcs.length) {
      const crowd = new NpcCrowd(npcs, name + '-people');
      root.add(crowd.mesh);
      this.crowds.push(crowd);
    }
    this.sites.push(S);
    return { far, signs, halos };
  }

  // ------------------------------------------------------------------ Dry Creek
  private buildCreek() {
    const f = this.frameFor('creek');
    const root = new THREE.Group();
    root.name = 'dry-creek';
    root.applyMatrix4(f.m);
    const S = new Site(f, this.physics, root);
    const npcs: NpcDef[] = [];
    this.creek = buildDryCreek(S, this.hooks(f, npcs));
    const { far, signs, halos } = this.finish(S, root, 'creek', npcs);
    if (!far) throw new Error('creek far set');
    const fire = new Fire(0.85, 28);
    fire.group.position.set(-0.4, 0.12, 2.3);
    root.add(fire.group);
    this.split(root, f, 34, far, [fire.group, signs, halos]);
    this.landmarks.fires.push(fire);
    this.group.add(root);
  }

  // ------------------------------------------------------------------ the ridge
  private buildCave() {
    const f = this.frameFor('cave');
    const root = new THREE.Group();
    root.name = 'the-cut';
    root.applyMatrix4(f.m);
    const S = new Site(f, this.physics, root);
    const npcs: NpcDef[] = [];
    const cave = buildCut(S, this.hooks(f, npcs), this.physics, f);
    const { halos } = this.finish(S, root, 'cave', npcs, false);
    const fire = new Fire(0.55, 18);
    fire.group.position.set(cave.fire[0], cave.fire[1] + 0.02, cave.fire[2]);
    root.add(fire.group);
    this.split(root, f, 14, cave.far, [fire.group, halos]);
    this.landmarks.fires.push(fire);
    this.landmarks.audioSpots.push({ kind: 'fire', pos: f.p(cave.fire[0], cave.fire[1] + 0.3, cave.fire[2]) });
    this.group.add(root);
    // the chamber, the side pocket and the neck to it, and the inner half of the mouth tunnel (the
    // same ellipsoids caveField carves); the mouth is the one way out
    const e = (p: THREE.Vector3, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) =>
      ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 + ((p.z - cz) / rz) ** 2 < 1;
    this.caveInterior = new Interior('cut', f.m,
      (p) => e(p, 0, 1.7, 5.0, 5.4, 3.9, 5.2) || e(p, 7.6, 1.3, 3.4, 2.3, 2.4, 2.4) || e(p, 5.6, 1.15, 3.35, 1.7, 1.95, 1.5) || (p.z > -2.6 && e(p, 0, 1.2, -1.2, 2.35, 2.5, 3.8)),
      [{ box: new THREE.Box3(new THREE.Vector3(-3.2, -0.6, -7), new THREE.Vector3(3.2, 4.4, -2.2)) }],
      [root]);
  }

  /** The Cut's chamber as a sealed interior (interior mode). */
  caveInterior: Interior | null = null;

  /** The posted wash up the ridge, in world space; hidden when you are nowhere near it. */
  private buildTrail() {
    const root = new THREE.Group();
    root.name = 'the-wash';
    const f = new Frame(0, 0, 0, 0);
    const S = new Site(f, this.physics, root);
    const { center, length } = buildWash(S, this.hf);
    this.finish(S, root, 'wash', [], false);
    const c = new THREE.Vector3(center.x, this.hf.heightAt(center.x, center.z), center.z);
    this.split(root, new Frame(c.x, c.y, c.z, 0), length / 2, null, []);
    this.group.add(root);
  }

  // ------------------------------------------------------------------ interactions
  private buildInteractables() {
    const talk = (id: string, label: string, run: () => void | Promise<void>): Interactable => {
      this.home.set(id, this.pos(id).clone());
      const self = this;
      return {
        id, pos: this.pos(id), radius: 2.05,
        // Ren's lookout is at Last Chance once the drive-in is told
        visible: () => !self.gone.has(id),
        primary: {
          // off their routine (asleep, on a call, shut): the prompt is whatever they left behind
          get label() { return self.away.has(id) && AWAY[id] ? AWAY[id].label : label; },
          available: () => true,
          run: () => (self.away.has(id) && AWAY[id] ? self.awayNote(id, run) : run()),
        },
      };
    };

    this.interactables.push(talk('nia', 'Talk to Nia', () => this.talkNia()));
    this.interactables.push({
      id: 'freezer', pos: this.pos('freezer'), radius: 1.8,
      primary: this.circuitAction('freezer', 'Diner freezer', 3, 'creek.freezer', () => {
        this.s.set('creek.freezer');
        const got = this.loot([{ id: 'ration', qty: 2 }, { id: 'water', qty: 1 }]);
        this.ctx.ui.banner('THE FREEZER', `The seal sighs. ${got}`, 'good');
        this.s.addXP(XP_REWARDS.cache, 'Freezer');
      }),
    });
    this.interactables.push(talk('doc', 'Talk to Doc Ivers', () => this.talkDoc()));
    this.interactables.push({
      id: 'generator', pos: this.pos('generator'), radius: 1.9,
      visible: () => !this.s?.has('creek.power'),
      primary: this.circuitAction('generator', 'Clinic generator', 2, 'creek.power', () => this.powerClinic('The clinic window wakes up. Doc can work.')),
    });
    this.interactables.push({
      id: 'inez', pos: this.pos('inez'), radius: 2.1,
      primary: talk('inez', 'Talk to Inez', () => this.talkInez()).primary,
      secondary: {
        label: 'Palm the till',
        available: () => {
          if (this.s.has('creek.till')) return 'Already light.';
          if (this.s.skill('stealth') < 2) return 'Requires Stealth 2';
          if (!this.ctx.player.crouching) return 'Crouch. She is right there.';
          return true;
        },
        run: () => {
          if (!this.s.set('creek.till')) return;
          const got = this.loot([{ id: 'scrap', qty: 4 }, { id: 'water', qty: 1 }]);
          this.ctx.audio.play('pickup');
          this.toast(`The till was light. Inez is still talking to a shelf. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, 'The till');
        },
      },
    });
    this.interactables.push({
      id: 'closet', pos: this.pos('closet'), radius: 1.85,
      visible: () => !this.s?.has('creek.stair'),
      primary: this.pickAction(4, 3, 'CLOSET', () => this.opened('creek.stair', 'closet', 'The closet was a stair all along. Up you go.')),
      secondary: {
        label: 'Charge the closet door',
        available: () => this.chargeReason(2),
        run: () => this.blow('creek.stair', 'closet', null, 'The closet door comes off. Everyone in the Till heard it.', 2),
      },
    });
    this.interactables.push({
      id: 'loft', pos: this.pos('loftShelf'), radius: 1.5,
      visible: () => !!this.s?.has('creek.stair') && !this.s.has('creek.loft'),
      primary: {
        label: 'Read the page on the shelf',
        available: () => true,
        run: () => this.readLoft(),
      },
    });
    this.interactables.push({
      id: 'guest', pos: this.pos('guest'), radius: 1.6,
      visible: () => !this.s?.has('creek.guest'),
      primary: { label: 'Read the guest book', available: () => true, run: () => this.readGuest() },
    });
    this.interactables.push({
      id: 'motelB', pos: this.pos('motelB'), radius: 1.85,
      visible: () => !this.s?.has('creek.motel.b'),
      primary: this.pickAction(3, 1, 'MOTEL', () => this.opened('creek.motel.b', 'motelB', 'Three pins. The room smells like a closed window.')),
    });
    this.interactables.push({
      id: 'motelBloot', pos: this.pos('motelBloot'), radius: 1.6,
      visible: () => !!this.s?.has('creek.motel.b') && !this.s.has('creek.motel.b.loot'),
      primary: {
        label: 'Search the room', available: () => true,
        run: () => {
          // Sol's roll is the room's real find. It comes with you even if the pack complains.
          if (!this.s.has('creek.motel.b.loot')) this.s.addItem('sol_roll', 1, false, true);
          this.take('creek.motel.b.loot', [{ id: 'battery', qty: 1 }, { id: 'scrap', qty: 2 }, { id: 'medkit', qty: 1 }]);
        },
      },
    });
    this.interactables.push({
      id: 'motelC', pos: this.pos('motelC'), radius: 1.85,
      visible: () => !this.s?.has('creek.motel.c'),
      primary: {
        label: 'Charge the boards',
        available: () => this.chargeReason(1),
        run: () => this.blow('creek.motel.c', null, 'boards', 'Boards. The street looks over.', 1),
      },
    });
    this.interactables.push({
      id: 'motelCloot', pos: this.pos('motelCloot'), radius: 1.6,
      visible: () => !!this.s?.has('creek.motel.c') && !this.s.has('creek.motel.c.loot'),
      primary: { label: 'Search the boarded room', available: () => true, run: () => this.take('creek.motel.c.loot', [{ id: 'charge', qty: 1 }, { id: 'scrap', qty: 3 }]) },
    });
    this.interactables.push(talk('sol', 'Talk to Sol', () => this.talkSol()));
    this.interactables.push(talk('ren', 'Talk to Ren', () => this.talkRen()));
    this.interactables.push({
      id: 'shed', pos: this.pos('shed'), radius: 1.8,
      visible: () => !this.s?.has('creek.wash'),
      primary: { label: 'Read the board', available: () => true, run: () => this.readWash() },
    });
    this.interactables.push({
      id: 'forage', pos: this.pos('forage'), radius: 2.1,
      visible: () => !this.s?.has('creek.forage'),
      primary: {
        label: 'Pick through the wash',
        available: () => (this.s.skill('survival') >= 1 ? true : 'Requires Survival 1'),
        run: () => {
          if (!this.s.set('creek.forage')) return;
          const sv = this.s.skill('survival');
          const items = [{ id: 'scrap', qty: sv >= 3 ? 4 : 2 }];
          if (sv >= 3) items.push({ id: 'ration', qty: 1 }, { id: 'water', qty: 1 });
          if (sv >= 5) items.push({ id: 'medkit', qty: 1 });
          const got = this.loot(items);
          this.toast(`The wash gives up what the rain left. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, 'The wash');
        },
      },
    });
    this.interactables.push({
      id: 'tower', pos: this.pos('tower'), radius: 1.7,
      visible: () => !this.s?.has('creek.tower'),
      primary: {
        label: 'The crate under the tower',
        available: () => {
          const stealth = this.s.skill('stealth') >= 3 && this.ctx.player.crouching;
          const eye = this.s.skill('survival') >= 4;
          if (stealth || eye) return true;
          return 'Requires Stealth 3, crouched — or Survival 4';
        },
        run: () => this.take('creek.tower', [{ id: 'battery', qty: 1 }, { id: 'scrap', qty: 2 }, { id: 'lockpick', qty: 2 }]),
      },
    });

    this.interactables.push(talk('wick', 'Talk to Wick', () => this.talkWick()));
    this.interactables.push({
      id: 'rock', pos: this.pos('rock'), radius: 2.0,
      visible: () => !this.s?.has('cave.pocket'),
      primary: {
        label: 'Charge the rockfall',
        available: () => this.chargeReason(2),
        run: () => this.blow('cave.pocket', null, 'rockfall', 'The fall slumps. The pocket behind it was always there.', 2),
      },
    });
    this.interactables.push({
      id: 'pocket', pos: this.pos('pocket'), radius: 1.6,
      visible: () => !!this.s?.has('cave.pocket') && !this.s.has('cave.pocket.loot'),
      primary: {
        label: 'The crate she didn\'t buy',
        available: () => true,
        run: () => this.vesperCrate(),
      },
    });
  }

  // ------------------------------------------------------------------ rules of the street
  /** The Social rank Dry Creek hears: Known Face adds one, the Defector's founder accent costs one. */
  private townSocial() {
    return Math.max(0, this.social() - (this.s.archetype.perk === 'insider' ? 1 : 0));
  }

  private needSocial(n: number, who: string) {
    if (this.townSocial() >= n) return undefined;
    const accent = this.s.archetype.perk === 'insider' ? ' Dry Creek hears your founder accent: one rank less.' : '';
    return `Requires Social Engineering ${n}. ${who}${accent}`;
  }

  /**
   * What's new, said in passing after the hello: the Act I ending, the favours that touched them,
   * and the hour. One line at most (the first that applies), so a returning visitor hears the town move.
   */
  private news(who: 'nia' | 'doc' | 'inez' | 'sol' | 'ren' | 'wick'): string {
    const s = this.s;
    const night = this.ctx.atmo.isNight;
    const ending = s.has('act1.broadcast') ? 'broadcast' : s.has('act1.leverage') ? 'leverage' : s.has('act1.deal') ? 'deal' : '';
    const pick = (...xs: [boolean, string][]) => xs.find(([ok]) => ok)?.[1] ?? '';
    switch (who) {
      case 'nia': return pick(
        [s.has('q.chat.air'), ' Heard Dez read that founders\' chat on the band. "Water is the new water." I had to sit down. I\'m still sitting down.'],
        [s.has('q.song.band'), ' Somebody played Rosa\'s song on the radio at sunset. The whole street stopped. Sol pretended he had smoke in his eye.'],
        [ending === 'broadcast', ' I heard every name on the radio. My cousin\'s on page four. Paid in full. Got the tote bag.'],
        [ending === 'leverage', ' Mara\'s keeping their ledger in a tin, I hear. Good. Make them pay rent for once.'],
        [ending === 'deal', ' Twenty jugs a week to Last Chance, I hear. Must be nice. Dry Creek gets the dust.'],
        [s.favours().pipPool, ' Pip has a pool now? Tell her the diner has a puddle. We could be sister cities.'],
        [night, ' Kitchen\'s closed. The coffee isn\'t.'],
      );
      case 'doc': return pick(
        [ending === 'broadcast', ' Half the names you read on the radio were my patients. I crossed them off, then I crossed them back on. They\'re alive. That should count.'],
        [ending === 'leverage', ' A ledger in an ammo tin. That\'s a prescription I understand.'],
        [ending === 'deal', ' Twenty jugs a week. Tell Mara to boil them. I don\'t trust water with a logo.'],
        [s.has('q.doc.delivered'), ' Wick\'s cough is down to a rumble. I can hear it from here. It\'s a better rumble.'],
        [night, ' (He\'s in a cardigan. It\'s a doctor cardigan.)'],
      );
      case 'inez': return pick(
        [s.has('lore.lifeboat') && !s.has('q.chat.air'), ' Somebody\'s selling founder phones on the east band. I\'m not saying it was me. It wasn\'t. I wish it was.'],
        [ending === 'broadcast', ' Free advertising for every name on that list. Shame it was all bad press.'],
        [ending === 'leverage', ' Leverage. Finally, somebody at Last Chance understands commerce.'],
        [ending === 'deal', ' You traded a ledger for twenty jugs. I\'d have got you thirty. Amateurs.'],
        [night, ' We\'re closed. Unless you\'re buying.'],
      );
      case 'sol': return pick(
        [s.has('q.song.quiet'), ' (He\'s humming. He stops when he sees you, then starts again.)'],
        [s.has('q.song.band'), ' Heard it on the band at sunset, with the whole street. Thank you for that. I\'ll say it once.'],
        [ending === 'broadcast', ' Every name on the radio. Took you an hour. Took them three years to earn it.'],
        [ending === 'deal', ' Twenty jugs. Mm. A lock that opens when she says so is still a lock.'],
        [night, ' Night\'s for listening.'],
      );
      case 'ren': return pick(
        [ending === 'deal', ' Kade drone went over on Tuesday, toward Last Chance. Twenty jugs, they said. I counted nineteen. It\'s always nineteen.'],
        [ending === 'broadcast', ' I counted the names when Mara read them. Four hundred and six. I lost count at the senators.'],
        [ending === 'leverage', ' Watched the free-trial drone go over. It came with a survey. "How likely are you to recommend thirst?"'],
        [s.has('lore.walkwest'), ' You found someone on the west road, didn\'t you. I counted forty walk out that way, one week. I stopped counting the ones coming back. There was nothing to count.'],
        [night, ' Night shift. The road\'s even emptier in the dark.'],
      );
      case 'wick': return pick(
        [s.has('lore.panopticon'), ' Something with a blue light flew over the ridge last night, slow, from the north. Like it was reading.'],
        [ending === 'broadcast', ' Heard you on the radio, reading names. Didn\'t hear mine. Good.'],
        [!!ending, ' Whatever you did with that ledger, the salt still glows at night. Do better next time.'],
        [night, ' Fire\'s small on purpose.'],
      );
    }
  }

  // ------------------------------------------------------------------ routines (content/routines.ts)
  /** Where each talk prompt lives by default (the person's first slot). */
  private home = new Map<string, THREE.Vector3>();
  /** Not in any slot right now (asleep, on a call, shut): the prompt is their note. */
  private away = new Set<string>();
  /** Living somewhere else now (Ren at Last Chance): no prompt here at all. */
  private gone = new Set<string>();
  private routineT = 0;

  /** Follow each person to whichever slot they're in, twice a second. */
  private followRoutines(dt: number) {
    if ((this.routineT -= dt) > 0) return;
    this.routineT = 0.5;
    for (const [id, home] of this.home) {
      const w = this.crowds.map((c) => c.where(id)).find((x) => !!x) ?? null;
      const spot = this.world.get(id)!;
      this.gone.delete(id);
      this.away.delete(id);
      if (w) {
        // the talk prompt stands where they are (their slot's neck, a little lower: the old spots were at 1.05)
        if (w.station && !STATIONS[w.station]?.primary) spot.copy(w.neck).setY(w.neck.y - 0.35);
        else spot.copy(home);
      } else {
        spot.copy(home);
        if (id === 'ren' && this.s?.has('q.ren.truth')) this.gone.add(id);
        else this.away.add(id);
      }
    }
  }

  private async awayNote(id: string, talk: () => void | Promise<void>) {
    const a = AWAY[id];
    const pick = await this.ctx.ui.choose({
      speaker: a.speaker,
      text: a.text,
      choices: [...(a.knock ? [{ id: 'knock', label: a.knock.label }] : []), { id: 'ok', label: 'Leave it.' }],
    });
    if (pick === 'knock' && a.knock) {
      this.ctx.ui.subtitle(a.knock.speaker, a.knock.text);
      await new Promise((r) => setTimeout(r, 1400));
      await talk();
    }
  }

  /** Where they were the afternoon of the Pivot: one topic each. */
  private pivotNode(speaker: string, text: string) {
    return { speaker, text, choices: [{ id: 'back', label: 'Thank you for telling me.', next: 'hello' }] };
  }

  /** "Walk west with me" after Act I. Anyone at standing 2 says yes. */
  private crewChoice(id: 'nia' | 'doc' | 'inez' | 'sol' | 'ren' | 'wick', label = 'Would you walk west with me, to Apex?') {
    if (!this.s.has('debriefed')) return [];
    if (this.s.has(`crew.${id}`)) return [{ id: 'crewed', label: 'About Apex.', disabled: 'Already said yes. Already packing.' }];
    const rep = this.s.rep(id);
    return [{ id: 'crew', label, disabled: rep >= 2 ? undefined : 'Not yet. Finish a favour for them first (standing 2).', next: 'crew' }];
  }

  private joinCrew(id: string) {
    if (!this.s.set(`crew.${id}`)) return;
    this.s.addXP(25, 'Crew for Apex');
    this.ctx.audio.play('uiConfirm');
  }

  private powerClinic(line: string) {
    if (!this.s.set('creek.power')) return;
    this.ctx.audio.play('unlock');
    this.ctx.ui.banner('GENERATOR', line, 'good');
    this.s.addXP(XP_REWARDS.keypadShorted, 'Generator');
  }

  private circuitAction(id: string, title: string, difficulty: number, flag: string, onOk: () => void): Action {
    const need = id === 'freezer' ? 3 : 1;
    return {
      label: id === 'freezer' ? 'Open the freezer' : 'Convince the generator',
      available: () => {
        if (this.s.has(flag)) return 'Already done.';
        if (this.s.skill('electronics') < need) return `Requires Electronics ${need}`;
        return true;
      },
      run: async () => {
        if (this.s.has(flag)) return;
        if (this.s.skill('electronics') >= 5) {
          this.toast('You flip it like a switch.', 'good');
          // Salvage pays for a switch too (boards pay through Game's circuit wrapper)
          if (this.s.capstone('electronics') === 'salvage') this.loot([{ id: 'battery', qty: 1 }]);
          onOk();
          return;
        }
        const ok = await this.ctx.ui.circuit({ title, difficulty });
        if (ok) onOk();
        else this.ctx.audio.play('deny');
      },
    };
  }

  private pickAction(pins: number, need: number, title: string, onOk: () => void): Action {
    return {
      label: `Pick lock · ${pins} pins`,
      available: () => {
        if (this.s.skill('lockpicking') < need) return `Requires Lockpicking ${need}`;
        if (this.s.count('lockpick') < 1) return 'Need a lockpick';
        return true;
      },
      run: async () => {
        const res = await this.ctx.ui.lockpick({
          pins, title,
          onBreak: () => {
            this.s.removeItem('lockpick', 1);
            this.s.events.emit('toast', { text: `Lockpick snapped (${this.s.count('lockpick')} left)`, kind: 'bad' });
            return this.s.count('lockpick') > 0;
          },
        });
        if (res === 'success') {
          this.s.data.stats.picks++;
          this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
          this.s.addXP(XP_REWARDS.lockPicked + pins * 5, 'Lock picked');
          onOk();
        }
      },
    };
  }

  private chargeReason(need: number): true | string {
    if (this.s.skill('demolition') < need) return `Requires Demolition ${need}`;
    if (this.s.count('charge') < 1) return 'Need a breach charge';
    return true;
  }

  private opened(flag: string, door: string | null, line: string) {
    if (!this.s.set(flag)) return;
    if (door) this.openDoor(door, false);
    this.toast(line, 'good');
  }

  private blow(flag: string, door: string | null, blocker: string | null, loud: string, need: number) {
    if (this.chargeReason(need) !== true) { this.ctx.audio.play('deny'); return; }
    if (this.s.has(flag)) return;
    if (!this.s.removeItem('charge', 1)) return;
    this.s.set(flag);
    const quiet = this.s.focus('demolition') === 'shaped' || (this.s.skill('demolition') >= 4 && this.ctx.player.crouching);
    if (door) this.openDoor(door, false);
    if (blocker) this.clearBlocker(blocker);
    this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.8 });
    this.ctx.cam.addTrauma(quiet ? 0.12 : 0.4);
    this.toast(quiet ? 'Shaped. The street stays at dinner.' : loud, quiet ? 'good' : 'bad');
    this.s.addXP(XP_REWARDS.breach, 'Breached');
  }

  private loot(items: { id: string; qty: number }[]) {
    const got: string[] = [];
    for (const it of items) {
      const n = this.s.addItem(it.id, it.qty);
      if (n) got.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
    }
    return got.join(', ');
  }

  private take(flag: string, items: { id: string; qty: number }[]) {
    if (!this.s.set(flag)) return;
    const got = this.loot(items);
    this.ctx.audio.play('pickup');
    this.toast(got || 'Nothing you can carry.', got ? 'good' : 'bad');
    this.s.addXP(XP_REWARDS.cache, 'Cache');
  }

  private async vesperCrate() {
    const pick = await this.ctx.ui.choose({
      speaker: 'Paint on the rock',
      text: '"V. K. looked. Didn\'t buy." Under the paint, a crate taped shut in her handwriting: PROTOTYPE ADJACENT. Water, cells, scrap. Wick is watching you from the fire.',
      choices: [
        { id: 'take', label: 'Take the crate.' },
        { id: 'leave', label: 'Leave it for Wick.' },
        { id: 'later', label: 'Not yet.' },
      ],
    });
    if (pick === 'take' && this.s.set('q.wick.took')) {
      this.s.set('cave.pocket.loot');
      const got = this.loot([{ id: 'water', qty: 1 }, { id: 'battery', qty: 2 }, { id: 'scrap', qty: 2 }]);
      this.s.addXP(40, 'Vesper\'s leftovers');
      this.toast(`${got}. Wick says nothing, which from Wick is a paragraph.`, 'good');
    } else if (pick === 'leave' && this.s.set('q.wick.left')) {
      this.s.set('cave.pocket.loot');
      this.toast('You leave it. Wick paints over her initials with his own, and points at the seep at the back of the cave.', 'good');
    }
  }

  private async readWash() {
    if (!this.s.set('creek.wash')) return;
    this.s.set('cave.known');
    this.s.addXP(15, 'The wash');
    await this.ctx.ui.choose({
      speaker: 'Board on the shed',
      text: 'South of the Spire there\'s a wash with posts in it, the only ground up that ridge that still agrees to be walked. Wick lives at the top. He does not come down for coffee.',
      choices: [{ id: 'ok', label: 'Follow the posts.' }],
    });
  }

  private async readGuest() {
    if (!this.s.set('creek.guest')) return;
    this.s.addXP(15, 'Guest book');
    await this.ctx.ui.choose({
      speaker: 'Guest book',
      text: 'Last page, in pencil: "Room 2 is three pins, if your hands are worth a rank. Room 3 is nailed shut. The ice machine left with the owner. And the Till has a stair that the sign calls a closet."',
      choices: [{ id: 'ok', label: 'Tear the page out' }],
    });
  }

  private async readLoft() {
    if (!this.s.set('creek.loft')) return;
    this.s.set('cave.known');
    const got = this.loot([{ id: 'battery', qty: 1 }, { id: 'water', qty: 1 }]);
    this.s.addItem('deed', 1, true, true);
    this.s.addXP(35, 'The stair');
    await this.ctx.ui.choose({
      speaker: 'The landlord\'s shelf',
      text: `A map of the ridge south of the Spire, with a cut drawn in it: "Wick answers the radio with silence. A woman with rocket money looked at the pocket and didn't buy." Under it, the deed to the Till, signed over to "whoever is still here". ${got}`,
      choices: [{ id: 'ok', label: 'Take the deed. Decide later.' }],
    });
  }

  // ------------------------------------------------------------------ Nia
  private async talkNia() {
    if (this.s.set('creek.talk.nia')) this.s.addXP(XP_REWARDS.talk, 'Heard Nia');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.niaNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'water' && s.set('creek.nia.water')) {
          this.loot([{ id: 'water', qty: 1 }]);
          this.toast('Nia slides one bottle across. She writes it down.', 'good');
        }
        if (choice === 'ridge' && s.set('creek.nia.ridge')) {
          s.set('cave.known');
          s.addXP(XP_REWARDS.talk, 'The ridge');
        }
        if (choice === 'stair') s.set('creek.hint.stair');
        if (choice === 'tell') s.set('q.nia.told');
        if (choice === 'cover' && s.count('water') >= 2 && !s.has('q.nia.covered')) {
          s.removeItem('water', 2);
          s.set('q.nia.covered');
        }
        if (choice === 'peace' && this.townSocial() >= 3) s.set('q.nia.peace');
        if (choice === 'plate' && s.favours().niaPlate && s.favourReady('nia.plate')) {
          s.useFavour('nia.plate');
          s.satisfy(45, 12, 8);
          this.ctx.audio.play('eat');
          this.toast('Nia\'s plate. Beans, something green, and opinions. Less hungry, less thirsty.', 'good');
        }
        if (choice === 'deed' && s.removeItem('deed', 1)) s.set('q.inez.town');
        if (choice === 'igniter' && !s.has('q.rider.delivered') && s.removeItem('igniter', 1)) {
          s.set('q.rider.delivered');
          this.loot([{ id: 'ration', qty: 1 }]);
          s.addXP(30, 'Delivered');
          this.ctx.audio.play('uiConfirm');
        }
        if (choice === 'nine' && s.set('creek.nia.nine')) s.addRep('nia', 1);
        if (choice === 'crew') this.joinCrew('nia');
      },
    });
  }

  private niaNode(id: string) {
    const s = this.s;
    const soc = this.townSocial();
    const q = s.has('q:nia.short') && !s.has('q:nia.short:done');
    if (id === 'hello') {
      const short = s.has('q.nia.told') || s.has('q.nia.peace') || s.has('q.nia.covered')
        ? ''
        : ' Also, somebody keeps drinking my ledger. Two bottles a week, from under this counter.';
      const plate = s.favours().niaPlate;
      return {
        speaker: 'Nia Pell',
        text: `${s.rep('nia') >= 2 ? 'There you are. Sit.' : 'You have the radio look. Mara\'s, or just thirsty.'} I cook what shows up. Today that isn't much.${short}${this.news('nia')}`,
        choices: [
          { id: 'water', label: 'One bottle, for the camp.', disabled: s.has('creek.nia.water') ? 'She already wrote you down.' : undefined, next: 'hello' },
          ...(q ? [{ id: 'short', label: s.has('q.nia.who') ? 'I know who\'s taking your water.' : 'About your missing water...', next: 'short' }] : []),
          ...(plate ? [{ id: 'plate', label: 'Eat at the counter.', disabled: s.favourReady('nia.plate') ? undefined : 'Rest first. The plate is for people who sleep.', next: 'hello' }] : []),
          ...(s.count('deed') && !s.has('q.inez.inez') && !s.has('q.inez.town') ? [{ id: 'deed', label: 'Pin the Till\'s deed on your wall. It\'s the town\'s.', next: 'deed' }] : []),
          ...(s.count('igniter') && !s.has('q.rider.delivered') ? [{ id: 'igniter', label: 'Delivery for N. Pell. One stove igniter. It\'s running late.', next: 'igniter' }] : []),
          { id: 'who', label: 'Who else is still here?', next: 'who' },
          { id: 'ridge', label: 'Anything up on the ridge?', disabled: this.needSocial(1, 'She doesn\'t give directions to strangers.'), next: 'ridge' },
          { id: 'pivot', label: 'Where were you, the afternoon of the Pivot?', next: 'pivot' },
          ...this.crewChoice('nia'),
          { id: 'bye', label: 'Keep the light on.' },
        ],
      };
    }
    if (id === 'short') {
      if (!s.has('q.nia.who')) {
        return {
          speaker: 'Nia Pell',
          text: 'Two bottles a week. Always at night. Always the good ones. Find out who before I suspect everyone. I already suspect everyone.',
          choices: [{ id: 'back', label: 'I\'ll ask around.', next: 'hello' }],
        };
      }
      return {
        speaker: 'Nia Pell',
        text: 'Well? Who is it? Don\'t soften it. I\'ve been softened enough for one apocalypse.',
        choices: [
          { id: 'tell', label: 'It\'s Doc.', next: 'told' },
          { id: 'cover', label: 'The jugs leak. Here, two of mine. (2 water)', disabled: s.count('water') >= 2 ? undefined : 'You need 2 water to cover it.', next: 'covered' },
          { id: 'peace', label: 'It\'s Doc, and he needs it for the clinic. Talk to him.', disabled: soc >= 3 ? undefined : this.needSocial(3, 'Making peace takes a gentle tongue.'), next: 'peace' },
          { id: 'back', label: 'Not yet.', next: 'hello' },
        ],
      };
    }
    if (id === 'told') {
      return {
        speaker: 'Nia Pell',
        text: 'Doc? DOC. I fed that man through two winters. ...Thank you. There\'s a plate at the counter for you whenever you\'ve slept. I\'m going to go yell now.',
        choices: [{ id: 'ok', label: 'Go easy on him. Or don\'t.' }],
      };
    }
    if (id === 'covered') {
      return {
        speaker: 'Nia Pell',
        text: 'Leaky jugs. Of course it\'s leaky jugs. Thank you. I\'ll stop glaring at the clinic. Mostly.',
        choices: [{ id: 'ok', label: 'Glare a little. For balance.' }],
      };
    }
    if (id === 'peace') {
      return {
        speaker: 'Nia Pell',
        text: 'For the sterilizer? He could have ASKED. Fine. Fine! He stores it here, in writing, and he buys the next ledger. Tell him I said that. Tell him I said it nicely.',
        choices: [{ id: 'ok', label: 'I\'ll tell him you said it nicely.' }],
      };
    }
    if (id === 'igniter') {
      return {
        speaker: 'Nia Pell',
        text: 'I ordered this. I ordered this before the Pivot. Ten minutes, the app said. (She turns the box over twice.) It\'s the right part. Of course it\'s the right part. Who brought it? Not you. You have the wrong face for it. Who brought it?',
        choices: [{ id: 'nine', label: 'A rider called Nine. He finished the route.', next: 'nine' }],
      };
    }
    if (id === 'nine') {
      return {
        speaker: 'Nia Pell',
        text: 'Then he gets a plate. Every night, out by the road where Ren sits. Ren can finally have some company. (The stove catches on the first click. She doesn\'t say anything for a while.) Here. Take this for the road. He\'d have wanted a tip.',
        choices: [{ id: 'ok', label: 'Five stars, Nia.' }],
      };
    }
    if (id === 'deed') {
      return {
        speaker: 'Nia Pell',
        text: 'The Till belongs to Dry Creek? Inez is going to set something on fire. Probably this. I\'m going to laminate it.',
        choices: [{ id: 'ok', label: 'Laminate it twice.' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Nia Pell',
        text: 'Somebody has to feed you on the way. Yes. I\'m bringing the stove. The stove is coming whether it likes it or not.',
        choices: [{ id: 'ok', label: 'Bring the stove.' }],
      };
    }
    if (id === 'pivot') {
      return this.pivotNode('Nia Pell', 'Making soup. The power went, then the phones, then the sky went a colour I didn\'t have a name for. I kept stirring. Soup doesn\'t care what the sky does. Twelve people came in that night and I fed every one of them on credit. That\'s how the ledger started.');
    }
    if (id === 'who') {
      return {
        speaker: 'Nia Pell',
        text: 'Doc Ivers runs the clinic, when the generator agrees with him. Inez runs the Till and locks rooms she says are empty. Sol keeps the street fire and knows every tired lock. Ren just sits and counts the road. We\'re not a town. We\'re a pause between thirsts.',
        choices: [{ id: 'back', label: 'Sounds like a town to me.', next: 'hello' }],
      };
    }
    if (id === 'ridge') {
      const stair = soc >= 3 ? ' And Inez\'s back room has a stair. She calls it a closet. Closets don\'t have that many steps.' : '';
      return {
        speaker: 'Nia Pell',
        text: `South of the Spire, somebody cut a wash into the ridge and put posts in it. It\'s the only ground up there that still agrees to be walked. A man called Wick lives at the top and answers the radio with silence.${stair}`,
        choices: [
          ...(soc >= 3 ? [{ id: 'stair', label: 'Tell me about the stair.', next: 'hello' }] : []),
          { id: 'ok', label: 'I\'ll know it when I see it.', next: 'hello' },
        ],
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ Doc
  private async talkDoc() {
    if (this.s.set('creek.talk.doc')) this.s.addXP(XP_REWARDS.talk, 'Heard Doc');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.docNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'heal' && s.has('creek.power')) {
          const calls = s.favours().docCalls;
          const ok = calls ? s.favourReady('doc.heal') : !s.has('creek.doc.heal');
          if (!ok) return;
          if (calls) s.useFavour('doc.heal');
          s.set('creek.doc.heal');
          const sv = s.skill('survival');
          s.heal(30 + sv * 6);
          if (sv >= 2 && !s.has('creek.doc.kit')) { s.set('creek.doc.kit'); this.loot([{ id: 'medkit', qty: 1 }]); }
          this.toast(calls ? 'House call. Doc stitches you and complains about your posture.' : sv >= 2 ? 'Doc stitches, then makes you take a kit so you stop visiting.' : 'Doc stitches what he can see.', 'good');
        }
        if (choice === 'cell' && !s.has('creek.power') && s.removeItem('battery', 1)) {
          this.powerClinic('Doc swears at the generator until it agrees with him. The window wakes up.');
        }
        if (choice === 'list' && this.townSocial() >= 2 && s.set('creek.doc.list')) {
          s.addXP(25, 'Patient list');
        }
        if (choice === 'admit' && this.townSocial() >= 2) s.set('q.nia.who');
        if (choice === 'kit' && s.has('creek.power') && s.set('q.doc.kit')) {
          s.addItem('medkit', 1, false, true);
        }
        if (choice === 'creek' && s.set('creek.doc.permit')) s.addXP(XP_REWARDS.talk, 'Why the creek is dry');
        if (choice === 'crew') this.joinCrew('doc');
      },
    });
  }

  private docNode(id: string) {
    const s = this.s;
    const powered = s.has('creek.power');
    const soc = this.townSocial();
    if (id === 'hello') {
      const calls = s.favours().docCalls;
      const healBlock = !powered ? 'The generator is out.' : calls ? (s.favourReady('doc.heal') ? undefined : 'House calls are once per rest.') : s.has('creek.doc.heal') ? 'He already spent the gauze on you.' : undefined;
      const coughQuest = s.has('q:doc.cough') && !s.has('q.doc.kit');
      return {
        speaker: 'Doc Ivers',
        text: (powered
          ? (s.rep('doc') >= 2 ? 'My favourite patient. Don\'t let it go to your head, there are only nine of you.' : 'Window\'s on. That means I can see what I\'m doing. Don\'t make me grateful out loud.')
          : 'If you\'re bleeding, the generator has to agree first. It\'s out the east side. I don\'t speak to it. Also, Wick has a cough I can hear from here, and I can\'t do a thing about it in the dark.') + this.news('doc'),
        choices: [
          { id: 'heal', label: calls ? 'House call, Doc.' : 'Patch me up.', disabled: healBlock, next: 'hello' },
          ...(!powered ? [{ id: 'cell', label: 'Here, a lithium cell. Rig it yourself.', disabled: s.count('battery') ? undefined : 'You don\'t have a lithium cell.', next: 'hello' }] : []),
          ...(coughQuest && powered ? [{ id: 'kit', label: 'You mentioned Wick\'s cough.', next: 'kit' }] : []),
          ...(s.has('q:nia.short') && !s.has('q.nia.who') ? [{ id: 'admit', label: 'Nia\'s missing water, Doc.', disabled: soc >= 2 ? undefined : this.needSocial(2, 'He won\'t confess to a stranger.'), next: 'admit' }] : []),
          { id: 'list', label: 'You knew Tanner\'s customers.', disabled: soc >= 2 ? (s.has('creek.doc.list') ? 'You have the list.' : undefined) : this.needSocial(2, 'He doesn\'t share patients with strangers.'), next: 'list' },
          { id: 'creek', label: 'What happened to the creek?', next: 'creek' },
          { id: 'pivot', label: 'Where were you, the afternoon of the Pivot?', next: 'pivot' },
          ...this.crewChoice('doc'),
          { id: 'bye', label: 'Take care, Doc.' },
        ],
      };
    }
    if (id === 'pivot') {
      return this.pivotNode('Doc Ivers', 'Setting a broken wrist. The lights went, then the X-ray, then the patient\'s phone in the middle of a sentence. I set it by feel. He paid me in a chicken. The chicken is still the most reliable investor Dry Creek ever had.');
    }
    if (id === 'kit') {
      return {
        speaker: 'Doc Ivers',
        text: 'Wick. Up in the Cut, south of the Spire. Coughs like a cement mixer, won\'t come down. Take him this. Tell him it\'s from the town, not from me. He\'ll use it if it\'s from the town.',
        choices: [{ id: 'ok', label: 'From the town. Got it.' }],
      };
    }
    if (id === 'admit') {
      return {
        speaker: 'Doc Ivers',
        text: '...The sterilizer needs water. I was going to ask her. I\'ve been going to ask her for two years. Tell her, or don\'t. I\'m a doctor, not a diplomat.',
        choices: [{ id: 'ok', label: 'I\'ll think about what she hears.', next: 'hello' }],
      };
    }
    if (id === 'list') {
      return {
        speaker: 'Doc Ivers',
        text: 'Bunker health plans. Tanner sold them to half the camps: "priority medical in your private shelter". I treated the people who bought them. They got a tote bag and a laminated card. I kept the list because somebody should.',
        choices: [{ id: 'ok', label: 'Somebody should.', next: 'hello' }],
      };
    }
    if (id === 'creek') {
      return {
        speaker: 'Doc Ivers',
        text: 'The summer before the Pivot, the county let Kade Holdings run a "pilot" on our aquifer. We got a school with a rocket on the sign. Eight months later the creek stopped. They called it a drought. Droughts don\'t come with a pump station.',
        choices: [{ id: 'ok', label: 'Kade Holdings.', next: 'hello' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Doc Ivers',
        text: 'Somebody has to stitch you up on the salt. Fine. I\'m bringing the good gauze, and I\'m complaining the whole way.',
        choices: [{ id: 'ok', label: 'Complain all you like.' }],
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ Inez
  private async talkInez() {
    if (this.s.set('creek.talk.inez')) this.s.addXP(XP_REWARDS.talk, 'Heard Inez');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.inezNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'trade') {
          const rate = s.favours().inezRate;
          if (s.count('scrap') < rate) return;
          s.removeItem('scrap', rate);
          this.loot([{ id: 'water', qty: 1 }]);
          this.toast(`${rate} scrap, one bottle. She doesn't haggle. Haggling is a second conversation.`, 'good');
        }
        if (choice === 'open' && s.set('creek.stair')) {
          this.openDoor('closet', false);
          this.ctx.audio.play('door');
          s.addXP(20, 'Inez opened the closet');
        }
        if (choice === 'stair') s.set('creek.hint.stair');
        if (choice === 'tickets') s.set('inez.tube');
        if (choice === 'deed' && s.removeItem('deed', 1)) s.set('q.inez.inez');
        if (choice === 'crew') this.joinCrew('inez');
      },
    });
  }

  private inezNode(id: string) {
    const s = this.s;
    const soc = this.townSocial();
    if (id === 'hello') {
      const rate = s.favours().inezRate;
      const owner = s.has('q.inez.inez');
      return {
        speaker: 'Inez Quill',
        text: (owner
          ? 'Welcome to the Till. My Till. Legally, in pencil. Browse. Don\'t palm. I can hear a hand.'
          : s.has('q.inez.town')
            ? 'The town\'s Till is open. The town\'s prices went up. Funny how that works.'
            : 'The Till is open. The sign about the closet is also open, which is a kind of honesty. Don\'t palm the drawer. I can hear a hand.') + this.news('inez'),
        choices: [
          { id: 'trade', label: `${rate} scrap for a bottle.`, disabled: soc >= 2 ? (s.count('scrap') >= rate ? undefined : `Need ${rate} scrap.`) : this.needSocial(2, 'She doesn\'t trade with strangers.'), next: 'hello' },
          ...(s.count('deed') && !owner && !s.has('q.inez.town') ? [{ id: 'deed', label: 'I found the deed to the Till. It\'s yours.', next: 'deeded' }] : []),
          { id: 'closet', label: 'The closet.', disabled: s.has('creek.stair') ? 'You\'ve been up there.' : this.needSocial(3, 'She won\'t discuss the closet with a stranger.'), next: 'closet' },
          { id: 'tickets', label: 'Ever sell anything that actually worked?', next: 'tickets' },
          { id: 'pivot', label: 'Where were you, the afternoon of the Pivot?', next: 'pivot' },
          ...this.crewChoice('inez'),
          { id: 'bye', label: 'I\'ll look, not touch.' },
        ],
      };
    }
    if (id === 'pivot') {
      return this.pivotNode('Inez Quill', 'Selling the forty-first ticket for the Tube. The card reader said DECLINED, and then everything said declined. First time a machine ever saved a customer. I kept the forty dollars I never charged her. I still feel bad about it. Not that bad.');
    }
    if (id === 'closet') {
      return {
        speaker: 'Inez Quill',
        text: 'The landlord\'s stair. I don\'t have a key that I will admit to. A picker at rank 3 gets bored and opens it. Or you can keep talking.',
        choices: [
          { id: 'open', label: 'Admit to the key.', disabled: soc >= 4 ? undefined : this.needSocial(4, 'She\'s not admitting anything yet.'), next: 'hello' },
          { id: 'stair', label: 'I\'ll come back with a pick.', next: 'hello' },
        ],
      };
    }
    if (id === 'tickets') {
      return {
        speaker: 'Inez Quill',
        text: 'Before the Pivot I sold forty tickets for the hyperloop out east. The Tube. Nobody\'s asked for a refund, because nobody ever arrived. If you\'re walking that way, find out whether I owe anybody.',
        choices: [{ id: 'ok', label: 'I\'ll look into your refund policy.', next: 'hello' }],
      };
    }
    if (id === 'deeded') {
      return {
        speaker: 'Inez Quill',
        text: '"Whoever is still here." I\'m still here. ...Thank you. Bottles are two scrap for you from now on. Don\'t tell Sol. Sol thinks I have a heart and I like him confused.',
        choices: [{ id: 'ok', label: 'Your secret\'s safe.' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Inez Quill',
        text: 'West? To a vault full of rich people\'s things? I\'ll bring the scale. Somebody has to price it all.',
        choices: [{ id: 'ok', label: 'Bring the scale.' }],
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ Sol
  private async talkSol() {
    if (this.s.set('creek.talk.sol')) this.s.addXP(XP_REWARDS.talk, 'Heard Sol');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.solNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'locks') s.set('creek.sol.locks');
        if (choice === 'night') s.set('q.nia.who');
        if (choice === 'give' && s.removeItem('sol_roll', 1)) s.set('q.sol.returned');
        if (choice === 'lie' && s.count('sol_roll')) s.set('q.sol.kept');
        if (choice === 'rosa' && s.set('q.song.asked')) s.addXP(XP_REWARDS.talk, 'Rosa Varga');
        if ((choice === 'song.band' || choice === 'song.quiet') && s.has('q.song.dez') && !s.has('q.song.band') && !s.has('q.song.quiet')) s.set(`q.${choice}`);
        if (choice === 'crew') this.joinCrew('sol');
      },
    });
  }

  private solNode(id: string) {
    const s = this.s;
    if (id === 'hello') {
      const rollOpen = !s.has('q.sol.returned') && !s.has('q.sol.kept');
      return {
        speaker: 'Sol Varga',
        text: (s.has('q.sol.kept')
          ? 'Fire\'s communal. My roll isn\'t, but here we are.'
          : 'Fire\'s communal. The news isn\'t. You want locks, or the version where we\'re all fine?') + this.news('sol'),
        choices: [
          { id: 'locks', label: 'Locks.', disabled: this.needSocial(1, 'He doesn\'t talk shop with strangers.'), next: 'locks' },
          ...(rollOpen && !s.count('sol_roll') ? [{ id: 'lost', label: 'You look like you lost something.', next: 'lost' }] : []),
          ...(rollOpen && s.count('sol_roll') ? [
            { id: 'give', label: 'Here. Your roll, from room 2.', next: 'given' },
            { id: 'lie', label: 'Room 2 was empty. Sorry.', next: 'lied' },
          ] : []),
          ...(s.has('q:nia.short') && !s.has('q.nia.who') ? [{ id: 'night', label: 'Who walks past your fire at night?', next: 'night' }] : []),
          ...(s.has('intel:intel.kdry.log') && !s.has('q.song.asked') ? [{ id: 'rosa', label: 'The KDRY station log was signed R. Varga.', next: 'rosa' }] : []),
          ...(s.has('q.song.dez') && !s.has('q.song.band') && !s.has('q.song.quiet') ? [
            { id: 'song.band', label: 'Rosa\'s song. Dez will play it on the open band at sunset. Listen.', next: 'songband' },
            { id: 'song.quiet', label: 'It was "Still Here", June Hollow. Here are the words.', next: 'songquiet' },
          ] : []),
          { id: 'pivot', label: 'Where were you, the afternoon of the Pivot?', next: 'pivot' },
          ...this.crewChoice('sol'),
          { id: 'fine', label: 'The fine version.' },
        ],
      };
    }
    if (id === 'rosa') {
      return {
        speaker: 'Sol Varga',
        text: 'Rosa. My wife. She ran KDRY out of the back of the feed store. The afternoon of the Pivot she stayed on the air until the generator quit, talking to whoever was left. She played one song at the end. I was out on a call, opening somebody\'s car. I never heard which song. Thirty years of doors, and that\'s the one I\'d pick.',
        choices: [{ id: 'ok', label: 'I\'ll find out which song.', next: 'hello' }],
      };
    }
    if (id === 'songband') {
      return {
        speaker: 'Sol Varga',
        text: 'At sunset. On the band. (He\'s quiet a long time. Then the radio on Nia\'s counter starts, piano first, and the street stops.) ...She\'d have liked that. A whole valley listening. She always said the audience was whoever was left.',
        choices: [{ id: 'ok', label: 'Whoever was left.' }],
      };
    }
    if (id === 'songquiet') {
      return {
        speaker: 'Sol Varga',
        text: '"Still Here." (He reads the words twice and folds them into his pick roll.) Mm. I think I knew it. I think I hummed it for three years and didn\'t know why. Thank you. Don\'t tell the street I cried. I didn\'t cry. The fire\'s smoky.',
        choices: [{ id: 'ok', label: 'The fire\'s very smoky.' }],
      };
    }
    if (id === 'pivot') {
      return this.pivotNode('Sol Varga', 'Out on a call. A woman locked out of her car at the feed store, keys on the seat. I had it open in a minute. Then nothing opened again: not the pumps, not the bank, not the phone in my pocket. Rosa was on the radio that afternoon. KDRY. I didn\'t hear her. I was busy with a door.');
    }
    if (id === 'locks') {
      return {
        speaker: 'Sol Varga',
        text: 'Left motel room is open, and the guest book in it is worth a read. Middle door is three pins: Lockpicking 1. Right door is nailed: a charge, not a conversation. The Till\'s closet is the real lock. Rank 3, or talk Inez into admitting she has the key.',
        choices: [{ id: 'ok', label: 'I\'ll spend the point on the door I mean.', next: 'hello' }],
      };
    }
    if (id === 'lost') {
      return {
        speaker: 'Sol Varga',
        text: 'My pick roll. It\'s in motel room 2. I locked it in, then I locked myself out. Thirty years a locksmith. If you get in there, bring it back. Quietly. Nobody needs to hear about this.',
        choices: [{ id: 'ok', label: 'Nobody will hear it from me.', next: 'hello' }],
      };
    }
    if (id === 'given') {
      return {
        speaker: 'Sol Varga',
        text: 'You brought it back. People don\'t bring things back anymore. Here, sit. Bend the pick like this, not like that. Your picks will last longer, and you\'ll get three out of the scrap that used to make two.',
        choices: [{ id: 'ok', label: 'Like this, not like that.' }],
      };
    }
    if (id === 'lied') {
      return {
        speaker: 'Sol Varga',
        text: 'Mm. That\'s my roll on your belt. Keep it, then. My hands will remember whose hands it went to.',
        choices: [{ id: 'ok', label: 'Leave the fire.' }],
      };
    }
    if (id === 'night') {
      return {
        speaker: 'Sol Varga',
        text: 'Doc. Every other night, with a jug and a face like a confession. I don\'t ask. I notice. Now you\'ve noticed too. Congratulations, it\'s heavier than it looks.',
        choices: [{ id: 'ok', label: 'It is.', next: 'hello' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Sol Varga',
        text: 'Thirty years of other people\'s doors. One more won\'t kill me. It might. Yes.',
        choices: [{ id: 'ok', label: 'Bring the roll.' }],
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ Ren
  private async talkRen() {
    if (this.s.set('creek.talk.ren')) this.s.addXP(10, 'Heard Ren');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.renNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'pantry' && s.skill('survival') >= 2 && s.set('creek.ren.ration')) {
          this.loot([{ id: 'ration', qty: 1 }]);
          this.toast('Ren hands you the ration they were saving for somebody who could name the wash.', 'good');
        }
        if (choice === 'truth') s.set('q.ren.truth');
        if (choice === 'spare') s.set('q.ren.spare');
        if (choice === 'crew') this.joinCrew('ren');
      },
    });
  }

  private renNode(id: string) {
    const s = this.s;
    const sv = s.skill('survival');
    const told = s.has('q.ren.truth') || s.has('q.ren.spare');
    if (id === 'hello') {
      return {
        speaker: 'Ren Oka',
        text: (s.has('q.ren.truth')
          ? 'I\'m leaving for Last Chance in the morning. Mara says they need somebody who can count a road. I can count a road.'
          : 'We\'re a pause. The highway thinks it\'s a place. It isn\'t. Sit long enough and the wash starts to look like a pantry.') + this.news('ren'),
        choices: [
          ...(s.has('site.drivein.done') && !told ? [{ id: 'ending', label: 'I found out how the keynote ended.', next: 'ending' }] : []),
          { id: 'drive', label: 'What did you do before the pause?', next: 'drive' },
          { id: 'pantry', label: 'Show me the pantry.', disabled: sv >= 2 ? (s.has('creek.ren.ration') ? 'You already ate their spare.' : undefined) : 'Requires Survival 2. You don\'t look like you know a pantry from a ditch.', next: 'hello' },
          { id: 'pivot', label: 'Where were you, the afternoon of the Pivot?', next: 'pivot' },
          ...this.crewChoice('ren'),
          { id: 'sit', label: 'I\'ll sit.' },
        ],
      };
    }
    if (id === 'pivot') {
      return this.pivotNode('Ren Oka', 'In the booth at the Starlite, threading the reel for the keynote. "One more thing," he said, and I walked out, because there\'s always one more thing. Behind me the screen went white and stayed white. Nobody else came out. I\'ve been counting things ever since. It keeps the white out.');
    }
    if (id === 'drive') {
      return {
        speaker: 'Ren Oka',
        text: 'I ran the projector at the Starlite Drive-In, north of the highway. The last screening was a keynote. I walked out at "one more thing". Nobody else came out. I\'d like to know what the thing was. I wouldn\'t like to go and look.',
        choices: [{ id: 'ok', label: 'I could look.', next: 'hello' }],
      };
    }
    if (id === 'ending') {
      return {
        speaker: 'Ren Oka',
        text: 'Tell me. Or don\'t. I\'ve been fine not knowing for two years. Mostly fine.',
        choices: [
          { id: 'truth', label: 'Tell Ren everything you saw.', next: 'truthful' },
          { id: 'spare', label: 'It was static, Ren. Just static.', next: 'spared' },
        ],
      };
    }
    if (id === 'truthful') {
      return {
        speaker: 'Ren Oka',
        text: '...All that. And nobody left. Huh. (Ren laughs, once, like a door that hasn\'t opened in years.) I think I\'m done sitting. Tell Mara there\'s a lookout coming.',
        choices: [{ id: 'ok', label: 'I\'ll tell her.' }],
      };
    }
    if (id === 'spared') {
      return {
        speaker: 'Ren Oka',
        text: 'Static. Okay. That\'s... okay. Here, take the projector\'s last cells. I won\'t be needing them.',
        choices: [{ id: 'ok', label: 'Thanks, Ren.' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Ren Oka',
        text: 'I\'ll walk wherever you\'re walking. That\'s new for me. I\'ll count the steps.',
        choices: [{ id: 'ok', label: 'Count them out loud.' }],
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ Wick
  private async talkWick() {
    if (this.s.set('creek.talk.wick')) this.s.addXP(XP_REWARDS.talk, 'Heard Wick');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.wickNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'share' && s.skill('survival') >= 2 && s.set('cave.share')) {
          this.loot([{ id: 'ration', qty: 1 }, { id: 'water', qty: 1 }]);
          this.toast('Wick splits what the ridge allows. It isn\'t a feast. It\'s a count.', 'good');
        }
        if (choice === 'vesper') s.set('cave.wick.vesper');
        if (choice === 'view') s.set('wick.jet');
        if (choice === 'help' && !s.has('cave.pocket') && (s.skill('survival') >= 3 || this.townSocial() >= 3)) {
          s.set('cave.pocket');
          this.clearBlocker('rockfall');
          this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.4 });
          s.addXP(XP_REWARDS.breach, 'Shifted the rockfall');
        }
        if (choice === 'kit' && s.count('medkit') && !s.has('q.doc.kept') && s.removeItem('medkit', 1)) {
          s.set('q.doc.delivered');
          s.set('wick.jet');
        }
        if (choice === 'greet') s.set('q.doc.kept');
        if (choice === 'seep' && s.favours().wickSeep && s.favourReady('wick.seep')) {
          s.useFavour('wick.seep');
          this.loot([{ id: 'water', qty: 1 }]);
        }
        if (choice === 'survey') s.set('wick.survey');
        if (choice === 'burn' && s.has('q.wick.book') && !s.has('q.wick.kept') && s.removeItem('survey_book', 1)) s.set('q.wick.burned');
        if (choice === 'keep' && s.has('q.wick.book') && !s.has('q.wick.burned')) s.set('q.wick.kept');
        if (choice === 'crew') this.joinCrew('wick');
      },
    });
  }

  private wickNode(id: string) {
    const s = this.s;
    const sv = s.skill('survival');
    const soc = this.townSocial();
    if (id === 'hello') {
      const docErrand = s.has('q.doc.kit') && !s.has('q.doc.delivered') && !s.has('q.doc.kept');
      return {
        speaker: 'Wick',
        text: (s.has('q.wick.left')
          ? 'You again. The seep\'s yours too. Don\'t tell anybody, they\'ll want a view.'
          : 'You found the cut. Most people find the highway and call that a life. The fire is mine. The view is nobody\'s, which is why it\'s still here.') + this.news('wick'),
        choices: [
          ...(docErrand ? [
            { id: 'kit', label: 'Doc sent this. From the town. (give a medkit)', disabled: s.count('medkit') ? undefined : 'You don\'t have a medkit any more.', next: 'kitted' },
            { id: 'greet', label: 'Doc says hello. (keep the medkit)', next: 'helloed' },
          ] : []),
          ...(s.favours().wickSeep ? [{ id: 'seep', label: 'Fill a bottle at the seep.', disabled: s.favourReady('wick.seep') ? undefined : 'It\'s still filling. Rest first.', next: 'hello' }] : []),
          ...(s.has('q.wick.book') && !s.has('q.wick.burned') && !s.has('q.wick.kept') ? [{ id: 'book', label: 'I have their field book.', next: 'book' }] : []),
          { id: 'view', label: 'What can you see from up here?', next: 'view' },
          { id: 'share', label: 'I sleep outside too.', disabled: sv >= 2 ? (s.has('cave.share') ? 'He already split it.' : undefined) : 'Requires Survival 2. He can tell you don\'t live on what you carry.', next: 'hello' },
          ...(!s.has('cave.pocket') ? [{ id: 'fall', label: 'The rocks in the side passage.', next: 'fall' }] : []),
          ...(!s.has('wick.survey') ? [{ id: 'survey', label: 'Anything else bothering you?', next: 'survey' }] : []),
          { id: 'vesper', label: 'A woman with rocket money.', disabled: this.needSocial(1, 'He doesn\'t gossip with strangers.'), next: 'vesper' },
          { id: 'pivot', label: 'Where were you, the afternoon of the Pivot?', next: 'pivot' },
          ...this.crewChoice('wick'),
          { id: 'bye', label: 'I\'ll leave the fire.' },
        ],
      };
    }
    if (id === 'pivot') {
      return this.pivotNode('Wick', 'Up here, same as now. I watched the lights go out down the valley in order, west to east, like somebody walking through a house at bedtime. The Garage\'s neon went last. Of course it did. Then a song came up from Dry Creek on somebody\'s radio, and then nothing came up at all.');
    }
    if (id === 'view') {
      return {
        speaker: 'Wick',
        text: 'The highway. The Garage\'s neon, when he remembers to pay for it. And southwest, out in the dunes, a tail fin. A private jet tried to leave the week of the Pivot. The desert said no.',
        choices: [{ id: 'ok', label: 'A jet in the dunes.', next: 'hello' }],
      };
    }
    if (id === 'fall') {
      const can = sv >= 3 || soc >= 3;
      return {
        speaker: 'Wick',
        text: 'Not mine. A charge moves it, if you\'re that kind of person: Demolition 2. Or we shift it by hand, if you\'ve got the back or the patter for it. Some doors are just rocks.',
        choices: [
          { id: 'help', label: 'Help me shift it by hand.', disabled: can ? undefined : 'Requires Survival 3 or Social Engineering 3. He won\'t lift for just anybody.', next: 'shifted' },
          { id: 'ok', label: 'Some doors are just doors.', next: 'hello' },
        ],
      };
    }
    if (id === 'shifted') {
      return {
        speaker: 'Wick',
        text: 'Lift with your legs. Your legs. Not your opinions. ...There. Behind it is her crate. Go see what she thinks she left.',
        choices: [{ id: 'ok', label: 'Dust off.' }],
      };
    }
    if (id === 'kitted') {
      return {
        speaker: 'Wick',
        text: 'From the town. Sure. (He coughs, and uses it.) ...Tell Doc thank you. Don\'t tell him I said it. Here, water from the seep. And look southwest off the edge sometime. There\'s a jet out there.',
        choices: [{ id: 'ok', label: 'I won\'t tell him.' }],
      };
    }
    if (id === 'helloed') {
      return {
        speaker: 'Wick',
        text: 'Hello back. (He coughs for a long time.) Tell him I\'m fine. I\'m always fine.',
        choices: [{ id: 'ok', label: 'Leave him with the cough.' }],
      };
    }
    if (id === 'survey') {
      return {
        speaker: 'Wick',
        text: 'Men in white hats came up the wash with a tripod. Tied orange tape to my ridge, every forty paces, like it was a present. Pull their stakes. Then find out what they think they measured. Their camp is west of the wash. Three tents and a theodolite, and a theodolite is just a camera that thinks it\'s a lawyer.',
        choices: [{ id: 'ok', label: 'Stakes first. Then the camp.', next: 'hello' }],
      };
    }
    if (id === 'book') {
      const stakes = STAKES.every((f) => s.has(f));
      return {
        speaker: 'Wick',
        text: `Point four litres an hour. They measured my seep with a cup. "Resident: one, male, loud." That's fair. "Relocation package: tote bag." That's not. And this, in red. Not flow. Depth. They don't want the water up here. They want what's under the ridge.${stakes ? ' At least the tape\'s gone.' : ' Their tape is still on my slope, by the way.'}`,
        choices: [
          { id: 'burn', label: 'Burn it. Page by page.', next: 'burned' },
          { id: 'keep', label: 'Mara should see this first.', next: 'kept' },
          { id: 'back', label: 'Let me think.', next: 'hello' },
        ],
      };
    }
    if (id === 'burned') {
      return {
        speaker: 'Wick',
        text: 'Page by page. (He reads each one before it goes in.) The seep\'s still mine. They\'ll have to measure it again, and next time I\'ll be sitting on it.',
        choices: [{ id: 'ok', label: 'Save me the cover.' }],
      };
    }
    if (id === 'kept') {
      return {
        speaker: 'Wick',
        text: 'Mara. The water woman. Fine. Take it to her. Tell her the loud resident says the ridge isn\'t for sale, and neither is what\'s under it.',
        choices: [{ id: 'ok', label: 'I\'ll tell her exactly that.' }],
      };
    }
    if (id === 'vesper') {
      return {
        speaker: 'Wick',
        text: 'She stood where you\'re standing. Said the Garage was a prototype with bad unit economics. I said the prototype has my cousin\'s water. She looked at the pocket in the rock, didn\'t buy, and left her initials in paint, like paint is a deed.',
        choices: [{ id: 'ok', label: 'The camp has her name too.', next: 'hello' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Wick',
        text: 'I\'ve been looking at the salt from up here for two years. Might as well walk on it. Yes.',
        choices: [{ id: 'ok', label: 'Bring the view.' }],
      };
    }
    return null;
  }

  openDoor(id: string, snap: boolean) {
    const d = this.doors.find((x) => x.id === id);
    if (!d) return;
    d.target = d.sign;
    if (snap) {
      d.open = d.sign;
      d.pivot.rotation.y = d.sign;
      d.solid = false;
      d.collider.setEnabled(false);
    }
  }

  private clearBlocker(id: string) {
    const b = this.blockers.find((x) => x.id === id);
    if (!b) return;
    b.obj.visible = false;
    b.collider.setEnabled(false);
  }

  update(dt: number, cam?: THREE.Vector3) {
    if (cam) for (const l of this.lods) l.update(cam);
    if (cam) for (const c of this.crowds) c.update(dt, cam);
    if (cam) this.barks.update(dt, cam);
    this.followRoutines(dt);
    const s = this.ctx.state;
    if (s && !this.synced) {
      this.synced = true;
      if (s.has('creek.stair')) this.openDoor('closet', true);
      if (s.has('creek.motel.b')) this.openDoor('motelB', true);
      if (s.has('creek.motel.c')) this.clearBlocker('boards');
      if (s.has('cave.pocket')) this.clearBlocker('rockfall');
    }
    for (const d of this.doors) {
      d.open += (d.target - d.open) * Math.min(1, dt * 7);
      d.pivot.rotation.y = d.open;
      const solid = Math.abs(d.target) < 0.2 && Math.abs(d.open) < 0.35;
      if (solid !== d.solid) { d.solid = solid; d.collider.setEnabled(solid); }
    }
    this.tick(!!s?.has('creek.power'));
  }

  /** Night levels for glows, halos, signs and pools; the clinic follows its generator. */
  private tick(power: boolean) {
    const night = (this.ctx.atmo?.uNight?.value as number | undefined) ?? 0;
    const k = THREE.MathUtils.smoothstep(night, 0.2, 0.45);
    uTownNight.value = k;
    const flick = 0.85 + 0.15 * Math.sin(performance.now() / 180);
    for (const S of this.sites) {
      for (const g of S.nightGlows) g.u.value = g.day + (g.night - g.day) * k;
      const ch = S.halos.channels;
      ch[HALO.ON] = 1;
      ch[HALO.NIGHT] = 0.04 + k * 0.96;
      ch[HALO.POWER] = power ? 0.4 + 0.6 * k : 0;
      ch[HALO.NEON] = 0.25 + 0.75 * k;
      ch[HALO.FIRE] = 1;
    }
    const c = this.creek;
    if (c) {
      c.power.value = (power ? 3.2 : 0.12) * flick;
      c.clinicLight.intensity = power ? 7 * flick : 0;
      c.generatorLed.value = power ? 0.3 : 3;
    }
  }
}
