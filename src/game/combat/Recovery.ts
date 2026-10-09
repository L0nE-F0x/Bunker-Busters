import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import type { AudioEngine } from '@/engine/audio';
import type { Heightfield } from '../world/Heightfield';
import type { Interactable } from '../context';
import { HumanCrowd, Ragdoll, BONE, SCOPE_LENS, type HumanLook, type HumanWeapon, type HumanKit, type Human, type HitZone } from './Humans';
import { Debris } from './fx';
import { laserMaterial } from './Machines';
import { Fn, uniform, uv, vec3, vec4, float, exp, abs, length } from 'three/tsl';
import type { HumanSkins } from './humanSkin';
import { buildOutpost, type OutpostBuild, type CoverPoint } from './Outposts';
import { capsuleRay, sphereRay, type Combat, type Hostile, type HostileProvider, type NoiseKind, type RayHit, type Damage } from './Combat';
import { OUTPOSTS, BARKS, BODY_LOOT, KIT_LOOT, type OutpostDef, type CrewRole } from '@/content/recovery';
import { HIGHWAY } from '@/content/world';
import { ITEMS } from '@/content/items';
import { distToPolyline } from '../world/Heightfield';
import { viewCull } from '../world/kit';

/**
 * Kade Recovery: squads that hold the outposts and walk the highway. Each contractor perceives
 * the player (a sight cone that night, dust and crouching shrink; gunshots and sprinting heard),
 * shares what it knows with its squad, and fights from cover: peek, burst, duck, reload, push or
 * flank when you go to ground, and lob a compliance charge at you if you dig in. Losses break the
 * squad's nerve. Bodies are searchable; a cleared outpost stays cleared for a while.
 */

export interface RecoveryHost {
  /** The Meshy contractor bodies (null/absent: draw the procedural ones). */
  skins?: HumanSkins | null;
  physics: Physics;
  hf: Heightfield;
  combat: Combat;
  audio: AudioEngine;
  /** A shouted line (subtitles near enough to hear); `who` picks the crew voice. */
  bark(text: string, from: THREE.Vector3, who: number): void;
  /** Hand the player items; returns the lines to show. */
  give(items: { id: string; qty: number }[]): string[];
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void;
  banner(title: string, sub: string): void;
  xp(n: number, why: string): void;
  owns(id: string): boolean;
  playTime(): number;
  marks: Record<string, number>;
  flag(f: string): boolean;
  has(f: string): boolean;
  interactables: Interactable[];
}

interface NpcGun { dmg: number; interval: number; burst: number; mag: number; spread: number; range: number; pellets: number; reload: number; prefer: number }
const GUNS: Record<HumanWeapon, NpcGun> = {
  rifle: { dmg: 17, interval: 1.1, burst: 2, mag: 7, spread: 0.012, range: 110, pellets: 1, reload: 2.8, prefer: 26 },
  shotgun: { dmg: 6.5, interval: 1.25, burst: 2, mag: 5, spread: 0.065, range: 32, pellets: 8, reload: 3.2, prefer: 10 },
  revolver: { dmg: 12, interval: 0.55, burst: 3, mag: 6, spread: 0.026, range: 45, pellets: 1, reload: 2.4, prefer: 16 },
};
/**
 * The specialists' guns: the marksman's scoped rifle settles each shot (the glint is the tell), the
 * breacher's pump throws a wall of buckshot at walking pace, the grenadier keeps a revolver.
 */
const KIT_GUNS: Record<HumanKit, NpcGun> = {
  marksman: { dmg: 30, interval: 2.7, burst: 1, mag: 5, spread: 0.0035, range: 200, pellets: 1, reload: 3.4, prefer: 55 },
  heavy: { dmg: 5.5, interval: 1.35, burst: 2, mag: 8, spread: 0.07, range: 24, pellets: 9, reload: 3.8, prefer: 7 },
  grenadier: GUNS.revolver,
};
const HP: Record<CrewRole, number> = { guard: 100, patrol: 100, sit: 90, leader: 130 };
/** Extra hit points by kit (the breacher's plates are on top: `ARMOUR`). */
const KIT_HP: Record<HumanKit, number> = { marksman: -10, heavy: 40, grenadier: 0 };
/** What the breacher's front and back plates soak before they crack. */
const ARMOUR = 150;

/**
 * Slot pool: the crowd mesh is built once, so each slot's gun and kit are fixed. Twelve slots of 16
 * bones stay well inside WebGL2's 16 KB uniform block for the bone matrices.
 */
const SLOTS: { weapon: HumanWeapon; kit?: HumanKit }[] = [
  { weapon: 'rifle' }, { weapon: 'rifle' }, { weapon: 'rifle' }, { weapon: 'rifle', kit: 'marksman' },
  { weapon: 'shotgun' }, { weapon: 'shotgun' }, { weapon: 'shotgun' },
  { weapon: 'revolver' }, { weapon: 'revolver' }, { weapon: 'revolver' },
  { weapon: 'shotgun', kit: 'heavy' }, { weapon: 'revolver', kit: 'grenadier' },
];
const SLOT_GUNS: HumanWeapon[] = SLOTS.map((x) => x.weapon);
/** How many contractor bodies exist (the Meshy skins load this many). */
export const CREW_SLOTS = SLOTS.length;
const VESTS = ['#e3b524', '#e66a1e', '#d9c22a', '#e88a1a', '#cfae2e'];
const HELMETS = ['#e8e6df', '#ece9e2', '#dcd9d0', '#f0eee8'];
const UNIFORMS = ['#3c4450', '#3e4238', '#46413a', '#353a44', '#40403e'];

function lookFor(i: number, weapon: HumanWeapon, kit?: HumanKit): HumanLook {
  const r = (k: number) => Math.abs(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1;
  return {
    vest: VESTS[i % VESTS.length],
    uniform: UNIFORMS[(i * 3) % UNIFORMS.length],
    pants: ['#4a4a40', '#3d3a33', '#4e4a42'][i % 3],
    helmet: i === 0 ? '#e05a1a' : HELMETS[i % HELMETS.length],
    boots: '#2a1f18',
    gloves: '#2b2b2b',
    skin: ['#8a6450', '#6a4a38', '#b08870', '#5a3e30'][i % 4],
    build: kit === 'heavy' ? 1.2 : weapon === 'shotgun' ? 1.12 + r(1) * 0.08 : 0.95 + r(2) * 0.1,
    height: 0.95 + r(3) * 0.08,
    weapon,
    pack: !kit && r(4) > 0.6,
    leader: i === 0,
    kit,
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const _sm = new THREE.Vector3(), _sm2 = new THREE.Vector3(), _sm3 = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _from = new THREE.Vector3();
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

type MState = 'idle' | 'suspicious' | 'search' | 'combat' | 'flee' | 'surrender' | 'dead';

class Member implements Hostile {
  readonly kind = 'human' as const;
  /** 'metal' while a round is spending itself on the breacher's plates (Combat reads it for the impact). */
  surface: 'flesh' | 'metal' = 'flesh';
  readonly center = new THREE.Vector3(0, -999, 0);
  radius = 1.3;
  alive = true;
  hp = 100;
  state: MState = 'idle';
  detect = 0;
  canSee = false;
  seeT = 0;
  readonly move = new THREE.Vector3();
  moving = false;
  runSpeed = 4.6;
  cover: CoverPoint | null = null;
  coverT = 0;
  coverDur = 8;
  peek = false;
  peekT = 0;
  fireT = 0;
  burst = 0;
  mag: number;
  reloadT = 0;
  thinkT = Math.random() * 0.2;
  react = 0;
  flank = false;
  patrolI = 0;
  waitT = 0;
  lookT = 0;
  stuckT = 0;
  readonly lastPos = new THREE.Vector3();
  readonly investigate = new THREE.Vector3();
  hitBone: number = BONE.chest;
  looted = false;
  bodyAt = new THREE.Vector3();
  deadT = 0;
  voice = rnd(0.85, 1.15);
  /** Rounds cracking past: 0..1, decays. Makes it duck, and spoils its aim. */
  supp = 0;
  /** A leg wound: hobbling (seconds left). */
  limpT = 0;
  /** Badly hurt: pulling back to cover further from the threat (once). */
  fallback = false;
  /** Laying fire on where you went to ground, so a squadmate can move. */
  suppressing = false;
  /** The killing blow, kept while it dies on its feet (the ragdoll starts from it). */
  lastHit: Damage | null = null;
  readonly gun: NpcGun;
  /** The specialist kit this body wears (from its slot). */
  readonly kit: HumanKit | undefined;
  /** Breacher: what's left of the plates (0: cracked, it fights like anyone else). */
  armour = 0;
  /** Marksman: 0..1 settling the shot (the scope glints brighter), and the glint shown. */
  charge = 0;
  glint = 0;
  /** Marksman: the tower deck it holds (null: on the ground like anyone else). */
  perch: THREE.Vector3 | null = null;
  /** A squadmate saw this body. */
  found = false;
  /** On the radio calling for help (seconds left; killed first, the call never goes out). */
  radioT = 0;
  /** Breacher: has said its line. */
  pushed = false;
  /** Surrendered: seconds on its knees, and the prompt to take its lanyard. */
  surT = 0;
  surIt: Interactable | null = null;
  /** Searching: the side of the last-known position this one sweeps. */
  sector = 0;
  /** Flanking to this cover (taken on arrival). */
  flankCover: CoverPoint | null = null;
  /** Next look round for fallen squadmates. */
  bodyT = Math.random();
  /** Rushing you while you reload (seconds left). */
  rushT = 0;

  constructor(readonly h: Human, public squad: Squad, readonly post: { pos: THREE.Vector3; yaw: number; role: CrewRole; path: THREE.Vector3[] }) {
    this.kit = h.look_.kit;
    this.gun = this.kit ? KIT_GUNS[this.kit] : GUNS[h.weapon];
    this.mag = this.gun.mag;
    this.hp = HP[post.role] + (this.kit ? KIT_HP[this.kit] : 0);
    if (this.kit === 'heavy') this.armour = ARMOUR;
  }

  /** Breacher still behind its plates: walks you down, doesn't hide. */
  get pushing() {
    return this.kit === 'heavy' && this.armour > 0 && !this.fallback;
  }

  /** A body still falling can take another round. */
  shootable() {
    return this.h.active && this.h.dyingT >= 0 && !this.h.ragdoll;
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (!this.h.active || (!this.alive && !this.shootable())) return null;
    const r = this.h.raycast(o, d, max, capsuleRay, sphereRay);
    if (r) {
      // remember which part, for the ragdoll's impulse
      const p = _a.copy(o).addScaledVector(d, r.t);
      let best = Infinity;
      for (const [k, b] of [['pelvis', BONE.hips], ['neck', BONE.head], ['elL', BONE.uArmL], ['elR', BONE.uArmR], ['knL', BONE.thighL], ['knR', BONE.thighR]] as const) {
        const dd = this.h.joints[k].distanceToSquared(p);
        if (dd < best) { best = dd; this.hitBone = b; }
      }
      if (r.zone === 'body') this.hitBone = this.h.chestPos.distanceToSquared(p) < this.h.joints.pelvis.distanceToSquared(p) ? BONE.chest : BONE.hips;
      if (r.zone === 'head') this.hitBone = BONE.head;
    }
    return r;
  }

  /** Which part a hit landed on (from `hitBone`) and which side of the body (+1 its left). */
  zoneOf(d: Damage): { zone: HitZone; side: number } {
    const b = this.hitBone;
    const zone: HitZone = d.source === 'blast' || d.melee ? 'body' : b === BONE.head ? 'head' : b === BONE.uArmL || b === BONE.uArmR ? 'arm' : b === BONE.thighL || b === BONE.thighR ? 'leg' : 'body';
    let side = b === BONE.uArmL || b === BONE.thighL ? 1 : b === BONE.uArmR || b === BONE.thighR ? -1 : 0;
    if (!side) {
      const y = this.h.yaw;
      side = (d.point.x - this.h.pos.x) * Math.cos(y) - (d.point.z - this.h.pos.z) * Math.sin(y) >= 0 ? 1 : -1;
    }
    return { zone, side };
  }

  damage(d: Damage): boolean {
    this.surface = 'flesh';
    if (!this.alive) {
      // still on its feet, dying: another round puts it down now
      if (this.h.dyingT >= 0 && !this.h.ragdoll) { this.lastHit = d; this.squad.owner.fall(this, d); }
      return false;
    }
    const { zone, side } = this.zoneOf(d);
    // the breacher's plates: a body round rings off steel (sparks, a clang) and most of it is soaked
    let plated = false;
    if (this.armour > 0 && zone === 'body' && !d.melee && d.source !== 'blast') {
      plated = true;
      const soak = d.amount * 0.75;
      this.armour -= soak;
      d = { ...d, amount: d.amount - soak };
      this.surface = 'metal';
      if (this.armour <= 0) this.squad.owner.platesGone(this);
    }
    this.hp -= d.amount;
    this.h.flinch.copy(d.dir).setY(0).normalize();
    this.h.flinchK = Math.min(1, (0.5 + d.amount / 40) * (plated ? 0.5 : 1));
    this.h.hit(zone, d.dir, Math.min(1, 0.4 + d.amount / 50) * (plated ? 0.45 : 1), side);
    this.lastHit = d;
    if (this.hp <= 0) {
      this.squad.owner.kill(this, d);
      return true;
    }
    this.squad.owner.hurt(this, d);
    return false;
  }

  unaware() {
    return this.alive && (this.state === 'idle' || this.state === 'surrender' || (this.state === 'suspicious' && this.detect < 0.6));
  }
  facing() {
    return _d.set(Math.sin(this.h.yaw), 0, Math.cos(this.h.yaw));
  }
  awareness() {
    if (!this.alive || !this.h.active || this.state === 'surrender') return 0;
    if (this.state === 'combat') return 1;
    if (this.state === 'search') return 0.7;
    return this.detect;
  }
}

class Squad {
  members: Member[] = [];
  alert: 'calm' | 'suspicious' | 'search' | 'combat' = 'calm';
  readonly known = new THREE.Vector3();
  knownT = -99;
  morale = 1;
  grenadeT = rnd(14, 22);
  flankT = rnd(8, 14);
  combatT = 0;
  searchT = 0;
  hiddenT = 0;
  /** Who's keeping your head down while you're in cover (null: nobody). */
  suppressor: Member | null = null;
  /** Grenadier's next smoke (s). */
  smokeT = rnd(4, 8);
  /** Called for help this fight (or tried). */
  radioed = false;
  /** A body was found: everyone's jumpy for a while (sharper eyes, faster to resolve a shape). */
  wary = 0;
  /** Next chance to rush you while you reload (s). */
  pushT = 0;
  constructor(readonly owner: Recovery, readonly outpost: Outpost | null) {}
  get alive() {
    return this.members.filter((m) => m.alive);
  }
}

export interface Outpost {
  def: OutpostDef;
  build: OutpostBuild;
  squad: Squad | null;
  state: 'dormant' | 'active' | 'cleared';
  lockerOpen: boolean;
  locker: Interactable;
}

/** A thrown compliance charge: red canister, beeping faster, then a blast. */
interface Charge { mesh: THREE.Object3D; body: ReturnType<Physics['world']['createRigidBody']>; fuse: number; beepT: number; light: THREE.Mesh }
/**
 * A smoke canister: lands, pops, and pours a white screen for ~12 s that blocks sight both ways
 * (`Recovery.smoked`); the grenadier throws them to cover a flank, a breacher's walk or a retreat.
 */
interface Smoke { mesh: THREE.Object3D; body: ReturnType<Physics['world']['createRigidBody']> | null; fuse: number; t: number; emitT: number; hissT: number; at: THREE.Vector3; r: number }

export class Recovery implements HostileProvider {
  readonly crowd: HumanCrowd;
  readonly group = new THREE.Group();
  readonly outposts: Outpost[] = [];
  private members: Member[] = [];
  private free: number[] = [];
  private patrol: Squad | null = null;
  private patrolCd = rnd(300, 420);
  /** Places patrols keep away from (the camp, Dry Creek): set by the host. */
  safe: { p: THREE.Vector3; r: number }[] = [];
  private barkT = 0;
  private charges: Charge[] = [];
  private chargePool: { mesh: THREE.Group; light: THREE.Mesh }[] = [];
  private smokes: Smoke[] = [];
  private smokePool: THREE.Group[] = [];
  /** The smoke screens' particles (their own ring, so a firefight's blood and dirt can't eat them). */
  private screen: Debris;
  /** The marksman's scope glint: one additive star, brightest while it settles a shot on you. */
  private glint: THREE.Sprite;
  private glintK = uniform(0);
  /** At night the scope's glint is the marksman's rangefinder instead: a red beam on you (the sentries' material). */
  private beam: THREE.Mesh;
  t = 0;

  constructor(private host: RecoveryHost) {
    this.crowd = new HumanCrowd(SLOTS.map((x, i) => lookFor(i, x.weapon, x.kit)), host.skins ?? null);
    this.free = SLOTS.map((_, i) => i);
    this.group.name = 'recovery';
    this.group.add(this.crowd.mesh);
    if (host.skins) this.group.add(host.skins.group);
    for (const def of OUTPOSTS) {
      const build = buildOutpost(def, host.physics, host.hf);
      this.group.add(build.group);
      const op: Outpost = { def, build, squad: null, state: 'dormant', lockerOpen: false, locker: null as unknown as Interactable };
      op.locker = {
        id: `locker:${def.id}`,
        pos: build.locker.clone(),
        radius: 2.2,
        visible: () => !op.lockerOpen,
        primary: {
          label: 'Open the Kade footlocker',
          available: () => (op.squad && op.squad.alert === 'combat' && op.squad.alive.length ? 'Not with them shooting at you' : true),
          run: () => this.openLocker(op),
        },
      };
      host.interactables.push(op.locker);
      this.outposts.push(op);
    }
    // compliance charges: built now so their shaders compile with the scene
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12), new THREE.MeshStandardNodeMaterial({ color: '#b02a22', roughness: 0.45, metalness: 0.4 }));
      can.castShadow = true;
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(4, 0.3, 0.2) }));
      light.position.y = 0.09;
      g.add(can, light);
      g.visible = false;
      this.group.add(g);
      this.chargePool.push({ mesh: g, light });
    }
    // smoke canisters (olive, a white band) and their screen; the glint. All here before the warm-up.
    const canMat = new THREE.MeshStandardNodeMaterial({ color: '#6d7258', roughness: 0.55, metalness: 0.35 });
    const bandMat = new THREE.MeshStandardNodeMaterial({ color: '#e8e4da', roughness: 0.5 });
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.15, 12), canMat);
      can.castShadow = true;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 12), bandMat);
      band.position.y = 0.04;
      g.add(can, band);
      g.visible = false;
      this.group.add(g);
      this.smokePool.push(g);
    }
    this.screen = new Debris(host.combat.atmo, 160);
    this.screen.sprite.name = 'smoke-screen';
    this.group.add(this.screen.sprite);
    const gm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    gm.fog = false;
    const gk = this.glintK;
    gm.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const r = length(p);
      const core = exp(r.mul(r).mul(-28)).mul(4);
      const halo = exp(r.mul(-4.5)).mul(0.45);
      const streak = exp(abs(p.y).mul(-34)).mul(exp(abs(p.x).mul(-2))).add(exp(abs(p.x).mul(-34)).mul(exp(abs(p.y).mul(-3.2))).mul(0.45));
      const i = core.add(halo).add(streak.mul(1.6)).mul(gk);
      return vec4(vec3(1, 0.94, 0.82).mul(i), float(1));
    })();
    this.glint = new THREE.Sprite(gm);
    this.glint.name = 'scope-glint';
    this.glint.renderOrder = 14;
    this.glint.frustumCulled = false;
    this.glint.visible = false;
    this.group.add(this.glint);
    const bg = new THREE.PlaneGeometry(1, 0.02).translate(0.5, 0, 0).rotateY(-Math.PI / 2);
    this.beam = new THREE.Mesh(bg, laserMaterial());
    const b2 = new THREE.Mesh(bg, laserMaterial());
    b2.rotation.z = Math.PI / 2;
    this.beam.add(b2);
    this.beam.frustumCulled = false;
    b2.frustumCulled = false;
    this.beam.visible = false;
    this.group.add(this.beam);
  }

  hostiles() {
    return this.members;
  }

  /** An outpost respawned (machines rebuild). */
  onRespawn: ((id: string) => void) | null = null;
  /** A road pair just spawned at `at` (Dez calls it on the radio once he's on their channel). */
  onPatrol: ((at: THREE.Vector3) => void) | null = null;
  /** A contractor died here (the vultures find it by day, the coyotes by night). */
  onCorpse: ((at: THREE.Vector3) => void) | null = null;
  /** An outpost's crew spawned (the player came near): re-apply this shift's hacks. */
  onSpawn: ((id: string) => void) | null = null;

  /** How many times this outpost has been restaffed (marks keyed to it reset with each shift). */
  respawnCount(id: string) {
    return this.host.marks[`respawn.${id}`] ?? 0;
  }

  /** The outpost's crew is shooting at someone right now. */
  outpostFighting(id: string) {
    const op = this.outposts.find((o) => o.def.id === id);
    return !!op?.squad && op.squad.alert === 'combat' && op.squad.alive.length > 0;
  }

  /** A sentry or a drone saw you: the outpost's crew hears about it. */
  alertOutpost(id: string, at: THREE.Vector3) {
    const op = this.outposts.find((o) => o.def.id === id);
    if (op?.squad && op.squad.alive.length) this.engage(op.squad, at, 0.5);
  }

  /** The player is near enough for this outpost's machines to run. */
  outpostAwake(id: string, player: THREE.Vector3) {
    const op = this.outposts.find((o) => o.def.id === id);
    return !!op && Math.hypot(player.x - op.def.x, player.z - op.def.z) < 300;
  }

  /** Count of contractors in a fight right now (music, HUD). */
  get fighting() {
    return this.members.filter((m) => m.alive && m.state === 'combat').length;
  }

  // ------------------------------------------------------------------ spawning

  private take(weapon: HumanWeapon, kit?: HumanKit): Human | null {
    // the kit asked for, else a plain body with that gun, else any plain body, else whoever's free
    const prefs = [
      (s: number) => SLOT_GUNS[s] === weapon && SLOTS[s].kit === kit,
      (s: number) => SLOT_GUNS[s] === weapon && !SLOTS[s].kit,
      (s: number) => !SLOTS[s].kit,
      () => true,
    ];
    let i = -1;
    for (const f of prefs) if ((i = this.free.findIndex(f)) >= 0) break;
    if (i < 0) return null;
    const slot = this.free.splice(i, 1)[0];
    const h = this.crowd.people[slot];
    h.active = true;
    h.dead = false;
    h.ragdoll = null;
    h.pose = 'relaxed';
    h.crouch = 0;
    h.vel.set(0, 0, 0);
    h.flinchK = 0;
    h.reloadT = 0;
    h.dyingT = -1;
    h.hitT = 99;
    h.cower = 0;
    h.floor = null;
    return h;
  }

  private release(m: Member) {
    m.h.dyingT = -1;
    m.h.floor = null;
    if (m.flankCover) { m.flankCover.taken = false; m.flankCover = null; }
    m.h.ragdoll?.freeze();
    m.h.ragdoll = null;
    m.h.hide();
    if (m.cover) m.cover.taken = false;
    this.free.push(m.h.slot);
    const i = this.members.indexOf(m);
    if (i >= 0) this.members.splice(i, 1);
    this.dropBody(m);
  }

  /**
   * Twelve bodies for the whole map: before a crew turns out, calm crews well behind you (> 250 m,
   * not fighting) stand down to free theirs (they come back when you do). Without this, walking from
   * one outpost toward two others left the last posts (the specialists) unmanned.
   */
  private makeRoom(n: number, player: THREE.Vector3) {
    if (this.free.length >= n) return;
    const far = this.outposts
      .filter((o) => o.squad && o.state === 'active' && o.squad.alert !== 'combat')
      .map((o) => ({ o, d: Math.hypot(player.x - o.def.x, player.z - o.def.z) }))
      .filter((x) => x.d > 250)
      .sort((a, b) => b.d - a.d);
    for (const { o } of far) {
      if (this.free.length >= n) break;
      this.despawnSquad(o.squad!);
      o.squad = null;
      o.state = 'dormant';
    }
  }

  private spawnOutpost(op: Outpost, player?: THREE.Vector3) {
    if (player) this.makeRoom(op.def.crew.length, player);
    const sq = new Squad(this, op);
    const f = op.build.frame;
    for (const post of op.def.crew) {
      const h = this.take(post.weapon, post.kit);
      if (!h) continue;
      const pos = f.p(post.at[0], 0, post.at[1]);
      pos.y = this.host.hf.heightAt(pos.x, pos.z);
      const yaw = op.def.rot + post.yaw;
      // patrollers walk a loop around the yard
      const path = post.role === 'patrol' ? [0, 1, 2, 3].map((k) => { const a = post.yaw + (k * Math.PI) / 2; const p = f.p(Math.sin(a) * 11, 0, Math.cos(a) * 11); p.y = this.host.hf.heightAt(p.x, p.z); return p; }) : [];
      const m = new Member(h, sq, { pos, yaw, role: post.role, path });
      h.pos.copy(pos);
      h.yaw = h.aimYaw = yaw;
      if (post.role === 'sit') h.crouch = 1;
      // the marksman holds the overwatch tower
      if (m.kit === 'marksman' && op.build.perch) {
        m.perch = op.build.perch.pos.clone();
        h.floor = m.perch.y;
        h.pos.copy(m.perch);
        h.yaw = h.aimYaw = op.build.perch.yaw;
        m.post.yaw = op.build.perch.yaw;
      }
      sq.members.push(m);
      this.members.push(m);
    }
    op.squad = sq;
    op.state = 'active';
    op.lockerOpen = (this.host.marks[`locker.${op.def.id}`] ?? -1) >= this.respawns(op);
    this.onSpawn?.(op.def.id);
  }

  private respawns(op: Outpost) {
    return this.host.marks[`respawn.${op.def.id}`] ?? 0;
  }

  private despawnSquad(sq: Squad) {
    for (const m of [...sq.members]) if (this.members.includes(m)) this.release(m);
    sq.members = [];
  }

  /** A pair walking the highway toward and past you. */
  private spawnPatrol(player: THREE.Vector3) {
    // a point on the road 110–160 m from the player
    let best: THREE.Vector3 | null = null;
    for (let k = 0; k < 20; k++) {
      const i = Math.floor(Math.random() * (HIGHWAY.length - 1));
      const t = Math.random();
      const x = HIGHWAY[i][0] + (HIGHWAY[i + 1][0] - HIGHWAY[i][0]) * t, z = HIGHWAY[i][1] + (HIGHWAY[i + 1][1] - HIGHWAY[i][1]) * t;
      const d = Math.hypot(x - player.x, z - player.z);
      if (d < 110 || d > 170) continue;
      if (this.outposts.some((o) => Math.hypot(o.def.x - x, o.def.z - z) < 140)) continue;
      best = new THREE.Vector3(x, this.host.hf.heightAt(x, z), z);
      break;
    }
    if (!best) return;
    const sq = new Squad(this, null);
    // walk past the player along the road: aim for the far side
    const away = _a.subVectors(player, best).setY(0).normalize();
    const goal = new THREE.Vector3().copy(player).addScaledVector(away, 120);
    goal.y = this.host.hf.heightAt(goal.x, goal.z);
    const weapons: HumanWeapon[] = [pick(['rifle', 'rifle', 'revolver'] as HumanWeapon[]), pick(['shotgun', 'revolver', 'rifle'] as HumanWeapon[])];
    // now and then the second is a specialist: a breacher or a grenadier
    const kit = pick([undefined, undefined, 'heavy', 'grenadier'] as (HumanKit | undefined)[]);
    if (kit) weapons[1] = kit === 'heavy' ? 'shotgun' : 'revolver';
    weapons.forEach((w, i) => {
      const h = this.take(w, i === 1 ? kit : undefined);
      if (!h) return;
      const pos = best!.clone().addScaledVector(_b.set(-away.z, 0, away.x), (i - 0.5) * 2.4).addScaledVector(away, -i * 1.5);
      pos.y = this.host.hf.heightAt(pos.x, pos.z);
      const m = new Member(h, sq, { pos, yaw: Math.atan2(away.x, away.z), role: 'patrol', path: [goal] });
      h.pos.copy(pos);
      h.yaw = h.aimYaw = m.post.yaw;
      sq.members.push(m);
      this.members.push(m);
    });
    if (sq.members.length) {
      this.patrol = sq;
      this.onPatrol?.(best);
    }
  }

  // ------------------------------------------------------------------ deaths, wounds, loot

  kill(m: Member, d: Damage) {
    m.alive = false;
    m.state = 'dead';
    m.hp = 0;
    m.deadT = 0;
    const h = m.h;
    h.dead = true;
    if (m.cover) { m.cover.taken = false; m.cover = null; }
    if (m.flankCover) { m.flankCover.taken = false; m.flankCover = null; }
    m.suppressing = false;
    m.radioT = 0;
    m.charge = m.glint = 0;
    this.dropSurrender(m);
    h.cower = 0;
    this.onCorpse?.(h.pos);
    // How it goes down. A head shot, a close shotgun blast, a blast, a blow or a runner drops at
    // once (ragdoll); otherwise, often, it dies on its feet first: the knees go, it folds over the
    // wound, and then it falls (a takedown slumps the same way, quietly).
    const { zone, side } = m.zoneOf(d);
    const close = h.pos.distanceTo(this.host.combat.target.feet);
    const instant = d.source === 'blast' || (d.melee && !d.takedown) || zone === 'head' || (d.weapon === 'shotgun' && close < 9) || Math.hypot(h.vel.x, h.vel.z) > 3.2;
    if (d.takedown || (!instant && Math.random() < 0.6)) {
      h.dyingT = 0;
      h.dyingDur = d.takedown ? 0.42 : zone === 'leg' ? rnd(0.35, 0.5) : rnd(0.5, 0.85);
      if (!d.takedown) h.hit(zone, d.dir, 1, side);
      m.lastHit = d;
    } else this.fall(m, d);
    const sq = m.squad;
    sq.morale -= m.post.role === 'leader' ? 0.4 : 0.22;
    const live = sq.alive;
    this.host.xp(d.takedown ? 25 : 15, d.takedown ? 'Quiet takedown' : 'Contractor down');
    if (live.length) {
      // a takedown is silent: only a squadmate close enough to see it reacts
      const witness = live.find((o) => o.h.pos.distanceTo(h.pos) < (d.takedown ? 7 : 60));
      if (witness) {
        this.engage(sq, this.host.combat.target.feet, 0.2);
        if (Math.random() < 0.8) this.bark(witness, 'down');
      }
    } else if (sq.outpost) this.cleared(sq.outpost);
  }

  /**
   * Hand a dead contractor to the ragdoll, with a push that sells the shot: a head shot snaps the
   * head and drops the body where it stood, a shotgun up close throws it, a rifle round knocks it
   * back, a leg shot spins it down, a blast launches it, and one dying on its feet pitches forward.
   */
  fall(m: Member, d: Damage) {
    const h = m.h;
    if (h.ragdoll) return;
    const { zone, side } = m.zoneOf(d);
    const close = h.pos.distanceTo(this.host.combat.target.feet);
    const dir = _c.copy(d.dir);
    const more: { bone: number; v: THREE.Vector3 }[] = [];
    let bone = m.hitBone;
    let k: number;
    let lift = 0.25;
    const fwd = _d.set(Math.sin(h.yaw), 0, Math.cos(h.yaw));
    if (d.source === 'blast') { k = 230; lift = 0.6; bone = BONE.chest; more.push({ bone: BONE.hips, v: dir.clone().setY(0.9).normalize().multiplyScalar(90) }); }
    else if (h.dyingT >= 0 && h.dyingT >= h.dyingDur * 0.9) {
      // folded over on its feet: it pitches forward onto its face (or sideways off a bad leg)
      k = 55; lift = 0; bone = BONE.chest;
      dir.copy(fwd).multiplyScalar(0.8).addScaledVector(_b.set(Math.cos(h.yaw), 0, -Math.sin(h.yaw)), zone === 'leg' ? h.hitSide * 0.8 : 0).add(_a.copy(d.dir).setY(0).multiplyScalar(0.3)).normalize();
    } else if (d.takedown) { k = 30; lift = 0; bone = BONE.chest; }
    else if (d.melee) { k = 120; bone = BONE.chest; }
    else if (zone === 'head') {
      // lights out: the head snaps with the round, the body drops where it stood
      k = d.weapon === 'shotgun' ? 70 : d.weapon === 'rifle' ? 45 : 30; lift = 0; bone = BONE.chest;
      more.push({ bone: BONE.head, v: _a.copy(dir).setY(0.1).normalize().multiplyScalar(d.weapon === 'revolver' ? 16 : 22).clone() });
      h.vel.multiplyScalar(0.3);
    } else if (d.weapon === 'shotgun') {
      const kk = THREE.MathUtils.clamp(1.4 - close / 12, 0.45, 1.3);
      k = 200 * kk; lift = 0.35;
      more.push({ bone: BONE.hips, v: dir.clone().setY(0.2).normalize().multiplyScalar(110 * kk) });
    } else if (zone === 'leg') {
      // the leg goes out from under it: kicked back at the knee, the body twists down onto that side
      k = 22; lift = 0;
      more.push({ bone: BONE.chest, v: _b.set(Math.cos(h.yaw), 0, -Math.sin(h.yaw)).multiplyScalar(h.hitSide * 40).addScaledVector(dir, 25).clone() });
    } else {
      k = d.weapon === 'rifle' ? 140 : 90;
      // an arm or a hand: the body takes the round's push (a light part would fly off)
      if (bone !== BONE.chest && bone !== BONE.hips) bone = BONE.chest;
    }
    void side;
    const imp = _a.copy(dir).setY(Math.max(lift, dir.y + lift)).normalize().multiplyScalar(k);
    h.ragdoll = new Ragdoll(this.host.physics, h.mats, h.vel.clone(), imp, bone, more);
    h.dyingT = -1;
    this.host.audio.combat?.voice('bodyfall', h.pos.clone().setY(h.pos.y + 0.3), 1, d.takedown ? 0.6 : 1);
  }

  /** The breacher's plates cracked: it says so, and from now on it fights from cover like the rest. */
  platesGone(m: Member) {
    this.host.audio.combat?.impact('metal', m.h.chestPos, 1.3);
    this.bark(m, 'plates', true);
    m.coverT = 99;
  }

  hurt(m: Member, d: Damage) {
    m.squad.morale -= 0.04;
    m.reloadT = Math.max(0, m.reloadT - 0.2);
    // a hit throws them off: no shot for a moment, and the aim has to settle again
    const { zone } = m.zoneOf(d);
    m.fireT = Math.max(m.fireT, (zone === 'arm' ? 0.75 : 0.4) + Math.random() * 0.3);
    m.seeT = Math.min(m.seeT, 0.25);
    if (zone === 'leg') m.limpT = 7;
    // badly hurt: pull back to cover further off and let the others hold you
    if (!m.fallback && m.hp < HP[m.post.role] * 0.45 && m.state === 'combat' && m.squad.alive.length > 1) {
      m.fallback = true;
      m.coverT = 99;
      m.flank = false;
      this.bark(m, 'hurt');
    }
    // being shot tells you roughly where from
    if (d.source === 'player') this.engage(m.squad, this.host.combat.target.feet, 0.1);
    if (Math.random() < 0.4) this.bark(m, 'hurt');
    // break cover and move
    if (m.cover && Math.random() < 0.5) m.coverT = m.coverDur;
  }

  private dropBody(m: Member) {
    const i = this.host.interactables.findIndex((x) => x.id === `body:${m.h.slot}:${m.deadT}`);
    if (i >= 0) this.host.interactables.splice(i, 1);
  }

  /** Once the ragdoll settles, the body can be searched. */
  private bodyReady(m: Member) {
    const at = m.h.ragdoll ? m.h.ragdoll.where(m.h.mats, new THREE.Vector3()) : m.h.pos.clone();
    m.bodyAt.copy(at);
    const id = `body:${m.h.slot}:${m.deadT}`;
    m.deadT = -1; // marks "interactable exists"
    const it: Interactable = {
      id: `body:${m.h.slot}:-1`,
      pos: at.clone().setY(at.y + 0.2),
      radius: 2,
      visible: () => !m.looted,
      primary: { label: 'Search the contractor', available: () => true, run: () => this.loot(m) },
    };
    void id;
    this.host.interactables.push(it);
  }

  private loot(m: Member) {
    if (m.looted) return;
    m.looted = true;
    const items: { id: string; qty: number }[] = [];
    const ammo = { rifle: 'ammo3030', shotgun: 'shells', revolver: 'ammo38' }[m.h.weapon];
    const n = { rifle: [3, 7], shotgun: [3, 6], revolver: [4, 8] }[m.h.weapon];
    items.push({ id: ammo, qty: Math.round(rnd(n[0], n[1])) });
    // their gun, if you don't have one like it
    const gunItem = m.h.weapon;
    if (!this.host.owns(gunItem)) items.push({ id: gunItem, qty: 1 });
    for (const l of BODY_LOOT) if (Math.random() < l.p) items.push({ id: l.id, qty: Math.round(rnd(l.qty[0], l.qty[1])) });
    if (m.kit) for (const l of KIT_LOOT[m.kit]) if (Math.random() < l.p) items.push({ id: l.id, qty: Math.round(rnd(l.qty[0], l.qty[1])) });
    // one line per item (the gun's rounds and a specialist's spares add up)
    const merged: { id: string; qty: number }[] = [];
    for (const it of items) { const o = merged.find((x) => x.id === it.id); if (o) o.qty += it.qty; else merged.push({ ...it }); }
    const lines = this.host.give(merged);
    this.host.toast(lines.length ? lines.join(' · ') : 'Nothing worth carrying.', lines.length ? 'good' : 'info');
    this.host.audio.play('pickup');
    const i = this.host.interactables.findIndex((x) => x.id === `body:${m.h.slot}:-1`);
    if (i >= 0) this.host.interactables.splice(i, 1);
  }

  private openLocker(op: Outpost) {
    if (op.lockerOpen) return;
    op.lockerOpen = true;
    this.host.marks[`locker.${op.def.id}`] = this.respawns(op);
    const items = op.def.loot.filter((l) => ITEMS[l.id]?.category !== 'weapon' || !this.host.owns(l.id));
    const lines = this.host.give(items);
    this.host.audio.play('loot');
    this.host.toast(lines.length ? lines.join(' · ') : 'Empty, apart from a laminated code of conduct.', 'good');
  }

  private cleared(op: Outpost) {
    op.state = 'cleared';
    this.host.marks[`cleared.${op.def.id}`] = this.host.playTime();
    if (this.host.flag(`outpost.${op.def.id}.cleared`)) {
      this.host.banner('OUTPOST CLEARED', `${op.def.name}. The footlocker's yours, and so is whatever water they were sitting on.`);
      this.host.xp([0, 50, 90, 140][op.def.tier], `Cleared ${op.def.name}`);
    } else this.host.toast(`${op.def.name} cleared again. Kade will send more. Kade always sends more.`, 'good');
  }

  // ------------------------------------------------------------------ under fire

  /** One of your rounds went past (or into cover by) a contractor: it ducks, and its aim suffers. */
  whizz(o: THREE.Vector3, dir: THREE.Vector3, len: number, hit: Hostile | null) {
    for (const m of this.members) {
      if (!m.alive || m === hit || !m.h.active) continue;
      const c = m.h.chestPos;
      const along = THREE.MathUtils.clamp(_a.subVectors(c, o).dot(dir), 0, len);
      if (along < 1.5) continue;
      const miss = _b.copy(o).addScaledVector(dir, along).distanceTo(c);
      if (miss > 2.4) continue;
      m.supp = Math.min(1.3, m.supp + (0.12 + 0.5 * (1 - miss / 2.4)) * (m.pushing ? 0.3 : 1));
      // in cover and peeking: get down
      if (m.state === 'combat' && m.cover && m.peek && m.supp > 0.45) { m.peek = false; m.peekT = rnd(0.9, 1.7); }
    }
  }

  // ------------------------------------------------------------------ hearing

  hear(pos: THREE.Vector3, radius: number, kind: NoiseKind) {
    for (const sq of this.squads()) {
      const live = sq.alive;
      if (!live.length) continue;
      const near = live.some((m) => m.h.pos.distanceTo(pos) < radius);
      if (!near) continue;
      if (sq.alert === 'combat') { if (kind === 'gunshot') { sq.known.copy(this.host.combat.target.feet); sq.knownT = this.t; } continue; }
      if (kind === 'gunshot' || kind === 'explosion') {
        // someone's shooting: go and find them
        const closest = Math.min(...live.map((m) => m.h.pos.distanceTo(pos)));
        if (closest < 45) this.engage(sq, pos, 0.4);
        else this.search(sq, pos);
      } else if (kind === 'can' || kind === 'melee' || kind === 'step') {
        for (const m of live) {
          if (m.state !== 'idle' && m.state !== 'suspicious') continue;
          if (m.h.pos.distanceTo(pos) > radius) continue;
          m.state = 'suspicious';
          m.detect = Math.max(m.detect, kind === 'can' ? 0.5 : 0.35);
          m.investigate.copy(pos);
          m.waitT = 0;
          if (Math.random() < 0.5) this.bark(m, 'suspicious');
        }
      }
    }
  }

  private squads() {
    const out: Squad[] = [];
    for (const o of this.outposts) if (o.squad) out.push(o.squad);
    if (this.patrol) out.push(this.patrol);
    return out;
  }

  /** The squad knows where you are: everyone into the fight (staggered reactions). */
  private engage(sq: Squad, at: THREE.Vector3, delay = 0.6) {
    const fresh = sq.alert !== 'combat';
    sq.alert = 'combat';
    sq.known.copy(at);
    sq.knownT = this.t;
    sq.hiddenT = 0;
    for (const m of sq.alive) {
      if (m.state === 'flee' || m.state === 'surrender') continue;
      if (m.state !== 'combat') {
        m.state = 'combat';
        m.react = delay + rnd(0.1, 0.7) * this.host.combat.diff.react;
        m.coverT = 99; // pick cover now
      }
    }
    if (fresh) {
      const s = sq.alive.sort((a, b) => a.h.pos.distanceTo(at) - b.h.pos.distanceTo(at))[0];
      if (s) this.bark(s, 'spot');
    }
  }

  private search(sq: Squad, at: THREE.Vector3, givingUp = false) {
    if (sq.alert === 'combat' && !givingUp) return;
    sq.alert = 'search';
    sq.searchT = 0;
    sq.known.copy(at);
    sq.knownT = this.t;
    // spread out: the first walks to where you were, the rest fan round it, each its own side
    const live = sq.alive.filter((m) => m.state !== 'flee' && m.state !== 'surrender');
    const base = Math.random() * 6.28;
    live.forEach((m, i) => {
      m.state = 'search';
      m.sector = base + (i * Math.PI * 2) / Math.max(1, live.length);
      m.waitT = 0;
      if (m.perch) return;
      const r = i === 0 ? rnd(0, 2) : rnd(6, 11);
      m.investigate.copy(at).add(_a.set(Math.cos(m.sector) * r, 0, Math.sin(m.sector) * r));
    });
    const s = live.find((m) => m.post.role === 'leader') ?? live[0];
    if (s) this.bark(s, 'search');
  }

  private bark(m: Member, kind: string, force = false) {
    if (this.barkT > 0 && kind !== 'down' && !force) return;
    const lines = BARKS[kind];
    if (!lines) return;
    this.barkT = kind === 'idle' ? 12 : 3;
    const line = pick(lines);
    // a voiced clip carries its own key-up; only a silent line gets the bare squelch
    if (!this.host.audio.speaks('Kade Recovery', line, m.h.slot)) this.host.audio.combat?.voice('squelch', m.h.headPos, m.voice, kind === 'idle' ? 0.5 : 1);
    this.host.bark(line, m.h.headPos, m.h.slot);
  }

  // ------------------------------------------------------------------ the frame

  /** A new run (or back to the title): everyone stands down and goes home. */
  reset() {
    for (const sq of this.squads()) this.despawnSquad(sq);
    for (const op of this.outposts) { op.squad = null; op.state = 'dormant'; op.lockerOpen = false; }
    this.patrol = null;
    this.patrolCd = rnd(300, 420);
    for (const c of this.charges) { this.host.physics.world.removeRigidBody(c.body); c.mesh.visible = false; }
    this.charges = [];
    for (const k of this.smokes) { if (k.body) this.host.physics.world.removeRigidBody(k.body); k.mesh.visible = false; }
    this.smokes = [];
    this.glint.visible = false;
  }

  update(dt: number, player: THREE.Vector3, cam: THREE.Vector3, playing = true) {
    this.t += dt;
    this.barkT = Math.max(0, this.barkT - dt);
    const host = this.host;
    if (!playing) {
      for (const op of this.outposts) op.build.lod.update(cam);
      this.crowd.update(dt, host.hf, host.combat.target?.eye);
      return;
    }
    // outposts: wake up near, sleep far, respawn long after a clear
    for (const op of this.outposts) {
      const d = Math.hypot(player.x - op.def.x, player.z - op.def.z);
      op.build.lod.update(cam);
      const night = host.combat.target.night > 0.5;
      op.build.light.intensity = night && op.state !== 'cleared' ? 35 : 0;
      op.build.nightGlow.value = night && op.state !== 'cleared' ? 6 : 0.1;
      op.build.fire.group.visible = (night || op.state === 'active') && op.state !== 'cleared' && Math.hypot(cam.x - op.def.x, cam.z - op.def.z) < 160;
      if (op.build.fire.group.visible) op.build.fire.update(dt, cam);
      op.build.fire.light.intensity = op.build.fire.group.visible ? 12 : 0;
      if (op.state === 'dormant' && d < 240) {
        const clearedAt = host.marks[`cleared.${op.def.id}`];
        if (clearedAt != null && host.playTime() - clearedAt < 30 * 60) { op.state = 'cleared'; this.onSpawn?.(op.def.id); continue; }
        this.spawnOutpost(op, player);
      } else if (op.state === 'active' && d > 330 && op.squad && op.squad.alert !== 'combat') {
        this.despawnSquad(op.squad);
        op.squad = null;
        op.state = 'dormant';
      } else if (op.state === 'cleared') {
        const clearedAt = host.marks[`cleared.${op.def.id}`] ?? 0;
        if (op.squad && d > 300) { this.despawnSquad(op.squad); op.squad = null; }
        if (host.playTime() - clearedAt > 30 * 60 && d > 300) {
          op.state = 'dormant';
          host.marks[`respawn.${op.def.id}`] = this.respawns(op) + 1;
          this.onRespawn?.(op.def.id);
        }
      }
    }
    // the road patrol
    if (this.patrol) {
      const live = this.patrol.alive;
      const far = this.patrol.members.every((m) => m.h.pos.distanceTo(player) > 260);
      if ((far && this.patrol.alert !== 'combat') || (!live.length && far)) {
        this.despawnSquad(this.patrol);
        this.patrol = null;
        this.patrolCd = rnd(180, 360);
      }
    } else {
      this.patrolCd -= dt;
      if (this.patrolCd <= 0 && !host.combat.target.hidden) {
        this.patrolCd = 20;
        const road = distToPolyline(player.x, player.z, HIGHWAY).d;
        const nearSafe = this.safe.some((z) => Math.hypot(z.p.x - player.x, z.p.z - player.z) < z.r + 150);
        if (road < 150 && !nearSafe && this.outposts.every((o) => Math.hypot(o.def.x - player.x, o.def.z - player.z) > 130)) this.spawnPatrol(player);
      }
    }
    // members
    for (const sq of this.squads()) this.squadTick(sq, dt);
    for (const m of [...this.members]) this.tick(m, dt);
    this.updateCharges(dt);
    this.updateSmokes(dt);
    this.screen.update(dt);
    this.crowd.update(dt, host.hf, host.combat.target?.eye);
    this.updateGlint(cam);
  }

  private squadTick(sq: Squad, dt: number) {
    const live = sq.alive;
    if (!live.length) return;
    sq.wary = Math.max(0, sq.wary - dt);
    if (sq.alert === 'combat') {
      sq.combatT += dt;
      sq.grenadeT -= dt;
      sq.flankT -= dt;
      sq.smokeT -= dt;
      // somebody gets on the radio for help (the leader, if it's standing): kill the caller before it
      // finishes and the call never goes out
      if (!sq.radioed && sq.combatT > 3.5 && live.length >= 2 && this.t - sq.knownT < 4) {
        sq.radioed = true;
        const caller = live.find((x) => x.post.role === 'leader' && x.state === 'combat') ?? live.find((x) => x.state === 'combat' && !x.flank && !x.suppressing && !x.perch && !x.pushing);
        if (caller) { caller.radioT = 2.8; this.bark(caller, 'radio', true); }
      }
      // the grenadier screens a move: someone flanking, the breacher walking up, the hurt or the
      // broken pulling back. The smoke lands between them and you, nearer them.
      const gren = live.find((x) => x.kit === 'grenadier' && (x.state === 'combat' || x.state === 'flee') && x.reloadT <= 0 && x.radioT <= 0);
      if (gren && sq.smokeT <= 0 && this.smokes.length < 2) {
        const movers = live.filter((x) => x.flank || x.pushing || x.state === 'flee' || (x.fallback && !x.cover));
        const dg = gren.h.pos.distanceTo(sq.known);
        if (movers.length && dg > 7 && dg < 36) {
          sq.smokeT = rnd(20, 30);
          const c = _a.set(0, 0, 0);
          for (const x of movers) c.add(x.h.pos);
          c.divideScalar(movers.length).lerp(sq.known, 0.45);
          // never on top of you: a screen, not a blindfold
          const off = _b.subVectors(c, sq.known).setY(0);
          if (off.length() < 8) c.copy(sq.known).addScaledVector(off.lengthSq() > 0.01 ? off.normalize() : _b.subVectors(gren.h.pos, sq.known).setY(0).normalize(), 8);
          c.y = this.host.hf.heightAt(c.x, c.z);
          this.throwSmoke(gren, c.clone());
        }
      }
      const seen = live.some((m) => m.canSee);
      sq.hiddenT = seen ? 0 : sq.hiddenT + dt;
      // you've gone to ground: one of them keeps your head down while the others move
      const sup = sq.suppressor;
      if (sup && (!sup.alive || sup.state !== 'combat' || seen || this.t - sq.knownT > 9 || sup.flank)) { sup.suppressing = false; sq.suppressor = null; }
      if (!sq.suppressor && !seen && sq.hiddenT > 1.4 && this.t - sq.knownT < 6 && live.length >= 2) {
        const m = live.filter((x) => x.state === 'combat' && !x.flank && !x.fallback && x.reloadT <= 0 && x.mag > 1 && x.h.pos.distanceTo(sq.known) < x.gun.range * 0.9)
          .sort((a, b) => a.h.pos.distanceTo(sq.known) - b.h.pos.distanceTo(sq.known))[0];
        if (m) { sq.suppressor = m; m.suppressing = true; }
      }
      // lost you: search, then stand down. (search() ignores a squad in combat, so this has to say it's
      // giving up: without it a crew that lost you stayed in the fight forever, never despawned, and
      // walked to wherever it last had you, however far)
      if (this.t - sq.knownT > 14 && !seen) {
        if (sq.suppressor) { sq.suppressor.suppressing = false; sq.suppressor = null; }
        for (const m of live) {
          m.flank = false;
          m.fallback = false;
          if (m.cover) { m.cover.taken = false; m.cover = null; }
        }
        this.search(sq, sq.known, true);
        return;
      }
      // you're feeding rounds in where they can see it: the closest short gun rushes you, with a
      // shout that's also your warning
      sq.pushT -= dt;
      const T0 = this.host.combat.target;
      if (T0.reloading && sq.pushT <= 0 && live.some((x) => x.canSee)) {
        const m = live.filter((x) => x.state === 'combat' && x.canSee && !x.perch && !x.flank && !x.pushing && x.radioT <= 0 && x.reloadT <= 0 && x.gun.prefer <= 16 && !x.fallback && x.h.pos.distanceTo(T0.feet) < 30)
          .sort((a, b) => a.h.pos.distanceTo(T0.feet) - b.h.pos.distanceTo(T0.feet))[0];
        if (m) {
          sq.pushT = rnd(9, 14);
          const off = _a.subVectors(m.h.pos, T0.feet).setY(0).normalize().multiplyScalar(m.gun.prefer * 0.45);
          m.move.copy(T0.feet).add(off);
          m.move.y = this.host.hf.heightAt(m.move.x, m.move.z);
          if (m.cover) { m.cover.taken = false; m.cover = null; }
          m.rushT = 3.5;
          this.bark(m, 'push', true);
        }
      }
      // nerve breaks
      if (sq.morale < 0.25 && live.length <= 2) {
        for (const m of live) {
          if (m.state === 'flee' || m.state === 'surrender' || m.perch) continue;
          // close to you, it gives up; further off, it runs (and the smoke covers it)
          if (m.h.pos.distanceTo(this.host.combat.target.feet) < 18 && Math.random() < 0.7) this.surrender(m);
          else { m.state = 'flee'; this.bark(m, 'flee'); sq.smokeT = Math.min(sq.smokeT, 0); }
        }
      }
      // send someone round when you've gone to ground
      if (sq.flankT <= 0 && sq.hiddenT > 3 && live.length >= 2) {
        sq.flankT = rnd(10, 16);
        const m = live.filter((x) => x.state === 'combat' && x.reloadT <= 0 && !x.suppressing && !x.fallback && !x.perch && !x.pushing && x.radioT <= 0).sort(() => Math.random() - 0.5)[0];
        if (m) {
          const side = Math.random() < 0.5 ? 1 : -1;
          // round the side to one of the outpost's walls or crates that faces you, else open ground out there
          const from = _a.subVectors(m.h.pos, sq.known).setY(0).normalize();
          let best: CoverPoint | null = null, bs = Infinity;
          if (sq.outpost) for (const c of sq.outpost.build.cover) {
            if (c.taken) continue;
            const v = _b.subVectors(c.pos, sq.known).setY(0);
            const dk = v.length();
            if (dk < 5 || dk > 22) continue;
            v.divideScalar(dk);
            const ang = Math.acos(THREE.MathUtils.clamp(v.dot(from), -1, 1));
            if (ang < 0.7 || ang > 2.3) continue;
            if (_c.copy(v).negate().dot(c.out) < 0.2) continue;
            const sc = Math.abs(ang - 1.4) * 4 + Math.abs(dk - 11) * 0.3 + c.pos.distanceTo(m.h.pos) * 0.1 + Math.random();
            if (sc < bs) { bs = sc; best = c; }
          }
          if (m.cover) { m.cover.taken = false; m.cover = null; }
          if (best) {
            const c = best as CoverPoint;
            m.move.copy(c.pos);
            c.taken = true;
            m.flankCover = c;
          } else {
            const dir = from.applyAxisAngle(UP, side * 1.4);
            m.move.copy(sq.known).addScaledVector(dir, rnd(8, 13));
            m.move.y = this.host.hf.heightAt(m.move.x, m.move.z);
          }
          m.flank = true;
          m.coverT = 0;
          this.bark(m, 'flank');
        }
      }
      // compliance charge
      const t = this.host.combat.target;
      const dk = sq.known.distanceTo(live[0].h.pos);
      if (sq.grenadeT <= 0 && sq.hiddenT > 2 && dk < 28 && t.alive && this.charges.length < 1) {
        // the grenadier throws more often, and gets first pick
        sq.grenadeT = live.some((m) => m.kit === 'grenadier') ? rnd(11, 17) : rnd(18, 28);
        const thrower = live.filter((m) => m.state === 'combat' && !m.perch && m.radioT <= 0 && m.h.pos.distanceTo(sq.known) > 6 && m.h.pos.distanceTo(sq.known) < 26)
          .sort((a, b) => (b.kit === 'grenadier' ? 1 : 0) - (a.kit === 'grenadier' ? 1 : 0))[0];
        if (thrower) this.throwCharge(thrower, sq.known);
      }
    } else if (sq.alert === 'search') {
      sq.searchT += dt;
      if (sq.searchT > 22) {
        sq.alert = 'calm';
        sq.morale = Math.min(1, sq.morale + 0.3);
        for (const m of live) if (m.state !== 'surrender' && m.state !== 'flee') { m.state = 'idle'; m.detect = 0; }
        this.bark(live[0], 'lost');
      }
    }
  }

  // ------------------------------------------------------------------ one contractor

  private tick(m: Member, dt: number) {
    const h = m.h;
    if (!m.alive) {
      // dying on its feet: it sags where it stands (a runner's momentum bleeds off), then falls
      if (h.dyingT >= 0 && !h.ragdoll) {
        h.vel.multiplyScalar(Math.exp(-dt * 6));
        _from.copy(h.pos);
        h.pos.addScaledVector(h.vel, dt);
        this.host.combat.slide(_from, h.pos, 0.35, 0.5);
        if (h.dyingT >= h.dyingDur && m.lastHit) this.fall(m, m.lastHit);
      }
      if (m.deadT >= 0) { m.deadT += dt; if (h.ragdoll?.frozen || m.deadT > 6) this.bodyReady(m); }
      m.center.copy(h.chestPos);
      return;
    }
    const host = this.host;
    const T = host.combat.target;
    const diff = host.combat.diff;
    m.center.copy(h.chestPos);
    m.fireT = Math.max(0, m.fireT - dt);
    m.react = Math.max(0, m.react - dt);
    m.supp = Math.max(0, m.supp - dt * 0.45);
    m.limpT = Math.max(0, m.limpT - dt);
    m.runSpeed = m.limpT > 0 ? 2.4 : 4.6;
    h.cower = 0;

    // ---- perception (staggered)
    m.thinkT -= dt;
    if (m.thinkT <= 0) {
      m.thinkT = 0.15 + Math.random() * 0.06;
      m.canSee = this.sees(m);
      // a squadmate lying in the dirt: that's the alarm, whether or not anyone heard a thing
      if ((m.state === 'idle' || m.state === 'suspicious') && (m.bodyT -= 0.18) <= 0) {
        m.bodyT = 0.6;
        const b = this.spotBody(m);
        if (b) this.bodyFound(m, b);
      }
    }
    if (m.canSee) m.seeT += dt; else m.seeT = 0;
    const sq = m.squad;
    if (m.canSee && m.state === 'combat') { sq.known.copy(T.feet); sq.knownT = this.t; }
    if (m.state === 'idle' || m.state === 'suspicious' || m.state === 'search') {
      if (m.canSee) {
        const dist = h.eye.distanceTo(T.chest);
        const close = Math.max(0, 1 - dist / 70);
        const moving = Math.min(1.5, Math.hypot(T.velocity.x, T.velocity.z) / 3.4);
        // a shape in the dark takes longer to resolve into a person than one stood in the light
        const lit = T.night > 0.5 && !T.torch ? 0.55 + 0.45 * T.light : 1;
        const rate = (0.25 + close * 1.8) * (0.6 + T.noise * 0.4) * (0.7 + moving * 0.4) * lit * (m.state === 'search' ? 2.2 : 1) * (sq.wary > 0 ? 1.6 : 1) / diff.react;
        m.detect = Math.min(1, m.detect + rate * dt);
        if (m.detect >= 1) this.engage(sq, T.feet, 0.25);
        else if (m.detect > 0.35 && m.state === 'idle') {
          m.state = 'suspicious';
          m.investigate.copy(T.feet);
          m.waitT = 0;
          this.bark(m, 'suspicious');
        }
        if (m.state === 'suspicious') m.investigate.copy(T.feet);
      } else m.detect = Math.max(0, m.detect - dt * 0.12);
    }

    let speed = 0;
    let face: number | null = null;
    h.pose = 'relaxed';
    h.crouch = 0;
    // the marksman's scope catches the sun as it sweeps (a hint, long before it's settling on you)
    if (m.kit === 'marksman' && m.state !== 'combat') m.glint = m.state === 'idle' ? 0.08 : m.state === 'surrender' || m.state === 'flee' ? 0 : 0.16;
    switch (m.state) {
      case 'idle': {
        const post = m.post;
        if (m.perch) {
          // the tower: glassing the approaches, slow sweeps either side of its post
          h.vel.set(0, 0, 0);
          h.pos.copy(m.perch);
          h.pose = 'ready';
          face = post.yaw + Math.sin(this.t * 0.21 + h.slot) * 0.95;
          h.look = 0;
          break;
        }
        if (post.role === 'patrol' && post.path.length) {
          const goal = post.path[m.patrolI % post.path.length];
          if (m.waitT > 0) { m.waitT -= dt; }
          else if (this.walkTo(m, goal, 1.5, dt)) {
            if (sq.outpost) { m.patrolI++; m.waitT = rnd(2, 5); }
          } else speed = 1.5;
        } else {
          this.walkTo(m, post.pos, 1.4, dt);
          if (m.lastPos.distanceTo(post.pos) < 0.6) face = post.yaw;
          if (post.role === 'sit') h.crouch = 1;
          if (post.role === 'leader' && Math.sin(this.t * 0.2 + h.slot) > 0.8) h.pose = 'radio';
        }
        // look around; the odd line of chatter when you're close enough to overhear
        m.lookT -= dt;
        if (m.lookT <= 0) { m.lookT = rnd(1.5, 4); h.look = rnd(-0.9, 0.9); }
        if (T.feet.distanceTo(h.pos) < 26 && Math.random() < dt * 0.04) this.bark(m, 'idle');
        const tooNear = !sq.outpost && this.safe.some((z) => Math.hypot(z.p.x - h.pos.x, z.p.z - h.pos.z) < z.r + 40);
        if (!sq.outpost && m.post.path.length && (h.pos.distanceTo(m.post.path[0]) < 3 || tooNear)) {
          // patrol reached the far end: turn round
          const back = _a.subVectors(h.pos, m.post.path[0]).setY(0).normalize().multiplyScalar(220).add(h.pos);
          back.y = this.host.hf.heightAt(back.x, back.z);
          m.post.path[0] = back;
        }
        break;
      }
      case 'suspicious': {
        h.pose = 'ready';
        h.look = 0;
        m.waitT += dt;
        // look at it, then walk over if it keeps bothering you
        const to = _a.subVectors(m.investigate, h.pos);
        face = Math.atan2(to.x, to.z);
        if (m.waitT > 1.5 && to.length() > 2.5 && !m.perch) { if (!this.walkTo(m, m.investigate, 1.7, dt)) speed = 1.7; }
        if (m.waitT > 10 && m.detect < 0.3) { m.state = 'idle'; m.detect = 0; }
        break;
      }
      case 'search': {
        h.pose = 'ready';
        if (m.perch) {
          // overwatch for the search: sweeping round where you were last seen
          const to = _a.subVectors(sq.known, h.pos);
          face = Math.atan2(to.x, to.z) + Math.sin(this.t * 0.5 + h.slot) * 0.7;
          break;
        }
        if (this.walkTo(m, m.investigate, 2.2, dt)) {
          m.waitT -= dt;
          if (m.waitT <= 0) {
            m.waitT = rnd(1.5, 3);
            // its own side of the last-known position, a bit further out each time
            const a = m.sector + rnd(-0.9, 0.9);
            const r = Math.min(16, rnd(4, 9) + sq.searchT * 0.3);
            m.investigate.copy(sq.known).add(_a.set(Math.cos(a) * r, 0, Math.sin(a) * r));
          }
          face = h.yaw + Math.sin(this.t * 0.8 + h.slot) * 1.2;
        } else speed = 2.2;
        break;
      }
      case 'combat':
        this.fight(m, dt);
        return;
      case 'flee': {
        h.pose = 'ready';
        const away = _a.subVectors(h.pos, T.feet).setY(0).normalize().multiplyScalar(30).add(h.pos);
        away.y = this.host.hf.heightAt(away.x, away.z);
        this.walkTo(m, away, 5.2, dt);
        // run down: it gives up
        if (h.pos.distanceTo(T.feet) < 7 && T.alive && m.surT === 0) { this.surrender(m); return; }
        if (h.pos.distanceTo(T.feet) > 90 && !m.canSee) {
          // they ran far enough: gone
          this.rout(m);
        }
        return;
      }
      case 'surrender': {
        // on its knees, hands up, watching you; you walk off (or it waits long enough) and it runs
        h.pose = 'surrender';
        h.crouch = 0.62;
        h.vel.multiplyScalar(Math.exp(-dt * 8));
        const to = _a.subVectors(T.feet, h.pos);
        face = Math.atan2(to.x, to.z);
        h.aimYaw = h.yaw;
        h.aimPitch = 0;
        m.surT += dt;
        if (to.length() > 30 || m.surT > 45 || !T.alive) { this.dropSurrender(m); m.state = 'flee'; }
        break;
      }
    }
    void speed;
    if (face !== null) h.yaw += angDiff(h.yaw, face) * Math.min(1, dt * 3);
    h.aimYaw = h.yaw + (m.state === 'idle' ? h.look * 0.4 : 0);
    h.aimPitch = 0;
  }

  /** The fight itself: cover, peeking, shooting, reloading, flanking. */
  private fight(m: Member, dt: number) {
    const h = m.h;
    const sq = m.squad;
    const T = this.host.combat.target;
    const diff = this.host.combat.diff;
    const known = sq.known;
    const toK = _a.subVectors(known, h.pos);
    const dist = toK.length();
    const g = m.gun;
    // aim at you (or where you were)
    const aimAt = m.canSee ? T.chest : _b.copy(known).setY(known.y + 1.1);
    const toA = _c.subVectors(aimAt, h.eye);
    const aimYaw = Math.atan2(toA.x, toA.z);
    const aimPitch = Math.atan2(toA.y, Math.hypot(toA.x, toA.z));
    h.aimYaw += angDiff(h.aimYaw, aimYaw) * Math.min(1, dt * 9);
    h.aimPitch += (aimPitch - h.aimPitch) * Math.min(1, dt * 9);
    if (m.perch) { h.pos.copy(m.perch); h.vel.set(0, 0, 0); }

    // on the radio: the gun one-handed, a hand at the mic, nobody shooting
    if (m.radioT > 0) {
      m.radioT -= dt;
      h.pose = 'radio';
      h.crouch = m.cover ? 1 : 0.4;
      h.vel.multiplyScalar(Math.exp(-dt * 8));
      if (m.radioT <= 0) this.callHelp(sq, m);
      return;
    }

    // reloading: duck and do it
    if (m.reloadT > 0) {
      m.reloadT -= dt;
      h.pose = 'reload';
      h.crouch = m.cover ? 1 : 0.6;
      h.vel.set(0, 0, 0);
      if (m.reloadT <= 0) { m.mag = g.mag; h.pose = 'ready'; }
      return;
    }
    if (m.mag <= 0) {
      m.reloadT = g.reload;
      h.reloadT = g.reload;
      if (Math.random() < 0.6) this.bark(m, 'reload');
      return;
    }

    // ---- where to be
    m.coverT += dt;
    let moving = false;
    if (m.perch) {
      // up to shoot over the parapet; down behind it when rounds crack past
      h.crouch = m.supp > 0.7 ? 1 : 0;
    } else if (m.rushT > 0) {
      // rushing you while you reload: straight in to its own short range, firing as it comes
      m.rushT -= dt;
      moving = !this.walkTo(m, m.move, m.runSpeed, dt, true);
      if (!moving) m.rushT = 0;
    } else if (m.pushing) {
      // the breacher walks you down: no cover, straight at you, shooting as it comes
      if (m.cover) { m.cover.taken = false; m.cover = null; }
      if (!m.pushed) { m.pushed = true; this.bark(m, 'breach', true); }
      if (dist > 7) moving = !this.walkTo(m, known, m.limpT > 0 ? 1.5 : 2.3, dt, true);
      else h.vel.set(0, 0, 0);
    } else if (m.flank) {
      const arrived = this.walkTo(m, m.move, m.runSpeed, dt, true);
      moving = !arrived;
      if (arrived || m.canSee) {
        m.flank = false;
        m.coverT = 99;
        // made it to the cover it was going for: hold it
        if (m.flankCover && arrived) { m.cover = m.flankCover; m.coverT = 0; m.coverDur = rnd(7, 12); m.peek = true; m.peekT = rnd(1.2, 2); }
        else if (m.flankCover) m.flankCover.taken = false;
        m.flankCover = null;
      }
    } else {
      if (!m.cover || m.coverT > m.coverDur || (m.canSee && dist < 5 && g.prefer > 12)) {
        this.pickCover(m, known);
        m.coverT = 0;
        m.coverDur = rnd(7, 12);
      }
      if (m.cover) {
        const arrived = this.walkTo(m, m.cover.pos, m.runSpeed, dt, true);
        moving = !arrived;
        if (arrived) {
          // peek and shoot, then duck
          m.peekT -= dt;
          if (m.peekT <= 0) { m.peek = !m.peek; m.peekT = m.peek ? rnd(1.6, 3.2) : rnd(0.8, 1.8); }
          // pinned: rounds cracking past keep it down; the one laying down fire stays up
          if (m.supp > 0.8 && m.peek && !m.suppressing) { m.peek = false; m.peekT = rnd(0.6, 1.2); }
          if (m.suppressing && m.supp < 0.6) m.peek = true;
          h.crouch = m.peek ? (m.cover.h > 0.9 ? 0 : 0.35) : 1;
          // nothing to shoot from here for a while: push up
          if (m.peek && !m.canSee && m.peekT < 0.2 && T.alive) m.coverT += 2.5;
        }
      } else {
        // open ground: hold at the preferred range, kneel to shoot
        const want = m.fallback ? g.prefer + 12 : g.prefer;
        if (Math.abs(dist - want) > 4) {
          const goal = _d.copy(known).addScaledVector(toK.normalize(), -want);
          goal.y = this.host.hf.heightAt(goal.x, goal.z);
          moving = !this.walkTo(m, goal, m.runSpeed * 0.8, dt, true);
        } else { h.vel.set(0, 0, 0); h.crouch = 0.55; }
      }
    }
    // under fire in the open (or caught standing), it flinches down
    if (m.supp > 0.3 && !moving && !m.suppressing && !m.pushing && !m.perch) h.cower = Math.min(1, (m.supp - 0.3) * 1.6);
    h.pose = m.canSee || !moving || m.suppressing ? 'aim' : 'ready';
    if (!moving) h.yaw += angDiff(h.yaw, h.aimYaw) * Math.min(1, dt * 6);

    // ---- shooting
    const crouchedHidden = m.cover && !m.peek && !moving && m.cover.h > 0.6;
    const pinned = m.supp > 0.85 && !m.suppressing;
    if (m.kit === 'marksman') { this.snipe(m, dt, dist, !!crouchedHidden || pinned); return; }
    if (m.canSee && !crouchedHidden && !pinned && m.react <= 0 && m.fireT <= 0 && dist < g.range && T.alive) {
      // the first shots go wide; the longer they watch you, the tighter it gets
      const settle = 1 + 2.6 * Math.exp(-m.seeT / 1.3);
      const run = Math.hypot(T.velocity.x, T.velocity.z) > 4.5 ? 1.6 : 1;
      const dark = T.night > 0.5 && !T.torch ? 1.5 - 0.5 * T.light : 1;
      const onMove = moving ? (m.pushing ? 1.15 : 2.2) : 1;
      const crouchK = T.crouch ? 0.9 : 1;
      // rounds cracking past them spoil it
      const shaken = 1 + Math.min(1, m.supp) * 1.8;
      const spread = g.spread * settle * run * dark * onMove * crouchK * shaken / diff.aim;
      const aim = _d.copy(T.chest).add(_a.set(rnd(-0.12, 0.12), rnd(-0.25, 0.18), rnd(-0.12, 0.12)));
      this.shoot(m, aim, spread, 1);
    } else if (m.suppressing && !m.canSee && !crouchedHidden && !moving && m.react <= 0 && m.fireT <= 0 && dist < g.range && T.alive) {
      // suppressing: bursts into where you went to ground (the cover takes them, unless you peek)
      const aim = _d.copy(known).add(_a.set(rnd(-0.7, 0.7), rnd(0.55, 1.35), rnd(-0.7, 0.7)));
      const to = _b.subVectors(aim, h.eye);
      const len = to.length();
      // its own cover in the way: stand up / shift instead of shooting the rock in front of it
      const block = this.host.combat.worldRay(h.eye, to.divideScalar(len), len, T.collider);
      if (block && block.t < Math.min(3, len * 0.4)) { if (m.cover) m.coverT += dt * 4; }
      else this.shoot(m, aim, g.spread * 2.2 + 0.015, 1.25);
    }
  }

  /** Fire one round (or a shotgun's load) at `aim`: tracer, flash, report, noise, recoil, the mag. */
  private shoot(m: Member, aim: THREE.Vector3, spread: number, pace: number) {
    const h = m.h;
    const g = m.gun;
    const gun = h.weapon === 'revolver' ? 'revolver' : h.weapon === 'shotgun' ? 'shotgun' : 'rifle';
    const muzzle = h.muzzle.clone();
    this.host.combat.enemyRound(muzzle, aim, spread, g.dmg, gun, { pellets: g.pellets });
    this.host.combat.enemyFlash(muzzle, _a.subVectors(aim, muzzle).normalize(), h.weapon === 'shotgun' ? 1.3 : 1);
    this.host.audio.combat?.gunshot(gun, muzzle);
    this.host.combat.noise(h.pos, 150, 'gunshot');
    h.recoil = 1;
    m.mag--;
    m.burst--;
    if (m.burst <= 0) { m.burst = Math.max(1, Math.round(rnd(1, g.burst))); m.fireT = g.interval * rnd(1.4, 2.4) * pace; }
    else m.fireT = g.interval * rnd(0.85, 1.15) * pace;
  }

  /** Line of sight from the eye to the player, within a cone and a range that night and dust shrink. */
  private sees(m: Member) {
    const T = this.host.combat.target;
    if (T.hidden || !T.alive) return false;
    const h = m.h;
    const toP = _a.subVectors(T.chest, h.eye);
    const dist = toP.length();
    const alert = m.state === 'combat' || m.state === 'search';
    let range = alert ? 130 : 72;
    // a scope sees further; a crew that found a body is looking harder
    if (m.kit === 'marksman') range *= 1.5;
    if (m.squad.wary > 0) range *= 1.2;
    // at night a dark figure is hard to pick out; one stood in firelight or a floodlight isn't
    if (T.night > 0.5) range *= T.torch ? 1.5 : 0.42 + 0.63 * T.light;
    range *= 0.3 + 0.7 * T.visibility;
    if (T.crouch && !alert) range *= 0.62;
    if (dist > range) return false;
    const look = alert ? h.aimYaw : h.yaw + h.look * 0.6;
    const fwd = _b.set(Math.sin(look), 0, Math.cos(look));
    const cosHalf = alert ? -0.2 : 0.42;
    if (dist > 2.5 && fwd.dot(_c.copy(toP).setY(0).normalize()) < cosHalf) return false;
    if (this.smoked(h.eye, T.chest)) return false;
    if (this.host.combat.clearLine(h.eye, T.chest, T.collider)) return true;
    return this.host.combat.clearLine(h.eye, T.eye, T.collider);
  }

  /**
   * A broken contractor gives up: the gun goes in the dirt, the hands go up, a line about its
   * contract. It doesn't fight or spot; you can take its lanyard and rounds (it runs once you have),
   * walk away (it runs), or not. Its crew counts it out of the fight.
   */
  private surrender(m: Member) {
    if (m.state === 'surrender') return;
    m.state = 'surrender';
    m.surT = 0;
    m.flank = false;
    m.suppressing = false;
    m.reloadT = 0;
    m.h.reloadT = 0;
    if (m.cover) { m.cover.taken = false; m.cover = null; }
    if (m.flankCover) { m.flankCover.taken = false; m.flankCover = null; }
    if (m.squad.suppressor === m) m.squad.suppressor = null;
    this.bark(m, 'surrender', true);
    const it: Interactable = {
      id: `surrender:${m.h.slot}`,
      pos: m.h.pos.clone().setY(m.h.pos.y + 1),
      radius: 2.4,
      visible: () => m.state === 'surrender',
      primary: {
        label: 'Take his lanyard and his rounds',
        available: () => true,
        run: () => {
          const ammo = { rifle: 'ammo3030', shotgun: 'shells', revolver: 'ammo38' }[m.h.weapon];
          const lines = this.host.give([{ id: 'kade_badge', qty: 1 }, { id: ammo, qty: Math.round(rnd(3, 6)) }, ...(Math.random() < 0.5 ? [{ id: 'water', qty: 1 }] : [])]);
          this.host.toast(lines.join(' · '), 'good');
          this.host.audio.play('pickup');
          this.host.xp(10, 'Spared a contractor');
          this.bark(m, 'spared', true);
          this.dropSurrender(m);
          m.state = 'flee';
        },
      },
    };
    it.pos.copy(m.h.pos).setY(m.h.pos.y + 1);
    m.surIt = it;
    this.host.interactables.push(it);
  }

  private dropSurrender(m: Member) {
    if (!m.surIt) return;
    const i = this.host.interactables.indexOf(m.surIt);
    if (i >= 0) this.host.interactables.splice(i, 1);
    m.surIt = null;
  }

  /** A contractor ran off for good: out of its crew (a crew that's all dead or gone clears its outpost). */
  private rout(m: Member) {
    const sq = m.squad;
    this.dropSurrender(m);
    this.release(m);
    const i = sq.members.indexOf(m);
    if (i >= 0) sq.members.splice(i, 1);
    if (!sq.alive.length && sq.outpost && sq.outpost.state === 'active' && sq.outpost.squad === sq) this.cleared(sq.outpost);
  }

  /** A fallen squadmate in view (not yet found), or null. */
  private spotBody(m: Member) {
    const h = m.h;
    const look = h.yaw + h.look * 0.6;
    const fx = Math.sin(look), fz = Math.cos(look);
    for (const o of m.squad.members) {
      if (o.alive || o.found || !o.h.active) continue;
      const to = _a.subVectors(o.h.chestPos, h.eye);
      const d = to.length();
      if (d > 26) continue;
      if (d > 3 && (to.x * fx + to.z * fz) / Math.max(0.01, Math.hypot(to.x, to.z)) < 0.25) continue;
      if (this.smoked(h.eye, o.h.chestPos)) continue;
      if (!this.host.combat.clearLine(h.eye, _b.copy(o.h.chestPos).setY(o.h.chestPos.y + 0.25), this.host.combat.target.collider)) continue;
      return o;
    }
    return null;
  }

  /** Someone found a body: a shout, the whole crew sweeps from there, and it stays jumpy for three minutes. */
  private bodyFound(m: Member, body: Member) {
    body.found = true;
    const sq = m.squad;
    sq.wary = 180;
    sq.morale -= 0.05;
    this.bark(m, 'body', true);
    for (const o of sq.alive) o.detect = Math.max(o.detect, 0.5);
    if (sq.alert !== 'combat') this.search(sq, body.h.chestPos.clone().setY(this.host.hf.heightAt(body.h.chestPos.x, body.h.chestPos.z)));
  }

  /** The radio call went out: the nearest crew that isn't already fighting comes, all of it. */
  private callHelp(sq: Squad, caller: Member) {
    let best: Squad | null = null, bd = 280;
    for (const o of this.squads()) {
      if (o === sq || o.alert === 'combat' || !o.alive.length) continue;
      const d = o.alive[0].h.pos.distanceTo(sq.known);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) { this.bark(caller, 'radioNone', true); return; }
    const b = best as Squad;
    b.radioed = true; // no relays: one call, one crew
    this.engage(b, sq.known, 2.5);
    this.bark(caller, 'radioAck', true);
  }

  /**
   * The marksman's shot: it settles the crosshair on you (the glint brightens) and fires when it's
   * sure. Breaking the line, sprinting, the dark and rounds cracking past all reset or slow it.
   */
  private snipe(m: Member, dt: number, dist: number, down: boolean) {
    const T = this.host.combat.target;
    const diff = this.host.combat.diff;
    const g = m.gun;
    const ready = m.canSee && !down && m.react <= 0 && m.fireT <= 0 && dist < g.range && T.alive && m.h.crouch < 0.5;
    if (ready) {
      const run = Math.hypot(T.velocity.x, T.velocity.z) > 4.5 ? 1.35 : 1;
      const dark = T.night > 0.5 && !T.torch ? 1.4 - 0.4 * T.light : 1;
      // off your screen, the glint can't warn you: it takes twice as long to settle
      const unseen = viewCull.sees(m.h.eye, 0.4) ? 1 : 2;
      m.charge = Math.min(1, m.charge + dt / (1.9 * diff.react * run * dark * unseen));
    } else m.charge = Math.max(0, m.charge - dt * (m.canSee ? 0.5 : 1.4));
    m.glint = m.charge > 0 ? 0.3 + 0.7 * m.charge * m.charge : 0.16;
    if (m.charge >= 1) {
      m.charge = 0;
      const shaken = 1 + Math.min(1, m.supp) * 2;
      const moving = Math.hypot(T.velocity.x, T.velocity.z) > 3 ? 2.4 : 1;
      const aim = _d.copy(T.chest).add(_a.set(rnd(-0.08, 0.08), rnd(-0.14, 0.1), rnd(-0.08, 0.08)));
      this.shoot(m, aim, g.spread * shaken * moving / diff.aim, 1);
    }
  }

  /** Point the glint at the brightest marksman's scope, sized to read at range, only when it faces you. */
  private updateGlint(cam: THREE.Vector3) {
    let best: Member | null = null, bk = 0.01;
    for (const m of this.members) if (m.alive && m.kit === 'marksman' && m.h.active && m.glint > bk) { best = m; bk = m.glint; }
    this.beam.visible = false;
    if (!best) { this.glint.visible = false; return; }
    // night: the rangefinder's red beam walks onto you as the shot settles (from the lens toward your chest)
    const TT = this.host.combat.target;
    if (TT.night > 0.5 && best.charge > 0.04 && best.canSee) {
      const lens = _a.copy(SCOPE_LENS).applyMatrix4(best.h.mats[BONE.weapon]);
      // the dot walks in from beside you and settles on your chest as the shot does (end-on, a beam
      // aimed straight at the eye would read as nothing but a point)
      const u = 1 - best.charge;
      const side = _c.subVectors(TT.chest, lens).setY(0).normalize();
      const to = _b.copy(TT.chest).addScaledVector(_d.set(-side.z, 0, side.x), u * 4.5 * (best.h.slot % 2 ? 1 : -1)).addScaledVector(UP, -u * 1.3);
      const d = lens.distanceTo(to);
      if (d > 6) {
        this.beam.visible = true;
        this.beam.position.copy(lens);
        this.beam.lookAt(to);
        const w = (0.7 + 1.3 * best.charge) * (1 + d / 40);
        this.beam.scale.set(w, w, d - (to.distanceTo(cam) < 2.5 ? 2.5 : 0));
      }
    }
    const wm = best.h.mats[BONE.weapon];
    const lens = _a.copy(SCOPE_LENS).applyMatrix4(wm);
    const fwd = _b.setFromMatrixColumn(wm, 2).normalize().negate();
    const to = _c.subVectors(cam, lens);
    const d = Math.max(0.01, to.length());
    to.divideScalar(d);
    const T = this.host.combat.target;
    const k = best.glint * Math.pow(Math.max(0, fwd.dot(to)), 6) * (1 - 0.35 * T.night);
    if (k < 0.01 || d < 3) { this.glint.visible = false; return; }
    this.glint.visible = true;
    this.glint.position.copy(lens).addScaledVector(to, 0.12);
    this.glint.scale.setScalar((0.3 + d * 0.055) * (0.5 + 0.5 * k));
    this.glintK.value = Math.min(1.4, k * 1.4);
  }

  /** Is the line a to b through a smoke screen? */
  smoked(a: THREE.Vector3, b: THREE.Vector3) {
    for (const k of this.smokes) {
      if (k.r < 0.5) continue;
      const c = _sm.copy(k.at).setY(k.at.y + Math.min(1.6, k.r * 0.4));
      const ab = _sm2.subVectors(b, a);
      const t = THREE.MathUtils.clamp(_sm3.subVectors(c, a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
      if (_sm3.copy(a).addScaledVector(ab, t).distanceTo(c) < k.r * 0.85) return true;
    }
    return false;
  }

  /** Cover from the outpost's list or sampled around: hidden when crouched, a view when standing. */
  private pickCover(m: Member, threat: THREE.Vector3) {
    if (m.cover) m.cover.taken = false;
    m.cover = null;
    const T = this.host.combat.target;
    const h = m.h;
    // badly hurt: somewhere further back than where it is now
    const prefer = m.fallback ? Math.max(m.gun.prefer + 12, h.pos.distanceTo(threat) + 6) : m.gun.prefer;
    const minT = m.fallback ? h.pos.distanceTo(threat) + 2 : 3;
    let best: CoverPoint | null = null;
    let bestS = Infinity;
    const consider = (c: CoverPoint) => {
      if (c.taken) return;
      const dT = c.pos.distanceTo(threat);
      const dM = c.pos.distanceTo(h.pos);
      if (dM > 28 || dT < minT) return;
      // facing the threat?
      const toT = _a.subVectors(threat, c.pos).setY(0).normalize();
      if (toT.dot(c.out) < 0.2) return;
      // does the wall actually block a crouched body from where you are?
      const hidden = !this.host.combat.clearLine(_b.copy(T.eye), _c.copy(c.pos).setY(c.pos.y + 0.7), T.collider);
      const s = Math.abs(dT - prefer) * 0.6 + dM * 0.8 + (hidden ? 0 : 14) + Math.random() * 2;
      if (s < bestS) { bestS = s; best = c; }
    };
    if (m.squad.outpost) for (const c of m.squad.outpost.build.cover) consider(c);
    // sampled: rocks, wrecks, anything solid between you and the threat
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * 6.28, r = rnd(3, 12);
      const p = new THREE.Vector3(h.pos.x + Math.cos(a) * r, 0, h.pos.z + Math.sin(a) * r);
      p.y = this.host.hf.heightAt(p.x, p.z);
      const toT = _d.subVectors(threat, p).setY(0);
      const d = toT.length();
      toT.normalize();
      const hit = this.host.combat.worldRay(_a.copy(p).setY(p.y + 0.6), toT, Math.min(3, d), T.collider);
      if (!hit || hit.t < 0.4) continue;
      const tall = this.host.combat.worldRay(_a.copy(p).setY(p.y + 1.45), toT, Math.min(3, d), T.collider);
      consider({ pos: p, out: toT.clone(), h: tall ? 1.4 : 0.8, taken: false });
    }
    const chosen = best as CoverPoint | null;
    if (chosen) { chosen.taken = true; m.cover = chosen; }
  }

  /** Steer toward `goal` at `speed`, round obstacles. Returns true when there. */
  private walkTo(m: Member, goal: THREE.Vector3, speed: number, dt: number, run = false) {
    const h = m.h;
    const to = _a.subVectors(goal, h.pos).setY(0);
    const d = to.length();
    if (d < 0.5) { h.vel.multiplyScalar(Math.exp(-dt * 10)); if (h.vel.lengthSq() < 0.01) h.vel.set(0, 0, 0); m.lastPos.copy(h.pos); return true; }
    to.divideScalar(d);
    // feelers: something solid ahead at knee height → try round it
    const feel = (dir: THREE.Vector3) => !this.host.combat.worldRay(_b.copy(h.pos).setY(h.pos.y + 0.5), dir, 1.4, this.host.combat.target.collider);
    let dir = to;
    if (!feel(dir)) {
      for (const a of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const alt = _c.copy(to).applyAxisAngle(UP, a);
        if (feel(alt)) { dir = alt; break; }
      }
    }
    // spread out from squadmates
    for (const o of m.squad.members) {
      if (o === m || !o.alive) continue;
      const sep = _d.subVectors(h.pos, o.h.pos).setY(0);
      const dd = sep.length();
      if (dd < 1.4 && dd > 0.01) dir.addScaledVector(sep.normalize(), (1.4 - dd) * 0.8);
    }
    dir.normalize();
    const v = Math.min(speed, d * 2.5);
    h.vel.lerp(_b.copy(dir).multiplyScalar(v), Math.min(1, dt * 6));
    _from.copy(h.pos);
    h.pos.addScaledVector(h.vel, dt);
    // feelers steer; this is the hard stop (no walking through walls)
    this.host.combat.slide(_from, h.pos, 0.35, 0.5);
    h.pos.y = this.host.hf.heightAt(h.pos.x, h.pos.z);
    // stuck? jitter sideways (still not through a wall)
    if (m.lastPos.distanceTo(h.pos) < 0.2 * dt * speed) {
      m.stuckT += dt;
      if (m.stuckT > 1.2) {
        _from.copy(h.pos);
        h.pos.addScaledVector(_c.set(-dir.z, 0, dir.x), rnd(-1, 1));
        this.host.combat.slide(_from, h.pos, 0.35, 0.5);
        h.pos.y = this.host.hf.heightAt(h.pos.x, h.pos.z);
        m.stuckT = 0;
      }
    }
    else m.stuckT = 0;
    m.lastPos.copy(h.pos);
    h.yaw += angDiff(h.yaw, Math.atan2(h.vel.x, h.vel.z)) * Math.min(1, dt * (run ? 10 : 5));
    if (!run) h.aimYaw = h.yaw;
    return false;
  }

  // ------------------------------------------------------------------ compliance charges

  private throwCharge(m: Member, at: THREE.Vector3) {
    const slot = this.chargePool.find((c) => !c.mesh.visible);
    if (!slot) return;
    const R = this.host.physics.R;
    const from = m.h.headPos.clone().add(_a.set(0, 0.3, 0));
    const to = at.clone().add(_b.set(rnd(-1.5, 1.5), 0, rnd(-1.5, 1.5)));
    const flat = Math.hypot(to.x - from.x, to.z - from.z);
    const tFlight = THREE.MathUtils.clamp(flat / 13, 0.6, 1.6);
    const vel = new THREE.Vector3((to.x - from.x) / tFlight, (to.y - from.y + 0.5 * 9.81 * tFlight * tFlight) / tFlight, (to.z - from.z) / tFlight);
    const body = this.host.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z).setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: rnd(-8, 8), y: rnd(-4, 4), z: rnd(-8, 8) }).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.6));
    this.host.physics.world.createCollider(R.ColliderDesc.cylinder(0.08, 0.05).setDensity(900).setRestitution(0.25).setFriction(0.8), body);
    slot.mesh.visible = true;
    this.charges.push({ mesh: slot.mesh, body, fuse: 2.6, beepT: 0, light: slot.light });
    m.h.pose = 'throw';
    this.bark(m, 'grenade');
    this.host.audio.play('throw');
  }

  private throwSmoke(m: Member, at: THREE.Vector3) {
    const mesh = this.smokePool.find((g) => !g.visible);
    if (!mesh) return;
    const R = this.host.physics.R;
    const from = m.h.headPos.clone().add(_a.set(0, 0.3, 0));
    const flat = Math.hypot(at.x - from.x, at.z - from.z);
    const tFlight = THREE.MathUtils.clamp(flat / 12, 0.6, 1.5);
    const vel = new THREE.Vector3((at.x - from.x) / tFlight, (at.y - from.y + 0.5 * 9.81 * tFlight * tFlight) / tFlight, (at.z - from.z) / tFlight);
    const body = this.host.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z).setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: rnd(-6, 6), y: rnd(-3, 3), z: rnd(-6, 6) }).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.8));
    this.host.physics.world.createCollider(R.ColliderDesc.cylinder(0.075, 0.045).setDensity(700).setRestitution(0.2).setFriction(0.9), body);
    mesh.visible = true;
    this.smokes.push({ mesh, body, fuse: 1.1, t: 0, emitT: 0, hissT: 0, at: from.clone(), r: 0 });
    m.h.pose = 'throw';
    this.bark(m, 'smoke', true);
    this.host.audio.play('throw');
  }

  private updateSmokes(dt: number) {
    for (const k of [...this.smokes]) {
      if (k.body) {
        const t = k.body.translation(), r = k.body.rotation();
        k.mesh.position.set(t.x, t.y, t.z);
        k.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        k.at.set(t.x, t.y, t.z);
      }
      k.fuse -= dt;
      if (k.fuse > 0) continue;
      k.t += dt;
      // ~12 s of thick white smoke boiling out of the can, a hiss, then it thins and drifts off
      if (k.t < 12) {
        k.emitT -= dt;
        while (k.emitT <= 0) {
          k.emitT += 0.1;
          this.screen.emit('screen', _a.copy(k.at).setY(k.at.y + 0.15), 2, _b.set(0, 1.1, 0), 1.6, 1.05);
        }
        k.hissT -= dt;
        if (k.hissT <= 0) { k.hissT = 1.6; this.host.audio.combat?.voice('hiss', k.at, 0.45, k.t < 1 ? 1 : 0.45); }
      }
      k.r = 6 * Math.min(1, k.t / 2.2) * (k.t > 15 ? Math.max(0, 1 - (k.t - 15) / 5) : 1);
      if (k.t > 20) {
        if (k.body) this.host.physics.world.removeRigidBody(k.body);
        k.body = null;
        k.mesh.visible = false;
        this.smokes.splice(this.smokes.indexOf(k), 1);
      }
    }
  }

  private updateCharges(dt: number) {
    for (const c of [...this.charges]) {
      c.fuse -= dt;
      const t = c.body.translation(), r = c.body.rotation();
      c.mesh.position.set(t.x, t.y, t.z);
      c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      c.beepT -= dt;
      const rate = Math.max(0.08, c.fuse * 0.22);
      if (c.beepT <= 0) { c.beepT = rate; this.host.audio.combat?.machine('beep', c.mesh.position, 1); }
      c.light.visible = c.beepT > rate * 0.5;
      if (c.fuse <= 0) {
        this.host.physics.world.removeRigidBody(c.body);
        c.mesh.visible = false;
        this.charges.splice(this.charges.indexOf(c), 1);
        this.host.combat.explode(c.mesh.position.clone(), 5.5, 75, { source: 'enemy' });
      }
    }
  }

  // ------------------------------------------------------------------ debug

  /** Debug: drop a squad of `n` at `d` m in front of the player, already hunting (or not). */
  summon(player: THREE.Vector3, yaw: number, d = 25, n = 3, hunt = true, kits?: (HumanKit | null | undefined)[]) {
    const sq = new Squad(this, null);
    const weapons: HumanWeapon[] = ['rifle', 'shotgun', 'revolver', 'rifle', 'shotgun'];
    const KW: Record<HumanKit, HumanWeapon> = { marksman: 'rifle', heavy: 'shotgun', grenadier: 'revolver' };
    for (let i = 0; i < n; i++) {
      const kit = kits?.[i] ?? undefined;
      const h = this.take(kit ? KW[kit] : weapons[i % weapons.length], kit);
      if (!h) break;
      const a = yaw + (i - (n - 1) / 2) * 0.25;
      const pos = new THREE.Vector3(player.x - Math.sin(a) * d, 0, player.z - Math.cos(a) * d);
      pos.y = this.host.hf.heightAt(pos.x, pos.z);
      const m = new Member(h, sq, { pos, yaw: a, role: 'guard', path: [] });
      h.pos.copy(pos);
      h.yaw = h.aimYaw = a;
      sq.members.push(m);
      this.members.push(m);
    }
    if (this.patrol) this.despawnSquad(this.patrol);
    this.patrol = sq;
    if (hunt) this.engage(sq, player, 0.3);
    return sq.members.length;
  }

  census() {
    return this.members.map((m) => ({
      slot: m.h.slot, kit: m.kit ?? '', state: m.state, ...(m.state === 'surrender' ? { surT: +m.surT.toFixed(1) } : {}), hp: Math.round(m.hp), mag: m.mag, see: m.canSee, cover: !!m.cover, detect: +m.detect.toFixed(2),
      ...(m.kit === 'heavy' ? { armour: Math.round(m.armour) } : {}), ...(m.kit === 'marksman' ? { charge: +m.charge.toFixed(2), perch: !!m.perch } : {}),
      ...(m.flank ? { flank: m.flankCover ? 'cover' : 'open' } : {}), ...(m.rushT > 0 ? { rush: +m.rushT.toFixed(1) } : {}), ...(m.radioT > 0 ? { radio: +m.radioT.toFixed(1) } : {}), ...(m.squad.wary > 0 ? { wary: Math.round(m.squad.wary) } : {}),
    }));
  }

  /** Debug: the live smoke screens. */
  smokeCensus() {
    return this.smokes.map((k) => ({ at: k.at.toArray().map((v) => +v.toFixed(1)), t: +k.t.toFixed(1), r: +k.r.toFixed(1) }));
  }
}
