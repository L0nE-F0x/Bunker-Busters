import * as THREE from 'three/webgpu';
import { uniform, vec2, vec3, vec4, float, time, sin, uv, smoothstep, abs, Fn, texture, color, mix, step, normalize, cameraPosition, positionWorld, normalWorld, dot, pow, clamp } from 'three/tsl';
import { noise } from '@/engine/noiseTex';
import type { Physics } from '@/engine/physics';
import { box, cyl, beam, MeshBatch, canvasTexture, grime, wire, merge, norm } from '../world/kit';
import { rustyMetal, concrete, corrugated, neon, plainStandard, fabric, wood, glow, chainLink, warmWindow, GlowPalette } from '../world/materials';
import { lightCone, GlowSprites } from '../world/effects';
import { dressHouse, dressRoof, dressYard, dressWorkshop, dressVault, CH, type Dress } from './garageDressing';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
type Collider = ReturnType<Physics['addBox']>;

export interface Tripwire { id: string; a: THREE.Vector3; b: THREE.Vector3; mesh: THREE.Object3D; armed: boolean }
export interface Laser { id: string; a: THREE.Vector3; b: THREE.Vector3; mesh: THREE.Mesh; intensity: { value: number } }
export interface Door { pivot: THREE.Object3D; open: number; target: number; collider: Collider | null; axis: 'y' | 'slide'; amount: number; colliderSpec: { pos: THREE.Vector3; half: THREE.Vector3 } }

/** Fence footprint (local metres). Front (+z) faces the access track. */
export const YARD = { x0: -22, x1: 22, z0: -18, z1: 20 };
export const HOUSE = { x0: -8, x1: 8, z0: -12, z1: 0, h: 4.2, vaultZ: -6.6 };

/**
 * Builds The Garage's geometry and returns handles to every gameplay-relevant piece. All positions
 * are in world space; `origin` is the local (0,0,0).
 */
export class GarageBuilder {
  group = new THREE.Group();
  roof = new THREE.Group();
  origin: THREE.Vector3;
  tripwires: Tripwire[] = [];
  lasers: Laser[] = [];
  doors: Record<'gateL' | 'gateR' | 'side' | 'vault' | 'gap', Door> = {} as any;
  floodlights: { light: THREE.SpotLight; cone: ReturnType<typeof lightCone> }[] = [];
  interiorLight!: THREE.PointLight;
  vaultLight!: THREE.PointLight;
  blinkers: { u: { value: number }; period: number; offset: number; on: number }[] = [];
  neonFlicker = { value: 1 };
  serverLeds!: { value: number };
  lootSpots: { id: string; pos: THREE.Vector3; mesh: THREE.Object3D; lid?: THREE.Object3D }[] = [];
  points: Record<string, THREE.Vector3> = {};
  dronePath: THREE.Vector3[] = [];
  floodBulbs: { value: number }[] = [];
  /** rotating alarm beacons (pivot + sweeping light cone), shown only while the alarm runs */
  beacons: THREE.Object3D[] = [];
  gateLockMesh!: THREE.Object3D;
  /** glow halos around every small light (one draw call); channels driven by Garage.updateLights */
  halos = new GlowSprites(24);
  /** fluorescent tube emissive (dims / goes red with the alarm) */
  tubeGlow!: { value: number };
  tubeColor!: { value: THREE.Color };
  /** every small static glow (LEDs, lamps, lenses, screens, tubes) shares one material */
  pal = new GlowPalette(40);
  /** blinker index → halo channel */
  blinkChannel: number[] = [];
  private D!: Dress;

  constructor(private physics: Physics, origin: THREE.Vector3) {
    this.origin = origin.clone();
    this.group.position.copy(origin);
    this.group.name = 'garage';
    this.build();
  }

  /** Register a blinking emissive; its halo (if any) follows the same channel. */
  private blink(u: { value: number }, period: number, offset: number, on: number) {
    this.blinkers.push({ u, period, offset, on });
    const ch = CH.BLINK0 + this.blinkers.length - 1;
    this.blinkChannel.push(ch);
    return ch;
  }

  /** local → world */
  w(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).add(this.origin);
  }

  private col(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    return this.physics.addBox(this.w(x, y, z), { x: hx, y: hy, z: hz }, rotY);
  }

  private build() {
    const b = new MeshBatch();
    const d = new MeshBatch();
    this.D = {
      b, d, halos: this.halos, glow: (c, k) => this.pal.slot(c, k),
      col: (x, y, z, hx, hy, hz, rotY) => { this.col(x, y, z, hx, hy, hz, rotY); },
      blink: (u, period, offset, on) => this.blink(u, period, offset, on),
    };
    this.buildFence(b);
    this.buildHouse(b);
    this.buildYard(b);
    this.buildInterior(b);
    this.group.add(b.build('garageStatic'));
    const decals = d.build('garageDecals', false, false);
    decals.traverse((o) => { o.renderOrder = 2; });
    this.group.add(decals);
    this.group.add(this.halos.build());
    this.group.add(this.roof);

    // patrol loop around the house inside the fence (world space), y = hover height
    const hy = 3.2;
    this.dronePath = [
      this.w(-15, hy, 14), this.w(0, hy, 13), this.w(15, hy, 14), this.w(17, hy, 2), this.w(17, hy, -13),
      this.w(0, hy, -15.5), this.w(-17, hy, -13), this.w(-17, hy, 2),
    ];
  }

  // ---------------------------------------------------------------- fence
  private buildFence(b: MeshBatch) {
    const { x0, x1, z0, z1 } = YARD;
    const postMat = rustyMetal({ base: '#7b7a74', rust: 0.6, metalness: 0.7 });
    const linkMat = chainLink();
    const barbMat = plainStandard('#1a1a1a', 0.6, 0.6);
    const H = 3.0;
    const linkPanels: THREE.BufferGeometry[] = [];
    const panel = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const g = new THREE.PlaneGeometry(len, H - 0.15);
      const uvs = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * len, uvs.getY(i) * (H - 0.15));
      g.rotateY(-Math.atan2(bz - az, bx - ax));
      g.translate((ax + bx) / 2, H / 2, (az + bz) / 2);
      return norm(g);
    };
    const sides: [number, number, number, number][] = [
      [x0, z1, -3.2, z1], [3.2, z1, x1, z1], // front with gate gap
      [x1, z1, x1, -10.8], [x1, -14.2, x1, z0], // east with secret gap
      [x1, z0, x0, z0], // back
      [x0, z0, x0, z1], // west
    ];
    for (const [ax, az, bx, bz] of sides) {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 3));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        b.add(postMat, cyl(0.05, 0.05, H + 0.4, px, (H + 0.4) / 2, pz, 6));
        // angled barbed-wire arm
        b.add(postMat, beam(new THREE.Vector3(px, H + 0.35, pz), new THREE.Vector3(px + (px === x1 ? 0.35 : px === x0 ? -0.35 : 0), H + 0.75, pz + (pz === z1 ? 0.35 : pz === z0 ? -0.35 : 0)), 0.03, 4));
      }
      linkPanels.push(panel(ax, az, bx, bz));
      // top rail + barbed wire
      b.add(postMat, beam(new THREE.Vector3(ax, H, az), new THREE.Vector3(bx, H, bz), 0.035, 5));
      for (let k = 0; k < 2; k++) {
        const off = 0.2 + k * 0.25;
        const ox = ax === bx ? (ax === x1 ? off : -off) * 0.8 : 0;
        const oz = az === bz ? (az === z1 ? off : -off) * 0.8 : 0;
        b.add(barbMat, wire(new THREE.Vector3(ax + ox, H + 0.45 + k * 0.2, az + oz), new THREE.Vector3(bx + ox, H + 0.45 + k * 0.2, bz + oz), 0.08, 0.012, 24));
      }
      // collider
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      this.col(cx, H / 2, cz, Math.abs(bx - ax) / 2 + 0.06, H / 2 + 0.5, Math.abs(bz - az) / 2 + 0.06);
    }
    b.add(linkMat, ...linkPanels);

    // gate: two swinging leaves with a padlocked chain
    const gateMat = rustyMetal({ base: '#8a8780', rust: 0.55, metalness: 0.7 });
    const mkLeaf = (hingeX: number, dir: 1 | -1, name: 'gateL' | 'gateR') => {
      const pivot = new THREE.Group();
      pivot.position.set(hingeX, 0, z1);
      const lb = new MeshBatch();
      const w = 3.2;
      lb.add(gateMat,
        cyl(0.06, 0.06, H, 0, H / 2, 0, 6),
        cyl(0.05, 0.05, H, dir * w, H / 2, 0, 6),
        beam(new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(dir * w, 0.15, 0), 0.05, 5),
        beam(new THREE.Vector3(0, H - 0.1, 0), new THREE.Vector3(dir * w, H - 0.1, 0), 0.05, 5),
        beam(new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(dir * w, H - 0.1, 0), 0.04, 5),
      );
      lb.add(linkMat, panel(0, 0, dir * w, 0));
      pivot.add(lb.build(name));
      this.group.add(pivot);
      const half = new THREE.Vector3(w / 2, H / 2, 0.08);
      const pos = this.w(hingeX + (dir * w) / 2, H / 2, z1);
      this.doors[name] = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis: 'y', amount: dir * 1.6, colliderSpec: { pos, half } };
    };
    mkLeaf(-3.2, 1, 'gateL');
    mkLeaf(3.2, -1, 'gateR');
    // chain + padlock
    const lockMat = rustyMetal({ base: '#d4b04a', rust: 0.1, metalness: 1, roughness: 0.25 });
    const chain = new MeshBatch();
    for (let i = 0; i < 9; i++) {
      const g = new THREE.TorusGeometry(0.05, 0.012, 4, 8);
      g.rotateY(i % 2 ? Math.PI / 2 : 0);
      g.translate(-0.3 + i * 0.075, 1.2 - Math.sin((i / 8) * Math.PI) * 0.08, 0.08);
      chain.add(plainStandard('#5a5650', 0.4, 0.9), g);
    }
    chain.add(lockMat, box(0.14, 0.17, 0.06, 0, 1.0, 0.1));
    chain.add(plainStandard('#8b8b88', 0.3, 0.95), place(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), 0, 1.09, 0.1));
    const chainGrp = chain.build('gateLock');
    chainGrp.position.set(0, 0, z1);
    this.group.add(chainGrp);
    this.gateLockMesh = chainGrp;
    this.points.gate = this.w(0, 1.1, z1 + 0.6);

    // loose fence panel at the secret gap (opens by peeling back)
    const gapPivot = new THREE.Group();
    gapPivot.position.set(x1, 0, -10.8);
    const gb = new MeshBatch();
    gb.add(linkMat, panel(0, 0, 0, -3.4));
    gb.add(postMat, cyl(0.05, 0.05, H, 0, H / 2, -3.4, 6));
    gapPivot.add(gb.build('gap'));
    this.group.add(gapPivot);
    const gapPos = this.w(x1, H / 2, -12.5);
    const gapHalf = new THREE.Vector3(0.08, H / 2 + 0.5, 1.7);
    this.doors.gap = { pivot: gapPivot, open: 0, target: 0, collider: this.physics.addBox(gapPos, gapHalf), axis: 'y', amount: -1.1, colliderSpec: { pos: gapPos, half: gapHalf } };
    this.points.gap = this.w(x1 + 0.8, 1, -12.5);
    // junk pile outside the gap hides it
    const tire = plainStandard('#161412', 0.95);
    for (let i = 0; i < 5; i++) {
      const g = new THREE.TorusGeometry(0.42, 0.18, 8, 16);
      g.rotateX(Math.PI / 2);
      g.translate(x1 + 2.3, 0.18 + i * 0.34, -8.6 + (i % 2) * 0.1);
      b.add(tire, g);
    }
    this.col(x1 + 2.3, 0.9, -8.6, 0.6, 0.9, 0.6);

    // tripwires: [id, a, b] local
    const tw: [string, [number, number], [number, number]][] = [
      ['tw_gate', [-3.4, 17.6], [3.4, 17.0]],
      ['tw_gap', [20.9, -10.4], [18.8, -14.6]],
      ['tw_side', [9.0, -5.5], [14.5, -5.0]],
    ];
    const canMat = rustyMetal({ base: '#b9b5a8', rust: 0.4, metalness: 0.8, roughness: 0.4 });
    const stakeMat = wood('#5a4028');
    const wireMat = new THREE.MeshStandardNodeMaterial({ color: '#d8d0c0', roughness: 0.2, metalness: 1 });
    wireMat.emissiveNode = vec3(1.0, 0.85, 0.6).mul(sin(time.mul(2.5)).mul(0.5).add(0.5).pow(8).mul(0.6));
    for (const [id, [ax, az], [bx2, bz2]] of tw) {
      const g = new THREE.Group();
      const a = new THREE.Vector3(ax, 0.22, az), c = new THREE.Vector3(bx2, 0.22, bz2);
      const tb = new MeshBatch();
      tb.add(stakeMat, cyl(0.025, 0.03, 0.5, ax, 0.2, az, 5), cyl(0.025, 0.03, 0.5, bx2, 0.2, bz2, 5));
      tb.add(wireMat, beam(a, c, 0.006, 3));
      for (let i = 0; i < 3; i++) {
        const p = a.clone().lerp(c, 0.25 + i * 0.25);
        tb.add(canMat, cyl(0.035, 0.035, 0.12, p.x, 0.12 + (i % 2) * 0.03, p.z, 8));
      }
      g.add(tb.build(id, true, true));
      this.group.add(g);
      this.tripwires.push({ id, a: this.w(a.x, a.y, a.z), b: this.w(c.x, c.y, c.z), mesh: g, armed: true });
    }

    // sign on the fence
    const signTex = canvasTexture(512, 320, (ctx, w, h) => {
      ctx.fillStyle = '#e8e0cc';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#b3201a';
      ctx.fillRect(0, 0, w, 90);
      ctx.fillStyle = '#fff';
      ctx.font = '900 66px "Big Shoulders Stencil Display", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('WARNING', w / 2, 70);
      ctx.fillStyle = '#1a1a1a';
      ctx.font = '700 40px "Chakra Petch", Arial, sans-serif';
      ctx.fillText('TRESPASSERS WILL BE', w / 2, 150);
      ctx.font = '900 64px "Chakra Petch", Arial, sans-serif';
      ctx.fillText('DISRUPTED', w / 2, 225);
      ctx.font = '500 24px "Chakra Petch", Arial, sans-serif';
      ctx.fillText('— Bunkr.ly Trust & Safety (Tanner)', w / 2, 285);
      grime(ctx, w, h, 0.8, 4);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.875), new THREE.MeshStandardNodeMaterial({ map: signTex, roughness: 0.7, side: THREE.DoubleSide }));
    sign.position.set(-6.5, 1.6, z1 + 0.04);
    sign.rotation.z = 0.04;
    this.group.add(sign);
  }

  // ---------------------------------------------------------------- house
  private buildHouse(b: MeshBatch) {
    const { x0, x1, z0, z1, h, vaultZ } = HOUSE;
    const block = concrete('#a69d8e', { stains: 0.8 });
    const t = 0.3;
    // west wall, back wall
    b.add(block, box(t, h, z1 - z0, x0 + t / 2, h / 2, (z0 + z1) / 2));
    this.col(x0 + t / 2, h / 2, (z0 + z1) / 2, t / 2, h / 2, (z1 - z0) / 2);
    b.add(block, box(x1 - x0, h, t, 0, h / 2, z0 + t / 2));
    this.col(0, h / 2, z0 + t / 2, (x1 - x0) / 2, h / 2, t / 2);
    // east wall with side door opening z∈[-3.8,-2.2]
    const dz0 = -3.8, dz1 = -2.2, dh = 2.4;
    b.add(block, box(t, h, dz0 - z0, x1 - t / 2, h / 2, (z0 + dz0) / 2));
    this.col(x1 - t / 2, h / 2, (z0 + dz0) / 2, t / 2, h / 2, (dz0 - z0) / 2);
    b.add(block, box(t, h, z1 - dz1, x1 - t / 2, h / 2, (dz1 + z1) / 2));
    this.col(x1 - t / 2, h / 2, (dz1 + z1) / 2, t / 2, h / 2, (z1 - dz1) / 2);
    b.add(block, box(t, h - dh, dz1 - dz0, x1 - t / 2, dh + (h - dh) / 2, (dz0 + dz1) / 2));
    // front wall around roll-up door x∈[-5,5], height 3.4
    const gx = 5, gh = 3.4;
    b.add(block, box(x1 - gx, h, t, (gx + x1) / 2, h / 2, z1 - t / 2));
    b.add(block, box(x1 - gx, h, t, -(gx + x1) / 2, h / 2, z1 - t / 2));
    b.add(block, box(gx * 2, h - gh, t, 0, gh + (h - gh) / 2, z1 - t / 2));
    this.col(0, h / 2, z1 - t / 2, (x1 - x0) / 2, h / 2, t / 2);
    // roll-up door (welded shut), plinth, roof trim, gutters, electrics, grime, light spill
    dressHouse(this.D, HOUSE);
    // weld beads + graffiti
    b.add(plainStandard('#1a1a1a', 0.6, 0.6), box(0.08, gh, 0.06, -gx + 0.05, gh / 2, z1 + 0.06), box(0.08, gh, 0.06, gx - 0.05, gh / 2, z1 + 0.06));
    const graffiti = canvasTexture(1024, 400, (ctx, w, hh) => {
      ctx.clearRect(0, 0, w, hh);
      ctx.save();
      ctx.translate(w / 2, hh / 2);
      ctx.rotate(-0.06);
      ctx.font = '900 150px "Big Shoulders Stencil Display", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(255,40,120,0.8)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ff2f7a';
      ctx.fillText('PRE-REVENUE', 0, 10);
      ctx.shadowBlur = 0;
      ctx.font = '700 64px "Chakra Petch", Arial, sans-serif';
      ctx.fillStyle = '#f4f0e0';
      ctx.fillText('NO SOLICITORS · NO INVESTORS · NO REFUNDS', 0, 110, w * 0.86);
      ctx.restore();
      // drips
      ctx.fillStyle = '#ff2f7a';
      for (let i = 0; i < 26; i++) ctx.fillRect(160 + Math.random() * 700, 200 + Math.random() * 20, 4, 20 + Math.random() * 80);
    });
    const graf = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.1), new THREE.MeshStandardNodeMaterial({ map: graffiti, transparent: true, roughness: 0.8, alphaTest: 0.05 }));
    graf.position.set(0, 1.75, z1 + 0.066);
    graf.renderOrder = 3;
    this.group.add(graf);

    // neon sign "THE GARAGE" above door + Bunkr.ly logo box
    const neonTex = canvasTexture(1024, 256, (ctx, w, hh) => {
      ctx.clearRect(0, 0, w, hh);
      ctx.textAlign = 'center';
      ctx.font = '700 150px "Chakra Petch", Impact, sans-serif';
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText('THE GARAGE', w / 2, 180);
    });
    const neonMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: true });
    const uFlick = uniform(1).onFrameUpdate(() => this.neonFlicker.value);
    const tx = texture(neonTex);
    mat2(neonMat, Fn(() => {
      const c = mix(color('#3ff2e0'), color('#ff3a9e'), smoothstep(0.45, 0.55, uv().x));
      return vec4(c.mul(tx.a).mul(uFlick).mul(3.2), tx.a);
    })());
    const neonSign = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.9), neonMat);
    neonSign.position.set(0, 3.75 + 0.15, z1 + 0.06);
    this.group.add(neonSign);
    b.add(plainStandard('#1a1a1a', 0.6, 0.6), box(7.8, 1.2, 0.08, 0, 3.85, z1 + 0.0));

    // window slits with warm light on west + front
    b.add(warmWindow('#ffb66a', 1.6), box(0.06, 0.5, 1.6, x0 - 0.02, 2.8, -4), box(0.06, 0.5, 1.6, x0 - 0.02, 2.8, -9));

    // side door (steel) on hinge at z = dz1 on the east wall
    const doorPivot = new THREE.Group();
    doorPivot.position.set(x1 + 0.02, 0, dz1);
    const steel = rustyMetal({ base: '#4c5a63', rust: 0.2, metalness: 0.7, roughness: 0.45 });
    const db = new MeshBatch();
    db.add(steel, box(0.08, dh, 1.6, 0.04, dh / 2, -0.8));
    db.add(rustyMetal({ base: '#d4b04a', rust: 0.1, metalness: 1, roughness: 0.25 }), box(0.06, 0.16, 0.12, 0.12, 1.1, -1.35));
    db.add(plainStandard('#202326', 0.4, 0.6), box(0.04, 0.04, 0.25, 0.14, 1.05, -1.25));
    doorPivot.add(db.build('sideDoor'));
    this.group.add(doorPivot);
    const sdPos = this.w(x1 - 0.1, dh / 2, (dz0 + dz1) / 2);
    const sdHalf = new THREE.Vector3(0.12, dh / 2, 0.8);
    this.doors.side = { pivot: doorPivot, open: 0, target: 0, collider: this.physics.addBox(sdPos, sdHalf), axis: 'y', amount: 1.7, colliderSpec: { pos: sdPos, half: sdHalf } };
    this.points.sideDoor = this.w(x1 + 0.7, 1.2, (dz0 + dz1) / 2);
    // keypad beside the door
    const kp = this.pal.slot('#38ffb0', 2.5);
    b.add(plainStandard('#202326', 0.4, 0.6), box(0.06, 0.32, 0.22, x1 + 0.03, 1.35, dz1 + 0.35));
    kp.add(b, box(0.02, 0.06, 0.16, x1 + 0.07, 1.45, dz1 + 0.35));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) b.add(rustyMetal({ base: '#5c6266', rust: 0.35 }), box(0.015, 0.035, 0.04, x1 + 0.065, 1.33 - r * 0.045, dz1 + 0.3 + c * 0.05));
    this.halos.add(new THREE.Vector3(x1 + 0.1, 1.45, dz1 + 0.35), '#38ffb0', 0.3, this.blink(kp.intensity, 2.2, 0.3, 2.5), 1.5);
    // lamp over side door
    const lamp = this.pal.slot('#ffd6a0', 6);
    b.add(plainStandard('#1a1a1a', 0.6, 0.6), box(0.3, 0.12, 0.4, x1 + 0.2, 2.7, -3));
    lamp.add(b, box(0.22, 0.03, 0.3, x1 + 0.2, 2.63, -3));

    // vault wall with reinforced door
    const vt = 0.4;
    const vdw = 1.0;
    b.add(block, box(-vdw - x0, h, vt, (x0 - vdw) / 2, h / 2, vaultZ));
    this.col((x0 - vdw) / 2, h / 2, vaultZ, (-vdw - x0) / 2, h / 2, vt / 2);
    b.add(block, box(x1 - vdw, h, vt, (x1 + vdw) / 2, h / 2, vaultZ));
    this.col((x1 + vdw) / 2, h / 2, vaultZ, (x1 - vdw) / 2, h / 2, vt / 2);
    b.add(block, box(vdw * 2, h - 2.4, vt, 0, 2.4 + (h - 2.4) / 2, vaultZ));
    const vaultMat = rustyMetal({ base: '#7f8588', rust: -0.35, metalness: 0.85, roughness: 0.38, scale: 2.5 });
    const vPivot = new THREE.Group();
    vPivot.position.set(-vdw, 0, vaultZ + vt / 2);
    const vb = new MeshBatch();
    const vdark = rustyMetal({ base: '#3b4044', rust: 0.35, metalness: 0.75, roughness: 0.45 });
    const brass = rustyMetal({ base: '#d4b04a', rust: 0.1, metalness: 1, roughness: 0.25 });
    const W = vdw * 2, Hd = 2.4;
    // slab, raised frame and inset panel
    vb.add(vaultMat, box(W, Hd, 0.2, vdw, Hd / 2, 0));
    vb.add(vaultMat, box(W, 0.14, 0.06, vdw, Hd - 0.07, 0.12), box(W, 0.14, 0.06, vdw, 0.07, 0.12), box(0.14, Hd - 0.28, 0.06, 0.07, Hd / 2, 0.12), box(0.14, Hd - 0.28, 0.06, W - 0.07, Hd / 2, 0.12));
    vb.add(vaultMat, box(W - 0.5, Hd - 0.55, 0.03, vdw, Hd / 2, 0.115));
    for (let i = 0; i < 7; i++) {
      for (const [rx, ry] of [[0.2 + i * 0.27, Hd - 0.07], [0.2 + i * 0.27, 0.07]]) vb.add(vdark, cyl(0.022, 0.022, 0.03, rx, ry, 0.16, 6, Math.PI / 2));
    }
    for (let i = 0; i < 8; i++) for (const rx of [0.07, W - 0.07]) vb.add(vdark, cyl(0.022, 0.022, 0.03, rx, 0.3 + i * 0.26, 0.16, 6, Math.PI / 2));
    // spoked locking wheel with hub and grips
    const wy = 1.22, wz = 0.25;
    vb.add(brass, place(new THREE.TorusGeometry(0.36, 0.03, 8, 32), vdw, wy, wz));
    vb.add(brass, cyl(0.09, 0.11, 0.14, vdw, wy, wz - 0.06, 16, Math.PI / 2));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI;
      vb.add(brass, cyl(0.018, 0.018, 0.72, vdw, wy, wz, 6, 0, 0, a));
      for (const sgn of [-1, 1]) vb.add(vdark, cyl(0.03, 0.03, 0.09, vdw - Math.sin(a) * 0.38 * sgn, wy + Math.cos(a) * 0.38 * sgn, wz + 0.04, 8, Math.PI / 2));
    }
    // combination dial + status lamp
    vb.add(brass, cyl(0.09, 0.09, 0.04, vdw + 0.55, 1.78, 0.15, 18, Math.PI / 2));
    vb.add(vdark, cyl(0.06, 0.06, 0.05, vdw + 0.55, 1.78, 0.16, 12, Math.PI / 2));
    // hinge barrels on the pivot side, locking bolts on the free edge
    for (const hy of [0.35, 1.2, 2.05]) {
      vb.add(vdark, cyl(0.075, 0.075, 0.34, -0.02, hy, 0.13, 12));
      vb.add(vdark, box(0.2, 0.26, 0.04, 0.08, hy, 0.12));
    }
    for (const by of [0.45, 1.2, 1.95]) vb.add(brass, cyl(0.05, 0.05, 0.3, W + 0.1, by, 0, 10, 0, 0, Math.PI / 2));
    vPivot.add(vb.build('vaultDoor'));
    this.group.add(vPivot);
    const vdPos = this.w(0, 1.2, vaultZ);
    const vdHalf = new THREE.Vector3(vdw, 1.2, 0.2);
    this.doors.vault = { pivot: vPivot, open: 0, target: 0, collider: this.physics.addBox(vdPos, vdHalf), axis: 'y', amount: -1.6, colliderSpec: { pos: vdPos, half: vdHalf } };
    this.points.vaultDoor = this.w(0.0, 1.2, vaultZ + 0.9);
    const vk = this.pal.slot('#ff3a3a', 2.5);
    b.add(plainStandard('#202326', 0.4, 0.6), box(0.24, 0.34, 0.06, 1.65, 1.35, vaultZ + vt / 2 + 0.03));
    vk.add(b, box(0.16, 0.06, 0.02, 1.65, 1.45, vaultZ + vt / 2 + 0.07));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) b.add(rustyMetal({ base: '#5c6266', rust: 0.35 }), box(0.04, 0.035, 0.015, 1.6 + c * 0.05, 1.33 - r * 0.045, vaultZ + vt / 2 + 0.065));
    this.halos.add(new THREE.Vector3(1.65, 1.45, vaultZ + vt / 2 + 0.1), '#ff3a3a', 0.3, this.blink(vk.intensity, 1.4, 0, 2.5), 1.5);

    // roof (hidden when the player is inside)
    const roofMat = corrugated('#8d8a82', 0.75, 'x');
    const rb = new MeshBatch();
    rb.add(roofMat, box(x1 - x0 + 0.8, 0.12, z1 - z0 + 0.8, 0, h + 0.1, (z0 + z1) / 2, 0, 0.03));
    rb.add(block, box(x1 - x0 + 0.3, 0.4, 0.3, 0, h + 0.2, z1 - 0.15));
    // satellite dish + solar on roof
    const dishMat = rustyMetal({ base: '#dcd6c8', rust: 0.3 });
    const dg = new THREE.SphereGeometry(0.9, 16, 6, 0, Math.PI * 2, 0, 0.6);
    dg.rotateX(-1.0);
    dg.rotateY(0.7);
    dg.translate(-5, h + 1.4, -9);
    rb.add(dishMat, norm(dg), cyl(0.05, 0.05, 1.2, -5, h + 0.7, -9, 6));
    const antenna = this.pal.slot('#ff3030', 0);
    rb.add(plainStandard('#1a1a1a', 0.6, 0.6), cyl(0.03, 0.03, 3, 6, h + 1.5, -10, 5));
    antenna.add(rb, place(new THREE.SphereGeometry(0.08, 8, 6), 6, h + 3.05, -10));
    this.halos.add(new THREE.Vector3(6, h + 3.05, -10), '#ff3030', 0.9, this.blink(antenna.intensity, 2, 0.5, 12), 2.5);
    dressRoof(rb, HOUSE);
    this.roof.add(rb.build('roof'));
  }

  // ---------------------------------------------------------------- yard
  private buildYard(b: MeshBatch) {
    const { z1 } = YARD;
    const conc = concrete('#8e877c', { stains: 0.5 });
    // concrete apron in front of the house
    b.add(conc, box(18, 0.12, 9, 0, 0.02, 4.5));
    // solar array (west)
    const panelMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.15, metalness: 0.6 });
    const grid = smoothstep(0.94, 0.97, abs(sin(uv().x.mul(Math.PI * 6)))).max(smoothstep(0.94, 0.97, abs(sin(uv().y.mul(Math.PI * 10)))));
    panelMat.colorNode = mix(vec3(0.02, 0.05, 0.12), vec3(0.6, 0.62, 0.65), grid);
    const frameMat = rustyMetal({ base: '#9a9a96', rust: 0.4 });
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 3; i++) {
        const px = -18 + i * 2.6, pz = -2 - r * 4;
        const g = new THREE.BoxGeometry(2.4, 0.05, 1.6);
        g.rotateX(-0.6);
        g.translate(px, 1.2, pz);
        b.add(panelMat, norm(g));
        b.add(frameMat, cyl(0.04, 0.04, 1.1, px, 0.55, pz + 0.4, 5), cyl(0.04, 0.04, 1.6, px, 0.8, pz - 0.4, 5));
      }
      this.col(-15.4, 0.9, -2 - r * 4, 4, 0.9, 0.9);
    }
    // water tank
    const tankMat = rustyMetal({ base: '#4f6a63', rust: 0.55 });
    b.add(tankMat, cyl(1.4, 1.4, 3, -16, 1.9, -13, 18), cyl(1.45, 1.45, 0.1, -16, 3.45, -13, 18));
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add(frameMat, cyl(0.06, 0.06, 0.6, -16 + lx, 0.3, -13 + lz, 5));
    this.col(-16, 1.9, -13, 1.4, 1.9, 1.4);
    for (const lx of [-0.25, 0.25]) b.add(frameMat, box(0.05, 3.4, 0.05, -16 + lx, 1.7, -11.5));
    for (let i = 0; i < 10; i++) b.add(frameMat, box(0.5, 0.03, 0.03, -16, 0.3 + i * 0.33, -11.5));
    b.add(frameMat, cyl(0.07, 0.07, 1.4, -14.7, 0.7, -12.2, 8, 0, 0, Math.PI / 2 - 0.0));
    b.add(plainStandard('#1a1a1a', 0.6, 0.6), cyl(0.12, 0.12, 0.04, -14.0, 0.7, -12.2, 10, 0, 0, Math.PI / 2));
    // generator (east)
    const genMat = rustyMetal({ base: '#c4952a', rust: 0.45 });
    b.add(genMat, box(1.8, 1.1, 1.0, 12, 0.6, -9));
    b.add(plainStandard('#1a1a1a', 0.6, 0.6), cyl(0.08, 0.08, 0.8, 12.6, 1.4, -9, 6));
    const genLed = this.pal.slot('#4bff5a', 3);
    genLed.add(b, box(0.06, 0.06, 0.02, 11.4, 0.9, -8.49));
    this.halos.add(new THREE.Vector3(11.4, 0.9, -8.45), '#4bff5a', 0.25, this.blink(genLed.intensity, 1.0, 0.2, 3), 1.5);
    // generator detail: control panel, fuel cap, vents, exhaust soot
    b.add(plainStandard('#202326', 0.4, 0.6), box(0.5, 0.35, 0.03, 11.6, 0.85, -8.49), box(1.82, 0.06, 1.02, 12, 1.16, -9));
    for (let i = 0; i < 6; i++) b.add(plainStandard('#1a1a1a', 0.6, 0.6), box(0.6, 0.025, 0.02, 12.45, 0.4 + i * 0.09, -8.495));
    b.add(rustyMetal({ base: '#c4952a', rust: 0.45 }), cyl(0.07, 0.07, 0.06, 11.4, 1.2, -9.3, 10));
    for (const [wx, wz] of [[11.3, -8.6], [12.7, -8.6], [11.3, -9.4], [12.7, -9.4]]) b.add(plainStandard('#161412', 0.95), cyl(0.12, 0.12, 0.08, wx, 0.12, wz, 10, Math.PI / 2));
    this.col(12, 0.6, -9, 0.9, 0.6, 0.5);
    this.points.generator = this.w(12, 0.8, -9);
    // sandbags along the front
    const bagMat = fabric('#8a7a58');
    for (let i = 0; i < 9; i++) {
      for (let r = 0; r < 2; r++) {
        const g = new THREE.CapsuleGeometry(0.17, 0.45, 3, 8);
        g.rotateZ(Math.PI / 2);
        g.scale(1, 0.7, 1);
        g.translate(-15 + i * 0.66 + r * 0.33, 0.14 + r * 0.24, 9);
        b.add(bagMat, norm(g));
      }
    }
    this.col(-12.4, 0.35, 9, 3.1, 0.35, 0.25);
    // crates of meal shakes
    const crateMat = wood('#8a6a40');
    b.add(crateMat, box(1.1, 0.9, 1.1, 13, 0.45, 8, 0.2), box(1.1, 0.9, 1.1, 14.2, 0.45, 7.6, -0.1), box(1.0, 0.8, 1.0, 13.6, 1.3, 7.8, 0.4));
    this.col(13.6, 0.8, 7.8, 1.3, 0.8, 0.7);
    // tarp-covered "wedge truck"
    const tarp = fabric('#4a5a6a', 0.9);
    const tg = new THREE.BoxGeometry(5, 1.8, 2.3, 8, 3, 3);
    const tp = tg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
      const wedge = y > 0 ? 1 - Math.max(0, (Math.abs(x + 0.5) - 0.6)) * 0.35 : 1;
      tp.setXYZ(i, x * (1 + Math.sin(y * 3 + z) * 0.02), y * wedge + Math.sin(x * 4 + z * 3) * 0.04, z * (y > 0 ? 0.95 : 1));
    }
    tg.computeVertexNormals();
    tg.translate(13, 0.9 + 0.3, 1.5);
    b.add(tarp, norm(tg));
    for (const [wx, wz] of [[11.3, 0.45], [14.7, 0.45], [11.3, 2.55], [14.7, 2.55]]) {
      b.add(plainStandard('#161412', 0.95), place(new THREE.TorusGeometry(0.3, 0.13, 8, 18), wx, 0.42, wz));
      b.add(rustyMetal({ base: '#9a9a96', rust: 0.4 }), cyl(0.18, 0.18, 0.06, wx, 0.42, wz + (wz < 1.5 ? -0.08 : 0.08), 12, Math.PI / 2));
    }
    b.add(rustyMetal({ base: '#9a9a96', rust: 0.4 }), box(0.12, 0.2, 2.1, 15.55, 0.5, 1.5), box(0.12, 0.2, 2.1, 10.45, 0.5, 1.5));
    for (const tx of [11.6, 13.0, 14.4]) b.add(plainStandard('#c9b48a', 0.8), wire(new THREE.Vector3(tx, 0.35, 0.3), new THREE.Vector3(tx, 0.35, 2.7), -1.95, 0.012, 12));
    this.col(13, 0.9, 1.5, 2.5, 0.9, 1.15);

    // floodlight poles at the front corners + megaphone pole
    const poleMat = rustyMetal({ base: '#7b7a74', rust: 0.6, metalness: 0.7 });
    for (const [fx, fz] of [[-20, 18], [20, 18]] as const) {
      b.add(poleMat, cyl(0.1, 0.12, 6, fx, 3, fz, 8));
      // yoke, finned housing with a visor, junction box and conduit down the pole
      const housing = plainStandard('#202326', 0.4, 0.6);
      b.add(poleMat, box(0.7, 0.05, 0.05, fx, 5.72, fz), box(0.05, 0.4, 0.05, fx - 0.33, 5.9, fz), box(0.05, 0.4, 0.05, fx + 0.33, 5.9, fz));
      b.add(housing, box(0.6, 0.35, 0.4, fx, 6, fz, 0, -0.35));
      for (let i = 0; i < 5; i++) b.add(housing, box(0.56, 0.3, 0.02, fx, 6.05, fz + 0.24 + i * 0.045, 0, -0.35));
      b.add(housing, box(0.66, 0.03, 0.22, fx, 6.24, fz - 0.28, 0, -0.6));
      b.add(poleMat, box(0.22, 0.3, 0.14, fx, 2.2, fz - 0.14), cyl(0.025, 0.025, 3.4, fx + 0.06, 3.9, fz - 0.12, 5));
      const lightMat = this.pal.slot('#fff2d0', 0);
      lightMat.add(b, box(0.5, 0.25, 0.04, fx, 5.93, fz - 0.2, 0, -0.35));
      this.halos.add(new THREE.Vector3(fx, 5.94, fz - 0.3), '#fff0d0', 2.6, CH.NIGHT, 3);
      const spot = new THREE.SpotLight(0xffe6c0, 0, 40, 0.65, 0.5, 1.4);
      spot.position.copy(this.w(fx, 6, fz));
      spot.target.position.copy(this.w(fx * 0.3, 0, fz - 14));
      const cone = lightCone(14, 7, '#ffe6c0', 0.0);
      cone.mesh.position.set(fx, 5.9, fz);
      const aim = new THREE.Vector3(fx * 0.3 - fx, -5.9, -14).normalize();
      cone.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim);
      this.group.add(cone.mesh);
      this.floodlights.push({ light: spot, cone });
      this.floodBulbs.push(lightMat.intensity);
      this.col(fx, 3, fz, 0.15, 3, 0.15);
    }
    b.add(poleMat, cyl(0.07, 0.08, 5, -4.5, 2.5, 17.5, 6));
    const horn = new THREE.CylinderGeometry(0.35, 0.08, 0.6, 12, 1, true);
    horn.rotateX(Math.PI / 2);
    horn.translate(-4.5, 4.8, 17.85);
    b.add(rustyMetal({ base: '#9a9a96', rust: 0.4 }), norm(horn));
    this.points.megaphone = this.w(-4.5, 4.8, 18);
    this.col(-4.5, 2.5, 17.5, 0.1, 2.5, 0.1);

    dressYard(this.D);

    // drone charging dock pad
    const padGlow = this.pal.slot('#3ff2e0', 1.5);
    b.add(conc, cyl(1.2, 1.3, 0.2, -12, 0.1, 4, 20));
    padGlow.add(b, place(new THREE.TorusGeometry(0.9, 0.04, 6, 32), -12, 0.22, 4, Math.PI / 2));
    this.points.dock = this.w(-12, 0.5, 4);
    this.halos.add(new THREE.Vector3(-13.7, 1.38, 4.0), '#3ff2e0', 0.5, CH.ON, 1.2);
    void z1;
  }

  // ---------------------------------------------------------------- interior
  private buildInterior(b: MeshBatch) {
    const { x0, x1, z0, z1, vaultZ } = HOUSE;
    const floor = concrete('#6f6a62', { stains: 1, scale: 2 });
    b.add(floor, box(x1 - x0 - 0.2, 0.1, z1 - z0 - 0.2, 0, 0.05, (z0 + z1) / 2));
    // workbench along west wall
    const benchWood = wood('#6a4a2c');
    const metal = rustyMetal({ base: '#5c6266', rust: 0.35 });
    b.add(benchWood, box(0.9, 0.08, 4, x0 + 0.8, 0.95, -3));
    b.add(metal, box(0.06, 0.95, 0.06, x0 + 0.4, 0.47, -4.9), box(0.06, 0.95, 0.06, x0 + 1.2, 0.47, -4.9), box(0.06, 0.95, 0.06, x0 + 0.4, 0.47, -1.1), box(0.06, 0.95, 0.06, x0 + 1.2, 0.47, -1.1));
    b.add(metal, box(0.05, 1.2, 3.6, x0 + 0.33, 1.9, -3)); // pegboard
    this.col(x0 + 0.8, 0.5, -3, 0.45, 0.5, 2);
    // fuse box on west wall
    const fuse = rustyMetal({ base: '#8c8a5a', rust: 0.4 });
    b.add(fuse, box(0.15, 0.6, 0.45, x0 + 0.38, 1.6, -0.9));
    const fuseLed = this.pal.slot('#ff3030', 3);
    fuseLed.add(b, box(0.02, 0.04, 0.04, x0 + 0.46, 1.8, -0.75));
    this.halos.add(new THREE.Vector3(x0 + 0.49, 1.8, -0.75), '#ff3030', 0.22, this.blink(fuseLed.intensity, 0.8, 0, 3), 1.5);
    b.add(plainStandard('#202326', 0.4, 0.6), box(0.03, 0.5, 0.36, x0 + 0.465, 1.55, -0.9)); // door seam/panel
    b.add(rustyMetal({ base: '#5c6266', rust: 0.35 }), box(0.04, 0.08, 0.03, x0 + 0.48, 1.55, -1.07));
    this.points.fuseBox = this.w(x0 + 0.9, 1.4, -0.9);
    // conduit from fuse box to laser emitters
    b.add(plainStandard('#1a1a1a', 0.6, 0.6), box(0.05, 0.05, 4.5, x0 + 0.33, 3.6, -3.2));

    // whiteboard with startup OKRs
    const wbTex = canvasTexture(1024, 600, (ctx, w, h) => {
      ctx.fillStyle = '#f0efe8';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1b2a6b';
      ctx.font = '700 56px "Comic Sans MS", "Chakra Petch", cursive';
      ctx.fillText('Q3 OKRs 🚀', 40, 80);
      ctx.font = '500 40px "Comic Sans MS", "Chakra Petch", cursive';
      const lines = ['1. Survive the apocalypse  ✔', '2. Pivot to bunkers  ✔', '3. Series B?? (no investors left)', '4. Teach SeedBot to charge itself', '5. ???', '6. PROFIT'];
      lines.forEach((l, i) => ctx.fillText(l, 50, 160 + i * 66));
      ctx.strokeStyle = '#c0281e';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(40, 300);
      ctx.lineTo(700, 290);
      ctx.stroke();
      ctx.fillStyle = '#c0281e';
      ctx.font = '700 44px "Comic Sans MS", cursive';
      ctx.fillText('vault code = default!! (CHANGE IT)', 300, 570);
      grime(ctx, w, h, 0.25, 12);
    });
    const wb = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.75), new THREE.MeshStandardNodeMaterial({ map: wbTex, roughness: 0.3 }));
    wb.position.set(3.35, 2.0, vaultZ + 0.21);
    this.group.add(wb);

    // "HUSTLE" neon on east wall
    const hustleTex = canvasTexture(1024, 256, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.font = 'italic 700 170px "Chakra Petch", Impact, sans-serif';
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#fff';
      ctx.strokeText('HUSTLE', w / 2, 190);
    });
    const hm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const htx = texture(hustleTex);
    mat2(hm, vec4(color('#ff3aa0').mul(htx.a).mul(3), htx.a));
    const hustle = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), hm);
    hustle.position.set(x1 - 0.2, 3.0, -1.6);
    hustle.rotation.y = -Math.PI / 2;
    this.group.add(hustle);

    // ping-pong table + bean bags (startup culture)
    const tableMat = plainStandard('#1d4a3a', 0.6);
    b.add(tableMat, box(1.5, 0.06, 2.7, 3.5, 0.76, -3.4));
    b.add(plainStandard('#ddd', 0.6), box(1.5, 0.15, 0.02, 3.5, 0.86, -3.4));
    b.add(metal, box(0.06, 0.74, 0.06, 2.9, 0.37, -2.3), box(0.06, 0.74, 0.06, 4.1, 0.37, -2.3), box(0.06, 0.74, 0.06, 2.9, 0.37, -4.5), box(0.06, 0.74, 0.06, 4.1, 0.37, -4.5));
    this.col(3.5, 0.4, -3.4, 0.75, 0.4, 1.35);
    const bean = fabric('#c2532f');
    const bg = new THREE.SphereGeometry(0.55, 14, 10);
    bg.scale(1, 0.6, 1);
    b.add(bean, place(bg.clone(), -2.5, 0.33, -1.5), place(bg.clone(), -1.3, 0.33, -1.0, 0, 1));

    // server rack with blinking LEDs (vault side)
    const rack = plainStandard('#202326', 0.4, 0.6);
    b.add(rack, box(0.8, 2.0, 0.9, x1 - 0.6, 1.0, -8.2));
    this.col(x1 - 0.6, 1.0, -8.2, 0.4, 1.0, 0.45);
    const leds = new THREE.MeshBasicNodeMaterial();
    const uLed = uniform(1);
    this.serverLeds = uLed as unknown as { value: number };
    const ledPattern = smoothstep(0.5, 0.9, sin(uv().x.mul(40).add(time.mul(9)).add(uv().y.mul(77)).mul(1.3)));
    mat2(leds, vec4(mix(vec3(0.1, 1, 0.4), vec3(0.2, 0.6, 1), uv().y).mul(ledPattern.mul(4)).mul(uLed), 1));
    const ledPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.6), leds);
    ledPanel.position.set(x1 - 1.02, 1.05, -8.2);
    ledPanel.rotation.y = -Math.PI / 2;
    this.group.add(ledPanel);

    // laser tripwires across the workshop: one additive mesh per beam holding a soft cylinder
    // (bright core + glow by view angle, shimmer and dust glints along it) and a red line of light
    // on the floor beneath it, so the beam reads in the room and switches off as one piece
    const emitterMat = plainStandard('#202326', 0.4, 0.6);
    const lens = this.pal.slot('#ff2010', 6);
    const laserDefs: [string, number, number][] = [['laser_low', -1.6, 0.32], ['laser_high', -4.6, 1.3]];
    const len = x1 - x0 - 0.6;
    const uLen = uniform(len);
    for (const [id, lz, ly] of laserDefs) {
      const u = uniform(7);
      const uLy = uniform(ly), uSeed = uniform(lz); // uniforms, not literals: both beams share a program
      const lm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      lm.colorNode = Fn(() => {
        const isFloor = step(1.5, uv().y);
        const along = uv().x.mul(uLen);
        const vdir = normalize(cameraPosition.sub(positionWorld));
        const facing = abs(dot(normalWorld, vdir));
        const shimmer = noise(vec2(along.mul(0.35).sub(time.mul(0.9)), time.mul(0.23))).r.mul(1.1).add(0.45);
        const glints = smoothstep(0.62, 0.8, noise(vec2(along.mul(1.7).add(time.mul(0.35)), time.mul(0.6).add(uSeed))).r);
        const core = smoothstep(0.9, 0.995, facing).mul(1.3).add(pow(facing, 10).mul(0.35));
        const halo = pow(facing, 2.5).mul(0.07).mul(shimmer).add(pow(facing, 6).mul(glints).mul(0.9));
        const beamC = vec3(1.0, 0.08, 0.04).mul(core.add(halo)).add(vec3(1.0, 0.75, 0.6).mul(core.mul(0.25)));
        const across = abs(uv().y.sub(2.5)).mul(2);
        const floorC = vec3(1.0, 0.05, 0.02).mul(pow(clamp(float(1).sub(across), 0, 1), 3).mul(float(0.08).div(uLy.mul(1.6).add(0.2)))).mul(shimmer.mul(0.5).add(0.5));
        const pulse = sin(time.mul(12)).mul(0.1).add(0.9);
        return mix(beamC, floorC, isFloor).mul(u).mul(pulse);
      })();
      lm.opacityNode = float(1);
      const lg = new THREE.CylinderGeometry(0.05, 0.05, len, 12, 1, true);
      lg.rotateZ(Math.PI / 2);
      // cylinder uv.x runs around the circumference; make it run along the beam instead
      const cu = lg.attributes.uv as THREE.BufferAttribute, cp = lg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < cu.count; i++) cu.setXY(i, cp.getX(i) / len + 0.5, 0.5);
      const fg = new THREE.PlaneGeometry(len, 1.1);
      const fu = fg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < fu.count; i++) fu.setXY(i, fu.getX(i), fu.getY(i) + 2);
      fg.rotateX(-Math.PI / 2);
      fg.translate(0, -ly + 0.112, 0);
      const laser = new THREE.Mesh(merge([lg, fg]), lm);
      laser.position.set(0, ly, lz);
      laser.renderOrder = 21;
      this.group.add(laser);
      // emitter housings with a lens, mounting plate and a cable drop
      for (const [ex, dir] of [[x0 + 0.36, 1], [x1 - 0.36, -1]] as const) {
        b.add(emitterMat, box(0.12, 0.14, 0.14, ex, ly, lz), box(0.03, 0.26, 0.22, ex - dir * 0.06, ly, lz));
        lens.add(b, cyl(0.03, 0.03, 0.02, ex + dir * 0.065, ly, lz, 10, 0, 0, Math.PI / 2));
        b.add(plainStandard('#1a1a1a', 0.6, 0.6), cyl(0.012, 0.012, 3.7 - ly - 0.1, ex - dir * 0.03, ly + (3.7 - ly) / 2 + 0.04, lz + 0.05, 4));
        this.halos.add(new THREE.Vector3(ex + dir * 0.09, ly, lz), '#ff2a14', 0.35, CH.LASER, 2.5);
      }
      this.lasers.push({ id, a: this.w(x0 + 0.3, ly, lz), b: this.w(x1 - 0.3, ly, lz), mesh: laser, intensity: u as unknown as { value: number } });
    }

    // the vault: loot crates, safe, shrine to the founder
    const crate = rustyMetal({ base: '#3d5a40', rust: 0.25, metalness: 0.5 });
    const crateGlow = glow('#ffb347', 3);
    const lootDefs: [string, number, number, number][] = [['crate_a', -5.5, -10.3, 0.2], ['crate_b', -3.2, -10.8, -0.1], ['safe', 4.8, -10.6, 0]];
    for (const [id, cx, cz, ry] of lootDefs) {
      const g = new THREE.Group();
      g.position.set(cx, 0, cz);
      g.rotation.y = ry;
      const lb = new MeshBatch();
      if (id === 'safe') {
        lb.add(rustyMetal({ base: '#2b2d30', rust: 0.15, metalness: 0.85, roughness: 0.35 }), box(1.1, 1.3, 0.9, 0, 0.65, 0));
        lb.add(rustyMetal({ base: '#d4b04a', rust: 0.1, metalness: 1, roughness: 0.25 }), cyl(0.16, 0.16, 0.06, 0.15, 0.75, 0.47, 16, Math.PI / 2));
      } else {
        lb.add(crate, box(1.4, 0.7, 0.9, 0, 0.35, 0));
        lb.add(crateGlow.material, box(1.42, 0.05, 0.92, 0, 0.55, 0));
      }
      g.add(lb.build(id));
      let lid: THREE.Object3D | undefined;
      if (id !== 'safe') {
        const lp = new THREE.Group();
        lp.position.set(0, 0.7, -0.45);
        const lidMesh = new THREE.Mesh(merge([box(1.44, 0.12, 0.94, 0, 0.06, 0.45)]), crate);
        lidMesh.castShadow = true;
        lp.add(lidMesh);
        g.add(lp);
        lid = lp;
      }
      this.group.add(g);
      this.col(cx, 0.5, cz, 0.7, 0.5, 0.5);
      this.lootSpots.push({ id, pos: this.w(cx, 0.8, cz + 0.9), mesh: g, lid });
    }
    // founder shrine: magazine cover + mannequin in hoodie + ring light
    const coverTex = canvasTexture(512, 700, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f2c14e');
      g.addColorStop(1, '#f78154');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#111';
      ctx.font = '900 110px "Big Shoulders Stencil Display", Impact, sans-serif';
      ctx.fillText('FORBES', 30, 120);
      ctx.font = '700 46px "Chakra Petch", Arial';
      ctx.fillText('30 UNDER 30', 34, 190);
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath();
      ctx.ellipse(w / 2, 420, 120, 150, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 36px "Chakra Petch", Arial';
      ctx.fillText('TANNER PIVOTSON:', 34, 620);
      ctx.font = '500 28px "Chakra Petch", Arial';
      ctx.fillText('"Disrupting Doomsday"', 34, 660);
      grime(ctx, w, h, 0.4, 2);
    });
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.95), new THREE.MeshStandardNodeMaterial({ map: coverTex, roughness: 0.4 }));
    cover.position.set(0.2, 2.0, z0 + 0.39);
    this.group.add(cover);
    b.add(wood('#3a2616'), box(0.82, 1.07, 0.04, 0.2, 2.0, z0 + 0.37));
    const ring = this.pal.slot('#ffffff', 5);
    ring.add(b, place(new THREE.TorusGeometry(0.35, 0.03, 8, 32), 1.6, 1.7, z0 + 0.9, 0, 0.4));
    b.add(metal, cyl(0.02, 0.02, 1.5, 1.6, 0.75, z0 + 0.9, 5));
    const hoodie = fabric('#20242a');
    const mx = -1.2, mz = z0 + 0.8;
    b.add(hoodie, place(new THREE.CapsuleGeometry(0.24, 0.45, 4, 12), mx, 1.2, mz), place(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), mx, 1.72, mz - 0.03));
    b.add(hoodie, place(new THREE.CapsuleGeometry(0.075, 0.5, 3, 8), mx - 0.3, 1.18, mz + 0.05), place(new THREE.CapsuleGeometry(0.075, 0.5, 3, 8), mx + 0.3, 1.18, mz + 0.05));
    b.add(plainStandard('#c9b8a0', 0.6), place(new THREE.SphereGeometry(0.15, 12, 10), mx, 1.7, mz + 0.02));
    b.add(plainStandard('#1a1a1a', 0.6, 0.6), box(0.22, 0.05, 0.02, mx, 1.72, mz + 0.16)); // sunglasses, obviously
    b.add(plainStandard('#202326', 0.4, 0.6), box(0.3, 0.12, 0.05, mx, 1.0, mz + 0.24)); // hoodie pocket
    b.add(plainStandard('#202326', 0.4, 0.6), cyl(0.25, 0.28, 0.05, mx, 0.03, mz, 16));
    // velvet rope in front of the shrine
    const brass = rustyMetal({ base: '#d4b04a', rust: 0.1, metalness: 1, roughness: 0.25 });
    for (const px of [-2.0, 2.3]) b.add(brass, cyl(0.025, 0.025, 0.9, px, 0.45, z0 + 1.7, 8), cyl(0.12, 0.14, 0.04, px, 0.02, z0 + 1.7, 12), place(new THREE.SphereGeometry(0.045, 10, 8), px, 0.92, z0 + 1.7));
    b.add(rustyMetal({ base: '#a3301f', rust: 0.45, metalness: 0.5, roughness: 0.5 }), wire(new THREE.Vector3(-2.0, 0.86, z0 + 1.7), new THREE.Vector3(2.3, 0.86, z0 + 1.7), 0.35, 0.025, 16));
    b.add(metal, cyl(0.03, 0.03, 0.8, -1.2, 0.4, z0 + 0.8, 5));
    this.col(-1.2, 0.9, z0 + 0.8, 0.3, 0.9, 0.3);

    // lights
    this.interiorLight = new THREE.PointLight(0xffb070, 14, 16, 1.6);
    this.interiorLight.position.copy(this.w(0, 3.6, -3.2));
    this.vaultLight = new THREE.PointLight(0xffc070, 10, 10, 1.8);
    this.vaultLight.position.copy(this.w(0, 3.4, -9.5));
    const tube = this.pal.slot('#ffe2b8', 5);
    this.tubeGlow = tube.intensity as unknown as { value: number };
    this.tubeColor = tube.color as unknown as { value: THREE.Color };
    dressWorkshop(this.D, HOUSE, tube);
    dressVault(this.D, HOUSE);
    // rotating red beacons: one in the workshop by the vault door, one in the Runway Room
    for (const [bx, bz] of [[-2.2, -5.6], [0, -8.2]] as const) {
      if (bz > -6) {
        b.add(plainStandard('#202326', 0.4, 0.6), cyl(0.12, 0.14, 0.08, bx, HOUSE.h - 0.17, bz, 12));
        this.halos.add(new THREE.Vector3(bx, HOUSE.h - 0.32, bz), '#ff2a1a', 1.6, CH.ALARM, 2.5);
      }
      const pivot = new THREE.Group();
      pivot.position.set(bx, HOUSE.h - 0.3, bz);
      const cone = lightCone(7, 1.8, '#ff2a14', 1.8);
      cone.mesh.rotation.z = Math.PI / 2 - 0.3;
      pivot.add(cone.mesh);
      pivot.visible = false;
      this.group.add(pivot);
      this.beacons.push(pivot);
    }
    this.points.interior = this.w(0, 1, -3);
    this.points.vaultCenter = this.w(0, 1, -9.5);
    void neon;
  }
}

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0) {
  g.rotateX(rx);
  g.rotateY(ry);
  g.translate(x, y, z);
  return norm(g);
}

function mat2(m: THREE.MeshBasicNodeMaterial, node: N) {
  m.colorNode = node.xyz ?? node;
  m.opacityNode = node.w ?? float(1);
}
