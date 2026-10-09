import * as THREE from 'three/webgpu';
import { Fn, uv, vec4, float, length, smoothstep, pow, atan, cos, uniform, color } from 'three/tsl';
import { MeshBatch, canvasTexture } from './kit';
import { wood, rustyMetal, plainStandard, glow, desertRock, fabric } from './materials';
import { rockGeometry } from './Props';
import { loreMaterial, loreScreen, loreQuad } from './loreAtlas';

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

export function buildIntelProp(id: string, opts: { crate?: boolean; prop?: string } = {}): IntelProp {
  const g = new THREE.Group();
  const mb = new MeshBatch();
  const rock = desertRock();
  const steel = rustyMetal({ base: '#6a6d70', rust: 0.45, metalness: 0.7 });
  let glintAt = V(0, 0.2, 0);
  let blink: { value: number } | undefined;
  if (opts.prop) {
    const r = loreProp(opts.prop, mb, g);
    glintAt = r.glint;
    blink = r.blink;
  } else if (id === 'intel.gas.note' || id === 'intel.apex.shift' || id === 'intel.apex.memo') {
    // (Apex's shift note and the memo in the Cistern Room are pages on a crate too)
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

// ------------------------------------------------------------------ lore pickups (content/world.ts `prop`)
/**
 * The valley's other paperwork: devices that kept their last page of the founders' group chat,
 * posters, a letter, a station log. Every printed face comes from one atlas (loreAtlas.ts: one lit
 * material, one faintly glowing screen), the rest from the memoized factories, so a lore prop is a
 * handful of draws and no new shader programs after the first. Local frame: origin on the ground.
 */
function loreProp(kind: string, mb: MeshBatch, g: THREE.Group): { glint: THREE.Vector3; blink?: { value: number } } {
  const rock = desertRock();
  const steel = rustyMetal({ base: '#6a6d70', rust: 0.45, metalness: 0.7 });
  const black = plainStandard('#16171a', 0.35, 0.3);
  const paper = loreMaterial();
  const screen = loreScreen();
  const P = (name: string, w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => at(loreQuad(name, w, h), x, y, z, rx, ry, rz);
  const flatRock = (seed: number, x: number, z: number, s = 0.16, h = 0.35) =>
    mb.add(rock, at(rockGeometry(seed, 1).scale(s, s * h, s), x, s * h * 0.45, z, 0, seed, 0));
  const FLAT = -Math.PI / 2;
  switch (kind) {
    case 'phone': case 'watch': {
      // a phone (or a smartwatch on its open strap) face up on a flat stone, the chat still on the screen
      flatRock(31, 0, 0, 0.2, 0.3);
      const top = 0.055;
      if (kind === 'phone') {
        mb.add(black, at(new THREE.BoxGeometry(0.078, 0.009, 0.158), 0.01, top, 0, 0, 0.5, 0.04));
        mb.add(screen, P('chat', 0.07, 0.148, 0.01, top + 0.0052, 0, FLAT, 0, 0.5));
        mb.add(plainStandard('#c9d2d8', 0.6, 0.4), at(new THREE.BoxGeometry(0.05, 0.004, 0.02), -0.12, 0.012, 0.13, 0, 1.1, 0)); // a piece of the case
      } else {
        mb.add(black, at(new THREE.BoxGeometry(0.044, 0.012, 0.05), 0, top, 0, 0, 0.3, 0));
        mb.add(screen, P('chat', 0.036, 0.044, 0, top + 0.0065, 0, FLAT, 0, 0.3));
        mb.add(fabric('#d8d2c4', 0.8), at(new THREE.BoxGeometry(0.022, 0.004, 0.12), 0.02, top - 0.012, 0.075, 0.4, 0.3, 0));
        mb.add(fabric('#d8d2c4', 0.8), at(new THREE.BoxGeometry(0.022, 0.004, 0.11), -0.01, top - 0.014, -0.072, -0.45, 0.3, 0));
      }
      g.scale.setScalar(1.8);
      return { glint: V(0, 0.1, 0) };
    }
    case 'tablet': {
      // a rugged tablet propped against a rock, an orange bumper, a charging brick in the sand
      mb.add(rock, at(rockGeometry(41, 1).scale(0.2, 0.17, 0.2), 0, 0.1, -0.16));
      const tilt = -0.95;
      mb.add(plainStandard('#3a3d33', 0.7, 0.1), at(new THREE.BoxGeometry(0.29, 0.21, 0.018), 0, 0.1, 0.0, tilt, 0, 0));
      // the face's normal after the tilt is (0, -sin, cos); the screen sits a hair in front of it
      mb.add(screen, P('chatWide', 0.255, 0.18, 0, 0.1 - Math.sin(tilt) * 0.01, Math.cos(tilt) * 0.01, tilt, 0, 0));
      mb.add(plainStandard('#ff8a1c', 0.6), at(new THREE.BoxGeometry(0.3, 0.03, 0.03), 0, 0.03, 0.07, tilt, 0, 0));
      mb.add(black, at(new THREE.BoxGeometry(0.06, 0.025, 0.04), 0.26, 0.012, 0.12, 0, 0.6, 0));
      g.scale.setScalar(1.4);
      return { glint: V(0, 0.2, 0.05) };
    }
    case 'case': {
      // an open hard-shell briefcase on the shoulder: foam, a laptop, the chat on the laptop
      const shell = plainStandard('#b9bcbf', 0.35, 0.6);
      mb.add(shell, at(new THREE.BoxGeometry(0.5, 0.09, 0.36), 0, 0.045, 0));
      mb.add(shell, at(new THREE.BoxGeometry(0.5, 0.36, 0.04), 0, 0.2, -0.21, -0.18, 0, 0)); // the lid, open
      mb.add(plainStandard('#202124', 0.95), at(new THREE.BoxGeometry(0.46, 0.012, 0.32), 0, 0.094, 0));
      mb.add(black, at(new THREE.BoxGeometry(0.34, 0.012, 0.22), 0.0, 0.106, 0.04));
      mb.add(black, at(new THREE.BoxGeometry(0.34, 0.22, 0.01), 0.0, 0.2, -0.08, -0.3, 0, 0));
      mb.add(screen, P('chatWide', 0.3, 0.19, 0.0, 0.2, -0.074, -0.3, 0, 0));
      mb.add(steel, at(new THREE.BoxGeometry(0.12, 0.02, 0.02), 0, 0.06, 0.19));
      g.scale.setScalar(1.25);
      return { glint: V(0, 0.3, 0) };
    }
    case 'printout': {
      // fan-fold printer paper spilling off a pulled server blade
      mb.add(rustyMetal({ base: '#2b2e33', rust: 0.15, metalness: 0.8 }), at(new THREE.BoxGeometry(0.44, 0.09, 0.7), 0, 0.045, 0, 0, 0, 0.03));
      for (let i = 0; i < 4; i++) {
        mb.add(paper, P('printout', 0.24, 0.3, 0.38 + i * 0.03, 0.01 + i * 0.012, 0.12 - i * 0.07, FLAT + (i % 2 ? 0.12 : -0.12), 0, 0.06 * i));
      }
      mb.add(paper, P('printout', 0.24, 0.3, 0.02, 0.0915, 0.0, FLAT, 0, 0));
      g.scale.setScalar(1.2);
      return { glint: V(0.2, 0.15, 0.05) };
    }
    case 'drone': {
      // a white Glimpse quadcopter nose-down in the sand, one arm snapped, the camera pod still looking
      const shellW = plainStandard('#e8ebee', 0.35, 0.1);
      // built level, then the whole airframe is tipped nose-down into the sand
      const tiltM = new THREE.Matrix4().compose(V(0, 0.16, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, 0.5, 0.18)), V(1, 1, 1));
      const D = (mat: THREE.Material, geo: THREE.BufferGeometry) => mb.add(mat, geo.applyMatrix4(tiltM));
      D(shellW, new THREE.BoxGeometry(0.3, 0.09, 0.3));
      ([[1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 0]] as const).forEach(([ax, az, keep]) => {
        const len = keep ? 0.3 : 0.12;
        const a = Math.atan2(ax, az);
        D(shellW, at(new THREE.BoxGeometry(0.03, 0.02, len), Math.sin(a) * (0.12 + len / 2), 0.02, Math.cos(a) * (0.12 + len / 2), 0, a, 0));
        if (keep) {
          const r = 0.12 + len;
          D(black, at(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 8), Math.sin(a) * r, 0.04, Math.cos(a) * r));
          D(black, at(new THREE.CylinderGeometry(0.11, 0.11, 0.005, 14), Math.sin(a) * r, 0.065, Math.cos(a) * r));
        }
      });
      D(black, at(new THREE.SphereGeometry(0.05, 12, 8), 0, -0.06, 0.12));
      D(paper, P('sticker', 0.11, 0.11, 0, 0.0455, 0, FLAT, 0, 0));
      D(plainStandard('#2a6ad0', 0.5), at(new THREE.BoxGeometry(0.02, 0.003, 0.028), -0.15, 0.0, 0.08)); // the memory card, half out
      const led = glow('#3fa8ff', 6);
      D(led.material, at(new THREE.SphereGeometry(0.012, 8, 6), 0.0, -0.06, 0.172));
      flatRock(53, -0.34, 0.2, 0.14, 0.5);
      g.scale.setScalar(1.3);
      return { glint: V(0, 0.24, 0.05), blink: led.intensity as unknown as { value: number } };
    }
    case 'pod': {
      // a seat-back screen torn out of a pod, lying on its padding, still showing the chat
      mb.add(fabric('#d9dde2', 0.85), at(new THREE.BoxGeometry(0.5, 0.08, 0.36), 0, 0.04, 0, 0, 0, 0.02));
      mb.add(plainStandard('#c8ccd2', 0.3, 0.5), at(new THREE.BoxGeometry(0.34, 0.025, 0.24), 0.02, 0.095, 0));
      mb.add(screen, P('chatWide', 0.3, 0.2, 0.02, 0.1085, 0, FLAT, 0, 0));
      mb.add(black, at(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 5), -0.3, 0.02, 0.1, 0, 0.3, Math.PI / 2));
      g.scale.setScalar(1.25);
      return { glint: V(0, 0.2, 0) };
    }
    case 'poster': {
      // Kade's break-room poster on a sandwich board
      const board = wood('#8a7350');
      mb.add(board, at(new THREE.BoxGeometry(0.62, 0.95, 0.03), 0, 0.46, 0.16, -0.2, 0, 0));
      mb.add(board, at(new THREE.BoxGeometry(0.62, 0.95, 0.03), 0, 0.46, -0.16, 0.2, 0, 0));
      mb.add(paper, P('kadePoster', 0.5, 0.7, 0, 0.48, 0.18, -0.2, 0, 0));
      return { glint: V(0, 0.7, 0.2) };
    }
    case 'flyer': {
      // Glimpse's laminated flyer, zip-tied to a dead power pole, an older sticker below it
      mb.add(wood('#5d4630'), at(new THREE.CylinderGeometry(0.11, 0.13, 3.4, 9), 0, 1.6, 0));
      mb.add(paper, P('glimpse', 0.3, 0.42, 0, 1.45, 0.123, 0.03, 0, 0));
      mb.add(black, at(new THREE.TorusGeometry(0.124, 0.006, 4, 16), 0, 1.64, 0, Math.PI / 2, 0, 0));
      mb.add(black, at(new THREE.TorusGeometry(0.124, 0.006, 4, 16), 0, 1.26, 0, Math.PI / 2, 0, 0));
      mb.add(paper, P('sticker', 0.12, 0.12, 0.0, 0.98, 0.122, 0, 0, 0.3));
      return { glint: V(0, 1.45, 0.2) };
    }
    case 'notice': {
      // Careful's notice in a plastic sleeve on a survey lath, white flagging on top
      mb.add(wood('#c9b48c'), at(new THREE.BoxGeometry(0.05, 1.3, 0.03), 0, 0.6, 0, 0.05, 0, 0));
      mb.add(paper, P('careful', 0.3, 0.39, 0, 1.0, 0.024, 0.05, 0, 0));
      mb.add(plainStandard('#ffffff', 0.5), at(new THREE.BoxGeometry(0.06, 0.03, 0.035), 0, 1.24, 0.01, 0.05, 0, 0));
      mb.add(plainStandard('#ffffff', 0.5), at(new THREE.BoxGeometry(0.035, 0.32, 0.004), 0.08, 1.12, 0.02, 0.1, 0.3, 0.9));
      return { glint: V(0, 1.05, 0.1) };
    }
    case 'remains': {
      // someone who walked west and sat down: a grey blanket over a shape, boots out, a pack beside,
      // a sun hat, and a letter in a zip bag on top where it would be found
      const blanket = fabric('#7d7a72', 0.95);
      mb.add(blanket, at(new THREE.CapsuleGeometry(0.2, 0.9, 4, 10).scale(1, 1, 0.7), 0, 0.15, 0, Math.PI / 2, 0.15, 0));
      mb.add(blanket, at(new THREE.SphereGeometry(0.17, 10, 8).scale(1, 0.8, 1), 0.08, 0.13, -0.66));
      const boot = plainStandard('#4a3424', 0.75);
      mb.add(boot, at(new THREE.BoxGeometry(0.1, 0.12, 0.24), 0.02, 0.1, 0.72, 0.3, 0.15, 0.1));
      mb.add(boot, at(new THREE.BoxGeometry(0.1, 0.12, 0.24), 0.2, 0.09, 0.68, 0.2, 0.25, -0.2));
      mb.add(fabric('#3f5a3a', 0.9), at(new THREE.BoxGeometry(0.34, 0.42, 0.2), 0.48, 0.21, -0.28, 0, 0.5, 0.2));
      mb.add(fabric('#c9b48c', 0.9), at(new THREE.CylinderGeometry(0.2, 0.22, 0.02, 14), -0.42, 0.02, -0.5, 0.1, 0, 0.05));
      mb.add(fabric('#c9b48c', 0.9), at(new THREE.CylinderGeometry(0.1, 0.12, 0.09, 12), -0.42, 0.06, -0.5, 0.1, 0, 0.05));
      mb.add(paper, P('letter', 0.17, 0.21, 0.04, 0.29, -0.08, FLAT + 0.1, 0, 0.3));
      mb.add(plainStandard('#bcd3dc', 0.15, 0.2), at(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), 0.36, 0.035, 0.36, Math.PI / 2, 0, 0.9));
      return { glint: V(0, 0.4, -0.1) };
    }
    case 'update': {
      // an investor update, stapled, blown into a dead bush and pinned there; one page escaped
      const twig = wood('#4c3a26');
      mb.add(twig, at(new THREE.CylinderGeometry(0.02, 0.03, 0.7, 5), 0, 0.3, 0, 0.3, 0, 0.2));
      mb.add(twig, at(new THREE.CylinderGeometry(0.015, 0.025, 0.6, 5), 0.1, 0.25, -0.05, -0.35, 0, -0.3));
      mb.add(twig, at(new THREE.CylinderGeometry(0.015, 0.02, 0.5, 5), -0.12, 0.2, 0.04, 0.2, 0, 0.5));
      mb.add(twig, at(new THREE.CylinderGeometry(0.012, 0.02, 0.55, 5), 0.03, 0.24, 0.1, 0.5, 0, -0.1));
      mb.add(paper, P('update', 0.21, 0.27, 0.0, 0.42, 0.075, -0.25, 0.2, 0.15));
      mb.add(paper, P('update', 0.21, 0.27, 0.012, 0.43, 0.07, -0.2, 0.25, 0.1));
      mb.add(paper, P('update', 0.21, 0.27, 0.45, 0.01, 0.3, FLAT, 0, 1.2));
      flatRock(61, 0.47, 0.32, 0.06, 0.6);
      g.scale.setScalar(1.2);
      return { glint: V(0, 0.48, 0.1) };
    }
    case 'radio': {
      // a transistor radio and the station's log on an upturned crate
      const crate = wood('#7a5a36');
      mb.add(crate, at(new THREE.BoxGeometry(0.5, 0.36, 0.4), 0, 0.18, 0));
      mb.add(plainStandard('#7b2a22', 0.5, 0.2), at(new THREE.BoxGeometry(0.26, 0.16, 0.08), -0.1, 0.44, -0.08, 0, 0.3, 0));
      mb.add(steel, at(new THREE.BoxGeometry(0.17, 0.1, 0.006), -0.1 + Math.sin(0.3) * 0.04, 0.45, -0.08 + Math.cos(0.3) * 0.04, 0, 0.3, 0));
      mb.add(steel, at(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 4), 0.0, 0.62, -0.1, 0.5, 0.3, -0.4));
      mb.add(paper, P('kdry', 0.2, 0.25, 0.12, 0.362, 0.07, FLAT, 0, 0.15));
      mb.add(wood('#c99a3a'), at(new THREE.CylinderGeometry(0.004, 0.004, 0.15, 6), 0.13, 0.368, 0.1, 0, 0.9, Math.PI / 2));
      return { glint: V(0, 0.5, 0) };
    }
    case 'brochure': default: {
      // a glossy tri-fold in the sand, held down by a toy rocket that never went anywhere
      mb.add(paper, P('brochure', 0.3, 0.2, 0, 0.006, 0, FLAT, 0, 0.4));
      const red = plainStandard('#d23a2a', 0.45);
      const rocket = new THREE.Matrix4().compose(V(0.04, 0.026, 0.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, Math.PI / 2 - 0.05)), V(1, 1, 1));
      mb.add(plainStandard('#e8ebee', 0.4), new THREE.CylinderGeometry(0.025, 0.025, 0.2, 10).applyMatrix4(rocket));
      mb.add(red, new THREE.ConeGeometry(0.025, 0.06, 10).translate(0, -0.13, 0).applyMatrix4(rocket));
      mb.add(red, new THREE.BoxGeometry(0.004, 0.05, 0.07).translate(0, 0.09, 0).applyMatrix4(rocket));
      g.scale.setScalar(1.5);
      return { glint: V(0, 0.08, 0) };
    }
  }
}

void (null as any);
