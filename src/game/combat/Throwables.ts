import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import type { AudioEngine } from '@/engine/audio';
import type { Heightfield } from '../world/Heightfield';
import { VirtualLight } from '../world/lights';
import { plainStandard } from '../world/materials';
import { Fire } from '../world/effects';
import type { Combat, Hostile } from './Combat';

/**
 * Thrown fire: the Reserve Molotov. A real bottle (a Rapier body, like the EMP canister) that breaks on
 * the first hard knock, or after four seconds of rolling, and leaves a patch of burning fuel. The patch
 * hurts whatever stands in it (contractors, wolves, snakes, you) a few times a second, lights the
 * ground at night through a pooled VirtualLight, and crackles. Fire ignores cover: it's for the crew
 * dug in behind a truck, and for the pack that won't stop circling.
 *
 * Every mesh is built at boot (hidden) from programs the scene already has (the plain prop material,
 * the camp fire's flame cards, the shared flame/smoke sprites), and the lights are pooled
 * VirtualLights made here: nothing compiles and no light is created when the first bottle flies
 * (the pipeline count is unchanged; scratchpad items-test.mjs).
 */

const FIRE_R = 2.6;
const FIRE_S = 8;
const TICK = 0.25;
/** Damage per tick to a hostile standing in it (flesh; machines take a third). ~36 per second. */
const BURN = 9;
const BURN_PLAYER = 5;

interface Bottle { mesh: THREE.Group; body: ReturnType<Physics['world']['createRigidBody']>; fuse: number; lastVel: THREE.Vector3; armed: number }
interface Patch { p: THREE.Vector3; t: number; tick: number; crackle: number; light: VirtualLight; emit: number; fire: Fire; zone: { p: THREE.Vector3; r: number; t: number } }

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** Fuel smoke is black, not the pale dust a gun or a blast kicks up. */
const SOOT = new THREE.Color(0.08, 0.075, 0.07);

export class Throwables {
  readonly group = new THREE.Group();
  private pool: THREE.Group[] = [];
  private flying: Bottle[] = [];
  private patches: Patch[] = [];
  private lights = [new VirtualLight(0xff8a3a, 0, 14, 2), new VirtualLight(0xff8a3a, 0, 14, 2)];
  /** The camp fire's flame cards (the same program, so nothing new compiles), one per light: the body
   *  of the blaze that reads by day, where the additive tongues wash out. Stones, logs, embers hidden. */
  private fires: Fire[] = [];
  private lightI = 0;

  constructor(private physics: Physics, private hf: Heightfield, private combat: Combat, private audio: AudioEngine) {
    this.group.name = 'throwables';
    for (const l of this.lights) l.priority = 9;
    for (let i = 0; i < this.lights.length; i++) {
      const f = new Fire(1.1, 0);
      f.light.intensity = 0; // never updated: the patch's own light flickers instead
      for (const c of f.group.children.slice(1)) c.visible = false; // embers, stones, logs
      f.group.visible = false;
      this.fires.push(f);
      this.group.add(f.group);
    }
    for (let i = 0; i < 3; i++) {
      const b = bottleMesh();
      b.visible = false;
      this.pool.push(b);
      this.group.add(b);
    }
  }

  /** Burning patches right now (for the HUD / tests). */
  get burning() {
    return this.patches.length;
  }

  /** Throw from `eye` along `dir` (unit), adding the thrower's velocity. */
  throwMolotov(eye: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3, carry: THREE.Vector3) {
    const mesh = this.pool.find((b) => !b.visible) ?? this.pool[0];
    const old = this.flying.find((f) => f.mesh === mesh);
    if (old) this.burst(old, old.mesh.position.clone());
    mesh.visible = true;
    const start = _v.copy(eye).addScaledVector(right, 0.2).add(_w.set(0, -0.12, 0));
    const fwd = _w.copy(dir);
    fwd.y = Math.max(fwd.y + 0.28, 0.1);
    fwd.normalize();
    start.addScaledVector(fwd, 0.45);
    mesh.position.copy(start);
    const R = this.physics.R;
    const vel = fwd.clone().multiplyScalar(13).add(carry.clone().setY(Math.max(0, carry.y)));
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(start.x, start.y, start.z)
        .setLinvel(vel.x, vel.y, vel.z)
        .setAngvel({ x: right.x * -11, y: (Math.random() - 0.5) * 4, z: right.z * -11 })
        .setCcdEnabled(true),
    );
    this.physics.world.createCollider(R.ColliderDesc.cylinder(0.11, 0.04).setDensity(600).setRestitution(0.2), body);
    this.flying.push({ mesh, body, fuse: 4, lastVel: vel.clone(), armed: 0.12 });
  }

  private burst(b: Bottle, at: THREE.Vector3) {
    this.physics.world.removeRigidBody(b.body);
    this.flying.splice(this.flying.indexOf(b), 1);
    b.mesh.visible = false;
    this.ignite(at);
  }

  /** Burning fuel on the ground at `at` (a bottle broke there). Public for tests and future content. */
  ignite(at: THREE.Vector3) {
    const ground = this.hf.heightAt(at.x, at.z);
    // on a roof or a crate it burns where it broke; on the desert, on the sand
    const y = at.y - ground < 1.2 ? ground : at.y - 0.1;
    const p = new THREE.Vector3(at.x, y, at.z);
    this.audio.combat?.molotov(p);
    // the whoomp: a low, wide roll of flame (not a fireball: fuel, not explosive)
    this.combat.flames.emit(0, _v.copy(p).setY(y + 0.25), 9, _w.set(0, 1.6, 0), 2.2, 0.55, 0.7, 1.8, 1.6);
    this.combat.debris.emit('chunk', p, 8, _w.set(0, 3, 0), 3, 0.02);
    this.combat.debris.emit('smoke', _v.copy(p).setY(y + 0.6), 4, _w.set(0, 1.8, 0), 1.2, 0.9, SOOT, 1.2);
    this.combat.noise(p, 45, 'can');
    // the fuel scorches the ground it lands on: two overlapping sooty smudges (the marks pool's sand
    // divot, scaled up: brown-black with a ragged edge, on any ground)
    if (y === ground) {
      const n = this.hf.normalAt(p.x, p.z);
      _up.set(n.x, n.y, n.z).normalize();
      // lifted 10 cm: the quad is metres wide, the terrain isn't a plane, and road decks sit above it
      this.combat.marks.add('dirt', _v.copy(p).addScaledVector(_up, 0.1), _up, null, 8.5);
      this.combat.marks.add('dirt', _v.set(p.x + (Math.random() - 0.5) * 0.8, p.y, p.z + (Math.random() - 0.5) * 0.8).addScaledVector(_up, 0.11), _up, null, 6);
    }
    const slot = this.lightI++ % this.lights.length;
    const light = this.lights[slot];
    const fire = this.fires[slot];
    const prev = this.patches.find((q) => q.light === light);
    if (prev) { this.patches.splice(this.patches.indexOf(prev), 1); this.dropZone(prev.zone); }
    light.position.copy(p).setY(y + 0.8);
    light.intensity = 30;
    fire.group.position.copy(p);
    fire.group.rotation.y = Math.random() * Math.PI;
    fire.group.scale.set(1, 0.05, 1);
    fire.group.visible = true;
    // the AI's view of it (Combat.fires): contractors and animals keep out of burning ground
    const zone = { p, r: FIRE_R, t: 0 };
    this.combat.fires.push(zone);
    this.patches.push({ p, t: 0, tick: 0, crackle: 0, light, emit: 0, fire, zone });
  }

  private dropZone(z: Patch['zone']) {
    const i = this.combat.fires.indexOf(z);
    if (i >= 0) this.combat.fires.splice(i, 1);
  }

  /** A run ends (death aside: quit to the title): bottles in the air and fuel on the ground go out. */
  reset() {
    for (const b of this.flying) { this.physics.world.removeRigidBody(b.body); b.mesh.visible = false; }
    this.flying = [];
    for (const f of this.patches) { f.light.intensity = 0; f.fire.group.visible = false; this.dropZone(f.zone); }
    this.patches = [];
    this.combat.fires.length = 0;
  }

  update(dt: number) {
    for (const b of [...this.flying]) {
      b.fuse -= dt;
      b.armed -= dt;
      const t = b.body.translation(), r = b.body.rotation(), v = b.body.linvel();
      b.mesh.position.set(t.x, t.y, t.z);
      b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      // the rag trails a little fire
      if (Math.random() < 0.5) this.combat.flames.emit(0, _v.set(t.x, t.y + 0.08, t.z), 1, _w.set(0, 0.6, 0), 0.15, 0.1, 0.22, 1.2, 1.6);
      const jolt = Math.hypot(v.x - b.lastVel.x, v.y - b.lastVel.y, v.z - b.lastVel.z);
      b.lastVel.set(v.x, v.y, v.z);
      if ((b.armed <= 0 && jolt > 2.2) || b.fuse <= 0 || t.y < -200) this.burst(b, _v.set(t.x, t.y, t.z).clone());
    }
    for (const f of [...this.patches]) {
      f.t += dt;
      const life = 1 - f.t / FIRE_S;
      if (life <= 0) {
        f.light.intensity = 0;
        f.fire.group.visible = false;
        this.patches.splice(this.patches.indexOf(f), 1);
        this.dropZone(f.zone);
        continue;
      }
      const k = Math.min(1, life * 2.2);
      f.zone.t = f.t;
      f.zone.r = FIRE_R * (0.6 + 0.4 * k);
      // the blaze: flares up in a third of a second, wide and low (a puddle, not a bonfire), then
      // sinks with the fuel; a slow breathing so it never looks like a card
      const up = Math.min(1, f.t / 0.35);
      const breathe = 1 + Math.sin(f.t * 5.3) * 0.06 + Math.sin(f.t * 11.7) * 0.04;
      f.fire.group.scale.set(1 + 0.25 * k, Math.max(0.05, up * (0.3 + 0.5 * k) * breathe), 1 + 0.25 * k);
      // tongues of flame over the whole puddle (a steady rate, not per frame), thinning as the fuel goes:
      // small, short-lived and dim each, so overlapping tongues read as fire and not a white blob. By
      // day the fireball sprites start pale and wash to white on bright sand, so the flame cards carry
      // the shape and the tongues thin to a few licks at the edge
      const day = THREE.MathUtils.clamp(this.combat.atmo.sunElevation * 3, 0, 1);
      f.emit += dt * (14 + 22 * k) * (1 - 0.7 * day);
      for (; f.emit >= 1; f.emit--) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * FIRE_R * (0.55 + 0.45 * k);
        _v.set(f.p.x + Math.cos(a) * rr, f.p.y + 0.1, f.p.z + Math.sin(a) * rr);
        const edge = rr / FIRE_R;
        this.combat.flames.emit(0, _v, 1, _w.set(0, 0.9 + Math.random() * 0.9 * (1 - edge * 0.5), 0), 0.18, (0.2 + 0.22 * k) * (1.15 - edge * 0.4), 0.45 + Math.random() * 0.3, 1.5, 1.25);
      }
      if (Math.random() < dt * 6) this.combat.debris.emit('smoke', _v.set(f.p.x, f.p.y + 1, f.p.z), 1, _w.set(0, 1.4, 0), 0.6, 0.8 * k, SOOT, 1.4);
      f.light.intensity = (16 + Math.sin(f.t * 23) * 3 + Math.sin(f.t * 9.7) * 4) * k;
      f.crackle -= dt;
      if (f.crackle <= 0) { f.crackle = 0.28 + Math.random() * 0.2; this.audio.combat?.crackle(f.p, k); }
      f.tick -= dt;
      if (f.tick > 0) continue;
      f.tick = TICK;
      this.burn(f.p, k);
    }
  }

  private burn(p: THREE.Vector3, k: number) {
    const r = FIRE_R * (0.6 + 0.4 * k);
    for (const pr of this.combat.providers) {
      for (const h of pr.hostiles()) {
        if (!h.alive) continue;
        const d = Math.hypot(h.center.x - p.x, h.center.z - p.z);
        if (d > r + h.radius * 0.5 || h.center.y - p.y > 2.4 || p.y - h.center.y > 1.2) continue;
        this.scorch(h, p);
      }
    }
    const t = this.combat.target;
    if (t.alive && Math.hypot(t.feet.x - p.x, t.feet.z - p.z) < r && Math.abs(t.feet.y - p.y) < 1.2) {
      this.combat.hurtPlayer(BURN_PLAYER, p, 'blast');
    }
  }

  private scorch(h: Hostile, p: THREE.Vector3) {
    const amt = BURN * (h.surface === 'metal' ? 0.33 : 1) * this.combat.diff.dealt;
    const dir = _w.subVectors(h.center, p).setY(0.3).normalize().clone();
    const killed = h.damage({ amount: amt, dir, point: h.center.clone(), zone: 'body', source: 'blast' });
    this.combat.hooks?.onHit(killed ? 'kill' : 'hit', h);

  }
}

/** A tall square mezcal bottle with a rag stuffed in the neck: dark glass, a cream label, the rag. */
export function bottleMesh() {
  const g = new THREE.Group();
  const glass = plainStandard('#2d3a2a', 0.12, 0.15);
  const label = plainStandard('#d8ccb0', 0.7, 0);
  const rag = plainStandard('#6e6458', 0.95, 0);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const o = new THREE.Mesh(geo, m);
    o.position.y = y;
    o.castShadow = true;
    g.add(o);
  };
  add(new THREE.CylinderGeometry(0.036, 0.04, 0.15, 4, 1).rotateY(Math.PI / 4), glass, 0);
  add(new THREE.CylinderGeometry(0.0412, 0.0412, 0.06, 4, 1, true).rotateY(Math.PI / 4), label, -0.01);
  add(new THREE.CylinderGeometry(0.014, 0.034, 0.04, 10), glass, 0.095);
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.04, 10), glass, 0.13);
  add(new THREE.CylinderGeometry(0.02, 0.012, 0.07, 6), rag, 0.17);
  return g;
}
