import * as THREE from 'three/webgpu';
import {
  float, vec3, positionLocal, normalLocal, smoothstep, mix, uniform, positionWorld, cameraPosition, normalize, dot,
  normalWorld, pow, max, attribute, step,
} from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise } from '@/engine/noiseTex';
import { bumpFromHeight } from '../world/Terrain';
import { rimColor, rimStrength, glow } from '../world/materials';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

// ------------------------------------------------------------------ look / gear per archetype
export interface HandLook {
  glove: string;
  gloveWear: string;
  pad: string;
  sleeve: string;
  cuff: string;
  accent: string;
  heavy: boolean; // engineer: chunkier work gloves + multitool watch
}

export const HAND_LOOKS: Record<string, HandLook> = {
  infiltrator: { glove: '#1d1f21', gloveWear: '#45484b', pad: '#2a2e32', sleeve: '#2b3a3c', cuff: '#1b2324', accent: '#3ff2e0', heavy: false },
  engineer: { glove: '#6e5236', gloveWear: '#a88760', pad: '#3a3532', sleeve: '#6a4a2c', cuff: '#d9792a', accent: '#ff9d2e', heavy: true },
};

// ------------------------------------------------------------------ materials
// The hands live right in front of the lens, so a strong fresnel rim reads as a glowing outline.
// Keep only a faint lift so they don't go pure black at night.
const rim = (k: number): N => {
  const v = normalize(cameraPosition.sub(positionWorld));
  return rimColor.mul(pow(float(1).sub(max(dot(normalWorld, v), 0)), 3)).mul(rimStrength).mul(k);
};

// Every hand material exists twice: a plain version (uniforms, positionLocal/normalLocal of its own
// mesh) and a merged version where the same parameters and the part's original local position and
// normal come from vertex attributes. The rig's parts are baked into one skinned mesh per kind (see
// bakeParts), which samples exactly what each separate part sampled: same look, a fraction of the draws.
type HandKind = 'glove' | 'fabric' | 'hard' | 'steel';
interface HandSpec { kind: HandKind; a: [number, number, number, number]; b: [number, number, number, number] }
const _handSpec = new WeakMap<THREE.Material, HandSpec>();
const rgb = (c: string) => { const k = new THREE.Color(c); return [k.r, k.g, k.b] as const; };
/** merged-mesh inputs: original local position/normal and two parameter vec4s */
const mP = (): N => attribute('lpos', 'vec3');
const mN = (): N => attribute('lnrm', 'vec3');
const mA = (): N => attribute('hA', 'vec4');
const mB = (): N => attribute('hB', 'vec4');

/** Glove leather: fine pebbled grain, darker creases at segment ends, scuffed lighter on the back. */
function gloveMaterial(base: string, wear: string, segLen = 0) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0 });
  gloveSetup(m, positionLocal, normalLocal, uniform(new THREE.Color(base)), uniform(new THREE.Color(wear)), segLen > 0 ? uniform(segLen) : null);
  _handSpec.set(m, { kind: 'glove', a: [...rgb(base), segLen], b: [...rgb(wear), 0] });
  return m;
}

function gloveSetup(m: THREE.MeshStandardNodeMaterial, P: N, Nl: N, b: N, w: N, segLen: N | null, creaseMask: N = null) {
  const g = noise(P.xz.add(P.y).mul(9)).r; // broad tone variation (local units are metres)
  const grain = noise(P.xy.sub(P.z).mul(60)).g; // pebble grain, bump only
  // scuffs on the back of the hand / tops of knuckles (local +Y faces up for palm-down segments)
  const back = smoothstep(0.3, 0.95, Nl.y);
  let col: N = mix(b, w, back.mul(smoothstep(0.4, 0.8, g)).mul(0.3));
  let rough: N = float(0.62).sub(back.mul(0.14));
  if (segLen) {
    // segment runs along local -Z from 0 to -segLen: creases at both ends
    const t = P.z.negate().div(segLen);
    let crease: N = smoothstep(0.16, 0.0, t).add(smoothstep(0.84, 1.0, t)).clamp(0, 1);
    if (creaseMask) crease = crease.mul(creaseMask); // merged mesh: parts without a segment length get none
    col = col.mul(float(1).sub(crease.mul(0.3)));
    rough = rough.add(crease.mul(0.12));
  }
  m.colorNode = col.mul(float(0.94).add(g.mul(0.1)));
  m.roughnessNode = rough;
  m.normalNode = bumpFromHeight(grain.mul(0.25).add(g.mul(0.15)), float(0.0012));
  m.emissiveNode = rim(0.08);
}

function fabricMat(c: string, rough = 0.95) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough });
  fabricSetup(m, positionLocal, uniform(new THREE.Color(c)));
  _handSpec.set(m, { kind: 'fabric', a: [...rgb(c), rough], b: [0, 0, 0, 0] });
  return m;
}

function fabricSetup(m: THREE.MeshStandardNodeMaterial, P: N, base: N) {
  const n = noise(P.xy.add(P.z).mul(14)).r;
  const weave = noise(P.xz.mul(vec3(260, 90, 1).xy)).g;
  const fold = noise(vec3(P.z.mul(16), P.x.mul(5), 0).xy).g; // soft sleeve creases
  m.colorNode = base.mul(float(0.82).add(n.mul(0.2)).sub(fold.mul(0.1)).add(weave.mul(0.06)));
  m.normalNode = bumpFromHeight(n.mul(0.2).add(fold.mul(0.5)).add(weave.mul(0.08)), float(0.004));
  m.emissiveNode = rim(0.08);
}

function hardMat(c: string, rough = 0.45, metal = 0.1) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: metal });
  hardSetup(m, positionLocal, uniform(new THREE.Color(c)));
  _handSpec.set(m, { kind: 'hard', a: [...rgb(c), rough], b: [metal, 0, 0, 0] });
  return m;
}

function hardSetup(m: THREE.MeshStandardNodeMaterial, P: N, base: N) {
  const n = noise(P.xy.mul(40)).r;
  m.colorNode = base.mul(float(0.85).add(n.mul(0.25)));
  m.emissiveNode = rim(0.08);
}

function steelMat(c = '#b9bec4', rough = 0.25) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: 1 });
  steelSetup(m, positionLocal, uniform(new THREE.Color(c)), float(rough));
  _handSpec.set(m, { kind: 'steel', a: [...rgb(c), rough], b: [0, 0, 0, 0] });
  return m;
}

function steelSetup(m: THREE.MeshStandardNodeMaterial, P: N, base: N, rough: N) {
  const scratches = noise(P.xy.mul(vec3(3, 80, 1).xy)).r;
  m.colorNode = base.mul(float(0.85).add(scratches.mul(0.2)));
  m.roughnessNode = rough.add(scratches.mul(0.2));
}

/** The attribute-driven twin of each hand material kind (one shared instance per kind). */
const _merged = new Map<HandKind, THREE.MeshStandardNodeMaterial>();
function mergedMaterial(kind: HandKind) {
  let m = _merged.get(kind);
  if (m) return m;
  m = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  if (kind === 'glove') {
    // segLen 0 (palm, wrist, gauntlet…) → no crease; max() keeps the unused division finite
    gloveSetup(m, mP(), mN(), mA().xyz, mB().xyz, mA().w.max(1e-4), step(1e-6, mA().w));
  } else if (kind === 'fabric') {
    fabricSetup(m, mP(), mA().xyz);
    m.roughnessNode = mA().w;
  } else if (kind === 'hard') {
    hardSetup(m, mP(), mA().xyz);
    m.roughnessNode = mA().w;
    m.metalnessNode = mB().x;
  } else {
    m.metalness = 1;
    steelSetup(m, mP(), mA().xyz, mA().w);
  }
  _merged.set(kind, m);
  return m;
}

/**
 * Merge the tagged meshes under `root` into one mesh per material kind. Rigid parts on several
 * joints become a SkinnedMesh whose bones are those joints (one bone per vertex, weight 1), so the
 * articulated fingers keep moving exactly as before. Untagged meshes (glow screens) are left alone.
 */
function bakeParts(root: THREE.Object3D, skinned: boolean) {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && _handSpec.has(m.material as THREE.Material)) meshes.push(m); });
  const bones: THREE.Object3D[] = [];
  const byKind = new Map<HandKind, { g: THREE.BufferGeometry; spec: HandSpec; bone: number }[]>();
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  for (const mesh of meshes) {
    const spec = _handSpec.get(mesh.material as THREE.Material)!;
    const parent = mesh.parent!;
    let bone = bones.indexOf(parent);
    if (bone < 0) { bone = bones.length; bones.push(parent); }
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    g.setAttribute('lpos', g.attributes.position.clone());
    g.setAttribute('lnrm', g.attributes.normal.clone());
    // skinned: vertices live in their joint's space; rigid: in root space
    mesh.updateMatrix();
    g.applyMatrix4(skinned ? mesh.matrix : _bm.multiplyMatrices(rootInv, mesh.matrixWorld));
    parent.remove(mesh);
    let list = byKind.get(spec.kind);
    if (!list) byKind.set(spec.kind, (list = []));
    list.push({ g, spec, bone });
  }
  const skeleton = skinned ? new THREE.Skeleton(bones as THREE.Bone[], bones.map(() => new THREE.Matrix4())) : null;
  for (const [kind, list] of byKind) {
    const geo = mergeGeometries(list.map((x) => x.g), false)!;
    const n = geo.attributes.position.count;
    const A = new Float32Array(n * 4), B = new Float32Array(n * 4);
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    let o = 0;
    for (const { g, spec, bone } of list) {
      for (let v = 0; v < g.attributes.position.count; v++, o++) {
        A.set(spec.a, o * 4); B.set(spec.b, o * 4);
        si[o * 4] = bone; sw[o * 4] = 1;
      }
    }
    geo.setAttribute('hA', new THREE.BufferAttribute(A, 4));
    geo.setAttribute('hB', new THREE.BufferAttribute(B, 4));
    let mesh: THREE.Mesh;
    if (skeleton) {
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      const sm = new THREE.SkinnedMesh(geo, mergedMaterial(kind));
      sm.bind(skeleton, new THREE.Matrix4()); // attached mode: world = joint.matrixWorld · vertex
      sm.frustumCulled = false; // always right in front of the lens when visible
      mesh = sm;
    } else {
      mesh = new THREE.Mesh(geo, mergedMaterial(kind));
    }
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}
const _bm = new THREE.Matrix4();
/** Debug: ?nofam also keeps the hands as separate part meshes (A/B the merge). */
const NO_HAND_BAKE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nofam');

// ------------------------------------------------------------------ geometry helpers
/**
 * Finger/thumb phalanx along -Z from z=0 to z=-len. Both ends are full hemispheres centred on the
 * joint pivots, so a bent joint stays a smooth knuckle instead of opening a gap. The profile is
 * slightly waisted between the joints and the cross-section is wider than it is thick.
 */
function segmentGeo(len: number, r0: number, r1: number, tip = false) {
  const pts: THREE.Vector2[] = [];
  const cap = 6;
  for (let i = 0; i <= cap; i++) {
    const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0 + 1e-5, Math.sin(a) * r0));
  }
  const n = 8;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const waist = -Math.sin(t * Math.PI) * 0.05 * r0;
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * t + waist, t * len));
  }
  const tipLen = tip ? 1.25 : 1; // fingertips are a little longer than a hemisphere
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r1 + 1e-5, len + Math.sin(a) * r1 * tipLen));
  }
  const g = new THREE.LatheGeometry(pts, 14);
  g.rotateX(-Math.PI / 2); // +Y → -Z
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // flatter on the back, a soft pad on the palm side
    p.setY(i, y < 0 ? y * 0.92 : y * 0.8);
  }
  g.computeVertexNormals();
  return g;
}

function cylAlong(len: number, r0: number, r1: number, seg = 18) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 4, false);
  g.translate(0, len / 2, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Palm: a subdivided rounded box remapped into a hand shape: tapers to the wrist, the front edge
 * follows the knuckle arc (middle finger furthest forward, little finger set back), the back is
 * arched, and the palm side bulges at the thenar (thumb) and hypothenar pads with a hollow between.
 * `s` = anatomical side: thumb on +s·x.
 */
function palmGeo(s: number) {
  const g = new RoundedBoxGeometry(1, 1, 1, 5, 0.32);
  const p = g.attributes.position as THREE.BufferAttribute;
  const gauss = (dx: number, dy: number, r: number) => Math.exp(-(dx * dx + dy * dy) / (r * r));
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2; // -1..1 across
    const w = p.getY(i) * 2; // -1 palm .. +1 back
    const v = p.getZ(i) + 0.5; // 0 knuckles .. 1 wrist
    const ua = u * s; // +1 = thumb side
    const half = THREE.MathUtils.lerp(0.045, 0.031, THREE.MathUtils.smoothstep(v, 0.25, 1));
    const x = u * half + s * v * 0.003;
    const d = (ua - 0.2) / 1.2;
    const zFront = -0.097 + 0.013 * d * d;
    const z = THREE.MathUtils.lerp(zFront, 0.006, v);
    const top = 0.012 + 0.005 * (1 - ua * ua) - v * 0.002;
    const bot = 0.012 + 0.008 * gauss(ua - 0.75, v - 0.72, 0.45) + 0.005 * gauss(ua + 0.8, v - 0.55, 0.5) - 0.003 * gauss(ua, v - 0.35, 0.4) + v * 0.002;
    p.setXYZ(i, x, w >= 0 ? w * top : w * bot, z);
  }
  g.computeVertexNormals();
  return g;
}

/** Thin plate bent to follow the knuckle arc and the back-of-hand arch. */
function knuckleGuardGeo(s: number) {
  const g = new RoundedBoxGeometry(1, 1, 1, 3, 0.3);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2, w = p.getY(i) * 2, v = p.getZ(i) + 0.5;
    const ua = u * s;
    const d = (ua - 0.2) / 1.2;
    const x = u * 0.04;
    const z = -0.094 + 0.012 * d * d + (v - 0.5) * 0.02;
    const y = 0.0148 + 0.004 * (1 - ua * ua) + w * 0.0026;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

interface Finger { base: THREE.Group; joints: THREE.Group[]; }

// metacarpal-head (knuckle) positions sit on an arc; radii include the glove
const FINGERS = [
  { name: 'index', x: 0.028, y: 0.0005, z: -0.093, lens: [0.045, 0.026, 0.021], r: 0.0114, spread: 0.07 },
  { name: 'middle', x: 0.009, y: 0.002, z: -0.098, lens: [0.05, 0.03, 0.022], r: 0.0118, spread: 0 },
  { name: 'ring', x: -0.0105, y: 0.0005, z: -0.094, lens: [0.047, 0.029, 0.022], r: 0.0112, spread: -0.07 },
  { name: 'pinky', x: -0.028, y: -0.003, z: -0.084, lens: [0.037, 0.021, 0.019], r: 0.0099, spread: -0.15 },
];

// ------------------------------------------------------------------ pose model
export interface HandPose {
  pos: THREE.Vector3; // wrist position in view space (metres, pre-scale)
  rot: THREE.Euler;
  curl: [number, number, number, number]; // index, middle, ring, pinky (0 open … 1 fist)
  thumb: number; // thumb curl
  oppose: number; // thumb across the palm
  spread: number;
}

/**
 * A single curl value becomes a natural cascade: in a relaxed or loosely closed hand the index is
 * the straightest finger and each finger toward the little one curls a bit more.
 */
const P = (x: number, y: number, z: number, rx: number, ry: number, rz: number, curl: number | [number, number, number, number], thumb: number, oppose: number, spread = 0): HandPose => ({
  pos: new THREE.Vector3(x, y, z),
  rot: new THREE.Euler(rx, ry, rz, 'YXZ'),
  curl: typeof curl === 'number' ? [curl * 0.82, curl, Math.min(1, curl * 1.1 + 0.03), Math.min(1, curl * 1.2 + 0.06)] : curl,
  thumb,
  oppose,
  spread,
});

// Resting off-screen: arms hang at your sides, so empty hands aren't in view (like real life).
const DOWN = P(0.24, -0.62, -0.3, -0.9, 0.2, -1.3, 0.3, 0.3, 0.2);
// Off-hand while the other one works: just below the frame, ready.
const READY = P(0.22, -0.46, -0.36, -0.4, 0.2, -1.2, 0.35, 0.35, 0.25);

/** Right-hand poses; the left hand mirrors x / yaw / roll. */
export const POSES: Record<string, { r: HandPose; l: HandPose; items?: { r?: string; l?: string } }> = {
  flat: { r: P(0.14, -0.14, -0.4, 0, 0, 0, 0, 0, 0), l: P(0.14, -0.14, -0.4, 0, 0, 0, 0, 0, 0) },
  fist: { r: P(0.14, -0.14, -0.4, 0, 0, 0, 1, 0.8, 0.6), l: P(0.14, -0.14, -0.4, 0, 0, 0, 1, 0.8, 0.6) },
  // relaxed, slightly cupped, palms turned in: what a hand looks like when you're not using it
  relaxed: { r: P(0.15, -0.17, -0.4, 0.1, 0.25, -0.95, 0.32, 0.25, 0.15), l: P(0.15, -0.17, -0.4, 0.1, 0.25, -0.95, 0.32, 0.25, 0.15) },
  idle: { r: DOWN, l: DOWN },
  crouch: { r: DOWN, l: DOWN },
  run: { r: DOWN, l: DOWN }, // sprinting arm pump is layered procedurally (see Hands.update)
  // airborne / falling: arms come up and out for balance
  air: { r: P(0.26, -0.33, -0.4, 0.1, 0.05, -1.0, 0.14, 0.15, 0.1, 0.3), l: P(0.27, -0.35, -0.38, 0.1, 0.05, -1.05, 0.16, 0.15, 0.1, 0.3) },
  lockpick: {
    r: P(0.075, -0.135, -0.37, 0.1, 0.4, -1.15, [0.4, 0.72, 0.82, 0.9], 0.45, 0.75),
    l: P(0.09, -0.15, -0.38, 0.05, 0.45, -1.0, [0.45, 0.75, 0.85, 0.9], 0.5, 0.7),
    items: { r: 'pick', l: 'wrench' },
  },
  keypad: { r: P(0.11, -0.13, -0.46, 0.12, 0.18, -0.55, [0.02, 0.88, 0.95, 1.0], 0.7, 0.75), l: READY },
  reach: { r: P(0.12, -0.14, -0.46, 0.0, 0.2, -0.85, 0.12, 0.15, 0.1, 0.15), l: READY },
  grab: { r: P(0.11, -0.14, -0.47, 0.0, 0.2, -0.85, 0.85, 0.7, 0.6), l: READY },
  empHold: { r: P(0.17, -0.18, -0.38, 0.2, 0.2, -1.15, 0.78, 0.65, 0.6), l: READY, items: { r: 'emp' } },
  empWind: { r: P(0.23, -0.09, -0.27, 0.85, -0.35, -1.45, 0.78, 0.65, 0.6), l: P(0.16, -0.2, -0.44, 0.0, 0.1, -0.6, 0.15, 0.15, 0.1, 0.15), items: { r: 'emp' } },
  empThrow: { r: P(0.08, -0.1, -0.58, -0.35, 0.1, -0.6, 0.12, 0.15, 0.1, 0.25), l: READY },
  eat: { r: P(0.03, -0.14, -0.26, 0.6, 0.75, -1.25, 0.75, 0.55, 0.5), l: READY, items: { r: 'ration' } },
  // character select: kneeling at the fire. One hand shows the gear, the other warms at the flames.
  showcaseEmp: {
    r: P(0.11, -0.115, -0.38, 0.15, 0.4, -1.3, 0.78, 0.65, 0.6),
    l: P(0.15, -0.12, -0.46, 0.3, 0.25, 0.3, 0.18, 0.12, 0.05, 0.2),
    items: { r: 'emp' },
  },
  showcase: {
    r: P(0.1, -0.1, -0.38, -0.05, 0.35, -1.1, [0.4, 0.72, 0.82, 0.9], 0.45, 0.75),
    l: P(0.15, -0.12, -0.46, 0.3, 0.25, 0.3, 0.18, 0.12, 0.05, 0.2),
    items: { r: 'pick' },
  },
};

/** Left hand holding the torch in a fist, lens forward, beam roughly along the view. */
const TORCH_L = P(0.165, -0.2, -0.42, 0.12, 0.22, -1.2, 0.9, 0.75, 0.55);

// arm IK (right side, view metres at viewmodel scale; mirrored for the left)
const SHOULDER = new THREE.Vector3(0.2, -0.32, 0.1);
const UPPER = 0.39, FORE = 0.36;
const POLE = new THREE.Vector3(0.5, -1, 0.3).normalize(); // elbows hang down, out and back

/** Two-bone IK: the elbow for a wrist at `w` (right-side coords). */
function solveElbow(w: THREE.Vector3, out: THREE.Vector3) {
  const d = _ik.copy(w).sub(SHOULDER);
  const c = Math.min(d.length(), UPPER + FORE - 1e-3);
  d.normalize();
  const cosA = THREE.MathUtils.clamp((UPPER * UPPER + c * c - FORE * FORE) / (2 * UPPER * c), -1, 1);
  const p = _ik2.copy(POLE).addScaledVector(d, -POLE.dot(d)).normalize();
  return out.copy(SHOULDER).addScaledVector(d, UPPER * cosA).addScaledVector(p, UPPER * Math.sqrt(1 - cosA * cosA));
}
const _ik = new THREE.Vector3(), _ik2 = new THREE.Vector3();

// ------------------------------------------------------------------ hand rig
export class HandRig {
  root = new THREE.Group(); // wrist
  fingers: Finger[] = [];
  thumbBase = new THREE.Group();
  thumbJoints: THREE.Group[] = [];
  grip = new THREE.Group(); // item anchor in the palm
  pinch = new THREE.Group(); // item anchor between thumb and index
  arm = new THREE.Group(); // forearm, aimed at the elbow every frame
  upper: THREE.Mesh; // upper arm (lives beside the hand in viewmodel space)
  cur: HandPose;
  vel = new Float32Array(13); // spring velocities for the 13 pose channels

  private a: number;

  constructor(private side: 1 | -1, look: HandLook, private accentU: { value: number }) {
    // `side` = screen side (+1 right). `s` = anatomical mirror: a palm-down right hand has its
    // thumb on the -x side, so finger/thumb offsets use the opposite sign.
    const s = -side;
    this.a = s;
    const glove = gloveMaterial(look.glove, look.gloveWear);
    const pad = hardMat(look.pad, 0.5, 0.05);
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = false;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    add(this.root, palmGeo(s), glove);
    // thenar pad: the muscle mass at the base of the thumb
    add(this.root, new THREE.SphereGeometry(0.02, 16, 12).scale(0.85, 0.7, 1.5), glove, s * 0.023, -0.007, -0.03, 0, s * 0.25, 0);
    // wrist: a soft ellipsoid so the hand can bend against the forearm without a seam
    add(this.root, new THREE.SphereGeometry(0.026, 18, 12).scale(1.12, 0.68, 1.1), glove, s * 0.002, -0.0015, 0.014);
    // knuckle guard (infiltrator) / leather back patch (engineer)
    add(this.root, knuckleGuardGeo(s), pad);
    if (!look.heavy) add(this.root, new RoundedBoxGeometry(0.05, 0.006, 0.042, 3, 0.0028), pad, s * 0.003, 0.0165, -0.047, 0.05, 0, 0);
    else add(this.root, new RoundedBoxGeometry(0.066, 0.004, 0.06, 3, 0.002), gloveMaterial('#4f3a28', look.gloveWear), s * 0.001, 0.0158, -0.05, 0.02, 0, 0);

    // fingers
    FINGERS.forEach((f, fi) => {
      const base = new THREE.Group();
      base.position.set(s * f.x, f.y, f.z);
      this.root.add(base);
      const joints: THREE.Group[] = [];
      let parent: THREE.Object3D = base;
      f.lens.forEach((len, i) => {
        const j = new THREE.Group();
        parent.add(j);
        const r0 = f.r * (1 - i * 0.085), r1 = f.r * (1 - (i + 1) * 0.085);
        add(j, segmentGeo(len, r0, r1, i === 2), gloveMaterial(look.glove, look.gloveWear, len));
        // padded strip on the back of the first phalanx (infiltrator) / stitched seam (engineer)
        if (i === 0 && !look.heavy && fi < 3) add(j, new RoundedBoxGeometry(f.r * 1.3, 0.004, len * 0.5, 2, 0.0018), pad, 0, f.r * 0.78, -len * 0.5);
        const next = new THREE.Group();
        next.position.z = -len;
        j.add(next);
        joints.push(j);
        parent = next;
      });
      this.fingers.push({ base, joints });
    });

    // thumb: metacarpal (mostly buried in the thenar pad), proximal and distal phalanges
    this.thumbBase.position.set(s * 0.022, -0.011, -0.014);
    this.root.add(this.thumbBase);
    let tp: THREE.Object3D = this.thumbBase;
    [0.04, 0.031, 0.027].forEach((len, i) => {
      const j = new THREE.Group();
      tp.add(j);
      const r0 = [0.0155, 0.0135, 0.0126][i], r1 = [0.0135, 0.0126, 0.0114][i];
      add(j, segmentGeo(len, r0, r1, i === 2), gloveMaterial(look.glove, look.gloveWear, len));
      const next = new THREE.Group();
      next.position.z = -len;
      j.add(next);
      this.thumbJoints.push(j);
      tp = next;
    });

    // forearm: glove gauntlet → sleeve cuff → sleeve, heading off to the elbow (+Z in arm space)
    this.root.add(this.arm);
    const sleeve = fabricMat(look.sleeve);
    const armLen = FORE / 1.3 - 0.03;
    add(this.arm, cylAlong(armLen + 0.03, 0.034, 0.047, 20), sleeve, 0, 0, 0.055 + armLen + 0.03);
    add(this.arm, cylAlong(0.034, 0.041, 0.04, 24), fabricMat(look.cuff, 0.9), 0, 0, 0.07);
    add(this.arm, cylAlong(0.055, 0.033, 0.03, 24).scale(1, 0.86, 1), glove, 0, 0, 0.057);
    // wrist strap with a buckle
    add(this.arm, cylAlong(0.016, 0.0335, 0.0335, 24).scale(1, 0.87, 1), hardMat('#1c1c1c', 0.75), 0, 0, 0.03);
    add(this.arm, new RoundedBoxGeometry(0.02, 0.005, 0.014, 2, 0.002), hardMat('#4a4a4a', 0.35, 0.7), 0, 0.03, 0.022);
    // wrist gadget on the left arm (display glows in the accent colour)
    if (this.side === -1) {
      add(this.arm, new RoundedBoxGeometry(0.03, 0.011, 0.036, 3, 0.003), hardMat(look.heavy ? '#4a3a2a' : '#202326', 0.4, 0.4), 0, 0.033, 0.105);
      const screen = glow(look.accent, 3);
      (screen.intensity as any).onFrameUpdate?.(() => this.accentU.value);
      const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.021, 0.025), screen.material);
      disp.rotation.x = -Math.PI / 2;
      disp.position.set(0, 0.0388, 0.105);
      this.arm.add(disp);
      if (look.heavy) add(this.arm, new THREE.CylinderGeometry(0.005, 0.005, 0.04, 8), steelMat('#8a8f94', 0.4), 0.02, 0.031, 0.105, Math.PI / 2);
    }

    const ug = new THREE.CylinderGeometry(0.06, 0.064, UPPER + 0.08, 18, 3, true);
    ug.translate(0, (UPPER + 0.08) / 2 - 0.04, 0);
    ug.rotateX(Math.PI / 2); // +Y → +Z
    this.upper = new THREE.Mesh(ug, sleeve);

    // item anchors
    this.grip.position.set(s * 0.004, -0.03, -0.062);
    this.root.add(this.grip);
    this.pinch.position.set(s * 0.03, -0.026, -0.118);
    this.root.add(this.pinch);

    // FP convention: hands read ~30% larger than life
    this.root.scale.setScalar(1.3);
    this.cur = clonePose(DOWN);
    // ~25 part meshes → one skinned mesh per material kind (the joints above are its bones)
    if (!NO_HAND_BAKE) bakeParts(this.root, true);
  }

  apply(p: HandPose) {
    const side = this.side;
    const elbow = solveElbow(_w.set(p.pos.x, p.pos.y, p.pos.z), _elb);
    const s = this.a;
    this.root.position.set(p.pos.x * side, p.pos.y, p.pos.z);
    this.root.rotation.set(p.rot.x, p.rot.y * side, p.rot.z * side, 'YXZ');
    // fingers: MCP / PIP / DIP share the curl the way tendons couple them (DIP ≈ ⅔ PIP)
    this.fingers.forEach((f, i) => {
      const c = THREE.MathUtils.clamp(p.curl[i], -0.1, 1.05);
      f.joints[0].rotation.x = -c * 1.5;
      f.joints[1].rotation.x = -Math.max(0, c) * 1.72;
      f.joints[2].rotation.x = -Math.max(0, c) * 1.15;
      // fingers fan out when open and converge toward the thumb as they close
      const fan = FINGERS[i].spread * (1 + p.spread * 2.5) * (1 - Math.max(0, c) * 0.75);
      f.base.rotation.set(0, -s * fan, -s * FINGERS[i].spread * Math.max(0, c) * 0.5, 'YXZ');
    });
    // thumb: relaxed it lies forward along the index, angled down; opposing swings it under the fingers
    const o = p.oppose;
    this.thumbBase.rotation.set(-0.22 - o * 0.45, -s * (0.55 - o * 0.6), -s * (0.85 + o * 0.6), 'YXZ');
    this.thumbJoints[0].rotation.x = -p.thumb * 0.25;
    this.thumbJoints[1].rotation.x = -p.thumb * 0.75;
    this.thumbJoints[2].rotation.x = -p.thumb * 0.95;

    // forearm: point +Z at the elbow, keeping its top roughly with the back of the hand
    const e = _v1.set(elbow.x * side, elbow.y, elbow.z).sub(this.root.position);
    _q.setFromEuler(this.root.rotation).invert();
    e.applyQuaternion(_q).normalize();
    const x = _v2.set(0, 1, 0).cross(e);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const y = _v3.copy(e).cross(x);
    this.arm.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, e));
    // upper arm: elbow → shoulder, in the viewmodel's space (it only shows on big reaches)
    const sh = _v1.set(SHOULDER.x * side, SHOULDER.y, SHOULDER.z);
    const el = _v2.set(elbow.x * side, elbow.y, elbow.z);
    this.upper.position.copy(el);
    this.upper.quaternion.setFromUnitVectors(_z, sh.sub(el).normalize());
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _w = new THREE.Vector3(), _elb = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4();

function clonePose(p: HandPose): HandPose {
  return { pos: p.pos.clone(), rot: p.rot.clone(), curl: [...p.curl] as HandPose['curl'], thumb: p.thumb, oppose: p.oppose, spread: p.spread };
}

/**
 * Critically damped spring on every pose channel. Unlike an exponential lerp the hand accelerates
 * out of the old pose and settles into the new one, which is what makes motion read as a real limb.
 */
function springPose(cur: HandPose, target: HandPose, vel: Float32Array, w: number, dt: number) {
  const step = (i: number, x: number, t: number) => {
    const v = vel[i];
    const a = w * w * (t - x) - 2 * w * v;
    vel[i] = v + a * dt;
    return x + vel[i] * dt;
  };
  cur.pos.set(step(0, cur.pos.x, target.pos.x), step(1, cur.pos.y, target.pos.y), step(2, cur.pos.z, target.pos.z));
  cur.rot.set(step(3, cur.rot.x, target.rot.x), step(4, cur.rot.y, target.rot.y), step(5, cur.rot.z, target.rot.z));
  for (let i = 0; i < 4; i++) cur.curl[i] = step(6 + i, cur.curl[i], target.curl[i]);
  cur.thumb = step(10, cur.thumb, target.thumb);
  cur.oppose = step(11, cur.oppose, target.oppose);
  cur.spread = step(12, cur.spread, target.spread);
}

// ------------------------------------------------------------------ items
function buildItems(look: HandLook) {
  const items: Record<string, THREE.Group> = {};
  const g = (name: string) => (items[name] = new THREE.Group());
  // lockpick: slim steel shaft with a hook + wrapped handle
  const pick = g('pick');
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0012, 0.085), steelMat());
  shaft.position.z = -0.05;
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.006, 0.0022), steelMat());
  hook.position.set(0, 0.0025, -0.092);
  const handle = new THREE.Mesh(new RoundedBoxGeometry(0.009, 0.004, 0.05, 2, 0.0015), hardMat(look.heavy ? '#d9792a' : '#1f6f6a', 0.5));
  handle.position.z = 0.012;
  pick.add(shaft, hook, handle);
  pick.rotation.set(0.1, 0.25, 0);
  // tension wrench: L-shaped flat bar
  const wrench = g('wrench');
  const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.0015, 0.06), steelMat('#9aa0a6', 0.35));
  w1.position.z = -0.025;
  const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.016, 0.0015), steelMat('#9aa0a6', 0.35));
  w2.position.set(0, -0.007, -0.055);
  wrench.add(w1, w2);
  wrench.rotation.set(0.2, -0.4, 0.3);
  // EMP charge: knurled canister with glowing ring + arming LED
  const emp = g('emp');
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.07, 24), hardMat('#3a4248', 0.35, 0.7));
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.012, 24), steelMat('#c8ccd0', 0.3));
  capTop.position.y = 0.041;
  const ring = glow('#7fe8ff', 5);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.0245, 0.0035, 8, 32), ring.material);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.01;
  emp.add(can, capTop, band);
  emp.rotation.set(0, 0, Math.PI / 2);
  emp.userData.ring = ring.intensity;
  // ration bar: foil-wrapped block
  const ration = g('ration');
  const foil = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.018, 0.09, 3, 0.004), steelMat('#c9b98e', 0.45));
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.031, 0.0185, 0.03), hardMat('#7a2f2a', 0.7));
  ration.add(foil, label);
  ration.rotation.set(0, 0.3, 0);
  // flashlight: rear end sits in the fist, head + lens protrude well past the knuckles
  const torch = g('flashlight');
  const tb = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.15, 20), hardMat('#1d1f22', 0.4, 0.6));
  body.position.y = 0.04;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0178, 0.0178, 0.05, 20), hardMat('#3a3d40', 0.85));
  grip.position.y = 0.0;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.018, 0.04, 20), hardMat('#26292d', 0.35, 0.7));
  head.position.y = 0.135;
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.003, 8, 24), steelMat('#c8ccd0', 0.3));
  bezel.position.y = 0.155;
  bezel.rotation.x = Math.PI / 2;
  const lensG = glow('#fff4dd', 6);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.021, 20), lensG.material);
  lens.position.y = 0.1555;
  lens.rotation.x = -Math.PI / 2;
  tb.add(body, grip, head, bezel, lens);
  torch.add(tb);
  torch.rotation.set(-Math.PI / 2, 0, 0);
  torch.position.set(0, 0.004, 0.02);
  torch.userData.lens = lensG.intensity;
  for (const it of Object.values(items)) it.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  if (!NO_HAND_BAKE) for (const it of Object.values(items)) bakeParts(it, false);
  return items;
}

// ------------------------------------------------------------------ public viewmodel
export interface HandsFrame {
  speed: number; // m/s
  grounded: boolean;
  crouch: boolean;
  sprint: boolean;
  bobPhase: number;
  lookDX: number; // mouse delta this frame
  lookDY: number;
  vy?: number; // vertical velocity (m/s), for the falling/balance reflex
}

type Action = { pose: string; dur: number; t: number; onHit?: () => void; hitAt?: number; hit?: boolean; next?: Action };

/**
 * First-person viewmodel. Authored at real scale around the eye, then shrunk toward the camera
 * (VIEW_SCALE) so the hands never clip into nearby walls while looking full-size on screen.
 *
 * Empty hands hang out of view like real arms do; they come up for actions, the torch, sprinting
 * and falling, and drop away again afterwards.
 */
export class Hands {
  static VIEW_SCALE = 0.32;
  root = new THREE.Group();
  readonly right: HandRig;
  readonly left: HandRig;
  private items: Record<string, THREE.Group>;
  private base = 'idle';
  private action: Action | null = null;
  private sway = new THREE.Vector2();
  private swayVel = new THREE.Vector2();
  private dip = 0;
  private dipVel = 0;
  private air = 0;
  private wasGrounded = true;
  private t = 0;
  private accent = { value: 3 };
  private kick = 0;
  private pump = 0;
  private target = { r: clonePose(DOWN), l: clonePose(DOWN) };
  flashlightOn = false;
  readonly flashlight: THREE.SpotLight;

  constructor(look: HandLook) {
    this.right = new HandRig(1, look, this.accent);
    this.left = new HandRig(-1, look, this.accent);
    this.items = buildItems(look);
    this.root.add(this.right.root, this.left.root, this.right.upper, this.left.upper);
    this.root.scale.setScalar(Hands.VIEW_SCALE);
    this.root.renderOrder = 5;
    // flashlight beam emitted from the torch in the left hand (light lives at camera scale)
    this.flashlight = new THREE.SpotLight(0xfff1d8, 0, 32, 0.5, 0.65, 1.6);
    this.flashlight.castShadow = false;
    // emitted just ahead of the (shrunken) hands so it lights the world, not your own glove
    this.flashlight.position.set(-0.05, -0.05, -0.35);
    this.flashlight.target.position.set(-0.02, -0.12, -6);
  }

  /** Attach to a camera (call once). */
  attach(camera: THREE.Camera) {
    camera.add(this.root, this.flashlight, this.flashlight.target);
  }

  setBase(pose: string) {
    this.base = pose;
  }

  get busy() {
    return !!this.action;
  }

  /** Play a transient pose sequence. `onHit` fires at `hitAt` seconds into the last step. */
  play(steps: { pose: string; dur: number }[], onHit?: () => void, hitStep = steps.length - 1, hitAt = 0) {
    // never swallow the interrupted action's payoff (an eaten ration still heals, a throw still throws)
    for (let a = this.action; a; a = a.next ?? null) if (a.onHit && !a.hit) { a.hit = true; a.onHit(); }
    let first: Action | null = null;
    let prev: Action | null = null;
    steps.forEach((s, i) => {
      const a: Action = { pose: s.pose, dur: s.dur, t: 0 };
      if (i === hitStep && onHit) { a.onHit = onHit; a.hitAt = hitAt; }
      if (prev) prev.next = a; else first = a;
      prev = a;
    });
    this.action = first;
  }

  throwEmp(onRelease: () => void) {
    this.play([{ pose: 'empHold', dur: 0.3 }, { pose: 'empWind', dur: 0.26 }, { pose: 'empThrow', dur: 0.4 }], onRelease, 2, 0.06);
  }
  eat(onDone?: () => void) {
    this.play([{ pose: 'eat', dur: 0.45 }, { pose: 'eat', dur: 0.9 }], onDone, 1, 0.5);
  }
  reach(onTouch?: () => void) {
    this.play([{ pose: 'reach', dur: 0.2 }, { pose: 'grab', dur: 0.32 }], onTouch, 1, 0.04);
  }
  press(onPress?: () => void) {
    this.play([{ pose: 'keypad', dur: 0.24 }, { pose: 'keypad', dur: 0.25 }], onPress, 0, 0.2);
  }
  /** Small recoil kick (zap, landing, EMP blast). */
  jolt(k: number) {
    this.kick = Math.min(1, this.kick + k);
  }

  update(dt: number, f: HandsFrame) {
    this.t += dt;
    // pick the active pose
    let poseName = this.base;
    if (this.action) {
      const a = this.action;
      a.t += dt;
      poseName = a.pose;
      if (a.onHit && !a.hit && a.t >= (a.hitAt ?? 0)) { a.hit = true; a.onHit(); }
      if (a.t >= a.dur) this.action = a.next ?? null;
    } else if (this.base === 'idle') {
      // balance reflex: after a moment in the air (not a little hop) the arms come up
      this.air = f.grounded ? 0 : this.air + dt;
      poseName = this.air > 0.28 || (f.vy ?? 0) < -5 ? 'air' : f.sprint ? 'run' : f.crouch ? 'crouch' : 'idle';
    }
    const def = POSES[poseName] ?? POSES.idle;
    const torchGrip = this.flashlightOn && !def.items?.l && poseName !== 'lockpick' && poseName !== 'showcase' && poseName !== 'showcaseEmp';

    // sprinting: arms pump in counter-phase with the legs, fists swinging up into the bottom of the view
    this.pump += ((f.sprint && f.grounded && !this.action && this.base === 'idle' ? 1 : 0) - this.pump) * (1 - Math.exp(-6 * dt));
    const tr = this.target.r, tl = this.target.l;
    copyPose(tr, def.r);
    copyPose(tl, torchGrip ? TORCH_L : def.l);
    if (this.pump > 0.01) {
      const swing = Math.sin(f.bobPhase);
      const pumpPose = (t: HandPose, ph: number, isTorch: boolean) => {
        if (isTorch) { t.pos.y += Math.max(0, ph) * 0.02 * this.pump; return; }
        const up = (ph * 0.5 + 0.5) * this.pump; // 0 = swung back, 1 = swung forward
        t.pos.set(
          THREE.MathUtils.lerp(t.pos.x, 0.2 - up * 0.06, this.pump),
          THREE.MathUtils.lerp(t.pos.y, -0.54 + up * 0.3, this.pump),
          THREE.MathUtils.lerp(t.pos.z, -0.28 - up * 0.12, this.pump),
        );
        t.rot.set(THREE.MathUtils.lerp(t.rot.x, 0.2 + up * 0.5, this.pump), THREE.MathUtils.lerp(t.rot.y, 0.35, this.pump), THREE.MathUtils.lerp(t.rot.z, -1.35, this.pump));
        for (let i = 0; i < 4; i++) t.curl[i] = THREE.MathUtils.lerp(t.curl[i], 0.62 + i * 0.05, this.pump);
        t.thumb = THREE.MathUtils.lerp(t.thumb, 0.55, this.pump);
        t.oppose = THREE.MathUtils.lerp(t.oppose, 0.55, this.pump);
      };
      pumpPose(tr, swing, false);
      pumpPose(tl, -swing, torchGrip);
    }
    // springs: snappy for deliberate actions, softer for drifting between rest poses; the off-hand
    // lags a touch so the two never move in lockstep
    const w = this.action ? 17 : 10;
    springPose(this.right.cur, tr, this.right.vel, w, dt);
    springPose(this.left.cur, tl, this.left.vel, w * 0.88, dt);

    // items in hands
    const want = { r: def.items?.r, l: def.items?.l ?? (torchGrip ? 'flashlight' : undefined) };
    for (const [name, obj] of Object.entries(this.items)) {
      const hand = want.r === name ? this.right : want.l === name ? this.left : null;
      if (!hand) { obj.removeFromParent(); continue; }
      const anchor = name === 'pick' || name === 'wrench' ? hand.pinch : hand.grip;
      if (obj.parent !== anchor) anchor.add(obj);
    }

    // procedural motion: gait bob, look sway (spring), landing dip, breathing, kick
    const move = Math.min(1, f.speed / 3.4) * (f.grounded ? 1 : 0);
    const bobX = Math.sin(f.bobPhase) * 0.008 * move;
    const bobY = (Math.abs(Math.cos(f.bobPhase)) - 0.5) * 0.012 * move;
    const breathe = Math.sin(this.t * 1.5) * 0.0025 + Math.sin(this.t * 0.37) * 0.001;
    // hands lag behind the view: spring toward the negative of mouse motion
    const target = _sway.set(-f.lookDX * 0.00025, f.lookDY * 0.00025);
    target.clampLength(0, 0.05);
    this.swayVel.addScaledVector(target.sub(this.sway), 120 * dt);
    this.swayVel.multiplyScalar(Math.exp(-14 * dt));
    this.sway.addScaledVector(this.swayVel, dt);
    // landing: the arms keep falling for a moment and spring back (weight, not a canned offset)
    if (f.grounded && !this.wasGrounded) this.dipVel -= Math.min(0.6, Math.max(0, -(f.vy ?? -3)) * 0.05);
    this.wasGrounded = f.grounded;
    this.dipVel += (-this.dip * 110 - this.dipVel * 13) * dt;
    this.dip += this.dipVel * dt;
    this.kick += -this.kick * Math.min(1, 5 * dt);

    const apply = (rig: HandRig, phase: number) => {
      const p = _pose;
      copyPose(p, rig.cur);
      p.pos.x += bobX * phase + this.sway.x;
      p.pos.y += bobY + breathe + this.sway.y + this.dip - this.kick * 0.04;
      p.pos.z += this.kick * 0.05;
      p.rot.z += this.sway.x * 3 * phase;
      p.rot.y += this.sway.x * 1.5;
      p.rot.x += this.sway.y * 2 + this.kick * 0.3;
      rig.apply(p);
      // fully lowered hands are off-screen: skip their ~30 draw calls
      rig.root.visible = rig.upper.visible = rig.cur.pos.y > -0.5 || p.pos.y > -0.5;
    };
    apply(this.right, 1);
    apply(this.left, -1);

    // gadget + emp ring pulse, flashlight
    this.accent.value = 2.5 + Math.pow(Math.max(0, Math.sin(this.t * 2.4)), 12) * 6;
    const ring = this.items.emp.userData.ring as { value: number };
    ring.value = 4 + Math.sin(this.t * 18) * 2;
    const lens = this.items.flashlight.userData.lens as { value: number };
    lens.value = this.flashlightOn ? 8 : 0.1;
    const lit = this.flashlightOn && want.l === 'flashlight';
    this.flashlight.intensity += ((lit ? 16 : 0) - this.flashlight.intensity) * (1 - Math.exp(-14 * dt));
    // the beam follows the torch hand (bob, sway, sprint pump) instead of being glued to the eye
    if (lit) {
      const lp = this.left.cur.pos;
      this.flashlight.position.set(-0.05 + (lp.x * -1 + 0.165) * 0.32, -0.05 + (lp.y + 0.2) * 0.32, -0.35);
      this.flashlight.target.position.set(-0.02 - this.sway.x * 8, -0.12 + this.sway.y * 8 + (lp.y + 0.2) * 3, -6);
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.flashlight.removeFromParent();
    this.flashlight.target.removeFromParent();
  }
}

const _sway = new THREE.Vector2();
const _pose = clonePose(DOWN);
function copyPose(dst: HandPose, src: HandPose) {
  dst.pos.copy(src.pos);
  dst.rot.copy(src.rot);
  for (let i = 0; i < 4; i++) dst.curl[i] = src.curl[i];
  dst.thumb = src.thumb;
  dst.oppose = src.oppose;
  dst.spread = src.spread;
}
