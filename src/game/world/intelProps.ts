import * as THREE from 'three/webgpu';
import { Fn, uv, vec4, float, length, smoothstep, pow, atan, cos, uniform, color } from 'three/tsl';
import { MeshBatch, canvasTexture } from './kit';
import { wood, rustyMetal, plainStandard, glow, desertRock } from './materials';
import { rockGeometry } from './Props';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Intel in the world is the thing itself: a note pinned under a rock, a blueprint weighed down with
 * stones, a roadside call box with its message light blinking, a clipboard on the shoulder, a valve
 * tag wired to a pipe. Each has a small glint that catches the eye every few seconds (and the map
 * marker does the rest). Built in the item's local frame: origin on the ground, +Z toward the road.
 */

export interface IntelProp {
  group: THREE.Group;
  /** Twinkle phase/strength (the glint sprite's uniforms). */
  glint: { t: { value: number }; k: { value: number } };
  /** Blinking parts (the call box's message light). */
  blink?: { value: number };
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) =>
  g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(s, s, s)));

let _paper: THREE.MeshStandardNodeMaterial | null = null;
let _blue: THREE.MeshStandardNodeMaterial | null = null;
let _form: THREE.MeshStandardNodeMaterial | null = null;
/** Handwriting on cheap paper. */
function paperMat() {
  return (_paper ??= new THREE.MeshStandardNodeMaterial({
    map: canvasTexture(256, 320, (c, w, h) => {
      c.fillStyle = '#e9e1cc'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(40,60,120,0.25)'; c.lineWidth = 1;
      for (let y = 40; y < h; y += 18) { c.beginPath(); c.moveTo(14, y); c.lineTo(w - 10, y); c.stroke(); }
      c.strokeStyle = '#2a2a33'; c.lineWidth = 2.2;
      for (let y = 36; y < h - 30; y += 18) {
        c.beginPath();
        let x = 18 + Math.random() * 8;
        c.moveTo(x, y);
        while (x < w - 30 - Math.random() * 60) { x += 4 + Math.random() * 7; c.lineTo(x, y - 3 + Math.random() * 6); }
        c.stroke();
      }
      c.fillStyle = 'rgba(120,80,30,0.18)';
      c.beginPath(); c.arc(w * 0.7, h * 0.75, 40, 0, Math.PI * 2); c.fill(); // a coffee ring
    }),
    roughness: 0.9, side: THREE.DoubleSide,
  }));
}
function blueprintMat() {
  return (_blue ??= new THREE.MeshStandardNodeMaterial({
    map: canvasTexture(384, 256, (c, w, h) => {
      c.fillStyle = '#1d4f8a'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(220,235,255,0.8)'; c.lineWidth = 2;
      c.strokeRect(14, 14, w - 28, h - 28);
      c.strokeRect(70, 60, 180, 120); c.strokeRect(250, 60, 60, 70); // the house, the vault
      c.beginPath(); c.moveTo(70, 120); c.lineTo(250, 120); c.moveTo(160, 60); c.lineTo(160, 180); c.stroke();
      c.setLineDash([6, 5]); c.strokeRect(40, 36, 300, 180); c.setLineDash([]); // the fence
      c.fillStyle = 'rgba(220,235,255,0.85)'; c.font = '700 14px monospace';
      c.fillText('PROJECT GARAGE · REV 44', 24, h - 22);
      c.fillStyle = '#c8302a'; c.fillRect(300, 30, 40, 12); // the blacked-out code field, in marker
    }),
    roughness: 0.85, side: THREE.DoubleSide,
  }));
}
function formMat() {
  return (_form ??= new THREE.MeshStandardNodeMaterial({
    map: canvasTexture(256, 320, (c, w, h) => {
      c.fillStyle = '#ece8dc'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#2a3a5a'; c.fillRect(0, 0, w, 34);
      c.fillStyle = '#fff'; c.font = '700 15px sans-serif'; c.fillText('COUNTY WATER DIVISION', 14, 22);
      c.fillStyle = '#333';
      for (let y = 56; y < h - 40; y += 22) { c.fillRect(14, y, 70, 2); c.fillRect(96, y, w - 112, 1); }
      c.strokeStyle = '#1a3a8a'; c.lineWidth = 2; c.beginPath(); c.moveTo(120, h - 40); c.bezierCurveTo(150, h - 70, 170, h - 10, 220, h - 45); c.stroke(); // signature
      c.fillStyle = 'rgba(140,100,60,0.22)'; c.fillRect(0, h * 0.55, w, 26); // rain stain
    }),
    roughness: 0.9, side: THREE.DoubleSide,
  }));
}

/** A star glint that flashes now and then (additive sprite). */
function glintSprite() {
  const t = uniform(0), k = uniform(1);
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  m.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(2);
    const r = length(p);
    const a = atan(p.y, p.x);
    const rays = pow(cos(a.mul(2)).abs(), 24).mul(smoothstep(1.0, 0.0, r));
    const core = smoothstep(0.35, 0.0, r);
    // a quick flash: t runs 0..1 each cycle, the flash lives in the first tenth
    const flash = smoothstep(0.0, 0.03, t).mul(smoothstep(0.12, 0.04, t));
    return vec4(color('#fff2d8').mul(rays.add(core.mul(1.5))).mul(flash).mul(k).mul(3), float(1));
  })();
  const s = new THREE.Sprite(m);
  s.scale.setScalar(0.5);
  s.renderOrder = 22;
  return { sprite: s, t, k };
}

export function buildIntelProp(id: string, opts: { crate?: boolean } = {}): IntelProp {
  const g = new THREE.Group();
  const mb = new MeshBatch();
  const rock = desertRock();
  const steel = rustyMetal({ base: '#6a6d70', rust: 0.45, metalness: 0.7 });
  let glintAt = V(0, 0.2, 0);
  let blink: { value: number } | undefined;
  // (Apex's shift note and the memo in the Cistern Room are pages on a crate too)
  if (id === 'intel.gas.note' || id === 'intel.apex.shift' || id === 'intel.apex.memo') {
    // a folded page on an upturned milk crate, pinned under a fist-sized rock, a dented can beside it
    const crateMat = plainStandard('#b8401e', 0.7);
    const H = opts.crate === false ? 0.004 : 0.3;
    if (opts.crate !== false) {
      mb.add(crateMat, at(new THREE.BoxGeometry(0.42, 0.03, 0.34), 0, H - 0.015, 0));
      for (const [x, z, w, d] of [[0, 0.155, 0.42, 0.03], [0, -0.155, 0.42, 0.03], [0.195, 0, 0.03, 0.34], [-0.195, 0, 0.03, 0.34]]) mb.add(crateMat, at(new THREE.BoxGeometry(w, H, d), x, H / 2, z));
    }
    const sheet = new THREE.Mesh(at(new THREE.PlaneGeometry(0.22, 0.28, 2, 2), 0, H + 0.004, 0, -Math.PI / 2, 0.4, 0), paperMat());
    g.add(sheet);
    const fold = new THREE.Mesh(at(new THREE.PlaneGeometry(0.22, 0.08), 0.035, H + 0.025, -0.11, -Math.PI / 2 + 0.5, 0.4, 0), paperMat());
    g.add(fold);
    mb.add(rock, at(rockGeometry(7, 1), 0.04, H + 0.04, 0.03, 0, 0, 0, 0.06));
    mb.add(rustyMetal({ base: '#a03a2a', rust: 0.6, metalness: 0.6 }), at(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 12), -0.22, 0.033, 0.12, Math.PI / 2, 0.8, 0));
    glintAt = V(0, H + 0.1, 0);
    g.scale.setScalar(1.35);
  } else if (id === 'intel.spire.blueprint') {
    // half unrolled on a toppled crate, two stones on the corners, the tube beside it
    mb.add(wood('#7d5a36'), at(new THREE.BoxGeometry(0.9, 0.42, 0.6), 0, 0.21, 0, 0, 0.2, 0.06));
    const sheet = new THREE.Mesh(at(new THREE.PlaneGeometry(0.6, 0.4, 3, 1), 0, 0.44, 0, -Math.PI / 2 + 0.06, 0.2, 0), blueprintMat());
    g.add(sheet);
    const curl = new THREE.Mesh(at(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 12, 1, true, 0, Math.PI * 1.6), 0.3, 0.47, 0.06, Math.PI / 2, 0.2, 0), blueprintMat());
    g.add(curl);
    for (const [x, z] of [[-0.25, -0.16], [-0.22, 0.17]]) mb.add(rock, at(rockGeometry(11 + x * 10, 1), x, 0.48, z, 0, 0, 0, 0.05));
    mb.add(plainStandard('#8a6a40', 0.8), at(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 12), 0.25, 0.045, 0.45, Math.PI / 2, 1.1, 0));
    glintAt = V(0, 0.55, 0);
  } else if (id === 'intel.highway.greg') {
    // a roadside emergency call box on a post; the message light is still blinking
    const yellow = plainStandard('#d9a521', 0.55, 0.2);
    mb.add(steel, at(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 10), 0, 0.65, 0));
    mb.add(yellow, at(new THREE.BoxGeometry(0.36, 0.46, 0.2), 0, 1.4, 0));
    mb.add(plainStandard('#1a1a1a', 0.6), at(new THREE.BoxGeometry(0.08, 0.26, 0.06), 0.09, 1.4, 0.12)); // handset
    mb.add(plainStandard('#c8302a', 0.5), at(new THREE.BoxGeometry(0.3, 0.06, 0.205), 0, 1.66, 0)); // red band
    mb.add(steel, at(new THREE.BoxGeometry(0.12, 0.08, 0.02), -0.08, 1.36, 0.105)); // grille
    const led = glow('#ff2a1a', 8);
    blink = led.intensity as unknown as { value: number };
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), led.material);
    l.position.set(-0.1, 1.53, 0.105);
    g.add(l);
    glintAt = V(0, 1.45, 0.15);
  } else if (id === 'intel.highway.permit' || id === 'intel.salt.waybill') {
    // a clipboard face-up on the shoulder, propped on a stone
    const tilt = -Math.PI / 2 + 0.25;
    g.scale.setScalar(1.2);
    mb.add(wood('#6b4a2e'), at(new THREE.BoxGeometry(0.24, 0.33, 0.01), 0, 0.06, 0, tilt, 0.5, 0));
    mb.add(steel, at(new THREE.BoxGeometry(0.1, 0.035, 0.03), 0, 0.082, -0.15, tilt, 0.5, 0));
    const form = new THREE.Mesh(at(new THREE.PlaneGeometry(0.21, 0.28), 0, 0.068, 0.008, tilt, 0.5, 0), formMat());
    g.add(form);
    mb.add(rock, at(rockGeometry(23, 1), 0.02, 0.02, -0.16, 0, 0, 0, 0.05));
    glintAt = V(0, 0.15, 0);
  } else {
    // the valve: a pipe stub out of the ground, a red wheel, a yellow tag wired to it
    mb.add(rustyMetal({ base: '#5a6a72', rust: 0.55, metalness: 0.8 }), at(new THREE.CylinderGeometry(0.09, 0.1, 0.7, 14), 0, 0.35, 0));
    mb.add(rustyMetal({ base: '#5a6a72', rust: 0.55, metalness: 0.8 }), at(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 14), 0, 0.7, 0));
    mb.add(rustyMetal({ base: '#b02a22', rust: 0.35, metalness: 0.4 }), at(new THREE.TorusGeometry(0.16, 0.018, 6, 20), 0, 0.82, 0, Math.PI / 2, 0, 0));
    mb.add(steel, at(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6), 0, 0.76, 0));
    mb.add(plainStandard('#e6c21e', 0.4, 0.3), at(new THREE.BoxGeometry(0.1, 0.06, 0.004), 0.16, 0.74, 0.02, 0, 0.3, 0.2));
    glintAt = V(0.16, 0.78, 0.04);
  }
  const parts = mb.build(`intel:${id}`);
  parts.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  g.add(parts);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.receiveShadow = true; } });
  const gl = glintSprite();
  gl.sprite.position.copy(glintAt);
  g.add(gl.sprite);
  return { group: g, glint: { t: gl.t, k: gl.k }, blink };
}

void (null as any);
