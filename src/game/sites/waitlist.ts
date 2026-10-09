import * as THREE from 'three/webgpu';
import type { GameContext } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { norm } from '../world/kit';
import { concrete, desertRock, fabric, glow, plainStandard, rustyMetal, wood } from '../world/materials';
import { rockGeometry } from '../world/Props';
import { VirtualLight } from '../world/lights';
import { GlowSprites } from '../world/effects';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import { Site } from './Site';
import { SiteKit, mat4, rng, uSiteFlicker, uSiteNight, v3, xf } from './jetKit';
import { Bucket, TAG_COUNT, artGlow, artMaterial, artQuad } from './placesArt';
import { SOLAR_FLAGS } from './solar';

/** Story flags (see Site.ts). `site.waitlist.done` = the service hatch is open and its log read. */
const F = {
  found: 'site.waitlist.found',
  done: 'site.waitlist.done',
  ticket: 'site.waitlist.ticket',
  log: 'site.waitlist.log',
  poster: 'site.waitlist.poster',
  concierge: 'site.waitlist.concierge',
  tent: 'site.waitlist.tent',
  cooler: 'site.waitlist.cooler',
  cart: 'site.waitlist.cart',
} as const;

const SERVICE_CODE = '0401';
/** Site-local layout: the headwall's face, the lanes, the final run. */
const WALL_Z = -40, LANE_X0 = -28, LANE_X1 = 0, LANES = [22, 19.6, 17.2, 14.8, 12.4], RUN_Z0 = 11, RUN_Z1 = -31;

/**
 * Waitlist City: EVERAFTER, "continuity residences, by appointment", a bunker set into the mountain
 * at the head of the north-east basin. The door never opened. The queue for it did: airport
 * stanchions switchbacking across the sand, then a long straight run to the door, and in every
 * spot a camp chair, a cooler, a tent, a number taped to it. Most of the line has gone. The LED
 * board over the door still says NOW SERVING 0001, and someone still keeps a fire going.
 *
 * Why go: the Priority Access service door has a keypad, the code is the grand-opening date on the
 * poster (the line monitor's log says as much), and behind it is the concierge pantry, still
 * stocked by drone with Kade water: somebody is inside, and four thousand people are not.
 *
 * Site-local: +z points down the valley (west), -z at the mountain (east); the headwall faces +z.
 * One SiteKit (static batch + proxy, thin batch, shared decals), the places atlas for print and the
 * LED board, a far stand-in, and at night the board, the string lights and the fire.
 */
export class WaitlistSite extends Site {
  private kit: SiteKit;
  private prints = new Bucket(artMaterial);
  private glows = new Bucket(artGlow);
  private near!: THREE.Object3D;
  private bulbs: { value: number };
  private coals: { value: number };
  private button: { value: number };
  private keyLed: { value: number };
  private boardLight: VirtualLight;
  private fireLight: VirtualLight;
  private stringLights: VirtualLight[] = [];
  private farHalo: GlowSprites;
  private hatch!: THREE.Group;
  private hatchOpen = 0;
  private lastState: unknown = null;
  private t = 0;
  private smokeT = 1;
  private firePos = new THREE.Vector3();

  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('waitlist', ctx, landmarks);
    this.kit = new SiteKit(this.frame, ctx.physics, ctx.hf);
    const root = new THREE.Group();
    root.name = 'waitlist-root';
    root.applyMatrix4(this.frame.m);
    this.group.add(root);

    const M = mats();
    const bulbs = glow('#ffc47a', 0);
    this.bulbs = bulbs.intensity as unknown as { value: number };
    const coals = glow('#ff6a1a', 2);
    this.coals = coals.intensity as unknown as { value: number };
    const button = glow('#7fd8ff', 2);
    this.button = button.intensity as unknown as { value: number };
    const keyLed = glow('#ff3020', 2);
    this.keyLed = keyLed.intensity as unknown as { value: number };

    this.buildHeadwall(M, button.material, keyLed.material);
    this.buildQueue(M);
    this.buildCamp(M, bulbs.material, coals.material);
    this.buildKiosk(M);

    // lights: the board's glow on the plaza, the fire, two of the string's bulbs
    this.boardLight = new VirtualLight('#ff5a2a', 0, 16, 2);
    this.boardLight.position.set(0, 4.6, WALL_Z + 6);
    this.boardLight.parent = root;
    this.fireLight = new VirtualLight('#ff8a3a', 0, 12, 2);
    this.fireLight.position.copy(this.firePos).setY(this.firePos.y + 1.2);
    this.fireLight.parent = root;
    for (const z of [-18, 2]) {
      const l = new VirtualLight('#ffc47a', 0, 11, 2);
      l.position.set(0, 3.0, z);
      l.parent = root;
      this.stringLights.push(l);
    }

    // the board's glow, readable down the valley; the fire's
    this.kit.halos.add(v3(0, 5.45, WALL_Z + 5.1), '#ff4a1a', 5.5, 1, 1.6);
    this.kit.halos.add(v3(this.firePos.x, this.firePos.y + 0.95, this.firePos.z), '#ff8a3a', 1.8, 3, 1.6);
    const { near, far } = this.kit.build(root, ctx.scene, 'waitlist');
    this.near = near;
    const prints = this.prints.build('waitlist-prints', true);
    prints.traverse((o) => { o.renderOrder = 2; });
    const glows = this.glows.build('waitlist-glows', false);
    glows.traverse((o) => { o.renderOrder = 3; });
    near.add(prints, glows, this.hatch);
    // from the valley at night: the board, and the fire
    this.farHalo = new GlowSprites(4);
    this.farHalo.add(v3(0, 5.45, WALL_Z + 5.2), '#ff4a1a', 7, 1, 2.5);
    this.farHalo.add(v3(this.firePos.x, this.firePos.y + 0.9, this.firePos.z), '#ff8a3a', 3, 2, 2);
    far.add(this.farHalo.build());
    this.lod(near, far, 34, 125);

    this.buildInteractables();
    this.landmarks.audioSpots.push({ kind: 'radio', pos: this.frame.p(3.6, 1.2, WALL_Z + 2.2) });
    this.landmarks.audioSpots.push({ kind: 'fire', pos: this.frame.p(this.firePos.x, 0.5, this.firePos.z) });
    this.landmarks.audioSpots.push({ kind: 'chimes', pos: this.frame.p(-9, 2, -6) });
  }

  // ================================================================ the door in the mountain
  private buildHeadwall(M: Mats, buttonMat: THREE.Material, keyMat: THREE.Material) {
    const k = this.kit;
    const Z = WALL_Z, D = 3; // face at Z, back at Z - D
    const g = (x: number, z: number) => k.ground(x, z);
    const base = Math.min(g(-10, Z), g(10, Z), g(0, Z)) - 0.6;
    const block = (x0: number, x1: number, y0: number, y1: number, mat: THREE.Material = M.wall) => {
      k.b.add(mat, xf(new THREE.BoxGeometry(x1 - x0, y1 - y0, D), mat4((x0 + x1) / 2, (y0 + y1) / 2, Z - D / 2)));
      k.col((x0 + x1) / 2, (y0 + y1) / 2, Z - D / 2, (x1 - x0) / 2, (y1 - y0) / 2, D / 2, 0);
    };
    // the wall around a 5 × 5 m door: left, right, lintel; a plinth step along the foot
    block(-16, -2.6, base, 15);
    block(2.6, 16, base, 15);
    block(-2.6, 2.6, 5.2, 15);
    k.b.add(M.wallDark, xf(new THREE.BoxGeometry(32.6, 0.6, 0.8), mat4(0, 15.1, Z - D / 2 + 1.1)));
    k.b.add(M.plinth, xf(new THREE.BoxGeometry(32, 0.25, 1.4), mat4(0, 0.12, Z + 0.7)));
    // pilasters, and the residents' gallery: a dark slit of glass along the top, for the view
    for (const x of [-14.5, -11, -7.5, 7.5, 11, 14.5]) k.b.add(M.wallDark, xf(new THREE.BoxGeometry(0.6, 15 - base, 0.5), mat4(x, (15 + base) / 2, Z + 0.25)));
    k.b.add(M.glass, xf(new THREE.BoxGeometry(26, 0.7, 0.2), mat4(0, 13.6, Z + 0.05)));
    // the door: a recessed steel slab with ribs and a gold medallion, and its frame
    const dz = Z - 1.3;
    k.b.add(M.door, xf(new THREE.BoxGeometry(5.2, 5.2, 0.4), mat4(0, 2.6, dz)));
    for (let i = 0; i < 6; i++) k.b.add(M.doorRib, xf(new THREE.BoxGeometry(4.9, 0.12, 0.08), mat4(0, 0.5 + i * 0.85, dz + 0.24)));
    k.b.add(M.gold, xf(new THREE.CylinderGeometry(0.75, 0.75, 0.1, 32).rotateX(Math.PI / 2), mat4(0, 2.9, dz + 0.3)));
    k.b.add(M.door, xf(new THREE.TorusGeometry(0.6, 0.05, 6, 32), mat4(0, 2.9, dz + 0.36)));
    for (const s of [-1, 1]) {
      k.b.add(M.wallDark, xf(new THREE.BoxGeometry(0.3, 5.3, 1.4), mat4(s * 2.75, 2.6, Z - 0.7)));
    }
    k.b.add(M.wallDark, xf(new THREE.BoxGeometry(5.8, 0.3, 1.4), mat4(0, 5.35, Z - 0.7)));
    k.col(0, 2.6, dz, 2.6, 2.6, 0.3, 0);
    // the portico: a cantilevered slab on two slim pillars, the LED board hung from its edge
    k.b.add(M.wall, xf(new THREE.BoxGeometry(9, 0.35, 5), mat4(0, 6.3, Z + 2.5)));
    for (const s of [-1, 1]) {
      k.b.add(M.gold, xf(new THREE.CylinderGeometry(0.14, 0.14, 6.1, 14), mat4(s * 4.0, 3.05, Z + 4.6)));
      k.col(s * 4.0, 3.05, Z + 4.6, 0.16, 3.05, 0.16, 0);
    }
    k.b.add(M.panel, xf(new THREE.BoxGeometry(3.4, 1.05, 0.12), mat4(0, 5.45, Z + 4.85)));
    this.glows.add(artQuad('wlServe', 3.2, 1.0, mat4(0, 5.45, Z + 4.915)));
    // the name, in relief on the wall above, and the sconces that wash it at night
    this.prints.add(artQuad('wlName', 17, 4.25, mat4(0, 10.6, Z + 0.02)));
    // the wing walls, stepping back into the slope
    for (const s of [-1, 1]) {
      const m = mat4(s * 19.2, 0, Z + 2.6, 0, s * 0.75, 0);
      const wg = new THREE.BoxGeometry(7.4, 9, 1.2).translate(0, 4.5 + base * 0.5, 0);
      k.b.add(M.wall, xf(wg, m));
      k.ocol(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 4.5 + base * 0.5, 0)), 3.7, 4.5, 0.6);
    }
    // the hill it is dug into: an earth berm from the top of the wall back into the mountain
    k.drift(0, -53.5, 76, 22, 0, (u, v) => {
      const x = (u - 0.5) * 76;
      const lateral = 1 - THREE.MathUtils.smoothstep(Math.abs(x), 15, 37) * 0.75;
      const back = THREE.MathUtils.smoothstep(v, 0.0, 0.85);
      const lump = Math.sin(u * 17.3) * Math.sin(v * 9.1) * 0.5;
      return Math.max(0, (15.6 * back + lump) * lateral);
    }, 1.0);
    // boulders seating it into the slope
    const r = rng(17);
    for (const [x, y, z, s] of [
      [-21.5, 5, -46, 6], [21.5, 5, -46, 6.5], [-25.5, 1.5, -37.5, 5], [25.5, 1.5, -37.5, 5.2],
      [-8, 14.5, -49, 4], [9, 14, -51, 4.5], [-29, 7, -50, 6], [29, 7, -51, 6.5], [0, 15.5, -55, 3.5],
    ] as [number, number, number, number][]) {
      k.b.add(M.rock, xf(rockGeometry(500 + x + y, 2), mat4(x, y, z, r(), r() * 6, r() * 0.3, s, s * 0.75, s)));
    }
    k.col(-25.5, 1.5, -37.5, 4, 2.5, 4, 0);
    k.col(25.5, 1.5, -37.5, 4.2, 2.5, 4.2, 0);
    // the red carpet, sun-bleached to salmon, sand blown over its edges
    k.b.add(M.carpet, xf(new THREE.PlaneGeometry(3.2, 9.5).rotateX(-Math.PI / 2), mat4(0, 0.03, Z + 5.4)));
    // planters with dead topiary either side of the carpet
    for (const s of [-1, 1]) {
      const px = s * 5.4, pz = Z + 5.5;
      k.b.add(M.wall, xf(new THREE.BoxGeometry(1.2, 0.8, 1.2), mat4(px, 0.4, pz)));
      k.b.add(M.soil, xf(new THREE.BoxGeometry(1.05, 0.05, 1.05), mat4(px, 0.79, pz)));
      k.b.add(M.deadwood, xf(new THREE.CylinderGeometry(0.04, 0.06, 1.3, 6), mat4(px, 1.4, pz)));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        k.b.add(M.deadwood, norm(new THREE.CylinderGeometry(0.008, 0.02, 0.55, 4).translate(0, 0.27, 0).rotateZ(0.9 + r() * 0.5).rotateY(a).translate(px, 1.95, pz)));
      }
      k.col(px, 0.4, pz, 0.6, 0.4, 0.6, 0);
    }
    // the concierge intercom: a brushed pillar with a speaker and a lit call button
    const ix = 3.6, iz = Z + 2.2;
    k.b.add(M.steel, xf(new THREE.BoxGeometry(0.34, 1.35, 0.22), mat4(ix, 0.68, iz)));
    k.b.add(M.panel, xf(new THREE.BoxGeometry(0.26, 0.3, 0.02), mat4(ix, 1.1, iz + 0.115)));
    k.b.add(buttonMat, xf(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 14).rotateX(Math.PI / 2), mat4(ix, 0.86, iz + 0.12)));
    k.col(ix, 0.68, iz, 0.17, 0.68, 0.11, 0);
    this.intercomAt = v3(ix, 1.0, iz + 0.3);

    // ---- Priority Access: a velvet-roped lane to a service door in the right-hand wall
    const sx = 7.2;
    k.b.add(M.wallDark, xf(new THREE.BoxGeometry(1.7, 2.6, 0.3), mat4(sx, 1.3, Z + 0.1)));
    this.prints.add(artQuad('wlPriority', 2.4, 0.68, mat4(sx, 3.05, Z + 0.02)));
    // the hatch: a steel door that swings open on its left hinge
    this.hatch = new THREE.Group();
    this.hatch.name = 'waitlist-hatch';
    this.hatch.position.set(sx - 0.62, 0, Z + 0.27);
    const hm = new MeshBatchLite();
    hm.add(M.door, new THREE.BoxGeometry(1.24, 2.2, 0.08).translate(0.62, 1.1, 0));
    hm.add(M.door, new THREE.BoxGeometry(0.06, 0.3, 0.06).translate(1.1, 1.05, 0.06));
    this.hatch.add(hm.build());
    this.hatchCol = k.col(sx, 1.1, Z + 0.27, 0.62, 1.1, 0.06, 0);
    // what's behind it: the pantry. Kade jugs on steel shelves, a drone drop chute
    k.b.add(M.wallDark, xf(new THREE.BoxGeometry(1.5, 2.5, 0.1), mat4(sx, 1.25, Z - 1.25)));
    for (const sy of [0.35, 1.05, 1.75]) {
      k.b.add(M.steel, xf(new THREE.BoxGeometry(1.3, 0.04, 0.8), mat4(sx, sy, Z - 0.75)));
      for (let i = 0; i < 3; i++) if (r() > 0.25) k.b.add(M.jug, xf(new THREE.CylinderGeometry(0.13, 0.14, 0.4, 10), mat4(sx - 0.4 + i * 0.4, sy + 0.22, Z - 0.8)));
    }
    for (const s of [-1, 1]) k.b.add(M.wallDark, xf(new THREE.BoxGeometry(0.1, 2.5, 1.4), mat4(sx + s * 0.75, 1.25, Z - 0.6)));
    // the keypad beside the door
    k.b.add(M.panel, xf(new THREE.BoxGeometry(0.18, 0.26, 0.05), mat4(sx + 1.05, 1.35, Z + 0.03)));
    k.b.add(keyMat, xf(new THREE.SphereGeometry(0.015, 8, 6), mat4(sx + 1.05, 1.45, Z + 0.06)));
    this.keypadAt = v3(sx + 1.05, 1.35, Z + 0.35);
    // brass posts and purple velvet
    for (let i = 0; i < 5; i++) {
      const z = Z + 1.6 + i * 1.6;
      for (const x of [sx - 0.9, sx + 0.9]) {
        k.b.add(M.gold, xf(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 8), mat4(x, 0.48, z)));
        k.b.add(M.gold, xf(new THREE.SphereGeometry(0.06, 10, 8), mat4(x, 0.97, z)));
        k.b.add(M.gold, xf(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 14), mat4(x, 0.02, z)));
        if (i < 4 && !(x > sx && i === 2)) k.b.add(M.velvet, rope(v3(x, 0.9, z), v3(x, 0.9, z + 1.6), 0.18, 0.025));
      }
    }
    k.b.add(M.velvet, rope(v3(sx + 0.9, 0.9, Z + 4.8), v3(sx + 1.3, 0.05, Z + 5.4), 0.05, 0.025)); // one rope down
  }
  private intercomAt = new THREE.Vector3();
  private keypadAt = new THREE.Vector3();
  private hatchCol!: ReturnType<SiteKit['col']>;

  // ================================================================ the queue
  private buildQueue(M: Mats) {
    const k = this.kit;
    const r = rng(23);
    const post = (x: number, z: number, fallen = false) => {
      const y = k.ground(x, z);
      if (fallen) {
        const a = r() * 6;
        k.b.add(M.post, xf(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 8).rotateZ(Math.PI / 2), mat4(x, y + 0.05, z, 0, a)));
        k.b.add(M.postBase, xf(new THREE.CylinderGeometry(0.17, 0.19, 0.04, 14).rotateZ(Math.PI / 2), mat4(x + Math.cos(a) * 0.48, y + 0.17, z - Math.sin(a) * 0.48, 0, a)));
        return null;
      }
      k.b.add(M.post, xf(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 8), mat4(x, y + 0.48, z)));
      k.b.add(M.postBase, xf(new THREE.CylinderGeometry(0.17, 0.19, 0.04, 14), mat4(x, y + 0.02, z)));
      k.b.add(M.post, xf(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 10), mat4(x, y + 0.96, z)));
      return v3(x, y + 0.93, z);
    };
    // a row of posts from a to b along x (fixed z) or z (fixed x), belts between, skipping gaps
    const row = (pts: [number, number][], gapAt: (x: number, z: number) => boolean) => {
      let prev: THREE.Vector3 | null = null;
      for (const [x, z] of pts) {
        if (gapAt(x, z)) { prev = null; continue; }
        const fallen = r() < 0.08;
        const p = post(x, z, fallen);
        if (p && prev && r() > 0.1) {
          const belt = r() < 0.12 ? v3(prev.x * 0.5 + p.x * 0.5, k.ground(p.x, p.z) + 0.03, prev.z * 0.5 + p.z * 0.5) : null;
          k.b.add(r() < 0.5 ? M.beltBlue : M.beltRed, belt ? beltStrip(prev, belt, 0.02) : beltStrip(prev, p, 0.05 + r() * 0.05));
        }
        prev = p;
      }
    };
    // switchback boundaries (between and around the five lanes)
    const bounds = [LANES[0] + 1.2, ...LANES.map((z) => z - 1.2)];
    bounds.forEach((bz, i) => {
      const pts: [number, number][] = [];
      for (let x = LANE_X0 - 1.2; x <= LANE_X1 + 1.25; x += 2.4) pts.push([x, bz]);
      row(pts, (x) => {
        if (i === 0 || i === bounds.length - 1) return i === bounds.length - 1 && x > -1.3 && x < 1.3; // the run starts here
        // lanes turn at alternate ends
        return i % 2 === 1 ? x > LANE_X1 - 1.3 : x < LANE_X0 + 1.3;
      });
    });
    // the end posts of the switchbacks
    for (const z of LANES) { post(LANE_X0 - 1.2, z); }
    // the final run, both sides, to the plaza
    for (const sx of [-1.2, 1.2]) {
      const pts: [number, number][] = [];
      for (let z = RUN_Z0 - 0.2; z >= RUN_Z1 + 0.5; z -= 2.4) pts.push([sx, z]);
      row(pts, () => false);
    }
    // the overhead banner across the run, between two poles
    for (const s of [-1, 1]) k.b.add(M.pole, xf(new THREE.CylinderGeometry(0.05, 0.06, 4.2, 8), mat4(s * 3.2, 2.1, -6)));
    this.prints.add(artQuad('wlOverhead', 5.6, 1.1, mat4(0, 3.5, -6, 0, 0, 0.02)));
    this.prints.add(artQuad('wlOverhead', 5.6, 1.1, mat4(0, 3.5, -6.02, 0, Math.PI, -0.02)));

    // ---- what people left in their spots, one every ~1.7 m along the line
    const spots: [number, number, number][] = []; // x, z, facing yaw (toward the front of the line)
    LANES.forEach((z, i) => {
      const dir = i % 2 === 0 ? 1 : -1; // +x on even lanes
      for (let x = LANE_X0 + 0.8; x <= LANE_X1 - 0.8; x += 1.7) spots.push([dir > 0 ? x : LANE_X0 + LANE_X1 - x, z, dir > 0 ? -Math.PI / 2 : Math.PI / 2]);
    });
    for (let z = RUN_Z0 - 1; z >= RUN_Z1 + 2.2; z -= 1.7) spots.push([0, z, 0]);
    // the front of the line, hand-placed below; fill the rest
    let tagIx = 0;
    spots.forEach(([x, z, yaw], i) => {
      const roll = r();
      const y = k.ground(x, z);
      const jx = x + (r() - 0.5) * 0.3, jz = z + (r() - 0.5) * 0.3, jy = yaw + (r() - 0.5) * 0.6;
      if (roll < 0.42) {
        chair(k, M, jx, y, jz, jy, r);
        if (r() < 0.35 && tagIx < 40) {
          // the number taped to the chair back
          const sub: [number, number, number, number] = [(tagIx % TAG_COUNT) / TAG_COUNT, 0, 1 / TAG_COUNT, 1];
          const back = v3(Math.sin(jy) * 0.2, 0.75, Math.cos(jy) * 0.2);
          this.prints.add(artQuad('wlTags', 0.26, 0.16, mat4(jx + back.x, y + back.y, jz + back.z, -0.15, jy), sub));
          tagIx++;
        }
      } else if (roll < 0.52) {
        stool(k, M, jx, y, jz, jy);
      } else if (roll < 0.62) {
        cooler(k, M, jx, y, jz, jy, r);
      } else if (roll < 0.7 && i % 7 !== 0) {
        tent(k, M, jx, y, jz, jy + Math.PI / 2, r, 2.0);
        k.col(jx, y + 0.6, jz, 0.9, 0.6, 0.9, jy);
      } else if (roll < 0.76) {
        bedroll(k, M, jx, y, jz, jy, r);
      } else if (roll < 0.8) {
        cart(k, M, jx, y, jz, jy + (r() - 0.5), r);
      } else if (roll < 0.86) {
        crate(k, M, jx, y, jz, jy, r);
      }
      // else: an empty spot. Someone left. Someone always leaves.
    });

    // ---- the front: #0001's recliner under a parasol, #0002's camp bed, the line monitor's chair and log
    const fz = RUN_Z1 + 0.6;
    const fy = k.ground(0, fz);
    k.b.add(M.recliner, xf(new THREE.BoxGeometry(0.85, 0.45, 0.9), mat4(0, fy + 0.25, fz)));
    k.b.add(M.recliner, xf(new THREE.BoxGeometry(0.85, 0.75, 0.25), mat4(0, fy + 0.75, fz + 0.5, -0.35)));
    for (const s of [-1, 1]) k.b.add(M.recliner, xf(new THREE.BoxGeometry(0.16, 0.25, 0.85), mat4(s * 0.5, fy + 0.6, fz + 0.05)));
    k.b.add(M.recliner, xf(new THREE.BoxGeometry(0.8, 0.12, 0.5), mat4(0, fy + 0.32, fz - 0.62, 0.35)));
    k.b.add(M.pole, xf(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 6), mat4(0.75, fy + 1.2, fz + 0.4)));
    k.b.add(M.parasol, xf(parasol(1.3), mat4(0.75, fy + 2.4, fz + 0.4, 0.12, 0, 0.1)));
    k.col(0, fy + 0.5, fz + 0.1, 0.5, 0.5, 0.6, 0);
    // #0003's chair: the line monitor, with the log on a crate beside it
    const mz = RUN_Z1 + 4.6;
    const my = k.ground(0, mz);
    chair(k, M, 0.1, my, mz, 0.15, r);
    crate(k, M, 0.95, my, mz - 0.2, 0.3, r);
    k.b.add(M.paper, xf(new THREE.BoxGeometry(0.24, 0.03, 0.32), mat4(0.95, my + 0.58, mz - 0.2, 0, 0.5)));
    k.b.add(M.clip, xf(new THREE.BoxGeometry(0.1, 0.02, 0.03), mat4(0.95, my + 0.6, mz - 0.33, 0, 0.5)));
    this.logAt = v3(0.95, my + 0.6, mz - 0.2);
    this.prints.add(artQuad('wlDay', 1.1, 0.82, mat4(-0.9, my + 0.9, mz - 0.2, -0.1, 0.35)));
    k.b.add(M.card, xf(new THREE.BoxGeometry(1.12, 0.84, 0.01), mat4(-0.9, my + 0.9, mz - 0.21, -0.1, 0.35)));
    k.b.add(M.pole, xf(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 5), mat4(-0.9, my + 0.4, mz - 0.25)));
    this.spot('front', 2.5, 0, RUN_Z1 + 6);
  }
  private logAt = new THREE.Vector3();

  // ================================================================ the camp around the line
  private buildCamp(M: Mats, bulbMat: THREE.Material, coalMat: THREE.Material) {
    const k = this.kit;
    const r = rng(61);
    // tents and lean-tos along both sides of the run: where people slept when the line didn't move
    const shelters: [number, number, number, 'tent' | 'tarp' | 'shack'][] = [
      [-5.5, -24, 0.2, 'shack'], [5.8, -21, -0.3, 'tent'], [-6.5, -15, 0.4, 'tarp'], [6.4, -12.5, 0.1, 'shack'],
      [-5.2, -7.5, -0.2, 'tent'], [7.2, -3.5, 0.5, 'tarp'], [-7.4, 1.5, 0.1, 'shack'], [5.4, 4.5, -0.4, 'tent'],
      [-13, -20, 0.8, 'tent'], [12.5, -17, -0.6, 'tarp'], [13.2, -6, 0.3, 'tent'], [-12.5, 6.5, 0.2, 'tarp'],
      [10.5, 8.5, 1.2, 'shack'], [-17, -10, 0.5, 'tent'], [17, -26, 0.9, 'tent'], [-20, 3, -0.3, 'shack'],
    ];
    for (const [x, z, yaw, kind] of shelters) {
      const y = k.ground(x, z);
      if (kind === 'tent') { tent(k, M, x, y, z, yaw, r, 2.6); k.col(x, y + 0.7, z, 1.2, 0.7, 1.2, yaw); }
      else if (kind === 'tarp') tarp(k, M, x, y, z, yaw, r);
      else { shack(k, M, x, y, z, yaw, r); k.col(x, y + 1.1, z, 1.3, 1.1, 1.1, yaw); }
    }
    this.tentAt = this.frame.p(5.8, 0.6, -19.6);
    // laundry lines between the shacks across the plaza's edge
    for (const [a, b] of [[[-5.5, -22.6], [-6.5, -15.8]], [[6.4, -11.2], [7.2, -4.5]], [[-5.2, -6.2], [-7.4, 0.2]]] as [number, number][][]) {
      const pa = v3(a[0], k.ground(a[0], a[1]) + 2.1, a[1]), pb = v3(b[0], k.ground(b[0], b[1]) + 2.0, b[1]);
      k.b.add(M.rope, rope(pa, pb, 0.35, 0.008));
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        const p = pa.clone().lerp(pb, t);
        p.y -= 0.35 * 4 * t * (1 - t);
        if (r() < 0.25) continue;
        const cloth = [M.clothA, M.clothB, M.clothC, M.clothD][Math.floor(r() * 4)];
        const yaw = Math.atan2(pb.x - pa.x, pb.z - pa.z) + Math.PI / 2;
        k.b.add(cloth, xf(new THREE.PlaneGeometry(0.5 + r() * 0.3, 0.6 + r() * 0.4, 1, 2).translate(0, -0.35, 0), mat4(p.x, p.y, p.z, (r() - 0.5) * 0.15, yaw)));
        k.b.add(cloth, xf(new THREE.PlaneGeometry(0.5, 0.6, 1, 2).translate(0, -0.35, 0), mat4(p.x, p.y, p.z, 0, yaw + Math.PI)));
      }
    }
    // the common: a barrel fire somebody still feeds, chairs round it, empty jugs, a dish aimed at nothing
    const cx = -11, cz = -4;
    const cy = k.ground(cx, cz);
    this.firePos.set(cx, cy, cz);
    k.b.add(M.barrel, xf(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 16, 1, true), mat4(cx, cy + 0.44, cz)));
    k.b.add(M.barrel, xf(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 16, 1, true).scale(-1, 1, 1), mat4(cx, cy + 0.44, cz)));
    for (const y of [0.15, 0.6]) k.b.add(M.barrelDark, xf(new THREE.TorusGeometry(0.305, 0.02, 4, 18).rotateX(Math.PI / 2), mat4(cx, cy + y, cz)));
    for (let i = 0; i < 5; i++) k.b.add(coalMat, xf(new THREE.DodecahedronGeometry(0.09 + r() * 0.05, 0), mat4(cx + (r() - 0.5) * 0.3, cy + 0.72 + r() * 0.06, cz + (r() - 0.5) * 0.3, r(), r(), r())));
    for (let i = 0; i < 4; i++) k.b.add(M.deadwood, xf(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 5).rotateZ(Math.PI / 2 - 0.4), mat4(cx + (r() - 0.5) * 0.2, cy + 0.85, cz + (r() - 0.5) * 0.2, 0, r() * 6)));
    k.col(cx, cy + 0.44, cz, 0.3, 0.44, 0.3, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const x = cx + Math.cos(a) * 1.9, z = cz + Math.sin(a) * 1.9;
      if (i === 3) stool(k, M, x, k.ground(x, z), z, Math.atan2(cx - x, cz - z) + Math.PI);
      else chair(k, M, x, k.ground(x, z), z, Math.atan2(cx - x, cz - z) + Math.PI, r);
    }
    for (let i = 0; i < 9; i++) {
      const x = cx - 3.2 + (i % 3) * 0.32, z = cz + 2.2 + Math.floor(i / 3) * 0.32;
      const fall = i === 7;
      k.b.add(M.jug, xf(new THREE.CylinderGeometry(0.13, 0.14, 0.42, 10), mat4(x, k.ground(x, z) + (fall ? 0.14 : 0.21), z, 0, 0, fall ? 1.5 : 0)));
    }
    // the dish, on a tripod, cable to a dead TV on a crate: the Everafter livestream, last seen day 300
    const dx = -15.5, dz = -6.5, dy = k.ground(dx, dz);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      k.b.add(M.pole, norm(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 5).applyMatrix4(alignY(v3(dx + Math.cos(a) * 0.6, dy, dz + Math.sin(a) * 0.6), v3(dx, dy + 1.4, dz)))));
    }
    k.b.add(M.dish, xf(new THREE.SphereGeometry(0.75, 18, 6, 0, Math.PI * 2, 0, 0.55).rotateX(-Math.PI / 2 + 0.7), mat4(dx, dy + 1.6, dz, 0, -2.4)));
    crate(k, M, dx + 1.6, dy, dz + 0.8, 0.4, r);
    k.b.add(M.tv, xf(new THREE.BoxGeometry(0.7, 0.45, 0.12), mat4(dx + 1.6, dy + 0.78, dz + 0.8, 0, 0.4 + Math.PI)));
    // the string of bulbs over the run, from pole to pole; solar, still charging, still on at dusk
    const poles: THREE.Vector3[] = [];
    for (let z = RUN_Z1 + 4; z <= RUN_Z0 + 1; z += 9) {
      const s = poles.length % 2 ? 1 : -1;
      const x = s * 2.6;
      const y = k.ground(x, z);
      k.b.add(M.pole, xf(new THREE.CylinderGeometry(0.04, 0.05, 3.4, 6), mat4(x, y + 1.7, z)));
      poles.push(v3(x, y + 3.3, z));
    }
    for (let i = 0; i + 1 < poles.length; i++) {
      const a = poles[i], b = poles[i + 1];
      k.b.add(M.rope, rope(a, b, 0.45, 0.006));
      for (let j = 1; j < 9; j++) {
        const t = j / 9;
        const p = a.clone().lerp(b, t);
        p.y -= 0.45 * 4 * t * (1 - t) + 0.08;
        if ((i * 9 + j) % 5 === 3) { k.b.add(M.bulbDead, xf(new THREE.SphereGeometry(0.04, 8, 6), mat4(p.x, p.y, p.z))); continue; }
        k.b.add(bulbMat, xf(new THREE.SphereGeometry(0.045, 8, 6), mat4(p.x, p.y, p.z)));
        if (j % 2 === 0) this.kit.halos.add(p.clone(), '#ffc47a', 0.5, 2, 1.5);
      }
    }
    // the scavengable bits: #0957's cooler, a cart of somebody's whole life
    cooler(k, M, 3.1, k.ground(3.1, -27.5), -27.5, 0.6, r);
    this.coolerAt = this.frame.p(3.1, 0.4, -27.5);
    cart(k, M, -8.6, k.ground(-8.6, 9.2), 9.2, 1.1, r);
    this.cartAt = this.frame.p(-8.6, 0.6, 9.2);
    // porta-potties at the back of the camp
    for (const [x, z, yaw] of [[16, 10, -0.6], [17.4, 11.4, -0.6]] as [number, number, number][]) {
      const y = k.ground(x, z);
      k.b.add(M.potty, xf(new THREE.BoxGeometry(1.1, 2.2, 1.1), mat4(x, y + 1.1, z, 0, yaw)));
      k.b.add(M.pottyRoof, xf(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 4, 1).rotateY(Math.PI / 4), mat4(x, y + 2.26, z, 0, yaw)));
      k.col(x, y + 1.1, z, 0.55, 1.1, 0.55, yaw);
    }
  }
  private tentAt = new THREE.Vector3();
  private coolerAt = new THREE.Vector3();
  private cartAt = new THREE.Vector3();

  // ================================================================ where the line starts
  private buildKiosk(M: Mats) {
    const k = this.kit;
    const kx = LANE_X0 - 2.6, kz = LANES[0] + 2.2;
    const y = k.ground(kx, kz);
    // the ticket dispenser on a brass post, red, with a curl of paper hanging out of it
    k.b.add(M.gold, xf(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 10), mat4(kx, y + 0.6, kz)));
    k.b.add(M.postBase, xf(new THREE.CylinderGeometry(0.22, 0.25, 0.05, 16), mat4(kx, y + 0.03, kz)));
    k.b.add(M.dispenser, xf(new THREE.CylinderGeometry(0.16, 0.13, 0.32, 16).rotateZ(Math.PI / 2), mat4(kx, y + 1.32, kz, 0, -0.4)));
    k.b.add(M.paper, xf(new THREE.PlaneGeometry(0.06, 0.25).translate(0, -0.12, 0), mat4(kx + 0.12, y + 1.28, kz - 0.1, 0.15, -0.4)));
    this.ticketAt = v3(kx, y + 1.2, kz);
    // the sign, and the poster on a board beside it
    for (const dx of [-0.8, 0.8]) k.b.add(M.post, xf(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 8), mat4(kx - 2.2 + dx, y + 1.1, kz + 0.4)));
    k.b.add(M.panel, xf(new THREE.BoxGeometry(1.86, 1.08, 0.04), mat4(kx - 2.2, y + 1.62, kz + 0.38)));
    this.prints.add(artQuad('wlStart', 1.82, 1.04, mat4(kx - 2.2, y + 1.62, kz + 0.405, 0, 0)));
    this.prints.add(artQuad('wlStart', 1.82, 1.04, mat4(kx - 2.2, y + 1.62, kz + 0.355, 0, Math.PI)));
    k.col(kx - 2.2, y + 1.1, kz + 0.4, 0.95, 1.1, 0.06, 0);
    const bx = kx + 1.6, bz = kz + 0.9;
    k.b.add(M.board, xf(new THREE.BoxGeometry(0.8, 1.2, 0.05), mat4(bx, y + 1.1, bz, -0.12, -0.5)));
    k.b.add(M.post, xf(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), mat4(bx, y + 0.45, bz - 0.15, 0.2, -0.5)));
    this.prints.add(artQuad('wlPoster', 0.72, 1.08, mat4(bx + Math.sin(-0.5) * 0.03, y + 1.1, bz + Math.cos(-0.5) * 0.03, -0.12, -0.5)));
    this.posterAt = v3(bx, y + 1.1, bz + 0.3);
    this.spot('start', kx - 1, 0, kz + 5);
    this.spot('approach', -30, 0, 34);
  }
  private ticketAt = new THREE.Vector3();
  private posterAt = new THREE.Vector3();

  // ================================================================ interactions
  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') { this.s.events.emit('toast', { text, kind }); }

  private loot(items: { id: string; qty: number }[]) {
    const got: string[] = [];
    for (const it of items) {
      const n = this.s.addItem(it.id, it.qty);
      if (n) got.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
    }
    return got.join(', ');
  }

  private buildInteractables() {
    const site = this;
    const W = (p: THREE.Vector3) => this.frame.p(p.x, p.y, p.z);
    this.interactables.push({
      id: 'waitlist.ticket', pos: W(this.ticketAt), radius: 1.6,
      primary: {
        get label() { return site.s?.has(F.ticket) ? 'Check your number' : 'Take a number'; },
        available: () => true,
        run: () => {
          if (this.s.set(F.ticket)) {
            this.s.addXP(10, 'Took a number');
            this.ctx.audio.play('click');
            this.toast('The dispenser grinds out a ticket: 4,013. Over the door, the board says NOW SERVING 0001. The ticket says you will be contacted.', 'info');
          } else {
            this.toast('Still 4,013. The board still says 0001. Nobody has contacted you.', 'info');
          }
        },
      },
    });
    this.interactables.push({
      id: 'waitlist.poster', pos: W(this.posterAt), radius: 1.6,
      primary: { label: 'Read the poster', available: () => true, run: () => this.readPoster() },
    });
    this.interactables.push({
      id: 'waitlist.log', pos: W(this.logAt), radius: 1.6,
      primary: {
        get label() { return site.s?.has(F.log) ? 'Read the line log again' : 'Read the line monitor\'s log'; },
        available: () => true,
        run: () => this.readLog(),
      },
    });
    this.interactables.push({
      id: 'waitlist.intercom', pos: W(this.intercomAt), radius: 1.6,
      primary: { label: 'Press the concierge button', available: () => true, run: () => this.concierge() },
    });
    this.interactables.push({
      id: 'waitlist.service', pos: W(this.keypadAt), radius: 1.5,
      visible: () => !this.s?.has(F.done),
      primary: {
        get label() { return site.dark ? 'Pull the service door open' : 'Enter the service code'; },
        available: () => true,
        run: () => (this.dark ? this.openService('No power, no maglock. The door swings out on its own weight.') : this.serviceKeypad()),
      },
      secondary: {
        label: 'Short the keypad',
        available: () => (this.s.skill('electronics') >= 2 ? true : 'Requires Electronics 2'),
        run: async () => {
          const ok = await this.ctx.ui.circuit({ title: 'EVERAFTER · SERVICE ENTRANCE', difficulty: 3 });
          if (ok) this.openService('The keypad blinks, apologises for the inconvenience, and lets you in.');
          else this.ctx.audio.play('deny');
        },
      },
    });
    this.interactables.push({
      id: 'waitlist.tent', pos: this.tentAt, radius: 2.0,
      visible: () => !this.s?.has(F.tent),
      primary: {
        label: 'Search #2,201\'s tent',
        available: () => true,
        run: () => {
          if (!this.s.set(F.tent)) return;
          const got = this.loot([{ id: 'water', qty: 1 }, { id: 'ration', qty: 1 }, { id: 'lockpick', qty: 1 }]);
          this.ctx.audio.play('pickup');
          this.toast(`A sleeping bag for two, one side never unzipped. A note: SAVING FOR MOM. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, '#2,201\'s tent');
        },
      },
    });
    this.interactables.push({
      id: 'waitlist.cooler', pos: this.coolerAt, radius: 1.6,
      visible: () => !this.s?.has(F.cooler),
      primary: {
        label: 'Open the cooler',
        available: () => true,
        run: () => {
          if (!this.s.set(F.cooler)) return;
          const got = this.loot([{ id: 'ration', qty: 1 }, { id: 'ammo38', qty: 6 }]);
          this.ctx.audio.play('pickup');
          this.toast(`No ice since year one. Tins, and a box of rounds wrapped in a sock, for whoever held the spot. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, 'Cooler');
        },
      },
    });
    this.interactables.push({
      id: 'waitlist.cart', pos: this.cartAt, radius: 1.8,
      visible: () => !this.s?.has(F.cart),
      primary: {
        label: 'Go through the shopping cart',
        available: () => true,
        run: () => {
          if (!this.s.set(F.cart)) return;
          const got = this.loot([{ id: 'scrap', qty: 2 }, { id: 'battery', qty: 1 }]);
          this.ctx.audio.play('pickup');
          this.toast(`A whole life, by weight: a lamp, a framed diploma, a toaster, a bag of cables. ${got}`, 'good');
          this.s.addXP(10, 'Shopping cart');
        },
      },
    });
  }

  private async readPoster() {
    if (this.s.set(F.poster)) this.s.addXP(10, 'Everafter poster');
    await this.ctx.ui.choose({
      speaker: 'Poster · Everafter',
      text: '"EVERAFTER. The rest of your life, catered. Climate-stable suites, a hydroponic omakase, and a wellness team trained for every outcome. GRAND OPENING 04·01. All members seated by appointment." Under it, in marker, dozens of hands: "WHICH YEAR". "STILL WAITING". "04·01 IS A JOKE DAY". "IT IS NOT A JOKE, IT IS A DATE — #0001".',
      choices: [{ id: 'ok', label: 'Leave it on the board' }],
    });
  }

  private async readLog() {
    const s = this.s;
    if (s.set(F.log)) s.addXP(25, 'The line log');
    s.set(F.found);
    await this.ctx.ui.choose({
      speaker: 'Line log · #0003, line monitor',
      text:
        'Day 1. Four thousand of us. Concierge says appointments open shortly. Day 40. #0001 is a lawyer. He says our tickets are a binding contract, so we wait. ' +
        'Day 300. The door opened ten centimetres for a delivery drone. Everyone stood up. Day 301. Everyone sat down. ' +
        'Day 900. Elected a line monitor. Me. Day 1,100. A drone lands at the service door every Thursday. Kade jugs. Somebody in there is drinking. ' +
        'Day 1,200. #0001 says the service code is the opening date off the poster. Says nobody has tried it because nobody reads posters. He won\'t try it either. He says it would be cutting. ' +
        'Day 1,283. The line moved. #0002 died. So technically, it moved.',
      choices: [{ id: 'ok', label: s.has(F.poster) ? 'Zero four zero one.' : 'Put the log back on the crate' }],
    });
  }

  /** Photon Park's breaker is thrown: Everafter is on its backup cell, and its locks fail open. */
  private get dark() { return !!this.ctx.state?.has(SOLAR_FLAGS.cut); }

  private async concierge() {
    const s = this.s;
    if (this.dark) {
      this.ctx.audio.play('click');
      this.ctx.ui.subtitle('EVERAFTER · Concierge', 'Everafter is experiencing a brief power interruption. Your patience is a core Everafter value.');
      return;
    }
    if (s.set(F.concierge)) s.addXP(10, 'Concierge');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => {
        const speaker = 'EVERAFTER · Concierge';
        if (id === 'hello') return {
          speaker,
          text: 'Welcome to Everafter! Your wellbeing is our priority. You are caller number one for a representative. Estimated wait: one thousand two hundred and eighty-four days.',
          choices: [
            { id: 'when', label: 'When does the door open?', next: 'when' },
            { id: 'who', label: 'Is anybody in there?', next: 'who' },
            { id: 'water', label: 'Who\'s drinking the Kade water?', next: 'water', disabled: s.has(F.log) ? undefined : 'You don\'t know about the water yet' },
            { id: 'bye', label: 'Hang up.' },
          ],
        };
        if (id === 'when') return {
          speaker,
          text: 'Our grand opening is the first of April! We look forward to seating you by appointment. Appointments are not currently available. Thank you for your patience. Patience is an Everafter core value.',
          choices: [{ id: 'back', label: 'Which April?', next: 'april' }, { id: 'bye', label: 'Hang up.' }],
        };
        if (id === 'april') return {
          speaker,
          text: 'The next one. It has always been the next one. Is there anything else I can help you with today?',
          choices: [{ id: 'back', label: 'Something else.', next: 'hello' }, { id: 'bye', label: 'Hang up.' }],
        };
        if (id === 'who') return {
          speaker,
          text: 'Resident privacy is our priority. Resident comfort is our priority. Resident everything is our priority. Would you like to hear about our hydroponic omakase?',
          choices: [{ id: 'back', label: 'Something else.', next: 'hello' }, { id: 'bye', label: 'Hang up.' }],
        };
        if (id === 'water') return {
          speaker,
          text: 'Everafter sources only the finest water from a trusted local partner. I am not able to share our partner\'s name, Kade Holdings, for confidentiality reasons. Please enjoy the view.',
          choices: [{ id: 'back', label: 'Something else.', next: 'hello' }, { id: 'bye', label: 'Hang up.' }],
        };
        return null;
      },
      onChoice: () => {},
    });
  }

  private async serviceKeypad() {
    const s = this.s;
    const knows = s.has(F.poster) || s.has(F.log);
    const res = await this.ctx.ui.keypad({
      title: 'EVERAFTER · SERVICE ENTRANCE',
      code: SERVICE_CODE,
      hint: knows ? 'The grand opening. Month, then day: the poster everybody stopped reading.' : 'Four digits. Platinum members know it. Somebody in the line might.',
    });
    if (res === 'ok') this.openService('The keypad chimes a little tune. "Welcome, Platinum Member." The door swings out.');
    else if (res === 'wrong') { this.ctx.audio.play('deny'); this.toast('EVERAFTER: "We\'re sorry, that code is not recognised. Your call is important to us."', 'bad'); }
  }

  private openService(line: string) {
    const s = this.s;
    if (!s.set(F.done)) return;
    s.set(F.found);
    this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
    const got = this.loot([{ id: 'water', qty: 3 }, { id: 'medkit', qty: 1 }, { id: 'ration', qty: 1 }, { id: 'battery', qty: 1 }]);
    s.addXP(XP_REWARDS.keypadShorted + 30, 'Priority Access');
    this.toast(`${line} Shelves of Kade jugs, a drop chute for the Thursday drone, and a delivery slip: "40 / wk · EVERAFTER (12 residents)". ${got}`, 'good');
  }

  // ================================================================ per frame
  update(dt: number, cam: THREE.Vector3) {
    super.update(dt, cam);
    this.t += dt;
    const s = this.ctx.state;
    if (s !== this.lastState) {
      this.lastState = s;
      this.hatchOpen = s?.has(F.done) ? 1.9 : 0;
    }
    const open = !!s?.has(F.done);
    const target = open ? 1.9 : 0;
    this.hatchOpen += (target - this.hatchOpen) * Math.min(1, dt * 3);
    this.hatch.rotation.y = -this.hatchOpen;
    this.hatchCol.setEnabled(this.hatchOpen < 0.4);
    const night = this.ctx.atmo.uNight.value as number;
    // the board ticks over every so often (to 0001 again: the joke is in the hardware); dark if Photon Park is cut
    const dark = this.dark;
    const glitch = dark ? 0 : Math.sin(this.t * 0.7) * Math.sin(this.t * 3.1) > 0.97 ? 0.15 : 1;
    this.boardLight.intensity = night * 14 * glitch;
    // the fire: low coals that breathe, somebody fed it today
    const fl = 0.75 + 0.15 * Math.sin(this.t * 7.3) + 0.1 * Math.sin(this.t * 13.1 + 1);
    this.coals.value = (1.5 + night * 3) * fl;
    this.fireLight.intensity = (0.3 + night * 2.6) * fl;
    // the string lights come on at dusk (solar), one or two dropping out
    const sl = THREE.MathUtils.smoothstep(night, 0.25, 0.6);
    this.bulbs.value = sl * 4;
    for (const l of this.stringLights) l.intensity = sl * 2.2;
    this.kit.halos.channels[2] = sl * 0.8;
    this.kit.halos.channels[1] = night * 0.9 * glitch;
    this.kit.halos.channels[3] = night * fl * 0.9;
    this.farHalo.channels[1] = (0.2 + night) * glitch;
    this.farHalo.channels[2] = night * fl * 0.8;
    this.button.value = dark ? 0 : 1 + Math.sin(this.t * 2) * 0.8 + night * 2;
    this.keyLed.value = open || dark ? 0 : 1 + night * 3;
    if (this.near.visible) {
      uSiteNight.value = night;
      uSiteFlicker.value = glitch;
    }
    // smoke from the barrel while anybody is close enough to see it
    const pl = this.ctx.player?.position;
    if (pl) {
      const d = Math.hypot(pl.x - this.frame.x, pl.z - this.frame.z);
      if (d < 90 && (this.smokeT -= dt) <= 0) {
        this.smokeT = 1.2 + Math.random() * 1.2;
        const w = this.frame.p(this.firePos.x, this.firePos.y + 1.0, this.firePos.z);
        this.ctx.puffs?.emit(w, 2, 0.12, 0.7, 0.45, undefined, true);
      }
      if (s && !s.has(F.found)) {
        const door = this.frame.p(0, 0, WALL_Z + 8);
        if (Math.hypot(pl.x - door.x, pl.z - door.z) < 12) {
          s.set(F.found);
          this.toast('NOW SERVING 0001. The line behind you goes back further than you walked.', 'info');
        }
      }
    }
  }
}

// ------------------------------------------------------------------ materials
type Mats = ReturnType<typeof mats>;
function mats() {
  return {
    wall: concrete('#b4ab9c', { scale: 1, stains: 0.7 }),
    wallDark: concrete('#7d766c', { scale: 1.2, stains: 0.5 }),
    glass: plainStandard('#1b2328', 0.12, 0.6),
    plinth: concrete('#8f877b'),
    door: rustyMetal({ base: '#4c5054', rust: 0.25, metalness: 0.75, roughness: 0.45 }),
    doorRib: rustyMetal({ base: '#2f3235', rust: 0.2, metalness: 0.8, roughness: 0.4 }),
    gold: rustyMetal({ base: '#b8924a', rust: 0.08, metalness: 0.9, roughness: 0.3 }),
    steel: rustyMetal({ base: '#a3a39d', rust: 0.15, metalness: 0.8, roughness: 0.35 }),
    panel: plainStandard('#101113', 0.4, 0.3),
    rock: desertRock(),
    carpet: fabric('#b0574e'),
    velvet: fabric('#4b1f4f'),
    soil: plainStandard('#3a2a1e', 0.95),
    deadwood: wood('#4a3a2a'),
    post: rustyMetal({ base: '#8d8f90', rust: 0.25, metalness: 0.85, roughness: 0.35 }),
    postBase: rustyMetal({ base: '#2b2c2e', rust: 0.3, metalness: 0.6, roughness: 0.5 }),
    beltBlue: plainStandard('#2a4a7a', 0.6),
    beltRed: plainStandard('#8a2a24', 0.6),
    chairA: fabric('#3d6a8a'), chairB: fabric('#8a3a2a'), chairC: fabric('#4a6a3a'), chairD: fabric('#7a6a3a'),
    frame: rustyMetal({ base: '#5e6063', rust: 0.35, metalness: 0.7, roughness: 0.5 }),
    coolerBody: plainStandard('#d9d4c4', 0.6), coolerLid: plainStandard('#2f5f8a', 0.55), coolerRed: plainStandard('#a8322a', 0.55),
    tentA: fabric('#c8642a'), tentB: fabric('#3b6a5a'), tentC: fabric('#d8c08a'), tentD: fabric('#5a5f8a'),
    tarp: fabric('#46617a'), tarpB: fabric('#8a7a3a'),
    shack: wood('#7a6448'), shackDark: wood('#4f4030'),
    tin: rustyMetal({ base: '#7a7468', rust: 0.7, metalness: 0.6, roughness: 0.6 }),
    bedroll: fabric('#5f6440'), bedrollB: fabric('#7a4a36'),
    cart: rustyMetal({ base: '#9a9c9e', rust: 0.45, metalness: 0.85, roughness: 0.4 }),
    crate: wood('#8a6a44'),
    recliner: plainStandard('#3a2a22', 0.6),
    parasol: fabric('#e9e3d4'),
    pole: rustyMetal({ base: '#6a6d70', rust: 0.4, metalness: 0.7, roughness: 0.5 }),
    paper: plainStandard('#e8e2d0', 0.9),
    clip: rustyMetal({ base: '#a3a39d', rust: 0.2, metalness: 0.8 }),
    card: plainStandard('#a67c52', 0.92),
    rope: plainStandard('#3a3530', 0.9),
    clothA: fabric('#c9c2b0'), clothB: fabric('#7a4a6a'), clothC: fabric('#3a5a7a'), clothD: fabric('#a8743a'),
    barrel: rustyMetal({ base: '#4a4440', rust: 0.8, metalness: 0.6, roughness: 0.6 }),
    barrelDark: rustyMetal({ base: '#2a2624', rust: 0.6, metalness: 0.6 }),
    jug: plainStandard('#5f8fa8', 0.25, 0.05),
    dish: rustyMetal({ base: '#c9c6bd', rust: 0.25, metalness: 0.5, roughness: 0.5 }),
    tv: plainStandard('#1a1a1c', 0.4, 0.2),
    bulbDead: plainStandard('#6a6458', 0.3, 0.1),
    potty: plainStandard('#3f7a9a', 0.6), pottyRoof: plainStandard('#d9d4c4', 0.6),
    board: wood('#6a5236'),
    dispenser: plainStandard('#a8322a', 0.45, 0.1),
  };
}

// ------------------------------------------------------------------ props (site-local, into the kit)
type R = () => number;
function chair(k: SiteKit, M: Mats, x: number, y: number, z: number, yaw: number, r: R) {
  const cloth = [M.chairA, M.chairB, M.chairC, M.chairD][Math.floor(r() * 4)];
  const m = mat4(x, y, z, 0, yaw);
  const P = (g: THREE.BufferGeometry) => xf(g, m);
  // camp chair: X legs, a sling seat, a sling back, armrests with a cup holder
  for (const s of [-1, 1]) {
    k.b.add(M.frame, P(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5).rotateX(0.7).translate(s * 0.26, 0.25, 0)));
    k.b.add(M.frame, P(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5).rotateX(-0.7).translate(s * 0.26, 0.25, 0)));
    k.b.add(M.frame, P(new THREE.BoxGeometry(0.05, 0.03, 0.42).translate(s * 0.28, 0.6, -0.02)));
  }
  k.b.add(cloth, P(new THREE.BoxGeometry(0.5, 0.03, 0.42).translate(0, 0.42, 0)));
  k.b.add(cloth, P(new THREE.BoxGeometry(0.5, 0.5, 0.03).rotateX(-0.2).translate(0, 0.68, 0.22)));
  if (r() < 0.25) k.b.add(M.jug, P(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8).translate(0.28, 0.66, -0.15)));
}
function stool(k: SiteKit, M: Mats, x: number, y: number, z: number, yaw: number) {
  const m = mat4(x, y, z, 0, yaw);
  for (const [a, b] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) k.b.add(M.frame, xf(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 5).rotateX(b * 0.2).rotateZ(a * 0.2).translate(a * 0.12, 0.22, b * 0.12), m));
  k.b.add(M.crate, xf(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 12).translate(0, 0.45, 0), m));
}
function cooler(k: SiteKit, M: Mats, x: number, y: number, z: number, yaw: number, r: R) {
  const m = mat4(x, y, z, 0, yaw);
  k.b.add(M.coolerBody, xf(new THREE.BoxGeometry(0.6, 0.36, 0.38).translate(0, 0.18, 0), m));
  k.b.add(r() < 0.5 ? M.coolerLid : M.coolerRed, xf(new THREE.BoxGeometry(0.62, 0.07, 0.4).translate(0, 0.39, 0), m));
}
function crate(k: SiteKit, M: Mats, x: number, y: number, z: number, yaw: number, r: R) {
  const s = 0.5 + r() * 0.15;
  k.b.add(M.crate, xf(new THREE.BoxGeometry(s, s, s).translate(0, s / 2, 0), mat4(x, y, z, 0, yaw)));
}
function bedroll(k: SiteKit, M: Mats, x: number, y: number, z: number, yaw: number, r: R) {
  const m = mat4(x, y, z, 0, yaw);
  k.b.add(r() < 0.5 ? M.bedroll : M.bedrollB, xf(new THREE.BoxGeometry(0.7, 0.06, 1.8).translate(0, 0.03, 0), m));
  k.b.add(M.paper, xf(new THREE.BoxGeometry(0.45, 0.1, 0.3).translate(0, 0.1, -0.7), m));
}
function cart(k: SiteKit, M: Mats, x: number, y: number, z: number, yaw: number, r: R) {
  const m = mat4(x, y, z, 0, yaw);
  const P = (g: THREE.BufferGeometry) => xf(g, m);
  // a wire basket (bars), a handle, four wheels; somebody's things heaped in it
  for (let i = 0; i <= 6; i++) {
    k.b.add(M.cart, P(new THREE.BoxGeometry(0.012, 0.42, 0.012).translate(-0.28, 0.72, -0.4 + i * 0.13)));
    k.b.add(M.cart, P(new THREE.BoxGeometry(0.012, 0.42, 0.012).translate(0.28, 0.72, -0.4 + i * 0.13)));
  }
  for (const yy of [0.52, 0.92]) for (const s of [-1, 1]) k.b.add(M.cart, P(new THREE.BoxGeometry(0.012, 0.012, 0.8).translate(s * 0.28, yy, 0)));
  for (const zz of [-0.4, 0.4]) for (const yy of [0.52, 0.92]) k.b.add(M.cart, P(new THREE.BoxGeometry(0.56, 0.012, 0.012).translate(0, yy, zz)));
  k.b.add(M.cart, P(new THREE.BoxGeometry(0.56, 0.02, 0.8).translate(0, 0.52, 0)));
  k.b.add(M.cart, P(new THREE.CylinderGeometry(0.018, 0.018, 0.6, 6).rotateZ(Math.PI / 2).translate(0, 1.0, 0.52)));
  for (const s of [-1, 1]) for (const zz of [-0.35, 0.35]) {
    k.b.add(M.frame, P(new THREE.BoxGeometry(0.012, 0.42, 0.012).translate(s * 0.25, 0.3, zz)));
    k.b.add(M.postBase, P(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10).rotateZ(Math.PI / 2).translate(s * 0.25, 0.05, zz)));
  }
  for (let i = 0; i < 5; i++) k.b.add([M.tentC, M.bedrollB, M.crate, M.coolerLid, M.clothB][i], P(new THREE.BoxGeometry(0.2 + r() * 0.15, 0.18 + r() * 0.15, 0.2 + r() * 0.2).translate((r() - 0.5) * 0.3, 0.68 + r() * 0.2, (r() - 0.5) * 0.5)));
  k.col(x, y + 0.5, z, 0.32, 0.5, 0.48, yaw);
}
function tent(k: SiteKit, M: Mats, x: number, y: number, z: number, yaw: number, r: R, size: number) {
  const cloth = [M.tentA, M.tentB, M.tentC, M.tentD][Math.floor(r() * 4)];
  const m = mat4(x, y, z, 0, yaw);
  if (r() < 0.5) {
    // a dome: a squashed half sphere with a sag between the poles
    const g = new THREE.SphereGeometry(size * 0.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), pz = p.getZ(i);
      const a = Math.atan2(pz, px);
      const sag = 1 - 0.08 * Math.abs(Math.sin(a * 2));
      p.setXYZ(i, px * sag, p.getY(i) * 0.62 * sag, pz * sag * 0.9);
    }
    g.computeVertexNormals();
    k.b.add(cloth, xf(g, m));
    k.b.add(M.panel, xf(new THREE.CircleGeometry(size * 0.18, 10, 0, Math.PI).translate(0, 0.02, 0).rotateY(0), mat4(x, y, z, 0, yaw).multiply(new THREE.Matrix4().makeTranslation(0, 0, size * 0.45))));
  } else {
    // a ridge tent: two sloped panels, a dark doorway triangle at the front
    const L = size, Wd = size * 0.8, H = size * 0.55;
    for (const s of [-1, 1]) {
      const pg = new THREE.PlaneGeometry(L, Math.hypot(Wd / 2, H)).rotateX(-Math.PI / 2).rotateZ(s * (Math.PI / 2 - Math.atan2(H, Wd / 2)) * -1);
      k.b.add(cloth, xf(pg.translate(0, 0, 0), mat4(x, y, z, 0, yaw).multiply(new THREE.Matrix4().makeTranslation(0, H / 2, 0)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(0, 0, s * Wd / 4))));
    }
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-Wd / 2, 0, 0, Wd / 2, 0, 0, 0, H, 0, Wd / 2, 0, 0, -Wd / 2, 0, 0, 0, H, 0], 3));
    tri.computeVertexNormals();
    k.b.add(M.panel, xf(tri.clone(), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, L / 2))));
    k.b.add(cloth, xf(tri, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -L / 2))));
  }
}
function tarp(k: SiteKit, M: Mats, x: number, y: number, z: number, yaw: number, r: R) {
  const g = new THREE.PlaneGeometry(3, 2.6, 10, 8);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i);
    const kk = (py + 1.3) / 2.6;
    const sag = Math.sin((px / 3 + 0.5) * Math.PI) * Math.sin(kk * Math.PI) * 0.15;
    p.setXYZ(i, px, 0.3 + kk * 1.7 - sag, -1.2 + kk * 2.0);
  }
  g.computeVertexNormals();
  const cloth = r() < 0.5 ? M.tarp : M.tarpB;
  const m = mat4(x, y, z, 0, yaw);
  k.b.add(cloth, xf(g, m));
  k.b.add(cloth, xf(flipped(g), m));
  for (const s of [-1, 1]) k.b.add(M.pole, xf(new THREE.CylinderGeometry(0.03, 0.03, 2.0, 6).translate(s * 1.45, 1.0, 0.8), m));
  k.b.add(r() < 0.5 ? M.bedroll : M.bedrollB, xf(new THREE.BoxGeometry(0.8, 0.06, 1.9).translate(0, 0.03, 0).rotateY(Math.PI / 2), m));
  cooler(k, M, x, y, z, yaw + 0.3, r);
}
function shack(k: SiteKit, M: Mats, x: number, y: number, z: number, yaw: number, r: R) {
  const m = mat4(x, y, z, 0, yaw);
  const P = (g: THREE.BufferGeometry) => xf(g, m);
  // pallet walls, a tin roof sloping back, a blanket for a door
  const Wd = 2.6, D = 2.2, H = 2.1;
  k.b.add(M.shack, P(new THREE.BoxGeometry(Wd, H, 0.08).translate(0, H / 2, -D / 2)));
  for (const s of [-1, 1]) k.b.add(r() < 0.5 ? M.shack : M.shackDark, P(new THREE.BoxGeometry(0.08, H, D).translate(s * Wd / 2, H / 2, 0)));
  k.b.add(M.shackDark, P(new THREE.BoxGeometry(Wd * 0.3, H, 0.08).translate(-Wd * 0.35, H / 2, D / 2)));
  k.b.add(M.shack, P(new THREE.BoxGeometry(Wd * 0.3, H, 0.08).translate(Wd * 0.35, H / 2, D / 2)));
  for (let i = 0; i < 6; i++) k.b.add(M.shackDark, P(new THREE.BoxGeometry(Wd + 0.04, 0.05, 0.1).translate(0, 0.3 + i * 0.32, -D / 2 - 0.05)));
  k.b.add(M.tin, P(new THREE.BoxGeometry(Wd + 0.5, 0.04, D + 0.6).rotateX(0.12).translate(0, H + 0.12, 0)));
  k.b.add(M.clothB, P(new THREE.PlaneGeometry(Wd * 0.4, H * 0.9, 1, 3).translate(0, H * 0.45, D / 2 + 0.02)));
  k.b.add(M.crate, P(new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(Wd / 2 + 0.4, 0.25, D / 2 - 0.2)));
}

/** A rope or belt sagging between two points, as a thin tube. */
function rope(a: THREE.Vector3, b: THREE.Vector3, sag: number, rad: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(a.clone().lerp(b, t).add(v3(0, -sag * 4 * t * (1 - t), 0)));
  }
  return norm(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, rad, 4));
}

/** A retractable queue belt between two post tops: a flat ribbon, both faces. */
function beltStrip(a: THREE.Vector3, b: THREE.Vector3, sag: number) {
  const n = 6, h = 0.05;
  const pos: number[] = [];
  const P: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; P.push(a.clone().lerp(b, t).add(v3(0, -sag * 4 * t * (1 - t), 0))); }
  for (let i = 0; i < n; i++) {
    const p = P[i], q = P[i + 1];
    pos.push(p.x, p.y + h / 2, p.z, p.x, p.y - h / 2, p.z, q.x, q.y + h / 2, q.z, q.x, q.y + h / 2, q.z, p.x, p.y - h / 2, p.z, q.x, q.y - h / 2, q.z);
    pos.push(p.x, p.y + h / 2, p.z, q.x, q.y + h / 2, q.z, p.x, p.y - h / 2, p.z, q.x, q.y + h / 2, q.z, q.x, q.y - h / 2, q.z, p.x, p.y - h / 2, p.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return norm(g);
}

/** A beach parasol canopy: an eight-panel cone, pointing up. */
function parasol(rad: number) {
  const g = new THREE.ConeGeometry(rad, 0.4, 8, 1, true);
  const back = new THREE.ConeGeometry(rad * 0.99, 0.39, 8, 1, true);
  return norm(mergeTwo(g, flipped(back)));
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const A = norm(a), B = norm(b);
  const g = new THREE.BufferGeometry();
  for (const key of ['position', 'normal', 'uv']) {
    const x = A.attributes[key] as THREE.BufferAttribute, y = B.attributes[key] as THREE.BufferAttribute;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0);
    arr.set(y.array as Float32Array, x.array.length);
    g.setAttribute(key, new THREE.BufferAttribute(arr, x.itemSize));
  }
  return g;
}

/** The same surface facing the other way (reversed winding, recomputed normals). */
function flipped(src: THREE.BufferGeometry) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

function alignY(a: THREE.Vector3, b: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), b.clone().sub(a).normalize());
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, v3(1, 1, 1));
}

/** A tiny per-material batch for one moving part (the service hatch). */
class MeshBatchLite {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(m: THREE.Material, g: THREE.BufferGeometry) {
    let a = this.parts.get(m);
    if (!a) this.parts.set(m, (a = []));
    a.push(norm(g));
  }
  build() {
    const g = new THREE.Group();
    for (const [m, list] of this.parts) {
      const mesh = new THREE.Mesh(merge2(list), m);
      mesh.castShadow = false; // a small door in the portico's shade: not worth a shadow draw
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }
}
function merge2(list: THREE.BufferGeometry[]) {
  let acc = list[0];
  for (let i = 1; i < list.length; i++) acc = mergeTwo(acc, list[i]);
  acc.computeBoundingSphere();
  return acc;
}
