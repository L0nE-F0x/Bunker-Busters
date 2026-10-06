import * as THREE from 'three/webgpu';
import type { Heightfield } from '@/game/world/Heightfield';
import type { Physics } from '@/engine/physics';
import type { Landmarks } from '@/game/world/Landmarks';
import type { GameContext, Interactable, Action } from '@/game/context';
import { LANDMARKS } from '@/content/world';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import { DistanceLod, Frame } from '@/game/world/kit';
import { Fire } from '@/game/world/effects';
import { NpcCrowd, type NpcDef } from '@/game/world/npc';
import { Site, HALO } from './townKit';
import { buildDryCreek, type Hooks, type CreekLive } from './creek';
import { buildCut } from './cave';
import { buildWash } from './wash';
import { uTownNight } from './townAtlas';

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
  }

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
    root.add(near);
    const signs = S.s.build(name + '-signs');
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
  }

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
    const talk = (id: string, label: string, run: () => void | Promise<void>): Interactable => ({
      id, pos: this.pos(id), radius: 2.05,
      primary: { label, available: () => true, run },
    });

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
      primary: this.circuitAction('generator', 'Clinic generator', 2, 'creek.power', () => {
        this.s.set('creek.power');
        this.ctx.audio.play('unlock');
        this.ctx.ui.banner('GENERATOR', 'The clinic window wakes up. Doc can work.', 'good');
        this.s.addXP(XP_REWARDS.keypadShorted, 'Generator');
      }),
    });
    this.interactables.push({
      id: 'inez', pos: this.pos('inez'), radius: 2.1,
      primary: { label: 'Talk to Inez', available: () => true, run: () => this.talkInez() },
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
      primary: this.pickAction(4, 3, 'CLOSET', () => this.opened('creek.stair', 'closet', 'The closet was a stair. It still is.')),
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
      primary: { label: 'Search the room', available: () => true, run: () => this.take('creek.motel.b.loot', [{ id: 'battery', qty: 1 }, { id: 'scrap', qty: 2 }, { id: 'medkit', qty: 1 }]) },
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
        run: async () => {
          if (!this.s.set('cave.pocket.loot')) return;
          const got = this.loot([{ id: 'water', qty: 1 }, { id: 'battery', qty: 2 }, { id: 'scrap', qty: 2 }]);
          this.s.addXP(40, 'Vesper\'s leftover');
          await this.ctx.ui.choose({
            speaker: 'Paint on the rock',
            text: `V. K. looked. Didn't buy. Under the paint, a crate with her handwriting on the tape: "prototype adjacent." ${got}`,
            choices: [{ id: 'ok', label: 'Leave the view' }],
          });
        },
      },
    });
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

  private async readWash() {
    if (!this.s.set('creek.wash')) return;
    this.s.set('cave.known');
    this.s.addXP(15, 'The wash');
    await this.ctx.ui.choose({
      speaker: 'Board on the shed',
      text: 'North of the spire. Posts. The wash is the only ground that still agrees to be walked. Wick is at the top. He does not come down for coffee.',
      choices: [{ id: 'ok', label: 'Follow the posts.' }],
    });
  }

  private async readGuest() {
    if (!this.s.set('creek.guest')) return;
    this.s.addXP(15, 'Guest book');
    await this.ctx.ui.choose({
      speaker: 'Guest book',
      text: 'Last page, pencil. "Room 2 is three pins if your hands are worth a rank. Room 3 is nails. The ice machine left with the owner. If you can open a closet, the Till has a stair that the sign says is a closet."',
      choices: [{ id: 'ok', label: 'Tear the page out' }],
    });
  }

  private async readLoft() {
    if (!this.s.set('creek.loft')) return;
    this.s.set('cave.known');
    const got = this.loot([{ id: 'battery', qty: 1 }, { id: 'water', qty: 1 }]);
    this.s.addXP(35, 'The stair');
    await this.ctx.ui.choose({
      speaker: 'Page on the shelf',
      text: `Inez's landlord drew a ridge and a cut in it, north, where the ground steps up. "Wick answers the radio with silence. The pocket behind the rocks is not his. A woman with rocket money looked and did not buy." ${got}`,
      choices: [{ id: 'ok', label: 'Fold it into the journal' }],
    });
  }

  private async talkNia() {
    if (this.s.set('creek.talk.nia')) this.s.addXP(XP_REWARDS.talk, 'Heard Nia');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.niaNode(id),
      onChoice: (_n, choice) => {
        if (choice === 'water' && this.s.set('creek.nia.water')) {
          this.loot([{ id: 'water', qty: 1 }]);
          this.toast('Nia slides one bottle. She writes it down.', 'good');
        }
        if (choice === 'ridge' && this.s.set('creek.nia.ridge')) {
          this.s.set('cave.known');
          this.s.addXP(XP_REWARDS.talk, 'The ridge');
        }
        if (choice === 'stair') this.s.set('creek.hint.stair');
      },
    });
  }

  private niaNode(id: string) {
    const soc = this.social();
    if (id === 'hello') {
      return {
        speaker: 'Nia Pell',
        text: 'You have the radio look. Mara\'s, or just thirsty. I cook what shows up. Today that is not much.',
        choices: [
          { id: 'water', label: 'One bottle, for the camp.', disabled: this.s.has('creek.nia.water') ? 'She already wrote you down.' : undefined, next: 'hello' },
          { id: 'who', label: 'Who else is still here?', next: 'who' },
          { id: 'ridge', label: 'Anything north of the highway?', disabled: soc >= 1 ? undefined : 'Requires Social Engineering 1. She doesn\'t give directions to a stranger.', next: 'ridge' },
          { id: 'bye', label: 'Keep the light on.' },
        ],
      };
    }
    if (id === 'who') {
      return {
        speaker: 'Nia Pell',
        text: 'Doc Ivers, if the generator agrees with him. Inez at the Till, who locks rooms she says are empty. Sol at the fire knows which locks are tired. Ren just sits. We are not a town. We are the pause between thirsts.',
        choices: [{ id: 'back', label: 'That\'s a town.', next: 'hello' }],
      };
    }
    if (id === 'ridge') {
      const stair = soc >= 3 ? ' Inez\'s back room has a stair. She says it\'s a closet. Closets don\'t have that many steps.' : '';
      return {
        speaker: 'Nia Pell',
        text: `North of the spire. Someone cut a wash into the ridge and put posts in it. That is the only ground that still agrees to be walked. A man named Wick is at the top and answers the radio with silence.${stair}`,
        choices: [
          ...(soc >= 3 ? [{ id: 'stair', label: 'And the stair?', next: 'hello' }] : []),
          { id: 'ok', label: 'I\'ll know it when I see it.', next: 'hello' },
        ],
      };
    }
    return null;
  }

  private async talkDoc() {
    if (this.s.set('creek.talk.doc')) this.s.addXP(XP_REWARDS.talk, 'Heard Doc');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => {
        if (id !== 'hello') return null;
        const powered = this.s.has('creek.power');
        const soc = this.social();
        return {
          speaker: 'Doc Ivers',
          text: powered
            ? 'Window\'s on. That means I can see what I\'m doing. Don\'t make me grateful out loud.'
            : 'If you are bleeding, the generator has to agree first. It is out the east side. I don\'t speak to it.',
          choices: [
            {
              id: 'heal', label: 'Patch me up.',
              disabled: !powered ? 'The generator is out.' : this.s.has('creek.doc.heal') ? 'He already spent the gauze.' : undefined,
            },
            {
              id: 'list', label: 'You knew Tanner\'s patients.',
              disabled: soc >= 2 ? (this.s.has('creek.doc.list') ? 'You have the list.' : undefined) : 'Requires Social Engineering 2.',
              next: 'hello',
            },
            { id: 'bye', label: 'I\'ll get the generator.' },
          ],
        };
      },
      onChoice: (_n, choice) => {
        if (choice === 'heal' && this.s.has('creek.power') && this.s.set('creek.doc.heal')) {
          const sv = this.s.skill('survival');
          this.s.heal(30 + sv * 6);
          if (sv >= 2) this.loot([{ id: 'medkit', qty: 1 }]);
          this.toast(sv >= 2 ? 'Doc stitches, and he makes you take a kit so you stop visiting.' : 'Doc stitches what he can see. Survival 2 and he would have handed you a kit.', 'good');
        }
        if (choice === 'list' && this.social() >= 2 && this.s.set('creek.doc.list')) {
          this.s.addXP(25, 'Patient list');
          this.toast('Half the names are the camp. He sold them a bunker and shipped shakes. Doc kept the page because nobody else would.', 'info');
        }
      },
    });
  }

  private async talkInez() {
    if (this.s.set('creek.talk.inez')) this.s.addXP(XP_REWARDS.talk, 'Heard Inez');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.inezNode(id),
      onChoice: (_n, choice) => {
        if (choice === 'trade') {
          if (this.s.count('scrap') < 3) return;
          this.s.removeItem('scrap', 3);
          this.loot([{ id: 'water', qty: 1 }]);
          this.toast('Three scrap. One bottle. She does not haggle because haggling is a second conversation.', 'good');
        }
        if (choice === 'open' && this.s.set('creek.stair')) {
          this.openDoor('closet', false);
          this.ctx.audio.play('door');
          this.s.addXP(20, 'Inez opened the closet');
        }
        if (choice === 'stair') this.s.set('creek.hint.stair');
      },
    });
  }

  private inezNode(id: string) {
    const soc = this.social();
    if (id === 'hello') {
      return {
        speaker: 'Inez Quill',
        text: 'The Till is open. The sign about the closet is also open, which is a kind of honesty. Don\'t palm the drawer. I can hear a hand.',
        choices: [
          { id: 'trade', label: 'Three scrap for a bottle.', disabled: soc >= 2 ? (this.s.count('scrap') >= 3 ? undefined : 'Need 3 scrap.') : 'Requires Social Engineering 2.', next: 'hello' },
          { id: 'closet', label: 'The closet.', disabled: soc >= 3 ? undefined : 'Requires Social Engineering 3.', next: 'closet' },
          { id: 'bye', label: 'I\'ll look, not touch.' },
        ],
      };
    }
    if (id === 'closet') {
      return {
        speaker: 'Inez Quill',
        text: this.s.has('creek.stair')
          ? 'You already opened it. Try not to live up there.'
          : 'The landlord\'s stair. I don\'t have a key that I will admit to. A picker at rank 3 gets bored and opens it. Or you can keep talking.',
        choices: [
          { id: 'open', label: 'Admit to the key.', disabled: soc >= 4 ? (this.s.has('creek.stair') ? 'Already open.' : undefined) : 'Requires Social Engineering 4.', next: 'hello' },
          { id: 'stair', label: 'I\'ll come back with a pick.', next: 'hello' },
        ],
      };
    }
    return null;
  }

  private async talkSol() {
    if (this.s.set('creek.talk.sol')) this.s.addXP(XP_REWARDS.talk, 'Heard Sol');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => {
        const soc = this.social();
        if (id === 'locks') {
          return {
            speaker: 'Sol Varga',
            text: 'Left room is open. The guest book in it is worth reading. Middle door is three pins, and only if lockpicking is at least a rank. Right door is nails. A charge, not a conversation. The Till\'s closet is a worse lock: rank 3, or you talk Inez into admitting she has the key.',
            choices: [{ id: 'ok', label: 'I\'ll spend the point on the door I mean.', next: 'hello' }],
          };
        }
        if (id !== 'hello') return null;
        return {
          speaker: 'Sol Varga',
          text: 'Fire\'s communal. The news is not. You want locks, or you want the version where we are all fine.',
          choices: [
            { id: 'locks', label: 'Locks.', disabled: soc >= 1 ? undefined : 'Requires Social Engineering 1.', next: 'locks' },
            { id: 'fine', label: 'The fine version.' },
          ],
        };
      },
      onChoice: (_n, choice) => { if (choice === 'locks') this.s.set('creek.sol.locks'); },
    });
  }

  private async talkRen() {
    if (this.s.set('creek.talk.ren')) this.s.addXP(10, 'Heard Ren');
    const sv = this.s.skill('survival');
    await this.ctx.ui.choose({
      speaker: 'Ren Oka',
      text: 'We are a pause. The highway thinks it\'s a place. It isn\'t. Sit long enough and the wash starts to look like a pantry.',
      choices: [
        { id: 'pantry', label: 'Show me.', disabled: sv >= 2 ? (this.s.has('creek.ren.ration') ? 'You already ate their spare.' : undefined) : 'Requires Survival 2. You don\'t look like you know a pantry from a ditch.' },
        { id: 'sit', label: 'I\'ll sit.' },
      ],
    }).then((id) => {
      if (id === 'pantry' && sv >= 2 && this.s.set('creek.ren.ration')) {
        this.loot([{ id: 'ration', qty: 1 }]);
        this.toast('Ren hands you the ration they were saving for a person who could name the wash.', 'good');
      }
    });
  }

  private async talkWick() {
    if (this.s.set('creek.talk.wick')) this.s.addXP(XP_REWARDS.talk, 'Heard Wick');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.wickNode(id),
      onChoice: (_n, choice) => {
        if (choice === 'share' && this.s.skill('survival') >= 2 && this.s.set('cave.share')) {
          this.loot([{ id: 'ration', qty: 1 }, { id: 'water', qty: 1 }]);
          this.toast('Wick splits what the ridge allows. It is not a feast. It is a count.', 'good');
        }
        if (choice === 'vesper') this.s.set('cave.wick.vesper');
      },
    });
  }

  private wickNode(id: string) {
    const sv = this.s.skill('survival');
    const soc = this.social();
    if (id === 'hello') {
      return {
        speaker: 'Wick',
        text: 'You found the cut. Most people find the highway and call that a life. The fire is mine. The view is nobody\'s, which is why it is still here.',
        choices: [
          { id: 'share', label: 'I sleep outside too.', disabled: sv >= 2 ? (this.s.has('cave.share') ? 'He already split it.' : undefined) : 'Requires Survival 2. He can tell you don\'t live on what you carry.', next: 'hello' },
          { id: 'fall', label: 'The rocks in the side passage.', next: 'fall' },
          { id: 'vesper', label: 'A woman with rocket money.', disabled: soc >= 1 ? undefined : 'Requires Social Engineering 1.', next: 'vesper' },
          { id: 'bye', label: 'I\'ll leave the fire.' },
        ],
      };
    }
    if (id === 'fall') {
      return {
        speaker: 'Wick',
        text: 'Not mine. A charge moves it, if you are that kind of person. Rank two, and something that blows. I don\'t help. I also don\'t stop you. Some doors are just rocks.',
        choices: [{ id: 'ok', label: 'Some doors are just doors.', next: 'hello' }],
      };
    }
    if (id === 'vesper') {
      return {
        speaker: 'Wick',
        text: 'She stood where you are standing. Said the Garage was a prototype with bad numbers. I said the prototype has my cousin\'s water. She didn\'t like that. She looked at the pocket, didn\'t buy, and left her name in paint like a person who thinks paint is a deed.',
        choices: [{ id: 'ok', label: 'The camp has her name too.', next: 'hello' }],
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
