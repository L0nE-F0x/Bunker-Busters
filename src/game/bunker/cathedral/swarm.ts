import * as THREE from 'three/webgpu';
import { sphereRay, type Combat, type Hostile, type HostileProvider, type RayHit, type Damage } from '../../combat/Combat';
import { box, cyl } from '../../world/kit';
import { beamMaterial } from './cathedralFx';
import type { AudioEngine } from '@/engine/audio';

type Line = { speaker: string; text: string };

/** What the swarm asks of the Cathedral. */
export interface SwarmHost {
  combat: Combat;
  audio: AudioEngine;
  say(line: Line, pos: THREE.Vector3): void;
  /** Ground height (world y) under (x, z) for a drone that fell at height y. */
  floor(x: number, z: number, y: number): number;
  /** Is the player inside the hall (floor drones see them; the swarm doesn't)? */
  inside(p: THREE.Vector3): boolean;
  /** Under cover from above (a van, the awning, the dock canopy): crouched there, nothing sees you. */
  covered(p: THREE.Vector3, crouch: boolean): boolean;
  /** How far a drone can pick you out (stealth skill, archetype, the dark). */
  sight(inside: boolean): number;
  /** Outside: a rider on an open order isn't an address. Inside: a badge isn't an obstruction. */
  exempt(inside: boolean): boolean;
  /** 'no' (hunting), 'grounded' (the swarm sits in the tower), 'off' (the ending: everything lands), 'friendly'. */
  mode(): 'no' | 'grounded' | 'off' | 'friendly';
  /** Night 0..1 (the searchlights). */
  night(): number;
  onTag(inside: boolean): void;
  onLost(inside: boolean): void;
  onCatch(inside: boolean): void;
  onDown(d: SwarmDrone, how: 'shot' | 'emp'): void;
  onRider(): void;
  lines: { tag: Line[]; lost: Line; floor: Line };
}

const PATROL = 4.2, CONVERGE = 8.5, FALL = 9.8;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

/**
 * One Dropt delivery drone: a quadcopter with a parcel under it, flying a loop (`route`, world
 * points). Outside it looks down and a little ahead for an address; inside (a floor drone) it looks
 * for obstructions. Shot or EMP'd it drops out of the air and lies where it fell; a replacement
 * launches from the bell tower a while later.
 */
export class SwarmDrone implements Hostile {
  readonly kind = 'drone' as const;
  readonly surface = 'metal' as const;
  alive = true;
  readonly center = new THREE.Vector3();
  radius = 0.7;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  tilt = 0;
  state: 'patrol' | 'converge' | 'inspect' | 'falling' | 'down' | 'home' | 'landed' = 'patrol';
  seen = 0;
  downT = 0;
  private seg = 0;
  private target = new THREE.Vector3();
  private inspectT = 0;
  private bob = Math.random() * 10;
  private spin = 0;

  constructor(readonly id: number, readonly inside: boolean, readonly route: THREE.Vector3[], private launch: THREE.Vector3) {
    this.pos.copy(route[id % route.length]);
    this.seg = id % route.length;
  }

  /** Fly toward `p` (with some lag and a bank into the turn); true once close. */
  private fly(p: THREE.Vector3, speed: number, dt: number) {
    _a.subVectors(p, this.pos);
    const d = _a.length();
    const want = d > 0.01 ? _a.multiplyScalar(Math.min(speed, d * 2) / d) : _a.set(0, 0, 0);
    this.vel.lerp(want, 1 - Math.exp(-2.6 * dt));
    this.pos.addScaledVector(this.vel, dt);
    const h = Math.hypot(this.vel.x, this.vel.z);
    if (h > 0.3) {
      const y = Math.atan2(this.vel.x, this.vel.z);
      let dy = y - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 3);
    }
    this.tilt = Math.min(0.35, h * 0.05);
    return d < 1.2;
  }

  update(dt: number, sw: Swarm) {
    this.bob += dt;
    this.spin += dt * 40;
    switch (this.state) {
      case 'patrol': {
        const p = this.route[this.seg];
        if (this.fly(p, PATROL, dt)) this.seg = (this.seg + 1) % this.route.length;
        break;
      }
      case 'converge': {
        const t = sw.goal(this.inside);
        // a ring round the address, a few metres up: they crowd you, they don't land on you
        const a = this.id * 2.39996 + sw.t * 0.6;
        this.target.set(t.x + Math.cos(a) * 1.6, t.y + (this.inside ? 2.6 : 3.2) + (this.id % 3) * 0.4, t.z + Math.sin(a) * 1.6);
        this.fly(this.target, CONVERGE, dt);
        break;
      }
      case 'inspect': {
        this.inspectT -= dt;
        this.fly(this.target, PATROL * 1.4, dt);
        if (this.inspectT <= 0) this.state = 'patrol';
        break;
      }
      case 'falling': {
        this.vel.y -= FALL * dt;
        this.vel.x *= 1 - dt * 0.5;
        this.vel.z *= 1 - dt * 0.5;
        this.pos.addScaledVector(this.vel, dt);
        this.yaw += dt * 6;
        const g = sw.host.floor(this.pos.x, this.pos.z, this.pos.y);
        if (this.pos.y <= g + 0.12) {
          this.pos.y = g + 0.12;
          this.state = 'down';
          this.tilt = 0.5;
          sw.host.audio.play('thud', { pos: this.pos, intensity: 0.35 });
          sw.host.combat.sparks?.emit(this.pos, 10, 2.5, { size: 0.02, life: 0.5, floorY: g });
        }
        break;
      }
      case 'down': {
        this.downT -= dt;
        if (this.downT <= 0) {
          // a replacement from the tower (the wreck stays where it fell: it's the next one we draw)
          this.pos.copy(this.launch);
          this.vel.set(0, 0, 0);
          this.tilt = 0;
          this.alive = true;
          this.seen = 0;
          this.state = 'patrol';
        }
        break;
      }
      case 'home': {
        if (this.fly(this.launch, PATROL * 1.5, dt)) this.state = 'landed';
        break;
      }
      case 'landed':
        this.pos.copy(this.launch);
        this.vel.set(0, 0, 0);
        break;
    }
    this.center.copy(this.pos);
  }

  /** Can it pick out the player's chest from where it is? 0, or how clearly (0..1). */
  sees(feet: THREE.Vector3, chest: THREE.Vector3, range: number, combat: Combat) {
    // a downward look, centred a little ahead of where it's going
    const ax = this.pos.x + Math.sin(this.yaw) * 2.0, az = this.pos.z + Math.cos(this.yaw) * 2.0;
    const d = Math.hypot(feet.x - ax, feet.z - az);
    if (d > range) return 0;
    if (Math.abs(this.pos.y - feet.y) > 16) return 0;
    if (!combat.clearLine(_b.copy(this.pos).setY(this.pos.y - 0.3), chest, combat.target.collider)) return 0;
    return 1 - (d / range) * 0.6;
  }

  goTo(p: THREE.Vector3, dur: number) {
    this.target.set(p.x, p.y + 3, p.z);
    this.inspectT = dur;
    this.state = 'inspect';
  }

  knock(how: 'shot' | 'emp', dur: number) {
    if (this.state === 'falling' || this.state === 'down' || this.state === 'landed') return;
    this.state = 'falling';
    this.alive = false;
    this.downT = dur;
    this.seen = 0;
    void how;
  }

  /** The instance matrix: hovering bob, bank into the turn, a wreck's tilt. */
  matrix(out: THREE.Matrix4, k = 1) {
    const flying = this.state !== 'down' && this.state !== 'landed' && this.state !== 'falling';
    const y = this.pos.y + (flying ? Math.sin(this.bob * 2.1) * 0.08 : 0);
    _e.set(flying ? this.tilt : this.state === 'down' ? 0.4 : 0, this.yaw, this.state === 'down' ? 0.6 : 0, 'YXZ');
    _q.setFromEuler(_e);
    return out.compose(_a.set(this.pos.x, y, this.pos.z), _q, _s.set(k, k, k));
  }

  // ------------------------------------------------------------------ Hostile
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (this.state === 'down' || this.state === 'landed' || this.state === 'falling') return null;
    const t = sphereRay(o, d, this.pos, 0.42);
    return t !== null && t <= max ? { t, zone: 'body' } : null;
  }

  damage(d: Damage): boolean {
    if (!this.alive) return false;
    this.knock('shot', 55);
    this.vel.addScaledVector(d.dir, 3);
    return true;
  }

  unaware() {
    return this.state === 'patrol';
  }

  awareness() {
    return this.state === 'converge' ? 1 : this.seen * 0.8;
  }

  shootable() {
    return this.alive;
  }
}

/**
 * The Cathedral's drones: the swarm over the lot and the two floor drones inside, as one hostile
 * provider and three instanced draws (bodies, lamps, searchlight cones at night). The tag is shared:
 * once one drone confirms you as an address, every drone on that side converges; enough of them
 * round you for long enough and you're returned to sender. Lose them for a while and the address
 * goes stale.
 */
export class Swarm implements HostileProvider {
  readonly list: SwarmDrone[] = [];
  readonly group = new THREE.Group();
  readonly host: SwarmHost;
  t = 0;
  /** Tagged as an address: outside, inside (the floor). */
  private tag = { out: false, in: false };
  private lostT = { out: 0, in: 0 };
  private crowdT = { out: 0, in: 0 };
  private last = { out: new THREE.Vector3(), in: new THREE.Vector3() };
  private riderSaid = -99;
  private bodies: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private loop: { setPosition(p: THREE.Vector3): void; setGain(g: number): void; setPitch(p: number): void } | null = null;
  private readonly cen = new THREE.Vector3();

  constructor(host: SwarmHost, outside: THREE.Vector3[][], floor: THREE.Vector3[][], launch: THREE.Vector3, perRoute = 2) {
    this.host = host;
    let id = 0;
    for (const r of outside) for (let k = 0; k < perRoute; k++) {
      const d = new SwarmDrone(id++, false, r, launch);
      d.pos.copy(r[(k * Math.floor(r.length / perRoute)) % r.length]);
      this.list.push(d);
    }
    for (const r of floor) this.list.push(new SwarmDrone(id++, true, r, launch));
    const n = this.list.length;
    this.bodies = new THREE.InstancedMesh(droneGeometry(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }), n);
    this.lamps = new THREE.InstancedMesh(lampGeometry(), new THREE.MeshBasicNodeMaterial({ vertexColors: true }), n);
    const cone = new THREE.ConeGeometry(2.4, 1, 18, 1, true);
    cone.translate(0, -0.5, 0);
    this.beams = new THREE.InstancedMesh(cone, beamMaterial(), n);
    this.bodies.castShadow = true;
    this.lamps.castShadow = false;
    this.beams.castShadow = false;
    this.beams.renderOrder = 20;
    for (const m of [this.bodies, this.lamps, this.beams]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.group.name = 'cathSwarm';
  }

  hostiles() {
    return this.list;
  }

  /** Where the swarm on that side is heading: the player while seen, else where they were last. */
  goal(inside: boolean) {
    return inside ? this.last.in : this.last.out;
  }

  get tagged() {
    return this.tag.out || this.tag.in;
  }

  startAudio() {
    this.loop = this.host.audio.loop('drone', this.cen) as never;
  }

  update(dt: number, feet: THREE.Vector3, chest: THREE.Vector3, crouch: boolean, near: boolean) {
    this.t += dt;
    const host = this.host;
    const mode = host.mode();
    // the ending, the splice: everything goes home and sits in the tower
    for (const d of this.list) {
      if ((mode === 'off' || (mode === 'grounded' && !d.inside)) && (d.state === 'patrol' || d.state === 'converge' || d.state === 'inspect')) d.state = 'home';
      if (mode === 'friendly' && d.state === 'converge') d.state = 'patrol';
    }
    if (mode !== 'no') { this.tag.out = this.tag.in = false; }
    const inside = host.inside(feet);
    if (near) {
      for (const d of this.list) d.update(dt, this);
      if (mode === 'no' || mode === 'grounded') this.sense(dt, feet, chest, crouch, inside);
    }
    // the instances (and the searchlights at night)
    const night = host.night();
    const lit = THREE.MathUtils.smoothstep(night, 0.25, 0.55);
    let sx = 0, sy = 0, sz = 0, nf = 0;
    this.list.forEach((d, i) => {
      const hidden = d.state === 'landed';
      this.bodies.setMatrixAt(i, d.matrix(_m, hidden ? 0 : 1));
      this.lamps.setMatrixAt(i, d.matrix(_m, hidden ? 0 : 1));
      const flying = d.state === 'patrol' || d.state === 'converge' || d.state === 'inspect' || d.state === 'home';
      if (flying && lit > 0.01 && !d.inside) {
        const g = host.floor(d.pos.x, d.pos.z, d.pos.y);
        const h = Math.max(0.5, d.pos.y - g - 0.2);
        _q.identity();
        this.beams.setMatrixAt(i, _m.compose(_a.set(d.pos.x, d.pos.y - 0.2, d.pos.z), _q, _s.set(lit * 0.9 + 0.1, h, lit * 0.9 + 0.1)));
      } else this.beams.setMatrixAt(i, _m.makeScale(0, 0, 0));
      if (flying) { sx += d.pos.x; sy += d.pos.y; sz += d.pos.z; nf++; }
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
    this.beams.visible = lit > 0.01 && near;
    this.group.visible = near;
    // one hum for the lot: at the nearest flying drone, louder the more of them are converging
    if (this.loop) {
      let best: SwarmDrone | null = null, bd = Infinity;
      for (const d of this.list) {
        if (d.state === 'down' || d.state === 'landed' || d.state === 'falling') continue;
        const q = d.pos.distanceToSquared(feet);
        if (q < bd) { bd = q; best = d; }
      }
      if (best) this.cen.copy(best.pos);
      this.loop.setPosition(this.cen);
      this.loop.setGain(near && best ? (this.tagged ? 1 : 0.7) : 0);
      this.loop.setPitch(this.tagged ? 1.3 : 1.05);
    }
    void sy; void sx; void sz; void nf;
  }

  private sense(dt: number, feet: THREE.Vector3, chest: THREE.Vector3, crouch: boolean, inside: boolean) {
    const host = this.host;
    const exempt = host.exempt(inside);
    const covered = !inside && host.covered(feet, crouch);
    const range = (inside ? 4.2 : 6.2) * host.sight(inside) * (crouch ? 0.65 : 1);
    for (const side of ['out', 'in'] as const) {
      const sideInside = side === 'in';
      let seenNow = false;
      for (const d of this.list) {
        if (d.inside !== sideInside || d.state === 'down' || d.state === 'falling' || d.state === 'landed' || d.state === 'home') continue;
        const v = inside === sideInside && !covered ? d.sees(feet, chest, range, host.combat) : 0;
        if (v > 0 && exempt) {
          if (!sideInside && this.t - this.riderSaid > 40) { this.riderSaid = this.t; host.onRider(); }
          continue;
        }
        if (v > 0) {
          seenNow = true;
          d.seen = Math.min(1, d.seen + dt * v * (crouch ? 0.9 : 1.6));
          if (d.seen >= 1 && !this.tag[side]) this.tagNow(side, feet, d);
        } else d.seen = Math.max(0, d.seen - dt * 0.4);
      }
      if (!this.tag[side]) continue;
      if (seenNow) { this.lostT[side] = 0; this.last[side].copy(feet); } else this.lostT[side] += dt;
      // the crowd: enough drones round you (close, overhead) for long enough
      let n = 0;
      for (const d of this.list) {
        if (d.inside !== sideInside || d.state !== 'converge') continue;
        if (Math.hypot(d.pos.x - feet.x, d.pos.z - feet.z) < 2.9 && d.pos.y - feet.y < 6) n++;
      }
      const need = sideInside ? 2 : 4;
      this.crowdT[side] = n >= need && inside === sideInside ? this.crowdT[side] + dt : 0;
      if (this.crowdT[side] > (sideInside ? 1.4 : 1.2)) {
        this.release(side);
        host.onCatch(sideInside);
        continue;
      }
      if (this.lostT[side] > 8) {
        this.release(side);
        host.say(host.lines.lost, this.list.find((d) => d.inside === sideInside && d.alive)?.pos ?? feet);
        host.onLost(sideInside);
      }
    }
  }

  private tagNow(side: 'out' | 'in', feet: THREE.Vector3, by: SwarmDrone) {
    this.tag[side] = true;
    this.lostT[side] = 0;
    this.crowdT[side] = 0;
    this.last[side].copy(feet);
    const lines = this.host.lines.tag;
    this.host.say(lines[Math.floor(Math.random() * lines.length)], by.pos);
    this.host.audio.combat?.machine('warble', by.pos, 0.8);
    for (const d of this.list) if (d.inside === (side === 'in') && (d.state === 'patrol' || d.state === 'inspect')) d.state = 'converge';
    this.host.onTag(side === 'in');
  }

  private release(side: 'out' | 'in') {
    this.tag[side] = false;
    this.crowdT[side] = 0;
    for (const d of this.list) {
      if (d.inside === (side === 'in') && d.state === 'converge') d.state = 'patrol';
      d.seen = 0;
    }
  }

  /** Everyone forgets (after a catch). */
  resetAll() {
    this.release('out');
    this.release('in');
  }

  /** An obstruction on the floor: the nearest floor drone goes to look. */
  inspect(p: THREE.Vector3) {
    let best: SwarmDrone | null = null, bd = Infinity;
    for (const d of this.list) {
      if (!d.inside || d.state !== 'patrol') continue;
      const q = d.pos.distanceToSquared(p);
      if (q < bd) { bd = q; best = d; }
    }
    if (best) { best.goTo(p, 5); this.host.say(this.host.lines.floor, best.pos); }
  }

  /** The alarm: drones on that side within `r` go and look. */
  investigate(p: THREE.Vector3, inside: boolean, r = 45) {
    for (const d of this.list) if (d.inside === inside && d.state === 'patrol' && d.pos.distanceTo(p) < r) d.goTo(p, 6);
  }

  /** An EMP at `pos`: drones inside the radius drop. */
  emp(pos: THREE.Vector3, r: number, dur: number) {
    let hit = false;
    for (const d of this.list) {
      if (!d.alive || d.pos.distanceTo(pos) > r) continue;
      d.knock('emp', dur);
      this.host.onDown(d, 'emp');
      hit = true;
    }
    return hit;
  }
}

// ------------------------------------------------------------------ the drone's look (vertex-coloured, one geometry)
function tint(g: THREE.BufferGeometry, c: string) {
  const col = new THREE.Color(c), n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function mergeColored(parts: THREE.BufferGeometry[]) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** A Dropt quadcopter: white shell with an orange band, four arms, motors, rotor discs, a parcel under it. */
function droneGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(tint(box(0.5, 0.16, 0.42, 0, 0, 0), '#ece9e2'));
  parts.push(tint(box(0.52, 0.05, 0.44, 0, 0.02, 0), '#e8661e'));
  parts.push(tint(box(0.3, 0.06, 0.2, 0, 0.1, -0.04), '#2a2d31'));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const ax = x * 0.42, az = z * 0.36;
    const arm = box(0.62, 0.04, 0.06, ax / 2, 0.02, az / 2, Math.atan2(-az, ax));
    parts.push(tint(arm, '#3a3d42'));
    parts.push(tint(cyl(0.05, 0.05, 0.08, ax, 0.06, az, 8), '#202225'));
    // the rotor: a thin smoky disc (reads as a spinning blade at any distance)
    parts.push(tint(cyl(0.2, 0.2, 0.01, ax, 0.11, az, 14), '#55585c'));
  }
  // the parcel in its hook, and the lamp housing under the nose
  parts.push(tint(box(0.32, 0.22, 0.28, 0, -0.22, 0.02), '#b08a5a'));
  parts.push(tint(box(0.33, 0.03, 0.06, 0, -0.17, 0.02), '#e8661e'));
  parts.push(tint(box(0.08, 0.12, 0.02, 0, -0.08, 0.02), '#3a3d42'));
  return mergeColored(parts);
}

/** The lit bits: red/green nav lights on the arms, the white lamp under the nose. */
function lampGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(tint(box(0.04, 0.04, 0.04, 0.42, 0.0, 0.36), '#ff3020'));
  parts.push(tint(box(0.04, 0.04, 0.04, -0.42, 0.0, 0.36), '#30ff60'));
  parts.push(tint(box(0.04, 0.04, 0.04, 0.42, 0.0, -0.36), '#ff3020'));
  parts.push(tint(box(0.04, 0.04, 0.04, -0.42, 0.0, -0.36), '#30ff60'));
  parts.push(tint(cyl(0.07, 0.07, 0.02, 0, -0.095, 0.18, 10), '#fff2d8'));
  return mergeColored(parts);
}
