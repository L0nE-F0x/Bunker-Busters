import * as THREE from 'three/webgpu';
import { Fn, vec2, vec4, float, uniform, time, positionWorld, smoothstep, mix, sin, uv, attribute, clamp, viewportLinearDepth, linearDepth, cameraFar, cameraNear } from 'three/tsl';
import { noise } from '@/engine/noiseTex';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** The coolant's glow (0 … 1: it's lit from the pumps' lamps and its own dye) and how cold it is (1 full … 0 drained/warm). */
export const uCoolGlow = uniform(0.6);
export const uCoolCold = uniform(1);

/**
 * The moat's coolant: a pale, slightly luminous blue-green with slow currents and a skin of frost
 * at the edges, opaque enough to hide the trench bed. Warm (the chillers off) it goes grey and
 * still; drained, the runtime drops the surface to a film on the bed.
 */
export function coolantMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0.0, color: '#0f3b46' });
  m.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const flow = noise(p.mul(0.08).add(vec2(time.mul(0.012), time.mul(-0.007)))).r;
    const fine = noise(p.mul(0.45).add(vec2(time.mul(-0.03), time.mul(0.02)))).g;
    const base = mix(vec4(0.02, 0.09, 0.11, 1).xyz, vec4(0.06, 0.2, 0.24, 1).xyz, flow.mul(0.7).add(fine.mul(0.3)));
    // frost rafts drifting on the surface while it's cold
    const raft = smoothstep(0.58, 0.8, noise(p.mul(0.035).add(vec2(time.mul(0.002), 0))).b).mul(uCoolCold);
    return mix(mix(vec4(0.16, 0.17, 0.18, 1).xyz, base, uCoolCold), vec4(0.5, 0.62, 0.66, 1).xyz, raft.mul(0.45));
  })();
  m.emissiveNode = Fn(() => {
    const p = positionWorld.xz;
    const shimmer = noise(p.mul(0.3).add(vec2(time.mul(0.05), time.mul(0.03)))).r;
    return vec4(0.12, 0.6, 0.8, 1).xyz.mul(shimmer.mul(0.3).add(0.12)).mul(uCoolGlow).mul(uCoolCold);
  })();
  return m;
}

/**
 * Frost: a pale crystalline white with a faint blue glint, for the moat's lips, the walls' feet and
 * the yard's coolers. One shared material.
 */
let _frost: THREE.MeshStandardNodeMaterial | null = null;
export function frostMaterial() {
  if (_frost) return _frost;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.0, color: '#dbe6ea' });
  const sparkle = Fn(() => smoothstep(0.82, 0.9, noise(positionWorld.xz.mul(3.1).add(positionWorld.y.mul(1.7))).r).mul(float(0.5).add(sin(time.mul(2).add(positionWorld.x.mul(7))).mul(0.5))));
  m.emissiveNode = vec4(0.6, 0.85, 1, 1).xyz.mul((sparkle() as N).mul(0.25));
  return (_frost = m);
}

/**
 * Mist lying on the moat: three stacked rings of soft noise just over the coolant, drifting and
 * thinning upward, soft where they meet the walls. `strength` (0 … 1) fades it (drained, warm).
 */
export class MoatMist {
  readonly mesh: THREE.Mesh;
  readonly strength = uniform(1);
  readonly tint = uniform(new THREE.Color('#e6f2f6'));

  constructor(r0: number, r1: number, y: number) {
    const layers = [0.25, 0.8, 1.5];
    const geos = layers.map((h, k) => {
      const g = new THREE.RingGeometry(r0 + 0.1, r1 - 0.1, 96, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(0, y + h, 0);
      g.setAttribute('layer', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1));
      return g;
    });
    let n = 0, idx = 0;
    for (const g of geos) { n += g.attributes.position.count; idx += g.index!.count; }
    const pos = new Float32Array(n * 3), lay = new Float32Array(n), ind = new Uint32Array(idx);
    let vo = 0, io = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array as Float32Array, vo * 3);
      lay.set(g.attributes.layer.array as Float32Array, vo);
      const gi = g.index!.array;
      for (let i = 0; i < gi.length; i++) ind[io + i] = gi[i] + vo;
      vo += g.attributes.position.count;
      io += gi.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('layer', new THREE.BufferAttribute(lay, 1));
    geo.setIndex(new THREE.BufferAttribute(ind, 1));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true, forceSinglePass: true });
    const strength = this.strength, tint = this.tint;
    mat.colorNode = Fn(() => {
      const k: N = attribute('layer', 'float');
      const p = positionWorld.xz;
      const a1 = noise(p.mul(0.06).add(vec2(time.mul(0.02), time.mul(0.011)).add(k.mul(3.7)))).r;
      const a2 = noise(p.mul(0.17).sub(vec2(time.mul(0.03), time.mul(-0.02))).add(k.mul(1.3))).g;
      const body = smoothstep(0.3, 0.85, a1.mul(0.65).add(a2.mul(0.45)));
      const thin = float(1).sub(k.mul(0.33));
      const soft = clamp(viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear)).div(1.5), 0, 1);
      return vec4(tint as N, body.mul(thin).mul(0.42).mul(strength).mul(soft));
    })();
    void uv;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 18;
    this.mesh.castShadow = false;
    this.mesh.name = 'fortMist';
  }
}
