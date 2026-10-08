import * as THREE from 'three/webgpu';
import { NpcCrowd, type NpcDef, type NpcLook } from './npc';

/** Placeholder look for the camp people (their procedural figure is only posed, never drawn). */
const CAMP_LOOK: NpcLook = { skin: '#a87a5c', hair: '#2a1a12', hairStyle: 'short', shirt: '#6a5a46', pants: '#3c362e' };
import type { AmbientKind } from '@/engine/audio';
import type { Heightfield } from './Heightfield';
import type { Physics } from '@/engine/physics';
import { LANDMARKS } from '@/content/world';
import type { LandmarkDef } from '@/content/types';
import { box, cyl, beam, place, merge, MeshBatch, DistanceLod, Frame, canvasTexture, grime, wire, shadowProxy } from './kit';
import { rustyMetal, concrete, corrugated, neon, plainStandard, fabric, wood, glow, warmWindow } from './materials';
import { Fire, lightCone } from './effects';

export interface Flicker { set: (v: number) => void; phase: number; speed: number; broken: number }

export class Landmarks {
  group = new THREE.Group();
  fires: Fire[] = [];
  flickers: Flicker[] = [];
  blinkers: { u: { value: number }; period: number; offset: number }[] = [];
  campPosition = new THREE.Vector3();
  /** The gas station's frame (camp space: the fire at (−8, 0, 5), logs north and east of it). */
  campFrame: Frame | null = null;
  audioSpots: { kind: AmbientKind; pos: THREE.Vector3 }[] = [];
  private lods: DistanceLod[] = [];

  constructor(private hf: Heightfield, private physics: Physics) {
    for (const lm of LANDMARKS) {
      if (lm.kind === 'gas-station') this.gasStation(lm);
      else if (lm.kind === 'radio-tower') this.radioTower(lm);
      // town and cave are built by Settlement and parented under this group
    }
  }

  private frame(lm: LandmarkDef) {
    const [x, , z] = lm.position;
    return new Frame(x, this.hf.heightAt(x, z), z, lm.rotation);
  }

  private collider(f: Frame, lx: number, ly: number, lz: number, hx: number, hy: number, hz: number) {
    const p = f.p(lx, ly, lz);
    this.physics.addBox(p, { x: hx, y: hy, z: hz }, f.yaw);
  }

  private gasStation(lm: LandmarkDef) {
    const f = this.frame(lm);
    const root = new THREE.Group();
    root.applyMatrix4(f.m);
    const b = new MeshBatch();
    const conc = concrete('#a39a8c');
    const paintRed = rustyMetal({ base: '#b8452c', rust: 0.55, metalness: 0.3, roughness: 0.6 });
    const paintWhite = rustyMetal({ base: '#d8d2c4', rust: 0.45, metalness: 0.3, roughness: 0.65 });
    const metal = rustyMetal({ base: '#6d6a66', rust: 0.6 });
    const roofMetal = corrugated('#8b8a84', 0.7);
    const darkGlass = plainStandard('#0a0d10', 0.1, 0.5);

    // forecourt slab
    b.add(conc, box(30, 0.3, 22, 0, 0.05, 0));
    // canopy: 4 pillars + roof slab with red fascia
    for (const [px, pz] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) {
      b.add(paintWhite, box(0.6, 5.2, 0.6, px, 2.6, pz));
      this.collider(f, px, 2.6, pz, 0.3, 2.6, 0.3);
    }
    b.add(metal, box(16, 0.35, 12, 0, 5.4, 0));
    b.add(paintRed, box(16.4, 0.9, 0.2, 0, 5.4, 6.1), box(16.4, 0.9, 0.2, 0, 5.4, -6.1), box(0.2, 0.9, 12.4, 8.1, 5.4, 0), box(0.2, 0.9, 12.4, -8.1, 5.4, 0));
    // canopy light panels (some dead)
    const lightPanels: THREE.BufferGeometry[] = [];
    const deadPanels: THREE.BufferGeometry[] = [];
    let k = 0;
    for (const px of [-4.5, 0, 4.5]) for (const pz of [-2.5, 2.5]) {
      (k++ % 3 === 1 ? deadPanels : lightPanels).push(box(2.2, 0.06, 1.0, px, 5.2, pz));
    }
    const panelGlow = glow('#fff1d6', 3.5);
    b.add(panelGlow.material, ...lightPanels);
    b.add(plainStandard('#2a2a28', 0.4), ...deadPanels);
    this.flickers.push({ set: (v) => (panelGlow.intensity.value = 3.5 * v), phase: 0, speed: 1, broken: 0.25 });
    // pump islands
    for (const px of [-3, 3]) {
      b.add(conc, box(1.4, 0.3, 5, px, 0.3, 0));
      for (const pz of [-1.2, 1.2]) {
        b.add(paintRed, box(0.8, 1.7, 0.5, px, 1.3, pz));
        b.add(darkGlass, box(0.82, 0.4, 0.3, px, 1.75, pz));
        b.add(metal, box(0.12, 0.5, 0.12, px + 0.45, 1.1, pz));
      }
      this.collider(f, px, 1, 0, 0.7, 1, 2.5);
    }
    // store building (sun-bleached stucco over a darker plinth)
    const sx = 0, sz = -12;
    b.add(concrete('#cdbf9f', { stains: 0.85 }), box(14, 4.2, 7, sx, 2.1, sz));
    b.add(roofMetal, box(14.6, 0.25, 7.6, sx, 4.35, sz));
    b.add(warmWindow('#ffae5a', 2.2), box(5, 1.8, 0.1, sx - 3, 1.8, sz + 3.52));
    b.add(darkGlass, box(1.6, 2.4, 0.1, sx + 3, 1.2, sz + 3.52));
    b.add(wood('#3d2a1c'), box(5.6, 0.12, 0.3, sx - 3, 0.9, sz + 3.6), box(0.3, 1.9, 0.12, sx - 0.5, 1.8, sz + 3.6), box(0.3, 1.9, 0.12, sx - 5.5, 1.8, sz + 3.6));
    this.collider(f, sx, 2.1, sz, 7, 2.1, 3.5);

    // tall sign pylon with neon
    const signX = 12, signZ = 8;
    b.add(metal, box(0.5, 9, 0.5, signX, 4.5, signZ), box(0.5, 9, 0.5, signX + 3.4, 4.5, signZ));
    this.collider(f, signX + 1.7, 4.5, signZ, 2, 4.5, 0.4);
    // one canvas for every sign on the lot (one material, one draw): the pylon sign on top, the
    // store's boards below (see gasDressing)
    const signTex = canvasTexture(1024, 1280, (ctx) => {
      const w = 1024, h = 640;
      drawStoreSigns(ctx);
      ctx.fillStyle = '#1b130e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e8d6b0';
      ctx.lineWidth = 14;
      ctx.strokeRect(20, 20, w - 40, h - 40);
      ctx.fillStyle = '#e8d6b0';
      ctx.textAlign = 'center';
      ctx.font = '900 150px "Big Shoulders Stencil Display", Impact, sans-serif';
      ctx.fillText('LAST', w / 2, 190);
      ctx.fillText('CHANCE', w / 2, 340);
      ctx.fillStyle = '#ff9a2e';
      ctx.font = '700 110px "Chakra Petch", Arial, sans-serif';
      ctx.fillText('GAS  $∞.99', w / 2, 500);
      ctx.font = '500 40px "Chakra Petch", Arial, sans-serif';
      ctx.fillStyle = '#c9b48a';
      ctx.fillText('CLEAN RESTROOMS* — *THEORETICALLY', w / 2, 585);
      grime(ctx, w, h, 1.4, 9);
    });
    const signMat = new THREE.MeshStandardNodeMaterial({ map: signTex, roughness: 0.7, emissiveMap: signTex, emissive: new THREE.Color(0.35, 0.3, 0.25) });
    const pylon = new THREE.BoxGeometry(4.4, 2.75, 0.3);
    signUv(pylon, 0, 0, 1024, 640);
    const sign = new THREE.Mesh(merge([place(pylon, signX + 1.7, 8.2, signZ), ...this.gasDressing(f, b)]), signMat);
    sign.castShadow = true;
    root.add(sign);
    // neon tube outline (flickers)
    const neonFlicker = { value: 1 };
    const neonMat = neon('#ff3a6e', 7, neonFlicker);
    const tubes: THREE.BufferGeometry[] = [];
    const nx = signX + 1.7, ny = 8.2, nz = signZ + 0.2;
    tubes.push(cyl(0.04, 0.04, 4.6, nx, ny + 1.5, nz, 6, 0, 0, Math.PI / 2), cyl(0.04, 0.04, 4.6, nx, ny - 1.5, nz, 6, 0, 0, Math.PI / 2));
    tubes.push(cyl(0.04, 0.04, 3.0, nx - 2.3, ny, nz, 6), cyl(0.04, 0.04, 3.0, nx + 2.3, ny, nz, 6));
    // its own batch: the neon reads from across the map at night, so it stays out of the far swap
    const neonBatch = new MeshBatch().add(neonMat, ...tubes);
    this.flickers.push({ set: (v) => (neonFlicker.value = v), phase: 3, speed: 1.3, broken: 0.5 });
    this.audioSpots.push({ kind: 'neon', pos: f.p(nx, ny, nz) });

    // camp: tents, crates, string lights, campfire
    const tentMat = fabric('#6b5a40');
    const tent2 = fabric('#3f5a5a');
    const campX = -9, campZ = 4;
    const tentGeo = (tx: number, tz: number, ry: number) => {
      const g = new THREE.ConeGeometry(1.8, 2.2, 4, 1, true);
      g.rotateY(Math.PI / 4);
      g.scale(1, 1, 1.4);
      g.rotateY(ry);
      g.translate(tx, 1.1, tz);
      return g;
    };
    b.add(tentMat, tentGeo(campX - 4, campZ + 2, 0.3));
    b.add(tent2, tentGeo(campX - 1, campZ + 6, -0.5));
    this.collider(f, campX - 4, 1, campZ + 2, 1.3, 1, 1.6);
    this.collider(f, campX - 1, 1, campZ + 6, 1.3, 1, 1.6);
    const crateMat = wood('#7a5a36');
    b.add(crateMat, box(1, 0.8, 1, campX + 3, 0.55, campZ + 3, 0.2), box(0.8, 0.6, 0.8, campX + 3.2, 1.25, campZ + 3, 0.6), box(1, 0.8, 1, campX - 5, 0.55, campZ - 2, -0.3));
    // log benches
    const logMat = wood('#4a3424');
    b.add(logMat, cyl(0.22, 0.22, 2.4, campX, 0.4, campZ + 2.4, 8, 0, 0.2, Math.PI / 2), cyl(0.22, 0.22, 2.4, campX + 2.2, 0.4, campZ, 8, 0, 1.6, Math.PI / 2));
    // barrels
    const barrelMat = rustyMetal({ base: '#2f4a5c', rust: 0.65, metalness: 0.5 });
    for (const [bx, bz] of [[-13, -7], [-12.2, -7.6], [-13.4, -8.4], [13, -9]]) {
      b.add(barrelMat, cyl(0.42, 0.42, 1.2, bx, 0.75, bz, 14));
      this.collider(f, bx, 0.75, bz, 0.42, 0.6, 0.42);
    }
    // string lights from canopy to pole
    const bulbs = glow('#ffcc88', 5);
    const poleTop = new THREE.Vector3(campX - 6, 3.6, campZ + 7);
    b.add(wood('#3a2a1c'), cyl(0.08, 0.1, 3.8, poleTop.x, 1.9, poleTop.z, 6));
    const anchors = [new THREE.Vector3(-6, 4.8, 4), new THREE.Vector3(-6, 4.8, -4)];
    for (const a of anchors) {
      b.add(plainStandard('#111', 0.6), wire(a, poleTop, 0.7, 0.012, 20));
      for (let i = 1; i < 12; i++) {
        const t = i / 12;
        const p = a.clone().lerp(poleTop, t);
        p.y -= 0.7 * 4 * t * (1 - t) + 0.08;
        b.add(bulbs.material, place3(new THREE.SphereGeometry(0.06, 6, 4), p));
      }
    }
    this.flickers.push({ set: (v) => (bulbs.intensity.value = 5 * (0.85 + 0.15 * v)), phase: 1, speed: 0.3, broken: 0.05 });

    // the tents keep their fabric (its rim light catches the fire at night, even from the road)
    const far = b.buildFar('gas-far', { keep: [tentMat, tent2] });
    const near = b.build('gas');
    // the sign's and the neon's shadows join the near set's single shadow draw; both stay drawn from far
    const neonGrp = neonBatch.build('gas-neon');
    near.add(sign, neonGrp);
    shadowProxy(near);
    root.add(sign, neonGrp, near);
    this.addLod(root, f, 20, near, far);
    this.campNear = near;

    const fire = new Fire(1, 40);
    fire.group.position.set(campX + 1, 0.15, campZ + 1);
    root.add(fire.group);
    this.fires.push(fire);
    this.campPosition.copy(f.p(campX + 1, 0.2, campZ + 1));
    this.campFrame = f;
    this.audioSpots.push({ kind: 'fire', pos: this.campPosition.clone() });

    this.group.add(root);
  }

  /**
   * Last Chance's store had been a bare box from three sides. Dress it like the last stop it was:
   * fascia and plinth, a parapet MARKET board, an awning, a soda machine and an ice chest out front;
   * restrooms (out of order) and a water heater on the east side; a propane cage and a roof ladder
   * on the west; a back door, meter, A/C condenser, dumpster, bags, tyres, pallets and a plywood
   * sign out back; A/C units, vents and a dish on the roof. All family materials (no new draws) in
   * the station's batch, so the far stand-in and the shadow proxy get them too. Returns the sign
   * faces, which share the pylon sign's canvas and material.
   */
  private gasDressing(f: Frame, b: MeshBatch): THREE.BufferGeometry[] {
    const faces: THREE.BufferGeometry[] = [];
    const cream = rustyMetal({ base: '#d8d2c4', rust: 0.45, metalness: 0.3, roughness: 0.65 });
    const red = rustyMetal({ base: '#b8452c', rust: 0.55, metalness: 0.3, roughness: 0.6 });
    const metal = rustyMetal({ base: '#6d6a66', rust: 0.6 });
    const steel = rustyMetal({ base: '#a2a19a', rust: 0.35, metalness: 0.6, roughness: 0.5 });
    const teal = rustyMetal({ base: '#3f6e6a', rust: 0.55, metalness: 0.4, roughness: 0.55 });
    const green = rustyMetal({ base: '#3c5a3a', rust: 0.6, metalness: 0.4, roughness: 0.6 });
    const plinth = concrete('#857a6a', { stains: 0.7 });
    const slab = concrete('#a39a8c');
    const rubber = plainStandard('#151311', 0.92);
    const bag = plainStandard('#1c211d', 0.3);
    const white = rustyMetal({ base: '#e2ddd0', rust: 0.15, metalness: 0.3, roughness: 0.5 });
    const dark = plainStandard('#1a1c1e', 0.5, 0.3);
    const glass = plainStandard('#0a0d10', 0.1, 0.5);
    const crate = wood('#8a6a44');
    const ply = wood('#a2804f');
    const awnR = fabric('#9a3324', 0.85), awnW = fabric('#e2d6bc', 0.85);
    const sx = 0, sz = -12, W = 7, D = 3.5; // store centre and half extents (x, z); walls 4.2 high

    // shell: plinth, fascia with a red stripe, parapet cap, corner downspouts
    b.add(plinth, box(14.1, 0.85, 7.1, sx, 0.42, sz));
    b.add(cream, box(14.16, 0.6, 7.16, sx, 3.86, sz));
    b.add(red, box(14.2, 0.16, 7.2, sx, 3.5, sz));
    for (const [cx, cz] of [[-W, -D], [W, -D], [-W, D], [W, D]]) {
      b.add(metal, cyl(0.06, 0.06, 4.1, sx + cx + Math.sign(cx) * 0.12, 2.05, sz + cz + Math.sign(cz) * 0.12, 6));
    }

    // front (+z face at sz + D): parapet sign on two posts, awning over the window, soda machine,
    // ice chest, bench, bin
    const fz = sz + D;
    b.add(metal, box(0.12, 1.3, 0.12, -3.6, 4.85, fz - 0.25), box(0.12, 1.3, 0.12, 2.6, 4.85, fz - 0.25));
    b.add(dark, box(8.2, 1.1, 0.1, -0.5, 4.95, fz - 0.12));
    faces.push(signFace(0, 640, 1024, 200, 8.1, 1.0, -0.5, 4.95, fz - 0.06));
    // awning: alternating stripes sloping out from the wall, on three brackets
    for (let i = 0; i < 8; i++) {
      b.add(i % 2 ? awnW : awnR, box(0.78, 0.04, 1.45, -6.35 + i * 0.78 + 0.39 - 0.4, 3.05, fz + 0.62, 0, 0.38));
    }
    for (const ax of [-6.1, -3, 0.2]) b.add(metal, beam(new THREE.Vector3(ax, 2.6, fz), new THREE.Vector3(ax, 2.83, fz + 1.25), 0.025));
    b.add(red, box(0.95, 1.95, 0.8, -6.25, 1.17, fz + 0.55));
    b.add(glass, box(0.6, 1.1, 0.04, -6.35, 1.25, fz + 0.96));
    b.add(cream, box(0.18, 0.5, 0.05, -5.92, 1.2, fz + 0.96));
    faces.push(signFace(840, 1130, 184, 140, 0.5, 0.28, -6.25, 2.0, fz + 0.96));
    this.collider(f, -6.25, 1.1, fz + 0.55, 0.48, 0.95, 0.4);
    b.add(cream, box(1.7, 1.15, 0.85, 5.3, 0.78, fz + 0.5));
    b.add(steel, box(1.74, 0.08, 0.89, 5.3, 1.38, fz + 0.5));
    faces.push(signFace(0, 850, 300, 180, 1.2, 0.66, 5.3, 0.82, fz + 0.935));
    this.collider(f, 5.3, 0.78, fz + 0.5, 0.85, 0.6, 0.43);
    b.add(crate, box(1.8, 0.07, 0.4, 0.5, 0.65, fz + 0.4), box(1.8, 0.07, 0.12, 0.5, 1.0, fz + 0.12, 0, -0.2));
    b.add(metal, box(0.07, 0.45, 0.35, -0.3, 0.42, fz + 0.4), box(0.07, 0.45, 0.35, 1.3, 0.42, fz + 0.4));
    b.add(teal, cyl(0.3, 0.27, 0.95, 4.0, 0.67, fz + 0.45, 12));

    // east side: two restroom doors, a frosted window, the water heater
    const ex = sx + W;
    b.add(teal, box(0.06, 2.1, 0.95, ex + 0.03, 1.25, sz + 1.6), box(0.06, 2.1, 0.95, ex + 0.03, 1.25, sz - 0.6));
    b.add(metal, box(0.04, 0.04, 0.16, ex + 0.08, 1.25, sz + 1.25), box(0.04, 0.04, 0.16, ex + 0.08, 1.25, sz - 0.95));
    faces.push(signFace(840, 850, 184, 140, 0.42, 0.32, ex + 0.07, 1.75, sz - 0.6, Math.PI / 2));
    faces.push(signFace(840, 1000, 184, 120, 0.42, 0.27, ex + 0.07, 1.75, sz + 1.6, Math.PI / 2));
    b.add(glass, box(0.05, 0.5, 1.1, ex + 0.02, 3.0, sz - 2.3));
    b.add(cream, cyl(0.32, 0.32, 1.5, ex + 0.5, 0.95, sz - 2.6, 12), cyl(0.33, 0.33, 0.06, ex + 0.5, 1.72, sz - 2.6, 12));
    b.add(metal, cyl(0.03, 0.03, 2.6, ex + 0.5, 3.0, sz - 2.6, 6));
    this.collider(f, ex + 0.5, 0.95, sz - 2.6, 0.33, 0.75, 0.33);

    // west side: propane exchange cage (four bottles) and a ladder to the roof
    const wx = sx - W;
    const cx = wx - 0.75, cz = sz + 1.6;
    for (const [px, pz] of [[-0.5, -0.8], [0.5, -0.8], [-0.5, 0.8], [0.5, 0.8]]) b.add(steel, box(0.05, 1.7, 0.05, cx + px, 1.05, cz + pz));
    b.add(steel, box(1.05, 0.05, 1.65, cx, 1.9, cz), box(1.05, 0.05, 1.65, cx, 0.25, cz));
    for (let i = -3; i <= 3; i++) b.add(steel, box(0.02, 1.62, 0.02, cx + 0.52, 1.07, cz + i * 0.22));
    for (const [px, pz] of [[-0.2, -0.45], [0.2, -0.1], [-0.2, 0.3], [0.18, 0.62]]) {
      b.add(white, cyl(0.15, 0.15, 0.55, cx + px, 0.55, cz + pz, 10), cyl(0.1, 0.15, 0.1, cx + px, 0.88, cz + pz, 10));
    }
    this.collider(f, cx, 1.0, cz, 0.55, 1.0, 0.85);
    for (const lz of [-0.25, 0.25]) b.add(metal, box(0.05, 4.9, 0.05, wx - 0.12, 2.45, sz - 1.8 + lz));
    for (let y = 0.4; y < 4.8; y += 0.32) b.add(metal, box(0.03, 0.03, 0.5, wx - 0.12, y, sz - 1.8));

    // back (−z face): door, meter + conduit, condenser, dumpster and bags, tyres, pallets, plywood sign
    const bz = sz - D;
    b.add(metal, box(1.05, 2.15, 0.07, sx + 3.2, 1.08, bz - 0.03));
    b.add(slab, box(1.6, 0.18, 0.9, sx + 3.2, 0.09, bz - 0.45));
    b.add(steel, box(0.45, 0.65, 0.18, sx - 1.8, 1.6, bz - 0.1), cyl(0.035, 0.035, 2.3, sx - 1.8, 3.05, bz - 0.08, 6));
    b.add(steel, box(1.0, 0.85, 0.95, sx - 4.6, 0.43, bz - 1.0));
    b.add(dark, cyl(0.38, 0.38, 0.04, sx - 4.6, 0.87, bz - 1.0, 14));
    this.collider(f, sx - 4.6, 0.43, bz - 1.0, 0.5, 0.43, 0.48);
    b.add(green, box(2.0, 1.25, 1.25, sx - 0.4, 0.68, bz - 1.9), box(2.04, 0.08, 1.3, sx - 0.4, 1.36, bz - 1.95, 0, 0.12));
    this.collider(f, sx - 0.4, 0.68, bz - 1.9, 1.0, 0.68, 0.63);
    for (const [gx, gz, r] of [[0.9, -1.1, 0.34], [1.35, -1.6, 0.28], [0.95, -2.7, 0.3], [-1.7, -2.4, 0.25]]) {
      b.add(bag, place(new THREE.DodecahedronGeometry(r, 0), sx + gx, r * 0.55, bz + gz, 0.3, gx * 3, 0.2, 1.15, 0.62, 0.95));
    }
    const tyre = (x: number, y: number, z: number, rx = Math.PI / 2, rz = 0) =>
      place(new THREE.TorusGeometry(0.33, 0.12, 6, 14), x, y, z, rx, 0, rz);
    for (let i = 0; i < 4; i++) b.add(rubber, tyre(sx + 5.3 + (i % 2) * 0.04, 0.12 + i * 0.24, bz - 1.4));
    b.add(rubber, tyre(sx + 6.3, 0.42, bz - 0.6, 0.1, 0.25));
    this.collider(f, sx + 5.3, 0.5, bz - 1.4, 0.45, 0.5, 0.45);
    for (let i = 0; i < 3; i++) b.add(crate, box(1.2, 0.13, 1.0, sx + 3.4, 0.07 + i * 0.15, bz - 2.3, i * 0.06));
    b.add(crate, box(1.2, 1.0, 0.13, sx + 4.6, 0.55, bz - 0.3, 0, 0.22));
    b.add(ply, box(1.7, 0.95, 0.03, sx - 5.8, 0.6, bz - 0.25, 0, 0.18));
    faces.push(place(signRect(310, 850, 520, 300, 1.66, 0.92), sx - 5.8, 0.6, bz - 0.27, 0.18, Math.PI, 0));

    // roof: two A/C units, vent stacks, a dish turned at the sky
    const ry = 4.47;
    b.add(steel, box(1.5, 0.85, 1.15, sx - 3.2, ry + 0.43, sz - 1.0), box(1.3, 0.75, 1.05, sx + 2.6, ry + 0.38, sz + 0.6));
    b.add(dark, box(1.0, 0.04, 0.8, sx - 3.2, ry + 0.87, sz - 1.0));
    b.add(metal, cyl(0.08, 0.08, 0.8, sx + 5.2, ry + 0.4, sz - 2, 8), cyl(0.06, 0.06, 0.6, sx - 5.4, ry + 0.3, sz + 1.8, 8));
    b.add(cream, place(new THREE.SphereGeometry(0.55, 12, 6, 0, Math.PI * 2, 0, 1.0), sx + 5.6, ry + 0.85, sz + 2.2, -0.9, 0.6, 0));
    b.add(metal, cyl(0.04, 0.04, 0.8, sx + 5.6, ry + 0.4, sz + 2.2, 6));
    return faces;
  }

  private radioTower(lm: LandmarkDef) {
    const f = this.frame(lm);
    const root = new THREE.Group();
    root.applyMatrix4(f.m);
    const b = new MeshBatch();
    const steel = rustyMetal({ base: '#9a3a26', rust: 0.55, metalness: 0.6, roughness: 0.5 });
    const steelW = rustyMetal({ base: '#c8c0b0', rust: 0.5, metalness: 0.6, roughness: 0.5 });
    const conc = concrete('#8f877c');

    // lattice tower segment builder (triangular cross-section)
    const lattice = (base: THREE.Vector3, up: THREE.Vector3, height: number, w0: number, w1: number, segs: number, matA: THREE.Material, matB: THREE.Material) => {
      const side = new THREE.Vector3(1, 0, 0);
      const fwd = new THREE.Vector3().crossVectors(up, side).normalize();
      side.crossVectors(fwd, up).normalize();
      const corner = (i: number, t: number) => {
        const w = w0 + (w1 - w0) * t;
        const a = (i / 3) * Math.PI * 2;
        return base.clone().addScaledVector(up, height * t).addScaledVector(side, Math.cos(a) * w).addScaledVector(fwd, Math.sin(a) * w);
      };
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        const mat = s % 2 ? matA : matB;
        for (let i = 0; i < 3; i++) {
          const a0 = corner(i, t0), a1 = corner(i, t1), b0 = corner((i + 1) % 3, t0), b1 = corner((i + 1) % 3, t1);
          b.add(mat, beam(a0, a1, 0.09, 5), beam(a0, b1, 0.035, 4), beam(b0, a1, 0.035, 4), beam(a1, b1, 0.04, 4));
        }
      }
      return corner(0, 1).add(corner(1, 1)).add(corner(2, 1)).multiplyScalar(1 / 3);
    };
    b.add(conc, box(5, 0.6, 5, 0, 0.1, 0));
    const top = lattice(new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0, 1, 0), 24, 1.8, 0.9, 8, steel, steelW);
    this.collider(f, 0, 12, 0, 1.6, 12, 1.6);
    // broken-off upper section lying on the ground, bent
    const fallenBase = new THREE.Vector3(3, 1.2, 4);
    const fallenDir = new THREE.Vector3(0.5, 0.08, 1).normalize();
    lattice(fallenBase, fallenDir, 20, 0.9, 0.45, 7, steel, steelW);
    const fc = fallenBase.clone().addScaledVector(fallenDir, 10);
    this.physics.addBox(f.p(fc.x, fc.y, fc.z), { x: 0.9, y: 1, z: 10 }, f.yaw + Math.atan2(fallenDir.x, fallenDir.z));
    // dishes
    const dishMat = rustyMetal({ base: '#d9d4c8', rust: 0.35, metalness: 0.4 });
    const dish = (p: THREE.Vector3, rx: number, ry: number, r = 1.4) => {
      const g = new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, 0.6);
      g.rotateX(rx);
      g.rotateY(ry);
      g.translate(p.x, p.y, p.z);
      b.add(dishMat, g);
    };
    dish(new THREE.Vector3(0, 18, 1.4), -1.2, 0.3);
    dish(new THREE.Vector3(1.2, 21, -0.4), -1.4, 2.2, 1.1);
    dish(new THREE.Vector3(-7, 1.2, -3), -0.5, 0.8, 2.2); // crashed on the ground
    // shack + generator
    const shackX = -6, shackZ = 4;
    b.add(corrugated('#6e7a6e', 0.8), box(4, 2.6, 3.2, shackX, 1.3, shackZ));
    b.add(corrugated('#6b6156', 0.8), box(4.4, 0.15, 3.6, shackX, 2.7, shackZ, 0, 0, 0.08));
    b.add(warmWindow('#9fe8ff', 1.4), box(1.2, 0.6, 0.06, shackX + 0.6, 1.6, shackZ + 1.62));
    this.collider(f, shackX, 1.3, shackZ, 2, 1.3, 1.6);
    const gen = rustyMetal({ base: '#c79a2a', rust: 0.5 });
    b.add(gen, box(1.4, 0.9, 0.9, shackX + 3.2, 0.55, shackZ - 1));
    this.collider(f, shackX + 3.2, 0.55, shackZ - 1, 0.7, 0.45, 0.45);
    this.audioSpots.push({ kind: 'generator', pos: f.p(shackX + 3.2, 0.6, shackZ - 1) });
    // cable from generator to tower
    b.add(plainStandard('#0d0d0d', 0.5), wire(new THREE.Vector3(shackX + 3.2, 0.9, shackZ - 1), new THREE.Vector3(0, 3, 0), 1.4, 0.03));

    // blinking aviation light
    const red = glow('#ff2a1a', 0);
    b.add(red.material, place3(new THREE.SphereGeometry(0.22, 10, 8), top.clone().add(new THREE.Vector3(0, 0.3, 0))));
    this.blinkers.push({ u: red.intensity, period: 1.6, offset: 0 });
    const red2 = glow('#ff2a1a', 0);
    b.add(red2.material, place3(new THREE.SphereGeometry(0.16, 10, 8), new THREE.Vector3(0, 12, 1.4)));
    this.blinkers.push({ u: red2.intensity, period: 1.6, offset: 0.8 });

    const far = b.buildFar('spire-far');
    const near = b.build('spire');
    shadowProxy(near);
    root.add(near);
    // a work lamp that casts a light cone onto the intel spot
    const lampPos = new THREE.Vector3(shackX + 1.8, 2.5, shackZ + 1.9);
    const cone = lightCone(3, 1.6, '#bfeaff', 0.25);
    cone.mesh.position.copy(lampPos);
    cone.mesh.rotation.x = -0.5;
    near.add(cone.mesh);
    this.addLod(root, f, 20, near, far);
    this.group.add(root);
    void neon;
  }

  /** Past ~140 m from its edge a landmark draws as its one-draw flat stand-in (no shadow). */
  private addLod(root: THREE.Object3D, f: Frame, radius: number, near: THREE.Object3D, far: THREE.Object3D) {
    root.add(far);
    this.lods.push(new DistanceLod(new THREE.Vector3(f.x, f.y, f.z), radius, near, far));
  }

  /** The camp's near set (the people round the fire join it, so they hide with it at range). */
  private campNear: THREE.Object3D | null = null;
  private campCrowd: NpcCrowd | null = null;

  /**
   * Mara, Hollis, Pip and Dez round the campfire, on the two log benches (Meshy models; no procedural
   * figures exist for them, so without the models the camp stays as it was). Built after the
   * townsfolk models load, before the shader warm-up.
   */
  addCampPeople() {
    if (!this.campNear || !NpcCrowd.models) return;
    // camp space (the gas station's frame): fire at (−8, 5); log A along x at z 6.4 (north of the
    // fire), log B along z at x −6.8 (east). Each point is where the hips sit, on top of the log.
    const fire = new THREE.Vector3(-8, 0, 5);
    // they notice you from the far side of the fire (and from where you kneel in character select)
    const seat = (id: string, x: number, z: number, notice = 7): NpcDef => {
      const yaw = Math.atan2(fire.x - x, fire.z - z);
      return { id, look: CAMP_LOOK, pose: 'warm', x, y: 0, z, yaw, seat: 0.62, notice };
    };
    const defs = [
      seat('mara', -9.5, 6.5, 7.5),
      seat('pip', -8.3, 6.25),
      seat('hollis', -6.8, 4.65),
      seat('dez', -6.8, 3.45),
    ].filter((d) => NpcCrowd.models!.has(d.id));
    if (!defs.length) return;
    this.campCrowd = new NpcCrowd(defs, 'camp-people');
    this.campNear.add(this.campCrowd.mesh);
  }

  /** A camp-space point in world space, `y` metres above the ground there (menu cameras). */
  campPoint(x: number, y: number, z: number, out = new THREE.Vector3()) {
    const f = this.campFrame;
    if (!f) return out.copy(this.campPosition).add(new THREE.Vector3(x + 8, y, z - 5));
    out.set(x, 0, z).applyMatrix4(f.m);
    out.y = this.hf.heightAt(out.x, out.z) + y;
    return out;
  }

  update(dt: number, t: number, cam?: THREE.Vector3) {
    if (cam) this.campCrowd?.update(dt, cam);
    if (cam) for (const l of this.lods) l.update(cam);
    for (const fire of this.fires) fire.update(dt, cam);
    for (const fl of this.flickers) {
      const n = Math.sin(t * 17 * fl.speed + fl.phase) * Math.sin(t * 3.1 * fl.speed + fl.phase * 2);
      const off = n > 1 - fl.broken * 2 ? 0.08 : 1;
      fl.set(off * (0.92 + 0.08 * Math.sin(t * 60)));
    }
    for (const bl of this.blinkers) {
      const ph = ((t + bl.offset) % bl.period) / bl.period;
      bl.u.value = ph < 0.18 ? 14 : 0.15;
    }
  }
}

function place3(g: THREE.BufferGeometry, p: THREE.Vector3) {
  g.translate(p.x, p.y, p.z);
  return g;
}

// ------------------------------------------------------------------ Last Chance's sign canvas
// 1024×1280: the pylon sign fills the top 640 rows; the store's boards are packed below.
const SIGN_W = 1024, SIGN_H = 1280;

/** Map a geometry's 0..1 UVs onto the canvas rect (x, y, w, h) in pixels. */
function signUv(g: THREE.BufferGeometry, x: number, y: number, w: number, h: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (x + uv.getX(i) * w) / SIGN_W, 1 - (y + h - uv.getY(i) * h) / SIGN_H);
  }
  return g;
}
/** A pw×ph plane (facing +z) showing canvas rect (x, y, w, h). */
const signRect = (x: number, y: number, w: number, h: number, pw: number, ph: number) =>
  signUv(new THREE.PlaneGeometry(pw, ph), x, y, w, h);
/** …placed at (px, py, pz), turned `ry` about the vertical. */
const signFace = (x: number, y: number, w: number, h: number, pw: number, ph: number, px: number, py: number, pz: number, ry = 0) =>
  place(signRect(x, y, w, h, pw, ph), px, py, pz, 0, ry, 0);

function drawStoreSigns(ctx: CanvasRenderingContext2D) {
  const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif', UI = '"Chakra Petch", Arial, sans-serif';
  const at = (x: number, y: number, w: number, h: number, draw: (w: number, h: number) => void) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    draw(w, h);
    ctx.restore();
  };
  // MARKET board on the parapet
  at(0, 640, 1024, 200, (w, h) => {
    ctx.fillStyle = '#21403d'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e6d8b4'; ctx.lineWidth = 10; ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.fillStyle = '#efe2bd'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = `900 120px ${DISPLAY}`; ctx.fillText('MARKET', 40, h / 2 + 6, 440);
    ctx.fillStyle = '#e8a23a'; ctx.font = `700 36px ${UI}`; ctx.textAlign = 'right';
    ctx.fillText('ICE · BAIT · COLD DRINKS', w - 40, 76, 470);
    ctx.fillStyle = '#d9c9a0'; ctx.font = `500 28px ${UI}`;
    ctx.fillText('OPEN 24 HRS   EST. 1987', w - 40, 132, 470);
    grime(ctx, w, h, 1.6, 21);
  });
  // ICE chest front
  at(0, 850, 300, 180, (w, h) => {
    ctx.fillStyle = '#dce6ea'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1f5f9a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 120px ${DISPLAY}`; ctx.fillText('ICE', w / 2, 82);
    ctx.font = `600 26px ${UI}`; ctx.fillText('PACKED FRESH DAILY', w / 2, 150);
    ctx.strokeStyle = '#a3261c'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(30, 162); ctx.lineTo(w - 30, 136); ctx.stroke();
    grime(ctx, w, h, 1.4, 22);
  });
  // plywood out back, spray-painted
  at(310, 850, 520, 300, (w, h) => {
    ctx.fillStyle = '#b48d5a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(90,60,30,${0.08 + (i % 5) * 0.03})`; ctx.lineWidth = 2 + (i % 3);
      ctx.beginPath(); const y = (i * 37) % h; ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + 9, w * 0.6, y - 8, w, y + 4); ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9e1f17'; ctx.font = `900 92px ${DISPLAY}`;
    ctx.save(); ctx.rotate(-0.04); ctx.fillText('NO WATER', w / 2 + 6, 82); ctx.restore();
    ctx.fillStyle = '#151210'; ctx.font = `900 70px ${DISPLAY}`;
    ctx.fillText('NO GAS', w / 2 - 70, 170);
    ctx.save(); ctx.rotate(0.05); ctx.font = `700 54px ${DISPLAY}`; ctx.fillText("DON'T ASK", w / 2 + 40, 238); ctx.restore();
    grime(ctx, w, h, 1.2, 23);
  });
  // restroom plates
  at(840, 850, 184, 140, (w, h) => {
    ctx.fillStyle = '#e9e4d6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b2b2b'; ctx.textAlign = 'center'; ctx.font = `700 30px ${UI}`; ctx.fillText('WOMEN', w / 2, 40);
    ctx.fillStyle = '#b0221a'; ctx.font = `italic 700 30px ${UI}`;
    ctx.save(); ctx.translate(w / 2, 96); ctx.rotate(-0.08); ctx.fillText('OUT OF', 0, -6); ctx.fillText('ORDER', 0, 26); ctx.restore();
    grime(ctx, w, h, 1.5, 24);
  });
  at(840, 1000, 184, 120, (w, h) => {
    ctx.fillStyle = '#e9e4d6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b2b2b'; ctx.textAlign = 'center'; ctx.font = `700 40px ${UI}`; ctx.fillText('MEN', w / 2, 58);
    ctx.font = `500 22px ${UI}`; ctx.fillText('KEY AT COUNTER', w / 2, 96);
    grime(ctx, w, h, 1.5, 25);
  });
  // soda machine header
  at(840, 1130, 184, 140, (w, h) => {
    ctx.fillStyle = '#b8261c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4ead2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `italic 900 58px ${DISPLAY}`; ctx.fillText('FIZZ', w / 2, 56);
    ctx.font = `600 20px ${UI}`; ctx.fillText('ICE COLD', w / 2, 108);
    grime(ctx, w, h, 1.2, 26);
  });
}
