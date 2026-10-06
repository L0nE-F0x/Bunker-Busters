import * as THREE from 'three/webgpu';
import {
  vec2, vec3, float, positionWorld, mix, smoothstep, sin, normalWorld, color, texture, floor, step, uv, time, fract, abs,
} from 'three/tsl';
import { Simplex2, mulberry32 } from '@/engine/noise';
import type { Heightfield } from './Heightfield';
import type { Physics } from '@/engine/physics';
import { HIGHWAY, WORLD_SEED } from '@/content/world';
import { box, cyl, beam, merge, MeshBatch, wire, canvasTexture, grime, norm, plainCaster, proxyMaterial, SHADOW_LAYER } from './kit';
import { rustyMetal, plainStandard, wood } from './materials';
import { bumpFromHeight } from './Terrain';
import { noise, noiseTexture } from '@/engine/noiseTex';
import type { Atmosphere } from './Atmosphere';

interface RockInstance { m: THREE.Matrix4; x: number; z: number; reach: number }
/** A rock is drawn within size × ROCK_REACH metres (a 0.25 m stone: ~125 m, about 2 px at 1080p). */
const ROCK_REACH = 500;
/** Rock culling is re-evaluated every this many metres of travel (and padded by as much). */
const CULL_STEP = 15;

/**
 * Static shadow casters streamed around the player in ONE depth-pass draw. Every caster's triangles
 * are pre-transformed into 32 m cells at load; whenever the player has moved REBUILD m, the cells
 * within RADIUS are copied into a single position-only mesh that only the shadow camera sees. Its
 * shadow map is the same as the originals' within RADIUS (the sun's box is ±70 m; a 10 m pole's shadow
 * at a low sun is ~60 m), and the originals stop casting.
 */
class ShadowStream {
  static readonly CELL = 32;
  static readonly RADIUS = 190;
  static readonly REBUILD = 20;
  readonly mesh: THREE.Mesh;
  private build = new Map<number, number[]>();
  private cells = new Map<number, Float32Array>();
  private at = new THREE.Vector2(1e9, 1e9);
  private pos!: THREE.BufferAttribute;

  constructor() {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), proxyMaterial(THREE.FrontSide));
    this.mesh.name = 'propShadows';
    this.mesh.layers.set(SHADOW_LAYER);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
  }

  private key(x: number, z: number) {
    const c = ShadowStream.CELL;
    return (Math.floor(x / c) + 1000) * 4096 + (Math.floor(z / c) + 1000);
  }

  private push(key: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    let arr = this.build.get(key);
    if (!arr) this.build.set(key, (arr = []));
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  /** Take over `o`'s shadow if it's a static front-faced plain caster. */
  take(o: THREE.Object3D) {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow || !mesh.visible || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mat = mesh.material as THREE.Material;
    if (!plainCaster(mat) || mat.side !== THREE.FrontSide) return;
    const geo = mesh.geometry, pos = geo.attributes.position as THREE.BufferAttribute, idx = geo.index;
    const count = idx ? idx.count : pos.count;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const tri = (m: THREE.Matrix4, i: number, key: number | null) => {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m);
      b.fromBufferAttribute(pos, ib).applyMatrix4(m);
      c.fromBufferAttribute(pos, ic).applyMatrix4(m);
      this.push(key ?? this.key((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3), a, b, c);
    };
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      const m = new THREE.Matrix4(), w = new THREE.Matrix4();
      for (let k = 0; k < im.count; k++) {
        im.getMatrixAt(k, m);
        w.multiplyMatrices(im.matrixWorld, m);
        const key = this.key(w.elements[12], w.elements[14]);
        for (let i = 0; i < count; i += 3) tri(w, i, key);
      }
    } else {
      for (let i = 0; i < count; i += 3) tri(mesh.matrixWorld, i, null);
    }
    mesh.castShadow = false;
  }

  finish() {
    for (const [k, arr] of this.build) this.cells.set(k, new Float32Array(arr));
    this.build.clear();
    // capacity: the fullest disc any focus can see (bounded per cell: every cell within RADIUS + one
    // cell diagonal of that cell's centre)
    const { CELL, RADIUS } = ShadowStream;
    const reach = RADIUS + CELL * 1.5, r = Math.ceil(reach / CELL);
    let capacity = 0, i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const k of this.cells.keys()) {
      const ci = Math.floor(k / 4096), cj = k % 4096;
      i0 = Math.min(i0, ci); i1 = Math.max(i1, ci); j0 = Math.min(j0, cj); j1 = Math.max(j1, cj);
    }
    for (let ci = i0 - r; ci <= i1 + r; ci++) for (let cj = j0 - r; cj <= j1 + r; cj++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        if ((i * i + j * j) * CELL * CELL > reach * reach) continue;
        sum += this.cells.get((ci + i) * 4096 + (cj + j))?.length ?? 0;
      }
      capacity = Math.max(capacity, sum);
    }
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity), 3);
    // static usage on purpose: three re-uploads a DynamicDrawUsage attribute on every draw; this one
    // only changes on a rebuild (needsUpdate + update range)
    this.mesh.geometry.setAttribute('position', this.pos);
    this.mesh.geometry.setDrawRange(0, 0);
    this.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), ShadowStream.RADIUS + ShadowStream.CELL);
  }

  update(focus: THREE.Vector3) {
    if (Math.hypot(focus.x - this.at.x, focus.z - this.at.y) < ShadowStream.REBUILD) return;
    this.at.set(focus.x, focus.z);
    const { CELL, RADIUS } = ShadowStream;
    const r = Math.ceil(RADIUS / CELL) + 1;
    const cx = Math.floor(focus.x / CELL), cz = Math.floor(focus.z / CELL);
    const out = this.pos.array as Float32Array;
    let n = 0;
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        // nearest point of the cell to the focus
        const x0 = (cx + i) * CELL, z0 = (cz + j) * CELL;
        const dx = Math.max(x0 - focus.x, 0, focus.x - x0 - CELL), dz = Math.max(z0 - focus.z, 0, focus.z - z0 - CELL);
        if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
        const arr = this.cells.get((cx + i + 1000) * 4096 + (cz + j + 1000));
        if (!arr || n + arr.length > out.length) continue;
        out.set(arr, n);
        n += arr.length;
      }
    }
    this.mesh.geometry.setDrawRange(0, n / 3);
    this.mesh.visible = n > 0;
    this.pos.clearUpdateRanges();
    this.pos.addUpdateRange(0, n);
    this.pos.needsUpdate = true;
    this.mesh.geometry.boundingSphere!.center.set(focus.x, focus.y, focus.z);
  }
}

export function rockMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, flatShading: true });
  const p = positionWorld;
  const n = noise(vec2(p.x.add(p.z).mul(0.12), p.y.mul(0.12).add(p.z.mul(0.05)))).r.sub(0.5).mul(2);
  const strata = sin(p.y.mul(3.0).add(n.mul(2))).mul(0.5).add(0.5);
  const top = smoothstep(0.55, 0.9, normalWorld.y);
  const base = mix(vec3(0.42, 0.27, 0.19), vec3(0.62, 0.42, 0.28), strata);
  m.colorNode = mix(base.mul(float(0.8).add(n.mul(0.3))), vec3(0.78, 0.58, 0.40), top.mul(0.6));
  m.normalNode = bumpFromHeight(n.add(strata.mul(0.3)), float(0.05));
  return m;
}

function rockGeometry(seed: number, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const noise = new Simplex2(seed);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const squash = 0.55 + (seed % 7) * 0.06;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + noise.fbm(v.x * 1.3 + seed, v.z * 1.3 + v.y, 3) * 0.35;
    v.multiplyScalar(k);
    v.y *= squash;
    // flat-ish bottom so it sits in the sand
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return norm(g);
}

function deadTreeGeometry(seed: number) {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const end = start.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(r * 0.65, r, len, 6, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyMatrix4(new THREE.Matrix4().compose(start.clone().lerp(end, 0.5), q, new THREE.Vector3(1, 1, 1)));
    parts.push(norm(g));
    if (depth <= 0 || r < 0.03) return;
    const n = depth > 2 ? 2 : 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const nd = dir.clone()
        .add(new THREE.Vector3((rand() - 0.5) * 1.6, rand() * 0.6, (rand() - 0.5) * 1.6))
        .normalize();
      grow(end, nd, len * (0.6 + rand() * 0.25), r * 0.62, depth - 1);
    }
  };
  grow(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3((rand() - 0.5) * 0.3, 1, (rand() - 0.5) * 0.3).normalize(), 2.2 + rand(), 0.22, 4);
  return merge(parts);
}

/** Side profile of a 70s sedan extruded into a body. */
function carBody(rand: () => number) {
  const s = new THREE.Shape();
  const L = 4.6;
  s.moveTo(-L / 2, 0.35);
  s.lineTo(-L / 2, 0.85);
  s.lineTo(-L / 2 + 0.15, 0.95);
  s.lineTo(-1.0, 1.0);
  s.lineTo(-0.55, 1.45);
  s.lineTo(0.75, 1.45);
  s.lineTo(1.2, 1.0);
  s.lineTo(L / 2 - 0.1, 0.92);
  s.lineTo(L / 2, 0.75);
  s.lineTo(L / 2, 0.35);
  // wheel arches
  s.lineTo(1.75, 0.35);
  s.absarc(1.35, 0.35, 0.42, 0, Math.PI, false);
  s.lineTo(-0.95, 0.35);
  s.absarc(-1.35, 0.35, 0.42, 0, Math.PI, false);
  s.lineTo(-L / 2, 0.35);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -0.85);
  void rand;
  return norm(g);
}

const BILLBOARDS = [
  { title: 'BUNKR.LY', line1: 'Why survive', line2: 'when you can THRIVE?', foot: 'Waitlist: CLOSED forever', bg: ['#0d2b45', '#1f6f8b'], accent: '#ffd23f' },
  { title: 'OMNICLOUD', line1: 'Your data will outlive you.', line2: '99.999% uptime*', foot: '*humans not included', bg: ['#2b0f3a', '#a03aa0'], accent: '#5ef2ff' },
  { title: 'APEX MOTORS', line1: 'Mars or Bust.', line2: 'We chose Bust.', foot: 'Now accepting pre-orders. Still.', bg: ['#3a1208', '#d4471f'], accent: '#ffffff' },
];

export class Props {
  group = new THREE.Group();
  /** Tumbleweeds share one InstancedMesh (one draw call + one shadow call instead of ten each). */
  tumbleweeds: { pos: THREE.Vector3; rot: THREE.Euler; scale: number; vel: THREE.Vector3; r: number }[] = [];
  private tumbleMesh!: THREE.InstancedMesh;
  /** Rock variants with every placed instance; update() keeps only the ones big enough to see. */
  private rocks: { mesh: THREE.InstancedMesh; all: RockInstance[] }[] = [];
  /** Every static prop's shadow in one streamed draw (see ShadowStream). */
  private shadows!: ShadowStream;
  private cullAt = new THREE.Vector2(1e9, 1e9);
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _s = new THREE.Vector3();

  constructor(private hf: Heightfield, private physics: Physics, private atmo?: Atmosphere) {
    this.group.name = 'props';
    this.scatterRocks();
    this.scatterTrees();
    this.buildCars();
    this.buildPoles();
    this.buildBillboards();
    this.buildTumbleweeds();
    this.buildFarCity();
    // Shadow pass: rocks, trees, wrecks, poles, wires and billboards were ~12 draws covering the
    // whole map. Now one mesh holds the casters near the player, rebuilt as they walk. Tumbleweeds
    // move, so they keep their own.
    this.shadows = new ShadowStream();
    this.group.updateMatrixWorld(true);
    for (const o of [...this.group.children]) {
      if (o === this.tumbleMesh) continue;
      o.traverse((c) => this.shadows.take(c));
    }
    this.shadows.finish();
    this.group.add(this.shadows.mesh);
  }

  private okSpot(x: number, z: number, roadClear = 9, zoneClear = 8) {
    const lim = this.hf.size * 0.4;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    return this.hf.roadDistanceAt(x, z) > roadClear && this.hf.zoneDistance(x, z) > zoneClear;
  }

  private scatterRocks() {
    const rand = mulberry32(WORLD_SEED + 1);
    const mat = rockMaterial();
    const variants = [rockGeometry(3), rockGeometry(11), rockGeometry(29), rockGeometry(57, 1)];
    const counts = [160, 160, 120, 90];
    const dummy = new THREE.Object3D();
    const noise = new Simplex2(5);
    variants.forEach((geo, vi) => {
      const mesh = new THREE.InstancedMesh(geo, mat, counts[vi]);
      const all: RockInstance[] = [];
      let n = 0;
      let guard = 0;
      while (n < counts[vi] && guard++ < 20000) {
        const x = (rand() - 0.5) * this.hf.size * 0.82;
        const z = (rand() - 0.5) * this.hf.size * 0.82;
        // clustered: prefer rocky noise areas & slopes
        const cluster = noise.fbm(x * 0.01, z * 0.01, 2);
        if (cluster < 0.05 && rand() > 0.15) continue;
        if (!this.okSpot(x, z, 7, 4)) continue;
        const big = rand() < 0.07;
        const s = big ? 2.5 + rand() * 3.5 : 0.25 + Math.pow(rand(), 2) * 1.6;
        const y = this.hf.heightAt(x, z) - s * 0.15;
        dummy.position.set(x, y, z);
        dummy.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4);
        dummy.scale.set(s * (0.8 + rand() * 0.5), s, s * (0.8 + rand() * 0.5));
        dummy.updateMatrix();
        mesh.setMatrixAt(n++, dummy.matrix);
        all.push({ m: dummy.matrix.clone(), x, z, reach: Math.max(s, 0.1) * ROCK_REACH });
        if (s > 0.9) this.physics.addBall({ x, y: y + s * 0.2, z }, s * 0.75);
      }
      mesh.count = n;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.rocks.push({ mesh, all });
    });
  }

  private scatterTrees() {
    const rand = mulberry32(WORLD_SEED + 2);
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
    const n = noise(positionWorld.xz.add(positionWorld.y).mul(0.4)).r.sub(0.5).mul(2);
    m.colorNode = mix(color('#5a4636'), color('#a39282'), smoothstep(-0.4, 0.6, n).mul(0.7).add(positionWorld.y.mul(0.03)));
    m.normalNode = bumpFromHeight(noise(vec2(positionWorld.x.add(positionWorld.z).mul(2.5), positionWorld.y.mul(0.25))).r, float(0.03));
    const variants = [deadTreeGeometry(7), deadTreeGeometry(19), deadTreeGeometry(42)];
    const dummy = new THREE.Object3D();
    variants.forEach((geo) => {
      const mesh = new THREE.InstancedMesh(geo, m, 30);
      let c = 0, guard = 0;
      while (c < 30 && guard++ < 5000) {
        const x = (rand() - 0.5) * this.hf.size * 0.8;
        const z = (rand() - 0.5) * this.hf.size * 0.8;
        if (!this.okSpot(x, z, 8, 6)) continue;
        const nn = this.hf.normalAt(x, z);
        if (nn.y < 0.9) continue;
        const s = 0.8 + rand() * 0.9;
        const y = this.hf.heightAt(x, z);
        dummy.position.set(x, y, z);
        dummy.rotation.set((rand() - 0.5) * 0.15, rand() * Math.PI * 2, (rand() - 0.5) * 0.15);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        mesh.setMatrixAt(c++, dummy.matrix);
        this.physics.addCylinder({ x, y: y + 1.5, z }, 1.5, 0.25 * s);
      }
      mesh.count = c;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    });
  }

  /** Point & tangent along the highway at arc length t (0..1). */
  private highwayAt(t: number) {
    const pts = HIGHWAY.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    return { p, tan };
  }

  private buildCars() {
    const rand = mulberry32(WORLD_SEED + 3);
    const paints = ['#7a8f86', '#a3542f', '#c9b37a', '#3d5a6c', '#8a2f2a', '#d6d0c0', '#4c6b3c'];
    const tireMat = plainStandard('#151312', 0.95);
    const glassMat = plainStandard('#0b0f12', 0.15, 0.6);
    const chromeMat = rustyMetal({ base: '#9a9a96', rust: 0.35, metalness: 0.9, roughness: 0.35 });
    const body = carBody(rand);
    // every wreck goes into one shared batch → one draw call per material for all 16 cars
    const all = new MeshBatch();
    for (let i = 0; i < 16; i++) {
      const t = 0.06 + (i / 16) * 0.88 + (rand() - 0.5) * 0.03;
      const { p, tan } = this.highwayAt(t);
      const side = new THREE.Vector3(-tan.z, 0, tan.x);
      const off = (rand() - 0.5) * 9 + (rand() < 0.3 ? (rand() < 0.5 ? -9 : 9) : 0);
      const x = p.x + side.x * off, z = p.z + side.z * off;
      if (this.hf.zoneDistance(x, z) < 4) continue;
      const y = this.hf.heightAt(x, z);
      const yaw = Math.atan2(-tan.z, tan.x) + (rand() - 0.5) * 0.9 + (rand() < 0.2 ? Math.PI : 0);
      const flipped = rand() < 0.12;
      // rust quantised to two levels so equal paints share one cached material
      const paint = rustyMetal({ base: paints[i % paints.length], rust: rand() < 0.5 ? 0.55 : 0.8, metalness: 0.4, roughness: 0.6, rim: 0.4 });
      const parts: [THREE.Material, THREE.BufferGeometry][] = [
        [paint, body.clone()],
        [glassMat, box(1.2, 0.38, 1.62, 0.1, 1.22, 0, 0)], // windows (inset dark panels)
        [chromeMat, box(0.1, 0.18, 1.8, 2.32, 0.48, 0)],
        [chromeMat, box(0.1, 0.18, 1.8, -2.32, 0.48, 0)],
      ];
      // wheels (some missing)
      for (const [wx, wz] of [[1.35, 0.85], [1.35, -0.85], [-1.35, 0.85], [-1.35, -0.85]]) {
        if (rand() < 0.25) continue;
        parts.push([tireMat, cyl(0.36, 0.36, 0.26, wx, 0.36, wz, 12, Math.PI / 2)]);
      }
      const sink = rand() * 0.25;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y - sink - (flipped ? -1.5 : 0), z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(flipped ? Math.PI : (rand() - 0.5) * 0.08, yaw, flipped ? 0 : (rand() - 0.5) * 0.1)),
        new THREE.Vector3(1, 1, 1),
      );
      for (const [mat, g] of parts) all.add(mat, g.applyMatrix4(m));
      this.physics.addBox({ x, y: y + 0.8, z }, { x: 2.3, y: 0.8, z: 0.9 }, yaw);
    }
    this.group.add(all.build('cars'));
  }

  private buildPoles() {
    const woodMat = wood('#4a3626');
    const wireMat = plainStandard('#0c0a09', 0.6, 0.3);
    const insulMat = plainStandard('#3b4a46', 0.3, 0.1);
    const b = new MeshBatch();
    const wires: THREE.BufferGeometry[] = [];
    let prevTops: THREE.Vector3[] | null = null;
    const rand = mulberry32(WORLD_SEED + 4);
    const N = 34;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const { p, tan } = this.highwayAt(t);
      const side = new THREE.Vector3(-tan.z, 0, tan.x);
      const x = p.x + side.x * 11, z = p.z + side.z * 11;
      if (Math.abs(x) > this.hf.size * 0.42 || Math.abs(z) > this.hf.size * 0.42) { prevTops = null; continue; }
      const y = this.hf.heightAt(x, z);
      const yaw = Math.atan2(-tan.z, tan.x);
      const fallen = rand() < 0.08;
      if (fallen) {
        b.add(woodMat, cyl(0.16, 0.2, 9.5, x + side.x * 4.5, y + 0.2, z + side.z * 4.5, 8, 0, -yaw, Math.PI / 2 - 0.05));
        prevTops = null;
        continue;
      }
      const lean = (rand() - 0.5) * 0.12;
      const H = 9.5;
      const pole = cyl(0.14, 0.2, H, 0, H / 2, 0, 8);
      const arm = box(2.6, 0.18, 0.14, 0, H - 0.8, 0);
      const ins: THREE.BufferGeometry[] = [-1.1, 0, 1.1].map((o) => cyl(0.06, 0.08, 0.3, o, H - 0.55, 0, 6));
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y - 0.3, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw + Math.PI / 2, lean * 0.5)),
        new THREE.Vector3(1, 1, 1),
      );
      for (const g of [pole, arm]) { g.applyMatrix4(m); b.add(woodMat, g); }
      ins.forEach((g) => { g.applyMatrix4(m); b.add(insulMat, g); });
      const tops = [-1.1, 0, 1.1].map((o) => new THREE.Vector3(o, H - 0.4, 0).applyMatrix4(m));
      if (prevTops) {
        for (let k = 0; k < 3; k++) {
          if (rand() < 0.1) continue; // snapped wire
          wires.push(wire(prevTops[k], tops[k], 1.2 + rand() * 0.6, 0.022));
        }
      }
      prevTops = tops;
      this.physics.addCylinder({ x, y: y + H / 2, z }, H / 2, 0.22);
    }
    this.group.add(b.build('poles'));
    const w = new THREE.Mesh(merge(wires), wireMat);
    w.castShadow = true;
    this.group.add(w);
  }

  private buildBillboards() {
    const placements: [number, number, number][] = [
      [-262, 66, 0.35],
      [44, 104, -0.35],
      [258, -58, 0.62],
    ];
    const postMat = rustyMetal({ base: '#5a5550', rust: 0.7 });
    placements.forEach(([bx, bz, yaw], i) => {
      const ad = BILLBOARDS[i % BILLBOARDS.length];
      const tex = canvasTexture(1024, 512, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, ad.bg[0]);
        g.addColorStop(1, ad.bg[1]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        // sunburst
        ctx.save();
        ctx.translate(w * 0.82, h * 0.5);
        for (let k = 0; k < 18; k++) {
          ctx.rotate((Math.PI * 2) / 18);
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(600, -40);
          ctx.lineTo(600, 40);
          ctx.fill();
        }
        ctx.restore();
        ctx.fillStyle = ad.accent;
        ctx.font = '900 120px "Big Shoulders Stencil Display", Impact, sans-serif';
        ctx.fillText(ad.title, 50, 150);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 58px "Chakra Petch", Arial, sans-serif';
        ctx.fillText(ad.line1, 54, 260);
        ctx.fillText(ad.line2, 54, 330);
        ctx.font = '500 30px "Chakra Petch", Arial, sans-serif';
        ctx.globalAlpha = 0.8;
        ctx.fillText(ad.foot, 56, 440);
        ctx.globalAlpha = 1;
        grime(ctx, w, h, 1.2, i + 3);
      });
      const y = this.hf.heightAt(bx, bz);
      const grp = new THREE.Group();
      const b = new MeshBatch();
      b.add(postMat, box(0.35, 9, 0.35, -4, 4.5, 0), box(0.35, 9, 0.35, 4, 4.5, 0), box(10.6, 0.3, 0.3, 0, 5.8, -0.2), box(10.6, 0.2, 1.2, 0, 5.7, 0.5));
      grp.add(b.build('billboardFrame'));
      const panelMat = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.8 });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), panelMat);
      panel.position.set(0, 8.4, 0.05);
      panel.castShadow = true;
      panel.receiveShadow = true;
      // tear a corner by rotating a small flap
      grp.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), postMat);
      back.rotation.y = Math.PI;
      back.position.set(0, 8.4, 0.0);
      grp.add(back);
      grp.position.set(bx, y - 0.2, bz);
      grp.rotation.y = yaw;
      this.group.add(grp);
      for (const sx of [-4, 4]) {
        const p = new THREE.Vector3(sx, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        this.physics.addCylinder({ x: bx + p.x, y: y + 4.5, z: bz + p.z }, 4.5, 0.3);
      }
    });
  }

  private buildTumbleweeds() {
    const rand = mulberry32(WORLD_SEED + 5);
    const twigs: THREE.BufferGeometry[] = [];
    // a hollow tangle: curved twigs wrapping a squashed sphere, a few spokes through the middle
    const v = new THREE.Vector3(), t = new THREE.Vector3(), prev = new THREE.Vector3();
    for (let i = 0; i < 90; i++) {
      v.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      t.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).cross(v).normalize();
      const R = 0.36 + rand() * 0.16, arc = 0.5 + rand() * 0.9, segs = 3;
      const axis = new THREE.Vector3().crossVectors(v, t).normalize();
      prev.copy(v).multiplyScalar(R);
      for (let k = 1; k <= segs; k++) {
        const p = v.clone().applyAxisAngle(axis, (arc * k) / segs).multiplyScalar(R * (1 + (rand() - 0.5) * 0.12));
        p.y *= 0.85;
        twigs.push(beam(prev.clone(), p, 0.006 + rand() * 0.006, 3));
        prev.copy(p);
      }
    }
    for (let i = 0; i < 12; i++) {
      const a = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(0.4);
      twigs.push(beam(a, a.clone().multiplyScalar(-0.6 - rand() * 0.4), 0.014, 3));
    }
    const geo = merge(twigs);
    const mat = plainStandard('#8a6a44', 0.95, 0, { side: THREE.DoubleSide });
    const N = 10;
    this.tumbleMesh = new THREE.InstancedMesh(geo, mat, N);
    this.tumbleMesh.castShadow = true;
    this.tumbleMesh.frustumCulled = false;
    this.tumbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.tumbleMesh);
    for (let i = 0; i < N; i++) {
      const sc = 0.8 + rand() * 0.8;
      this.tumbleweeds.push({ pos: new THREE.Vector3(9999, -999, 0), rot: new THREE.Euler(rand() * 6, rand() * 6, 0), scale: sc, vel: new THREE.Vector3(), r: 0.5 * sc });
    }
  }

  /** Ground height of the far terrain ring (mirrors Terrain.buildFar) so distant ruins sit on it. */
  private farGround(x: number, z: number) {
    const inner = this.hf.size * 0.47, outer = 3600;
    const t = Math.pow(Math.min(1, Math.max(0, (Math.hypot(x, z) - inner) / (outer - inner))), 1 / 1.8);
    return this.hf.farHeight(x, z) + Math.pow(t, 0.7) * 40;
  }

  /**
   * The dead megacity on the north-west horizon: supertall towers (some snapped, one leaning, one
   * stripped to its frame) over a band of mid-rises. One merged mesh. At night a few windows are still
   * lit and aviation beacons blink on the tallest roofs (uv.x > 1.5 marks beacon geometry).
   */
  private buildFarCity() {
    const rand = mulberry32(77);
    const parts: THREE.BufferGeometry[] = [];
    const beacons: THREE.BufferGeometry[] = [];
    const cx = -1500, cz = -1950;
    const ax = new THREE.Vector2(0.8, -0.6); // the city's long axis (roughly across the view from camp)
    const at = (u: number, v: number) => [cx + ax.x * u - ax.y * v, cz + ax.y * u + ax.x * v] as const;
    // mid-rise band
    for (let i = 0; i < 46; i++) {
      const [x, z] = at((rand() - 0.5) * 1900, (rand() - 0.5) * 520);
      const w = 40 + rand() * 70, d = 40 + rand() * 70, h = 70 + Math.pow(rand(), 1.5) * 200;
      const y0 = this.farGround(x, z) - 15;
      const tilt = rand() < 0.15 ? (rand() - 0.5) * 0.3 : 0;
      parts.push(box(w, h, d, x, y0 + h / 2, z, rand() * 0.6, 0, tilt));
      if (rand() < 0.35) parts.push(box(w * 0.55, h * 0.25, d * 0.55, x + (rand() - 0.5) * w * 0.3, y0 + h * 1.12, z, rand(), 0, (rand() - 0.5) * 0.5));
    }
    // supertalls
    const towers = 10;
    for (let i = 0; i < towers; i++) {
      const [x, z] = at(((i + 0.5) / towers - 0.5) * 1300 + (rand() - 0.5) * 90, (rand() - 0.5) * 260);
      const H = 380 + Math.pow(rand(), 0.8) * 460;
      let w = 70 + rand() * 50, d = 60 + rand() * 50;
      const ry = rand() * 0.8;
      const fate = rand();
      const lean = fate > 0.85 ? 0.11 * (rand() < 0.5 ? -1 : 1) : 0;
      const ground = this.farGround(x, z);
      let y = ground - 20;
      const segs = 3 + Math.floor(rand() * 3);
      const skeletal = fate > 0.7 && fate <= 0.85;
      for (let s = 0; s < segs; s++) {
        const h = (H / segs) * (0.8 + rand() * 0.4);
        const last = s === segs - 1;
        const lx = x + Math.sin(lean) * (y + h / 2 - ground), ly = y + h / 2;
        if (last && skeletal) {
          // stripped frame: corner columns + floor rings
          for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(box(7, h, 7, lx + (sx * w) / 2.2, ly, z + (sz * d) / 2.2, ry));
          for (let k = 0; k < 5; k++) parts.push(box(w, 5, d, lx, y + (k + 0.5) * (h / 5), z, ry));
        } else if (last && fate < 0.3) {
          // snapped top: a slab hanging off at an angle
          parts.push(box(w, h * 0.55, d, lx, y + h * 0.27, z, ry, 0, lean));
          parts.push(box(w * 0.9, h * 0.5, d * 0.9, lx + w * 0.35, y + h * 0.62, z, ry, 0, 0.45 + rand() * 0.3));
        } else {
          parts.push(box(w, h, d, lx, ly, z, ry, 0, lean));
        }
        y += h;
        w *= 0.72 + rand() * 0.14;
        d *= 0.72 + rand() * 0.14;
      }
      const topX = x + Math.sin(lean) * (y - ground);
      if (fate >= 0.3 && !skeletal) {
        if (rand() < 0.6) parts.push(cyl(2.5, 4, 90 + rand() * 80, topX, y + 60, z, 5));
        const bg = new THREE.BoxGeometry(9, 9, 9);
        bg.translate(topX, y + 6, z);
        beacons.push(bg);
      }
    }
    const geo = merge([...parts, ...beacons.map((bg) => {
      const n = norm(bg);
      (n.attributes.uv.array as Float32Array).fill(2);
      return n;
    })]);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
    const p = positionWorld;
    const tone = noise(p.xz.div(300)).r;
    mat.colorNode = mix(vec3(0.07, 0.065, 0.06), vec3(0.14, 0.12, 0.1), tone);
    if (this.atmo) {
      const night = this.atmo.uNight;
      // window cells (~3.5 m x 4 m); the atlas' per-texel hash decides which still have power
      const cell = vec2(floor(p.x.add(p.z).div(3.5)), floor(p.y.div(4)));
      const h = texture(noiseTexture(), cell.add(0.5).div(256)).level(float(0)).a;
      const side = step(abs(normalWorld.y), 0.5);
      const flick = sin(time.mul(h.mul(7).add(1)).add(h.mul(90))).mul(0.15).add(0.85);
      const lit = step(0.985, h).mul(side).mul(flick);
      const warm = mix(vec3(1.0, 0.55, 0.22), vec3(0.55, 0.85, 1.0), step(0.996, h));
      const beacon = step(1.5, uv().x).mul(step(0.82, fract(time.mul(0.55))));
      mat.emissiveNode = warm.mul(lit).mul(9).add(vec3(1.0, 0.08, 0.04).mul(beacon).mul(60)).mul(night);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'farCity';
    this.group.add(mesh);
  }

  /**
   * Main pass: a rock only draws while it could cover more than ~2 px (reach = size × ROCK_REACH, re-checked
   * every CULL_STEP m of travel). Big boulders show across the map; pebbles past ~120 m are skipped.
   */
  private cullRocks(focus: THREE.Vector3) {
    this.cullAt.set(focus.x, focus.z);
    for (const { mesh, all } of this.rocks) {
      let n = 0;
      for (const r of all) {
        const dx = r.x - focus.x, dz = r.z - focus.z, reach = r.reach + CULL_STEP;
        if (dx * dx + dz * dz < reach * reach) mesh.setMatrixAt(n++, r.m);
      }
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  /** Respawn tumbleweeds upwind of the player and roll them with the wind. */
  update(dt: number, focus: THREE.Vector3, wind: THREE.Vector2) {
    this.shadows.update(focus);
    if (Math.hypot(focus.x - this.cullAt.x, focus.z - this.cullAt.y) > CULL_STEP) this.cullRocks(focus);
    const wl = Math.max(0.1, wind.length());
    // storms make them bound: bigger hops, more often
    const hopChance = 0.04 * wl * (wl > 1.8 ? 2.5 : 1);
    let i = 0;
    for (const tw of this.tumbleweeds) {
      const p = tw.pos;
      const dx = p.x - focus.x, dz = p.z - focus.z;
      if (dx * dx + dz * dz > 120 * 120 || p.x > 9000 || this.hf.zoneDistance(p.x, p.z) < 2) {
        const a = Math.random() * Math.PI * 2;
        const upwind = new THREE.Vector2(-wind.x, -wind.y).normalize();
        p.set(focus.x + upwind.x * 70 + Math.cos(a) * 50, 0, focus.z + upwind.y * 70 + Math.sin(a) * 50);
        if (this.hf.zoneDistance(p.x, p.z) < 6) {
          p.set(9999, -999, 0);
        } else {
          p.y = this.hf.heightAt(p.x, p.z) + tw.r;
          tw.vel.set(wind.x * 4, 0, wind.y * 4);
        }
      }
      if (p.x < 9000) {
        const gust = 0.7 + Math.sin(performance.now() * 0.0007 + p.x) * 0.5;
        tw.vel.x += (wind.x * 9 * gust - tw.vel.x) * dt * 0.8;
        tw.vel.z += (wind.y * 9 * gust - tw.vel.z) * dt * 0.8;
        tw.vel.y -= 14 * dt;
        p.addScaledVector(tw.vel, dt);
        const g = this.hf.heightAt(p.x, p.z) + tw.r;
        if (p.y < g) {
          p.y = g;
          tw.vel.y = Math.random() < hopChance ? 2 + Math.random() * 3 * Math.min(2, wl) : Math.abs(tw.vel.y) * 0.3;
        }
        tw.rot.z -= (tw.vel.x / tw.r) * dt * 0.7;
        tw.rot.x += (tw.vel.z / tw.r) * dt * 0.7;
      }
      this._m.compose(p, this._q.setFromEuler(tw.rot), this._s.setScalar(tw.scale));
      this.tumbleMesh.setMatrixAt(i++, this._m);
    }
    this.tumbleMesh.instanceMatrix.needsUpdate = true;
  }
}
