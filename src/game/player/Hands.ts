import * as THREE from 'three/webgpu';
import {
  float, vec3, positionLocal, normalLocal, smoothstep, mix, uniform, positionWorld, cameraPosition, normalize, dot,
  normalWorld, pow, max,
} from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { noise } from '@/engine/noiseTex';
import { bumpFromHeight } from '../world/Terrain';
import { rimColor, rimStrength, glow } from '../world/materials';
import { damp } from '@/engine/noise';

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
  infiltrator: { glove: '#17191b', gloveWear: '#3a3d40', pad: '#262a2e', sleeve: '#2b3a3c', cuff: '#1b2324', accent: '#3ff2e0', heavy: false },
  engineer: { glove: '#6e5236', gloveWear: '#a88760', pad: '#3a3532', sleeve: '#6a4a2c', cuff: '#d9792a', accent: '#ff9d2e', heavy: true },
};

// ------------------------------------------------------------------ materials
const rim = (k: number): N => {
  const v = normalize(cameraPosition.sub(positionWorld));
  return rimColor.mul(pow(float(1).sub(max(dot(normalWorld, v), 0)), 2.5)).mul(rimStrength).mul(k);
};

/** Glove leather: fine grain, darker creases at segment ends, worn lighter on the back. */
function gloveMaterial(base: string, wear: string, segLen = 0) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0 });
  const b = uniform(new THREE.Color(base));
  const w = uniform(new THREE.Color(wear));
  const g = noise(positionLocal.xz.add(positionLocal.y).mul(2.2)).r; // broad tone variation
  const grain = noise(positionLocal.xy.sub(positionLocal.z).mul(14)).g; // bump only
  // gentle wear on the back of the hand / tops of knuckles (local +Y faces up for palm-down segments)
  const back = smoothstep(0.35, 0.95, normalLocal.y);
  let col: N = mix(b, w, back.mul(smoothstep(0.35, 0.75, g)).mul(0.28));
  let rough: N = float(0.6).sub(back.mul(0.12));
  if (segLen > 0) {
    // segment runs along local -Z from 0 to -segLen: creases at both ends
    const t = positionLocal.z.negate().div(uniform(segLen));
    const crease = smoothstep(0.18, 0.0, t).add(smoothstep(0.82, 1.0, t)).clamp(0, 1);
    col = col.mul(float(1).sub(crease.mul(0.35)));
    rough = rough.add(crease.mul(0.15));
  }
  m.colorNode = col.mul(float(0.94).add(g.mul(0.1)));
  m.roughnessNode = rough;
  m.normalNode = bumpFromHeight(grain.mul(0.35).add(g.mul(0.2)), float(0.004));
  m.emissiveNode = rim(0.35);
  return m;
}

function fabricMat(c: string, rough = 0.95) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough });
  const base = uniform(new THREE.Color(c));
  const n = noise(positionLocal.xy.add(positionLocal.z).mul(3)).r;
  const fold = noise(vec3(positionLocal.z.mul(9), positionLocal.x.mul(2), 0).xy).g; // sleeve creases
  m.colorNode = base.mul(float(0.8).add(n.mul(0.25)).sub(fold.mul(0.12)));
  m.normalNode = bumpFromHeight(n.mul(0.3).add(fold.mul(0.6)), float(0.01));
  m.emissiveNode = rim(0.35);
  return m;
}

function hardMat(c: string, rough = 0.45, metal = 0.1) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: metal });
  const base = uniform(new THREE.Color(c));
  const n = noise(positionLocal.xy.mul(14)).r;
  m.colorNode = base.mul(float(0.85).add(n.mul(0.25)));
  m.emissiveNode = rim(0.35);
  return m;
}

function steelMat(c = '#b9bec4', rough = 0.25) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: 1 });
  const base = uniform(new THREE.Color(c));
  const scratches = noise(positionLocal.xy.mul(vec3(3, 80, 1).xy)).r;
  m.colorNode = base.mul(float(0.85).add(scratches.mul(0.2)));
  m.roughnessNode = float(rough).add(scratches.mul(0.2));
  return m;
}

// ------------------------------------------------------------------ geometry helpers
/** Rounded, tapered segment along -Z from z=0 to z=-len (lathe profile), slightly flattened. */
function segmentGeo(len: number, r0: number, r1: number, tipRound = false) {
  const pts: THREE.Vector2[] = [];
  const n = 10;
  // base cap (overlaps the previous segment)
  for (let i = 0; i <= 4; i++) {
    const a = (-Math.PI / 2) + (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0 * 0.6));
  }
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const bulge = Math.sin(t * Math.PI) * 0.06 * r0;
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * t + bulge, t * len));
  }
  const capR = r1;
  const caps = tipRound ? 6 : 4;
  for (let i = 0; i <= caps; i++) {
    const a = (i / caps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * capR, len + Math.sin(a) * capR * (tipRound ? 0.9 : 0.6)));
  }
  const g = new THREE.LatheGeometry(pts, 16);
  g.rotateX(-Math.PI / 2); // +Y → -Z
  g.scale(1, 0.86, 1); // fingers are wider than they are thick
  g.computeVertexNormals();
  return g;
}

function cylAlong(len: number, r0: number, r1: number, seg = 18) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 3, false);
  g.translate(0, len / 2, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}

interface Finger { base: THREE.Group; joints: THREE.Group[]; }

const FINGERS = [
  // x offset, y, z (from wrist), lengths, base radius, spread
  { name: 'index', x: 0.03, z: -0.092, lens: [0.046, 0.027, 0.022], r: 0.0098, spread: 0.06 },
  { name: 'middle', x: 0.01, z: -0.096, lens: [0.05, 0.031, 0.024], r: 0.0102, spread: 0 },
  { name: 'ring', x: -0.01, z: -0.093, lens: [0.047, 0.029, 0.023], r: 0.0096, spread: -0.05 },
  { name: 'pinky', x: -0.029, z: -0.086, lens: [0.037, 0.022, 0.02], r: 0.0084, spread: -0.12 },
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

const P = (x: number, y: number, z: number, rx: number, ry: number, rz: number, curl: number | [number, number, number, number], thumb: number, oppose: number, spread = 0): HandPose => ({
  pos: new THREE.Vector3(x, y, z),
  rot: new THREE.Euler(rx, ry, rz, 'YXZ'),
  curl: typeof curl === 'number' ? [curl, curl, curl, curl] : curl,
  thumb,
  oppose,
  spread,
});

/** Right-hand poses; the left hand mirrors x / yaw / roll. */
export const POSES: Record<string, { r: HandPose; l: HandPose; items?: { r?: string; l?: string } }> = {
  flat: { r: P(0.14, -0.14, -0.4, 0, 0, 0, 0, 0, 0), l: P(0.14, -0.14, -0.4, 0, 0, 0, 0, 0, 0) },
  idle: { r: P(0.17, -0.2, -0.42, 0.15, 0.3, -0.55, 0.42, 0.6, 0.45), l: P(0.18, -0.215, -0.41, 0.1, 0.3, -0.6, 0.45, 0.6, 0.45) },
  run: { r: P(0.2, -0.28, -0.38, 0.5, 0.2, -0.9, 0.75, 0.6, 0.4), l: P(0.2, -0.29, -0.38, 0.5, 0.2, -0.9, 0.75, 0.6, 0.4) },
  crouch: { r: P(0.15, -0.16, -0.4, 0.1, 0.35, -0.45, 0.55, 0.65, 0.5), l: P(0.16, -0.18, -0.39, 0.05, 0.3, -0.55, 0.6, 0.65, 0.5) },
  lockpick: {
    r: P(0.1, -0.11, -0.36, 0.05, 0.45, -0.35, [0.25, 0.7, 0.85, 0.9], 0.55, 0.75),
    l: P(0.12, -0.13, -0.37, 0.05, 0.5, -0.5, [0.3, 0.75, 0.85, 0.9], 0.5, 0.75),
    items: { r: 'pick', l: 'wrench' },
  },
  keypad: { r: P(0.12, -0.11, -0.43, 0.05, 0.25, -0.35, [0.0, 0.9, 0.95, 0.95], 0.7, 0.6), l: P(0.24, -0.33, -0.38, 0.1, 0.25, -0.6, 0.45, 0.6, 0.45) },
  reach: { r: P(0.11, -0.12, -0.43, -0.15, 0.15, -0.25, 0.08, 0.15, 0.1, 0.1), l: P(0.23, -0.33, -0.38, 0.1, 0.25, -0.6, 0.45, 0.6, 0.45) },
  grab: { r: P(0.11, -0.13, -0.41, -0.05, 0.15, -0.3, 0.85, 0.7, 0.6), l: P(0.23, -0.33, -0.38, 0.1, 0.25, -0.6, 0.45, 0.6, 0.45) },
  empHold: { r: P(0.17, -0.15, -0.36, 0.25, 0.35, -0.3, 0.72, 0.6, 0.55), l: P(0.22, -0.31, -0.38, 0.1, 0.25, -0.6, 0.45, 0.6, 0.45), items: { r: 'emp' } },
  empWind: { r: P(0.24, -0.06, -0.2, 0.9, -0.6, -0.4, 0.72, 0.6, 0.55), l: P(0.15, -0.2, -0.42, -0.1, 0.1, -0.3, 0.2, 0.2, 0.1, 0.1), items: { r: 'emp' } },
  empThrow: { r: P(0.08, -0.12, -0.55, -0.45, 0.1, -0.1, 0.12, 0.2, 0.1, 0.15), l: P(0.2, -0.3, -0.38, 0.1, 0.25, -0.6, 0.45, 0.6, 0.45) },
  eat: { r: P(0.04, -0.15, -0.25, 0.55, 0.8, -0.25, 0.75, 0.55, 0.5), l: P(0.22, -0.32, -0.38, 0.1, 0.25, -0.6, 0.45, 0.6, 0.45), items: { r: 'ration' } },
  showcaseEmp: {
    r: P(0.11, -0.14, -0.36, 0.1, 0.45, -1.2, 0.72, 0.6, 0.55),
    l: P(0.13, -0.18, -0.38, 0.35, 0.4, 0.4, 0.25, 0.25, 0.15, 0.05),
    items: { r: 'emp' },
  },
  showcase: {
    r: P(0.1, -0.12, -0.36, -0.2, 0.35, -0.9, [0.3, 0.7, 0.85, 0.9], 0.55, 0.75),
    l: P(0.12, -0.16, -0.38, 0.35, 0.4, 0.4, 0.25, 0.25, 0.15, 0.05),
    items: { r: 'pick' },
  },
};

/** Left hand holding the torch overhand: fingers wrap over it, lens pokes out past the fingertips. */
const TORCH_L = P(0.14, -0.15, -0.4, 0.1, 0.18, -0.25, 0.86, 0.7, 0.6);

// ------------------------------------------------------------------ hand rig
class HandRig {
  root = new THREE.Group(); // wrist
  fingers: Finger[] = [];
  thumbBase = new THREE.Group();
  thumbJoints: THREE.Group[] = [];
  grip = new THREE.Group(); // item anchor in the palm
  pinch = new THREE.Group(); // item anchor between thumb and index
  cur: HandPose;

  private a: number;

  constructor(private side: 1 | -1, look: HandLook, private accentU: { value: number }) {
    // `side` = screen side (+1 right). `s` = anatomical mirror: a palm-down right hand has its
    // thumb on the -x side, so finger/thumb offsets use the opposite sign.
    const s = -side;
    this.a = s;
    const glove = gloveMaterial(look.glove, look.gloveWear);
    const pad = hardMat(look.pad, 0.4, 0.05);
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = false;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // palm: rounded box tapering toward the wrist
    const palmGeo = new RoundedBoxGeometry(0.09, 0.036, 0.098, 4, 0.015);
    const pp = palmGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const z = pp.getZ(i); // -0.0475 (fingers) … +0.0475 (wrist)
      const t = (z + 0.0475) / 0.095;
      pp.setX(i, pp.getX(i) * (1 - t * 0.18) + s * t * 0.004);
      pp.setY(i, pp.getY(i) * (1 - t * 0.12) + (pp.getY(i) < 0 ? -Math.sin(t * Math.PI) * 0.003 : 0));
    }
    palmGeo.computeVertexNormals();
    add(this.root, palmGeo, glove, 0, 0, -0.047);
    // back-of-hand armour plate + knuckle ridge
    const plate = new RoundedBoxGeometry(0.06, 0.008, 0.05, 3, 0.004);
    add(this.root, plate, pad, s * 0.002, 0.017, -0.05, 0.08, 0, 0);
    const ridge = new RoundedBoxGeometry(0.08, 0.012, 0.016, 3, 0.005);
    add(this.root, ridge, pad, 0, 0.014, -0.088, 0.1, 0, 0);
    // wrist strap: flat velcro band hugging the glove cuff, with a buckle
    const strap = cylAlong(0.02, 0.041, 0.04, 24);
    strap.scale(1, 0.8, 1);
    add(this.root, strap, hardMat('#1c1c1c', 0.75), 0, 0, 0.018);
    add(this.root, new RoundedBoxGeometry(0.022, 0.006, 0.016, 2, 0.002), hardMat('#4a4a4a', 0.35, 0.7), 0, 0.033, 0.008);

    // fingers
    for (const f of FINGERS) {
      const base = new THREE.Group();
      base.position.set(s * f.x, 0.002, f.z);
      base.rotation.y = -s * f.spread;
      this.root.add(base);
      const joints: THREE.Group[] = [];
      let parent: THREE.Object3D = base;
      f.lens.forEach((len, i) => {
        const j = new THREE.Group();
        parent.add(j);
        const fr = f.r * 1.22; // gloved fingers are chunkier than bare ones
        const r0 = fr * (1 - i * 0.08), r1 = fr * (1 - (i + 1) * 0.08);
        add(j, segmentGeo(len, r0, r1, i === 2), gloveMaterial(look.glove, look.gloveWear, len));
        if (i === 0) add(j, new RoundedBoxGeometry(fr * 1.6, 0.006, len * 0.55, 2, 0.0025), pad, 0, fr * 0.8, -len * 0.45);
        const next = new THREE.Group();
        next.position.z = -len;
        j.add(next);
        joints.push(j);
        parent = next;
      });
      this.fingers.push({ base, joints });
    }

    // thumb
    this.thumbBase.position.set(s * 0.033, -0.009, -0.024);
    this.root.add(this.thumbBase);
    let tp: THREE.Object3D = this.thumbBase;
    // thenar pad: soft bulge where the thumb meets the palm
    add(this.root, new THREE.SphereGeometry(0.022, 16, 12).scale(0.9, 0.7, 1.4), glove, s * 0.026, -0.008, -0.035);
    [0.034, 0.028, 0.025].forEach((len, i) => {
      const j = new THREE.Group();
      tp.add(j);
      add(j, segmentGeo(len, 0.0158 - i * 0.0016, 0.0142 - i * 0.0018, i === 2), gloveMaterial(look.glove, look.gloveWear, len));
      const next = new THREE.Group();
      next.position.z = -len;
      j.add(next);
      this.thumbJoints.push(j);
      tp = next;
    });

    // forearm sleeve heading back & down out of frame
    const arm = new THREE.Group();
    arm.rotation.x = 0.62;
    this.root.add(arm);
    add(arm, cylAlong(0.24, 0.031, 0.039), fabricMat(look.sleeve), 0, 0, 0.26);
    // rolled sleeve cuff (open band, slightly proud of the sleeve)
    add(arm, cylAlong(0.032, 0.035, 0.034, 24), fabricMat(look.cuff, 0.9), 0, 0, 0.062);
    // glove gauntlet overlapping the sleeve
    add(arm, cylAlong(0.05, 0.033, 0.031, 24), glove, 0, 0, 0.05);
    // wrist gadget on the left arm (display glows in the accent colour)
    if (this.side === -1) {
      add(arm, new RoundedBoxGeometry(0.028, 0.012, 0.034, 3, 0.003), hardMat(look.heavy ? '#4a3a2a' : '#202326', 0.4, 0.4), 0, 0.036, 0.085);
      const screen = glow(look.accent, 3);
      (screen.intensity as any).onFrameUpdate?.(() => this.accentU.value);
      const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.024), screen.material);
      disp.rotation.x = -Math.PI / 2;
      disp.position.set(0, 0.0425, 0.085);
      arm.add(disp);
      if (look.heavy) add(arm, new THREE.CylinderGeometry(0.005, 0.005, 0.038, 8), steelMat('#8a8f94', 0.4), 0.019, 0.034, 0.085, Math.PI / 2);
    }

    // item anchors
    this.grip.position.set(-s * 0.002, -0.028, -0.06);
    this.root.add(this.grip);
    this.pinch.position.set(s * 0.028, -0.022, -0.115);
    this.root.add(this.pinch);

    // FP convention: hands read ~30% larger than life
    this.root.scale.setScalar(1.3);
    this.cur = { ...clonePose(POSES.idle.r) };
  }

  apply(p: HandPose) {
    const side = this.side;
    const s = this.a;
    this.root.position.set(p.pos.x * side, p.pos.y, p.pos.z);
    this.root.rotation.set(p.rot.x, p.rot.y * side, p.rot.z * side, 'YXZ');
    // fingers: distribute curl across the three joints
    this.fingers.forEach((f, i) => {
      const c = p.curl[i];
      f.joints[0].rotation.x = -c * 1.35;
      f.joints[1].rotation.x = -c * 1.6;
      f.joints[2].rotation.x = -c * 1.05;
      f.base.rotation.y = -s * FINGERS[i].spread * (1 + p.spread * 3);
    });
    // thumb: splayed sideways & forward, curls and opposes across the palm
    // relaxed thumb: ~35° off the index, angled down; opposing swings it under the fingers
    this.thumbBase.rotation.set(-0.5 - p.oppose * 0.45, -s * (0.42 - p.oppose * 0.75), s * (0.6 + p.oppose * 0.5), 'YXZ');
    this.thumbJoints[0].rotation.x = -p.thumb * 0.35;
    this.thumbJoints[1].rotation.x = -p.thumb * 0.8;
    this.thumbJoints[2].rotation.x = -p.thumb * 0.9;
  }
}

function clonePose(p: HandPose): HandPose {
  return { pos: p.pos.clone(), rot: p.rot.clone(), curl: [...p.curl] as HandPose['curl'], thumb: p.thumb, oppose: p.oppose, spread: p.spread };
}

function blendPose(cur: HandPose, target: HandPose, k: number) {
  cur.pos.lerp(target.pos, k);
  cur.rot.set(
    cur.rot.x + (target.rot.x - cur.rot.x) * k,
    cur.rot.y + (target.rot.y - cur.rot.y) * k,
    cur.rot.z + (target.rot.z - cur.rot.z) * k,
  );
  for (let i = 0; i < 4; i++) cur.curl[i] += (target.curl[i] - cur.curl[i]) * k;
  cur.thumb += (target.thumb - cur.thumb) * k;
  cur.oppose += (target.oppose - cur.oppose) * k;
  cur.spread += (target.spread - cur.spread) * k;
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
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.15, 20), hardMat('#1d1f22', 0.4, 0.6));
  body.position.y = 0.04;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0185, 0.0185, 0.05, 20), hardMat('#3a3d40', 0.85));
  grip.position.y = 0.0;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.019, 0.04, 20), hardMat('#26292d', 0.35, 0.7));
  head.position.y = 0.135;
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.003, 8, 24), steelMat('#c8ccd0', 0.3));
  bezel.position.y = 0.155;
  bezel.rotation.x = Math.PI / 2;
  const lensG = glow('#fff4dd', 6);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), lensG.material);
  lens.position.y = 0.1555;
  lens.rotation.x = -Math.PI / 2;
  tb.add(body, grip, head, bezel, lens);
  torch.add(tb);
  torch.rotation.set(-Math.PI / 2, 0, 0);
  torch.position.set(0, 0.008, 0.01);
  torch.userData.lens = lensG.intensity;
  for (const it of Object.values(items)) it.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = true; } });
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
}

type Action = { pose: string; dur: number; t: number; onHit?: () => void; hitAt?: number; hit?: boolean; next?: Action };

/**
 * First-person viewmodel. Authored at real scale around the eye, then shrunk toward the camera
 * (VIEW_SCALE) so the hands never clip into nearby walls while looking full-size on screen.
 */
export class Hands {
  static VIEW_SCALE = 0.32;
  root = new THREE.Group();
  private right: HandRig;
  private left: HandRig;
  private items: Record<string, THREE.Group>;
  private base = 'idle';
  private action: Action | null = null;
  private sway = new THREE.Vector2();
  private swayVel = new THREE.Vector2();
  private dip = 0;
  private t = 0;
  private accent = { value: 3 };
  private kick = 0;
  flashlightOn = false;
  readonly flashlight: THREE.SpotLight;

  constructor(look: HandLook) {
    this.right = new HandRig(1, look, this.accent);
    this.left = new HandRig(-1, look, this.accent);
    this.items = buildItems(look);
    this.root.add(this.right.root, this.left.root);
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
    this.play([{ pose: 'empHold', dur: 0.18 }, { pose: 'empWind', dur: 0.22 }, { pose: 'empThrow', dur: 0.35 }], onRelease, 2, 0.05);
  }
  eat(onDone?: () => void) {
    this.play([{ pose: 'eat', dur: 0.35 }, { pose: 'eat', dur: 0.9 }], onDone, 1, 0.5);
  }
  reach(onTouch?: () => void) {
    this.play([{ pose: 'reach', dur: 0.2 }, { pose: 'grab', dur: 0.3 }], onTouch, 1, 0.05);
  }
  press(onPress?: () => void) {
    this.play([{ pose: 'keypad', dur: 0.25 }, { pose: 'keypad', dur: 0.25 }], onPress, 0, 0.2);
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
      poseName = f.sprint ? 'run' : f.crouch ? 'crouch' : 'idle';
    }
    const def = POSES[poseName] ?? POSES.idle;
    const k = 1 - Math.exp(-(this.action ? 18 : 9) * dt);
    const torchGrip = this.flashlightOn && !def.items?.l && poseName !== 'lockpick' && poseName !== 'showcase' && poseName !== 'showcaseEmp';
    blendPose(this.right.cur, def.r, k);
    blendPose(this.left.cur, torchGrip ? TORCH_L : def.l, k);

    // items in hands
    const want = { r: def.items?.r, l: def.items?.l ?? (torchGrip ? 'flashlight' : undefined) };
    for (const [name, obj] of Object.entries(this.items)) {
      const hand = want.r === name ? this.right : want.l === name ? this.left : null;
      if (!hand) { obj.removeFromParent(); continue; }
      const anchor = name === 'pick' || name === 'wrench' ? hand.pinch : hand.grip;
      if (obj.parent !== anchor) anchor.add(obj);
    }

    // procedural motion: gait bob, look sway (spring), landing dip, breathing, kick
    const move = Math.min(1, f.speed / 3.4);
    const run = f.sprint ? 1 : 0;
    const bobX = Math.sin(f.bobPhase) * 0.012 * move * (1 + run);
    const bobY = Math.abs(Math.cos(f.bobPhase)) * 0.014 * move * (1 + run * 1.2);
    const breathe = Math.sin(this.t * 1.6) * 0.003;
    // spring toward the negative of mouse motion (hands lag behind the view)
    const target = new THREE.Vector2(-f.lookDX * 0.00025, f.lookDY * 0.00025);
    target.clampLength(0, 0.05);
    this.swayVel.addScaledVector(target.sub(this.sway), 120 * dt);
    this.swayVel.multiplyScalar(Math.exp(-14 * dt));
    this.sway.addScaledVector(this.swayVel, dt);
    this.dip = damp(this.dip, f.grounded ? 0 : -0.02, 6, dt);
    this.kick = damp(this.kick, 0, 5, dt);

    const apply = (rig: HandRig, phase: number) => {
      const p = clonePose(rig.cur);
      p.pos.x += bobX * phase + this.sway.x;
      p.pos.y += -bobY + breathe + this.sway.y + this.dip - this.kick * 0.04;
      p.pos.z += this.kick * 0.05;
      p.rot.z += this.sway.x * 3 * phase;
      p.rot.x += this.sway.y * 2 + this.kick * 0.3;
      rig.apply(p);
    };
    apply(this.right, 1);
    apply(this.left, -1);

    // gadget + emp ring pulse, flashlight
    this.accent.value = 2.5 + Math.pow(Math.max(0, Math.sin(this.t * 2.4)), 12) * 6;
    const ring = this.items.emp.userData.ring as { value: number };
    ring.value = 4 + Math.sin(this.t * 18) * 2;
    const lens = this.items.flashlight.userData.lens as { value: number };
    lens.value = this.flashlightOn ? 8 : 0.1;
    this.flashlight.intensity = damp(this.flashlight.intensity, this.flashlightOn && want.l === 'flashlight' ? 16 : 0, 14, dt);
  }

  dispose() {
    this.root.removeFromParent();
    this.flashlight.removeFromParent();
    this.flashlight.target.removeFromParent();
  }
}

