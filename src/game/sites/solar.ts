import * as THREE from 'three/webgpu';
import type { GameContext } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { norm } from '../world/kit';
import { chainLink, corrugated, glow, plainStandard, rustyMetal, wood } from '../world/materials';
import { VirtualLight } from '../world/lights';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import { Site } from './Site';
import { SiteKit, mat4, rng, uSiteFlicker, uSiteNight, v3, xf } from './jetKit';
import { Bucket, artGlow, artMaterial, artQuad } from './placesArt';

/**
 * Story flags (see Site.ts). `site.solar.cut` is live state: while it's set, Everafter (waitlist.ts)
 * has no power: its board is dark and the service door's maglock lets go.
 */
export const SOLAR_FLAGS = {
  found: 'site.solar.found',
  done: 'site.solar.done',
  log: 'site.solar.log',
  cut: 'site.solar.cut',
  cabinet: 'site.solar.cabinet',
  bot: 'site.solar.bot',
} as const;
const F = SOLAR_FLAGS;

/** Panel rows (site-local z of each row's centre line), their span along x, the robots' rows. */
const ROWS = [-15, -10, -5, 0, 5, 10, 15];
const X0 = -26, X1 = 26, MOD = 1.04, DEPTH = 2.9, TILT = -0.44, ROW_Y = 1.35;
const BOT_ROWS = [0, 2, 3, 6];
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Photon Park: seven rows of panels in the north-west basin, "powering Everafter" over a buried
 * line across the whole map. Nobody has paid the bill or read the meter since the Pivot. The SHINE
 * cleaning robots never got the memo: four of them still crawl their rows, brushing sand off glass
 * that powers a bunker nobody is allowed into. The fifth is dead by the hut.
 *
 * Why go: the hut's breaker cuts Everafter's power (its board goes dark and the service door's
 * maglock lets go, a second way into the pantry at Waitlist City), the fleet log, a locked spares
 * cabinet, a dead robot to strip.
 *
 * Static set through one SiteKit (+ shadow proxy), the places atlas for the sign and the screen, a
 * far stand-in. The robots are three InstancedMeshes (body, brush, lamp: three draws for four
 * robots), written only while the near set is shown.
 */
export class SolarSite extends Site {
  private kit: SiteKit;
  private prints = new Bucket(artMaterial);
  private glows = new Bucket(artGlow);
  private near!: THREE.Object3D;
  private bots: { body: THREE.InstancedMesh; brush: THREE.InstancedMesh; lamp: THREE.InstancedMesh };
  private lampK: { value: number };
  private hutLampK: { value: number };
  private screenLight: VirtualLight;
  private doorLight: VirtualLight;
  private t = 0;
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _e = new THREE.Euler();
  private readonly _p = new THREE.Vector3();
  private readonly _s = new THREE.Vector3(1, 1, 1);
  private readonly _q2 = new THREE.Quaternion();
  private readonly _q3 = new THREE.Quaternion();

  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('solar', ctx, landmarks);
    this.kit = new SiteKit(this.frame, ctx.physics, ctx.hf);
    const root = new THREE.Group();
    root.name = 'solar-root';
    root.applyMatrix4(this.frame.m);
    this.group.add(root);
    const M = mats();
    const lamp = glow('#9fe0ff', 3);
    this.lampK = lamp.intensity as unknown as { value: number };
    const hutLamp = glow('#ffb35c', 0);
    this.hutLampK = hutLamp.intensity as unknown as { value: number };

    this.buildRows(M);
    this.buildHut(M, hutLamp.material);
    this.buildFence(M);
    this.buildCable(M);
    this.bots = this.buildBots(M, lamp.material);

    this.screenLight = new VirtualLight('#7fd8ff', 0, 5, 2);
    this.screenLight.position.set(33.2, 1.6, 1.2);
    this.screenLight.parent = root;
    this.doorLight = new VirtualLight('#ffb35c', 0, 12, 2);
    this.doorLight.position.set(31, 2.9, 2.6);
    this.doorLight.parent = root;
    this.kit.halos.add(v3(31, 2.75, 2.25), '#ffb35c', 0.8, 1, 1.6);

    const { near, far } = this.kit.build(root, ctx.scene, 'solar');
    this.near = near;
    // the drifts behind the rows are ankle-deep: not worth a shadow draw
    const sand = near.getObjectByName('solar-sand');
    if (sand) sand.castShadow = false;
    const prints = this.prints.build('solar-prints', true);
    prints.traverse((o) => { o.renderOrder = 2; });
    const glows = this.glows.build('solar-glows', false);
    glows.traverse((o) => { o.renderOrder = 3; });
    near.add(prints, glows, this.bots.body, this.bots.brush, this.bots.lamp, this.breaker);
    this.lod(near, far, 34, 110);

    this.buildInteractables();
    this.landmarks.audioSpots.push({ kind: 'hum', pos: this.frame.p(32, 1.2, -1) });
  }

  // ================================================================ the array
  private buildRows(M: Mats) {
    const k = this.kit;
    const r = rng(29);
    // a module's corners in row space: x along the row, the face tilted up toward the back (+z)
    const tilt = new THREE.Matrix4().makeRotationX(TILT);
    ROWS.forEach((rz, ri) => {
      const collapsed = ri === 5; // its east half folded into the sand
      // posts every 4 m: a short one at the front, a tall one at the back, a rail along each
      for (let x = X0 + 1; x <= X1 - 1; x += 4) {
        if (collapsed && x > 8) continue;
        for (const [dz, h] of [[-1.1, ROW_Y - 0.55], [1.1, ROW_Y + 0.5]] as [number, number][]) {
          const y = k.ground(x, rz + dz);
          k.b.add(M.post, xf(new THREE.BoxGeometry(0.08, h - y + 0.3, 0.08), mat4(x, y + (h - y) / 2 - 0.15, rz + dz)));
        }
        k.b.add(M.rail, xf(new THREE.BoxGeometry(0.06, 0.06, 2.6).applyMatrix4(tilt), mat4(x, ROW_Y - 0.05, rz)));
      }
      const end = collapsed ? 8.5 : X1;
      for (const dz of [-0.9, 0.9]) {
        const y = ROW_Y + Math.tan(-TILT) * dz - 0.08;
        k.b.add(M.rail, xf(new THREE.BoxGeometry(end - X0, 0.05, 0.05), mat4((X0 + end) / 2, y, rz + dz)));
      }
      // the modules: dark cells with a bright frame; a few shattered, a few gone
      const cells = Math.floor((X1 - X0) / MOD);
      for (let i = 0; i < cells; i++) {
        const x = X0 + (i + 0.5) * MOD;
        const roll = r();
        if (roll < 0.035) continue; // stolen
        if (collapsed && x > 8.5) {
          // the folded half: modules slumped forward onto the sand, still in a line
          const yy = k.ground(x, rz - 0.8) + 0.45 + Math.sin(i * 1.7) * 0.08;
          const m = mat4(x, yy, rz - 0.8, -0.9 + (r() - 0.5) * 0.2, (r() - 0.5) * 0.08, (r() - 0.5) * 0.12);
          k.b.add(r() < 0.2 ? M.cracked : M.cell, xf(new THREE.BoxGeometry(MOD - 0.04, 0.04, DEPTH), m));
          k.b.add(M.frame, xf(new THREE.BoxGeometry(MOD, 0.03, DEPTH + 0.04).scale(1, 1, 1), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.025, 0))));
          continue;
        }
        const m = mat4(x, ROW_Y, rz).multiply(tilt);
        const mat = roll < 0.09 ? M.cracked : M.cell;
        k.b.add(mat, xf(new THREE.BoxGeometry(MOD - 0.05, 0.035, DEPTH), m.clone()));
        k.b.add(M.frame, xf(new THREE.BoxGeometry(MOD, 0.03, DEPTH + 0.05), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.02, 0))));
        // the busbar line across the middle of each module
        k.b.add(M.frame, xf(new THREE.BoxGeometry(MOD - 0.06, 0.005, 0.03), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.02, 0))));
      }
      // the row as one long box at panel height: you walk the aisles between rows, round the ends
      this.kit.col((X0 + end) / 2, ROW_Y - 0.2, rz, (end - X0) / 2, 0.55, 1.2, 0);
      // sand banked against the back of the row, deeper toward the east
      k.drift((X0 + X1) / 2, rz + 2.1, X1 - X0, 1.8, 0, (u, v) => Math.max(0, Math.sin(v * Math.PI) * (0.15 + u * 0.45) * (0.7 + 0.3 * Math.sin(u * 23 + ri)) - 0.04), 0.9, false);
    });
  }

  // ================================================================ the inverter hut and the dock
  private buildHut(M: Mats, lampMat: THREE.Material) {
    const k = this.kit;
    const hx = 33, hz = -1, L = 6, Wd = 2.44, H = 2.6;
    const y = k.ground(hx, hz);
    // a shipping container on sleepers: corrugated walls, a roof, doors at the south end
    k.b.add(M.sleeper, xf(new THREE.BoxGeometry(2.8, 0.2, 0.3), mat4(hx, y + 0.1, hz - 2.2)));
    k.b.add(M.sleeper, xf(new THREE.BoxGeometry(2.8, 0.2, 0.3), mat4(hx, y + 0.1, hz + 2.2)));
    const cy = y + 0.2 + H / 2;
    k.b.add(M.box, xf(new THREE.BoxGeometry(0.06, H, L), mat4(hx - Wd / 2, cy, hz)));
    k.b.add(M.box, xf(new THREE.BoxGeometry(0.06, H, L), mat4(hx + Wd / 2, cy, hz)));
    k.b.add(M.boxEnd, xf(new THREE.BoxGeometry(Wd, H, 0.06), mat4(hx, cy, hz - L / 2)));
    k.b.add(M.boxRoof, xf(new THREE.BoxGeometry(Wd + 0.06, 0.08, L + 0.06), mat4(hx, cy + H / 2, hz)));
    k.b.add(M.boxRoof, xf(new THREE.BoxGeometry(Wd, 0.06, L), mat4(hx, y + 0.23, hz)));
    // the doors: one shut, one swung wide on the south end
    k.b.add(M.boxEnd, xf(new THREE.BoxGeometry(Wd / 2, H, 0.06), mat4(hx + Wd / 4, cy, hz + L / 2)));
    k.b.add(M.boxEnd, xf(new THREE.BoxGeometry(Wd / 2, H, 0.06).translate(Wd / 4, 0, 0), mat4(hx - Wd / 2, cy, hz + L / 2 + 0.03, 0, -1.9)));
    k.col(hx - Wd / 2, cy, hz, 0.06, H / 2, L / 2, 0);
    k.col(hx + Wd / 2, cy, hz, 0.06, H / 2, L / 2, 0);
    k.col(hx, cy, hz - L / 2, Wd / 2, H / 2, 0.06, 0);
    k.col(hx + Wd / 4, cy, hz + L / 2, Wd / 4, H / 2, 0.06, 0);
    // the hazard board on its flank and the farm's lamp over the door
    this.prints.add(artQuad('ppHut', 2.6, 0.74, mat4(hx - Wd / 2 - 0.035, cy + 0.45, hz, 0, -Math.PI / 2)));
    k.b.add(M.post, xf(new THREE.BoxGeometry(0.3, 0.08, 0.3), mat4(hx - 0.2, cy + H / 2 + 0.12, hz + L / 2 + 0.25)));
    k.b.add(lampMat, xf(new THREE.SphereGeometry(0.1, 10, 8), mat4(hx - 0.2, cy + H / 2 + 0.04, hz + L / 2 + 0.25)));
    // inside: the inverter cabinets down one wall, the breaker by the door, a desk with the log
    const fy = y + 0.26;
    for (let i = 0; i < 3; i++) {
      k.b.add(M.cabinet, xf(new THREE.BoxGeometry(0.6, 1.9, 0.9), mat4(hx + 0.85, fy + 0.95, hz - 2.2 + i * 1.0)));
      k.b.add(M.vent, xf(new THREE.BoxGeometry(0.02, 0.5, 0.6), mat4(hx + 0.54, fy + 1.4, hz - 2.2 + i * 1.0)));
    }
    k.col(hx + 0.85, fy + 0.95, hz - 1.2, 0.3, 0.95, 1.45, 0);
    // the main breaker: a grey box with a big red handle (thrown state is in update)
    k.b.add(M.cabinet, xf(new THREE.BoxGeometry(0.5, 0.7, 0.2), mat4(hx + 1.08, fy + 1.3, hz + 1.85, 0, -Math.PI / 2)));
    this.breaker = new THREE.Mesh(norm(new THREE.BoxGeometry(0.06, 0.32, 0.06).translate(0, 0.14, 0)), M.handle);
    this.breaker.position.set(hx + 0.95, fy + 1.3, hz + 1.85);
    this.breakerAt = v3(hx + 0.6, fy + 1.3, hz + 1.85);
    // the desk, the chair, the screen, the log
    k.b.add(M.desk, xf(new THREE.BoxGeometry(0.7, 0.05, 1.3), mat4(hx - 0.8, fy + 0.75, hz - 0.6)));
    for (const [dx, dz] of [[-0.3, -0.6], [0.3, -0.6], [-0.3, 0.6], [0.3, 0.6]]) k.b.add(M.post, xf(new THREE.BoxGeometry(0.04, 0.75, 0.04), mat4(hx - 0.8 + dx, fy + 0.37, hz - 0.6 + dz)));
    k.b.add(M.cabinet, xf(new THREE.BoxGeometry(0.06, 0.4, 0.6), mat4(hx - 1.1, fy + 1.05, hz - 0.8)));
    this.glows.add(artQuad('ppScreen', 0.56, 0.31, mat4(hx - 1.065, fy + 1.05, hz - 0.8, 0, Math.PI / 2)));
    k.b.add(M.paper, xf(new THREE.BoxGeometry(0.24, 0.02, 0.32), mat4(hx - 0.7, fy + 0.79, hz - 0.2, 0, 0.2)));
    this.logAt = v3(hx - 0.7, fy + 0.85, hz - 0.2);
    k.b.add(M.chair, xf(new THREE.BoxGeometry(0.45, 0.06, 0.45), mat4(hx - 0.2, fy + 0.45, hz - 0.4)));
    k.b.add(M.post, xf(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), mat4(hx - 0.2, fy + 0.22, hz - 0.4)));
    // the spares cabinet outside on the west flank, padlocked
    k.b.add(M.cabinet, xf(new THREE.BoxGeometry(0.5, 1.4, 0.9), mat4(hx - Wd / 2 - 0.3, y + 0.7, hz - 1.8)));
    k.b.add(M.handle, xf(new THREE.BoxGeometry(0.03, 0.08, 0.06), mat4(hx - Wd / 2 - 0.57, y + 0.95, hz - 1.6)));
    k.col(hx - Wd / 2 - 0.3, y + 0.7, hz - 1.8, 0.25, 0.7, 0.45, 0);
    this.cabinetAt = v3(hx - Wd / 2 - 0.8, y + 1.0, hz - 1.8);
    // the dock rails at the row ends, and SHINE-5, dead on the sand by the hut
    ROWS.forEach((rz) => k.b.add(M.rail, xf(new THREE.BoxGeometry(0.9, 0.06, 0.4), mat4(X1 + 0.5, ROW_Y + 0.25, rz + 0.6))));
    const dx = 29.5, dz = 4.5, dy = k.ground(dx, dz);
    const dead = mat4(dx, dy + 0.18, dz, 0.15, 0.7, 1.35);
    k.b.add(M.bot, xf(new THREE.BoxGeometry(0.55, 0.3, 1.4), dead));
    k.b.add(M.brush, xf(new THREE.CylinderGeometry(0.11, 0.11, 2.9, 10).rotateX(Math.PI / 2), mat4(dx + 1.3, dy + 0.11, dz - 0.6, 0, 1.2, 0)));
    k.b.add(M.botDark, xf(new THREE.BoxGeometry(0.25, 0.08, 0.3), mat4(dx - 0.3, dy + 0.04, dz + 0.9, 0, 0.3)));
    this.botAt = v3(dx, dy + 0.4, dz);
    k.col(dx, dy + 0.25, dz, 0.45, 0.25, 0.7, 0.7);
    // the sign at the gate, facing the way in from the south
    const sx = 24.5, sz = -24, sy = k.ground(sx, sz); // beside the gate gap (14..20.5), not in it
    for (const ox of [-1.5, 1.5]) k.b.add(M.post, xf(new THREE.BoxGeometry(0.12, 2.6, 0.12), mat4(sx + ox, sy + 1.3, sz)));
    k.b.add(M.box, xf(new THREE.BoxGeometry(3.3, 1.66, 0.06), mat4(sx, sy + 1.9, sz + 0.04)));
    this.prints.add(artQuad('ppSign', 3.2, 1.6, mat4(sx, sy + 1.9, sz - 0.005, 0, Math.PI)));
    k.col(sx, sy + 1.3, sz, 1.65, 1.3, 0.1, 0);
    this.spot('approach', sx - 2, 0, sz - 8);
    this.spot('hut', hx - 0.4, 0, hz + 4.2);
  }
  private breaker!: THREE.Mesh;
  private breakerAt = new THREE.Vector3();
  private logAt = new THREE.Vector3();
  private cabinetAt = new THREE.Vector3();
  private botAt = new THREE.Vector3();

  // ================================================================ the perimeter: chain link, a gate left open, a run pushed flat
  private buildFence(M: Mats) {
    const k = this.kit;
    const link = chainLink();
    const x0 = -31, x1 = 38, z0 = -21, z1 = 21, H = 2.2, step = 3;
    const panel = (a: THREE.Vector3, b: THREE.Vector3, h: number) => {
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y + h, b.z, a.x, a.y, a.z, b.x, b.y + h, b.z, a.x, a.y + h, a.z], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len, 0, len, h, 0, 0, len, h, 0, h], 2));
      g.computeVertexNormals();
      return norm(g);
    };
    // the four sides as runs of posts; `skip(t)` leaves a gap, `flat(t)` lays the panel down
    const side = (ax: number, az: number, bx: number, bz: number, skip: (x: number, z: number) => boolean, flat: (x: number, z: number) => boolean) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / step);
      let runStart: THREE.Vector3 | null = null;
      let last: THREE.Vector3 | null = null;
      const flush = (end: THREE.Vector3) => {
        if (!runStart) return;
        const c = runStart.clone().add(end).multiplyScalar(0.5);
        const half = runStart.distanceTo(end) / 2;
        if (half > 0.2) k.col(c.x, c.y + H / 2, c.z, Math.abs(bx - ax) > 0.1 ? half : 0.05, H / 2, Math.abs(bz - az) > 0.1 ? half : 0.05, 0);
        runStart = null;
      };
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = k.ground(x, z);
        const p = v3(x, y, z);
        if (skip(x, z) || flat(x, z)) { if (last) flush(last); last = null; continue; }
        k.b.add(M.post, xf(new THREE.CylinderGeometry(0.04, 0.04, H + 0.1, 6), mat4(x, y + H / 2, z)));
        if (!runStart) runStart = p;
        last = p;
        if (i < n) {
          const t2 = (i + 1) / n, x2 = ax + (bx - ax) * t2, z2 = az + (bz - az) * t2;
          if (skip(x2, z2)) { flush(p); last = null; continue; }
          const q = v3(x2, k.ground(x2, z2), z2);
          if (flat(x2, z2)) {
            flush(p);
            last = null;
            // pushed flat outward: the panel lies on the sand from this post
            const out = v3(Math.sign(bz - az), 0, -Math.sign(bx - ax));
            k.nb.add(link, flatPanel(p, q, out, H));
            continue;
          }
          k.nb.add(link, panel(p, q, H)); // thin batch: an alpha-tested lattice can't go in the solid shadow proxy
          k.b.add(M.rail, xf(new THREE.CylinderGeometry(0.025, 0.025, Math.hypot(x2 - x, z2 - z), 5).rotateZ(Math.PI / 2).rotateY(-Math.atan2(z2 - z, x2 - x)), mat4((x + x2) / 2, (y + q.y) / 2 + H, (z + z2) / 2)));
        }
      }
      if (last) flush(last);
    };
    const none = () => false;
    side(x0, z0, x1, z0, (x) => x > 14 && x < 20.5, none); // south, the gate gap by the sign
    side(x1, z0, x1, z1, none, none); // east, behind the hut
    side(x1, z1, x0, z1, none, (x) => x > -12 && x < -3); // north: a run pushed flat by a storm
    side(x0, z1, x0, z0, none, none); // west
    // the gate leaf, swung back against the fence
    const gy = k.ground(14.5, z0);
    k.nb.add(link, panel(v3(14.5, gy + 0.05, z0), v3(14.5 - 2.6, gy + 0.05, z0 - 2.4), H - 0.1));
    k.b.add(M.post, xf(new THREE.CylinderGeometry(0.035, 0.035, H, 6), mat4(14.5 - 2.6, gy + H / 2, z0 - 2.4)));
  }

  // ================================================================ the buried line, heading east
  private buildCable(M: Mats) {
    const k = this.kit;
    // a trench scar out of the hut and a row of marker posts, every twelve metres toward Everafter
    for (let i = 0; i < 6; i++) {
      const x = 42 + i * 12, z = -1 - i * 1.5;
      const y = k.ground(x, z);
      k.b.add(M.marker, xf(new THREE.BoxGeometry(0.12, 1.2, 0.12), mat4(x, y + 0.6, z)));
      if (i % 2 === 0) {
        this.prints.add(artQuad('ppMarker', 0.32, 0.45, mat4(x, y + 0.85, z - 0.065, 0, Math.PI)));
        this.prints.add(artQuad('ppMarker', 0.32, 0.45, mat4(x, y + 0.85, z + 0.065)));
      }
    }
    k.b.add(M.conduit, xf(new THREE.BoxGeometry(7, 0.06, 0.5), mat4(37.6, k.ground(37.6, -1) + 0.02, -1)));
  }

  // ================================================================ SHINE units
  private buildBots(M: Mats, lampMat: THREE.Material) {
    const n = BOT_ROWS.length;
    const parts = (g: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
      const im = new THREE.InstancedMesh(norm(g), mat, n);
      im.name = name;
      im.castShadow = false;
      im.receiveShadow = true;
      // one sphere round the whole field (instances move; three's own is per-instance at build)
      im.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, ROW_Y, 0), 36);
      return im;
    };
    // the carriage rides the top edge of the row and hangs its brush down across the glass
    const body = new THREE.BoxGeometry(0.5, 0.32, 0.5).translate(0, 0.16, 1.45);
    const arm = new THREE.BoxGeometry(0.12, 0.08, DEPTH + 0.2).translate(0, 0.32, 0);
    const foot = new THREE.BoxGeometry(0.3, 0.2, 0.25).translate(0, 0.08, -1.5);
    const bodyG = mergeParts([body, arm, foot]);
    const brushG = new THREE.CylinderGeometry(0.1, 0.1, DEPTH, 12).rotateX(Math.PI / 2);
    // bristles: a few longitudinal ridges so the spin shows
    const lampG = new THREE.SphereGeometry(0.05, 8, 6).translate(0, 0.38, 1.5);
    const bots = { body: parts(bodyG, M.bot, 'shine-body'), brush: parts(brushG, M.brush, 'shine-brush'), lamp: parts(lampG, lampMat, 'shine-lamp') };
    this.placeBots(bots, 0);
    return bots;
  }

  private placeBots(b: { body: THREE.InstancedMesh; brush: THREE.InstancedMesh; lamp: THREE.InstancedMesh }, t: number) {
    const tilt = this._q.setFromEuler(this._e.set(TILT, 0, 0));
    const span = X1 - X0 - 1.2;
    BOT_ROWS.forEach((ri, i) => {
      // there and back along the row at a brisk 0.6 m/s, a pause at each end to "dock"
      const L = span / 0.6, P = 6;
      const ph = (t * 1 + i * 37) % (2 * (L + P));
      const u = ph < L ? ph / L : ph < L + P ? 1 : ph < 2 * L + P ? 1 - (ph - L - P) / L : 0;
      const x = X0 + 0.6 + u * span;
      const moving = (ph < L) || (ph > L + P && ph < 2 * L + P);
      this._p.set(x, ROW_Y + 0.03, ROWS[ri]);
      this._m.compose(this._p, tilt, this._s);
      b.body.setMatrixAt(i, this._m);
      b.lamp.setMatrixAt(i, this._m);
      // the brush sits just ahead of the carriage, spinning while it moves
      const dir = ph < L + P ? 1 : -1;
      const spin = moving ? t * 9 * dir : 0;
      const q2 = this._q2.copy(tilt).multiply(this._q3.setFromAxisAngle(Z_AXIS, spin));
      this._p.set(x + 0.32 * dir, ROW_Y + 0.13, ROWS[ri]);
      this._m.compose(this._p, q2, this._s);
      b.brush.setMatrixAt(i, this._m);
    });
    b.body.instanceMatrix.needsUpdate = true;
    b.brush.instanceMatrix.needsUpdate = true;
    b.lamp.instanceMatrix.needsUpdate = true;
  }

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
      id: 'solar.log', pos: W(this.logAt), radius: 1.5,
      primary: {
        get label() { return site.s?.has(F.log) ? 'Read the fleet log again' : 'Read the fleet log'; },
        available: () => true,
        run: () => this.readLog(),
      },
    });
    this.interactables.push({
      id: 'solar.breaker', pos: W(this.breakerAt), radius: 1.4,
      primary: {
        get label() { return site.s?.has(F.cut) ? 'Close the breaker (power Everafter again)' : 'Throw the main breaker'; },
        available: () => true,
        run: () => this.throwBreaker(),
      },
    });
    this.interactables.push({
      id: 'solar.cabinet', pos: W(this.cabinetAt), radius: 1.6,
      visible: () => !this.s?.has(F.cabinet),
      primary: {
        label: 'Pick the spares cabinet · 3 pins',
        available: () => {
          if (this.s.skill('lockpicking') < 1) return 'Requires Lockpicking 1';
          if (this.s.count('lockpick') < 1) return 'Need a lockpick';
          return true;
        },
        run: () => this.pickCabinet(),
      },
      secondary: {
        label: 'Pry it with the crowbar',
        available: () => (this.s.count('crowbar') > 0 ? true : 'Need a crowbar'),
        run: () => {
          if (!this.s.set(F.cabinet)) return;
          this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.9 });
          const got = this.loot([{ id: 'battery', qty: 1 }, { id: 'scrap', qty: 2 }]);
          this.toast(`The door folds. So does one of the cells inside. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, 'Spares cabinet');
        },
      },
    });
    this.interactables.push({
      id: 'solar.bot', pos: W(this.botAt), radius: 1.8,
      visible: () => !this.s?.has(F.bot),
      primary: {
        label: 'Strip SHINE-5',
        available: () => true,
        run: () => {
          if (!this.s.set(F.bot)) return;
          const got = this.loot([{ id: 'battery', qty: 1 }, { id: 'scrap', qty: 2 }]);
          this.ctx.audio.play('pickup');
          this.toast(`Its last status is still on the little screen: "Row 6 obstructed. Awaiting technician." Day 212. ${got}`, 'good');
          this.s.addXP(15, 'SHINE-5');
        },
      },
    });
  }

  private async readLog() {
    const s = this.s;
    if (s.set(F.log)) s.addXP(25, 'Fleet log');
    s.set(F.found);
    await this.ctx.ui.choose({
      speaker: 'Fleet log · Photon Park',
      text:
        'SHINE fleet, daily summary (auto). Panels cleaned: 4,096. Energy exported to EVERAFTER: 100%. Invoices paid by EVERAFTER: 0. Technician visits: 0. ' +
        'Note, technician, last entry, day 9 after the Pivot: "They pay in water now, apparently. Not to us. Contract says we keep the lights on until they say stop. Nobody in there has said stop. Main breaker\'s by the door if anybody ever wants to ask them in person." ' +
        'SHINE-5: row 6 obstructed. Awaiting technician. SHINE-1 to 4: nominal. Morale: n/a.',
      choices: [{ id: 'ok', label: 'Put it back on the desk' }],
    });
  }

  private async throwBreaker() {
    const s = this.s;
    if (s.has(F.cut)) {
      s.data.flags = s.data.flags.filter((f) => f !== F.cut);
      this.ctx.audio.play('zap', { pos: this.ctx.player.position });
      this.toast('The breaker slams home. Far to the east, somewhere, a bunker hums back to life and does not say thank you.', 'info');
      return;
    }
    const pick = await this.ctx.ui.choose({
      speaker: 'Main breaker · EVERAFTER feed',
      text: 'A lever as long as your arm, painted red, tagged: DO NOT OPEN UNDER LOAD. The meter beside it says the load is a bunker on the far side of the valley, and the bunker is using it.',
      choices: [{ id: 'cut', label: 'Throw it. Let them ask in person.' }, { id: 'no', label: 'Leave it.' }],
    });
    if (pick !== 'cut') return;
    s.set(F.cut);
    this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 1 });
    this.ctx.audio.play('zap', { pos: this.ctx.player.position });
    this.ctx.cam.addTrauma(0.15);
    if (s.set(F.done)) s.addXP(50, 'Pulled the plug');
    this.toast('The arc is a flat blue bang. The robots keep cleaning. On the other side of the valley, Everafter has just gone dark.', 'good');
  }

  private async pickCabinet() {
    const pins = 3 - (this.s.focus('lockpicking') === 'feeler' ? 1 : 0);
    const res = await this.ctx.ui.lockpick({
      pins,
      title: 'SPARES · PHOTON PARK',
      onBreak: () => {
        this.s.removeItem('lockpick', 1);
        this.toast(`Lockpick snapped (${this.s.count('lockpick')} left)`, 'bad');
        return this.s.count('lockpick') > 0;
      },
    });
    if (res !== 'success' || !this.s.set(F.cabinet)) return;
    this.s.data.stats.picks++;
    this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
    const got = this.loot([{ id: 'battery', qty: 2 }, { id: 'scrap', qty: 2 }, { id: 'lockpick', qty: 1 }]);
    this.toast(`Spare cells for robots that never needed them, a bag of fuses, a pick someone left in the lock. ${got}`, 'good');
    this.s.addXP(XP_REWARDS.lockPicked + 10, 'Spares cabinet');
  }

  // ================================================================ per frame
  update(dt: number, cam: THREE.Vector3) {
    super.update(dt, cam);
    this.t += dt;
    const night = this.ctx.atmo.uNight.value as number;
    const cut = !!this.ctx.state?.has(F.cut);
    // the breaker handle: up is on, down is thrown
    this.breaker.rotation.z = cut ? -2.4 : 0;
    this.hutLampK.value = night * 6;
    this.doorLight.intensity = night * 3.2;
    this.kit.halos.channels[1] = night * 0.8;
    this.screenLight.intensity = 0.3 + night * 1.1;
    if (!this.near.visible) return;
    uSiteNight.value = night;
    uSiteFlicker.value = 0.95 + 0.05 * Math.sin(this.t * 11);
    // the robots: lamps blink as they go; brushes spin
    this.lampK.value = (Math.sin(this.t * 5) > 0 ? 1 : 0.25) * (1.5 + night * 5);
    this.placeBots(this.bots, this.t);
    const pl = this.ctx.player?.position;
    const s = this.ctx.state;
    if (s && pl && !s.has(F.found)) {
      const h = this.frame.p(33, 0, 2);
      if (Math.hypot(pl.x - h.x, pl.z - h.z) < 10) {
        s.set(F.found);
        this.toast('Seven rows of glass and four robots wiping them, for a customer who stopped paying the day the world ended.', 'info');
      }
    }
  }
}

// ------------------------------------------------------------------ materials
type Mats = ReturnType<typeof mats>;
function mats() {
  return {
    cell: plainStandard('#16233a', 0.2, 0.35),
    cracked: plainStandard('#56657a', 0.45, 0.3),
    frame: rustyMetal({ base: '#b9bcc0', rust: 0.1, metalness: 0.85, roughness: 0.35 }),
    post: rustyMetal({ base: '#8c8f92', rust: 0.35, metalness: 0.75, roughness: 0.45 }),
    rail: rustyMetal({ base: '#a0a3a6', rust: 0.25, metalness: 0.8, roughness: 0.4 }),
    box: corrugated('#3f6a7a', 0.45, 'y'),
    boxEnd: corrugated('#3f6a7a', 0.5, 'y'),
    boxRoof: rustyMetal({ base: '#395e6c', rust: 0.55, metalness: 0.6, roughness: 0.55 }),
    sleeper: wood('#4f3e2c'),
    cabinet: plainStandard('#9aa0a6', 0.5, 0.4),
    vent: plainStandard('#2a2d30', 0.6, 0.3),
    handle: plainStandard('#b8241a', 0.45, 0.1),
    desk: wood('#6b5236'),
    chair: plainStandard('#2a2d30', 0.7),
    paper: plainStandard('#e8e2d0', 0.9),
    bot: plainStandard('#e4e1d8', 0.45, 0.1),
    botDark: plainStandard('#2a2d30', 0.6, 0.2),
    brush: plainStandard('#d6b23a', 0.85),
    marker: plainStandard('#e8641e', 0.6),
    conduit: plainStandard('#3a3530', 0.9),
  };
}

function mergeParts(parts: THREE.BufferGeometry[]) {
  const list = parts.map((p) => norm(p));
  const n = list.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    uvs.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeBoundingSphere();
  return g;
}

/** A chain-link panel lying on the sand, pushed flat outward from the post line a→b. */
function flatPanel(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3, h: number) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const A = a.clone().setY(a.y + 0.06), B = b.clone().setY(b.y + 0.06);
  const C = B.clone().addScaledVector(out, h).setY(b.y + 0.12), D = A.clone().addScaledVector(out, h).setY(a.y + 0.12);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, A.x, A.y, A.z, C.x, C.y, C.z, D.x, D.y, D.z], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len, 0, len, h, 0, 0, len, h, 0, h], 2));
  g.computeVertexNormals();
  return norm(g);
}
