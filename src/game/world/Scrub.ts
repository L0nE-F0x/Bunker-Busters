import * as THREE from 'three/webgpu';
import { positionLocal, positionGeometry, uniform, vec3, vec4, sin, mix, color, float, smoothstep, positionWorld, length, cameraPosition, uv, step, varying, instancedBufferAttribute, normalView, cameraViewMatrix, normalize, dot, max, pow } from 'three/tsl';
import { noise } from '@/engine/noiseTex';
import type { Heightfield } from './Heightfield';
import { Simplex2 } from '@/engine/noise';
import { norm, merge } from './kit';
import { groundPatchAt } from './Terrain';
import { rimColor, uRimSunDir, uDaylight } from './materials';

const CELL = 1.5; // scatter grid (m)

interface Tuft { x: number; z: number; m: THREE.Matrix4; v: [number, number, number, number] }

/**
 * One tuft holds every part any tuft might show; each instance hides what it doesn't have (uv.x tags
 * the part: 0 blade, 1 seed stalk, 2 flower). Blades vary in width, height, lean and curl.
 */
function tuftGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const tag = (g: THREE.BufferGeometry, k: number) => {
    const u = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < u.count; i++) u.setX(i, k);
    return g;
  };
  const blade = (h: number, w: number, curl: number, yaw: number, tilt: number, kind = 0) => {
    const g = new THREE.PlaneGeometry(w, h, 1, 3);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + h / 2;
      const t = y / h;
      p.setX(k, p.getX(k) * (1 - t * 0.92));
      p.setY(k, y);
      p.setZ(k, t * t * curl);
    }
    g.rotateY(yaw);
    g.rotateZ(tilt);
    return tag(norm(g), kind);
  };
  const blades = 12;
  for (let i = 0; i < blades; i++) {
    const tall = Math.random();
    parts.push(blade(0.22 + tall * 0.55, 0.022 + Math.random() * 0.03, 0.08 + Math.random() * 0.22, (i / blades) * Math.PI * 2 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5));
  }
  // seed stalks: thin straight stems with a spindle of seeds on top
  for (let i = 0; i < 3; i++) {
    const h = 0.6 + Math.random() * 0.3, yaw = Math.random() * 6.3, tilt = (Math.random() - 0.5) * 0.35;
    parts.push(blade(h, 0.012, 0.05, yaw, tilt, 1));
    const head = new THREE.CylinderGeometry(0.002, 0.007, 0.14, 3, 1, true).translate(0, h + 0.04, 0.045);
    head.rotateY(yaw);
    head.rotateZ(tilt);
    parts.push(tag(norm(head), 1));
  }
  // flowers: short stems with small heads
  for (let i = 0; i < 3; i++) {
    const h = 0.2 + Math.random() * 0.2, a = Math.random() * 6.3, rr = 0.06 + Math.random() * 0.08;
    const stem = new THREE.CylinderGeometry(0.003, 0.004, h, 3).translate(Math.cos(a) * rr, h / 2, Math.sin(a) * rr);
    const head = new THREE.IcosahedronGeometry(0.022, 0).scale(1, 0.55, 1).translate(Math.cos(a) * rr, h, Math.sin(a) * rr);
    parts.push(tag(norm(stem), 2), tag(norm(head), 2));
  }
  return merge(parts);
}

/** Dry desert scrub tufts streamed around the player with GPU wind sway. */
export class Scrub {
  mesh: THREE.InstancedMesh;
  private center = new THREE.Vector2(1e9, 1e9);
  private noise = new Simplex2(4242);
  readonly uWind = uniform(new THREE.Vector2(1, 0));
  /** Sway phase, advanced faster in strong wind so tufts thrash in a storm instead of lying flat. */
  readonly uPhase = uniform(0);
  /** Gust field offset integrated on the CPU (wind × time jumped whenever the wind changed). */
  readonly uGust = uniform(new THREE.Vector2());
  private lastT = performance.now();
  private capacity: number;
  private vars: THREE.InstancedBufferAttribute;

  constructor(private hf: Heightfield, density = 1) {
    this.capacity = Math.floor(9000 * density);
    this.vars = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4);
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
    // instancing is applied before positionNode, so positionLocal is already in world space here
    const hgt = positionGeometry.y;
    const sway = sin(this.uPhase.add(positionLocal.x.mul(0.35)).add(positionLocal.z.mul(0.27))).mul(0.5).add(0.6);
    const gust = noise(positionLocal.xz.mul(0.012).sub(this.uGust)).r;
    const bend = hgt.mul(hgt).mul(sway.add(gust)).mul(0.9);
    // parts this tuft doesn't have collapse to one far point: degenerate triangles never rasterise
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vv = instancedBufferAttribute(this.vars) as any;
    const part0 = uv().x;
    const hidden = float(1).sub(mix(float(1), mix(vv.y, vv.z, step(1.5, part0)), step(0.5, part0)));
    mat.positionNode = mix(positionLocal.add(vec3(this.uWind.x.mul(bend), bend.mul(-0.15), this.uWind.y.mul(bend))), vec3(0, -9999, 0), step(0.5, hidden));
    // per tuft: x = greenness, y = seed stalks shown, z = flowers shown, w = flower hue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = varying(instancedBufferAttribute(this.vars)) as any;
    const part = uv().x;
    const tint = noise(positionWorld.xz.mul(0.02)).g;
    const dry = mix(color('#6b5434'), color('#b89a5e'), tint);
    const green = mix(color('#4b5a2a'), color('#8a9450'), tint);
    const base = mix(dry, green, v.x);
    let col = mix(base.mul(0.55), base.mul(1.15), smoothstep(0.0, 0.6, hgt));
    // stalks are paler straw, their seed heads a warm brown
    col = mix(col, mix(color('#c2a670'), color('#8a6a40'), smoothstep(0.55, 0.7, hgt)), step(0.5, part).mul(step(part, 1.5)));
    const petal = mix(mix(color('#f0c43a'), color('#9a5ad0'), smoothstep(0.3, 0.6, v.w)), color('#f2eee0'), smoothstep(0.7, 0.9, v.w));
    col = mix(col, mix(color('#4a5a2a'), petal, smoothstep(0.12, 0.18, hgt)), step(1.5, part));
    mat.colorNode = col;
    // thin blades take the light like the ground they stand on (their own normals turned a tuft into
    // black spikes whenever you faced the sun), and the sun shines through them: dry grass glows
    // straw-gold against a low sun and stays a warm silhouette at noon
    // (the light that comes through is real sunlight: the normal turns toward the sun, so the shadow
    // map still applies and a tuft in a mesa's shadow stays dark; only a faint glow skips it)
    const upView = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz;
    const sunView = cameraViewMatrix.mul(vec4(uRimSunDir, 0)).xyz;
    const toCam = normalize(cameraPosition.sub(positionWorld));
    const through = pow(max(dot(toCam.negate(), uRimSunDir), 0), 3);
    mat.normalNode = normalize(mix(normalView, upView, 0.6).add(sunView.mul(through.mul(2.5))));
    mat.emissiveNode = col.mul(rimColor).mul(through.mul(0.3).add(0.04)).mul(float(0.4).add(hgt.mul(0.9))).mul(uDaylight);
    // fade out at the edge of the streaming radius; parts this tuft doesn't have are cut away
    const d = length(positionWorld.xz.sub(cameraPosition.xz));
    mat.opacityNode = smoothstep(62, 50, d);
    mat.alphaTestNode = float(0.5);
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), mat, this.capacity);
    this.mesh.geometry.setAttribute('aVar', this.vars);
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  private cells = new Map<number, Tuft[]>();

  /** The tufts for grid cell (ix, iz) (often none). Deterministic. */
  private cell(ix: number, iz: number) {
    const key = (ix + 32768) * 65536 + (iz + 32768);
    const hit = this.cells.get(key);
    if (hit !== undefined) return hit;
    // deterministic per-cell hash
    const hsh = Math.abs(Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453) % 1;
    const hsh2 = Math.abs(Math.sin(ix * 269.5 + iz * 183.3) * 12543.123) % 1;
    const x = (ix + hsh) * CELL, z = (iz + hsh2) * CELL;
    const out: Tuft[] = [];
    const dens = this.noise.fbm(x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
    // bunchgrass grows in clumps around the few spots that hold water, with bare sand between (an
    // even field read as planted rows): clump hearts hold bunches of tufts, the gaps a few strays.
    // Desert pavement grows almost nothing, silt a little.
    const clump = this.noise.fbm(x * 0.085 + 31, z * 0.085 - 7, 2) * 0.5 + 0.5;
    const core = Math.min(1, Math.max(0, (clump - 0.45) / 0.2));
    const gp = groundPatchAt(x, z);
    const p = (0.08 + core * 0.9) * (0.6 + dens * 0.6) * (1 - gp.pave * 0.85) * (1 - gp.silt * 0.4);
    const h0 = (hsh * 3.71 + hsh2 * 1.93) % 1;
    if (h0 < p && !(this.hf.roadDistanceAt(x, z) < 5) && !(this.hf.zoneDistance(x, z) < -6) && !(this.hf.normalAt(x, z).y < 0.82)) {
      // low ground holds the last moisture: greener, taller, and that's where the flowers are
      const y0 = this.hf.heightAt(x, z);
      const moist = Math.min(1, Math.max(0, (-1.5 - y0) / 4));
      const patch = this.noise.fbm(x * 0.05 + 17, z * 0.05 - 9, 2) * 0.5 + 0.5;
      const bunch = 1 + Math.floor(core * core * 2.6 * (((hsh * 5.3) % 1) + 0.3) * (1 - gp.pave));
      for (let k = 0; k < bunch; k++) {
        const r1 = k === 0 ? 0 : Math.abs(Math.sin(ix * 41.7 + iz * 77.1 + k * 13.3) * 9137.1) % 1;
        const r2 = Math.abs(Math.sin(ix * 93.1 + iz * 17.9 + k * 5.7) * 3721.7) % 1;
        const off = k === 0 ? 0 : 0.22 + r1 * 0.45;
        const tx = x + Math.cos(r2 * 6.283) * off, tz = z + Math.sin(r2 * 6.283) * off;
        const y = k ? this.hf.heightAt(tx, tz) : y0;
        const h3 = (hsh * 7.31 + hsh2 * 3.7 + r2 * 0.61 * k) % 1;
        const green = Math.min(1, moist * 0.9 + Math.max(0, patch - 0.6) * 1.2) * (0.6 + h3 * 0.4);
        const seeds = h3 < 0.25 + patch * 0.3 ? 1 : 0;
        const flowers = h3 > 1 - (0.03 + moist * 0.25 + Math.max(0, patch - 0.7) * 0.4) ? 1 : 0;
        // clump hearts grow the big old tufts; strays and a bunch's outliers stay small
        const sc = (0.45 + ((hsh2 + r1 * 0.37) % 1) * 0.75) * (0.75 + core * 0.55) * (1 + moist * 0.3) * (k ? 0.75 : 1);
        // some tufts low and spreading, some tall and narrow
        const shape = 0.75 + ((hsh * 13.7 + r2) % 1) * 0.6;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(tx, y - 0.03, tz),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (hsh + r2) * 6.283),
          new THREE.Vector3(sc * shape, sc * (0.8 + hsh * 0.5) / shape, sc * shape),
        );
        out.push({ x: tx, z: tz, m, v: [green, seeds, flowers, (hsh2 * 9.17 + r1) % 1] });
      }
    }
    this.cells.set(key, out);
    return out;
  }

  update(focus: THREE.Vector3, wind: THREE.Vector2) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const wl = wind.length();
    this.uPhase.value = ((this.uPhase.value as number) + dt * (2.2 + Math.max(0, wl - 0.8) * 2.5)) % (Math.PI * 200);
    // stiff stems: bend saturates instead of laying the tufts flat in a gale
    const k = 0.5 * Math.min(1, 0.95 / Math.max(wl * 0.5, 1e-3)) ;
    (this.uWind.value as THREE.Vector2).set(wind.x * k, wind.y * k);
    const g = this.uGust.value as THREE.Vector2;
    g.set((g.x + wind.x * k * dt * 0.15) % 64, (g.y + wind.y * k * dt * 0.15) % 64);
    if (Math.hypot(focus.x - this.center.x, focus.z - this.center.y) < 12) return;
    this.center.set(focus.x, focus.z);
    const R = 60;
    let n = 0;
    const x0 = Math.floor((focus.x - R) / CELL), x1 = Math.ceil((focus.x + R) / CELL);
    const z0 = Math.floor((focus.z - R) / CELL), z1 = Math.ceil((focus.z + R) / CELL);
    // placement is a pure function of the cell, so each cell is evaluated once and remembered: a
    // re-scatter (every 12 m of travel) only pays for the cells entering the radius
    if (this.cells.size > 60000) this.cells.clear();
    for (let iz = z0; iz <= z1 && n < this.capacity; iz++) {
      for (let ix = x0; ix <= x1 && n < this.capacity; ix++) {
        for (const c of this.cell(ix, iz)) {
          if (n >= this.capacity || (c.x - focus.x) ** 2 + (c.z - focus.z) ** 2 > R * R) continue;
          this.vars.setXYZW(n, c.v[0], c.v[1], c.v[2], c.v[3]);
          this.mesh.setMatrixAt(n++, c.m);
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.vars.needsUpdate = true;
  }
}

/**
 * Pebbles and gravel streamed close around the player (one instanced draw): denser in stony
 * patches and on slopes, never on the road. Each stone gets its own size, squash and tint.
 */
export class Pebbles {
  readonly mesh: THREE.InstancedMesh;
  private center = new THREE.Vector2(1e9, 1e9);
  private noise = new Simplex2(777);
  private cells = new Map<number, { m: THREE.Matrix4; c: THREE.Color }[]>();
  private static readonly CELL = 1.2;
  private static readonly R = 24;

  constructor(private hf: Heightfield, geometry: THREE.BufferGeometry, material: THREE.Material, private capacity = 4000) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'pebbles';
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  }

  private cell(ix: number, iz: number) {
    const key = (ix + 32768) * 65536 + (iz + 32768);
    const hit = this.cells.get(key);
    if (hit) return hit;
    let s = (ix * 73856093) ^ (iz * 19349663);
    const r = () => ((s = (Math.imul(s, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
    const out: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const C = Pebbles.CELL;
    const x0 = ix * C, z0 = iz * C;
    const stony = this.noise.fbm(x0 * 0.04, z0 * 0.04, 2) * 0.5 + 0.5;
    const ny = this.hf.normalAt(x0, z0).y;
    // desert pavement: the stones the wind left behind, packed and dark with varnish
    const pave = groundPatchAt(x0, z0).pave * Math.min(1, Math.max(0, (ny - 0.9) / 0.06));
    const n = Math.floor((0.35 + stony * stony * 5 + (1 - ny) * 8 + pave * 3.5) * (0.6 + r() * 0.8));
    if (this.hf.roadDistanceAt(x0, z0) > 4.5 && this.hf.zoneDistance(x0, z0) > -2) {
      for (let k = 0; k < n; k++) {
        const x = x0 + r() * C, z = z0 + r() * C;
        const sz = 0.025 + Math.pow(r(), 3) * 0.11;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, this.hf.heightAt(x, z) - sz * 0.25, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.6, r() * 6.3, (r() - 0.5) * 0.6)),
          new THREE.Vector3(sz * (0.8 + r() * 0.6), sz * (0.5 + r() * 0.4), sz * (0.8 + r() * 0.6)),
        );
        const t = r();
        const c = new THREE.Color().setRGB(0.42 + t * 0.5, 0.38 + t * 0.48, 0.36 + t * 0.46);
        if (r() < pave * 0.8) c.multiply(new THREE.Color(0.62 + t * 0.2, 0.46 + t * 0.14, 0.36 + t * 0.1));
        out.push({ m, c });
      }
    }
    this.cells.set(key, out);
    return out;
  }

  /** Cell offsets within the radius, nearest first: a full pool drops the farthest stones, not a side. */
  private static ring: [number, number][] | null = null;

  update(focus: THREE.Vector3) {
    if (Math.hypot(focus.x - this.center.x, focus.z - this.center.y) < 4) return;
    this.center.set(focus.x, focus.z);
    if (this.cells.size > 40000) this.cells.clear();
    const { CELL: C, R } = Pebbles;
    if (!Pebbles.ring) {
      const k = Math.ceil(R / C) + 1, ring: [number, number][] = [];
      for (let dz = -k; dz <= k; dz++) for (let dx = -k; dx <= k; dx++) if ((dx * dx + dz * dz) * C * C <= (R + C) ** 2) ring.push([dx, dz]);
      Pebbles.ring = ring.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
    }
    let n = 0;
    const fx = Math.floor(focus.x / C), fz = Math.floor(focus.z / C);
    for (const [dx, dz] of Pebbles.ring) {
      if (n >= this.capacity) break;
      const ix = fx + dx, iz = fz + dz;
      const cx = (ix + 0.5) * C - focus.x, cz = (iz + 0.5) * C - focus.z;
      if (cx * cx + cz * cz > R * R) continue;
      for (const p of this.cell(ix, iz)) {
        if (n >= this.capacity) break;
        this.mesh.setMatrixAt(n, p.m);
        this.mesh.setColorAt(n++, p.c);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
