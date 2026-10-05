import * as THREE from 'three/webgpu';
import type { Heightfield } from './Heightfield';
import type { Physics } from '@/engine/physics';
import { LANDMARKS } from '@/content/world';
import type { LandmarkDef } from '@/content/types';
import { box, cyl, beam, MeshBatch, canvasTexture, grime, wire } from './kit';
import { rustyMetal, concrete, corrugated, neon, plainStandard, fabric, wood, glow, warmWindow } from './materials';
import { Fire, lightCone } from './effects';

export interface Flicker { set: (v: number) => void; phase: number; speed: number; broken: number }

/** Local→world helper for a landmark with position + yaw. */
class Frame {
  readonly m: THREE.Matrix4;
  constructor(public x: number, public y: number, public z: number, public yaw: number) {
    this.m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  }
  p(lx: number, ly: number, lz: number) {
    return new THREE.Vector3(lx, ly, lz).applyMatrix4(this.m);
  }
}

export class Landmarks {
  group = new THREE.Group();
  fires: Fire[] = [];
  flickers: Flicker[] = [];
  blinkers: { u: { value: number }; period: number; offset: number }[] = [];
  campPosition = new THREE.Vector3();
  audioSpots: { kind: 'fire' | 'neon' | 'generator'; pos: THREE.Vector3 }[] = [];

  constructor(private hf: Heightfield, private physics: Physics) {
    for (const lm of LANDMARKS) {
      if (lm.kind === 'gas-station') this.gasStation(lm);
      else this.radioTower(lm);
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
    // store building
    const sx = 0, sz = -12;
    b.add(conc, box(14, 4.2, 7, sx, 2.1, sz));
    b.add(roofMetal, box(14.6, 0.25, 7.6, sx, 4.35, sz));
    b.add(warmWindow('#ffae5a', 2.2), box(5, 1.8, 0.1, sx - 3, 1.8, sz + 3.52));
    b.add(darkGlass, box(1.6, 2.4, 0.1, sx + 3, 1.2, sz + 3.52));
    b.add(wood('#3d2a1c'), box(5.6, 0.12, 0.3, sx - 3, 0.9, sz + 3.6), box(0.3, 1.9, 0.12, sx - 0.5, 1.8, sz + 3.6), box(0.3, 1.9, 0.12, sx - 5.5, 1.8, sz + 3.6));
    this.collider(f, sx, 2.1, sz, 7, 2.1, 3.5);

    // tall sign pylon with neon
    const signX = 12, signZ = 8;
    b.add(metal, box(0.5, 9, 0.5, signX, 4.5, signZ), box(0.5, 9, 0.5, signX + 3.4, 4.5, signZ));
    this.collider(f, signX + 1.7, 4.5, signZ, 2, 4.5, 0.4);
    const signTex = canvasTexture(1024, 640, (ctx, w, h) => {
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
    const sign = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.75, 0.3), signMat);
    sign.position.set(signX + 1.7, 8.2, signZ);
    sign.castShadow = true;
    root.add(sign);
    // neon tube outline (flickers)
    const neonFlicker = { value: 1 };
    const neonMat = neon('#ff3a6e', 7, neonFlicker);
    const tubes: THREE.BufferGeometry[] = [];
    const nx = signX + 1.7, ny = 8.2, nz = signZ + 0.2;
    tubes.push(cyl(0.04, 0.04, 4.6, nx, ny + 1.5, nz, 6, 0, 0, Math.PI / 2), cyl(0.04, 0.04, 4.6, nx, ny - 1.5, nz, 6, 0, 0, Math.PI / 2));
    tubes.push(cyl(0.04, 0.04, 3.0, nx - 2.3, ny, nz, 6), cyl(0.04, 0.04, 3.0, nx + 2.3, ny, nz, 6));
    b.add(neonMat, ...tubes);
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

    root.add(b.build('gas'));

    const fire = new Fire(1, 40);
    fire.group.position.set(campX + 1, 0.15, campZ + 1);
    root.add(fire.group);
    this.fires.push(fire);
    this.campPosition.copy(f.p(campX + 1, 0.2, campZ + 1));
    this.audioSpots.push({ kind: 'fire', pos: this.campPosition.clone() });

    this.group.add(root);
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

    root.add(b.build('spire'));
    // a work lamp that casts a light cone onto the intel spot
    const lampPos = new THREE.Vector3(shackX + 1.8, 2.5, shackZ + 1.9);
    const cone = lightCone(3, 1.6, '#bfeaff', 0.25);
    cone.mesh.position.copy(lampPos);
    cone.mesh.rotation.x = -0.5;
    root.add(cone.mesh);
    this.group.add(root);
    void neon;
  }

  update(dt: number, t: number) {
    for (const fire of this.fires) fire.update(dt);
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

