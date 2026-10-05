import * as THREE from 'three/webgpu';
import {
  vec2, vec3, float, positionWorld, mix, smoothstep, sin, normalWorld, color,
} from 'three/tsl';
import { Simplex2, mulberry32 } from '@/engine/noise';
import type { Heightfield } from './Heightfield';
import type { Physics } from '@/engine/physics';
import { HIGHWAY, WORLD_SEED } from '@/content/world';
import { box, cyl, beam, merge, MeshBatch, wire, canvasTexture, grime, norm } from './kit';
import { rustyMetal, plainStandard, wood } from './materials';
import { bumpFromHeight } from './Terrain';
import { noise } from '@/engine/noiseTex';

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
  tumbleweeds: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; r: number }[] = [];

  constructor(private hf: Heightfield, private physics: Physics) {
    this.group.name = 'props';
    this.scatterRocks();
    this.scatterTrees();
    this.buildCars();
    this.buildPoles();
    this.buildBillboards();
    this.buildTumbleweeds();
    this.buildFarCity();
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
        if (s > 0.9) this.physics.addBall({ x, y: y + s * 0.2, z }, s * 0.75);
      }
      mesh.count = n;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
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
    for (let i = 0; i < 70; i++) {
      const a = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(0.25 + rand() * 0.3);
      const b2 = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(0.3 + rand() * 0.35);
      twigs.push(beam(a, b2, 0.012, 3));
    }
    const geo = merge(twigs);
    const mat = plainStandard('#8a6a44', 0.95, 0, { side: THREE.DoubleSide });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      const s = 0.8 + rand() * 0.8;
      m.scale.setScalar(s);
      m.position.set(9999, 0, 0);
      this.group.add(m);
      this.tumbleweeds.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), r: 0.55 * s });
    }
  }

  /** Ruined skyline silhouette far beyond the mountains to the north-west. */
  private buildFarCity() {
    const rand = mulberry32(77);
    const parts: THREE.BufferGeometry[] = [];
    const cx = -1400, cz = -1700;
    for (let i = 0; i < 70; i++) {
      const w = 30 + rand() * 60, d = 30 + rand() * 60, h = 60 + Math.pow(rand(), 2) * 320;
      const x = cx + (rand() - 0.5) * 1400, z = cz + (rand() - 0.5) * 500;
      const tilt = rand() < 0.2 ? (rand() - 0.5) * 0.25 : 0;
      parts.push(box(w, h, d, x, h / 2 + 20, z, rand() * 0.5, 0, tilt));
      if (rand() < 0.4) parts.push(box(w * 0.5, h * 0.3, d * 0.5, x + (rand() - 0.5) * w * 0.4, h + h * 0.12 + 20, z, 0, 0, (rand() - 0.5) * 0.6));
      if (rand() < 0.25) parts.push(cyl(1.5, 1.5, 60, x, h + 50, z, 4));
    }
    const mat = plainStandard('#2a2420', 1, 0);
    const mesh = new THREE.Mesh(merge(parts), mat);
    mesh.name = 'farCity';
    this.group.add(mesh);
  }

  /** Respawn tumbleweeds upwind of the player and roll them with the wind. */
  update(dt: number, focus: THREE.Vector3, wind: THREE.Vector2) {
    const wl = Math.max(0.1, wind.length());
    for (const tw of this.tumbleweeds) {
      const p = tw.mesh.position;
      const dx = p.x - focus.x, dz = p.z - focus.z;
      if (dx * dx + dz * dz > 120 * 120 || p.x > 9000 || this.hf.zoneDistance(p.x, p.z) < 2) {
        const a = Math.random() * Math.PI * 2;
        const upwind = new THREE.Vector2(-wind.x, -wind.y).normalize();
        p.set(focus.x + upwind.x * 70 + Math.cos(a) * 50, 0, focus.z + upwind.y * 70 + Math.sin(a) * 50);
        if (this.hf.zoneDistance(p.x, p.z) < 6) { p.x = 9999; continue; }
        p.y = this.hf.heightAt(p.x, p.z) + tw.r;
        tw.vel.set(wind.x * 4, 0, wind.y * 4);
      }
      const gust = 0.7 + Math.sin(performance.now() * 0.0007 + p.x) * 0.5;
      tw.vel.x += (wind.x * 9 * gust - tw.vel.x) * dt * 0.8;
      tw.vel.z += (wind.y * 9 * gust - tw.vel.z) * dt * 0.8;
      tw.vel.y -= 14 * dt;
      p.addScaledVector(tw.vel, dt);
      const g = this.hf.heightAt(p.x, p.z) + tw.r;
      if (p.y < g) {
        p.y = g;
        tw.vel.y = Math.random() < 0.04 * wl ? 2 + Math.random() * 3 : Math.abs(tw.vel.y) * 0.3;
      }
      tw.mesh.rotation.z -= (tw.vel.x / tw.r) * dt * 0.7;
      tw.mesh.rotation.x += (tw.vel.z / tw.r) * dt * 0.7;
    }
  }
}

