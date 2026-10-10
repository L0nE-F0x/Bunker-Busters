import * as THREE from 'three/webgpu';
import { Fn, uv, vec3, vec4, float, length, smoothstep, atan, time, sin, uniform, sign, positionLocal, abs } from 'three/tsl';
import { MeshBatch, Frame, shadowProxy } from '../world/kit';
import { rustyMetal, plainStandard, glow } from '../world/materials';
import { lightCone } from '../world/effects';
import type { Physics } from '@/engine/physics';
import type { Heightfield } from '../world/Heightfield';
import type { AudioEngine } from '@/engine/audio';
import type { Interactable } from '../context';
import { capsuleRay, sphereRay, type Combat, type Hostile, type HostileProvider, type NoiseKind, type RayHit, type Damage } from './Combat';
import { OUTPOSTS, type OutpostDef } from '@/content/recovery';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * Kade's machines at the outposts:
 *  - Compliance Sentry: scans an arc, warns politely, then fires bursts down a visible laser. The
 *    sensor eye is the weak point; an EMP blinds it; from behind, with Electronics, you can pull its
 *    breaker and walk on by.
 *  - Hornet: a patrol drone that circles the pad with a searchlight, calls the crew when it sees you
 *    and fires nail bursts. Shoot it down or EMP it out of the sky.
 *  - Property-line mines in a ring round the pad: a red blink up close, a click and a beep when you
 *    step on one (you have half a second), disarmable by hand, detonated by a shot.
 */

export interface MachineHost {
  physics: Physics;
  hf: Heightfield;
  combat: Combat;
  audio: AudioEngine;
  subtitle(who: string, text: string): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void;
  xp(n: number, why: string): void;
  skill(id: 'electronics' | 'demolition'): number;
  give(id: string, n: number): void;
  /** The crew at this outpost should know about you. */
  alert(outpost: string, at: THREE.Vector3): void;
  /** Is this outpost's crew around (machines sleep with their outpost)? */
  awake(outpost: string): boolean;
  interactables: Interactable[];
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const SENTRY_LINES = [
  'Please step back. This is a safe space.',
  'You are entering a liability-free zone. Lethal force is included.',
  'For your safety, please remain still while I resolve you.',
  'This interaction may be recorded for quality and targeting purposes.',
];

// ------------------------------------------------------------------ laser line (one shared material)
let _laserMat: THREE.MeshBasicNodeMaterial | null = null;
export function laserMaterial() {
  if (_laserMat) return _laserMat;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, forceSinglePass: true });
  const u: N = uv();
  m.colorNode = Fn(() => {
    const across = float(1).sub(abs(u.y.sub(0.5)).mul(2));
    const flick = sin(time.mul(40).add(u.x.mul(60))).mul(0.15).add(0.85);
    return vec4(vec3(1.0, 0.12, 0.08).mul(across.mul(across)).mul(flick).mul(smoothstep(1, 0.6, u.x)).mul(2.2), 1);
  })();
  _laserMat = m;
  return m;
}

// ------------------------------------------------------------------ sentry

/** Debug: ?nomachlod keeps machines' tiny parts drawn at any distance (A/B). */
const NO_MACH_LOD = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nomachlod');
/**
 * Machines' tiny parts (LEDs, sensor eyes, rotor discs: 5-40 cm) are under a pixel past ~100 m
 * and cost a draw each; hide them there (with a little hysteresis so they don't flicker at the line).
 */
function detailAt(parts: THREE.Object3D[], d: number) {
  if (!parts.length) return;
  const on = parts[0].visible;
  const show = NO_MACH_LOD || (on ? d < 105 : d < 95);
  if (show !== on) for (const p of parts) p.visible = show;
}

class Sentry implements Hostile {
  readonly kind = 'turret' as const;
  readonly surface = 'metal' as const;
  readonly center = new THREE.Vector3();
  radius = 1.2;
  alive = true;
  hp = 150;
  readonly group = new THREE.Group();
  readonly head = new THREE.Group();
  private pivot = new THREE.Vector3();
  private eye: ReturnType<typeof glow>;
  private laser: THREE.Mesh;
  yaw: number;
  pitch = 0;
  state: 'off' | 'scan' | 'warn' | 'fire' | 'track' | 'blind' | 'dead' | 'breaker' = 'scan';
  private stateT = 0;
  private scanT = Math.random() * 6;
  private burst = 0;
  private fireT = 0;
  private seeT = 0;
  private readonly lastSeen = new THREE.Vector3();
  private lineI = 0;
  readonly breaker: Interactable;
  /** Tiny parts (status LED, sensor eye): sub-pixel past ~100 m, a draw each (Machines.update). */
  readonly detail: THREE.Object3D[] = [];

  constructor(private host: MachineHost, readonly outpost: string, at: THREE.Vector3, readonly baseYaw: number) {
    this.yaw = baseYaw;
    const body = rustyMetal({ base: '#d8d4ca', rust: 0.2, metalness: 0.35, roughness: 0.45 });
    const red = rustyMetal({ base: '#b02a22', rust: 0.25, metalness: 0.3, roughness: 0.5 });
    const dark = plainStandard('#1c1d1f', 0.5, 0.6);
    const mb = new MeshBatch();
    const P = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => g.applyMatrix4(new THREE.Matrix4().compose(_a.set(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), _b.set(1, 1, 1)));
    // tripod + base drum
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      mb.add(dark, P(new THREE.CylinderGeometry(0.035, 0.03, 1.15, 6), Math.sin(a) * 0.32, 0.5, Math.cos(a) * 0.32, Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45));
    }
    mb.add(red, P(new THREE.CylinderGeometry(0.22, 0.26, 0.28, 16), 0, 1.02, 0));
    mb.add(dark, P(new THREE.BoxGeometry(0.22, 0.16, 0.08), 0, 0.96, -0.25)); // rear service panel
    const led = glow('#5dff9a', 2).material;
    mb.add(led, P(new THREE.PlaneGeometry(0.05, 0.03), 0.05, 1.0, -0.291, 0, Math.PI, 0));
    const base = mb.build('sentry:base');
    this.group.add(base);
    // head: pod, twin barrels, sensor eye; pivots on yaw then pitch
    const hb = new MeshBatch();
    hb.add(body, P(new THREE.BoxGeometry(0.44, 0.3, 0.52), 0, 0, 0));
    hb.add(red, P(new THREE.BoxGeometry(0.46, 0.06, 0.54), 0, 0.12, 0));
    for (const s of [-1, 1]) hb.add(dark, P(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8).rotateX(Math.PI / 2), s * 0.12, -0.04, 0.45));
    hb.add(dark, P(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 14).rotateX(Math.PI / 2), 0, 0.03, 0.27));
    hb.add(plainStandard('#2a6a9a', 0.3, 0.2), P(new THREE.BoxGeometry(0.4, 0.02, 0.28), 0, 0.2, -0.08, -0.25, 0, 0)); // solar panel
    const headParts = hb.build('sentry:head');
    this.head.add(headParts);
    this.eye = glow('#ffb020', 6);
    const eyeMesh = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), this.eye.material);
    eyeMesh.position.set(0, 0.03, 0.302);
    this.head.add(eyeMesh);
    this.detail.push(eyeMesh, ...base.children.filter((o) => (o as THREE.Mesh).material === led));
    // the laser: a thin quad along +Z from the eye, length scaled each frame
    const lg = new THREE.PlaneGeometry(1, 0.02).translate(0.5, 0, 0).rotateY(-Math.PI / 2);
    this.laser = new THREE.Mesh(lg, laserMaterial());
    this.laser.position.set(0, 0.03, 0.31);
    this.laser.frustumCulled = false;
    const lg2 = this.laser.clone();
    lg2.rotation.z = Math.PI / 2;
    this.laser.add(lg2);
    lg2.position.set(0, 0, 0);
    this.head.add(this.laser);
    this.head.position.set(0, 1.32, 0);
    this.group.add(this.head);
    this.group.position.copy(at);
    this.group.rotation.y = 0;
    this.pivot.copy(at).setY(at.y + 1.32);
    this.center.copy(this.pivot);
    // shadows: the tripod and the head's pod cast, each through one depth draw (a proxy that rides
    // its part); the status LED, the eye and the laser quads don't (they were 3 more depth draws a
    // sentry, for slivers no one could see)
    for (const m of [base, headParts]) m.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material !== led) o.castShadow = true; });
    shadowProxy(base);
    shadowProxy(headParts);
    host.physics.addCylinder({ x: at.x, y: at.y + 0.7, z: at.z }, 0.7, 0.32);
    // the breaker on the back panel
    const back = at.clone().add(_a.set(-Math.sin(baseYaw) * 0.55, 0.9, -Math.cos(baseYaw) * 0.55));
    this.breaker = {
      id: `breaker:${outpost}:${at.x.toFixed(0)}`,
      pos: back,
      radius: 1.6,
      visible: () => this.alive && this.state !== 'breaker' && this.state !== 'off',
      primary: {
        label: 'Pull the sentry\'s breaker',
        available: () => (this.host.skill('electronics') >= 1 ? (this.state === 'fire' || this.state === 'warn' ? 'It\'s looking right at you' : true) : 'Needs Electronics 1'),
        run: () => {
          this.state = 'breaker';
          this.host.audio.combat?.machine('down', this.pivot, 0.7);
          this.host.subtitle('Compliance Sentry', 'Unscheduled maintenance. Your feedback is important to—');
          this.host.xp(20, 'Sentry switched off');
        },
      },
    };
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (!this.alive || !this.group.visible) return null;
    const eye = _a.set(0, 0.03, 0.3).applyMatrix4(this.head.matrixWorld);
    const te = sphereRay(o, d, eye, 0.09);
    const th = sphereRay(o, d, this.pivot, 0.34);
    const tb = capsuleRay(o, d, _b.copy(this.group.position).setY(this.group.position.y + 0.3), _c.copy(this.group.position).setY(this.group.position.y + 1.1), 0.28);
    let best: RayHit | null = null;
    if (th !== null && th <= max) best = { t: th, zone: 'body' };
    if (tb !== null && tb <= max && (!best || tb < best.t)) best = { t: tb, zone: 'limb' };
    if (te !== null && te <= max && (!best || te <= best.t + 0.05)) best = { t: te, zone: 'head' };
    return best;
  }

  damage(d: Damage): boolean {
    if (!this.alive) return false;
    // the sensor is the weak point; legs barely matter
    this.hp -= d.amount * (d.zone === 'head' ? 1.8 : d.zone === 'limb' ? 0.4 : 1) * (d.source === 'blast' ? 1.5 : 1);
    this.host.combat.sparks?.emit(d.point, 8, 3, { size: 0.02, life: 0.4, floorY: this.group.position.y });
    if (this.state === 'scan' || this.state === 'track') { this.state = 'warn'; this.stateT = 0.6; this.lastSeen.copy(this.host.combat.target.chest); }
    if (this.hp <= 0) {
      this.alive = false;
      this.state = 'dead';
      this.host.combat.explode(this.pivot.clone(), 2.2, 20, { source: 'player', ignore: this });
      this.host.audio.combat?.machine('down', this.pivot, 1);
      this.host.xp(25, 'Sentry destroyed');
      return true;
    }
    return false;
  }

  emp(dur: number) {
    if (!this.alive) return;
    this.state = 'blind';
    this.stateT = dur;
    this.host.combat.sparks?.emit(this.pivot, 30, 3, { electric: true, size: 0.025, life: 0.5, floorY: this.group.position.y });
  }

  reset() {
    this.alive = true;
    this.hp = 150;
    this.state = 'scan';
  }

  private sees(): boolean {
    const T = this.host.combat.target;
    if (T.hidden || !T.alive) return false;
    const to = _a.subVectors(T.chest, this.pivot);
    const d = to.length();
    // a camera sees less in the dark too, unless you walk into the floodlight
    const dark = T.night > 0.5 && !T.torch ? 0.55 + 0.45 * T.light : 1;
    if (d > 34 * (0.4 + 0.6 * T.visibility) * dark) return false;
    const look = this.state === 'scan' ? 0.62 : 1.2; // half-angle
    const yawTo = Math.atan2(to.x, to.z);
    if (Math.abs(angDiff(this.yaw, yawTo)) > look && d > 2) return false;
    // never behind its own back (that's where the breaker is)
    if (Math.abs(angDiff(this.baseYaw, yawTo)) > 2.2) return false;
    return this.host.combat.clearLine(_b.copy(this.pivot).setY(this.pivot.y + 0.05), T.chest, T.collider);
  }

  update(dt: number) {
    if (!this.group.visible) return;
    const host = this.host;
    const T = host.combat.target;
    this.stateT -= dt;
    let eyeCol = '#ffb020', eyeK = 6, laser = 0;
    switch (this.state) {
      case 'scan': {
        this.scanT += dt;
        const target = this.baseYaw + Math.sin(this.scanT * 0.55) * 1.05;
        this.yaw += angDiff(this.yaw, target) * Math.min(1, dt * 2);
        this.pitch += (-0.05 - this.pitch) * Math.min(1, dt * 2);
        eyeCol = '#5dff9a';
        laser = 1;
        if (this.sees()) {
          this.seeT += dt;
          if (this.seeT > 0.35 / host.combat.diff.react) {
            this.state = 'warn';
            this.stateT = 1.3 * host.combat.diff.react;
            this.lastSeen.copy(T.chest);
            host.audio.combat?.machine('chime', this.pivot, 1);
            if (T.chest.distanceTo(this.pivot) < 40) host.subtitle('Compliance Sentry', SENTRY_LINES[this.lineI++ % SENTRY_LINES.length]);
            host.alert(this.outpost, T.feet);
          }
        } else this.seeT = 0;
        break;
      }
      case 'warn':
      case 'fire':
      case 'track': {
        const see = this.sees();
        if (see) this.lastSeen.copy(T.chest);
        const to = _a.subVectors(this.lastSeen, this.pivot);
        const yawTo = Math.atan2(to.x, to.z);
        const pitchTo = Math.atan2(to.y, Math.hypot(to.x, to.z));
        this.yaw += angDiff(this.yaw, yawTo) * Math.min(1, dt * 5);
        this.pitch += (pitchTo - this.pitch) * Math.min(1, dt * 5);
        eyeCol = this.state === 'warn' ? '#ffb020' : '#ff2a2a';
        laser = 1.6;
        if (this.state === 'warn' && this.stateT <= 0) { this.state = see ? 'fire' : 'track'; this.stateT = 3; this.burst = 0; host.audio.combat?.machine('spinup', this.pivot, 1); }
        if (this.state === 'fire') {
          if (!see) { this.state = 'track'; this.stateT = 3; break; }
          this.fireT -= dt;
          if (this.fireT <= 0) {
            const muzzle = _b.set(this.burst % 2 ? 0.12 : -0.12, -0.04, 0.72).applyMatrix4(this.head.matrixWorld).clone();
            host.combat.enemyRound(muzzle, T.chest, 0.035 / host.combat.diff.aim, 7, 'turret');
            host.combat.enemyFlash(muzzle, _c.subVectors(T.chest, muzzle).normalize(), 0.7);
            host.audio.combat?.gunshot('turret', muzzle);
            host.combat.noise(this.pivot, 120, 'gunshot');
            this.burst++;
            this.fireT = this.burst % 5 === 0 ? 1.1 : 0.11;
          }
        }
        if (this.state === 'track') {
          if (see) { this.state = 'fire'; this.fireT = 0.3; }
          else if (this.stateT <= 0) this.state = 'scan';
        }
        break;
      }
      case 'blind':
        eyeK = Math.random() < 0.3 ? 3 : 0;
        eyeCol = '#7fe8ff';
        this.pitch += (-0.4 - this.pitch) * Math.min(1, dt * 3);
        if (this.stateT <= 0) this.state = 'scan';
        break;
      case 'breaker':
      case 'off':
        eyeK = 0;
        this.pitch += (-0.5 - this.pitch) * Math.min(1, dt * 2);
        break;
      case 'dead':
        eyeK = 0;
        this.pitch += (-0.7 - this.pitch) * Math.min(1, dt * 4);
        if (Math.random() < dt * 2) host.combat.debris.emit('smoke', this.pivot, 1, _a.set(0, 0.6, 0), 0.2, 0.25, undefined, 0.6);
        break;
    }
    this.head.rotation.set(-this.pitch, this.yaw, 0, 'YXZ');
    (this.eye.color.value as THREE.Color).set(eyeCol);
    this.eye.intensity.value = eyeK;
    // laser length: to whatever it points at
    this.laser.visible = laser > 0;
    if (laser > 0) {
      this.head.updateMatrixWorld();
      const from = _a.set(0, 0.03, 0.31).applyMatrix4(this.head.matrixWorld);
      const dir = _b.set(0, 0, 1).transformDirection(this.head.matrixWorld);
      // (the beam runs along the quads' local +Z: that axis is its length, x/y its width; the ray
      // starts clear of the sentry's own box, which used to stop it at 0)
      const hit = host.combat.worldRay(_c.copy(from).addScaledVector(dir, 0.4), dir, 45);
      this.laser.scale.set(laser, laser, (hit ? hit.t : 45) + 0.4);
    }
  }
}

// ------------------------------------------------------------------ hornet

class Hornet implements Hostile {
  readonly kind = 'drone' as const;
  readonly surface = 'metal' as const;
  readonly center = new THREE.Vector3();
  radius = 0.8;
  alive = true;
  hp = 55;
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  /** Tiny parts (eye, rotor discs): sub-pixel past ~100 m, a draw each (Machines.update). */
  readonly detail: THREE.Object3D[] = [];
  private eye: ReturnType<typeof glow>;
  private cone: ReturnType<typeof lightCone>;
  private spin = uniform(1);
  private vel = new THREE.Vector3();
  private ang = Math.random() * 6.28;
  state: 'patrol' | 'hunt' | 'down' | 'dead' | 'stunned' | 'parked' = 'patrol';
  private stateT = 0;
  private fireT = 0;
  private burst = 0;
  private seeT = 0;
  private yaw = 0;
  private vy = 0;
  private loop: ReturnType<AudioEngine['loop']> = null;
  private readonly home: THREE.Vector3;

  constructor(private host: MachineHost, readonly outpost: string, home: THREE.Vector3) {
    this.home = home.clone();
    const shell = rustyMetal({ base: '#2a2c30', rust: 0.15, metalness: 0.6, roughness: 0.4 });
    const red = rustyMetal({ base: '#b02a22', rust: 0.2, metalness: 0.3, roughness: 0.5 });
    const mb = new MeshBatch();
    const P = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => g.applyMatrix4(new THREE.Matrix4().compose(_a.set(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), _b.set(1, 1, 1)));
    mb.add(shell, P(new THREE.SphereGeometry(0.22, 16, 10), 0, 0, 0.02, 0, 0, 0).scale(1, 0.55, 1.5));
    mb.add(red, P(new THREE.BoxGeometry(0.1, 0.05, 0.4), 0, 0.1, -0.05));
    for (const [x, z] of [[0.38, 0.32], [-0.38, 0.32], [0.38, -0.32], [-0.38, -0.32]]) {
      mb.add(shell, P(new THREE.BoxGeometry(0.04, 0.03, 0.55), x / 2, 0.02, z / 2, 0, Math.atan2(x, z), 0));
      mb.add(red, P(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 10), x, 0.04, z));
    }
    mb.add(shell, P(new THREE.CylinderGeometry(0.018, 0.018, 0.28, 6).rotateX(Math.PI / 2), 0, -0.08, 0.38)); // nail gun
    const parts = mb.build('hornet');
    parts.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    shadowProxy(parts);
    this.body.add(parts);
    const rotorMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const spin = this.spin;
    // (colour and blade speed as uniforms: SeedBot's rotors share this program)
    rotorMat.colorNode = uniform(new THREE.Color(0.06, 0.06, 0.07));
    const bladeK = uniform(90);
    rotorMat.opacityNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const r = length(p);
      const a = atan(p.y, p.x);
      const dir = sign(positionLocal.x.mul(positionLocal.z));
      const blades = smoothstep(0.6, 1.0, sin(a.mul(2).add(time.mul(spin).mul(bladeK).mul(dir))).abs()).mul(0.5).add(0.18);
      return blades.mul(smoothstep(1.0, 0.92, r)).mul(smoothstep(0.08, 0.15, r)).mul(float(0.35).add(spin.mul(0.65)));
    })();
    const discs = [[0.38, 0.32], [-0.38, 0.32], [0.38, -0.32], [-0.38, -0.32]].map(([x, z]) => new THREE.CircleGeometry(0.2, 18).rotateX(-Math.PI / 2).translate(x, 0.08, z));
    const rg = new THREE.BufferGeometry();
    const merged = mergeSimple(discs);
    rg.copy(merged);
    const rotors = new THREE.Mesh(rg, rotorMat);
    this.body.add(rotors);
    this.eye = glow('#ff3a2a', 6);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), this.eye.material);
    eye.position.set(0, -0.05, 0.3);
    this.body.add(eye);
    this.detail.push(eye, rotors);
    this.cone = lightCone(16, 4.2, '#ffd8c8', 0.25);
    this.cone.mesh.position.set(0, -0.08, 0.3);
    this.cone.mesh.quaternion.setFromUnitVectors(_a.set(0, -1, 0), _b.set(0, -0.6, 0.8).normalize());
    this.body.add(this.cone.mesh);
    this.group.add(this.body);
    this.group.position.copy(home).setY(home.y + 8);
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (!this.alive || !this.group.visible) return null;
    const t = sphereRay(o, d, this.group.position, 0.45);
    return t !== null && t <= max ? { t, zone: 'body' } : null;
  }

  damage(d: Damage): boolean {
    if (!this.alive) return false;
    this.hp -= d.amount;
    this.host.combat.sparks?.emit(d.point, 10, 3, { size: 0.02, life: 0.4, floorY: this.host.hf.heightAt(d.point.x, d.point.z) });
    this.vel.addScaledVector(d.dir, 2);
    if (this.state === 'patrol') { this.state = 'hunt'; this.host.alert(this.outpost, this.host.combat.target.feet); }
    if (this.hp <= 0) { this.kill(); return true; }
    return false;
  }

  private kill() {
    this.alive = false;
    this.state = 'down';
    this.vy = 1;
    this.host.audio.combat?.machine('down', this.group.position, 1);
    this.host.xp(20, 'Hornet downed');
  }

  emp() {
    if (!this.alive) return;
    this.host.combat.sparks?.emit(this.group.position, 30, 3, { electric: true, size: 0.025, life: 0.5, floorY: this.host.hf.heightAt(this.group.position.x, this.group.position.z) });
    this.kill();
  }

  reset() {
    this.alive = true;
    this.hp = 55;
    this.state = 'patrol';
    this.group.position.copy(this.home).setY(this.home.y + 8);
  }

  private sees() {
    const T = this.host.combat.target;
    if (T.hidden || !T.alive) return false;
    const to = _a.subVectors(T.chest, this.group.position);
    const d = to.length();
    const range = (this.state === 'hunt' ? 40 : 22) * (0.4 + 0.6 * T.visibility) * (T.night > 0.5 && !T.torch && this.state !== 'hunt' ? 0.75 + 0.25 * T.light : 1);
    if (d > range) return false;
    // the searchlight cone, roughly
    const fwd = _b.set(Math.sin(this.yaw) * 0.8, -0.6, Math.cos(this.yaw) * 0.8).normalize();
    if (this.state === 'patrol' && fwd.dot(to.normalize()) < 0.72) return false;
    return this.host.combat.clearLine(this.group.position, T.chest, T.collider);
  }

  update(dt: number) {
    if (!this.group.visible) return;
    const host = this.host;
    const T = host.combat.target;
    const p = this.group.position;
    const ground = host.hf.heightAt(p.x, p.z);
    if (this.state === 'down' || this.state === 'dead') {
      // dead rotors: drop like a stone, hit, smoke
      this.spin.value = Math.max(0.02, (this.spin.value as number) - dt * 2);
      if (this.state === 'down') {
        this.vy -= 9.81 * dt;
        p.y += this.vy * dt;
        p.addScaledVector(this.vel, dt);
        this.body.rotation.x += dt * 3;
        if (p.y < ground + 0.25) {
          p.y = ground + 0.25;
          this.state = 'dead';
          host.combat.explode(p.clone(), 2.4, 25, { source: 'player', ignore: this });
          this.loop?.stop();
          this.loop = null;
        }
      } else if (Math.random() < dt * 1.5) host.combat.debris.emit('smoke', p, 1, _a.set(0, 0.6, 0), 0.2, 0.3, undefined, 0.6);
      this.cone.intensity.value = 0;
      this.eye.intensity.value = 0;
      this.center.copy(p);
      return;
    }
    if (this.state === 'parked') {
      // a forged work order: it sets down on the pad, spins down, and waits
      this.spin.value = Math.max(0, (this.spin.value as number) - dt * 0.6);
      p.y += (ground + 0.25 - p.y) * Math.min(1, dt * 0.9);
      this.vel.set(0, 0, 0);
      this.body.rotation.set(0, this.yaw, 0, 'YXZ');
      this.cone.intensity.value = 0;
      this.eye.intensity.value = 0;
      if (this.spin.value === 0) { this.loop?.stop(); this.loop = null; }
      else this.loop?.setPosition(p);
      this.center.copy(p);
      return;
    }
    if (!this.loop && host.audio.ready) this.loop = host.audio.loop('drone', p);
    this.loop?.setPosition(p);
    this.loop?.setPitch(this.state === 'hunt' ? 1.35 : 1.15);
    const see = this.sees();
    this.seeT = see ? this.seeT + dt : 0;
    let goal: THREE.Vector3;
    let speed: number;
    if (this.state === 'patrol') {
      this.ang += dt * 0.22;
      goal = _c.set(this.home.x + Math.cos(this.ang) * 24, 0, this.home.z + Math.sin(this.ang) * 24);
      goal.y = host.hf.heightAt(goal.x, goal.z) + 8;
      speed = 4;
      if (this.seeT > 0.6 / host.combat.diff.react) {
        this.state = 'hunt';
        host.audio.combat?.machine('warble', p, 1);
        host.alert(this.outpost, T.feet);
      }
    } else {
      // keep 9–12 m off, a few metres up, circling; shoot when it has you
      const away = _a.subVectors(p, T.feet).setY(0);
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      away.normalize().applyAxisAngle(_b.set(0, 1, 0), dt * 0.6);
      goal = _c.copy(T.feet).addScaledVector(away, 10);
      goal.y = host.hf.heightAt(goal.x, goal.z) + 4.5;
      speed = 7;
      this.fireT -= dt;
      if (see && this.fireT <= 0) {
        const muzzle = _b.set(0, -0.08, 0.5).applyMatrix4(this.group.matrixWorld).clone();
        host.combat.enemyRound(muzzle, T.chest, 0.04 / host.combat.diff.aim, 6, 'turret');
        host.combat.enemyFlash(muzzle, _a.subVectors(T.chest, muzzle).normalize(), 0.5);
        host.audio.combat?.gunshot('turret', muzzle);
        this.burst++;
        this.fireT = this.burst % 3 === 0 ? rnd(1.2, 2) : 0.14;
      }
      if (!see) { this.stateT += dt; if (this.stateT > 12) { this.state = 'patrol'; this.stateT = 0; } } else this.stateT = 0;
    }
    const to = _a.subVectors(goal, p);
    const want = to.clampLength(0, speed);
    this.vel.lerp(want, 1 - Math.exp(-2.5 * dt));
    p.addScaledVector(this.vel, dt);
    p.y = Math.max(p.y, ground + 1.5);
    const face = this.state === 'hunt' ? Math.atan2(T.feet.x - p.x, T.feet.z - p.z) : Math.atan2(this.vel.x, this.vel.z);
    this.yaw += angDiff(this.yaw, face) * Math.min(1, dt * 4);
    this.body.rotation.set(THREE.MathUtils.clamp(this.vel.length() * 0.05, 0, 0.3), this.yaw, Math.sin(performance.now() / 700) * 0.04, 'YXZ');
    this.spin.value = 1;
    const night = T.night > 0.5;
    this.cone.intensity.value = (night ? 0.38 : 0.08) * (this.state === 'hunt' ? 1.3 : 1);
    (this.eye.color.value as THREE.Color).set(this.state === 'hunt' ? '#ff2a2a' : '#ffb020');
    this.eye.intensity.value = 6;
    this.center.copy(p);
  }

  sleep() {
    this.loop?.stop();
    this.loop = null;
  }
}

function mergeSimple(gs: THREE.BufferGeometry[]) {
  const pos: number[] = [], uvs: number[] = [], nrm: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of gs) {
    const p = g.attributes.position, u = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); uvs.push(u.getX(i), u.getY(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(idx);
  return out;
}

// ------------------------------------------------------------------ mines

interface Mine { pos: THREE.Vector3; outpost: string; state: 'armed' | 'tripped' | 'gone' | 'safe'; t: number; i: number; hostile: MineHostile }

class MineHostile implements Hostile {
  readonly kind = 'mine' as const;
  readonly surface = 'metal' as const;
  readonly center = new THREE.Vector3();
  radius = 0.4;
  alive = true;
  constructor(private field: Minefield, readonly mine: Mine) { this.center.copy(mine.pos); }
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (this.mine.state !== 'armed' && this.mine.state !== 'tripped') return null;
    const t = sphereRay(o, d, this.mine.pos, 0.2);
    return t !== null && t <= max ? { t, zone: 'body' } : null;
  }
  damage(): boolean {
    this.field.detonate(this.mine);
    return true;
  }
}

class Minefield {
  readonly mines: Mine[] = [];
  readonly body: THREE.InstancedMesh;
  readonly led: THREE.InstancedMesh;
  private _m = new THREE.Matrix4();
  private blink = 0;
  readonly hostiles: MineHostile[] = [];

  constructor(private host: MachineHost, defs: OutpostDef[]) {
    for (const def of defs) {
      if (!def.mines) continue;
      const f = new Frame(def.x, 0, def.z, def.rot);
      for (let i = 0; i < def.mines; i++) {
        // a ring outside the walls, leaving the front gate (local +Z) clear
        let a = (i / def.mines) * Math.PI * 2 + 0.3;
        if (Math.abs(angDiff(a, 0)) < 0.35) a += 0.5;
        const r = def.r + 3 + ((i * 7) % 5);
        const p = f.p(Math.sin(a) * r, 0, Math.cos(a) * r);
        p.y = host.hf.heightAt(p.x, p.z) + 0.02;
        const mine: Mine = { pos: p, outpost: def.id, state: 'armed', t: 0, i: this.mines.length, hostile: null as unknown as MineHostile };
        mine.hostile = new MineHostile(this, mine);
        this.hostiles.push(mine.hostile);
        this.mines.push(mine);
      }
    }
    const n = Math.max(1, this.mines.length);
    this.body = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.19, 0.06, 14), rustyMetal({ base: '#4a4d42', rust: 0.6, metalness: 0.7 }), n);
    this.body.castShadow = true;
    this.led = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 6, 4), glow('#ff2010', 9).material, n);
    this.mines.forEach((m) => {
      this.body.setMatrixAt(m.i, this._m.makeTranslation(m.pos.x, m.pos.y, m.pos.z));
      this.led.setMatrixAt(m.i, this._m.makeTranslation(m.pos.x, m.pos.y + 0.04, m.pos.z));
    });
    this.body.count = this.led.count = this.mines.length;
    for (const m of this.mines) {
      host.interactables.push({
        id: `mine:${m.i}`,
        pos: m.pos.clone().setY(m.pos.y + 0.3),
        radius: 1.9,
        visible: () => m.state === 'armed',
        primary: {
          label: 'Disarm the mine',
          available: () => true,
          run: () => this.disarm(m),
        },
      });
    }
  }

  private disarm(m: Mine) {
    if (m.state !== 'armed') return;
    const demo = this.host.skill('demolition');
    if (demo < 1 && Math.random() < 0.5) {
      this.host.toast('Wrong wire.', 'bad');
      this.trip(m);
      return;
    }
    m.state = 'safe';
    this.hide(m);
    this.host.audio.play('disarm');
    this.host.give('scrap', 2);
    if (demo >= 2) this.host.give('charge', Math.random() < 0.35 ? 1 : 0);
    this.host.xp(10, 'Mine disarmed');
  }

  /** Hacked safe: the body stays where it is, the LED goes dark. */
  quiet(m: Mine) {
    if (m.state !== 'armed') return false;
    m.state = 'safe';
    this.led.setMatrixAt(m.i, this._m.makeScale(0, 0, 0));
    this.led.instanceMatrix.needsUpdate = true;
    return true;
  }

  private hide(m: Mine) {
    this.body.setMatrixAt(m.i, this._m.makeScale(0, 0, 0));
    this.led.setMatrixAt(m.i, this._m.makeScale(0, 0, 0));
    this.body.instanceMatrix.needsUpdate = this.led.instanceMatrix.needsUpdate = true;
  }

  private trip(m: Mine) {
    if (m.state !== 'armed') return;
    m.state = 'tripped';
    m.t = 0.55;
    this.host.audio.combat?.machine('armed', m.pos, 1.2);
  }

  detonate(m: Mine) {
    if (m.state !== 'armed' && m.state !== 'tripped') return;
    m.state = 'gone';
    this.hide(m);
    this.host.combat.explode(m.pos.clone().setY(m.pos.y + 0.1), 4.5, 90, { source: 'enemy', ignore: m.hostile });
  }

  reset(outpost: string) {
    for (const m of this.mines) if (m.outpost === outpost && (m.state === 'gone' || m.state === 'safe')) {
      m.state = 'armed';
      this.body.setMatrixAt(m.i, this._m.makeTranslation(m.pos.x, m.pos.y, m.pos.z));
      this.led.setMatrixAt(m.i, this._m.makeTranslation(m.pos.x, m.pos.y + 0.04, m.pos.z));
      this.body.instanceMatrix.needsUpdate = this.led.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt: number) {
    const T = this.host.combat.target;
    this.blink += dt;
    let ledDirty = false;
    for (const m of this.mines) {
      if (m.state === 'tripped') {
        m.t -= dt;
        if (m.t <= 0) this.detonate(m);
        continue;
      }
      if (m.state !== 'armed') continue;
      const d = Math.hypot(T.feet.x - m.pos.x, T.feet.z - m.pos.z);
      if (d < 0.9 && Math.abs(T.feet.y - m.pos.y) < 1) this.trip(m);
      // a red blink you can see when you're close enough to matter
      if (d < 14) {
        const on = (this.blink + m.i * 0.37) % 1.4 < 0.12;
        this.led.setMatrixAt(m.i, on ? this._m.makeTranslation(m.pos.x, m.pos.y + 0.04, m.pos.z) : this._m.makeScale(0, 0, 0));
        ledDirty = true;
      }
    }
    if (ledDirty) this.led.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the system

export class Machines implements HostileProvider {
  readonly group = new THREE.Group();
  readonly sentries: Sentry[] = [];
  readonly hornets: Hornet[] = [];
  readonly mines: Minefield;
  private all: Hostile[] = [];
  private awake = new Map<string, boolean>();

  constructor(private host: MachineHost) {
    this.group.name = 'machines';
    for (const def of OUTPOSTS) {
      const f = new Frame(def.x, 0, def.z, def.rot);
      for (const [lx, lz, yaw] of def.sentries ?? []) {
        const p = f.p(lx, 0, lz);
        p.y = host.hf.heightAt(p.x, p.z);
        const s = new Sentry(host, def.id, p, def.rot + yaw);
        this.sentries.push(s);
        this.group.add(s.group);
        host.interactables.push(s.breaker);
      }
      if (def.hornet) {
        const home = new THREE.Vector3(def.x, host.hf.heightAt(def.x, def.z), def.z);
        const h = new Hornet(host, def.id, home);
        this.hornets.push(h);
        this.group.add(h.group);
      }
    }
    this.mines = new Minefield(host, OUTPOSTS);
    this.group.add(this.mines.body, this.mines.led);
    this.all = [...this.sentries, ...this.hornets, ...this.mines.hostiles];
  }

  hostiles() {
    return this.all;
  }

  hear(pos: THREE.Vector3, radius: number, kind: NoiseKind) {
    if (kind !== 'gunshot' && kind !== 'explosion') return;
    for (const h of this.hornets) if (h.alive && h.state === 'patrol' && h.center.distanceTo(pos) < radius * 0.6) h.state = 'hunt';
  }

  /** EMP blast at `pos`: sentries go blind, hornets fall. Returns whether anything was hit. */
  emp(pos: THREE.Vector3, radius: number, dur: number) {
    let any = false;
    for (const s of this.sentries) if (s.alive && s.center.distanceTo(pos) < radius + 0.5) { s.emp(dur); any = true; }
    for (const h of this.hornets) if (h.alive && h.center.distanceTo(pos) < radius + 2) { h.emp(); any = true; }
    return any;
  }

  /** A hacked work order (`terminals.ts`): this outpost's sentries power down. Returns how many. */
  standDown(outpost: string) {
    let n = 0;
    for (const s of this.sentries) if (s.outpost === outpost && s.alive && s.state !== 'off' && s.state !== 'breaker') { s.state = 'off'; n++; }
    return n;
  }

  /** A hacked work order: the mines go dark and the Hornet parks. Returns how many machines. */
  perimeterSafe(outpost: string) {
    let n = 0;
    for (const m of this.mines.mines) if (m.outpost === outpost && this.mines.quiet(m)) n++;
    for (const h of this.hornets) if (h.outpost === outpost && h.alive && h.state !== 'parked') { h.state = 'parked'; n++; }
    return n;
  }

  /** The outpost respawned: rebuild its machines. */
  reset(outpost: string) {
    for (const s of this.sentries) if (s.outpost === outpost) s.reset();
    for (const h of this.hornets) if (h.outpost === outpost) h.reset();
    this.mines.reset(outpost);
  }

  update(dt: number, cam: THREE.Vector3) {
    for (const s of this.sentries) {
      const awake = this.host.awake(s.outpost);
      // a sentry is a small thing: past ~190 m it's a speck, and ~10 draws
      const d = cam.distanceTo(s.center);
      s.group.visible = d < 190;
      detailAt(s.detail, d);
      if (awake) s.update(dt);
    }
    for (const h of this.hornets) {
      const awake = this.host.awake(h.outpost);
      const was = this.awake.get(h.outpost) ?? false;
      if (was && !awake) h.sleep();
      h.group.visible = awake || !h.alive;
      if (awake) h.update(dt);
      detailAt(h.detail, cam.distanceTo(h.center));
    }
    for (const op of OUTPOSTS) this.awake.set(op.id, this.host.awake(op.id));
    // the field spans every mined outpost: only draw it when one is close
    const nearMines = OUTPOSTS.some((op) => op.mines && Math.hypot(cam.x - op.x, cam.z - op.z) < 120);
    this.mines.body.visible = this.mines.led.visible = nearMines;
    if (nearMines) this.mines.update(dt);
  }
}
