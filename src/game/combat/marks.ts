import * as THREE from 'three/webgpu';
import { vec3, float, uv, length, smoothstep, mix, atan, sin, instancedBufferAttribute, varying, step } from 'three/tsl';
import { noise } from '@/engine/noiseTex';
import type { ImpactKind } from '@/engine/combatAudio';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Bullet marks that stay: a hole with a chipped, dusty halo on rock and concrete, a bright bare-metal
 * rim on steel, splinters on wood, a soft divot in sand. One instanced quad pool, oldest recycled.
 * Only for fixed world geometry (a mark on a moving thing would float).
 */
export class Marks {
  readonly mesh: THREE.InstancedMesh;
  private readonly N = 160;
  private next = 0;
  private info: THREE.InstancedBufferAttribute; // kind, seed, -, -

  constructor() {
    const N = this.N;
    this.info = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    const I: N = instancedBufferAttribute(this.info, 'vec4');
    const vI: N = varying(I);
    const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    // kind: 0 dirt, 1 rock/concrete, 2 metal, 3 wood
    const p = uv().sub(0.5).mul(2);
    const r = length(p);
    const a = atan(p.y, p.x);
    const kind = vI.x;
    const seed = vI.y;
    const n = noise(p.mul(0.35).add(seed.mul(13))).r;
    const jag = r.add(n.sub(0.5).mul(0.35)).add(sin(a.mul(7).add(seed.mul(40))).mul(0.04));
    const isDirt = step(kind, 0.5);
    const isMetal = step(1.5, kind).mul(step(kind, 2.5));
    const isWood = step(2.5, kind);
    // a dark hole, a sooty ring round it, then the halo: bare bright steel on metal, pale dust on
    // stone, pale splinters on wood (contrast is what makes a 5 cm mark read at ten metres)
    const hole = smoothstep(0.3, 0.22, jag);
    const soot = smoothstep(0.5, 0.3, jag).mul(float(1).sub(hole));
    const halo = smoothstep(0.85, 0.45, jag).mul(float(1).sub(hole)).mul(float(1).sub(soot.mul(0.6)));
    const splinter = smoothstep(0.6, 1.0, sin(a.mul(5).add(seed.mul(20))).abs()).mul(smoothstep(1.0, 0.35, r)).mul(isWood);
    const dark = vec3(0.025, 0.022, 0.02);
    const chip = mix(mix(vec3(0.66, 0.62, 0.56), vec3(0.85, 0.84, 0.82), isMetal), vec3(0.78, 0.66, 0.48), isWood);
    const col = mix(mix(chip, vec3(0.12, 0.1, 0.09), soot), dark, hole);
    const dirt = vec3(0.17, 0.12, 0.08);
    const haloA = mix(mix(float(0.55), float(0.9), isMetal), float(0.75), isWood);
    const alpha = mix(hole.add(soot.mul(0.7)).add(halo.mul(haloA)).add(splinter.mul(0.8)), smoothstep(0.85, 0.2, jag).mul(0.55), isDirt);
    const metal: N = isMetal.mul(halo);
    mat.colorNode = mix(col, dirt, isDirt);
    mat.opacityNode = alpha.min(1);
    mat.metalnessNode = metal.mul(0.9);
    mat.roughnessNode = mix(float(0.9), float(0.3), metal);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    for (let i = 0; i < N; i++) this.mesh.setMatrixAt(i, HIDDEN);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'bullet-marks';
    this.mesh.receiveShadow = true;
  }

  /** A mark at `p` on a surface facing `n`, from a round travelling along `dir`. */
  add(kind: ImpactKind, p: THREE.Vector3, n: THREE.Vector3, dir: THREE.Vector3 | null = null, size = 1) {
    if (kind === 'flesh' || kind === 'glass') return;
    const j = this.next;
    this.next = (this.next + 1) % this.N;
    const k = kind === 'dirt' ? 0 : kind === 'metal' ? 2 : kind === 'wood' ? 3 : 1;
    // bigger than life (a real hole is a pixel at ten metres); games always cheat this
    const sz = (k === 0 ? 0.3 : k === 2 ? 0.17 : 0.24) * size * (0.85 + Math.random() * 0.3);
    _q.setFromUnitVectors(_z, n);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(_z, Math.random() * Math.PI * 2));
    // colliders are plain boxes; the visible surface (slats, trim, posters, paint) can stand ~6 cm
    // proud of them. Back the mark up along the round's own path: it lands where you aimed, in
    // front of whatever is drawn there, and only a steep side view shows the gap.
    _s.copy(p).addScaledVector(n, 0.01);
    if (dir && kind !== 'dirt') _s.addScaledVector(dir, -0.06 / Math.max(0.35, -dir.dot(n)));
    _m.compose(_s, _q, new THREE.Vector3(sz, sz, sz));
    this.mesh.setMatrixAt(j, _m);
    const A = this.info.array as Float32Array;
    A[j * 4] = k;
    A[j * 4 + 1] = Math.random();
    this.info.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ brass

interface Casing { p: THREE.Vector3; v: THREE.Vector3; q: THREE.Quaternion; w: THREE.Vector3; floor: number; age: number; rest: boolean; kind: number; live: boolean }

/**
 * Spent brass and shotgun hulls: flipped out of the action, tumbling, bouncing on whatever is under
 * them (found once with a ray), then lying there for a while. CPU-simulated (a few dozen), drawn as
 * one instanced mesh; only touched while something is still moving.
 */
export class Brass {
  readonly mesh: THREE.InstancedMesh;
  private readonly N = 48;
  private c: Casing[] = [];
  private next = 0;
  private kinds: THREE.InstancedBufferAttribute;
  private moving = 0;
  /** Lands: `tink(pos, kind)` for the sound. */
  onLand: ((p: THREE.Vector3, kind: number) => void) | null = null;

  constructor(private floorAt: (p: THREE.Vector3) => number) {
    const N = this.N;
    this.kinds = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    const K: N = varying(instancedBufferAttribute(this.kinds, 'float'));
    const mat = new THREE.MeshStandardNodeMaterial();
    // 0 .38 / .30-30 brass, 1 red 12-gauge hull with a brass head
    const hull = step(0.5, K);
    const head = step(0.72, uv().y); // the base end of the cylinder
    // bright, not fully metallic: with little to reflect out here, pure metal goes dark brown and
    // vanishes into the sand; this reads as polished brass catching the sun
    const brass = vec3(0.95, 0.72, 0.32);
    mat.colorNode = mix(brass, mix(vec3(0.6, 0.07, 0.04), brass, head), hull);
    mat.metalnessNode = mix(float(0.5), head.mul(0.5), hull);
    mat.roughnessNode = mix(float(0.3), mix(float(0.5), float(0.3), head), hull);
    mat.emissiveNode = mix(brass.mul(0.08), vec3(0, 0, 0), hull);
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    for (let i = 0; i < N; i++) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.c.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), floor: 0, age: 0, rest: true, kind: 0, live: false });
    }
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.name = 'brass';
  }

  /** Throw one out at `p` with velocity `v` (m/s). kind 0 brass, 1 shotgun hull. */
  eject(p: THREE.Vector3, v: THREE.Vector3, kind: number) {
    const j = this.next;
    this.next = (this.next + 1) % this.N;
    const c = this.c[j];
    c.p.copy(p);
    c.v.copy(v);
    c.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    c.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    c.floor = this.floorAt(p);
    c.age = 0;
    c.rest = false;
    c.kind = kind;
    c.live = true;
    (this.kinds.array as Float32Array)[j] = kind;
    this.kinds.needsUpdate = true;
    this.moving++;
  }

  private _dq = new THREE.Quaternion();
  private _e = new THREE.Euler();
  update(dt: number) {
    let dirty = false;
    for (let j = 0; j < this.N; j++) {
      const c = this.c[j];
      if (!c.live) continue;
      c.age += dt;
      if (c.age > 40) { c.live = false; this.mesh.setMatrixAt(j, HIDDEN); dirty = true; continue; }
      if (c.rest) continue;
      dirty = true;
      c.v.y -= 9.8 * dt;
      c.p.addScaledVector(c.v, dt);
      const ang = c.w.length();
      if (ang > 1e-3) c.q.premultiply(this._dq.setFromAxisAngle(_s.copy(c.w).divideScalar(ang), ang * dt));
      const r = c.kind ? 0.013 : 0.0075; // a touch oversized, so you see them land
      if (c.p.y < c.floor + r) {
        c.p.y = c.floor + r;
        if (Math.abs(c.v.y) > 0.6) {
          this.onLand?.(c.p, c.kind);
          c.v.y = -c.v.y * 0.32;
          c.v.x *= 0.55; c.v.z *= 0.55;
          c.w.multiplyScalar(0.5);
        } else {
          // settle on its side, along whatever way it was pointing
          c.rest = true;
          this.moving--;
          const yaw = Math.atan2(c.v.x, c.v.z) + Math.random();
          c.q.setFromEuler(this._e.set(Math.PI / 2, yaw, 0, 'YXZ'));
        }
      }
      const len = c.kind ? 0.08 : 0.05;
      _m.compose(c.p, c.q, _s.set(r, len, r));
      this.mesh.setMatrixAt(j, _m);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
