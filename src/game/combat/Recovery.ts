import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import type { AudioEngine } from '@/engine/audio';
import type { Heightfield } from '../world/Heightfield';
import type { Interactable } from '../context';
import { HumanCrowd, Ragdoll, BONE, type HumanLook, type HumanWeapon, type Human } from './Humans';
import type { HumanSkins } from './humanSkin';
import { buildOutpost, type OutpostBuild, type CoverPoint } from './Outposts';
import { capsuleRay, sphereRay, type Combat, type Hostile, type HostileProvider, type NoiseKind, type RayHit, type Damage } from './Combat';
import { OUTPOSTS, BARKS, BODY_LOOT, type OutpostDef, type CrewRole } from '@/content/recovery';
import { HIGHWAY } from '@/content/world';
import { ITEMS } from '@/content/items';
import { distToPolyline } from '../world/Heightfield';

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
const HP: Record<CrewRole, number> = { guard: 100, patrol: 100, sit: 90, leader: 130 };

/** Slot pool: the crowd mesh is built once, so each slot's gun is fixed. */
const SLOT_GUNS: HumanWeapon[] = ['rifle', 'rifle', 'rifle', 'rifle', 'shotgun', 'shotgun', 'shotgun', 'revolver', 'revolver', 'revolver'];
const VESTS = ['#e3b524', '#e66a1e', '#d9c22a', '#e88a1a', '#cfae2e'];
const HELMETS = ['#e8e6df', '#ece9e2', '#dcd9d0', '#f0eee8'];
const UNIFORMS = ['#3c4450', '#3e4238', '#46413a', '#353a44', '#40403e'];

function lookFor(i: number, weapon: HumanWeapon): HumanLook {
  const r = (k: number) => Math.abs(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1;
  return {
    vest: VESTS[i % VESTS.length],
    uniform: UNIFORMS[(i * 3) % UNIFORMS.length],
    pants: ['#4a4a40', '#3d3a33', '#4e4a42'][i % 3],
    helmet: i === 0 ? '#e05a1a' : HELMETS[i % HELMETS.length],
    boots: '#2a1f18',
    gloves: '#2b2b2b',
    skin: ['#8a6450', '#6a4a38', '#b08870', '#5a3e30'][i % 4],
    build: weapon === 'shotgun' ? 1.12 + r(1) * 0.08 : 0.95 + r(2) * 0.1,
    height: 0.95 + r(3) * 0.08,
    weapon,
    pack: r(4) > 0.6,
    leader: i === 0,
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _from = new THREE.Vector3();
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

type MState = 'idle' | 'suspicious' | 'search' | 'combat' | 'flee' | 'dead';

class Member implements Hostile {
  readonly kind = 'human' as const;
  readonly surface = 'flesh' as const;
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
  readonly gun: NpcGun;

  constructor(readonly h: Human, public squad: Squad, readonly post: { pos: THREE.Vector3; yaw: number; role: CrewRole; path: THREE.Vector3[] }) {
    this.gun = GUNS[h.weapon];
    this.mag = this.gun.mag;
    this.hp = HP[post.role];
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (!this.h.active || !this.alive) return null;
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

  damage(d: Damage): boolean {
    if (!this.alive) return false;
    this.hp -= d.amount;
    this.h.flinch.copy(d.dir).setY(0).normalize();
    this.h.flinchK = Math.min(1, 0.5 + d.amount / 40);
    if (this.hp <= 0) {
      this.squad.owner.kill(this, d);
      return true;
    }
    this.squad.owner.hurt(this, d);
    return false;
  }

  unaware() {
    return this.alive && (this.state === 'idle' || (this.state === 'suspicious' && this.detect < 0.6));
  }
  facing() {
    return _d.set(Math.sin(this.h.yaw), 0, Math.cos(this.h.yaw));
  }
  awareness() {
    if (!this.alive || !this.h.active) return 0;
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
  constructor(readonly owner: Recovery, readonly outpost: Outpost | null) {}
  get alive() {
    return this.members.filter((m) => m.alive);
  }
}

interface Outpost {
  def: OutpostDef;
  build: OutpostBuild;
  squad: Squad | null;
  state: 'dormant' | 'active' | 'cleared';
  lockerOpen: boolean;
  locker: Interactable;
}

/** A thrown compliance charge: red canister, beeping faster, then a blast. */
interface Charge { mesh: THREE.Object3D; body: ReturnType<Physics['world']['createRigidBody']>; fuse: number; beepT: number; light: THREE.Mesh }

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
  t = 0;

  constructor(private host: RecoveryHost) {
    this.crowd = new HumanCrowd(SLOT_GUNS.map((w, i) => lookFor(i, w)), host.skins ?? null);
    this.free = SLOT_GUNS.map((_, i) => i);
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
  }

  hostiles() {
    return this.members;
  }

  /** An outpost respawned (machines rebuild). */
  onRespawn: ((id: string) => void) | null = null;

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

  private take(weapon: HumanWeapon): Human | null {
    let i = this.free.findIndex((s) => SLOT_GUNS[s] === weapon);
    if (i < 0) i = this.free.findIndex(() => true);
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
    return h;
  }

  private release(m: Member) {
    m.h.ragdoll?.freeze();
    m.h.ragdoll = null;
    m.h.hide();
    if (m.cover) m.cover.taken = false;
    this.free.push(m.h.slot);
    const i = this.members.indexOf(m);
    if (i >= 0) this.members.splice(i, 1);
    this.dropBody(m);
  }

  private spawnOutpost(op: Outpost) {
    const sq = new Squad(this, op);
    const f = op.build.frame;
    for (const post of op.def.crew) {
      const h = this.take(post.weapon);
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
      sq.members.push(m);
      this.members.push(m);
    }
    op.squad = sq;
    op.state = 'active';
    op.lockerOpen = (this.host.marks[`locker.${op.def.id}`] ?? -1) >= this.respawns(op);
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
    weapons.forEach((w, i) => {
      const h = this.take(w);
      if (!h) return;
      const pos = best!.clone().addScaledVector(_b.set(-away.z, 0, away.x), (i - 0.5) * 2.4).addScaledVector(away, -i * 1.5);
      pos.y = this.host.hf.heightAt(pos.x, pos.z);
      const m = new Member(h, sq, { pos, yaw: Math.atan2(away.x, away.z), role: 'patrol', path: [goal] });
      h.pos.copy(pos);
      h.yaw = h.aimYaw = m.post.yaw;
      sq.members.push(m);
      this.members.push(m);
    });
    if (sq.members.length) this.patrol = sq;
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
    // the shot carries them: bullets push, a shotgun throws, a blast launches
    const k = d.source === 'blast' ? 260 : d.takedown ? 30 : d.melee ? 120 : d.weapon === 'shotgun' ? 190 : d.weapon === 'rifle' ? 120 : 80;
    const imp = _a.copy(d.dir).setY(Math.max(0.15, d.dir.y + 0.25)).normalize().multiplyScalar(k);
    h.ragdoll = new Ragdoll(this.host.physics, h.mats, h.vel.clone(), imp, m.hitBone);
    this.host.audio.combat?.voice('bodyfall', h.pos.clone().setY(h.pos.y + 0.3), 1, d.takedown ? 0.6 : 1);
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

  hurt(m: Member, d: Damage) {
    m.squad.morale -= 0.04;
    m.reloadT = Math.max(0, m.reloadT - 0.2);
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
    const lines = this.host.give(items);
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
      if (m.state === 'flee') continue;
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

  private search(sq: Squad, at: THREE.Vector3) {
    if (sq.alert === 'combat') return;
    sq.alert = 'search';
    sq.searchT = 0;
    sq.known.copy(at);
    sq.knownT = this.t;
    for (const m of sq.alive) {
      m.state = 'search';
      const a = Math.random() * 6.28;
      m.investigate.copy(at).add(_a.set(Math.cos(a) * rnd(2, 8), 0, Math.sin(a) * rnd(2, 8)));
    }
    const s = sq.alive[0];
    if (s) this.bark(s, 'search');
  }

  private bark(m: Member, kind: string) {
    if (this.barkT > 0 && kind !== 'down') return;
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
      op.build.fire.group.visible = (night || op.state === 'active') && op.state !== 'cleared' && Math.hypot(cam.x - op.def.x, cam.z - op.def.z) < 160;
      if (op.build.fire.group.visible) op.build.fire.update(dt, cam);
      op.build.fire.light.intensity = op.build.fire.group.visible ? 12 : 0;
      if (op.state === 'dormant' && d < 240) {
        const clearedAt = host.marks[`cleared.${op.def.id}`];
        if (clearedAt != null && host.playTime() - clearedAt < 30 * 60) { op.state = 'cleared'; continue; }
        this.spawnOutpost(op);
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
    this.crowd.update(dt, host.hf, host.combat.target?.eye);
  }

  private squadTick(sq: Squad, dt: number) {
    const live = sq.alive;
    if (!live.length) return;
    if (sq.alert === 'combat') {
      sq.combatT += dt;
      sq.grenadeT -= dt;
      sq.flankT -= dt;
      const seen = live.some((m) => m.canSee);
      sq.hiddenT = seen ? 0 : sq.hiddenT + dt;
      // lost you: search, then stand down
      if (this.t - sq.knownT > 14) this.search(sq, sq.known);
      // nerve breaks
      if (sq.morale < 0.25 && live.length <= 2) {
        for (const m of live) if (m.state !== 'flee') { m.state = 'flee'; this.bark(m, 'flee'); }
      }
      // send someone round when you've gone to ground
      if (sq.flankT <= 0 && sq.hiddenT > 3 && live.length >= 2) {
        sq.flankT = rnd(10, 16);
        const m = live.filter((x) => x.state === 'combat' && x.reloadT <= 0).sort(() => Math.random() - 0.5)[0];
        if (m) {
          const side = Math.random() < 0.5 ? 1 : -1;
          const dir = _a.subVectors(m.h.pos, sq.known).setY(0).normalize().applyAxisAngle(UP, side * 1.4);
          m.move.copy(sq.known).addScaledVector(dir, rnd(8, 13));
          m.move.y = this.host.hf.heightAt(m.move.x, m.move.z);
          m.flank = true;
          if (m.cover) { m.cover.taken = false; m.cover = null; }
          m.coverT = 0;
          this.bark(m, 'flank');
        }
      }
      // compliance charge
      const t = this.host.combat.target;
      const dk = sq.known.distanceTo(live[0].h.pos);
      if (sq.grenadeT <= 0 && sq.hiddenT > 2 && dk < 28 && t.alive && this.charges.length < 1) {
        sq.grenadeT = rnd(18, 28);
        const thrower = live.filter((m) => m.state === 'combat' && m.h.pos.distanceTo(sq.known) > 6 && m.h.pos.distanceTo(sq.known) < 26)[0];
        if (thrower) this.throwCharge(thrower, sq.known);
      }
    } else if (sq.alert === 'search') {
      sq.searchT += dt;
      if (sq.searchT > 22) {
        sq.alert = 'calm';
        sq.morale = Math.min(1, sq.morale + 0.3);
        for (const m of live) { m.state = 'idle'; m.detect = 0; }
        this.bark(live[0], 'lost');
      }
    }
  }

  // ------------------------------------------------------------------ one contractor

  private tick(m: Member, dt: number) {
    const h = m.h;
    if (!m.alive) {
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

    // ---- perception (staggered)
    m.thinkT -= dt;
    if (m.thinkT <= 0) {
      m.thinkT = 0.15 + Math.random() * 0.06;
      m.canSee = this.sees(m);
    }
    if (m.canSee) m.seeT += dt; else m.seeT = 0;
    const sq = m.squad;
    if (m.canSee && m.state === 'combat') { sq.known.copy(T.feet); sq.knownT = this.t; }
    if (m.state === 'idle' || m.state === 'suspicious' || m.state === 'search') {
      if (m.canSee) {
        const dist = h.eye.distanceTo(T.chest);
        const close = Math.max(0, 1 - dist / 70);
        const moving = Math.min(1.5, Math.hypot(T.velocity.x, T.velocity.z) / 3.4);
        const rate = (0.25 + close * 1.8) * (0.6 + T.noise * 0.4) * (0.7 + moving * 0.4) * (m.state === 'search' ? 2.2 : 1) / diff.react;
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
    switch (m.state) {
      case 'idle': {
        const post = m.post;
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
        if (m.waitT > 1.5 && to.length() > 2.5) { if (!this.walkTo(m, m.investigate, 1.7, dt)) speed = 1.7; }
        if (m.waitT > 10 && m.detect < 0.3) { m.state = 'idle'; m.detect = 0; }
        break;
      }
      case 'search': {
        h.pose = 'ready';
        if (this.walkTo(m, m.investigate, 2.2, dt)) {
          m.waitT -= dt;
          if (m.waitT <= 0) {
            m.waitT = rnd(1.5, 3);
            const a = Math.random() * 6.28;
            m.investigate.copy(sq.known).add(_a.set(Math.cos(a) * rnd(3, 12), 0, Math.sin(a) * rnd(3, 12)));
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
        if (h.pos.distanceTo(T.feet) > 90 && !m.canSee) {
          // they ran far enough: gone
          this.release(m);
        }
        return;
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
    if (m.flank) {
      const arrived = this.walkTo(m, m.move, m.runSpeed, dt, true);
      moving = !arrived;
      if (arrived || m.canSee) { m.flank = false; m.coverT = 99; }
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
          h.crouch = m.peek ? (m.cover.h > 0.9 ? 0 : 0.35) : 1;
          // nothing to shoot from here for a while: push up
          if (m.peek && !m.canSee && m.peekT < 0.2 && T.alive) m.coverT += 2.5;
        }
      } else {
        // open ground: hold at the preferred range, kneel to shoot
        const want = g.prefer;
        if (Math.abs(dist - want) > 4) {
          const goal = _d.copy(known).addScaledVector(toK.normalize(), -want);
          goal.y = this.host.hf.heightAt(goal.x, goal.z);
          moving = !this.walkTo(m, goal, m.runSpeed * 0.8, dt, true);
        } else { h.vel.set(0, 0, 0); h.crouch = 0.55; }
      }
    }
    h.pose = m.canSee || !moving ? 'aim' : 'ready';
    if (!moving) h.yaw += angDiff(h.yaw, h.aimYaw) * Math.min(1, dt * 6);

    // ---- shooting
    const crouchedHidden = m.cover && !m.peek && !moving && m.cover.h > 0.6;
    if (m.canSee && !crouchedHidden && m.react <= 0 && m.fireT <= 0 && dist < g.range && T.alive) {
      // the first shots go wide; the longer they watch you, the tighter it gets
      const settle = 1 + 2.6 * Math.exp(-m.seeT / 1.3);
      const run = Math.hypot(T.velocity.x, T.velocity.z) > 4.5 ? 1.6 : 1;
      const dark = T.night > 0.5 && !T.torch ? 1.5 : 1;
      const onMove = moving ? 2.2 : 1;
      const crouchK = T.crouch ? 0.9 : 1;
      const spread = g.spread * settle * run * dark * onMove * crouchK / diff.aim;
      const aim = _d.copy(T.chest).add(_a.set(rnd(-0.12, 0.12), rnd(-0.25, 0.18), rnd(-0.12, 0.12)));
      const muzzle = h.muzzle.clone();
      this.host.combat.enemyRound(muzzle, aim, spread, g.dmg, h.weapon === 'revolver' ? 'revolver' : h.weapon === 'shotgun' ? 'shotgun' : 'rifle', { pellets: g.pellets });
      this.host.combat.enemyFlash(muzzle, _a.subVectors(aim, muzzle).normalize(), h.weapon === 'shotgun' ? 1.3 : 1);
      this.host.audio.combat?.gunshot(h.weapon === 'revolver' ? 'revolver' : h.weapon === 'shotgun' ? 'shotgun' : 'rifle', muzzle);
      this.host.combat.noise(h.pos, 150, 'gunshot');
      h.recoil = 1;
      m.mag--;
      m.burst--;
      if (m.burst <= 0) { m.burst = Math.max(1, Math.round(rnd(1, g.burst))); m.fireT = g.interval * rnd(1.4, 2.4); }
      else m.fireT = g.interval * rnd(0.85, 1.15);
    }
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
    if (T.night > 0.5) range *= T.torch ? 1.5 : 0.42;
    range *= 0.3 + 0.7 * T.visibility;
    if (T.crouch && !alert) range *= 0.62;
    if (dist > range) return false;
    const look = alert ? h.aimYaw : h.yaw + h.look * 0.6;
    const fwd = _b.set(Math.sin(look), 0, Math.cos(look));
    const cosHalf = alert ? -0.2 : 0.42;
    if (dist > 2.5 && fwd.dot(_c.copy(toP).setY(0).normalize()) < cosHalf) return false;
    if (this.host.combat.clearLine(h.eye, T.chest, T.collider)) return true;
    return this.host.combat.clearLine(h.eye, T.eye, T.collider);
  }

  /** Cover from the outpost's list or sampled around: hidden when crouched, a view when standing. */
  private pickCover(m: Member, threat: THREE.Vector3) {
    if (m.cover) m.cover.taken = false;
    m.cover = null;
    const T = this.host.combat.target;
    const h = m.h;
    const prefer = m.gun.prefer;
    let best: CoverPoint | null = null;
    let bestS = Infinity;
    const consider = (c: CoverPoint) => {
      if (c.taken) return;
      const dT = c.pos.distanceTo(threat);
      const dM = c.pos.distanceTo(h.pos);
      if (dM > 28 || dT < 3) return;
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
  summon(player: THREE.Vector3, yaw: number, d = 25, n = 3, hunt = true) {
    const sq = new Squad(this, null);
    const weapons: HumanWeapon[] = ['rifle', 'shotgun', 'revolver', 'rifle', 'shotgun'];
    for (let i = 0; i < n; i++) {
      const h = this.take(weapons[i % weapons.length]);
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
    return this.members.map((m) => ({ slot: m.h.slot, state: m.state, hp: Math.round(m.hp), mag: m.mag, see: m.canSee, cover: !!m.cover, detect: +m.detect.toFixed(2) }));
  }
}
