import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, float, positionWorld, normalWorld, texture, smoothstep, mix, abs, pow, sin,
  uniform, normalView, positionView, faceDirection, step, fwidth,
} from 'three/tsl';
import { noise, fbm2 } from '@/engine/noiseTex';
import type { Heightfield } from './Heightfield';
import type { Physics } from '@/engine/physics';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** Mikkelsen surface-gradient bump from an arbitrary scalar height node. */
export const bumpFromHeight = Fn(([height, strength]: [N, N]) => {
  const dHdx = height.dFdx().mul(strength);
  const dHdy = height.dFdy().mul(strength);
  const sx = positionView.dFdx();
  const sy = positionView.dFdy();
  const n = normalView;
  const r1 = sy.cross(n);
  const r2 = n.cross(sx);
  const det = sx.dot(r1).mul(faceDirection);
  const grad = det.sign().mul(dHdx.mul(r1).add(dHdy.mul(r2)));
  return det.abs().mul(n).sub(grad).normalize();
});

export class Terrain {
  mesh: THREE.Mesh;
  far: THREE.Mesh;
  dataTexture: THREE.DataTexture;
  readonly uPlayer = uniform(new THREE.Vector3());

  constructor(private hf: Heightfield) {
    this.dataTexture = this.buildDataTexture();
    const material = this.buildMaterial();
    this.mesh = new THREE.Mesh(this.buildGeometry(), material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
    this.far = this.buildFar(material);
  }

  private buildGeometry() {
    const { res, step, size, heights } = this.hf;
    const half = size / 2;
    // main grid + a 1-ring skirt that drops 12m to hide seams with the far mesh
    const vCount = res * res + res * 4;
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const n = { x: 0, y: 1, z: 0 };
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const i = iz * res + ix;
        const x = -half + ix * step, z = -half + iz * step;
        pos[i * 3] = x;
        pos[i * 3 + 1] = heights[i];
        pos[i * 3 + 2] = z;
        this.hf.normalAt(x, z, n);
        nor[i * 3] = n.x; nor[i * 3 + 1] = n.y; nor[i * 3 + 2] = n.z;
      }
    }
    const idx: number[] = [];
    for (let iz = 0; iz < res - 1; iz++) {
      for (let ix = 0; ix < res - 1; ix++) {
        const a = iz * res + ix, b = (iz + 1) * res + ix, c = b + 1, d = a + 1;
        idx.push(a, b, d, b, c, d);
      }
    }
    // skirts
    let v = res * res;
    const edges: number[][] = [
      Array.from({ length: res }, (_, i) => i), // north row
      Array.from({ length: res }, (_, i) => (res - 1) * res + (res - 1 - i)), // south row (reversed)
      Array.from({ length: res }, (_, i) => (res - 1 - i) * res), // west col (reversed)
      Array.from({ length: res }, (_, i) => i * res + res - 1), // east col
    ];
    for (const edge of edges) {
      const start = v;
      for (const src of edge) {
        pos[v * 3] = pos[src * 3];
        pos[v * 3 + 1] = pos[src * 3 + 1] - 12;
        pos[v * 3 + 2] = pos[src * 3 + 2];
        nor[v * 3 + 1] = 1;
        v++;
      }
      for (let k = 0; k < res - 1; k++) {
        const a = edge[k], b = edge[k + 1], c = start + k + 1, d = start + k;
        idx.push(a, d, b, b, d, c, a, b, d, b, c, d); // double-sided strip
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  private buildFar(material: THREE.Material) {
    // polar ring from the playable edge out to the horizon
    const rings = 40, segs = 160;
    const inner = this.hf.size * 0.47, outer = 3600;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const rad = inner + (outer - inner) * Math.pow(t, 1.8);
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        // square-ish inner boundary so it tucks under the main grid
        const sq = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
        const rr = r === 0 ? rad * sq : rad * lerpN(sq, 1, t);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        let h = this.hf.farHeight(x, z);
        if (r === 0) h -= 6;
        // far ridgelines get taller so the horizon has silhouettes
        h += Math.pow(t, 0.7) * 40;
        pos.push(x, h, z);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = r * (segs + 1) + s, b = a + segs + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = false;
    m.name = 'farTerrain';
    return m;
  }

  /** RGBA half-float: R=highway dist, G=track dist, B=sin(dash phase), A=cos(dash phase). */
  private buildDataTexture() {
    const S = 512;
    const data = new Float32Array(S * S * 4);
    const { size } = this.hf;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const wx = ((x + 0.5) / S - 0.5) * size;
        const wz = ((y + 0.5) / S - 0.5) * size;
        const i = (y * S + x) * 4;
        const rd = this.hf.sampleGrid(this.hf.roadDist, wx, wz);
        const arc = this.hf.sampleGrid(this.hf.roadArc, wx, wz);
        data[i] = Math.min(rd, 60);
        data[i + 1] = Math.min(this.hf.sampleGrid(this.hf.trackDist, wx, wz), 60);
        data[i + 2] = Math.sin((arc / 9) * Math.PI * 2);
        data[i + 3] = Math.cos((arc / 9) * Math.PI * 2);
      }
    }
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const tex = new THREE.DataTexture(half, S, S, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  private buildMaterial() {
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    const size = this.hf.size;
    const wp = positionWorld;
    const xz = wp.xz;
    const slope = float(1).sub(normalWorld.y);
    const d = texture(this.dataTexture, xz.div(size).add(0.5));
    const roadD = d.r, trackD = d.g;
    const inside = step(abs(xz.x), size * 0.5).mul(step(abs(xz.y), size * 0.5));

    // all noise comes from the baked atlas (cheap texture taps instead of per-pixel Perlin/Worley)
    const big = fbm2(xz.div(700));
    const midTap = noise(xz.div(48));
    const mid = midTap.r.sub(0.5);
    const fine = noise(xz.div(5)).g.sub(0.5);
    const grain = noise(xz.div(1.3)).a.sub(0.5);

    // sand with wind ripples
    const warp = fbm2(xz.div(36)).mul(7);
    const ripple = sin(xz.x.mul(0.9).add(xz.y.mul(0.4)).mul(5.5).add(warp)).mul(0.5).add(0.5);
    const rippleH = pow(ripple, 2.0).mul(0.6).add(fine.mul(0.3)).add(grain.mul(0.15));
    const sandBase = mix(
      mix(vec3(0.64, 0.41, 0.23), vec3(0.50, 0.30, 0.17), smoothstep(-0.25, 0.25, big)),
      vec3(0.74, 0.54, 0.33),
      smoothstep(0.0, 0.3, mid).mul(0.5),
    );
    const sand = sandBase.mul(float(0.9).add(ripple.mul(0.1)).add(grain.mul(0.06)));

    // cracked salt / mud flats in low ground
    const lowMask = smoothstep(-6.5, -9.0, wp.y.add(mid.mul(6))).mul(smoothstep(0.25, 0.05, slope));
    const crackTap = noise(xz.div(7));
    const crk = smoothstep(0.16, 0.03, crackTap.b);
    const mud = mix(mix(vec3(0.68, 0.58, 0.46), vec3(0.54, 0.45, 0.35), crackTap.r), vec3(0.24, 0.18, 0.14), crk.mul(0.85));

    // rock / mesa faces with strata
    const rockMask = smoothstep(0.22, 0.42, slope.add(mid.mul(0.15)));
    const strataN = fbm2(xz.div(90)).mul(5);
    const strata = sin(wp.y.mul(1.6).add(strataN)).mul(0.5).add(0.5);
    // fine bands fade out once they get thinner than a pixel (they shimmered into moire on far mesas)
    const strata2 = sin(wp.y.mul(6.3).add(strataN.mul(2))).mul(0.5).add(0.5)
      .sub(0.5).mul(smoothstep(1.2, 0.35, fwidth(wp.y.mul(6.3)))).add(0.5);
    const rockTap = noise(vec2(xz.x.add(xz.y).mul(0.6), wp.y).div(4));
    const rock = mix(mix(vec3(0.30, 0.17, 0.11), vec3(0.50, 0.26, 0.14), strata), vec3(0.64, 0.42, 0.27), strata2.mul(0.35))
      .mul(float(0.8).add(rockTap.r.mul(0.35)));
    const rockH = strata2.mul(0.6).add(rockTap.r.mul(0.9)).add(rockTap.b.mul(0.4));

    // scrub patches
    const scrubMask = smoothstep(0.05, 0.25, fbm2(xz.div(80).add(0.3))).mul(float(1).sub(rockMask)).mul(0.5);

    // highway: crumbling asphalt, cracks, faded paint, drifting sand
    const edgeNoise = fbm2(xz.div(9)).mul(2.4);
    const asphaltMask = smoothstep(4.6, 3.8, roadD.add(edgeNoise)).mul(inside);
    const sandDrift = smoothstep(0.45, 0.7, noise(xz.div(22).add(0.5)).g);
    const roadCracks = smoothstep(0.1, 0.02, noise(xz.div(6).add(0.25)).b);
    const dash = smoothstep(0.1, 0.25, d.b).mul(smoothstep(0.22, 0.12, roadD));
    const sideLine = smoothstep(0.18, 0.06, abs(roadD.sub(3.3)));
    const paintWear = smoothstep(0.35, 0.6, noise(xz.div(3)).r);
    const asphalt = mix(
      mix(
        mix(mix(vec3(0.12, 0.115, 0.11), vec3(0.2, 0.19, 0.18), fine.add(0.5)), vec3(0.05), roadCracks.mul(0.8)),
        vec3(0.75, 0.55, 0.12), dash.mul(paintWear).mul(0.85),
      ),
      vec3(0.62, 0.6, 0.56), sideLine.mul(paintWear).mul(0.6),
    );
    const roadFinal = asphaltMask.mul(float(1).sub(sandDrift.mul(0.75)));

    // dirt tracks with tyre ruts
    const trackMask = smoothstep(3.6, 2.2, trackD.add(edgeNoise.mul(0.5))).mul(inside);
    const tyre = smoothstep(0.4, 0.0, abs(trackD.sub(0.95))).mul(0.25);
    const dirt = vec3(0.52, 0.38, 0.26).mul(float(1).sub(tyre)).mul(float(0.9).add(grain.mul(0.2)));

    let col: N = mix(sand, vec3(0.42, 0.34, 0.22), scrubMask);
    col = mix(col, mud, lowMask);
    col = mix(col, dirt, trackMask);
    col = mix(col, rock, rockMask);
    col = mix(col, asphalt, roadFinal);

    let h: N = mix(rippleH.mul(0.5), rockH, rockMask);
    h = mix(h, crk.mul(-0.6).add(fine.mul(0.15)), lowMask);
    h = mix(h, roadCracks.mul(-0.4).add(grain.mul(0.08)), roadFinal);
    h = mix(h, tyre.mul(-0.5).add(grain.mul(0.1)), trackMask);

    mat.colorNode = col;
    mat.normalNode = bumpFromHeight(h, float(0.06));
    mat.roughnessNode = mix(mix(float(0.97), float(0.86), rockMask), float(0.78), roadFinal);
    return mat;
  }

  addToPhysics(physics: Physics) {
    const { res, size, heights } = this.hf;
    const n = res - 1;
    // Rapier: heights[row + col*(nrows+1)] where row ↔ z, col ↔ x
    const hData = new Float32Array(res * res);
    for (let ix = 0; ix < res; ix++) {
      for (let iz = 0; iz < res; iz++) hData[iz + ix * res] = heights[iz * res + ix];
    }
    const R = physics.R;
    physics.world.createCollider(R.ColliderDesc.heightfield(n, n, hData, { x: size, y: 1, z: size }));
    // invisible boundary walls
    const h = size / 2 - 8;
    physics.addBox({ x: 0, y: 50, z: -h }, { x: h, y: 200, z: 1 });
    physics.addBox({ x: 0, y: 50, z: h }, { x: h, y: 200, z: 1 });
    physics.addBox({ x: -h, y: 50, z: 0 }, { x: 1, y: 200, z: h });
    physics.addBox({ x: h, y: 50, z: 0 }, { x: 1, y: 200, z: h });
  }
}

function lerpN(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
