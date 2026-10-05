import * as THREE from 'three/webgpu';
import { positionLocal, positionGeometry, uniform, vec3, sin, mix, color, float, smoothstep, positionWorld, length, cameraPosition } from 'three/tsl';
import { noise } from '@/engine/noiseTex';
import type { Heightfield } from './Heightfield';
import { Simplex2 } from '@/engine/noise';
import { norm, merge } from './kit';

function tuftGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const h = 0.35 + Math.random() * 0.4;
    const w = 0.035;
    const g = new THREE.PlaneGeometry(w, h, 1, 3);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + h / 2;
      const t = y / h;
      p.setX(k, p.getX(k) * (1 - t * 0.9));
      p.setY(k, y);
      p.setZ(k, t * t * 0.18); // curl outward
    }
    g.rotateY((i / blades) * Math.PI * 2 + Math.random() * 0.5);
    g.rotateZ((Math.random() - 0.5) * 0.4);
    parts.push(norm(g));
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

  constructor(private hf: Heightfield, density = 1) {
    this.capacity = Math.floor(9000 * density);
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
    // instancing is applied before positionNode, so positionLocal is already in world space here
    const hgt = positionGeometry.y;
    const sway = sin(this.uPhase.add(positionLocal.x.mul(0.35)).add(positionLocal.z.mul(0.27))).mul(0.5).add(0.6);
    const gust = noise(positionLocal.xz.mul(0.012).sub(this.uGust)).r;
    const bend = hgt.mul(hgt).mul(sway.add(gust)).mul(0.9);
    mat.positionNode = positionLocal.add(vec3(this.uWind.x.mul(bend), bend.mul(-0.15), this.uWind.y.mul(bend)));
    const tint = noise(positionWorld.xz.mul(0.02)).g;
    const base = mix(color('#6b5434'), color('#b89a5e'), tint);
    mat.colorNode = mix(base.mul(0.45), base.mul(1.15), smoothstep(0.0, 0.6, hgt));
    // fade out at the edge of the streaming radius
    const d = length(positionWorld.xz.sub(cameraPosition.xz));
    mat.opacityNode = smoothstep(62, 50, d);
    mat.alphaTestNode = float(0.5);
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), mat, this.capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
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
    const R = 60, cell = 1.5;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let n = 0;
    const x0 = Math.floor((focus.x - R) / cell), x1 = Math.ceil((focus.x + R) / cell);
    const z0 = Math.floor((focus.z - R) / cell), z1 = Math.ceil((focus.z + R) / cell);
    for (let iz = z0; iz <= z1 && n < this.capacity; iz++) {
      for (let ix = x0; ix <= x1 && n < this.capacity; ix++) {
        // deterministic per-cell hash
        const hsh = Math.abs(Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453) % 1;
        const hsh2 = Math.abs(Math.sin(ix * 269.5 + iz * 183.3) * 12543.123) % 1;
        const x = (ix + hsh) * cell, z = (iz + hsh2) * cell;
        if ((x - focus.x) ** 2 + (z - focus.z) ** 2 > R * R) continue;
        const dens = this.noise.fbm(x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
        if (hsh * hsh2 > dens * 0.55) continue;
        if (this.hf.roadDistanceAt(x, z) < 5) continue;
        if (this.hf.zoneDistance(x, z) < -6) continue;
        const nrm = this.hf.normalAt(x, z);
        if (nrm.y < 0.82) continue;
        const sc = 0.6 + hsh2 * 0.9;
        p.set(x, this.hf.heightAt(x, z) - 0.03, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hsh * 6.283);
        s.set(sc, sc * (0.8 + hsh * 0.5), sc);
        m.compose(p, q, s);
        this.mesh.setMatrixAt(n++, m);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
