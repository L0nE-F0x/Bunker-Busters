import * as THREE from 'three/webgpu';
import { MeshBatch, Frame, DistanceLod, canvasTexture, shadowProxy } from '../world/kit';
import { fabric, wood, rustyMetal, plainStandard, glow, corrugated } from '../world/materials';
import { VirtualLight } from '../world/lights';
import { Fire } from '../world/effects';
import type { Physics } from '@/engine/physics';
import type { Heightfield } from '../world/Heightfield';
import type { OutpostDef } from '@/content/recovery';

/**
 * A Kade Recovery outpost on the ground: tents, sandbag walls and crate stacks (all solid: they are
 * the cover the crew fights from), stacked water jugs, the banner, a floodlight tower and a burn
 * barrel for the night, the footlocker, and a centrepiece per site. Static parts are merged per
 * material, with a flat far stand-in under a DistanceLod.
 */

export interface CoverPoint {
  /** Where to crouch (world, on the ground). */
  pos: THREE.Vector3;
  /** Outward normal (the side the threat should be on). */
  out: THREE.Vector3;
  /** Height of the cover (crouch hides you under 1.0). */
  h: number;
  taken: boolean;
}

export interface OutpostBuild {
  def: OutpostDef;
  frame: Frame;
  group: THREE.Group;
  lod: DistanceLod;
  cover: CoverPoint[];
  locker: THREE.Vector3;
  /** The field terminal's keyboard (hack it: `combat/terminals.ts`). */
  terminal: THREE.Vector3;
  /** The floodlight and the barrel fire (night). */
  light: VirtualLight;
  fire: Fire;
  center: THREE.Vector3;
}

let _bannerTex: THREE.Texture | null = null;
function bannerTexture() {
  return (_bannerTex ??= canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e9e4d6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c8202a';
    ctx.fillRect(0, 0, w, 46);
    ctx.fillRect(0, h - 30, w, 30);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '900 92px "Big Shoulders Stencil Display", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KADE', w / 2, 140);
    ctx.font = '700 30px "Chakra Petch", sans-serif';
    ctx.fillText('ASSET RECOVERY', w / 2, 188);
    ctx.font = '600 16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('A PILOT PROGRAM OF KADE HOLDINGS', w / 2, 30);
    ctx.fillText('TRESPASSERS WILL BE RECOVERED', w / 2, h - 10);
  }));
}
let _bannerMat: THREE.MeshStandardNodeMaterial | null = null;
function bannerMaterial() {
  return (_bannerMat ??= new THREE.MeshStandardNodeMaterial({ map: bannerTexture(), roughness: 0.9, side: THREE.DoubleSide }));
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildOutpost(def: OutpostDef, physics: Physics, hf: Heightfield): OutpostBuild {
  const y0 = hf.heightAt(def.x, def.z);
  const f = new Frame(def.x, y0, def.z, def.rot);
  const mb = new MeshBatch();
  const cover: CoverPoint[] = [];
  const group = new THREE.Group();
  group.name = `outpost:${def.id}`;
  const canvas = fabric('#b9a77e');
  const canvasDark = fabric('#8e7a55');
  const stripe = fabric('#c8402a');
  const bag = fabric('#a58e64', 0.98);
  const bagDark = fabric('#8b7653', 0.98);
  const crate = wood('#7d5a36');
  const jug = plainStandard('#2f6fa8', 0.35, 0, { transparent: false });
  const jugCap = plainStandard('#d8d4c8', 0.5);
  const steel = rustyMetal({ base: '#6a6d70', rust: 0.35, metalness: 0.7 });
  const kadeRed = rustyMetal({ base: '#b02a22', rust: 0.25, metalness: 0.3, roughness: 0.5 });
  const pallet = wood('#6a5236');
  const tin = corrugated('#8c8c86', 0.5, 'x');
  const lamp = glow('#fff2d0', 7);

  // local → world helpers (geometry is built in world space; the batch has no transform)
  const place = (g: THREE.BufferGeometry, lx: number, ly: number, lz: number, yaw = 0, rx = 0, rz = 0) => {
    const gy = hf.heightAt(...xz(f.p(lx, 0, lz)));
    const m = new THREE.Matrix4().compose(V(0, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, def.rot + yaw, rz, 'YXZ')), V(1, 1, 1));
    g.applyMatrix4(m);
    const w = f.p(lx, 0, lz);
    g.translate(w.x, gy + ly, w.z);
    return g;
  };
  const solid = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, yaw = 0) => {
    const w = f.p(lx, 0, lz);
    physics.addBox({ x: w.x, y: hf.heightAt(w.x, w.z) + ly, z: w.z }, { x: hx, y: hy, z: hz }, def.rot + yaw);
  };

  // --- sandbag walls: arcs of bags, two or three courses; cover on the inside
  const wall = (cx: number, cz: number, len: number, yaw: number, courses = 3) => {
    const n = Math.round(len / 0.55);
    const dir = V(Math.sin(yaw), 0, Math.cos(yaw));
    const side = V(dir.z, 0, -dir.x);
    for (let c = 0; c < courses; c++) {
      for (let i = 0; i < n - (c % 2); i++) {
        const t = (i - (n - 1) / 2 + (c % 2) * 0.5) * 0.55;
        const lx = cx + side.x * t, lz = cz + side.z * t;
        const g = new THREE.CapsuleGeometry(0.15, 0.32, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.62, 1.05);
        mb.add((i + c) % 3 ? bag : bagDark, place(g, lx, 0.1 + c * 0.19, lz, yaw + Math.PI / 2 + (Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.1));
      }
    }
    solid(cx, courses * 0.1, cz, len / 2, courses * 0.1 + 0.05, 0.22, yaw + Math.PI / 2);
    // cover spots behind it (the threat beyond the wall, on the +dir side)
    for (let i = -1; i <= 1; i += 2) {
      const t = (len / 2 - 0.5) * i * 0.6;
      const p = f.p(cx + side.x * t - dir.x * 0.55, 0, cz + side.z * t - dir.z * 0.55);
      p.y = hf.heightAt(p.x, p.z);
      cover.push({ pos: p, out: dir.clone().applyAxisAngle(V(0, 1, 0), def.rot), h: courses * 0.2 + 0.1, taken: false });
    }
  };
  // --- crates: a stack, solid, cover on all sides
  const crates = (cx: number, cz: number, yaw: number, n = 3) => {
    for (let i = 0; i < n; i++) {
      const s = 0.7 + (i % 2) * 0.1;
      const x = cx + (i % 2) * 0.8 - 0.4, z = cz + (i > 1 ? 0.75 : 0);
      const y = i === 2 && n > 3 ? 0.75 : 0;
      mb.add(crate, place(new THREE.BoxGeometry(s, s, s), x, s / 2 + y, z, yaw + i * 0.2));
      mb.add(steel, place(new THREE.BoxGeometry(s + 0.02, 0.05, s + 0.02), x, s * 0.85 + y, z, yaw + i * 0.2));
    }
    solid(cx, 0.5, cz + 0.3, 0.9, 0.5, 0.75, yaw);
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const d = V(Math.sin(a + yaw), 0, Math.cos(a + yaw));
      const p = f.p(cx - d.x * 1.4, 0, cz + 0.3 - d.z * 1.4);
      p.y = hf.heightAt(p.x, p.z);
      cover.push({ pos: p, out: d.applyAxisAngle(V(0, 1, 0), def.rot), h: 0.8, taken: false });
    }
  };
  // --- an A-frame tent, Kade beige with a red stripe
  const tent = (cx: number, cz: number, yaw: number, L = 3.2, W = 2.4, H = 1.9) => {
    for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(L, Math.hypot(W / 2, H), 1, 1);
      g.rotateX(-Math.PI / 2).rotateZ(s * Math.atan2(H, W / 2)).translate(s * W / 4, H / 2, 0);
      const m = place(g.rotateY(Math.PI / 2), cx, 0, cz, yaw);
      mb.add(canvas, m);
      const st = new THREE.PlaneGeometry(L, 0.25).rotateX(-Math.PI / 2).rotateZ(s * Math.atan2(H, W / 2)).translate(s * W * 0.36, H * 0.3, 0).rotateY(Math.PI / 2);
      mb.add(stripe, place(st, cx, 0.01, cz, yaw));
    }
    // back wall + ridge pole + guy lines' stakes
    const back = new THREE.BufferGeometry().setFromPoints([V(-W / 2, 0, 0), V(W / 2, 0, 0), V(0, H, 0)]);
    back.setIndex([0, 1, 2]);
    back.computeVertexNormals();
    mb.add(canvasDark, place(back, cx, 0, cz - L / 2, yaw));
    mb.add(steel, place(new THREE.CylinderGeometry(0.025, 0.025, L + 0.3, 6).rotateX(Math.PI / 2), cx, H, cz, yaw));
    for (const z of [-L / 2 - 0.1, L / 2 + 0.1]) mb.add(steel, place(new THREE.CylinderGeometry(0.02, 0.02, H, 6), cx, H / 2, cz + z, yaw));
    solid(cx, H / 2, cz, W / 2 - 0.2, H / 2, L / 2, yaw);
  };
  // --- water: blue 20 L jugs on a pallet, the camp's water with somebody else's logo on it
  const water = (cx: number, cz: number, yaw: number, rows = 2) => {
    mb.add(pallet, place(new THREE.BoxGeometry(1.2, 0.14, 1.0), cx, 0.07, cz, yaw));
    for (let r = 0; r < rows; r++) for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      if (r > 0 && Math.random() < 0.3) continue;
      const lx = (i - 1.5) * 0.28, lz = (j - 1) * 0.3;
      const c = Math.cos(def.rot + yaw), s = Math.sin(def.rot + yaw);
      void c; void s;
      const g = new THREE.CylinderGeometry(0.13, 0.13, 0.38, 12);
      mb.add(jug, place(g, cx + lx, 0.33 + r * 0.4, cz + lz, yaw));
      mb.add(jugCap, place(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 8), cx + lx, 0.55 + r * 0.4, cz + lz, yaw));
    }
    solid(cx, 0.45, cz, 0.6, 0.45, 0.5, yaw);
  };

  // --- common layout (local): a walled yard with tents at the back, water, banner, tower
  wall(0, 11, 8, 0);
  wall(-9, 4, 6, -Math.PI / 2 + 0.3, 2);
  wall(9, 4, 6, Math.PI / 2 - 0.3, 2);
  tent(-5, -6, 0.1);
  tent(5, -6.5, -0.15, 3, 2.2, 1.8);
  crates(-4, 3.5, 0.3, def.tier > 1 ? 4 : 3);
  water(3.5, 1.5, -0.2, def.tier > 1 ? 2 : 1);
  if (def.tier > 1) crates(6.5, -1.5, -0.6, 3);
  // banner on two poles
  for (const x of [-1.6, 1.6]) mb.add(steel, place(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 8), x, 1.6, 12.6, 0));
  const banner = place(new THREE.PlaneGeometry(3.2, 1.6), 0, 2.2, 12.62, 0);
  const bannerMesh = new THREE.Mesh(banner, bannerMaterial());
  bannerMesh.castShadow = true;
  bannerMesh.receiveShadow = true;
  // floodlight tower (a VirtualLight at night) + burn barrel
  const tower = f.p(-7, 0, -1);
  mb.add(steel, place(new THREE.CylinderGeometry(0.06, 0.08, 4.6, 8), -7, 2.3, -1, 0));
  mb.add(steel, place(new THREE.BoxGeometry(0.6, 0.35, 0.25), -7, 4.6, -1, 0.6, 0.35, 0));
  mb.add(lamp.material, place(new THREE.PlaneGeometry(0.5, 0.26), -7, 4.6, -0.86, 0.6, 0.35, 0));
  const light = new VirtualLight('#ffe8c0', 0, 22, 1.6);
  light.position.copy(tower).setY(hf.heightAt(tower.x, tower.z) + 4.4);
  const barrel = f.p(1.5, 0, -2.5);
  mb.add(rustyMetal({ base: '#4a3a2a', rust: 0.8, metalness: 0.6 }), place(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12, 1, true), 1.5, 0.45, -2.5, 0));
  const fire = new Fire(0.45, 14);
  fire.group.position.copy(barrel).setY(hf.heightAt(barrel.x, barrel.z) + 0.75);
  group.add(fire.group);
  // generator
  mb.add(kadeRed, place(new THREE.BoxGeometry(1.1, 0.7, 0.7), -7.5, 0.35, 1.2, 0.3));
  mb.add(steel, place(new THREE.BoxGeometry(1.15, 0.12, 0.75), -7.5, 0.76, 1.2, 0.3));
  solid(-7.5, 0.4, 1.2, 0.55, 0.4, 0.35, 0.3);
  // footlocker (loot)
  const locker = f.p(-1.5, 0, -4.2);
  locker.y = hf.heightAt(locker.x, locker.z) + 0.25;
  mb.add(kadeRed, place(new THREE.BoxGeometry(0.9, 0.42, 0.5), -1.5, 0.21, -4.2, 0.1));
  mb.add(steel, place(new THREE.BoxGeometry(0.92, 0.05, 0.52), -1.5, 0.4, -4.2, 0.1));
  // field terminal: a folding table by the generator, a rugged laptop cabled to it, a whip antenna
  const TX = -5.7, TZ = 1.0, TY = Math.PI / 2 + 0.25;
  const tp = (g: THREE.BufferGeometry, ox: number, oy: number, oz: number) => {
    const c = Math.cos(TY), sn = Math.sin(TY);
    return place(g, TX + ox * c + oz * sn, oy, TZ - ox * sn + oz * c, TY);
  };
  const tableTop = plainStandard('#5b5e57', 0.6, 0.3);
  mb.add(tableTop, tp(new THREE.BoxGeometry(1.1, 0.04, 0.6), 0, 0.74, 0));
  for (const [x, z] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]]) mb.add(steel, tp(new THREE.CylinderGeometry(0.015, 0.015, 0.72, 5), x, 0.36, z));
  const rugged = plainStandard('#2a2c2a', 0.55, 0.2);
  mb.add(rugged, tp(new THREE.BoxGeometry(0.42, 0.035, 0.3), 0.05, 0.778, 0.02)); // base
  mb.add(kadeRed, tp(new THREE.BoxGeometry(0.44, 0.012, 0.04), 0.05, 0.79, 0.17)); // bumper
  const lid = new THREE.BoxGeometry(0.42, 0.28, 0.025).translate(0, 0.14, 0).rotateX(-0.28);
  mb.add(rugged, tp(lid, 0.05, 0.795, -0.13));
  // the screen: Kade OS mid-session, drawn in glow quads (one batched glow program, no texture)
  const scrBg = glow('#0b3a24', 1.1).material, scrFg = glow('#5dffb0', 1.7).material, scrRed = glow('#ff4028', 1.8).material;
  const scr = (m: THREE.Material, w: number, h: number, x: number, y: number, z = 0.0142) =>
    mb.add(m, tp(new THREE.PlaneGeometry(w, h).translate(x, 0.145 + y, z).rotateX(-0.28), 0.05, 0.795, -0.13));
  scr(scrBg, 0.36, 0.22, 0, 0, 0.0135);
  scr(scrRed, 0.34, 0.018, 0, 0.088); // title bar
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if ((r * 7 + c * 3) % 5) scr(scrFg, 0.022, 0.016, -0.14 + c * 0.034, 0.05 - r * 0.03);
  scr(scrRed, 0.026, 0.02, -0.14 + 2 * 0.034, 0.05 - 0.03); // ICE
  for (const [w, y] of [[0.13, 0.05], [0.09, 0.025], [0.15, 0], [0.07, -0.025]] as const) scr(scrFg, w, 0.009, 0.01 + w / 2, y);
  scr(scrFg, 0.3, 0.008, 0, -0.078); // trace bar
  scr(scrRed, 0.1, 0.008, -0.1, -0.078, 0.0146);
  mb.add(kadeRed, tp(new THREE.BoxGeometry(0.16, 0.1, 0.22), -0.38, 0.81, 0)); // battery brick
  mb.add(glow('#ff3020', 5).material, tp(new THREE.BoxGeometry(0.012, 0.012, 0.012), -0.38, 0.865, 0.08));
  mb.add(steel, tp(new THREE.CylinderGeometry(0.006, 0.01, 2.1, 4), -0.48, 1.8, -0.22)); // whip antenna
  // the cable to the generator, lying on the ground
  mb.add(rugged, tp(new THREE.CylinderGeometry(0.012, 0.012, 1.6, 5).rotateZ(Math.PI / 2), -1.2, 0.015, -0.1));
  solid(TX, 0.4, TZ, 0.55, 0.4, 0.3, TY);
  const terminal = f.p(TX, 0, TZ);
  terminal.y = hf.heightAt(terminal.x, terminal.z) + 0.95;

  // sign at the entrance
  mb.add(wood('#6b4a2e'), place(new THREE.BoxGeometry(0.08, 1.5, 0.08), -2.6, 0.75, 14, 0), place(new THREE.BoxGeometry(0.08, 1.5, 0.08), 2.6, 0.75, 14, 0));
  mb.add(tin, place(new THREE.BoxGeometry(5.4, 0.7, 0.04), 0, 1.25, 14, 0));

  // --- centrepieces
  if (def.id === 'survey') {
    // a theodolite on a tripod, survey stakes with flagging tape
    for (let i = 0; i < 3; i++) mb.add(steel, place(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 5), 0.5 + Math.cos(i * 2.1) * 0.25, 0.65, 6 + Math.sin(i * 2.1) * 0.25, 0, Math.cos(i * 2.1) * 0.2, Math.sin(i * 2.1) * 0.2));
    mb.add(kadeRed, place(new THREE.BoxGeometry(0.16, 0.2, 0.14), 0.5, 1.42, 6, 0.4));
    for (let i = 0; i < 6; i++) {
      mb.add(wood('#a07a4a'), place(new THREE.BoxGeometry(0.04, 0.6, 0.04), -12 + i * 4.5, 0.3, 16 + (i % 2) * 2, 0));
      mb.add(stripe, place(new THREE.BoxGeometry(0.05, 0.08, 0.05), -12 + i * 4.5, 0.55, 16 + (i % 2) * 2, 0));
    }
  } else if (def.id === 'rp7') {
    // the repossession pile: a vending machine, a sofa, an upright piano under a tarp
    mb.add(kadeRed, place(new THREE.BoxGeometry(0.9, 1.8, 0.8), -6, 0.9, 7, 0.4));
    mb.add(glow('#9fe0ff', 1.5).material, place(new THREE.PlaneGeometry(0.6, 1.1), -6.0, 1.05, 7.41, 0.4));
    mb.add(wood('#2a1a12'), place(new THREE.BoxGeometry(1.5, 1.25, 0.6), 6, 0.62, 7.5, -0.5));
    mb.add(canvasDark, place(new THREE.BoxGeometry(1.6, 0.05, 0.7), 6, 1.27, 7.5, -0.5));
    solid(-6, 0.9, 7, 0.45, 0.9, 0.4, 0.4);
    solid(6, 0.62, 7.5, 0.75, 0.62, 0.3, -0.5);
    water(-1.5, 6.5, 0.4, 2);
  } else if (def.id === 'pipeline') {
    // the line west: a big pipe on stands, a pumping skid, a gauge
    for (let i = -3; i <= 3; i++) {
      mb.add(steel, place(new THREE.BoxGeometry(0.3, 0.9, 0.3), i * 6, 0.45, -11, 0));
    }
    mb.add(rustyMetal({ base: '#5a6a72', rust: 0.45, metalness: 0.8 }), place(new THREE.CylinderGeometry(0.55, 0.55, 40, 18, 1, true).rotateZ(Math.PI / 2), 0, 1.45, -11, 0));
    mb.add(kadeRed, place(new THREE.BoxGeometry(2.6, 1.6, 1.8), 0, 0.8, -9, 0));
    mb.add(steel, place(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 10), -0.8, 1.9, -9, 0));
    solid(0, 0.8, -9, 1.3, 0.8, 0.9, 0);
    // the pipe's collider reaches down to 0.3 m: a 0.9 m gap under a 40 m box could hold (and wedge)
    // a crouched capsule; 0.3 m can't hold any capsule, and low shots still pass the stands' gaps
    solid(0, 1.15, -11, 20.2, 0.85, 0.55, 0);
  } else if (def.id === 'wellhead') {
    // the stolen creek: a wellhead, a tank with Kade's name on it, pipes running west
    mb.add(rustyMetal({ base: '#7d8890', rust: 0.25, metalness: 0.8 }), place(new THREE.CylinderGeometry(3.2, 3.2, 4.2, 28), 0, 2.1, -10, 0));
    mb.add(kadeRed, place(new THREE.CylinderGeometry(3.25, 3.25, 0.5, 28, 1, true), 0, 3.3, -10, 0));
    mb.add(steel, place(new THREE.CylinderGeometry(3.3, 3.3, 0.12, 28), 0, 4.25, -10, 0));
    mb.add(steel, place(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 12), 6, 0.8, -6, 0));
    mb.add(kadeRed, place(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 12), 6, 1.6, -6, 0));
    mb.add(rustyMetal({ base: '#5a6a72', rust: 0.45, metalness: 0.8 }), place(new THREE.CylinderGeometry(0.3, 0.3, 30, 14, 1, true).rotateZ(Math.PI / 2), -18, 0.5, -10, 0));
    solid(0, 2.1, -10, 2.6, 2.1, 2.6, 0);
    water(-6.5, -2, 0.2, 2);
    water(6.5, 1, -0.3, 2);
  }

  const far = mb.buildFar(`outpost:${def.id}:far`, { minSize: 0.6 });
  const near = mb.build(`outpost:${def.id}`);
  near.add(bannerMesh); // the banner goes with the near set (the far stand-in is a silhouette)
  group.add(near, far);
  shadowProxy(near, [], `outpost:${def.id}:shadow`);
  const center = f.p(0, 0, 0).setY(y0);
  const lod = new DistanceLod(center, def.r, near, far, 150, 700);
  return { def, frame: f, group, lod, cover, locker, terminal, light, fire, center };
}

const xz = (v: THREE.Vector3): [number, number] => [v.x, v.z];
