import * as THREE from 'three/webgpu';
import { box, cyl, beam, place, norm, wire, MeshBatch } from './kit';
import { rustyMetal, concrete, plainStandard, fabric, wood, glow } from './materials';
import { floorDecal, mat4, F_DISPLAY, F_UI, F_MONO, weather } from '../sites/jetKit';
import { printPaint, print, printMap } from './printAtlas';

/**
 * The Spire's compound, dressed (environment round 3). It had been a lattice tower, a shack and a
 * generator on a bare mound. Now:
 * - a cell-site compound: chain-link fence with barbed wire, its gate left open, the north-east run
 *   flattened where the top of the tower came down, a flap on the west side cut and peeled back;
 * - Hivemind Wireless's site sign and an RF hazard plate (somebody wrote TOLD YOU on it);
 * - equipment cabinets on a plinth with blinking status LEDs and a cable bridge to the tower;
 * - the site office (Kade's subcontractor): a door, a step, a door sign and a porch lamp;
 * - outside the fence, the truthers' camp the tower fell on: a dome tent flattened under the fallen
 *   section, a standing one, a foil-lined "faraday" lean-to, camp chairs, a cooler, a fire ring, a
 *   bedsheet banner and plywood placards.
 *
 * Everything solid goes into the Spire's MeshBatch with family materials (merged, no new programs);
 * printed faces use the print atlas (printAtlas.ts: one extra draw); the fence is one chain-link mesh.
 * Local frame: the tower at the origin, the fallen section heading +x/+z, the shack at (−6, 4).
 */

// ------------------------------------------------------------------ atlas art
printPaint('spSite', 384, 224, (c, w, h, r) => {
  c.fillStyle = '#eceae2'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#5b2a86'; c.fillRect(0, 0, w, 64);
  // the hexagon logo
  c.strokeStyle = '#f3d75a'; c.lineWidth = 5;
  c.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; c.lineTo(36 + Math.cos(a) * 20, 32 + Math.sin(a) * 20); }
  c.closePath(); c.stroke();
  c.fillStyle = '#f3d75a'; c.beginPath(); c.arc(36, 32, 6, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffffff'; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.font = `900 40px ${F_DISPLAY}`; c.fillText('HIVEMIND WIRELESS', 68, 34, w - 80);
  c.fillStyle = '#1b1b1f'; c.textAlign = 'center';
  c.font = `700 26px ${F_UI}`; c.fillText('SITE SP-01  ·  "THE SPIRE"', w / 2, 92);
  c.fillStyle = '#5b2a86'; c.font = `900 34px ${F_DISPLAY}`; c.fillText('5G ULTRA∞', w / 2, 134);
  c.fillStyle = '#1b1b1f'; c.font = `600 18px ${F_UI}`; c.fillText('COVERAGE IS A HUMAN RIGHT*', w / 2, 168);
  c.font = `500 13px ${F_MONO}`; c.fillText('*WITH ELIGIBLE PLAN. HUMANS SOLD SEPARATELY.', w / 2, 196);
  weather(c, w, h, 1.1, 61);
  // two bullet holes and a sprayed eye
  for (const [x, y] of [[300, 120], [80, 150]]) { c.fillStyle = '#141210'; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); }
  c.strokeStyle = 'rgba(170,20,20,0.85)'; c.lineWidth = 6;
  c.beginPath(); c.ellipse(320, 180, 34, 16, 0, 0, Math.PI * 2); c.stroke();
  c.fillStyle = 'rgba(170,20,20,0.85)'; c.beginPath(); c.arc(320, 180, 8, 0, Math.PI * 2); c.fill();
  void r;
});
printPaint('spRF', 160, 200, (c, w, h) => {
  c.fillStyle = '#e8c33a'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#141414'; c.fillRect(0, 0, w, 44);
  c.fillStyle = '#e8c33a'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `900 30px ${F_DISPLAY}`; c.fillText('WARNING', w / 2, 23);
  // the RF trefoil: a triangle with radiating arcs
  c.fillStyle = '#141414';
  c.beginPath(); c.moveTo(w / 2, 58); c.lineTo(w / 2 + 34, 118); c.lineTo(w / 2 - 34, 118); c.closePath(); c.fill();
  c.fillStyle = '#e8c33a'; c.beginPath(); c.arc(w / 2, 100, 7, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#141414'; c.font = `700 15px ${F_UI}`;
  c.fillText('RADIO FREQUENCY', w / 2, 140); c.fillText('FIELDS BEYOND', w / 2, 158); c.fillText('THIS POINT', w / 2, 176);
  weather(c, w, h, 1.2, 62);
  c.save(); c.translate(w / 2, 110); c.rotate(-0.25);
  c.fillStyle = 'rgba(25,25,160,0.9)'; c.font = `900 40px ${F_DISPLAY}`; c.fillText('TOLD YOU', 0, 0);
  c.restore();
});
printPaint('spMind', 288, 160, (c, w, h, r) => {
  c.fillStyle = '#b4905e'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { c.strokeStyle = `rgba(95,62,30,${0.08 + r() * 0.12})`; c.lineWidth = 1 + r() * 3; const y = r() * h; c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(w * 0.3, y + 6, w * 0.7, y - 6, w, y + 3); c.stroke(); }
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#a3170f'; c.font = `900 82px ${F_DISPLAY}`;
  c.save(); c.translate(w / 2, 58); c.rotate(-0.05); c.fillText('5G =', 0, 0); c.restore();
  c.fillStyle = '#141210'; c.font = `900 50px ${F_DISPLAY}`; c.fillText('MIND CONTROL', w / 2 + 4, 124, w - 20);
  weather(c, w, h, 1.0, 63);
});
printPaint('spRight', 288, 160, (c, w, h, r) => {
  c.fillStyle = '#c2a06c'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { c.strokeStyle = `rgba(95,62,30,${0.08 + r() * 0.12})`; c.lineWidth = 1 + r() * 3; const y = r() * h; c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(w * 0.3, y + 6, w * 0.7, y - 6, w, y + 3); c.stroke(); }
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#141210'; c.font = `900 70px ${F_DISPLAY}`; c.fillText('WE WERE', w / 2, 50);
  c.fillStyle = '#a3170f'; c.fillText('RIGHT', w / 2 - 30, 112);
  // added later, in a different can
  c.save(); c.translate(w - 62, 120); c.rotate(-0.2);
  c.fillStyle = '#2257b8'; c.font = `700 30px ${F_UI}`; c.fillText('(MOSTLY)', 0, 0);
  c.restore();
  weather(c, w, h, 1.0, 64);
});
printPaint('spSheet', 512, 160, (c, w, h) => {
  c.fillStyle = '#e6e0d2'; c.fillRect(0, 0, w, h);
  // stains and a faded floral print: it was somebody's bedsheet
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(${150 + (i % 3) * 30},${110 + (i % 5) * 10},140,0.12)`; c.beginPath(); c.arc((i * 97) % w, (i * 53) % h, 8 + (i % 4) * 3, 0, Math.PI * 2); c.fill(); }
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#151210'; c.font = `900 64px ${F_DISPLAY}`; c.fillText('THE TOWER IS LISTENING', w / 2, 62, w - 30);
  c.fillStyle = '#a3170f'; c.font = `700 30px ${F_UI}`; c.fillText("HONK IF YOU CAN'T HEAR IT", w / 2, 122);
  weather(c, w, h, 0.9, 65);
});
printPaint('spOffice', 192, 128, (c, w, h) => {
  c.fillStyle = '#efeadc'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#9e1f17'; c.fillRect(0, 0, w, 30);
  c.fillStyle = '#efeadc'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `900 24px ${F_DISPLAY}`; c.fillText('SITE OFFICE', w / 2, 16);
  c.fillStyle = '#1a1a1a'; c.font = `600 13px ${F_UI}`;
  c.fillText('KADE HOLDINGS SUBCONTRACTOR', w / 2, 46);
  c.font = `800 18px ${F_UI}`; c.fillText('HARD HATS REQUIRED', w / 2, 74);
  c.font = `500 12px ${F_UI}`; c.fillText('HARD HATS NOT PROVIDED', w / 2, 96);
  c.fillText('ASK ABOUT OUR WAIVER', w / 2, 112);
  weather(c, w, h, 1.2, 66);
});

// ------------------------------------------------------------------ geometry helpers
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A chain-link panel from a to b (bottom edge), `h` tall, uv in metres (the material's lattice). */
function linkPanel(a: THREE.Vector3, b: THREE.Vector3, h: number, lean = new THREE.Vector3(0, 1, 0)) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const at = a.clone().addScaledVector(lean, h), bt = b.clone().addScaledVector(lean, h);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, bt.x, bt.y, bt.z, a.x, a.y, a.z, bt.x, bt.y, bt.z, at.x, at.y, at.z], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len, 0, len, h, 0, 0, len, h, 0, h], 2));
  g.computeVertexNormals();
  return norm(g);
}

/** Geometry placed at `p`, turned by yaw (ry) after its own pitch/roll (mat4's YXZ order). */
const P = (g: THREE.BufferGeometry, p: THREE.Vector3, rx = 0, ry = 0, rz = 0) => norm(g.applyMatrix4(mat4(p.x, p.y, p.z, rx, ry, rz)));

type Collide = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, yaw?: number) => void;

export interface SpireDressing {
  /** printed faces (printMaterial) */
  faces: THREE.BufferGeometry[];
  /** lit ground decals (decalMat) */
  decals: THREE.BufferGeometry[];
  /** additive light pools (glowDecalMat): brighter at night */
  pools: THREE.BufferGeometry[];
  /** the chain-link fence (one mesh) */
  fence: THREE.BufferGeometry[];
  /** status LEDs: blink these */
  leds: { value: number }[];
  /** the truthers' solar fairy lights (night) */
  fairy: { value: number }[];
  /** the porch lamp's bulb level (night) */
  porch: { value: number };
  /** where the porch lamp hangs (local) */
  porchAt: THREE.Vector3;
}

export function dressSpire(b: MeshBatch, collide: Collide): SpireDressing {
  const faces: THREE.BufferGeometry[] = [];
  const decals: THREE.BufferGeometry[] = [];
  const pools: THREE.BufferGeometry[] = [];
  const fence: THREE.BufferGeometry[] = [];
  const galv = rustyMetal({ base: '#9c9e9a', rust: 0.45, metalness: 0.75, roughness: 0.45 });
  const grey = rustyMetal({ base: '#b9bab4', rust: 0.25, metalness: 0.4, roughness: 0.55 });
  const purple = rustyMetal({ base: '#5b2a86', rust: 0.3, metalness: 0.3, roughness: 0.55 });
  const dark = plainStandard('#1a1c1e', 0.5, 0.3);
  const rubber = plainStandard('#151311', 0.9);
  const foil = rustyMetal({ base: '#d9dad6', rust: 0.05, metalness: 0.95, roughness: 0.22 });
  const slab = concrete('#8f877c');
  const ply = wood('#a2804f');
  const lath = wood('#8a6a44');
  const ash = plainStandard('#2a2724', 0.95);
  const stone = plainStandard('#6d5f50', 0.9);
  const cooler = plainStandard('#d8d6cc', 0.5);
  const coolerLid = plainStandard('#2f5f8a', 0.5);
  const tentBlue = fabric('#3f6a8a', 0.9);
  const tentOrange = fabric('#c8642a', 0.9);
  const chairBlue = fabric('#2a4a6e', 0.9);
  const chairGreen = fabric('#4a5a32', 0.9);
  const ledOn = glow('#5dff9a', 4);
  const ledAmber = glow('#ffb03a', 4);
  const fairy = [glow('#ffd27a', 0), glow('#ff6a8a', 0), glow('#7ad8ff', 0)];
  const bulb = glow('#ffd9a0', 0);

  // ---------------------------------------------------------------- the fence
  const X0 = -9.5, X1 = 6.5, Z0 = -6.5, Z1 = 8.5, H = 2.1;
  const post = (x: number, z: number, tilt = 0, tiltYaw = 0) => {
    b.add(galv, place(new THREE.CylinderGeometry(0.035, 0.04, H + 0.35, 6), x, (H + 0.35) / 2 - 0.1, z, tilt * Math.cos(tiltYaw), 0, tilt * Math.sin(tiltYaw)));
  };
  // a straight run of fence on the ground from a to b, posts every ~3 m, top rail, barbed wire
  const run = (ax: number, az: number, bx: number, bz: number, solid = true) => {
    const a = V(ax, 0, az), bb = V(bx, 0, bz);
    const len = a.distanceTo(bb);
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) post(ax + (bx - ax) * (i / n), az + (bz - az) * (i / n));
    fence.push(linkPanel(a.clone().setY(0.05), bb.clone().setY(0.05), H - 0.1));
    b.add(galv, beam(V(ax, H, az), V(bx, H, bz), 0.025, 5));
    // barbed wire on outward arms: three strands
    const out = V(bz - az, 0, -(bx - ax)).normalize().multiplyScalar(-1);
    for (let k = 1; k <= 3; k++) {
      const o = out.clone().multiplyScalar(0.12 * k);
      b.add(dark, wire(V(ax + o.x, H + 0.1 * k, az + o.z), V(bx + o.x, H + 0.1 * k, bz + o.z), 0.04 + 0.02 * k, 0.006, 8));
    }
    if (solid) {
      const yaw = Math.atan2(bx - ax, bz - az);
      collide((ax + bx) / 2, H / 2, (az + bz) / 2, 0.06, H / 2, len / 2, yaw);
    }
  };
  // south: the gate, swung open outward, either side of it
  run(X0, Z0, -2.2, Z0);
  run(1.2, Z0, X1, Z0);
  post(-2.2, Z0); post(1.2, Z0);
  {
    // gate leaf: a tube frame with link, hinged at x −2.2, swung out 110°
    const hinge = V(-2.2, 0, Z0), sw = -Math.PI * 0.62, L = 3.3;
    const tip = V(hinge.x + Math.cos(sw) * L, 0, hinge.z + Math.sin(sw) * L);
    fence.push(linkPanel(hinge.clone().setY(0.12), tip.clone().setY(0.12), H - 0.3));
    for (const y of [0.12, H - 0.18]) b.add(galv, beam(V(hinge.x, y, hinge.z), V(tip.x, y, tip.z), 0.03, 5));
    b.add(galv, beam(V(tip.x, 0.12, tip.z), V(tip.x, H - 0.18, tip.z), 0.03, 5));
    collide((hinge.x + tip.x) / 2, H / 2, (hinge.z + tip.z) / 2, 0.06, H / 2, L / 2, Math.atan2(tip.x - hinge.x, tip.z - hinge.z));
    // the chain and padlock, cut, hanging from the latch post
    b.add(dark, place(new THREE.TorusGeometry(0.05, 0.012, 4, 8), 1.2, 1.05, Z0 - 0.05, Math.PI / 2, 0, 0.4));
    b.add(galv, box(0.07, 0.09, 0.03, 1.2, 0.95, Z0 - 0.06));
    // sign beside the gate, and the RF plate on the fence
    b.add(galv, box(1.62, 0.96, 0.04, -4.4, 1.2, Z0 - 0.06));
    faces.push(print('spSite', 1.56, 0.91, mat4(-4.4, 1.2, Z0 - 0.085, 0, Math.PI)));
    b.add(grey, box(0.5, 0.62, 0.02, 3.6, 1.35, Z0 - 0.05));
    faces.push(print('spRF', 0.46, 0.58, mat4(3.6, 1.35, Z0 - 0.065, 0, Math.PI)));
  }
  // east: intact up to where the falling tower took the corner out
  run(X1, Z0, X1, 4.6);
  // north: intact west of the impact
  run(X0, Z1, 1.4, Z1);
  // the crushed north-east corner: the run folded down under the lattice, posts bent flat
  {
    const lean = V(0.25, 0.35, 0.9).normalize();
    fence.push(linkPanel(V(1.6, 0.05, Z1), V(X1 + 0.1, 0.15, Z1 + 0.3), H - 0.2, lean));
    const lean2 = V(0.9, 0.3, 0.2).normalize();
    fence.push(linkPanel(V(X1, 0.05, 4.8), V(X1 + 0.3, 0.1, Z1 - 0.3), H - 0.2, lean2));
    post(1.5, Z1, 0.25, 0.4);
    for (const [x, z, t, y] of [[3.4, Z1 + 0.6, 1.3, 1.6], [X1 + 0.6, 6.4, 1.35, 0.1], [X1 + 0.9, Z1 + 0.9, 1.45, 0.8]]) {
      b.add(galv, place(new THREE.CylinderGeometry(0.035, 0.04, H, 6), x, 0.25, z, 0, y, t));
    }
    b.add(galv, wire(V(1.4, H, Z1), V(X1 + 1.5, 0.5, Z1 + 1.8), 0.4, 0.025, 10));
    b.add(dark, wire(V(1.4, H + 0.2, Z1 + 0.1), V(X1 + 1.2, 0.3, 7.6), -0.3, 0.006, 10));
  }
  // west: the truthers cut a flap and peeled it back
  run(X0, Z0, X0, -1.2);
  run(X0, 2.6, X0, Z1);
  {
    const flapLean = V(-0.75, 0.55, 0.35).normalize();
    fence.push(linkPanel(V(X0, 0.05, -1.2), V(X0, 0.05, 1.2), H - 0.3, flapLean));
    b.add(galv, beam(V(X0, H, -1.2), V(X0, H, 2.6), 0.025, 5)); // the top rail survived
    post(X0, 0.7);
    // a pair of bolt cutters left in the sand
    b.add(purple, place(new THREE.BoxGeometry(0.5, 0.025, 0.04), X0 - 1.1, 0.03, 0.9, 0, 0.4, 0));
    b.add(purple, place(new THREE.BoxGeometry(0.5, 0.025, 0.04), X0 - 1.12, 0.03, 0.98, 0, 0.62, 0));
    b.add(galv, place(new THREE.BoxGeometry(0.22, 0.03, 0.06), X0 - 0.82, 0.03, 0.72, 0, 0.5, 0));
  }

  // ---------------------------------------------------------------- equipment cabinets + cable bridge
  {
    const cx = 3.4, cz = -3.2;
    b.add(slab, box(3.2, 0.25, 1.4, cx, 0.12, cz));
    for (const dx of [-0.8, 0.8]) {
      b.add(grey, box(1.3, 1.75, 0.85, cx + dx, 1.12, cz));
      b.add(dark, box(0.02, 1.5, 0.02, cx + dx, 1.1, cz + 0.43)); // door seam
      b.add(galv, box(0.04, 0.18, 0.04, cx + dx + 0.5, 1.15, cz + 0.45)); // handle
      b.add(dark, box(1.1, 0.2, 0.02, cx + dx, 1.82, cz + 0.43)); // louvre
    }
    b.add(purple, box(2.66, 0.08, 0.87, cx, 2.03, cz)); // Hivemind's lid stripe
    collide(cx, 1.0, cz, 1.35, 1.0, 0.45);
    // LEDs on the doors (status: two green, one amber; blinking)
    b.add(ledOn.material, box(0.04, 0.04, 0.02, cx - 0.55, 1.62, cz + 0.44), box(0.04, 0.04, 0.02, cx + 1.05, 1.62, cz + 0.44));
    b.add(ledAmber.material, box(0.04, 0.04, 0.02, cx + 0.95, 1.62, cz + 0.44));
    // the cable bridge: posts and a tray to the tower leg, cables drooping off the end
    for (const [x, z] of [[cx - 1.6, cz + 0.2], [0.9, -1.6]]) b.add(galv, cyl(0.04, 0.04, 2.6, x, 1.3, z, 6));
    b.add(galv, beam(V(cx - 1.6, 2.6, cz + 0.2), V(0.9, 2.6, -1.6), 0.05, 4));
    b.add(galv, beam(V(0.9, 2.6, -1.6), V(0.6, 2.7, -0.9), 0.05, 4));
    b.add(dark, wire(V(0.6, 2.62, -0.9), V(0.95, 0.05, 0.6), -0.2, 0.025, 10));
    b.add(dark, wire(V(0.6, 2.58, -0.95), V(1.6, 0.05, 0.1), -0.25, 0.02, 10));
    // oil stain under the generator, dirt round the pad
    decals.push(floorDecal('oil', 2.4, 2.0, -2.9, 0.03, 3.0, 0.4));
    decals.push(floorDecal('dirt', 4.4, 2.6, cx, 0.03, cz + 0.4, 0.1));
  }

  // ---------------------------------------------------------------- the site office: door, step, sign, lamp
  {
    const ex = -4.0; // the shack's +x wall
    const dz = 4.85;
    b.add(galv, box(0.06, 2.0, 0.9, ex + 0.03, 1.0, dz));
    b.add(dark, box(0.04, 0.05, 0.14, ex + 0.08, 1.0, dz - 0.32));
    b.add(slab, box(0.7, 0.18, 1.2, ex + 0.35, 0.09, dz));
    b.add(grey, box(0.03, 0.42, 0.62, ex + 0.07, 1.55, dz + 0.0));
    faces.push(print('spOffice', 0.58, 0.39, mat4(ex + 0.09, 1.55, dz, 0, Math.PI / 2)));
    // porch lamp: a caged bulb on a bracket over the door
    b.add(galv, box(0.3, 0.04, 0.04, ex + 0.15, 2.25, dz - 0.62));
    b.add(galv, place(new THREE.CylinderGeometry(0.08, 0.06, 0.12, 8, 1, true), ex + 0.3, 2.19, dz - 0.62));
    b.add(bulb.material, place(new THREE.SphereGeometry(0.055, 8, 6), ex + 0.3, 2.14, dz - 0.62));
    pools.push(floorDecal('poolWarm', 5.5, 5.5, ex + 1.4, 0.04, dz - 0.4));
    // a hard hat on the step (nobody's)
    b.add(plainStandard('#e8e4da', 0.45), place(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), ex + 0.75, 0.18, dz + 0.35, 0, 0, 0.3));
    // a roof whip and a rooftop A/C box
    b.add(galv, cyl(0.012, 0.02, 1.6, -7.3, 3.5, 3.0, 4));
    b.add(grey, box(0.8, 0.45, 0.6, -5.2, 3.0, 3.4));
  }

  // ---------------------------------------------------------------- the truthers' camp, outside the north-east corner
  {
    // the dome tent the tower came down on: squashed flat, poles snapped out of it
    b.add(tentOrange, place(new THREE.SphereGeometry(1.4, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), 7.4, 0.02, 12.6, 0, 0.5, 0, 1.25, 0.18, 1.0));
    b.add(galv, beam(V(6.2, 0.2, 13.4), V(5.4, 0.9, 14.6), 0.012, 4), beam(V(8.6, 0.2, 12.0), V(9.6, 0.6, 11.4), 0.012, 4));
    // their sleeping bag, half out of it
    b.add(chairGreen, norm(new THREE.CapsuleGeometry(0.22, 1.2, 3, 8).applyMatrix4(mat4(8.6, 0.12, 13.0, Math.PI / 2, 0.9, 0, 1, 1, 0.45))));
    // the one still standing
    b.add(tentBlue, place(new THREE.SphereGeometry(1.25, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), 12.2, 0, 4.6, 0, 0, 0, 1.15, 0.92, 1.0));
    b.add(dark, place(new THREE.CircleGeometry(0.5, 10, 0, Math.PI), 11.0, 0.42, 4.2, 0, -Math.PI / 2 - 0.3, 0)); // the door
    collide(12.2, 0.6, 4.6, 1.3, 0.6, 1.1);
    // the faraday lean-to: a lath frame with foil panels, propped against two stakes
    {
      const lx = 10.6, lz = -1.4, yaw = -0.5;
      const at = (x: number, y: number, z: number) => V(lx + x * Math.cos(yaw) + z * Math.sin(yaw), y, lz - x * Math.sin(yaw) + z * Math.cos(yaw));
      for (let i = 0; i < 3; i++) {
        const g = new THREE.BoxGeometry(0.95, 0.02, 2.0);
        b.add(foil, P(g, at(-1 + i * 1.0, 0.82, 0.25), 0.6, yaw, (i - 1) * 0.05));
      }
      for (const x of [-1.55, 1.55]) b.add(lath, beam(at(x, 0, -0.5), at(x, 1.65, -0.35), 0.03, 4));
      b.add(lath, beam(at(-1.6, 1.62, -0.35), at(1.6, 1.62, -0.35), 0.03, 4));
      // inside: a foil-wrapped camp chair and a transistor radio with the batteries taken out
      b.add(foil, P(new THREE.BoxGeometry(0.5, 0.06, 0.5), at(0.2, 0.42, 0.25), 0, yaw));
      b.add(foil, P(new THREE.BoxGeometry(0.5, 0.55, 0.05), at(0.2, 0.7, 0.02), -0.2, yaw));
      b.add(dark, P(new THREE.BoxGeometry(0.3, 0.18, 0.1), at(-0.6, 0.09, 0.4), 0, yaw + 0.4));
      collide(lx, 0.8, lz, 1.6, 0.8, 0.7, yaw);
    }
    // camp chairs round a fire ring
    const fx = 10.0, fz = 8.6;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      b.add(stone, place(new THREE.DodecahedronGeometry(0.16, 0), fx + Math.cos(a) * 0.62, 0.08, fz + Math.sin(a) * 0.62, i, i * 2, 0, 1, 0.7, 1));
    }
    b.add(ash, place(new THREE.CylinderGeometry(0.5, 0.55, 0.05, 10), fx, 0.02, fz));
    decals.push(floorDecal('scorch', 2.2, 2.2, fx, 0.03, fz, 0.7));
    const chair = (x: number, z: number, yaw: number, mat: THREE.Material, tipped = 0) => {
      const g: THREE.BufferGeometry[] = [];
      const seat = new THREE.BoxGeometry(0.52, 0.03, 0.48).translate(0, 0.42, 0);
      const back = new THREE.BoxGeometry(0.52, 0.55, 0.03).rotateX(-0.2).translate(0, 0.72, -0.24);
      const m = new THREE.Matrix4().makeRotationY(yaw).premultiply(new THREE.Matrix4().makeRotationZ(tipped)).setPosition(x, tipped ? 0.25 : 0, z);
      for (const s of [seat, back]) { s.applyMatrix4(m); g.push(norm(s)); }
      b.add(mat, ...g);
      for (const [px, pz] of [[-0.24, -0.22], [0.24, -0.22], [-0.24, 0.22], [0.24, 0.22]]) {
        const leg = new THREE.CylinderGeometry(0.012, 0.012, 0.44, 4).translate(px, 0.21, pz).applyMatrix4(m);
        b.add(galv, norm(leg));
      }
    };
    chair(fx - 1.3, fz + 0.6, 2.1, chairBlue);
    chair(fx + 1.2, fz + 0.9, -2.3, chairGreen);
    chair(fx + 0.4, fz - 1.4, 0.2, chairBlue, 1.35); // knocked over
    // a cooler, a megaphone, a slab of flyers weighted with a rock
    b.add(cooler, box(0.62, 0.38, 0.4, fx - 1.6, 0.19, fz - 0.9, 0.4));
    b.add(coolerLid, box(0.64, 0.06, 0.42, fx - 1.6, 0.41, fz - 0.9, 0.4));
    b.add(cooler, place(new THREE.CylinderGeometry(0.16, 0.06, 0.34, 10, 1, true), fx + 1.7, 0.16, fz - 0.2, 0, 0.3, Math.PI / 2));
    b.add(rubber, place(new THREE.BoxGeometry(0.06, 0.16, 0.05), fx + 1.62, 0.1, fz - 0.4, 0, 0.3, 0));
    b.add(plainStandard('#e2d8b8', 0.8), box(0.28, 0.08, 0.36, fx + 0.9, 0.04, fz + 1.7, 0.3));
    b.add(stone, place(new THREE.DodecahedronGeometry(0.09, 0), fx + 0.9, 0.12, fz + 1.7));
    // placards on stakes, facing the way up the mound (east and south)
    const placard = (name: string, x: number, z: number, yaw: number, lean: number) => {
      const m = mat4(x, 0, z, 0, yaw, lean);
      b.add(lath, norm(new THREE.BoxGeometry(0.06, 1.6, 0.04).translate(0, 0.8, -0.03).applyMatrix4(m)));
      b.add(ply, norm(new THREE.BoxGeometry(1.2, 0.68, 0.025).translate(0, 1.32, 0).applyMatrix4(m)));
      faces.push(print(name, 1.16, 0.64, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.32, 0.016))));
    };
    placard('spMind', 12.6, 9.6, 1.0, 0.08);
    // the other one stands by the cut in the west fence, where the road comes up
    placard('spRight', -12.4, 1.6, -Math.PI / 2 + 0.25, -0.12);
    // solar fairy lights from the standing tent to a pole by the fire and on to the lean-to: the one
    // thing here still doing what it says on the box (they come on at dusk)
    {
      const pole = V(8.4, 1.9, 10.9), tentTop = V(12.2, 1.1, 4.6), lean = V(10.1, 1.6, -0.6);
      b.add(lath, cyl(0.03, 0.04, 1.95, pole.x, 0.97, pole.z, 5));
      b.add(purple, box(0.32, 0.02, 0.22, pole.x + 0.25, 0.25, pole.z - 0.5, 0.3, -0.5)); // the panel
      let k = 0;
      for (const [a, c] of [[tentTop, pole], [tentTop, lean]] as const) {
        b.add(dark, wire(a, c, 0.35, 0.006, 12));
        for (let i = 1; i < 12; i++) {
          const t = i / 12;
          const p = a.clone().lerp(c, t);
          p.y -= 0.35 * 4 * t * (1 - t) + 0.05;
          b.add(fairy[k++ % 3].material, place(new THREE.SphereGeometry(0.035, 6, 4), p.x, p.y, p.z));
        }
      }
    }
    // the bedsheet banner between two poles, sagging, facing east along the approach
    {
      const a = V(14.2, 0, -3.6), c = V(14.6, 0, 0.6);
      for (const p of [a, c]) b.add(lath, cyl(0.04, 0.05, 2.6, p.x, 1.3, p.z, 5));
      const g = new THREE.PlaneGeometry(4.1, 1.3, 10, 2);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const t = (x + 2.05) / 4.1;
        pos.setY(i, y - 0.22 * Math.sin(Math.PI * t) * (y > 0 ? 1 : 0.6));
        pos.setZ(i, 0.08 * Math.sin(t * 9 + y * 2));
      }
      const yaw = Math.atan2(c.x - a.x, c.z - a.z) + Math.PI / 2; // printed side faces east, up the approach
      const m = mat4((a.x + c.x) / 2, 1.82, (a.z + c.z) / 2, 0, yaw);
      faces.push(norm(printMap('spSheet', g).applyMatrix4(m)));
    }
  }

  return { faces, decals, pools, fence, leds: [ledOn.intensity, ledAmber.intensity], fairy: fairy.map((g) => g.intensity), porch: bulb.intensity, porchAt: V(-3.7, 2.1, 4.23) };
}
